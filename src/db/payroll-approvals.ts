import { db } from './db';
import { nowStamp } from './defaults';
import {
  ApprovalError,
  approverOf,
  logRequest,
  payrollApprovalOn,
  rulesInEffect,
} from './approvals';
import type { ApprovalRequest, Company, ID, PayRun, Timestamp } from './types';
import { t } from '@/i18n';
import { newId } from '@/lib/ids';
import { currencyPrecision } from '@/lib/money';
import { payrollBreakdown, type PayDepartmentGroup, type PayGroupTotals } from '@/lib/hr/payroll';
import { canPostPayroll, isPayrollApproval } from '@/cloud/roles';
import type { CloudLink } from '@/cloud/types';

/**
 * Salary approval by the Super Admin (#10 of docs/requirements-plan.md),
 * through the approvals service (D6). With the owner's switch on
 * (Company.approvalRules.payroll, Settings → Approvals → Pay runs), a draft
 * pay run is sent for approval (إرسال للموافقة) as it stands; the owner, or a
 * member the owner allowed to approve who didn't send it, approves it
 * (موافقة); then it can be approved (posted, اعتماد) as before. Any change
 * to the run after it was sent asks for a new approval. The owner may post
 * at once: their posting is their approval. A company kept on this device
 * has nobody to ask, so nothing changes there.
 *
 * The request (an approvals row, private like the pay run) carries the
 * run's totals by department and position, never anyone's own pay. The
 * cloud keeps it honest (records_guard in 20261130000000_people_alerts.sql)
 * and emails the approvers those totals (src/alerts).
 */

/** What a request for a pay run's approval carries (ApprovalRequest.after). */
export interface PayrollApprovalDetails {
  /** The pay run's updatedAt when it was sent: approved only as it was then. */
  runUpdatedAt: Timestamp;
  period: string;
  currency: string;
  totals: PayGroupTotals;
  /** Totals by department and position, without names. */
  groups: PayDepartmentGroup[];
}

/** The details of a pay run's request, when it has them. */
export function payrollDetails(request: ApprovalRequest): PayrollApprovalDetails | null {
  const after = request.after as Partial<PayrollApprovalDetails> | null | undefined;
  if (!after || typeof after.runUpdatedAt !== 'string' || !after.totals) return null;
  return {
    runUpdatedAt: after.runUpdatedAt,
    period: typeof after.period === 'string' ? after.period : request.subjectNumber,
    currency: typeof after.currency === 'string' ? after.currency : '',
    totals: after.totals,
    groups: Array.isArray(after.groups) ? after.groups : [],
  };
}

/** Whether a request was made for the pay run as it is now. */
export function askedForRun(request: ApprovalRequest, run: Pick<PayRun, 'updatedAt'>): boolean {
  return payrollDetails(request)?.runUpdatedAt === run.updatedAt;
}

/** A pay run's requests, the latest first. */
export async function payrollRequests(runId: ID): Promise<ApprovalRequest[]> {
  const requests = await db.approvals.where('subjectId').equals(runId).toArray();
  return requests.filter(isPayrollApproval).sort(latestFirst);
}

export function latestFirst(a: ApprovalRequest, b: ApprovalRequest): number {
  return b.requestedAt.localeCompare(a.requestedAt) || b.createdAt.localeCompare(a.createdAt);
}

/** Where a pay run is with its approval, from its latest request. */
export type PayrollApprovalState =
  | { status: 'none' }
  | {
      status: ApprovalRequest['status'];
      request: ApprovalRequest;
      /** Made for the pay run as it is now (false: the run changed since). */
      current: boolean;
    };

export function payrollApprovalState(
  run: Pick<PayRun, 'updatedAt'>,
  requests: ApprovalRequest[],
): PayrollApprovalState {
  const mine = requests.filter(isPayrollApproval).sort(latestFirst);
  // An approval for the run as it is now counts, whatever came after it.
  const request =
    mine.find((r) => r.status === 'approved' && askedForRun(r, run)) ??
    mine.find((r) => r.status === 'pending') ??
    mine[0];
  if (!request) return { status: 'none' };
  return { status: request.status, request, current: askedForRun(request, run) };
}

/**
 * Whether this person may approve (post) the pay run now, as far as salary
 * approval goes: always while it is off; with it on, once a request for the
 * run as it is now was approved, and at once for the owner.
 */
export function payrollPostable(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
  run: Pick<PayRun, 'updatedAt'>,
  requests: ApprovalRequest[],
): boolean {
  if (!payrollApprovalOn(company, link)) return true;
  if (link?.role === 'owner') return true;
  return requests.some((r) => r.status === 'approved' && askedForRun(r, run));
}

/**
 * What posting the pay run needs from salary approval (see payrollPostable):
 * the request to mark done once it is posted (an approved one, or the
 * owner's waiting one, which the owner approves by posting), or a refusal
 * that says what to do.
 */
export function payrollGate(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
  run: Pick<PayRun, 'updatedAt'>,
  requests: ApprovalRequest[],
): { done: ApprovalRequest | null } {
  if (!payrollApprovalOn(company, link)) return { done: null };
  const mine = requests.filter(isPayrollApproval).sort(latestFirst);
  const approved = mine.find((r) => r.status === 'approved' && askedForRun(r, run));
  if (approved) return { done: approved };
  if (link?.role === 'owner') {
    return { done: mine.find((r) => r.status === 'pending' && askedForRun(r, run)) ?? null };
  }
  throw new ApprovalError(payrollWaitText(payrollApprovalState(run, mine)));
}

