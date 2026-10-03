import type {
  DeliveryStatus,
  DocumentStatus,
  DocumentType,
  ID,
  InvoiceDocument,
  LineItem,
} from '@/db/types';
import { computeDocument } from './document-calc';
import { currencyPrecision, dec, Decimal, round } from './money';

/**
 * Sales orders are invoiced and delivered, purchase orders billed, invoices
 * delivered, in one go or in parts. Every line copied from an order keeps the
 * id of the order line (`sourceLineId`), so what is left is always worked out
 * from the documents themselves.
 *
 * - Invoices and bills count unless they are void (drafts too, so the same
 *   goods are not invoiced twice).
 * - Delivery notes count as delivered once marked as delivered; drafts are
 *   "on the way" and are not offered again.
 */

export type RelatedDocument = Pick<
  InvoiceDocument,
  'id' | 'type' | 'status' | 'sourceId' | 'items'
>;

export interface LineProgress {
  line: LineItem;
  ordered: number;
  /** On invoices (sales orders) or bills (purchase orders) that are not void. */
  invoiced: number;
  /** On delivery notes marked as delivered. */
  delivered: number;
  /** On draft delivery notes, not signed for yet. */
  inDelivery: number;
  /** Still to invoice or bill. */
  toInvoice: number;
  /** Still to put on a delivery note. */
  toDeliver: number;
}

/** The document an order turns into: invoices for sales orders, bills for purchase orders. */
export function invoiceTypeOf(type: DocumentType): 'invoice' | 'bill' {
  return type === 'purchase_order' ? 'bill' : 'invoice';
}

const ZERO = new Decimal(0);
const positive = (value: Decimal) => (value.isNegative() ? 0 : value.toNumber());

/**
 * Progress of each item line of `source` (a sales order, purchase order or
 * invoice). `related` holds the documents created from it and, for sales
 * orders, the delivery notes created from its invoices.
 */
export function lineProgress(
  source: Pick<InvoiceDocument, 'id' | 'type' | 'items'>,
  related: RelatedDocument[],
): LineProgress[] {
  const invoices =
    source.type === 'sales_order' || source.type === 'purchase_order'
      ? related.filter(
          (d) =>
            d.type === invoiceTypeOf(source.type) &&
            d.sourceId === source.id &&
            d.status !== 'void',
        )
      : [];
  const invoiceIds = new Set(invoices.map((d) => d.id));
  // Invoice line → order line, so delivery notes made from an invoice count for the order.
  const viaInvoice = new Map<ID, ID>();
  for (const invoice of invoices) {
    for (const line of invoice.items) {
      if (line.sourceLineId) viaInvoice.set(line.id, line.sourceLineId);
    }
  }

  const totals = new Map<ID, { invoiced: Decimal; delivered: Decimal; inDelivery: Decimal }>();
  const add = (lineId: ID, key: 'invoiced' | 'delivered' | 'inDelivery', quantity: number) => {
    const entry = totals.get(lineId) ?? { invoiced: ZERO, delivered: ZERO, inDelivery: ZERO };
    entry[key] = entry[key].plus(dec(quantity));
    totals.set(lineId, entry);
  };

  for (const invoice of invoices) {
    for (const line of invoice.items) {
      if (line.kind === 'item' && line.sourceLineId)
        add(line.sourceLineId, 'invoiced', line.quantity);
    }
  }
  for (const note of related) {
    if (note.type !== 'delivery_note' || note.status === 'cancelled' || !note.sourceId) continue;
    const direct = note.sourceId === source.id;
    if (!direct && !invoiceIds.has(note.sourceId)) continue;
    for (const line of note.items) {
      if (line.kind !== 'item' || !line.sourceLineId) continue;
      const target = direct ? line.sourceLineId : viaInvoice.get(line.sourceLineId);
      if (!target) continue;
      add(target, note.status === 'delivered' ? 'delivered' : 'inDelivery', line.quantity);
    }
  }

  return source.items
    .filter((line) => line.kind === 'item')
    .map((line) => {
      const done = totals.get(line.id) ?? { invoiced: ZERO, delivered: ZERO, inDelivery: ZERO };
      const ordered = dec(line.quantity);
      return {
        line,
        ordered: line.quantity,
        invoiced: done.invoiced.toNumber(),
        delivered: done.delivered.toNumber(),
        inDelivery: done.inDelivery.toNumber(),
        toInvoice: positive(ordered.minus(done.invoiced)),
        toDeliver: positive(ordered.minus(done.delivered).minus(done.inDelivery)),
      };
    });
}

