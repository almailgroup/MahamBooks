import { mergeProposal } from '@/db/approvals';
import type { ApprovalRequest, Client, InvoiceDocument } from '@/db/types';
import { INVOICE_CONTENT_FIELDS, sameData } from '@/cloud/roles';
import { computeDocument, documentTaxExempt } from '@/lib/document-calc';
import { msg } from '@/i18n';

/** What each field of a document's content is called (English keys). */
export const FIELD_LABELS: Record<(typeof INVOICE_CONTENT_FIELDS)[number], string> = {
  type: msg('Document type'),
  number: msg('Number'),
  clientId: msg('Customer'),
  issueDate: msg('Issue date'),
  dueDate: msg('Due date'),
  poNumber: msg('PO number'),
  vendorReference: msg('Vendor reference'),
  currency: msg('Currency'),
  exchangeRate: msg('Exchange rate'),
  items: msg('Lines'),
  discount: msg('Discount'),
  discountType: msg('Discount type'),
  taxes: msg('Taxes'),
  charges: msg('Charges'),
  pricesIncludeTax: msg('Prices include tax'),
  deposit: msg('Deposit requested'),
  depositDueDate: msg('Deposit due'),
  notes: msg('Notes'),
  terms: msg('Terms'),
  footer: msg('Footer'),
  intro: msg('Introduction'),
  templateId: msg('Template'),
  accentColor: msg('Colour of this document'),
  deliveryDate: msg('Delivery date'),
  deliveryPlace: msg('Delivery place'),
  retentionPercent: msg('Retention'),
  retentionKind: msg('Retention kind'),
  replacesNumber: msg('Replaces'),
};

/** One field an edit request changes, with what it said and what it would say. */
export interface FieldChange {
  field: (typeof INVOICE_CONTENT_FIELDS)[number];
  label: string;
  before: unknown;
  after: unknown;
}

/** The fields an edit request changes, in the order a document shows them. */
export function fieldChanges(request: Pick<ApprovalRequest, 'before' | 'after'>): FieldChange[] {
  const before = request.before ?? {};
  const after = request.after ?? {};
  return INVOICE_CONTENT_FIELDS.filter((field) => !sameData(before[field], after[field])).map(
    (field) => ({ field, label: FIELD_LABELS[field], before: before[field], after: after[field] }),
  );
}

/**
 * The total of the document before and as the request would make it, worked
 * out on the document as it is now (payments made since included).
 */
export function totalsOfRequest(
  request: Pick<ApprovalRequest, 'before' | 'after'>,
  current: InvoiceDocument,
  client: Pick<Client, 'taxExempt'> | null,
): { before: number; after: number } {
  const before = request.before ?? {};
  const after = request.after ?? {};
  const total = (doc: InvoiceDocument) =>
    computeDocument(doc, { taxExempt: documentTaxExempt(doc, client) }).total;
  return {
    before: total(mergeProposal(current, after, before)),
    after: total(mergeProposal(current, before, after)),
  };
}
