import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, RotateCcw, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { cancelApproval, decideApproval } from '@/db/approvals';
import { cashedChequeChanged } from '@/db/cheque-approvals';
import type { ApprovalRequest, Client } from '@/db/types';
import { useFormat } from '@/app/company';
import { bankName } from '@/lib/cheques';
import { isISODate } from '@/lib/dates';
import { localName } from '@/i18n/names';
import { currentLanguage, t, tp } from '@/i18n';
import { Badge } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { AttachmentList } from '@/features/purchases/attachments';
import {
  chequeFieldChanges,
  chequeStatusMeta,
  chequeSummary,
  type ChequeFieldChange,
} from './cheque-changes';
import { useCloud } from '@/cloud/store';
import { approve, carryOut } from './decide';
import { useDecisionUnsent } from './hooks';
import { kindLabel } from './labels';
import { ReasonDialog } from './reason-dialog';

function nameOf(id: string | null, names: Map<string, string>, kept?: string): string {
  if (!id) return kept || t('A team member');
  return names.get(id) || kept || t('A team member');
}

/** Where a cheque request's cheque is (or will be) in the app. */
function subjectLink(request: ApprovalRequest): string | null {
  const summary = chequeSummary(request);
  if (request.status === 'applied' && request.resultId && request.subjectTbl === 'payments') {
    return `${summary?.direction === 'out' ? '/payments-made' : '/payments'}/${request.resultId}`;
  }
  if (request.subjectTbl === 'payments' && request.kind !== 'cheque_create') {
    return `${summary?.direction === 'out' ? '/payments-made' : '/payments'}/${request.subjectId}`;
  }
  const tab =
    request.subjectTbl === 'securityCheques'
      ? 'security'
      : summary?.direction === 'out'
        ? 'issued'
        : 'received';
  return `/cheques?tab=${tab}&filter=${request.status === 'pending' ? 'pending' : 'all'}`;
}

function Value({
  change,
  side,
  clients,
  currency,
}: {
  change: ChequeFieldChange;
  side: 'before' | 'after';
  clients: Map<string, Client>;
  currency: string;
}) {
  const fmt = useFormat();
  const value = change[side];
  if (value === undefined || value === null || value === '') {
    return <span className="text-slate-400">—</span>;
  }
  if (change.field === 'clientId' && typeof value === 'string') {
    const client = clients.get(value);
    return <bdi>{client ? localName(client) : t('Another contact')}</bdi>;
  }
  // A Civil ID stays on the cheque: the request only says it changed.
  if (change.field.endsWith('drawerCivilId')) return <span>{t('Changed')}</span>;
  if (change.field === 'allocations' && Array.isArray(value)) {
    return <span>{tp(value.length, '{count} document', '{count} documents')}</span>;
  }
  if ((change.field === 'amount' || change.field === 'fee') && typeof value === 'number') {
    return <span className="tabular">{fmt.money(value, currency)}</span>;
  }
  if (change.field.endsWith('bank') && typeof value === 'string') {
    return <bdi>{bankName(value, currentLanguage())}</bdi>;
  }
  if (typeof value === 'string' && isISODate(value)) return <span>{fmt.date(value)}</span>;
  if (typeof value === 'string' || typeof value === 'number') {
    return (
      <bdi className="break-words whitespace-pre-line" dir="auto">
        {String(value)}
      </bdi>
    );
  }
  return <span>{t('Changed')}</span>;
}

/**
 * One cheque request (#9): the cheque it would record or change, by whom and
 * why, the decision, and what the person may do with it: confirm or reject
 * (approvers), take it back (whoever asked), carry it out again.
 */
