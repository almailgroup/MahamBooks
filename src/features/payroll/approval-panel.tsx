import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, ChevronUp, Send, ShieldCheck, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { approverOf, cancelApproval, payrollApprovalOn } from '@/db/approvals';
import {
  askedForRun,
  payrollApprovalState,
  payrollDetails,
  payrollPostable,
  requestPayrollApproval,
  type PayrollApprovalState,
} from '@/db/payroll-approvals';
import type { ApprovalRequest, Company, PayRun } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { canPostPayroll, isPayrollApproval } from '@/cloud/roles';
import { useCloudLink } from '@/cloud/hooks';
import { useCloud } from '@/cloud/store';
import type { CloudLink } from '@/cloud/types';
import { departmentLabel } from '@/lib/hr/departments';
import { formatPeriod, type PayDepartmentGroup, type PayGroupTotals } from '@/lib/hr/payroll';
import { cn } from '@/lib/cn';
import { usePeopleSettings } from '@/features/people/hooks';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { msg, t } from '@/i18n';
import { Badge } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { decideAndSend } from '@/features/approvals/decide';
import { useMemberNames, useMyName } from '@/features/approvals/hooks';
import { ReasonDialog } from '@/features/approvals/reason-dialog';
import type { StatusTone } from '@/lib/status';
import { lookup } from '@/lib/known';

/**
 * Salary approval by the Super Admin (#10) in the app: where a pay run is
 * with its approval (on the pay run), and what the Approvals page shows for
 * a pay run's request, with the totals by department and position and, on
 * this device only, each employee's pay. The Super Admin's decision is a
 * موافقة; approving the pay run (posting it) stays اعتماد.
 */

/** A pay run request's state in words (English keys). */
const STATUS: Record<ApprovalRequest['status'], { label: string; tone: StatusTone }> = {
  pending: { label: msg('Waiting for the Super Admin'), tone: 'amber' },
  approved: { label: msg('Approval given'), tone: 'blue' },
  rejected: { label: msg('Not approved'), tone: 'red' },
  cancelled: { label: msg('Taken back'), tone: 'gray' },
  applied: { label: msg('Approval given, pay run approved'), tone: 'green' },
};

export function payrollStatusMeta(status: string): { label: string; tone: StatusTone } {
  return lookup(STATUS, status, { label: msg('Approval request'), tone: 'gray' });
}

function nameOf(id: string | null, names: Map<string, string>, kept?: string): string {
  if (!id) return kept || t('A team member');
  return names.get(id) || kept || t('A team member');
}

/** Where salary approval stands for a pay run, for the person on this device. */
export interface PayrollApprovalView {
  /** Salary approval is on (a cloud company, the switch on, the server has it). */
  on: boolean;
  link: CloudLink | null | undefined;
  requests: ApprovalRequest[];
  state: PayrollApprovalState;
  /** The person may approve (post) the pay run now, as far as salary approval goes. */
  postable: boolean;
  /** The person decides requests (the owner, or a member allowed to approve). */
  approver: boolean;
  /** The person may send the pay run for approval. */
  canSend: boolean;
}

export function usePayrollApproval(run: PayRun | null | undefined): PayrollApprovalView {
  const company = useCompany();
  const link = useCloudLink(company.id);
  const requests =
    useLiveQuery(
      async () =>
        run
          ? (await db.approvals.where('subjectId').equals(run.id).toArray()).filter(
              isPayrollApproval,
            )
          : [],
      [run?.id],
    ) ?? [];
  const on = link !== undefined && payrollApprovalOn(company, link);
  return {
    on,
    link,
    requests,
    state: run ? payrollApprovalState(run, requests) : { status: 'none' },
    postable: !run || link === undefined || payrollPostable(company, link, run, requests),
    approver: link !== undefined && approverOf(link),
    canSend: Boolean(link) && canPostPayroll(link?.role, link?.permissions),
  };
}

/** Runs a decision or a request with its toasts. */
function useAct() {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      const outcome = await work();
      toast.success(
        outcome === 'waiting' ? t('Decided. It reaches the cloud once this device syncs.') : done,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      throw error;
    } finally {
      setBusy(null);
    }
  };
  return { busy, act };
}

