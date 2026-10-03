import type {
  ChequeStatus,
  DeliveryStatus,
  DocumentStatus,
  DocumentType,
  InvoiceDocument,
  ISODate,
  SecurityChequeStatus,
} from '@/db/types';
import { msg } from '@/i18n';
import { postsToLedger } from './document-types';
import { dec } from './money';

export type DisplayStatus = DocumentStatus | 'overdue' | 'expired' | 'open';

export type StatusTone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'slate';

/** Labels are English keys: show them with `t(STATUS_META[status].label)`. */
export const STATUS_META: Record<DisplayStatus, { label: string; tone: StatusTone }> = {
  draft: { label: msg('Draft'), tone: 'gray' },
  sent: { label: msg('Sent'), tone: 'blue' },
  partial: { label: msg('Partially paid'), tone: 'amber' },
  paid: { label: msg('Paid'), tone: 'green' },
  void: { label: msg('Void'), tone: 'slate' },
  overdue: { label: msg('Overdue'), tone: 'red' },
  accepted: { label: msg('Accepted'), tone: 'green' },
  declined: { label: msg('Declined'), tone: 'red' },
  invoiced: { label: msg('Invoiced'), tone: 'violet' },
  expired: { label: msg('Expired'), tone: 'amber' },
  applied: { label: msg('Applied'), tone: 'green' },
  open: { label: msg('Open'), tone: 'blue' },
  converted: { label: msg('Converted'), tone: 'violet' },
  confirmed: { label: msg('Confirmed'), tone: 'blue' },
  partially_invoiced: { label: msg('Partially invoiced'), tone: 'amber' },
  issued: { label: msg('Issued'), tone: 'blue' },
  partially_billed: { label: msg('Partially billed'), tone: 'amber' },
  billed: { label: msg('Billed'), tone: 'violet' },
  delivered: { label: msg('Delivered'), tone: 'green' },
  cancelled: { label: msg('Cancelled'), tone: 'slate' },
};

export const STATUSES_BY_TYPE: Record<DocumentType, DocumentStatus[]> = {
  invoice: ['draft', 'sent', 'partial', 'paid', 'void'],
  quote: ['draft', 'sent', 'accepted', 'declined', 'invoiced', 'converted'],
  credit: ['draft', 'sent', 'partial', 'applied', 'void'],
  bill: ['draft', 'sent', 'partial', 'paid', 'void'],
  vendor_credit: ['draft', 'sent', 'partial', 'applied', 'void'],
  proforma: ['draft', 'sent', 'accepted', 'converted'],
  sales_order: ['draft', 'confirmed', 'partially_invoiced', 'invoiced', 'cancelled'],
  purchase_order: ['draft', 'issued', 'partially_billed', 'billed', 'cancelled'],
  delivery_note: ['draft', 'delivered', 'cancelled'],
};

/** Delivery progress of a sales order. */
export const DELIVERY_STATUS_META: Record<DeliveryStatus, { label: string; tone: StatusTone }> = {
  not_delivered: { label: msg('Not delivered'), tone: 'gray' },
  partially_delivered: { label: msg('Partially delivered'), tone: 'amber' },
  delivered: { label: msg('Delivered'), tone: 'green' },
};

/**
 * The status a draft moves to once it leaves the office: "sent" for most
 * documents, "confirmed" for sales orders and "issued" for purchase orders.
 * Delivery notes are marked as delivered instead (with who signed for them).
 */
export function issuedStatus(type: DocumentType): DocumentStatus | null {
  if (type === 'sales_order') return 'confirmed';
  if (type === 'purchase_order') return 'issued';
  if (type === 'delivery_note') return null;
  return 'sent';
}

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
  // Quotes and proformas are valid until their "valid until" date.
  if (
    (doc.type === 'quote' || doc.type === 'proforma') &&
    doc.status === 'sent' &&
    doc.dueDate &&
    doc.dueDate < todayIso
  ) {
    return 'expired';
  }
  // Bills and vendor credits are "open" rather than "sent".
  if ((doc.type === 'bill' || doc.type === 'vendor_credit') && doc.status === 'sent') return 'open';
  return doc.status;
}

/**
 * Invoice / credit status after its paid amount changed. Documents that take
 * no payments (quotes, proformas, orders, delivery notes) keep their status.
 */
export function settledStatus(
  doc: Pick<InvoiceDocument, 'type' | 'status'>,
  total: number,
  paid: number,
): DocumentStatus {
  if (!postsToLedger(doc.type) || doc.status === 'void') return doc.status;
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
