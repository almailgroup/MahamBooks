import type {
  DocumentType,
  OrderDocumentType,
  PurchaseDocumentType,
  SalesDocumentType,
} from '@/db/types';

/** Bills, vendor credits and purchase orders: entered with the bill editor, against a vendor. */
export function isPurchaseType(type: DocumentType): type is PurchaseDocumentType {
  return type === 'bill' || type === 'vendor_credit' || type === 'purchase_order';
}

/** Proformas, orders and delivery notes: they never post and never count as sales or purchases. */
export function isOrderType(type: DocumentType): type is OrderDocumentType {
  return (
    type === 'proforma' ||
    type === 'sales_order' ||
    type === 'purchase_order' ||
    type === 'delivery_note'
  );
}

/** Invoices, credit notes, bills and vendor credits: part of the books once issued. */
export function postsToLedger(
  type: DocumentType,
): type is 'invoice' | 'credit' | 'bill' | 'vendor_credit' {
  return type === 'invoice' || type === 'credit' || type === 'bill' || type === 'vendor_credit';
}

/** Documents printed as a PDF by the app (bills and vendor credits are the vendor's documents). */
export type PrintableDocumentType = Exclude<DocumentType, 'bill' | 'vendor_credit'>;

export function isPrintable(type: DocumentType): type is PrintableDocumentType {
  return type !== 'bill' && type !== 'vendor_credit';
}

/** Delivery notes list goods only: no prices, totals or payment details. */
export function hasPrices(type: DocumentType): boolean {
  return type !== 'delivery_note';
}

/** Narrows to a sales document type with an email template; other documents have none. */
export function salesType(type: DocumentType): SalesDocumentType {
  if (type === 'invoice' || type === 'quote' || type === 'credit') return type;
  throw new Error(`${type} has no email template`);
}