/** What the person may do with a pay run's request: decide it, or take it back. */
function DecisionButtons({
  request,
  view,
  current,
}: {
  request: ApprovalRequest;
  view: Pick<PayrollApprovalView, 'approver' | 'link'>;
  /** Made for the pay run as it is now. */
  current: boolean;
}) {
  const { manager } = useCloud();
  const fmt = useFormat();
  const { busy, act } = useAct();
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const month = /^\d{4}-\d{2}$/.test(request.subjectNumber)
    ? formatPeriod(request.subjectNumber, fmt.locale)
    : request.subjectNumber;
  const userId = view.link?.userId ?? null;
  const mine = userId !== null && request.requestedBy === userId;
  // A member allowed to approve never approves what they sent; the owner may.
  const mayApprove = view.approver && (!mine || view.link?.role === 'owner') && current;
  if (request.status !== 'pending') return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {mayApprove ? (
          <Button size="sm" disabled={busy !== null} onClick={() => setDeciding('approved')}>
            <Check /> {t('Give approval')}
          </Button>
        ) : null}
        {view.approver ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => setDeciding('rejected')}
          >
            <X /> {t('Reject')}
          </Button>
        ) : null}
        {mine ? (
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'cancel'}
            disabled={busy !== null}
            onClick={() =>
              void act('cancel', () => cancelApproval(request.id), t('Request taken back')).catch(
                () => undefined,
              )
            }
          >
            <Undo2 /> {t('Take back')}
          </Button>
        ) : null}
      </div>
      {view.approver && mine && view.link?.role !== 'owner' ? (
        <p className="text-xs text-slate-500">
          {t('You sent it, so the owner or another member allowed to approve decides it.')}
        </p>
      ) : null}
      {deciding ? (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setDeciding(null)}
          title={
            deciding === 'approved'
              ? t('Give approval to the payroll for {month}?', { month })
              : t('Don’t approve the payroll for {month}?', { month })
          }
          description={
            deciding === 'approved'
              ? t(
                  'It can then be approved (posted to the books) and paid as it stands. Any change to it asks for a new approval.',
                )
              : t('The pay run stays a draft. Whoever sent it sees why.')
          }
          label={t('Note for whoever asked')}
          required={false}
          confirmLabel={deciding === 'approved' ? t('Give approval') : t('Reject')}
          danger={deciding === 'rejected'}
          onConfirm={(note) =>
            act(
              deciding,
              () => decideAndSend(request.id, deciding, manager, note),
              deciding === 'approved' ? t('Approval given') : t('Rejected'),
            )
          }
        />
      ) : null}
    </>
  );
}

