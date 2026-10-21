import Dexie from 'dexie';
import { db } from './db';
import { nowStamp } from './defaults';
import { logActivity } from './activity';
import type {
  ApprovalKind,
  ApprovalRequest,
  ApprovalRules,
  Company,
  ID,
  InvoiceDocument,
} from './types';
import { msg, t } from '@/i18n';
import { newId } from '@/lib/ids';
import { addDaysISO, today } from '@/lib/dates';
import {
  approvalRulesOf,
  documentChangeNeedsApproval,
  INVOICE_CONTENT_FIELDS,
  invoiceContent,
  isApprover,
  rulesCoverDocument,
  rulesKeepRecord,
  sameData,
} from '@/cloud/roles';
import type { CloudLink } from '@/cloud/types';

/**
 * The approvals service (D6 of docs/requirements-plan.md): a change only an
 * approver may make is saved as a request (table `approvals`) instead, and
 * carried out on the approver's device when they approve it. Approvers are
 * the company's owner (its Super Admin) and the admins or accountants the
 * owner allowed to approve (Settings → Team). The rules are the owner's
 * (Company.approvalRules, Settings → Approvals) and apply to companies kept
 * in the cloud only: a company kept on this device has nobody to ask.
 *
 * The cloud keeps the requests honest (records_guard in
 * 20261116000000_super_admin_approvals.sql): it stamps who asked and when,
 * lets only an approver decide, and keeps a decision made.
 */

/** A change that waits for an approver: send it with requestApproval instead. */
export class ApprovalRequiredError extends Error {
  constructor(
    /** What to ask for; null for a change that can't be asked for (back to draft). */
    readonly kind: ApprovalKind | null,
    readonly subject: InvoiceDocument,
    /** The document as it would have been saved. */
    readonly proposal: InvoiceDocument,
  ) {
    super(
      kind
        ? t('{number} is issued, so this change needs approval. Send it for approval instead.', {
            number: subject.number,
          })
        : t('{number} is issued, so only an approver can make this change.', {
            number: subject.number,
          }),
    );
    this.name = 'ApprovalRequiredError';
  }
}

export class ApprovalError extends Error {}

/** The rules in effect for a company: none for one kept on this device only (`link` null). */
export function rulesInEffect(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
): ApprovalRules | null {
  if (!link) return null;
  return approvalRulesOf(company) as ApprovalRules | null;
}

/**
 * Whether the owner has turned approvals on (Settings → Approvals): the
 * Approvals page is then in the sidebar. Kept once set, even when the rules
 * cover nothing any more, so earlier requests stay in reach.
 */
export function approvalsOn(company: Pick<Company, 'approvalRules'> | null | undefined): boolean {
  return approvalRulesOf(company) !== null;
}

/** Whether the person decides requests: everyone in a company kept on this device. */
export function approverOf(link: CloudLink | null | undefined): boolean {
  return !link || isApprover(link.role, link.approver);
}

/** Whether the person approves in this company (see approverOf). */
export async function isApproverIn(companyId: ID): Promise<boolean> {
  return approverOf(await db.syncState.get(companyId));
}

/** What kind of request a change of an issued document is. */
export function changeKind(before: InvoiceDocument, after: InvoiceDocument): ApprovalKind | null {
  if (after.status === 'void' && before.status !== 'void') return 'invoice_void';
  if (before.status === 'void' && after.status !== 'void' && after.status !== 'draft') {
    return 'invoice_unvoid';
  }
  if (after.status === 'draft') return null;
  return 'invoice_edit';
}

/**
 * Throws ApprovalRequiredError when storing `after` over `before` waits for
 * an approver: the person isn't one and the company's rules cover the
 * document (as the cloud would refuse it). `link` undefined: not known here
 * (called inside a larger transaction); the cloud's refusal then comes from
 * the change capture (src/cloud/outbox.ts).
 */
export function assertApproved(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
  before: InvoiceDocument,
  after: InvoiceDocument,
): void {
  if (link === undefined || approverOf(link)) return;
  const rules = rulesInEffect(company, link);
  if (!documentChangeNeedsApproval(rules, before, after)) return;
  throw new ApprovalRequiredError(changeKind(before, after), before, after);
}

/** Whether the rules void this document instead of deleting it (for everyone). */
export function voidsInsteadOfDeleting(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
  doc: Pick<InvoiceDocument, 'type' | 'status'>,
): boolean {
  return rulesKeepRecord(rulesInEffect(company, link), 'documents', doc);
}

