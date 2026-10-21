import { paymentParts, securityParts } from '@/db/cheque-approvals';
import { isChequeRequest, proposedPayment } from '@/db/cheque-rules';
import type { ApprovalRequest, ApprovalStatus, Payment, SecurityCheque } from '@/db/types';
import { sameData } from '@/cloud/roles';
import { lookup } from '@/lib/known';
import type { StatusTone } from '@/lib/status';
import { msg } from '@/i18n';

/**
 * What a cheque request (#9) says, for the approver and whoever asked: the
 * cheque it would record or change, and for a change what it changes.
 */

/** The cheque a request is about, as it would be recorded. */
export interface ChequeSummary {
  /** Issued (out) or received (in). */
  direction: 'in' | 'out';
  /** A security (guarantee) cheque rather than a payment. */
  security: boolean;
  clientId: string | null;
  number: string;
  bank: string;
  amount: number;
  currency: string;
  /** The date it was written or received (the payment's date). */
  date: string | null;
  /** The date written on the cheque. */
  chequeDate: string | null;
  /** Payable to (issued) or signed by (received). */
  drawer: string;
  /** The documents it would pay. */
  documentIds: string[];
}

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const amountOf = (value: unknown) => (typeof value === 'number' ? value : 0);
const dateOf = (value: unknown) => (typeof value === 'string' && value ? value : null);

function fromPayment(payment: Partial<Payment> | Row): ChequeSummary {
  const p = payment as Row;
  const cheque = (p.cheque && typeof p.cheque === 'object' ? p.cheque : {}) as Row;
  const allocations = Array.isArray(p.allocations) ? (p.allocations as Row[]) : [];
  return {
    direction: p.direction === 'out' ? 'out' : 'in',
    security: false,
    clientId: text(p.clientId) || null,
    number: text(cheque.number),
    bank: text(cheque.bank),
    amount: amountOf(p.amount),
    currency: text(p.currency),
    date: dateOf(p.date),
    chequeDate: dateOf(cheque.date),
    drawer: text(cheque.drawer),
    documentIds: allocations.map((a) => text(a.documentId)).filter(Boolean),
  };
}

function fromSecurity(cheque: Partial<SecurityCheque> | Row): ChequeSummary {
  const s = cheque as Row;
  return {
    direction: s.direction === 'out' ? 'out' : 'in',
    security: true,
    clientId: text(s.clientId) || null,
    number: text(s.number),
    bank: text(s.bank),
    amount: amountOf(s.amount),
    currency: text(s.currency),
    date: null,
    chequeDate: dateOf(s.date),
    drawer: text(s.drawer),
    documentIds: [],
  };
}

/** The cheque a request would record (a new one, a replacement, a cashed one) or is about. */
export function chequeSummary(request: ApprovalRequest): ChequeSummary | null {
  if (!isChequeRequest(request)) return null;
  const after = (request.after ?? {}) as Row;
  const before = (request.before ?? {}) as Row;
  const proposal = proposedPayment(request);
  if (proposal) return fromPayment(proposal);
  if (request.kind === 'cheque_replace' || request.kind === 'security_cheque_cash') {
    return {
      direction: after.direction === 'out' ? 'out' : 'in',
      security: request.kind === 'security_cheque_cash',
      clientId: text(after.clientId) || null,
      number: text(after.number),
      bank: text(after.bank),
      amount: amountOf(after.amount),
      currency: text(after.currency),
      date: dateOf(after.date),
      chequeDate: dateOf(after.chequeDate),
      drawer: text(after.drawer),
      documentIds: [],
    };
  }
  if (request.subjectTbl === 'securityCheques') {
    return fromSecurity(request.kind === 'cheque_delete' ? before : after);
  }
  return fromPayment(before);
}

/** What each field a cheque request changes is called (English keys). */
const FIELD_LABELS: Record<string, string> = {
  method: msg('Method'),
  direction: msg('Direction'),
  clientId: msg('Contact'),
  date: msg('Date'),
  amount: msg('Amount'),
  currency: msg('Currency'),
  exchangeRate: msg('Exchange rate'),
  accountId: msg('Account'),
  provider: msg('Provider'),
  fee: msg('Fee'),
  feeAccountId: msg('Fee account'),
  creditId: msg('Credit'),
  reference: msg('Reference'),
  notes: msg('Notes'),
  allocations: msg('Documents it pays'),
  purpose: msg('Purpose'),
  'cheque.number': msg('Cheque number'),
  'cheque.bank': msg('Bank'),
  'cheque.date': msg('Cheque date'),
  'cheque.drawer': msg('Payee or drawer'),
  'cheque.drawerCivilId': msg('Civil ID'),
  number: msg('Cheque number'),
  bank: msg('Bank'),
  drawer: msg('Payee or drawer'),
  drawerCivilId: msg('Civil ID'),
};

/** One field a cheque edit changes. */
export interface ChequeFieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

/** The fields a change of a cheque asks to change, before and as asked. */
export function chequeFieldChanges(request: ApprovalRequest): ChequeFieldChange[] {
  if (request.kind !== 'cheque_edit') return [];
  const before = (request.before ?? {}) as Row;
  const after = (request.after ?? {}) as Row;
  const asked =
    request.subjectTbl === 'payments'
      ? paymentParts(after as unknown as Payment)
      : securityParts(after as unknown as SecurityCheque);
  const flat = (parts: Row): Row => {
    const out: Row = {};
    for (const [key, value] of Object.entries(parts)) {
      if (key === 'cheque' && value && typeof value === 'object') {
        for (const [sub, v] of Object.entries(value as Row)) out[`cheque.${sub}`] = v;
      } else if (key !== 'cheque') out[key] = value;
    }
    return out;
  };
  const a = flat(before);
  const b = flat(asked);
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return fields
    .filter((field) => !sameData(a[field], b[field]))
    .map((field) => ({
      field,
      label: FIELD_LABELS[field] ?? msg('Changed'),
      before: a[field],
      after: b[field],
    }));
}

/** How a cheque request stands, in the words of cheques (confirmed rather than approved). */
export const CHEQUE_STATUS_META: Record<ApprovalStatus, { label: string; tone: StatusTone }> = {
  pending: { label: msg('Waiting for confirmation'), tone: 'amber' },
  approved: { label: msg('Confirmed'), tone: 'blue' },
  rejected: { label: msg('Not confirmed'), tone: 'red' },
  cancelled: { label: msg('Cancelled'), tone: 'gray' },
  applied: { label: msg('Confirmed and recorded'), tone: 'green' },
};

export function chequeStatusMeta(status: string): { label: string; tone: StatusTone } {
  return lookup(CHEQUE_STATUS_META, status, { label: msg('Approval request'), tone: 'gray' });
}

/** Whether a waiting request belongs on a tab of the cheque register. */
export function onRegisterTab(
  request: ApprovalRequest,
  tab: 'received' | 'issued' | 'security',
): boolean {
  if (!isChequeRequest(request)) return false;
  if (tab === 'security') return request.subjectTbl === 'securityCheques';
  // Cashing a security cheque records a payment: it shows with those too.
  if (request.subjectTbl !== 'payments' && request.kind !== 'security_cheque_cash') return false;
  const summary = chequeSummary(request);
  return (summary?.direction ?? 'in') === (tab === 'issued' ? 'out' : 'in');
}