export function ChequeRequestCard({
  request,
  clients,
  names,
  approver,
  userId,
  showSubject = false,
  extra,
}: {
  request: ApprovalRequest;
  clients: Map<string, Client>;
  names: Map<string, string>;
  approver: boolean;
  /** The person's account in the cloud. */
  userId: string | null;
  /** Links to the cheque (in the inbox). */
  showSubject?: boolean;
  extra?: ReactNode;
}) {
  const fmt = useFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const meta = chequeStatusMeta(request.status);
  const summary = chequeSummary(request);
  const changes = chequeFieldChanges(request);
  const pending = request.status === 'pending';
  const mine = userId !== null && request.requestedBy === userId;
  const language = currentLanguage();
  const client = summary?.clientId ? clients.get(summary.clientId) : undefined;
  const link = showSubject ? subjectLink(request) : null;
  // The scans attached to a new cheque, for the approver to see.
  const files = useLiveQuery(
    () =>
      request.kind === 'cheque_create' && request.subjectTbl === 'payments'
        ? db.attachments.where('ownerId').equals(request.subjectId).toArray()
        : [],
    [request.kind, request.subjectTbl, request.subjectId],
  );

  // The security cheque to cash as it is now: changed since it was asked,
  // it can't be confirmed (the approver would confirm what isn't asked).
  const cashing = useLiveQuery(
    () =>
      request.kind === 'security_cheque_cash' &&
      (request.status === 'pending' || request.status === 'approved')
        ? db.securityCheques.get(request.subjectId)
        : undefined,
    [request.kind, request.status, request.subjectId],
  );
  const changedSince = cashing ? cashedChequeChanged(request, cashing) : false;

  const { manager } = useCloud();
  // Confirmed here, and not in the cloud yet: recorded once it is.
  const unsent = useDecisionUnsent(request.id);

  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      const outcome = await work();
      if (outcome === 'waiting') {
        toast.success(t('Confirmed. It is recorded once this device has synced.'));
      } else {
        toast.success(done);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      throw error;
    } finally {
      setBusy(null);
    }
  };

  const what = summary?.security
    ? summary.direction === 'out'
      ? t('Security cheque given')
      : t('Security cheque received')
    : summary?.direction === 'out'
      ? t('Cheque issued')
      : t('Cheque received');
  const title = (
    <>
      {what} <bdi dir="ltr">{request.subjectNumber}</bdi>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{t(kindLabel(request.kind))}</span>
        {link ? (
          <Link to={link} className="text-primary-700 text-sm font-medium hover:underline">
            {title}
          </Link>
        ) : (
          <span className="text-sm text-slate-600">{title}</span>
        )}
        <Badge tone={meta.tone}>{t(meta.label)}</Badge>
        {request.expired ? <Badge tone="gray">{t('Expired')}</Badge> : null}
      </div>
      {summary ? (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">{t('Amount')}</dt>
            <dd className="tabular font-medium text-slate-900">
              {fmt.money(summary.amount, summary.currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">
              {summary.direction === 'out' ? t('Payee') : t('Drawer')}
            </dt>
            <dd className="text-slate-800">
              <bdi dir="auto">{summary.drawer || (client ? localName(client) : '') || '—'}</bdi>
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">{t('Bank')}</dt>
            <dd className="text-slate-800">
              {summary.bank ? <bdi>{bankName(summary.bank, language)}</bdi> : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">{t('Cheque date')}</dt>
            <dd className="text-slate-800">
              {summary.chequeDate ? fmt.date(summary.chequeDate) : t('Undated')}
            </dd>
          </div>
          {summary.date ? (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs text-slate-500">
                {summary.direction === 'out' ? t('Date issued') : t('Date received')}
              </dt>
              <dd className="text-slate-800">{fmt.date(summary.date)}</dd>
            </div>
          ) : null}
          {summary.documentIds.length ? (
            <div className="flex justify-between gap-3 sm:block">
              <dt className="text-xs text-slate-500">{t('Documents it pays')}</dt>
              <dd className="text-slate-800">
                {tp(summary.documentIds.length, '{count} document', '{count} documents')}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
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

      {changes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 pe-3 text-start font-medium">{t('Field')}</th>
                <th className="py-1 pe-3 text-start font-medium">{t('Now')}</th>
                <th className="py-1 text-start font-medium">{t('Asked for')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {changes.map((change) => (
                <tr key={change.field}>
                  <td className="py-1.5 pe-3 text-slate-600">{t(change.label)}</td>
                  <td className="py-1.5 pe-3 text-slate-500">
                    <Value
                      change={change}
                      side="before"
                      clients={clients}
                      currency={summary?.currency ?? ''}
                    />
                  </td>
                  <td className="py-1.5 font-medium text-slate-900">
                    <Value
                      change={change}
                      side="after"
                      clients={clients}
                      currency={summary?.currency ?? ''}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {request.kind === 'cheque_delete' ? (
        <p className="text-sm text-slate-600">{t('Asks to delete this cheque.')}</p>
      ) : null}
      {changedSince && cashing ? (
        <p role="alert" className="text-sm text-amber-700">
          {t(
            'Security cheque {number} has changed since cashing it was asked for. Reject this request, and ask again if it is still needed.',
            { number: cashing.number },
          )}
        </p>
      ) : null}
      {files && files.length > 0 ? (
        <AttachmentList
          files={files}
          onAdd={() => undefined}
          onRemove={() => undefined}
          readOnly
          compact
        />
      ) : null}

      {request.decidedAt && !pending ? (
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
      {request.status === 'approved' ? (
        <p className="text-xs text-amber-700">
          {unsent
            ? t('Confirmed. It is recorded once this device has synced.')
            : t(
                'Confirmed, but not recorded yet on this device. Carry it out again, or reject it if it can’t be recorded.',
              )}
        </p>
      ) : null}
      {extra}

      <div className="flex flex-wrap gap-2">
        {pending && approver ? (
          <>
            <Button
              size="sm"
              loading={busy === 'approve'}
              disabled={busy !== null || changedSince}
              onClick={() =>
                void run(
                  'approve',
                  () => approve(request.id, manager),
                  t('Cheque confirmed and recorded'),
                ).catch(() => undefined)
              }
            >
              <Check /> {t('Confirm')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setRejecting(true)}
            >
              <X /> {t('Reject')}
            </Button>
          </>
        ) : null}
        {pending && mine && !approver ? (
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'cancel'}
            disabled={busy !== null}
            onClick={() =>
              void run('cancel', () => cancelApproval(request.id), t('Request taken back')).catch(
                () => undefined,
              )
            }
          >
            <Undo2 /> {t('Take back')}
          </Button>
        ) : null}
        {request.status === 'approved' && approver ? (
          <>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'apply'}
              disabled={busy !== null}
              onClick={() =>
                void run(
                  'apply',
                  () => carryOut(request.id, manager),
                  t('Cheque confirmed and recorded'),
                ).catch(() => undefined)
              }
            >
              <RotateCcw /> {t('Carry it out again')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setRejecting(true)}
            >
              <X /> {t('Reject')}
            </Button>
          </>
        ) : null}
      </div>

      {rejecting ? (
        <ReasonDialog
          open
          onOpenChange={setRejecting}
          title={t('Reject this cheque?')}
          description={t('Nothing is recorded. Whoever asked sees why.')}
          label={t('Note for whoever asked')}
          required={false}
          confirmLabel={t('Reject')}
          danger
          onConfirm={(note) =>
            run('reject', () => decideApproval(request.id, 'rejected', note), t('Rejected'))
          }
        />
      ) : null}
    </div>
  );
}
