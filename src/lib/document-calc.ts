import type { InvoiceDocument } from '@/db/types';
import { calculate, type CalcInput, type CalcResult } from './calc';
import { currencyPrecision } from './money';

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
>;

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
  };
}

export function computeDocument(
  doc: CalculableDocument,
  options: { paid?: number; taxExempt?: boolean } = {},
): CalcResult {
  return calculate(documentCalcInput(doc, options));
}