/** Whether issued documents of this type wait for an approver, for this person. */
export function waitsForApproval(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
  doc: Pick<InvoiceDocument, 'type' | 'status'>,
): boolean {
  if (approverOf(link) || doc.status === 'draft') return false;
  const rules = rulesInEffect(company, link);
  return rulesCoverDocument(rules, doc.type);
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

const LOG: Record<'asked' | 'cancelled' | 'approved' | 'rejected' | 'expired', string> = {
  asked: msg('Approval asked for on {number}'),
  cancelled: msg('Approval request on {number} cancelled'),
  approved: msg('Approval request on {number} approved'),
  rejected: msg('Approval request on {number} rejected'),
  expired: msg('Approval request on {number} expired'),
};

async function logRequest(request: ApprovalRequest, what: keyof typeof LOG): Promise<void> {
  if (request.subjectTbl !== 'documents') return;
  const doc = await db.documents.get(request.subjectId);
  await logActivity(
    request.companyId,
    doc?.type ?? 'invoice',
    request.subjectId,
    `approval:${what}`,
    { text: LOG[what], vars: { number: request.subjectNumber } },
    { clientId: doc?.clientId || null, documentId: request.subjectId },
  );
}

/** The company's requests waiting for a decision, the oldest first. */
export async function pendingRequests(companyId: ID): Promise<ApprovalRequest[]> {
  const waiting = await db.approvals
    .where('[companyId+status]')
    .equals([companyId, 'pending'])
    .toArray();
  return waiting.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** The request waiting on a record, if any. */
export async function pendingRequestFor(subjectId: ID): Promise<ApprovalRequest | undefined> {
  return db.approvals
    .where('subjectId')
    .equals(subjectId)
    .filter((r) => r.status === 'pending')
    .first();
}

/** The parts of a document an edit request carries: what it says, before and as proposed. */
function editParts(before: InvoiceDocument, after: InvoiceDocument) {
  return { before: invoiceContent(before), after: invoiceContent(after) };
}

/**
 * Sends a change of an issued document for approval: an edit (the document
 * as it would have been saved), a void or an un-void. One request waits on
 * a document at a time. Returns the request.
 */
export async function requestApproval(input: {
  kind: ApprovalKind;
  subject: InvoiceDocument;
  /** invoice_edit: the document as it would be saved. */
  proposal?: InvoiceDocument;
  reason: string;
  /** The name the team knows the person by, shown with the request. */
  byName?: string;
}): Promise<ApprovalRequest> {
  const { subject, kind } = input;
  const reason = input.reason.trim();
  if (!reason) throw new ApprovalError(t('Say why, for the approver.'));
  const link = await db.syncState.get(subject.companyId);
  return db.transaction('rw', [db.approvals, db.documents, db.activities], async () => {
    if (await pendingRequestFor(subject.id)) {
      throw new ApprovalError(
        t('A request on {number} is already waiting for approval.', { number: subject.number }),
      );
    }
    let before: Record<string, unknown>;
    let after: Record<string, unknown>;
    if (kind === 'invoice_edit') {
      if (!input.proposal) throw new ApprovalError(t('Nothing to send for approval.'));
      ({ before, after } = editParts(subject, input.proposal));
      if (sameData(before, after)) throw new ApprovalError(t('Nothing has changed.'));
    } else if (kind === 'invoice_void') {
      before = { status: subject.status };
      after = { status: 'void', voidReason: reason };
    } else if (kind === 'invoice_unvoid') {
      before = { status: 'void' };
      after = { status: 'sent' };
    } else {
      throw new ApprovalError(t('Nothing to send for approval.'));
    }
    const now = nowStamp();
    const request: ApprovalRequest = {
      id: newId(),
      companyId: subject.companyId,
      kind,
      subjectTbl: 'documents',
      subjectId: subject.id,
      subjectNumber: subject.number,
      before,
      after,
      reason,
      status: 'pending',
      // The cloud stamps both with its own.
      requestedBy: link?.userId ?? '',
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
  });
}

/** Takes a request back while it waits (whoever asked), or cancels it (an approver). */
export async function cancelApproval(id: ID): Promise<void> {
  const request = await db.approvals.get(id);
  if (!request) return;
  const link = await db.syncState.get(request.companyId);
  await db.transaction('rw', [db.approvals, db.documents, db.activities], async () => {
    const current = await db.approvals.get(id);
    if (!current || current.status !== 'pending') return;
    const now = nowStamp();
    await db.approvals.put({
      ...current,
      status: 'cancelled',
      decidedBy: link?.userId ?? null,
      decidedAt: now,
      updatedAt: now,
    });
    await logRequest(current, 'cancelled');
  });
}

/**
 * An approver's decision. Approved, the change is carried out here at once
 * (applyApproval); when that fails (the period is locked meanwhile, the
 * number is taken), the request stays approved and can be applied again or
 * rejected.
 */
export async function decideApproval(
  id: ID,
  decision: 'approved' | 'rejected',
  note = '',
): Promise<void> {
  const request = await db.approvals.get(id);
  if (!request || request.status !== 'pending') {
    throw new ApprovalError(t('This request has already been decided.'));
  }
  if (!(await isApproverIn(request.companyId))) {
    throw new ApprovalError(t('Only an approver decides approval requests.'));
  }
  const link = await db.syncState.get(request.companyId);
  const now = nowStamp();
  await db.transaction('rw', [db.approvals, db.documents, db.activities], async () => {
    await db.approvals.put({
      ...request,
      status: decision,
      decidedBy: link?.userId ?? null,
      decidedAt: now,
      decisionNote: note.trim(),
      updatedAt: now,
    });
    await logRequest(request, decision);
  });
  if (decision === 'approved') await applyApproval(id);
}

/**
 * The fields of an edit request carried onto the document as it is now: only
 * what the request changed, so changes made since (payments, other fields)
 * stay. Fields the proposal leaves out are removed.
 */
export function mergeProposal(
  current: InvoiceDocument,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): InvoiceDocument {
  const merged: Record<string, unknown> = { ...current };
  for (const field of INVOICE_CONTENT_FIELDS) {
    if (sameData(before[field], after[field])) continue;
    if (after[field] === undefined) delete merged[field];
    else merged[field] = structuredClone(after[field]);
  }
  return merged as unknown as InvoiceDocument;
}

/** Whether the document changed, in what it says, since the request was made. */
export function changedSinceAsked(request: ApprovalRequest, current: InvoiceDocument): boolean {
  if (request.kind !== 'invoice_edit' || !request.before) return false;
  return !sameData(invoiceContent(current), request.before);
}

/** Carries out an approved request on this (the approver's) device, and marks it applied. */
export async function applyApproval(id: ID): Promise<void> {
  const request = await db.approvals.get(id);
  if (!request || request.status !== 'approved') return;
  if (request.subjectTbl !== 'documents') {
    throw new ApprovalError(t('This version of the app can’t carry out this request.'));
  }
  const doc = await db.documents.get(request.subjectId);
  if (!doc) throw new ApprovalError(t('The document of this request no longer exists.'));
  // Imported here: documents.ts uses this module for its own checks.
  const { saveDocument, setDocumentStatus } = await import('./documents');
  const after = request.after ?? {};
  if (request.kind === 'invoice_edit') {
    await saveDocument(mergeProposal(doc, request.before ?? {}, after));
  } else if (request.kind === 'invoice_void') {
    if (doc.status !== 'void') {
      await setDocumentStatus(doc.id, 'void', undefined, {
        voidReason: typeof after.voidReason === 'string' ? after.voidReason : request.reason,
      });
    }
  } else if (request.kind === 'invoice_unvoid') {
    if (doc.status === 'void') await setDocumentStatus(doc.id, 'sent');
  } else {
    throw new ApprovalError(t('This version of the app can’t carry out this request.'));
  }
  const fresh = await db.approvals.get(id);
  if (fresh?.status === 'approved') {
    await db.approvals.put({ ...fresh, status: 'applied', updatedAt: nowStamp() });
  }
}

/**
 * Cancels requests that waited longer than the company's rules allow
 * (expireDays). Done on approvers' devices, as the cloud lets only them
 * decide. Returns how many were cancelled.
 */
export async function expirePending(companyId: ID, on = today()): Promise<number> {
  if (Dexie.currentTransaction) return 0;
  const [company, link] = await Promise.all([
    db.companies.get(companyId),
    db.syncState.get(companyId),
  ]);
  const days = rulesInEffect(company, link)?.expireDays;
  if (!days || days <= 0 || !approverOf(link)) return 0;
  const waiting = await db.approvals
    .where('[companyId+status]')
    .equals([companyId, 'pending'])
    .toArray();
  const old = waiting.filter((r) => addDaysISO(r.requestedAt.slice(0, 10), days) < on);
  if (old.length === 0) return 0;
  await db.transaction('rw', [db.approvals, db.documents, db.activities], async () => {
    for (const request of old) {
      const now = nowStamp();
      await db.approvals.put({
        ...request,
        status: 'cancelled',
        decidedBy: link?.userId ?? null,
        decidedAt: now,
        expired: true,
        updatedAt: now,
      });
      await logRequest(request, 'expired');
    }
  });
  return old.length;
}
