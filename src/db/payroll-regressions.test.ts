/**
 * Regressions found in a second review of the payroll changes (the first
 * tests are the reviewer's), with made-up data only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadLedger } from './accounting';
import { setupCompany } from './records';
import { createEmployee, saveEmployee } from './people';
import {
  approvePayRun,
  cancelStaffLoan,
  createLeaveRecord,
  createPayRun,
  getPayrollSettings,
  loanBalance,
  reopenPayRun,
  saveLeaveRecord,
  settlementDefaults,
  settlementSetup,
  updatePayLine,
} from './payroll';
import type { Company, Employee, LeavePolicy, ManualJournal } from './types';
import { importEmployees, type ImportOptions } from './import';
import { guessColumns } from '@/features/company/import-columns';
import {
  annualLeaveBalance,
  DEFAULT_LEAVE_POLICY,
  employeesNeedingLeaveOpening,
} from '@/lib/hr/leave';
import { toMinor } from '@/lib/money';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

const staff = (c: Company, overrides: Partial<Employee> = {}) =>
  saveEmployee(
    createEmployee(c.id, {
      name: 'Test Clerk',
      category: 'kuwaiti',
      nationality: 'KW',
      hireDate: '2022-01-01',
      basicSalary: 900,
      iban: IBAN,
      ...overrides,
    }),
  );

const unpaidMonth = (c: Company, e: Employee, start: string, end: string) =>
  saveLeaveRecord(createLeaveRecord(c.id, e.id, { type: 'unpaid', start, end }));

/** An entry's lines as [account code, debit, credit, description]. */
async function entry(c: Company, id: string | null) {
  const journal = (await db.journals.get(id ?? ''))! as ManualJournal;
  const accounts = await db.accounts.where('companyId').equals(c.id).toArray();
  return journal.lines.map((l) => [
    accounts.find((a) => a.id === l.accountId)!.code,
    l.debit,
    l.credit,
    l.description,
  ]);
}

async function balance(c: Company, code: string): Promise<number> {
  const fresh = (await db.companies.get(c.id))!;
  const { accounts, lines } = await loadLedger(fresh);
  const id = accounts.find((a) => a.code === code)!.id;
  return lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.amount, 0);
}

describe('a month of unpaid leave', () => {
  it('a Kuwaiti employee on unpaid leave all of September can still be paid', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await staff(c);
    await unpaidMonth(c, e, '2026-09-01', '2026-09-30');
    const run = await createPayRun(c.id, '2026-09');
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
  });

  it('pays 0 and records the PIFSS share the pay doesn’t cover as owed by the employee', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await staff(c);
    await unpaidMonth(c, e, '2026-09-01', '2026-09-30');
    const run = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    // 10.5% of KD 900 is still charged (whether it is due on unpaid days is the owner’s call).
    expect(run.lines[0]).toMatchObject({ gross: 0, pifssEmployee: 94.5, pifssOwed: 94.5, net: 0 });
    // The employee owes it: staff advances, next to the full contribution due to PIFSS.
    expect(await entry(c, run.journalId)).toEqual([
      ['6030', 103.5, 0, 'PIFSS – employer share'],
      ['1320', 94.5, 0, 'PIFSS shares owed by employees'],
      ['2310', 0, 198, 'PIFSS contributions'],
    ]);
    expect(await balance(c, '1320')).toBe(toMinor(94.5, 3));

    // A loan recovers it from later salaries, at most 10% of the wage a month (art. 59).
    const [owed] = await db.staffLoans.where('employeeId').equals(e.id).toArray();
    expect(owed).toMatchObject({
      amount: 94.5,
      instalment: 90,
      firstPeriod: '2026-10',
      payRunId: run.id,
      journalId: null,
      status: 'active',
    });
    // It goes with its pay run, not on its own.
    await expect(cancelStaffLoan(owed.id)).rejects.toThrow(/reopening that pay run/);

    const october = await approvePayRun((await createPayRun(c.id, '2026-10')).id);
    expect(october.lines[0]).toMatchObject({
      loans: [{ loanId: owed.id, amount: 90 }],
      loanDeduction: 90,
      net: 715.5,
    });
    const november = await approvePayRun((await createPayRun(c.id, '2026-11')).id);
    expect(november.lines[0].loans).toEqual([{ loanId: owed.id, amount: 4.5 }]);
    const runs = await db.payRuns.toArray();
    expect(loanBalance(owed, runs, [], 3)).toBe(0);
    expect(await balance(c, '1320')).toBe(0);
  });

  it('loans and other deductions still can’t take net pay below zero', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await staff(c);
    await unpaidMonth(c, e, '2026-09-01', '2026-09-30');
    const run = await createPayRun(c.id, '2026-09');
    await updatePayLine(run.id, run.lines[0].id, {
      adjustments: [{ id: 'x', type: 'deduction', amount: 10, note: 'Uniform' }],
    });
    await expect(approvePayRun(run.id)).rejects.toThrow(/Net pay can’t be below zero/);
  });

  it('is recovered only from pay that covers it, and goes when its pay run is reopened', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await staff(c);
    await unpaidMonth(c, e, '2026-09-01', '2026-10-31');
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    // October is unpaid too: nothing to recover September’s share from, and October’s is owed.
    const october = await createPayRun(c.id, '2026-10');
    expect(october.lines[0]).toMatchObject({ loans: [], pifssOwed: 94.5, net: 0 });
    await approvePayRun(october.id);
    expect(await db.staffLoans.count()).toBe(2);

    // Reopening October cancels its share; approving again records it again (the same loan).
    await reopenPayRun(october.id);
    const active = (await db.staffLoans.toArray()).filter((l) => l.status === 'active');
    expect(active.map((l) => l.payRunId)).toEqual([september.id]);
    expect(await balance(c, '1320')).toBe(toMinor(94.5, 3));
    await approvePayRun(october.id);
    expect(await db.staffLoans.count()).toBe(2);

    // Once a later salary has recovered some of it, its pay run stays approved.
    const november = await approvePayRun((await createPayRun(c.id, '2026-11')).id);
    expect(november.lines[0].loanDeduction).toBe(90);
    await expect(reopenPayRun(september.id)).rejects.toThrow(/already recovered/);
  });
});

