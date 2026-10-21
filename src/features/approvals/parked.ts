import { db } from '@/db/db';
import { ApprovalError, changeKind, pendingRequestFor, requestApproval } from '@/db/approvals';
import { requestChequeConfirmation } from '@/db/cheque-approvals';
import { recalculateDocuments } from '@/db/documents';
import type { ApprovalRequest, InvoiceDocument, Payment, SecurityCheque } from '@/db/types';
import { discardParked, type SyncContext } from '@/cloud/sync';
import type { OutboxEntry } from '@/cloud/types';
import { t } from '@/i18n';

/** A change the cloud refused because it needs an approver, which can be sent for approval. */
export function canSendForApproval(entry: Pick<OutboxEntry, 'table' | 'error'>): boolean {
  return entry.table === 'documents' && entry.error === 'approval_required';
}

/**
 * Turns a change of an issued document the cloud refused (made before this
 * device knew the company's approval rules, or on an older version) into an
 * approval request: the document goes back to the cloud's copy, and the
 * change waits for an approver as a request.
 */
export async function sendParkedForApproval(
  companyId: string,
  entry: Pick<OutboxEntry, 'table' | 'id'>,
  ctx: SyncContext,
  reason: string,
  byName?: string,
): Promise<ApprovalRequest> {
  if (!reason.trim()) throw new ApprovalError(t('Say why, for the approver.'));
  const proposal = await db.documents.get(entry.id);
  if (entry.table !== 'documents' || !proposal) {
    throw new ApprovalError(t('Nothing to send for approval.'));
  }
  if (await pendingRequestFor(entry.id)) {
    throw new ApprovalError(
      t('A request on {number} is already waiting for approval.', { number: proposal.number }),
    );
  }
  // What the cloud has: the change is asked for against it.
  const remote = await ctx.api.getRecord(companyId, 'documents', entry.id).catch(() => null);
  const kind = remote ? changeKind(remote.data as unknown as InvoiceDocument, proposal) : null;
  if (!kind) {
    throw new ApprovalError(t('This change can’t be sent for approval. Undo it instead.'));
  }
  if ((await discardParked(companyId, entry, ctx)) !== 'undone') {
    throw new ApprovalError(t('Nothing to send for approval.'));
  }
  const subject = await db.documents.get(entry.id);
  if (!subject) throw new ApprovalError(t('Nothing to send for approval.'));
  return requestApproval({ kind, subject, proposal, reason, byName });
}

/** A cheque the cloud refused because it needs an approver's confirmation, which can be sent for it. */
export function canSendForConfirmation(entry: Pick<OutboxEntry, 'table' | 'error'>): boolean {
  return (
    (entry.table === 'payments' || entry.table === 'securityCheques') &&
    entry.error === 'approval_required'
  );
}

/**
 * Turns a cheque the cloud refused (recorded, changed or deleted before this
 * device knew the company's cheque rules, or on an older version) into a
 * request for confirmation: the record goes back to the cloud's copy (a new
 * one leaves this device, and the documents it paid are open again), and
 * the change waits for an approver.
 */
export async function sendParkedForConfirmation(
  companyId: string,
  entry: Pick<OutboxEntry, 'table' | 'id'>,
  ctx: SyncContext,
  reason: string,
  byName?: string,
): Promise<ApprovalRequest> {
  if (!canSendForConfirmation({ table: entry.table, error: 'approval_required' })) {
    throw new ApprovalError(t('Nothing to send for confirmation.'));
  }
  const table = entry.table as 'payments' | 'securityCheques';
  const local =
    table === 'payments' ? await db.payments.get(entry.id) : await db.securityCheques.get(entry.id);
  const remote = await ctx.api.getRecord(companyId, table, entry.id).catch(() => null);
  if (!local && !remote) throw new ApprovalError(t('Nothing to send for confirmation.'));
  if (await pendingRequestFor(entry.id)) {
    throw new ApprovalError(t('A request on this cheque is already waiting for confirmation.'));
  }
  // Back to the cloud's copy: the change is asked for against it.
  await discardParked(companyId, entry, ctx, { deleteNew: true });
  if (table === 'payments') {
    const paid = [local, remote?.data].flatMap((p) => {
      const payment = p as Payment | undefined;
      return payment
        ? [...(payment.documentIds ?? []), ...(payment.creditId ? [payment.creditId] : [])]
        : [];
    });
    await recalculateDocuments([...new Set(paid)]);
  }
  if (!local)
    return requestChequeConfirmation({ action: 'delete', table, id: entry.id }, { reason, byName });
  return requestChequeConfirmation(
    table === 'payments'
      ? {
          action: 'save',
          table,
          // A new cheque is numbered once it is confirmed.
          record: { ...(local as Payment), number: remote ? (local as Payment).number : '' },
        }
      : { action: 'save', table, record: local as SecurityCheque },
    { reason, byName },
  );
}
