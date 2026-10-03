import type {
  ChequeStatus,
  DocumentStatus,
  DocumentType,
  InvoiceDocument,
  ISODate,
  SecurityChequeStatus,
} from '@/db/types';
import { msg } from '@/i18n';
import { dec } from './money';

export type DisplayStatus = DocumentStatus | 'overdue' | 'expired' | 'open';

export type StatusTone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'slate';

export const STATUS_META: Record<DisplayStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  sent: { label: 'Sent', tone: 'blue' },
  partial: { label: 'Partially paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  void: { label: 'Void', tone: 'slate' },
  overdue: { label: 'Overdue', tone: 'red' },
  accepted: { label: 'Accepted', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
  invoiced: { label: 'Invoiced', tone: 'violet' },
  expired: { label: 'Expired', tone: 'amber' },
  applied: { label: 'Applied', tone: 'green' },
  open: { label: 'Open', tone: 'blue' },
};

export const STATUSES_BY_TYPE: Record<DocumentType, DocumentStatus[]> = {
  invoice: ['draft', 'sent', 'partial', 'paid', 'void'],
  quote: ['draft', 'sent', 'accepted', 'declined', 'invoiced'],
  credit: ['draft', 'sent', 'partial', 'applied', 'void'],
  bill: ['draft', 'sent', 'partial', 'paid', 'void'],
  vendor_credit: ['draft', 'sent', 'partial', 'applied', 'void'],
};

type StatusInput = Pick<InvoiceDocument, 'type' | 'status' | 'dueDate'> & {
  totals: Pick<InvoiceDocument['totals'], 'balance'>;
};

/** Status shown to the user; adds the time-based "overdue" and "expired" states. */
export function displayStatus(doc: StatusInput, todayIso: ISODate): DisplayStatus {
  if (
    (doc.type === 'invoice' || doc.type === 'bill') &&
    (doc.status === 'sent' || doc.status === 'partial') &&
    doc.dueDate &&
    doc.dueDate < todayIso &&
    doc.totals.balance > 0
  ) {
    return 'overdue';
  }
  if (doc.type === 'quote' && doc.status === 'sent' && doc.dueDate && doc.dueDate < todayIso) {
    return 'expired';
  }
  // Bills and vendor credits are "open" rather than "sent".
  if ((doc.type === 'bill' || doc.type === 'vendor_credit') && doc.status === 'sent') return 'open';
  return doc.status;
}

/** Invoice / credit status after its paid amount changed. */
export function settledStatus(
  doc: Pick<InvoiceDocument, 'type' | 'status'>,
  total: number,
  paid: number,
): DocumentStatus {
  if (doc.type === 'quote' || doc.status === 'void') return doc.status;
  // Exact decimal arithmetic: amounts are already rounded to the currency.
  const settled = dec(total).minus(dec(paid)).lte(0);
  const done = doc.type === 'credit' || doc.type === 'vendor_credit' ? 'applied' : 'paid';
  if (paid !== 0 && settled) return done;
  if (paid !== 0) return 'partial';
  return doc.status === 'draft' ? 'draft' : 'sent';
}

/** Documents that still expect money (used by dashboards and reminders). */
export function isOutstanding(doc: Pick<InvoiceDocument, 'type' | 'status'>): boolean {
  return doc.type === 'invoice' && (doc.status === 'sent' || doc.status === 'partial');
}

/** Labels and colours of cheque statuses. Issued cheques waiting to be presented are "Issued". */
export const CHEQUE_STATUS_META: Record<ChequeStatus, { label: string; tone: StatusTone }> = {
  held: { label: msg('In hand'), tone: 'blue' },
  deposited: { label: msg('Deposited'), tone: 'violet' },
  cleared: { label: msg('Cleared'), tone: 'green' },
  returned: { label: msg('Returned'), tone: 'red' },
  cancelled: { label: msg('Cancelled'), tone: 'slate' },
};

export function chequeStatusMeta(
  status: ChequeStatus,
  direction: 'in' | 'out',
): { label: string; tone: StatusTone } {
  if (direction === 'out' && status === 'held') return { label: msg('Issued'), tone: 'blue' };
  return CHEQUE_STATUS_META[status];
}

export const SECURITY_CHEQUE_STATUS_META: Record<
  SecurityChequeStatus,
  { label: string; tone: StatusTone }
> = {
  held: { label: msg('Held as security'), tone: 'amber' },
  returned: { label: msg('Given back'), tone: 'slate' },
  cashed: { label: msg('Cashed'), tone: 'green' },
};
