import { db } from '@/db/db';
import { ApprovalError, changeKind, pendingRequestFor, requestApproval } from '@/db/approvals';
import type { ApprovalRequest, InvoiceDocument } from '@/db/types';
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
