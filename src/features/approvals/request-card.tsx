import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, RotateCcw, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cancelApproval, changedSinceAsked, decideApproval } from '@/db/approvals';
import type { ApprovalRequest, Client, InvoiceDocument } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, useFormat } from '@/app/company';
import { isKnown } from '@/lib/known';
import { isISODate } from '@/lib/dates';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { Badge } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useCloud } from '@/cloud/store';
import { fieldChanges, totalsOfRequest, type FieldChange } from './changes';
import { approve, carryOut } from './decide';
import { useDecisionUnsent } from './hooks';
import { kindLabel, statusMeta } from './labels';
import { ReasonDialog } from './reason-dialog';

/** Who someone is, by the team's names, the name kept with the request, or neither. */
function nameOf(id: string | null, names: Map<string, string>, kept?: string): string {
  if (!id) return kept || t('A team member');
  return names.get(id) || kept || t('A team member');
}

function Value({
  change,
  side,
  clients,
}: {
  change: FieldChange;
  side: 'before' | 'after';
  clients: Map<string, Client>;
}) {
  const fmt = useFormat();
  const value = change[side];
  if (value === undefined || value === null || value === '') {
    return <span className="text-slate-400">—</span>;
  }
  if (change.field === 'clientId' && typeof value === 'string') {
    const client = clients.get(value);
    return <bdi>{client ? localName(client) : t('Another customer')}</bdi>;
  }
  if (change.field === 'items' && Array.isArray(value)) {
    return <span>{tp(value.length, '{count} line', '{count} lines')}</span>;
  }
  if (typeof value === 'boolean') return <span>{value ? t('Yes') : t('No')}</span>;
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
 * One approval request: what is asked and why, by whom and when, the
 * decision, and what the person may do with it (decide, take back, carry
 * out again).
 */
export function ApprovalRequestCard({
  request,
  doc,
  clients,
  names,
  approver,
  userId,
  showSubject = false,
  extra,
}: {
  request: ApprovalRequest;
  /** The document as it is now (undefined: not on this device). */
  doc: InvoiceDocument | undefined;
  clients: Map<string, Client>;
  names: Map<string, string>;
  approver: boolean;
  /** The person's account in the cloud. */
  userId: string | null;
  /** Says which document it is about, with a link (in the inbox). */
  showSubject?: boolean;
  extra?: ReactNode;
}) {
  const fmt = useFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const meta = statusMeta(request.status);
  const changes = request.kind === 'invoice_edit' ? fieldChanges(request) : [];
  const client = doc ? (clients.get(doc.clientId) ?? null) : null;
  const totals =
    doc && request.kind === 'invoice_edit' ? totalsOfRequest(request, doc, client) : null;
  const pending = request.status === 'pending';
  const mine = userId !== null && request.requestedBy === userId;
  const { manager } = useCloud();
  // Approved here, and not in the cloud yet: carried out once it is.
  const unsent = useDecisionUnsent(request.id);
  const approved = request.status === 'approved';

  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      const outcome = await work();
      if (outcome === 'waiting') {
        toast.success(t('Approved. It is carried out once this device has synced.'));
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

  const subjectType =
    doc?.type ??
    (typeof request.after?.type === 'string' && isKnown(DOCUMENT_LABELS, request.after.type)
      ? request.after.type
      : null);
  const subjectLabel = subjectType ? t(DOCUMENT_LABELS[subjectType].singular) : t('Document');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{t(kindLabel(request.kind))}</span>
        {showSubject ? (
          doc ? (
            <Link
              to={`${DOCUMENT_ROUTES[doc.type]}/${doc.id}`}
              className="text-primary-700 text-sm font-medium hover:underline"
            >
              {subjectLabel} <bdi>{request.subjectNumber}</bdi>
            </Link>
          ) : (
            <span className="text-sm text-slate-600">
              {subjectLabel} <bdi>{request.subjectNumber}</bdi>
            </span>
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
                    <Value change={change} side="before" clients={clients} />
                  </td>
                  <td className="py-1.5 font-medium text-slate-900">
                    <Value change={change} side="after" clients={clients} />
                  </td>
                </tr>
              ))}
              {totals && totals.before !== totals.after && doc ? (
                <tr>
                  <td className="py-1.5 pe-3 text-slate-600">{t('Total')}</td>
                  <td className="tabular py-1.5 pe-3 text-slate-500">
                    {fmt.money(totals.before, doc.currency)}
                  </td>
                  <td className="tabular py-1.5 font-medium text-slate-900">
                    {fmt.money(totals.after, doc.currency)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {pending && doc && changedSinceAsked(request, doc) ? (
        <p className="text-xs text-amber-700">
          {t(
            'The document has changed since this was asked. Approving changes only what was asked for.',
          )}
        </p>
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
      {approved ? (
        <p className="text-xs text-amber-700">
          {unsent
            ? t('Approved. It is carried out once this device has synced.')
            : t(
                'Approved, but not carried out yet on this device. Carry it out again, or reject it if it can’t be carried out.',
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
              disabled={busy !== null || !doc}
              onClick={() =>
                void run(
                  'approve',
                  () => approve(request.id, manager),
                  t('Approved and done'),
                ).catch(() => undefined)
              }
            >
              <Check /> {t('Approve')}
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
        {approved && approver ? (
          <>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'apply'}
              disabled={busy !== null || !doc}
              onClick={() =>
                void run(
                  'apply',
                  () => carryOut(request.id, manager),
                  t('Approved and done'),
                ).catch(() => undefined)
              }
            >
              <RotateCcw /> {t('Carry it out again')}
            </Button>
            {/* An approval that can't be carried out may still be turned down. */}
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
          title={t('Reject this request?')}
          description={t('The document stays as it is. Whoever asked sees why.')}
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
