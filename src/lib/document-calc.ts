import type { Client, InvoiceDocument } from '@/db/types';
import { calculate, type CalcInput, type CalcResult } from './calc';
import { currencyPrecision, dec, round } from './money';

/**
 * Whether a document is worked out without tax: as fixed when it was issued
 * (`posting`), else as its contact is now.
 */
export function documentTaxExempt(
  doc: Partial<Pick<InvoiceDocument, 'posting'>>,
  contact: Pick<Client, 'taxExempt'> | null | undefined,
): boolean {
  return doc.posting ? doc.posting.taxExempt : Boolean(contact?.taxExempt);
}

export type CalculableDocument = Pick<
  InvoiceDocument,
  | 'items'
  | 'discount'
  | 'discountType'
  | 'taxes'
  | 'charges'
  | 'pricesIncludeTax'
  | 'currency'
  | 'deposit'
> &
  Partial<Pick<InvoiceDocument, 'type' | 'retentionPercent' | 'retentionReleases'>>;

/** Document types that can hold back a retention. */
export function takesRetention(type: InvoiceDocument['type'] | undefined): boolean {
  return type === 'invoice' || type === 'bill';
}

/** Retention released so far (releases that were not undone), in the document currency. */
export function releasedRetention(
  doc: Partial<Pick<InvoiceDocument, 'retentionReleases' | 'currency'>>,
): number {
  const p = currencyPrecision(doc.currency || 'KWD');
  const released = (doc.retentionReleases ?? [])
    .filter((r) => !r.reversedOn)
    .reduce((acc, r) => acc.plus(dec(r.amount)), dec(0));
  return round(released, p);
}

export function documentCalcInput(
  doc: CalculableDocument,
  options: { paid?: number; taxExempt?: boolean } = {},
): CalcInput {
  const exempt = Boolean(options.taxExempt);
  return {
    precision: currencyPrecision(doc.currency || 'KWD'),
    items: doc.items.map((item) => ({
      kind: item.kind,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      discountType: item.discountType,
      taxes: exempt ? [] : item.taxes,
    })),
    discount: doc.discount,
    discountType: doc.discountType,
    taxes: exempt ? [] : doc.taxes,
    charges: doc.charges.map((c) => ({ amount: c.amount, taxes: exempt ? [] : c.taxes })),
    pricesIncludeTax: doc.pricesIncludeTax,
    paid: options.paid ?? 0,
    deposit: doc.deposit,
    // Only invoices and bills hold back a retention; a document without a type
    // (a recurring template) has none.
    retentionPercent: takesRetention(doc.type) ? (doc.retentionPercent ?? 0) : 0,
    retentionReleased: takesRetention(doc.type) ? releasedRetention(doc) : 0,
  };
}

export function computeDocument(
  doc: CalculableDocument,
  options: { paid?: number; taxExempt?: boolean } = {},
): CalcResult {
  return calculate(documentCalcInput(doc, options));
}
