import Dexie from 'dexie';
import { db } from './db';
import { approverOf, rulesInEffect } from './approvals';
import type { ApprovalRequest, Company, ID, ISODate, Payment, SecurityCheque } from './types';
import type { ReplacementInput } from './cheques';
import { chequeChangeNeedsApprover } from '@/cloud/roles';
import type { CloudLink } from '@/cloud/types';
import { t } from '@/i18n';

/**
 * Cheque confirmation (#9 of docs/requirements-plan.md, D13): under the
 * owner's rules (Company.approvalRules.cheques), a cheque recorded by anyone
 * but an approver is a request (table `approvals`), not a payment. Nothing
 * reaches the books, the invoice balances, the cheque register or the alerts
 * until an approver confirms it on their own device, which then records the
 * payment as asked, dated when the cheque was written or received. Changes of
 * what was confirmed (amount, payee, number, bank, dates) and deleting a
 * confirmed cheque wait the same way; its life (deposited, cleared, returned,
 * cancelled), prints, notes and allocations don't. The cloud keeps to the
 * same rules (records_guard in 20261116000000_super_admin_approvals.sql).
 *
 * This module holds what the payment and cheque functions check; the
 * requests themselves are in cheque-approvals.ts.
 */

/** How cashing a security cheque was asked for (cashSecurityCheque's input). */
export interface CashInput {
  date: ISODate;
  clientId?: ID | null;
  applyToOpen?: boolean;
}

/** What a person asked for that waits for an approver's confirmation. */
export type ChequeAsk =
  | { action: 'save'; table: 'payments'; record: Payment }
  | { action: 'save'; table: 'securityCheques'; record: SecurityCheque }
  | { action: 'delete'; table: 'payments' | 'securityCheques'; id: ID }
  | { action: 'replace'; id: ID; input: ReplacementInput }
  | { action: 'cash'; id: ID; input: CashInput };

/** A cheque change that waits for an approver: send it with requestChequeConfirmation instead. */
export class ChequeConfirmationRequiredError extends Error {
  constructor(readonly ask: ChequeAsk) {
    super(t('This cheque needs confirmation. Send it for confirmation instead.'));
    this.name = 'ChequeConfirmationRequiredError';
  }
}

/** The company's rules and the person's link to the cloud, as the checks read them. */
export interface RulesContext {
  company: Pick<Company, 'approvalRules'> | null | undefined;
  link: CloudLink | null;
}

/**
 * The rules and the link, read outside a transaction; undefined inside one
 * (the change capture, src/cloud/outbox.ts, refuses what the cloud would).
 */
export async function rulesContext(companyId: ID): Promise<RulesContext | undefined> {
  if (Dexie.currentTransaction) return undefined;
  const [company, link] = await Promise.all([
    db.companies.get(companyId),
    db.syncState.get(companyId),
  ]);
  return { company, link: link ?? null };
}

/**
 * Whether storing `after` over `before` (either undefined: new, or deleted)
 * waits for an approver, for this person: they aren't one and the company's
 * rules keep this cheque for approvers.
 */
export function chequeWaits(
  company: Pick<Company, 'approvalRules'> | null | undefined,
  link: CloudLink | null | undefined,
  table: 'payments' | 'securityCheques',
  before: object | null | undefined,
  after: object | null | undefined,
): boolean {
  if (link === undefined || approverOf(link)) return false;
  return chequeChangeNeedsApprover(rulesInEffect(company, link), table, before, after);
}

/** Throws ChequeConfirmationRequiredError when the change waits for an approver (see chequeWaits). */
export function assertChequeConfirmed(
  ctx: RulesContext | undefined,
  table: 'payments' | 'securityCheques',
  before: object | null | undefined,
  after: object | null | undefined,
  ask: () => ChequeAsk,
): void {
  if (!ctx || !chequeWaits(ctx.company, ctx.link, table, before, after)) return;
  throw new ChequeConfirmationRequiredError(ask());
}

/* -------------------------------------------------------------------------- */
/* Cheques waiting                                                            */
/* -------------------------------------------------------------------------- */

const CHEQUE_TABLES = new Set(['payments', 'securityCheques']);

/** Whether a request is about a cheque (a payment or a security cheque). */
export function isChequeRequest(request: Pick<ApprovalRequest, 'subjectTbl'>): boolean {
  return CHEQUE_TABLES.has(request.subjectTbl);
}

/** A cheque a request would record, as far as checking its number needs. */
export interface WaitingCheque {
  requestId: ID;
  /** The payment or security cheque the request is about. */
  subjectId: ID;
  direction: 'in' | 'out';
  clientId: ID;
  number: string;
  bank: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The payment a request about a payment proposes (a new cheque or a change), if any. */
export function proposedPayment(request: Pick<ApprovalRequest, 'after' | 'subjectTbl' | 'kind'>) {
  if (request.subjectTbl !== 'payments') return null;
  if (request.kind !== 'cheque_create' && request.kind !== 'cheque_edit') return null;
  const after = request.after as Partial<Payment> | null | undefined;
  return after && typeof after === 'object' && typeof after.id === 'string'
    ? (after as Payment)
    : null;
}

/** The cheque a waiting request would record as a payment, if it records one. */
export function waitingCheque(request: ApprovalRequest): WaitingCheque | null {
  const after = (request.after ?? {}) as Record<string, unknown>;
  const proposal = proposedPayment(request);
  if (proposal?.method === 'cheque' && proposal.cheque) {
    return {
      requestId: request.id,
      subjectId: request.subjectId,
      direction: proposal.direction === 'out' ? 'out' : 'in',
      clientId: proposal.clientId,
      number: text(proposal.cheque.number),
      bank: text(proposal.cheque.bank),
    };
  }
  if (request.kind === 'cheque_replace' || request.kind === 'security_cheque_cash') {
    const number = text(after.number);
    if (!number) return null;
    return {
      requestId: request.id,
      subjectId: request.subjectId,
      direction: after.direction === 'out' ? 'out' : 'in',
      clientId: text(after.clientId),
      number,
      bank: text(after.bank),
    };
  }
  return null;
}

/**
 * The cheques the company's waiting requests would record as payments, so
 * that nobody records one of them a second time. Reads `approvals`: the
 * caller's transaction must have it.
 */
export async function waitingCheques(companyId: ID): Promise<WaitingCheque[]> {
  const waiting = await db.approvals
    .where('[companyId+status]')
    .equals([companyId, 'pending'])
    .toArray();
  return waiting
    .filter(isChequeRequest)
    .map(waitingCheque)
    .filter((c): c is WaitingCheque => c !== null);
}
