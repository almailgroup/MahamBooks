import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { saveCompany, setupCompany } from './records';
import { createEmployee, newAllowance, saveEmployee } from './people';
import {
  approvePayRun,
  createPayRun,
  getPayrollSettings,
  payPayRun,
  refreshPayRun,
  reopenPayRun,
  updatePayLine,
  updatePayRun,
} from './payroll';
import {
  approvalsOn,
  cancelApproval,
  correctsByNewNumber,
  decideApproval,
  expirePending,
  payrollApprovalsShown,
} from './approvals';
import {
  payrollApprovalState,
  payrollDetails,
  payrollPostable,
  payrollRequests,
  requestPayrollApproval,
} from './payroll-approvals';
import { CloudPermissionError } from '@/cloud/outbox';
import type { MemberRole } from '@/cloud/roles';
import type { ApprovalRequest, ApprovalRules, Company, PayRun } from './types';

/**
 * Salary approval by the Super Admin (#10): with the owner's switch on, a
 * pay run is approved (posted) only as the Super Admin approved it; the
 * owner posts at once. Off, or in a company kept on this device, posting is
 * as before (see payroll-approval-golden.test.ts). Made-up people.
 */

const RULES: ApprovalRules = { payroll: true, expireDays: 14 };
const FEATURES = [
  'tables_v16',
  'super_admin',
  'approvals',
  'cheque_approvals',
  'payroll_approvals',
];

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** This device's person in the company kept in the cloud. */
async function signedInAs(
  company: Company,
  role: MemberRole,
  options: { approver?: boolean; user?: string; features?: string[] } = {},
) {
  await db.syncState.put({
    companyId: company.id,
    userId: options.user ?? `user-${role}`,
    role,
    status: 'ready',
    cursor: 0,
    name: company.name,
    linkedAt: '2026-10-01T08:00:00.000Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    features: options.features ?? FEATURES,
    ...(options.approver ? { approver: true } : {}),
  });
}

async function seed(rules: ApprovalRules | null = RULES) {
  const created = await setupCompany({ name: 'Made-up Guarding Co.', currency: 'KWD' });
  const company = rules ? await saveCompany({ ...created, approvalRules: rules }) : created;
  for (const [name, department, jobTitle, basicSalary] of [
    ['Made-up Guard One', 'Operations', 'Guard', 300],
    ['Made-up Guard Two', 'Operations', 'Guard', 320],
    ['Made-up Clerk', 'Head Office', 'Clerk', 700],
  ] as const) {
    await saveEmployee(
      createEmployee(company.id, {
        name,
        category: 'expat',
        nationality: 'IN',
        department,
        jobTitle,
        hireDate: '2024-01-01',
        basicSalary,
        allowances: [newAllowance({ name: 'Transport', amount: 20 })],
        iban: 'KW81CBKU0000000000001234560101',
      }),
    );
  }
  const run = await createPayRun(company.id, '2026-09');
  return { company, run };
}

const fresh = async (run: PayRun) => (await db.payRuns.get(run.id))!;

describe('salary approval switched off, or kept on this device', () => {
  it('posts as before without the switch', async () => {
    const { company, run } = await seed(null);
    await signedInAs(company, 'accountant');
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
    expect(await db.approvals.count()).toBe(0);
  });

  it('posts as before in a company kept on this device, switch or not', async () => {
    const { run } = await seed();
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
  });

  it('posts as before while the cloud doesn’t have salary approval yet', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant', { features: ['tables_v16', 'approvals'] });
    await expect(requestPayrollApproval(run.id)).rejects.toThrow(/Salary approval is off/);
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
  });
});

describe('salary approval and Books', () => {
  it('leaves Books as it was when only pay runs are kept for approval', () => {
    const payrollOnly = { approvalRules: { payroll: true, expireDays: 14 } };
    expect(approvalsOn(payrollOnly)).toBe(false);
    expect(correctsByNewNumber({ ...payrollOnly, defaults: {} as Company['defaults'] })).toBe(
      false,
    );
    expect(payrollApprovalsShown(payrollOnly)).toBe(true);
    // Rules of Books as the owner set them before, with or without pay runs.
    for (const approvalRules of [
      {},
      { expireDays: 14 },
      { voidInsteadOfDelete: true, expireDays: 14 },
      { documentTypes: [], payroll: true },
      { cheques: { issued: true }, payroll: false },
    ]) {
      expect(approvalsOn({ approvalRules })).toBe(true);
    }
    expect(approvalsOn({})).toBe(false);
    expect(payrollApprovalsShown({ approvalRules: { documentTypes: ['invoice'] } })).toBe(false);
  });
});

