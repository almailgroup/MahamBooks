import { db } from './db';
import {
  carriedWording,
  draftDocument,
  relatedForProgress,
  saveDocument,
  setDocumentStatus,
} from './documents';
import { logActivity } from './activity';
import type { ID, InvoiceDocument, ISODate } from './types';
import { issuedStatus } from '@/lib/status';
import { shortId } from '@/lib/ids';
import { copyLines, lineProgress, partDiscount, type LineProgress } from '@/lib/orders';
import { msg, t } from '@/i18n';

/** What an order or invoice can be turned into, in parts. */
export type PartTarget = 'invoice' | 'bill' | 'delivery_note';

/** Sales orders are invoiced and delivered, purchase orders billed, invoices delivered. */
export function partTargets(doc: Pick<InvoiceDocument, 'type'>): PartTarget[] {
  if (doc.type === 'sales_order') return ['invoice', 'delivery_note'];
  if (doc.type === 'purchase_order') return ['bill'];
  if (doc.type === 'invoice') return ['delivery_note'];
  return [];
}

/** Quantity of a line still to go on the target document. */
export function remainingOf(progress: LineProgress, target: PartTarget): number {
  return target === 'delivery_note' ? progress.toDeliver : progress.toInvoice;
}

/**
 * Progress of each line of an order (or invoice), from the documents made
 * from it. An invoice made from a sales order offers no more for delivery
 * than the order still has to deliver, so goods already delivered against
 * the order are not delivered twice.
 */
export async function progressOf(
  doc: Pick<InvoiceDocument, 'id' | 'type' | 'items' | 'sourceId'>,
): Promise<LineProgress[]> {
  const progress = lineProgress(doc, await relatedForProgress(doc));
  if (doc.type !== 'invoice' || !doc.sourceId) return progress;
  const order = await db.documents.get(doc.sourceId);
  if (order?.type !== 'sales_order') return progress;
  const orderLines = new Map((await progressOf(order)).map((p) => [p.line.id, p]));
  return progress.map((p) => {
    const ordered = p.line.sourceLineId ? orderLines.get(p.line.sourceLineId) : undefined;
    return ordered ? { ...p, toDeliver: Math.min(p.toDeliver, ordered.toDeliver) } : p;
  });
}

const CREATED_LOG: Record<PartTarget, string> = {
  invoice: msg('Invoice {number} created from {source}'),
  bill: msg('Bill {number} created from {source}'),
  delivery_note: msg('Delivery note {number} created from {source}'),
};

/**
 * Creates an invoice or delivery note from a sales order, a bill from a
 * purchase order, or a delivery note from an invoice. `quantities` (by line
 * id) chooses how much of each line; by default everything that is left.
 * Lines keep their Arabic names, units, prices, taxes, accounts and serial
 * numbers, and point back to the line they came from.
 */
export async function createFromOrder(
  sourceId: ID,
  target: PartTarget,
  quantities?: Record<ID, number>,
): Promise<InvoiceDocument> {
  let source = await db.documents.get(sourceId);
  if (!source || !partTargets(source).includes(target)) throw new Error(t('Document not found'));
  if (source.status === 'cancelled' || source.status === 'void') {
    throw new Error(t('This document is cancelled.'));
  }
  // Invoicing or delivering a draft order confirms it.
  const issued = issuedStatus(source.type);
  if (source.status === 'draft' && issued && source.type !== 'invoice') {
    await setDocumentStatus(source.id, issued);
    source = (await db.documents.get(source.id)) ?? source;
  }
  const company = await db.companies.get(source.companyId);
  if (!company) throw new Error(t('Company not found'));
  const client = source.clientId ? await db.clients.get(source.clientId) : undefined;

  const related = await relatedForProgress(source);
  const progress = await progressOf(source);
  const chosen = new Map<ID, number>();
  for (const p of progress) {
    const left = remainingOf(p, target);
    const wanted = quantities ? (quantities[p.line.id] ?? 0) : left;
    chosen.set(p.line.id, Math.min(Math.max(0, wanted), left));
  }
  const items = copyLines(source.items, chosen, shortId);
  if (!items.some((i) => i.kind === 'item')) {
    throw new Error(
      target === 'delivery_note'
        ? t('Everything on {number} is already on a delivery note.', { number: source.number })
        : target === 'bill'
          ? t('Everything on {number} is already billed.', { number: source.number })
          : t('Everything on {number} is already invoiced.', { number: source.number }),
    );
  }

  const type = target;
  const fresh = await draftDocument(company, type, client ?? null);
  const earlier = related.filter(
    (d) => d.type === type && d.sourceId === source.id && d.status !== 'void',
  );
  const completes = progress.every((p) => (chosen.get(p.line.id) ?? 0) >= remainingOf(p, target));
  const priced = target !== 'delivery_note';
  const wording =
    target === 'bill' ? { notes: '', terms: '' } : carriedWording(company, source, type);
  const doc: InvoiceDocument = {
    ...fresh,
    clientId: source.clientId,
    currency: source.currency,
    exchangeRate: source.exchangeRate,
    // A bill refers to our purchase order; invoices keep the customer's PO number.
    poNumber: source.type === 'purchase_order' ? source.number : source.poNumber,
    items,
    discount: priced ? partDiscount(source, items, earlier, completes) : 0,
    discountType: source.discountType,
    taxes: priced ? source.taxes : [],
    // Shipping and other charges go on the first invoice or bill only.
    charges:
      priced && earlier.length === 0 ? source.charges.map((c) => ({ ...c, id: shortId() })) : [],
    pricesIncludeTax: source.pricesIncludeTax,
    ...wording,
    privateNotes: source.privateNotes,
    templateId: target === 'bill' ? null : source.templateId,
    ...(target !== 'bill' && source.accentColor ? { accentColor: source.accentColor } : {}),
    deliveryDate: target === 'delivery_note' ? fresh.deliveryDate : (source.deliveryDate ?? null),
    deliveryPlace: source.deliveryPlace ?? '',
    sourceId: source.id,
  };
  const saved = await saveDocument(doc);
  await logActivity(
    source.companyId,
    source.type,
    source.id,
    'converted',
    { text: CREATED_LOG[target], vars: { number: saved.number, source: source.number } },
    { clientId: source.clientId || null, documentId: source.id },
  );
  return saved;
}

/** Records that the goods on a delivery note were handed over and who signed for them. */
export async function markDelivered(
  id: ID,
  receipt: { date: ISODate; receiverName: string; receiverCivilId?: string },
): Promise<void> {
  const doc = await db.documents.get(id);
  if (!doc || doc.type !== 'delivery_note') throw new Error(t('Document not found'));
  const receiverName = receipt.receiverName.trim();
  await setDocumentStatus(
    id,
    'delivered',
    receiverName
      ? {
          text: msg('{number} delivered and received by {name}'),
          vars: { number: doc.number, name: receiverName },
        }
      : undefined,
    {
      deliveryDate: receipt.date,
      receiverName,
      receiverCivilId: (receipt.receiverCivilId ?? '').replace(/\s/g, ''),
    },
  );
}
