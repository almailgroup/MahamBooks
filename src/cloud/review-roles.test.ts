import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { createEmployee, saveEmployee } from '@/db/people';
import { renewDocument } from '@/db/renewals';
import { approvePayRun, createPayRun, payPayRun } from '@/db/payroll';
import { loadLedger } from '@/db/accounting';
import type { Company } from '@/db/types';
import { addDaysISO, today } from '@/lib/dates';
import { FakeCloud } from './testing/fake-cloud';
import { startDownload, startUpload, syncCompany } from './sync';

/** Balance of each account code in fils (debits positive), as the dashboard and reports see it. */
async function balancesByCode(companyId: string): Promise<Record<string, number>> {
  const company = (await db.companies.get(companyId)) as Company;
  const { accounts, lines } = await loadLedger(company);
  const out: Record<string, number> = {};
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)?.code ?? '?';
    out[code] = (out[code] ?? 0) + l.amount;
  }
  return out;
}

/**
 * Review: payroll and people data reaching staff and viewers. Made-up data only.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('review: staff and viewers', () => {
  // Known, left to whoever owns renewals (src/db/renewals.ts): the fee of an
  // employee's renewal is an expense, which staff and viewers see, written
  // "Passport renewal – <name>" with the new document number as reference.
  it('never receive an employee’s name or passport number through an expense', async () => {
    const OWNER = 'user-owner';
    const VIEWER = 'user-viewer';
    const server = new FakeCloud();
    const owner = { api: server.client(OWNER), userId: OWNER };
    const company = await setupCompany({ name: 'Review Trading' });
    const employee = await saveEmployee(
      createEmployee(company.id, {
        name: 'Made-up Person',
        nationality: 'IN',
        category: 'expat',
        passportNumber: 'Z0000001',
        passportExpiry: addDaysISO(today(), 20),
        basicSalary: 450,
      }),
    );
    await startUpload(company.id, owner);
    await syncCompany(company.id, owner);
    // The owner renews the passport and records the embassy fee.
    await renewDocument({
      companyId: company.id,
      key: `emp:${employee.id}:passport`,
      newExpiry: addDaysISO(today(), 3650),
      renewedOn: today(),
      number: 'Z0000002',
      note: 'Renewed at the embassy',
      fee: { amount: 25, accountId: null, paidFromAccountId: null },
    });
    await syncCompany(company.id, owner);

    // A viewer opens the company on their own device.
    server.addMember(company.id, VIEWER, 'viewer');
    await db.delete();
    await db.open();
    const viewer = { api: server.client(VIEWER), userId: VIEWER };
    await startDownload({ id: company.id, name: company.name, role: 'viewer' }, viewer);
    await syncCompany(company.id, viewer);
    expect(await db.employees.count()).toBe(0);
    expect(await db.renewals.count()).toBe(0);

    // Expenses (/expenses) is open to viewers and staff.
    const expenses = await db.expenses.where('companyId').equals(company.id).toArray();
    const shown = expenses.map((e) => ({
      description: e.description,
      reference: e.reference,
      notes: e.notes,
    }));
    const text = JSON.stringify(shown);
    // FAILS: { description: 'Passport renewal – Made-up Person', reference: 'Z0000002', … }
    expect(
      { employeeName: text.includes('Made-up Person'), passportNo: text.includes('Z0000002') },
      text,
    ).toEqual({ employeeName: false, passportNo: false });
  });
});

describe('review: the books staff and viewers see', () => {
  // The owner's decision: payroll stays private, so the books of staff and
  // viewers leave it out (and say so, see PayrollNotIncluded in role-gates).
  it('leave payroll out: the salary payment is not in the viewer’s bank balance', async () => {
    const OWNER = 'user-owner';
    const VIEWER = 'user-viewer';
    const server = new FakeCloud();
    const owner = { api: server.client(OWNER), userId: OWNER };
    const company = await setupCompany({ name: 'Review Trading' });
    await saveEmployee(
      createEmployee(company.id, {
        name: 'Made-up Person',
        nationality: 'IN',
        category: 'expat',
        hireDate: '2025-01-01',
        basicSalary: 450,
      }),
    );
    const run = await createPayRun(company.id, '2026-09');
    await approvePayRun(run.id);
    await payPayRun(run.id, { date: '2026-10-01' });
    const ownerBooks = await balancesByCode(company.id);
    expect(ownerBooks['1000']).toBeLessThan(0);
    await startUpload(company.id, owner);
    await syncCompany(company.id, owner);

    server.addMember(company.id, VIEWER, 'viewer');
    await db.delete();
    await db.open();
    const viewer = { api: server.client(VIEWER), userId: VIEWER };
    await startDownload({ id: company.id, name: company.name, role: 'viewer' }, viewer);
    await syncCompany(company.id, viewer);
    const viewerBooks = await balancesByCode(company.id);
    expect(await db.journals.filter((j) => j.kind === 'payroll').count()).toBe(0);
    expect(viewerBooks['1000'] ?? 0).toBe(0);
    expect(ownerBooks['1000']).toBe(-450_000);
  });
});
