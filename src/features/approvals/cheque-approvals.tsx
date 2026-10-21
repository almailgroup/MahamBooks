import { useMemo } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, Hourglass } from 'lucide-react';
import { db } from '@/db/db';
import { isChequeRequest } from '@/db/cheque-rules';
import type { Client, InvoiceDocument } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { t } from '@/i18n';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { useApprovalView, useMemberNames, usePendingChequeRequests } from './hooks';
import { ChequeRequestCard } from './cheque-request-card';
import { chequeSummary } from './cheque-changes';

/**
 * On a payment's page: the cheque request waiting on it (a change or its
 * deletion), or the last one that was turned down or could not be carried
 * out, so whoever asked sees why.
 */
export function PaymentChequeApprovals({
  paymentId,
  client,
}: {
  paymentId: string;
  client: Client | null;
}) {
  const company = useCompany();
  const view = useApprovalView(company);
  const latest = useLiveQuery(async () => {
    const all = (await db.approvals.where('subjectId').equals(paymentId).toArray()).filter(
      isChequeRequest,
    );
    return all.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
  }, [paymentId]);
  const shown = Boolean(latest && ['pending', 'rejected', 'approved'].includes(latest.status));
  const names = useMemberNames(company.id, view.link, shown);
  const clients = useMemo(
    () => new Map<string, Client>(client ? [[client.id, client]] : []),
    [client],
  );
  if (!latest || !shown) return null;
  const pending = latest.status === 'pending';
  return (
    <Card
      className={pending ? 'ring-1 ring-amber-500/40' : undefined}
      aria-label={t('Cheque confirmation')}
    >
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ClipboardCheck className="size-4 text-amber-600" aria-hidden />
            {pending ? t('Waiting for confirmation') : t('Cheque confirmation')}
          </span>
        }
      />
      <CardBody className="py-3">
        <ChequeRequestCard
          request={latest}
          clients={clients}
          names={names}
          approver={view.approver}
          userId={view.link?.userId ?? null}
        />
      </CardBody>
    </Card>
  );
}

/**
 * On an invoice or bill: cheques for it that wait for an approver's
 * confirmation, so nobody records the cheque a second time. They don't
 * count towards its balance until they are confirmed.
 */
export function WaitingChequesNote({ doc }: { doc: Pick<InvoiceDocument, 'id' | 'type'> }) {
  const company = useCompany();
  const fmt = useFormat();
  const waiting = usePendingChequeRequests(company.id);
  const mine = (waiting ?? [])
    .map((request) => ({ request, summary: chequeSummary(request) }))
    .filter(
      ({ summary, request }) =>
        request.kind === 'cheque_create' && summary?.documentIds.includes(doc.id),
    );
  if (mine.length === 0) return null;
  const tab = doc.type === 'bill' ? 'issued' : 'received';
  return (
    <div
      role="status"
      className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <Hourglass className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
      <div className="space-y-1">
        {mine.map(({ request, summary }) => (
          <p key={request.id}>
            {t(
              'Cheque {number} of {amount} for this document is waiting for confirmation. It counts once an approver confirms it.',
              {
                number: request.subjectNumber,
                amount: fmt.money(summary!.amount, summary!.currency),
              },
            )}
          </p>
        ))}
        <Link
          to={`/cheques?tab=${tab}&filter=pending`}
          className="font-medium text-amber-900 underline underline-offset-2"
        >
          {t('Cheques waiting for confirmation')}
        </Link>
      </div>
    </div>
  );
}