/** Lines that were actually ordered (zero and negative quantities are notes or returns). */
const counted = (progress: LineProgress[]) => progress.filter((p) => p.ordered > 0);

/**
 * Status of a sales or purchase order after its invoices or bills changed.
 * Drafts and cancelled orders keep their status; other documents too.
 */
export function orderStatus(
  order: Pick<InvoiceDocument, 'type' | 'status'>,
  progress: LineProgress[],
): DocumentStatus {
  if (order.type !== 'sales_order' && order.type !== 'purchase_order') return order.status;
  if (order.status === 'draft' || order.status === 'cancelled') return order.status;
  const lines = counted(progress);
  const all = lines.length > 0 && lines.every((p) => p.invoiced >= p.ordered);
  const any = lines.some((p) => p.invoiced > 0);
  if (order.type === 'sales_order')
    return all ? 'invoiced' : any ? 'partially_invoiced' : 'confirmed';
  return all ? 'billed' : any ? 'partially_billed' : 'issued';
}

/** How much of an order (or invoice) has been delivered and signed for. */
export function deliveryStatusOf(progress: LineProgress[]): DeliveryStatus {
  const lines = counted(progress);
  if (lines.length > 0 && lines.every((p) => p.delivered >= p.ordered)) return 'delivered';
  return lines.some((p) => p.delivered > 0) ? 'partially_delivered' : 'not_delivered';
}

/**
 * Lines of a new document for the chosen quantities: each copied line keeps
 * its Arabic name, unit, price, taxes and serial number and points back to
 * its source line. A section heading is kept when an item under it is.
 */
export function copyLines(
  items: LineItem[],
  quantities: ReadonlyMap<ID, number>,
  newId: () => string,
): LineItem[] {
  const result: LineItem[] = [];
  let heading: LineItem | null = null;
  for (const item of items) {
    if (item.kind === 'heading') {
      heading = item;
      continue;
    }
    const quantity = quantities.get(item.id) ?? 0;
    if (!(quantity > 0)) continue;
    if (heading) {
      result.push({ ...heading, id: newId(), sourceLineId: undefined });
      heading = null;
    }
    result.push({ ...item, id: newId(), quantity, sourceLineId: item.id });
  }
  return result;
}

/**
 * Document discount of an invoice or bill made from part of an order. A
 * percentage applies as it is; a fixed amount is shared by value, and the
 * last part takes what is left, so the parts add up to the order's discount.
 */
export function partDiscount(
  order: Pick<InvoiceDocument, 'items' | 'discount' | 'discountType' | 'currency'> &
    Partial<Pick<InvoiceDocument, 'pricesIncludeTax' | 'taxes' | 'charges' | 'deposit'>>,
  lines: LineItem[],
  earlier: Pick<InvoiceDocument, 'discount' | 'discountType'>[],
  completes: boolean,
): number {
  if (order.discountType === 'percent' || !order.discount) return order.discount;
  const p = currencyPrecision(order.currency);
  if (completes) {
    const used = earlier
      .filter((d) => d.discountType === 'amount')
      .reduce((sum, d) => sum.plus(dec(d.discount)), ZERO);
    return Math.max(0, round(dec(order.discount).minus(used), p));
  }
  const subtotal = (items: LineItem[]) =>
    computeDocument({
      items,
      discount: 0,
      discountType: 'percent',
      taxes: [],
      charges: [],
      pricesIncludeTax: false,
      currency: order.currency,
      deposit: 0,
    }).subtotal;
  const whole = subtotal(order.items);
  if (!whole) return 0;
  return round(dec(order.discount).times(subtotal(lines)).dividedBy(whole), p);
}
