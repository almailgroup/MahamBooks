import { describe, expect, it } from 'vitest';
import {
  canPostPayroll,
  guardApprovalWrite,
  isPayrollApproval,
  payrollDecisionRefusal,
  rulesCoverPayroll,
} from './roles';

/**
 * The device's copy of the salary approval rules of records_guard
 * (20261130000000_people_alerts.sql, #10), so a refusal is instant offline.
 * people-alerts-sql.test.ts checks the server answers the same.
 */

const NOW = '2026-10-22T08:00:00.000Z';
const asked = {
  id: 'req-1',
  kind: 'payroll',
  subjectTbl: 'payRuns',
  subjectId: 'run-1',
  status: 'pending',
  requestedBy: 'deputy',
  after: { runUpdatedAt: '2026-10-20T08:00:00.000Z' },
};
const run = { id: 'run-1', updatedAt: '2026-10-20T08:00:00.000Z' };

describe('salary approval on the device', () => {
  it('knows the switch and the requests', () => {
    expect(rulesCoverPayroll({ payroll: true })).toBe(true);
    expect(rulesCoverPayroll({ documentTypes: ['invoice'] })).toBe(false);
    expect(rulesCoverPayroll(null)).toBe(false);
    expect(isPayrollApproval(asked)).toBe(true);
    expect(isPayrollApproval({ ...asked, subjectTbl: 'documents' })).toBe(false);
  });

  it('lets owners, admins and accountants post pay runs, unless the owner limited People', () => {
    expect(canPostPayroll('owner', undefined)).toBe(true);
    expect(canPostPayroll('accountant', undefined)).toBe(true);
    expect(canPostPayroll('accountant', { apps: { people: 'view' } })).toBe(false);
    expect(canPostPayroll('admin', { apps: { books: 'view' } })).toBe(true);
    expect(canPostPayroll('staff', undefined)).toBe(false);
    expect(canPostPayroll('viewer', undefined)).toBe(false);
    expect(canPostPayroll(null, undefined)).toBe(true);
  });

  it('refuses a deputy’s own approval and approving a changed pay run', () => {
    const approve = { ...asked, status: 'approved' };
    expect(payrollDecisionRefusal(asked, approve, { userId: 'deputy', owner: false }, run)).toBe(
      'self',
    );
    expect(payrollDecisionRefusal(asked, approve, { userId: 'boss', owner: true }, run)).toBeNull();
    expect(
      payrollDecisionRefusal(
        { ...asked, requestedBy: 'boss' },
        approve,
        { userId: 'boss', owner: true },
        run,
      ),
    ).toBeNull();
    const changed = { ...run, updatedAt: '2026-10-21T08:00:00.000Z' };
    expect(payrollDecisionRefusal(asked, approve, { userId: 'boss', owner: true }, changed)).toBe(
      'stale',
    );
    expect(payrollDecisionRefusal(asked, approve, { userId: 'boss', owner: true }, undefined)).toBe(
      'stale',
    );
    // The owner posting carries a waiting request out as it is.
    const applied = { ...asked, status: 'applied' };
    expect(
      payrollDecisionRefusal(asked, applied, { userId: 'boss', owner: true }, changed),
    ).toBeNull();
    expect(payrollDecisionRefusal(asked, applied, { userId: 'other', owner: false }, changed)).toBe(
      'stale',
    );
    // Turning it down, or a decision made before, is not looked at.
    const reject = { ...asked, status: 'rejected' };
    expect(
      payrollDecisionRefusal(asked, reject, { userId: 'deputy', owner: false }, changed),
    ).toBeNull();
    expect(
      payrollDecisionRefusal(
        { ...asked, status: 'approved' },
        applied,
        { userId: 'accountant', owner: false },
        changed,
      ),
    ).toBeNull();
  });

  it('lets no member the owner gave no access to People decide, but whoever asked take it back', () => {
    const shut = { userId: 'shut', owner: false, peopleShut: true };
    for (const status of ['approved', 'rejected', 'cancelled', 'applied']) {
      expect(payrollDecisionRefusal(asked, { ...asked, status }, shut, run)).toBe('people');
    }
    // Their own, taken back while it waits.
    expect(
      payrollDecisionRefusal(
        { ...asked, requestedBy: 'shut' },
        { ...asked, requestedBy: 'shut', status: 'cancelled' },
        shut,
        run,
      ),
    ).toBeNull();
    // No decision (an older copy sent again), or one made before: not looked at.
    expect(payrollDecisionRefusal(asked, { ...asked }, shut, run)).toBeNull();
    const rejected = { ...asked, status: 'rejected' };
    expect(payrollDecisionRefusal(rejected, { ...rejected, status: 'approved' }, shut, run)).toBe(
      null,
    );
    // The owner is never shut out; nor anyone with People.
    expect(
      payrollDecisionRefusal(
        asked,
        { ...asked, status: 'approved' },
        { ...shut, owner: true },
        run,
      ),
    ).toBeNull();
    expect(
      payrollDecisionRefusal(
        asked,
        { ...asked, status: 'approved' },
        { ...shut, peopleShut: false },
        run,
      ),
    ).toBeNull();
  });

  it('keeps a deputy’s request sent up approved waiting, and lets whoever posts mark it done', () => {
    const who = { userId: 'deputy', approver: true, owner: false, now: NOW };
    const sentApproved = guardApprovalWrite(undefined, { ...asked, status: 'approved' }, who, {
      on: true,
      poster: true,
    });
    expect(sentApproved).toMatchObject({ data: { status: 'pending', requestedBy: 'deputy' } });
    // Off: as before (asked and decided by them).
    expect(
      guardApprovalWrite(undefined, { ...asked, status: 'approved' }, who, {
        on: false,
        poster: true,
      }),
    ).toMatchObject({ data: { status: 'approved', decidedBy: 'deputy' } });

    const approved = { ...asked, status: 'approved', decidedBy: 'boss', decidedAt: NOW };
    const accountant = { userId: 'accountant', approver: false, owner: false, now: NOW };
    const done = { ...approved, status: 'applied', decidedBy: 'accountant' };
    expect(
      guardApprovalWrite(approved, done, accountant, { on: true, poster: true }),
    ).toMatchObject({ data: { status: 'applied', decidedBy: 'boss' } });
    expect(guardApprovalWrite(approved, done, accountant, { on: true, poster: false })).toEqual({
      refused: 'permission',
    });
    expect(guardApprovalWrite(approved, done, accountant, { on: false, poster: true })).toEqual({
      refused: 'permission',
    });
    expect(guardApprovalWrite(approved, done, accountant)).toEqual({ refused: 'permission' });
  });
});
