import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck } from 'lucide-react';
import { db } from '@/db/db';
import type { Client, InvoiceDocument } from '@/db/types';
import { useCompany } from '@/app/company';
import { t } from '@/i18n';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { useApprovalView, useMemberNames } from './hooks';
import { ApprovalRequestCard } from './request-card';

/**
 * On a document's page: the request waiting on it (with Approve and Reject
 * for approvers, Take back for whoever asked), or the last one that was
 * rejected or could not be carried out, so whoever asked sees why.
 */
export function DocumentApprovals({
  doc,
  client,
}: {
  doc: InvoiceDocument;
  client: Client | null;
}) {
  const company = useCompany();
  const view = useApprovalView(company);
  const latest = useLiveQuery(async () => {
    const all = await db.approvals.where('subjectId').equals(doc.id).toArray();
    return all.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
  }, [doc.id]);
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
      aria-label={t('Approval request')}
    >
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ClipboardCheck className="size-4 text-amber-600" aria-hidden />
            {pending ? t('Waiting for approval') : t('Approval request')}
          </span>
        }
      />
      <CardBody className="py-3">
        <ApprovalRequestCard
          request={latest}
          doc={doc}
          clients={clients}
          names={names}
          approver={view.approver}
          userId={view.link?.userId ?? null}
        />
      </CardBody>
    </Card>
  );
}