/** A pay run's totals and its totals by department and position. */
export function PayrollTotals({
  totals,
  groups,
  currency,
}: {
  totals: PayGroupTotals;
  groups: PayDepartmentGroup[];
  currency: string;
}) {
  const fmt = useFormat();
  const people = usePeopleSettings();
  const { language } = useLanguage();
  const money = (n: number) => fmt.money(n, currency || undefined);
  const department = (name: string | null) =>
    name === null
      ? t('Other departments')
      : name === ''
        ? t('No department')
        : departmentLabel(people?.departments, name, language);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {(
          [
            [t('Employees'), String(totals.employees)],
            [t('Gross pay'), money(totals.gross)],
            [t('Deductions'), money(totals.deductions)],
            [t('Net pay'), money(totals.net)],
            [t('Employer PIFSS'), money(totals.pifssEmployer)],
            [t('Cost to the company'), money(totals.cost)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-slate-100 py-1">
            <dt className="text-slate-500">{label}</dt>
            <dd className="tabular font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      {groups.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 pe-3 text-start font-medium">{t('Department and position')}</th>
                <th className="py-1 pe-3 text-end font-medium">{t('Employees')}</th>
                <th className="py-1 pe-3 text-end font-medium">{t('Gross pay')}</th>
                <th className="py-1 text-end font-medium">{t('Net pay')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.flatMap((d) => [
                <tr key={`d:${d.department}`} className="font-medium text-slate-900">
                  <td className="py-1.5 pe-3" dir="auto">
                    {department(d.department)}
                  </td>
                  <td className="tabular py-1.5 pe-3 text-end">{d.employees}</td>
                  <td className="tabular py-1.5 pe-3 text-end">{money(d.gross)}</td>
                  <td className="tabular py-1.5 text-end">{money(d.net)}</td>
                </tr>,
                ...d.positions.map((p) => (
                  <tr key={`p:${d.department}:${p.jobTitle}`} className="text-slate-600">
                    <td className="py-1 ps-4 pe-3" dir="auto">
                      {p.jobTitle === null
                        ? t('Other positions')
                        : p.jobTitle === ''
                          ? t('No job title')
                          : (language === 'ar' && p.jobTitleAr) || p.jobTitle}
                    </td>
                    <td className="tabular py-1 pe-3 text-end">{p.employees}</td>
                    <td className="tabular py-1 pe-3 text-end">{money(p.gross)}</td>
                    <td className="tabular py-1 text-end">{money(p.net)}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Each employee's pay, from the pay run on this device (never emailed). */
function EmployeesOfRun({ run }: { run: PayRun }) {
  const fmt = useFormat();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="py-1 pe-3 text-start font-medium">{t('Employee')}</th>
            <th className="py-1 pe-3 text-end font-medium">{t('Gross pay')}</th>
            <th className="py-1 text-end font-medium">{t('Net pay')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {run.lines.map((l) => (
            <tr key={l.id}>
              <td className="py-1 pe-3 text-slate-900">{localName(l)}</td>
              <td className="tabular py-1 pe-3 text-end">{fmt.money(l.gross)}</td>
              <td className="tabular py-1 text-end">{fmt.money(l.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * On a pay run, with salary approval on: whether it needs, waits for or has
 * the Super Admin's approval, with what the person may do about it.
 */
export function PayrollApprovalStrip({ run, view }: { run: PayRun; view: PayrollApprovalView }) {
  const fmt = useFormat();
  const company = useCompany();
  const myName = useMyName();
  const names = useMemberNames(company.id, view.link, view.requests.length > 0);
  const [asking, setAsking] = useState(false);
  const { busy, act } = useAct();
  const { state } = view;
  const owner = view.link?.role === 'owner';
  const draft = run.status === 'draft';
  const request = state.status === 'none' ? null : state.request;
  // Off (requests made meanwhile stay on the Approvals page), or posted with nothing to tell.
  if (
    !view.on ||
    (!draft && (!request || request.status === 'cancelled' || request.status === 'rejected'))
  ) {
    return null;
  }
  const current = state.status !== 'none' && state.current;
  const status = request ? payrollStatusMeta(request.status) : null;

  let text: string;
  if (!request || request.status === 'cancelled') {
    text = owner
      ? t('As the owner you approve pay runs: approving it posts it at once.')
      : t('This pay run needs the Super Admin’s approval before it is approved.');
  } else if (request.status === 'applied') {
    // Posting changes the pay run; back to draft (reopened) it needs a new approval.
    text = !draft
      ? t('Approved by the Super Admin, and posted.')
      : t('This pay run changed after it was approved. It needs a new approval.');
  } else if (!current) {
    text = t('This pay run changed after it was sent for approval. Send it again.');
  } else if (request.status === 'pending') {
    text = t('Sent for the Super Admin’s approval. It can be approved once approval is given.');
  } else if (request.status === 'approved') {
    text = draft
      ? t('The Super Admin approved it. You can approve (post) the pay run now.')
      : t('Approved by the Super Admin.');
  } else {
    text = t('The Super Admin didn’t approve this pay run. Change it if needed and send it again.');
  }
  // Sent again: when none waits for the run as it is, and it isn't approved as it is.
  const canAsk =
    view.on &&
    draft &&
    view.canSend &&
    !owner &&
    !(request && current && (request.status === 'pending' || request.status === 'approved'));

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3',
        request?.status === 'rejected' || (request && !current && draft)
          ? 'border-red-200 bg-red-50/50'
          : request &&
              ((current && request.status === 'approved') ||
                (!draft && request.status === 'applied'))
            ? 'border-emerald-200 bg-emerald-50/50'
            : 'border-amber-200 bg-amber-50/50',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
            <ShieldCheck className="size-4 text-slate-500" aria-hidden />
            {t('Salary approval')}
            {status ? <Badge tone={status.tone}>{t(status.label)}</Badge> : null}
          </p>
          <p className="text-sm text-slate-700">{text}</p>
          {request ? (
            <p className="text-xs text-slate-500">
              {t('Asked by {name} · {date}', {
                name: nameOf(request.requestedBy, names, request.requestedByName),
                date: fmt.dateTime(request.requestedAt),
              })}
              {request.decidedAt && request.status !== 'pending' ? (
                <>
                  {' · '}
                  {t('{status} by {name} · {date}', {
                    status: t(payrollStatusMeta(request.status).label),
                    name: nameOf(request.decidedBy, names),
                    date: fmt.dateTime(request.decidedAt),
                  })}
                </>
              ) : null}
            </p>
          ) : null}
          {request?.reason ? (
            <p dir="auto" className="text-sm whitespace-pre-line text-slate-600">
              {request.reason}
            </p>
          ) : null}
          {request?.decisionNote && request.status !== 'pending' ? (
            <p dir="auto" className="text-sm whitespace-pre-line text-slate-600">
              {request.decisionNote}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {canAsk ? (
            <Button size="sm" onClick={() => setAsking(true)} loading={busy === 'ask'}>
              <Send /> {request ? t('Ask for approval again') : t('Ask for approval')}
            </Button>
          ) : null}
          {request ? <DecisionButtons request={request} view={view} current={current} /> : null}
        </div>
      </div>
      {asking ? (
        <ReasonDialog
          open
          onOpenChange={setAsking}
          title={t('Ask the Super Admin to approve the payroll for {month}?', {
            month: formatPeriod(run.period, fmt.locale),
          })}
          description={t(
            'The owner and the members allowed to approve get its totals by department and position by email, and see each employee’s pay here. Any change to the pay run after this asks for a new approval.',
          )}
          label={t('Note for the Super Admin')}
          required={false}
          confirmLabel={t('Ask for approval')}
          onConfirm={(note) =>
            act(
              'ask',
              () => requestPayrollApproval(run.id, { note, byName: myName }),
              t('Sent for the Super Admin’s approval'),
            )
          }
        />
      ) : null}
    </div>
  );
}

/** A pay run's request on the Approvals page: its totals, and each employee's pay here only. */
export function PayrollRequestCard({
  request,
  names,
  approver,
  link,
  showSubject = false,
}: {
  request: ApprovalRequest;
  names: Map<string, string>;
  approver: boolean;
  link: CloudLink | null | undefined;
  showSubject?: boolean;
}) {
  const fmt = useFormat();
  const company: Company = useCompany();
  const run = useLiveQuery(() => db.payRuns.get(request.subjectId), [request.subjectId]);
  const [open, setOpen] = useState(false);
  const details = payrollDetails(request);
  const meta = payrollStatusMeta(request.status);
  const current = run ? askedForRun(request, run) : true;
  const month = /^\d{4}-\d{2}$/.test(request.subjectNumber)
    ? formatPeriod(request.subjectNumber, fmt.locale)
    : request.subjectNumber;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{t('Pay run')}</span>
        {showSubject ? (
          run ? (
            <Link
              to={`/payroll/runs/${run.id}`}
              className="text-primary-700 text-sm font-medium hover:underline"
            >
              {t('Payroll for {month}', { month })}
            </Link>
          ) : (
            <span className="text-sm text-slate-600">{t('Payroll for {month}', { month })}</span>
          )
        ) : null}
        <Badge tone={meta.tone}>{t(meta.label)}</Badge>
        {request.expired ? <Badge tone="gray">{t('Expired')}</Badge> : null}
      </div>
      <p className="text-xs text-slate-500">
        {t('Asked by {name} · {date}', {
          name: nameOf(request.requestedBy, names, request.requestedByName),
          date: fmt.dateTime(request.requestedAt),
        })}
      </p>
      {request.reason ? (
        <p
          dir="auto"
          className="rounded-md bg-slate-50 px-3 py-2 text-sm whitespace-pre-line text-slate-700"
        >
          {request.reason}
        </p>
      ) : null}
      {details ? (
        <PayrollTotals
          totals={details.totals}
          groups={details.groups}
          currency={details.currency || company.currency}
        />
      ) : null}
      {request.status === 'pending' && run && !current ? (
        <p className="text-xs text-amber-700">
          {t(
            'The pay run on this device isn’t as it was sent for approval. Let the device sync; if it still differs, the pay run changed since: reject this request, and it can be sent again.',
          )}
        </p>
      ) : null}
      {request.decidedAt && request.status !== 'pending' ? (
        <p className="text-xs text-slate-500">
          {t('{status} by {name} · {date}', {
            status: t(meta.label),
            name: nameOf(request.decidedBy, names),
            date: fmt.dateTime(request.decidedAt),
          })}
          {request.decisionNote ? (
            <>
              {' · '}
              <bdi dir="auto">{request.decisionNote}</bdi>
            </>
          ) : null}
        </p>
      ) : null}
      {run && run.lines.length > 0 ? (
        <div>
          <button
            type="button"
            className="text-primary-700 inline-flex items-center gap-1 text-sm font-medium hover:underline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            {open ? t('Hide each employee’s pay') : t('Show each employee’s pay')}
          </button>
          {open ? (
            <div className="mt-2">
              <EmployeesOfRun run={run} />
            </div>
          ) : null}
        </div>
      ) : null}
      <DecisionButtons request={request} view={{ approver, link }} current={current} />
    </div>
  );
}