const OPTIONS: ImportOptions = {
  contactType: 'customer',
  documentType: 'invoice',
  asOf: '2026-09-30',
  dateFormat: 'dd/MM/yyyy',
  fileName: 'staff.xlsx',
  today: '2026-10-05',
  updateExisting: true,
};

async function imported(c: Company, rows: string[][]): Promise<Employee> {
  await importEmployees(c.id, rows, guessColumns('employees', rows[0], rows), OPTIONS);
  return (await db.employees.toArray()).find((x) => x.number === '201')!;
}

describe('opening balance of an imported employee', () => {
  const rows = [
    ['Employee Number', 'Name', 'Hire date', 'Basic salary', 'IBAN'],
    ['201', 'Test Driver One', '01/03/2021', '260', IBAN],
  ];

  it('an opening balance recorded as of the 1st of the month counts', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await imported(c, rows);
    expect(e.leaveOpening).toEqual({ date: '2026-10-05', days: 0, confirmed: false });
    // "Set the leave balance" → "Opening balance on a date": 15 days on 1 October.
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, {
        type: 'annual',
        kind: 'opening',
        start: '2026-10-01',
        days: 15,
      }),
    );
    const records = await db.leaveRecords.toArray();
    // 15 brought in on 1 October plus 2.5 days for October, even with the import's 0 days.
    expect(annualLeaveBalance(records, e.hireDate, '2026-10-31', e.leaveOpening).balance).toBe(
      17.5,
    );
    // The record replaces the import's 0 days, and the employee needs no other opening.
    const after = (await db.employees.get(e.id))!;
    expect(after.leaveOpening ?? null).toBeNull();
    expect(employeesNeedingLeaveOpening([e, after], records)).toEqual([]);
  });

  it('the October leave provision includes it', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await imported(c, rows);
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, {
        type: 'annual',
        kind: 'opening',
        start: '2026-10-01',
        days: 15,
      }),
    );
    const approved = await approvePayRun((await createPayRun(c.id, '2026-10')).id);
    // 17.5 days at 260 / 26 = 175.000
    expect(approved.provisions?.find((p) => p.employeeId === e.id)).toMatchObject({
      leaveDays: 17.5,
      leave: 175,
    });
  });

  it('September, approved after an import on 5 October, provisions the leave they had', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await imported(c, [
      [...rows[0], 'Leave balance'],
      [...rows[1], '12.5'],
    ]);
    const approved = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    // No complete month between 30 September and 5 October: the 12.5 days they brought.
    expect(approved.provisions?.find((p) => p.employeeId === e.id)).toMatchObject({
      leaveDays: 12.5,
      leave: 125,
    });
  });
});

describe('final settlements under a leave policy', () => {
  it('are unchanged until the policy’s date, and count its days only from then', async () => {
    const c = await setupCompany({ name: 'Test Trading Co' });
    const e = await staff(c, { category: 'expat', nationality: 'IN' });
    const taken = await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { start: '2025-08-03', end: '2025-08-07' }),
    );
    expect(taken.days).toBe(5);
    const data = async (leavePolicy?: LeavePolicy) => ({
      settings: { ...(await getPayrollSettings(c.id)), leavePolicy },
      people: { eosDailyDivisor: 26 },
      leave: await db.leaveRecords.toArray(),
      loans: [],
      runs: [],
      settlements: [],
    });
    const policy = (from: string, days: number): LeavePolicy => ({
      ...DEFAULT_LEAVE_POLICY,
      annualDays: [{ from, days }],
    });
    // 54 months from 1 January 2022 at 2.5 days, less the 5 taken.
    const before = settlementSetup(e, '2026-06-30', await data(), 3);
    expect(before.leave.balance).toBe(130);
    // A policy from after the leaving date, or the law's 30 days written out, change nothing.
    for (const leavePolicy of [policy('2026-07-01', 45), policy('2020-01-01', 30)]) {
      const setup = settlementSetup(e, '2026-06-30', await data(leavePolicy), 3);
      expect(setup.leave).toEqual(before.leave);
      expect(settlementDefaults(e, '2026-06-30', 'resignation', setup, 3)).toEqual(
        settlementDefaults(e, '2026-06-30', 'resignation', before, 3),
      );
    }
    // 45 days a year from 1 January 2026: six months at 3.75 days instead of 2.5.
    const from2026 = settlementSetup(e, '2026-06-30', await data(policy('2026-01-01', 45)), 3);
    expect(from2026.leave.balance).toBe(137.5);
    expect(settlementDefaults(e, '2026-06-30', 'resignation', from2026, 3).leaveDays).toBe(137.5);
  });
});
