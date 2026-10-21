import { db } from '@/db/db';
import { ApprovalError, changeKind, pendingRequestFor, requestApproval } from '@/db/approvals';
import { requestChequeConfirmation } from '@/db/cheque-approvals';
import { recalculateDocuments } from '@/db/documents';
import type { ApprovalRequest, InvoiceDocument, Payment, SecurityCheque } from '@/db/types';
import { discardParked, type SyncContext } from '@/cloud/sync';
import type { OutboxEntry } from '@/cloud/types';
import { approvalRulesOf, rulesCoverDocument } from '@/cloud/roles';
import { t } from '@/i18n';

/**
 * A change the cloud refused because it needs an approver, which can be sent
 * for approval: also an issued document deleted while the company's rules
 * (`rules`, see approvalRulesOf) cover documents, which they void instead
 * (the cloud refuses that as any delete it doesn't allow). Which type it
 * was is known from the cloud's copy only, when it is sent.
 */
export function canSendForApproval(
  entry: Pick<OutboxEntry, 'table' | 'error'> & Partial<Pick<OutboxEntry, 'op'>>,
  rules: object | null | undefined,
): boolean {
  if (entry.table !== 'documents') return false;
  if (entry.error === 'approval_required') return true;
  const types = rules && 'documentTypes' in rules ? rules.documentTypes : undefined;
  return (
    entry.op === 'delete' &&
    entry.error === 'permission' &&
    Array.isArray(types) &&
    types.length > 0
  );
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
  if (entry.table !== 'documents') throw new ApprovalError(t('Nothing to send for approval.'));
  // Deleted here when there is none: an issued document is asked to be voided instead.
  const proposal = await db.documents.get(entry.id);
  // What the cloud has: the change is asked for against it.
  const remote = await ctx.api.getRecord(companyId, 'documents', entry.id).catch(() => null);
  const cloudCopy = remote ? (remote.data as unknown as InvoiceDocument) : null;
  if (!proposal && !cloudCopy) throw new ApprovalError(t('Nothing to send for approval.'));
  if (await pendingRequestFor(entry.id)) {
    throw new ApprovalError(
      t('A request on {number} is already waiting for approval.', {
        number: (proposal ?? cloudCopy)!.number,
      }),
    );
  }
  const company = await db.companies.get(companyId);
  const kind = !cloudCopy
    ? null
    : proposal
      ? changeKind(cloudCopy, proposal)
      : cloudCopy.status !== 'draft' &&
          cloudCopy.status !== 'void' &&
          rulesCoverDocument(approvalRulesOf(company), cloudCopy.type)
        ? 'invoice_void'
        : null;
  if (!kind) {
    throw new ApprovalError(t('This change can’t be sent for approval. Undo it instead.'));
  }
  if ((await discardParked(companyId, entry, ctx)) !== 'undone') {
    throw new ApprovalError(t('Nothing to send for approval.'));
  }
  const subject = await db.documents.get(entry.id);
  if (!subject) throw new ApprovalError(t('Nothing to send for approval.'));
  return requestApproval({ kind, subject, ...(proposal ? { proposal } : {}), reason, byName });
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
