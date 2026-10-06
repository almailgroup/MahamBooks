/** Final check of the payroll fix (made-up data only). */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadLedger } from './accounting';
import { setupCompany } from './records';
import { createEmployee, saveEmployee } from './people';
import {
  approvePayRun,
  createLeaveRecord,
  createPayRun,
  getPayrollSettings,
  postSettlement,
  reopenPayRun,
  reverseSettlement,
  saveLeaveRecord,
  settlementDefaults,
  settlementSetup,
} from './payroll';
import type { Company, Employee } from './types';
import { toMinor } from '@/lib/money';
import { exportBackup, importBackup } from './backup';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

async function balance(c: Company, code: string): Promise<number> {
  const fresh = (await db.companies.get(c.id))!;
  const { accounts, lines } = await loadLedger(fresh);
  const id = accounts.find((a) => a.code === code)!.id;
  return lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.amount, 0);
}

async function settle(c: Company, e: Employee, leavingDate: string) {
  const [settings, people, leave, loans, runs, settlements] = await Promise.all([
    getPayrollSettings(c.id),
    db.peopleSettings.get(c.id),
    db.leaveRecords.toArray(),
    db.staffLoans.toArray(),
    db.payRuns.toArray(),
    db.finalSettlements.toArray(),
  ]);
  const data = {
    settings,
    people: { eosDailyDivisor: people?.eosDailyDivisor ?? 26 },
    leave,
    loans,
    runs,
    settlements,
  };
  const employee = (await db.employees.get(e.id))!;
  const setup = settlementSetup(employee, leavingDate, data, 3);
  return postSettlement(settlementDefaults(employee, leavingDate, 'termination', setup, 3));
}

describe('a PIFSS share owed, then a final settlement', () => {
  it('is recovered once, and reopening the month waits for the settlement', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await saveEmployee(
      createEmployee(c.id, {
        name: 'Test Clerk',
        category: 'kuwaiti',
        nationality: 'KW',
        hireDate: '2022-01-01',
        basicSalary: 900,
        iban: IBAN,
      }),
    );
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { type: 'unpaid', start: '2026-09-01', end: '2026-09-30' }),
    );
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    expect(september.lines[0].pifssOwed).toBe(94.5);
    const settlement = await settle(c, e, '2026-10-15');
    const [owed] = await db.staffLoans.toArray();
    expect(settlement.loans).toEqual([{ loanId: owed.id, amount: 94.5 }]);
    expect(await balance(c, '1320')).toBe(0);
    await expect(reopenPayRun(september.id)).rejects.toThrow(/already recovered/);
    await reverseSettlement(settlement.id);
    expect(await balance(c, '1320')).toBe(toMinor(94.5, 3));
    await reopenPayRun(september.id);
    // The owed share goes with the entry: its loan is cancelled, not deleted.
    const loans = await db.staffLoans.toArray();
    expect(loans.filter((l) => l.status === 'active')).toHaveLength(0);
    expect(await balance(c, '1320')).toBe(0);
  });
});

describe('a PIFSS share owed, reopened, then a backup merged', () => {
  it('is not owed twice', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await saveEmployee(
      createEmployee(c.id, {
        name: 'Test Clerk',
        category: 'kuwaiti',
        nationality: 'KW',
        hireDate: '2022-01-01',
        basicSalary: 900,
        iban: IBAN,
      }),
    );
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { type: 'unpaid', start: '2026-09-01', end: '2026-09-30' }),
    );
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    const backup = await exportBackup(c.id);
    // Reopened (its owed share is cancelled) and approved again (the same loan, owed again).
    await reopenPayRun(september.id);
    await approvePayRun(september.id);
    // Settings → Data → merge the backup made before.
    await importBackup(backup, 'merge');
    const owed = (await db.staffLoans.where('employeeId').equals(e.id).toArray()).filter(
      (l) => l.status === 'active',
    );
    // 1320 holds KD 94.500 owed once; the loans would recover it twice.
    expect(await balance(c, '1320')).toBe(toMinor(94.5, 3));
    expect(owed.reduce((s, l) => s + l.amount, 0)).toBe(94.5);
  });
});
