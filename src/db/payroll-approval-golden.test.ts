/**
 * Today's pay run postings, pinned before salary approval by the Super Admin
 * (#10) touched approvePayRun: the salary entry, the provisions, the owed
 * PIFSS loan and the payment, account by account. Salary approval only
 * decides when a run may be posted; when it is off (every company until the
 * owner turns it on) or the company is kept on this device, posting is as
 * before. Made-up people and amounts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadLedger } from './accounting';
import { saveCompany, setupCompany } from './records';
import { createEmployee, newAllowance, saveEmployee } from './people';
import {
  approvePayRun,
  createLeaveRecord,
  createPayRun,
  getPayrollSettings,
  payPayRun,
  saveLeaveRecord,
  savePayrollSettings,
  updatePayLine,
} from './payroll';
import type { ApprovalRules, Company } from './types';
import type { MemberRole } from '@/cloud/roles';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

/** A made-up company with a Kuwaiti, an expatriate joiner and one on unpaid leave all month. */
async function seed(rules?: ApprovalRules): Promise<Company> {
  const created = await setupCompany({ name: 'Made-up Guarding Co.', currency: 'KWD' });
  const c = rules ? await saveCompany({ ...created, approvalRules: rules }) : created;
  await savePayrollSettings({ ...(await getPayrollSettings(c.id)), provisions: true });
  await saveEmployee(
    createEmployee(c.id, {
      name: 'Made-up Supervisor',
      category: 'kuwaiti',
      nationality: 'KW',
      department: 'Operations',
      jobTitle: 'Supervisor',
      hireDate: '2019-01-01',
      basicSalary: 2600,
      allowances: [newAllowance({ name: 'Social allowance', amount: 400 })],
      iban: IBAN,
    }),
  );
  await saveEmployee(
    createEmployee(c.id, {
      name: 'Made-up Guard',
      category: 'expat',
      nationality: 'IN',
      department: 'Operations',
      jobTitle: 'Guard',
      hireDate: '2026-09-16',
      basicSalary: 450,
      allowances: [newAllowance({ name: 'Housing', amount: 60, countsForEos: false })],
      iban: IBAN,
    }),
  );
  const away = await saveEmployee(
    createEmployee(c.id, {
      name: 'Made-up Clerk',
      category: 'kuwaiti',
      nationality: 'KW',
      department: 'Head Office',
      jobTitle: 'Clerk',
      hireDate: '2020-01-01',
      basicSalary: 900,
      iban: IBAN,
    }),
  );
  // A month of unpaid leave: the PIFSS share is owed by the employee.
  await saveLeaveRecord(
    createLeaveRecord(c.id, away.id, { type: 'unpaid', start: '2026-09-01', end: '2026-09-30' }),
  );
  return c;
}

/** This device's person in the company kept in the cloud. */
async function signedInAs(company: Company, role: MemberRole) {
  await db.syncState.put({
    companyId: company.id,
    userId: `user-${role}`,
    role,
    status: 'ready',
    cursor: 0,
    name: company.name,
    linkedAt: '2026-10-01T08:00:00.000Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  });
}

/** Balances by account code in minor units (debit positive). */
async function balances(c: Company): Promise<Record<string, number>> {
  const fresh = (await db.companies.get(c.id))!;
  const { accounts, lines, problems } = await loadLedger(fresh);
  expect(problems).toEqual([]);
  const out: Record<string, number> = {};
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)!.code;
    out[code] = (out[code] ?? 0) + l.amount;
  }
  return out;
}

/** What posting and paying September posts, as today. */
const SEPTEMBER = {
  lines: [
    // [gross, PIFSS employee, PIFSS employer, owed, net]
    ['Made-up Supervisor', 3000, 288.75, 316.25, 0, 2711.25],
    ['Made-up Guard', 261.13, 0, 0, 0, 256.13],
    ['Made-up Clerk', 0, 94.5, 103.5, 94.5, 0],
  ],
  posted: {
    '1320': 94_500,
    '2300': -2_967_380,
    '2310': -803_000,
    '2320': -33_836_538,
    '2700': -10_670,
    '4500': -5000,
    '6010': 2_825_000,
    '6020': 436_130,
    '6030': 419_750,
    '6040': 10_670,
    '6050': 33_836_538,
  },
  /** The bank, once paid. */
  paid: -2_967_380,
};

async function postSeptember(c: Company) {
  const run = await createPayRun(c.id, '2026-09');
  const guard = run.lines.find((l) => l.name === 'Made-up Guard')!;
  const edited = await updatePayLine(run.id, guard.id, {
    overtime: { normal: 2, restDay: 0, holiday: 0 },
    adjustments: [{ id: '', type: 'deduction', amount: 5, note: 'Uniform' }],
  });
  const approved = await approvePayRun(edited.id);
  expect(approved.status).toBe('approved');
  expect(
    approved.lines.map((l) => [
      l.name,
      l.gross,
      l.pifssEmployee,
      l.pifssEmployer,
      l.pifssOwed ?? 0,
      l.net,
    ]),
  ).toEqual(SEPTEMBER.lines);
  expect(await balances(c)).toEqual(SEPTEMBER.posted);
  const loans = await db.staffLoans.where('companyId').equals(c.id).toArray();
  expect(loans.map((l) => [l.amount, l.payRunId])).toEqual([[94.5, run.id]]);
  const settings = await getPayrollSettings(c.id);
  const paid = await payPayRun(run.id, {
    date: '2026-10-05',
    bankAccountId: settings.bankAccountId,
  });
  expect(paid.status).toBe('paid');
  const bank = (await db.accounts.get(paid.bankAccountId!))!;
  expect(await balances(c)).toEqual({
    ...SEPTEMBER.posted,
    '2300': 0,
    [bank.code]: SEPTEMBER.paid,
  });
}

describe('posting a pay run, as before salary approval', () => {
  it('posts and pays the same in a company kept on this device', async () => {
    await postSeptember(await seed());
  });

  it('posts and pays the same in the cloud without approval rules', async () => {
    const c = await seed();
    await signedInAs(c, 'accountant');
    await postSeptember(c);
  });

  it('posts and pays the same with only invoice and cheque rules on', async () => {
    const c = await seed({ documentTypes: ['invoice'], cheques: { issued: true } });
    await signedInAs(c, 'accountant');
    await postSeptember(c);
  });
});