describe('salary approval switched on', () => {
  it('posts a pay run only once the Super Admin approved it as it was sent', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    await expect(approvePayRun(run.id)).rejects.toThrow(/needs the Super Admin’s approval/);
    expect(payrollPostable(company, await db.syncState.get(company.id), run, [])).toBe(false);

    const request = await requestPayrollApproval(run.id, {
      note: 'September, with the two new guards.',
      byName: 'Made-up Accountant',
    });
    expect(request).toMatchObject({
      kind: 'payroll',
      subjectTbl: 'payRuns',
      subjectId: run.id,
      subjectNumber: '2026-09',
      status: 'pending',
      reason: 'September, with the two new guards.',
      requestedBy: 'user-accountant',
      requestedByName: 'Made-up Accountant',
    });
    // Totals by department and position: no names, no IBANs, no Civil IDs.
    const details = payrollDetails(request)!;
    expect(details).toMatchObject({
      runUpdatedAt: run.updatedAt,
      period: '2026-09',
      currency: 'KWD',
      totals: { employees: 3, gross: 1380, net: 1380 },
    });
    expect(details.groups.map((g) => [g.department, g.employees])).toEqual([
      ['Head Office', 1],
      ['Operations', 2],
    ]);
    const text = JSON.stringify(request);
    expect(text).not.toMatch(/Made-up Guard|Made-up Clerk|KW81|IBAN/i);
    // The activity of the pay run says so (private, as the pay run is).
    const logged = await db.activities.where('entityId').equals(run.id).toArray();
    expect(logged.map((a) => a.action)).toContain('approval:asked');

    await expect(requestPayrollApproval(run.id)).rejects.toThrow(/already waiting/);
    await expect(approvePayRun(run.id)).rejects.toThrow(/waiting for the Super Admin’s approval/);

    // The owner approves it (موافقة) on their own device.
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'approved', 'Fine.');
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'approved',
      decidedBy: 'user-owner',
      decisionNote: 'Fine.',
    });

    // Then the accountant approves (posts) it, and the request is done.
    await signedInAs(company, 'accountant');
    expect(
      payrollPostable(
        company,
        await db.syncState.get(company.id),
        run,
        await payrollRequests(run.id),
      ),
    ).toBe(true);
    const posted = await approvePayRun(run.id);
    expect(posted.status).toBe('approved');
    expect(posted.journalId).toBeTruthy();
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'applied',
      decidedBy: 'user-owner',
    });
    // Paid as before.
    const settings = await getPayrollSettings(company.id);
    await expect(
      payPayRun(run.id, { date: '2026-10-04', bankAccountId: settings.bankAccountId }),
    ).resolves.toMatchObject({ status: 'paid' });
  });

  it('asks for a new approval when the pay run changes after it was sent', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const first = await requestPayrollApproval(run.id);
    // An addition after sending: the request is for the earlier version.
    const edited = await updatePayLine(run.id, run.lines[0].id, {
      adjustments: [{ id: '', type: 'addition', amount: 15, note: 'Night shift' }],
    });
    expect(edited.updatedAt > run.updatedAt).toBe(true);
    expect(payrollApprovalState(edited, await payrollRequests(run.id))).toMatchObject({
      status: 'pending',
      current: false,
    });
    await expect(approvePayRun(run.id)).rejects.toThrow(/changed after it was sent/);

    // The owner can't approve the earlier version, nor store it approved (as the cloud refuses).
    await signedInAs(company, 'owner');
    await expect(decideApproval(first.id, 'approved')).rejects.toThrow(/isn’t as it was sent/);
    await expect(
      db.approvals.put({ ...first, status: 'approved', decidedBy: 'user-owner' }),
    ).rejects.toThrow(/changed after it was sent for approval/);
    await decideApproval(first.id, 'rejected', 'Send it again with the night shift.');

    // Rejected: still not postable; sent again, approved, posted.
    await signedInAs(company, 'accountant');
    await expect(approvePayRun(run.id)).rejects.toThrow(/changed after it was sent/);
    const second = await requestPayrollApproval(run.id);
    expect(payrollDetails(second)!.totals.gross).toBe(1395);
    await signedInAs(company, 'owner');
    await decideApproval(second.id, 'approved');
    // Changing the pay date after the approval asks again.
    await signedInAs(company, 'accountant');
    await updatePayRun(run.id, { payDate: '2026-10-05' });
    await expect(approvePayRun(run.id)).rejects.toThrow(/changed after it was sent/);
  });

  it('takes back a request for an earlier version when it is sent again', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const first = await requestPayrollApproval(run.id);
    await updatePayLine(run.id, run.lines[1].id, { absentDays: 1 });
    const second = await requestPayrollApproval(run.id);
    expect(await db.approvals.get(first.id)).toMatchObject({ status: 'cancelled' });
    expect(second.status).toBe('pending');
    // Someone else (not an approver) can't replace it.
    await updatePayLine(run.id, run.lines[1].id, { absentDays: 2 });
    await signedInAs(company, 'admin', { user: 'user-other' });
    await expect(requestPayrollApproval(run.id)).rejects.toThrow(/sent by someone else/);
  });

  it('turned down: says so, and posts once approved again', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const request = await requestPayrollApproval(run.id);
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'rejected', 'Wrong month.');
    await signedInAs(company, 'accountant');
    await expect(approvePayRun(run.id)).rejects.toThrow(/didn’t approve this pay run/);
    // Taking back only while it waits.
    const again = await requestPayrollApproval(run.id);
    await cancelApproval(again.id);
    expect(await db.approvals.get(again.id)).toMatchObject({ status: 'cancelled' });
    await expect(approvePayRun(run.id)).rejects.toThrow(/Send it for approval first/);
  });

  it('a member allowed to approve never approves a pay run they sent; the owner may', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'admin', { approver: true });
    const own = await requestPayrollApproval(run.id);
    await expect(decideApproval(own.id, 'approved')).rejects.toThrow(
      /Only the owner approves a pay run they sent/,
    );
    // The cloud would refuse it too, as this device does before writing.
    await expect(
      db.approvals.put({ ...own, status: 'approved', decidedBy: 'user-admin' }),
    ).rejects.toBeInstanceOf(CloudPermissionError);
    // Nor does their own posting count as approval.
    await expect(approvePayRun(run.id)).rejects.toThrow(/waiting for the Super Admin’s approval/);
    // Another approver may.
    await signedInAs(company, 'accountant', { approver: true });
    await decideApproval(own.id, 'approved');
    await signedInAs(company, 'admin', { approver: true });
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
    expect(await db.approvals.get(own.id)).toMatchObject({ status: 'applied' });

    // The owner approves a pay run they sent themselves.
    const october = await createPayRun(company.id, '2026-10');
    await signedInAs(company, 'owner');
    const mine = await requestPayrollApproval(october.id);
    await decideApproval(mine.id, 'approved');
    expect(await db.approvals.get(mine.id)).toMatchObject({ status: 'approved' });
  });

  it('the owner posts at once, and a request waiting for the run as it is is done with it', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'owner');
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
    expect(await db.approvals.count()).toBe(0);

    const october = await createPayRun(company.id, '2026-10');
    await signedInAs(company, 'accountant');
    const request = await requestPayrollApproval(october.id);
    await signedInAs(company, 'owner');
    await approvePayRun(october.id);
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'applied' });
  });

  it('reopened after posting: approved again only with a new approval', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const request = await requestPayrollApproval(run.id);
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'approved');
    await signedInAs(company, 'accountant');
    await approvePayRun(run.id);
    const reopened = await reopenPayRun(run.id);
    expect(reopened.status).toBe('draft');
    expect(payrollApprovalState(reopened, await payrollRequests(run.id))).toMatchObject({
      status: 'applied',
      current: false,
    });
    await expect(approvePayRun(run.id)).rejects.toThrow(/changed after it was sent/);
    expect((await fresh(run)).journalId).toBeNull();
  });

  it('staff and people the owner limited can’t send pay runs for approval', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    await db.syncState.update(company.id, { permissions: { apps: { people: 'view' } } });
    await expect(requestPayrollApproval(run.id)).rejects.toThrow(/can’t send pay runs/);
  });

  it('an approver the owner gave no access to People decides no pay run, on the device as in the cloud', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const request = await requestPayrollApproval(run.id);
    await signedInAs(company, 'admin', { approver: true, user: 'user-shut' });
    await db.syncState.update(company.id, { permissions: { apps: { people: 'none' } } });
    for (const decision of ['approved', 'rejected'] as const) {
      await expect(decideApproval(request.id, decision)).rejects.toThrow(
        /no access to Maham People/,
      );
    }
    expect(await db.approvals.get(request.id)).toMatchObject({ status: 'pending' });
  });

  it('sends only a pay run that can be posted as it is once approved', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    // Net pay below zero.
    await updatePayLine(run.id, run.lines[0].id, {
      adjustments: [{ id: '', type: 'deduction', amount: 5000, note: 'Made-up' }],
    });
    await expect(requestPayrollApproval(run.id)).rejects.toThrow(/below zero/);
    await updatePayLine(run.id, run.lines[0].id, { adjustments: [] });
    // Its pay date in the locked period.
    const current = (await db.companies.get(company.id))!;
    await saveCompany({
      ...current,
      accounting: { ...current.accounting!, lockDate: '2026-12-31' },
    });
    await expect(requestPayrollApproval(run.id)).rejects.toThrow(/books are locked/);
    expect(await payrollRequests(run.id)).toEqual([]);
    await saveCompany({ ...current, accounting: { ...current.accounting!, lockDate: null } });
    await expect(requestPayrollApproval(run.id)).resolves.toMatchObject({ status: 'pending' });
  });

  it('keeps an approval when the pay run is updated from records and nothing changed', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const request = await requestPayrollApproval(run.id);
    await signedInAs(company, 'owner');
    await decideApproval(request.id, 'approved');
    await signedInAs(company, 'accountant');
    const before = await fresh(run);
    const refreshed = await refreshPayRun(run.id);
    expect(refreshed.updatedAt).toBe(before.updatedAt);
    await expect(approvePayRun(run.id)).resolves.toMatchObject({ status: 'approved' });
  });

  it('cancels requests that waited longer than the rules allow', async () => {
    const { company, run } = await seed();
    await signedInAs(company, 'accountant');
    const request = await requestPayrollApproval(run.id);
    await signedInAs(company, 'owner');
    expect(await expirePending(company.id, '2026-12-31')).toBe(1);
    expect(await db.approvals.get(request.id)).toMatchObject({
      status: 'cancelled',
      expired: true,
    });
  });

  it('an approver the owner gave no access to People expires the other old requests, not the pay run’s', async () => {
    const { company, run } = await seed({ ...RULES, documentTypes: ['invoice'] });
    await signedInAs(company, 'accountant');
    const payroll = await requestPayrollApproval(run.id);
    // A request of Books waiting too, as pulled from the cloud.
    const books: ApprovalRequest = {
      id: 'made-up-books-request',
      companyId: company.id,
      kind: 'invoice_void',
      subjectTbl: 'documents',
      subjectId: 'made-up-invoice',
      subjectNumber: 'INV-0001',
      before: { status: 'sent' },
      after: { status: 'void', voidReason: 'Made-up' },
      reason: 'Made-up',
      status: 'pending',
      requestedBy: 'user-accountant',
      requestedAt: '2026-10-01T08:00:00.000Z',
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    };
    await db.approvals.put(books);
    await db.outbox.clear();
    await signedInAs(company, 'admin', { approver: true, user: 'user-shut' });
    await db.syncState.update(company.id, { permissions: { apps: { people: 'none' } } });
    // The cloud would refuse them the pay run's (no access to People): it is
    // left to those who decide it, and the other expires all the same.
    expect(await expirePending(company.id, '2026-12-31')).toBe(1);
    expect(await db.approvals.get(books.id)).toMatchObject({ status: 'cancelled', expired: true });
    expect(await db.approvals.get(payroll.id)).toMatchObject({ status: 'pending' });
    expect(await db.outbox.where('[table+id]').equals(['approvals', books.id]).count()).toBe(1);
    expect(await db.outbox.where('[table+id]').equals(['approvals', payroll.id]).count()).toBe(0);
    // An approver who sees payroll expires it.
    await signedInAs(company, 'owner');
    expect(await expirePending(company.id, '2026-12-31')).toBe(1);
    expect(await db.approvals.get(payroll.id)).toMatchObject({
      status: 'cancelled',
      expired: true,
    });
  });
});