/** Why a pay run can't be approved (posted) yet, for someone other than the owner. */
export function payrollWaitText(state: PayrollApprovalState): string {
  if (state.status === 'none' || state.status === 'cancelled') {
    return t(
      'This pay run needs the Super Admin’s approval before it is approved. Send it for approval first.',
    );
  }
  if (!state.current) {
    return t('This pay run changed after it was sent for approval. Send it for approval again.');
  }
  if (state.status === 'pending')
    return t('This pay run is waiting for the Super Admin’s approval.');
  if (state.status === 'rejected') {
    return t(
      'The Super Admin didn’t approve this pay run. Change it if needed and send it for approval again.',
    );
  }
  return t('This pay run changed after it was sent for approval. Send it for approval again.');
}

/** What a pay run's request carries: its totals by department and position, as it is now. */
export function payrollRequestDetails(run: PayRun, currency: string): PayrollApprovalDetails {
  const { totals, departments } = payrollBreakdown(run.lines, currencyPrecision(currency));
  return {
    runUpdatedAt: run.updatedAt,
    period: run.period,
    currency,
    totals,
    groups: departments,
  };
}

/**
 * Sends a draft pay run for the Super Admin's approval, as it stands, with
 * an optional note: only one that could be posted as it is once approved
 * (the checks of approvePayRun), so an approval is never given for a run
 * that must change before it is posted. A request still waiting for an
 * earlier version of the run is taken back first (by whoever sent it, or an
 * approver). Returns the request.
 */
export async function requestPayrollApproval(
  runId: ID,
  input: { note?: string; byName?: string } = {},
): Promise<ApprovalRequest> {
  // Imported here: payroll.ts uses this module when it posts a run.
  const { assertPayRunPostable } = await import('./payroll');
  await assertPayRunPostable(runId);
  return db.transaction(
    'rw',
    [db.approvals, db.payRuns, db.companies, db.syncState, db.activities],
    async () => {
      const run = await db.payRuns.get(runId);
      if (!run) throw new ApprovalError(t('This pay run could not be found.'));
      if (run.status !== 'draft') {
        throw new ApprovalError(t('Only a draft pay run is sent for approval.'));
      }
      if (run.lines.length === 0) throw new ApprovalError(t('This pay run has no employees.'));
      const [company, link] = await Promise.all([
        db.companies.get(run.companyId),
        db.syncState.get(run.companyId),
      ]);
      if (!company || !link || !payrollApprovalOn(company, link)) {
        throw new ApprovalError(t('Salary approval is off for this company.'));
      }
      if (!canPostPayroll(link.role, link.permissions)) {
        throw new ApprovalError(t('Your role can’t send pay runs for approval.'));
      }
      const requests = await payrollRequests(run.id);
      if (requests.some((r) => r.status === 'approved' && askedForRun(r, run))) {
        throw new ApprovalError(t('This pay run is already approved. You can approve it now.'));
      }
      const now = nowStamp();
      for (const waiting of requests.filter((r) => r.status === 'pending')) {
        if (askedForRun(waiting, run)) {
          throw new ApprovalError(
            t('This pay run is already waiting for the Super Admin’s approval.'),
          );
        }
        // Sent for an earlier version of the run: taken back.
        if (waiting.requestedBy !== link.userId && !approverOf(link)) {
          throw new ApprovalError(
            t(
              'An earlier version of this pay run is still waiting, sent by someone else. Ask them or an approver to take it back.',
            ),
          );
        }
        await db.approvals.put({
          ...waiting,
          status: 'cancelled',
          decidedBy: link.userId,
          decidedAt: now,
          updatedAt: now,
        });
        await logRequest(waiting, 'cancelled');
      }
      const note = (input.note ?? '').trim().slice(0, 1000);
      const request: ApprovalRequest = {
        id: newId(),
        companyId: run.companyId,
        kind: 'payroll',
        subjectTbl: 'payRuns',
        subjectId: run.id,
        subjectNumber: run.period,
        before: null,
        after: payrollRequestDetails(run, company.currency) as unknown as Record<string, unknown>,
        reason: note,
        status: 'pending',
        // The cloud stamps both with its own.
        requestedBy: link.userId,
        ...(input.byName?.trim() ? { requestedByName: input.byName.trim().slice(0, 200) } : {}),
        requestedAt: now,
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
        createdAt: now,
        updatedAt: now,
      };
      await db.approvals.add(request);
      await logRequest(request, 'asked');
      return request;
    },
  );
}

/**
 * Marks a pay run's request done once the run is posted (see payrollGate),
 * on its own: the posting stands whatever becomes of the mark (a request
 * decided otherwise on another device meanwhile stays as the cloud keeps it).
 */
export async function markPayrollApplied(requestId: ID): Promise<void> {
  try {
    await db.transaction('rw', [db.approvals, db.companies, db.syncState], async () => {
      const request = await db.approvals.get(requestId);
      if (!request || (request.status !== 'approved' && request.status !== 'pending')) return;
      const link = await db.syncState.get(request.companyId);
      const company = await db.companies.get(request.companyId);
      // Only the owner carries out a waiting request by posting.
      if (request.status === 'pending' && link?.role !== 'owner') return;
      if (!rulesInEffect(company, link)) return;
      const now = nowStamp();
      await db.approvals.put({
        ...request,
        status: 'applied',
        // The owner approved it by posting: the cloud stamps the decision.
        ...(request.status === 'pending'
          ? { decidedBy: link?.userId ?? null, decidedAt: now }
          : {}),
        updatedAt: now,
      });
    });
  } catch {
    // The pay run is posted; the request shows as approved.
  }
}
