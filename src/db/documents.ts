import Dexie from 'dexie';
import { db } from './db';
import { createDocument, defaultNumbering, emptyTotals, nowStamp } from './defaults';
import { logActivity, type ActivityMessage } from './activity';
import type {
  Account,
  Client,
  Company,
  DocumentStatus,
  DocumentType,
  FixedAsset,
  ID,
  InvoiceDocument,
  TaxLine,
} from './types';
import {
  computeDocument,
  documentTaxExempt,
  releasedRetention,
  takesRetention,
} from '@/lib/document-calc';
import { retentionDefaults } from '@/lib/retention';
import { taxLineOf } from '@/lib/calc';
import {
  allocateFrom,
  allocateNumber,
  canReserveCounters,
  reserveCounter,
  type ReservedCounter,
} from '@/lib/numbering';
import { issuedStatus, settledStatus } from '@/lib/status';
import { addDaysISO, today } from '@/lib/dates';
import { shortId } from '@/lib/ids';
import { currencyPrecision, dec, round, toMinor } from '@/lib/money';
import { isPosted } from '@/lib/accounting/ledger';
import { isPurchaseType, postsToLedger } from '@/lib/document-types';
import { deliveryStatusOf, lineProgress, orderStatus } from '@/lib/orders';
import { msg, t } from '@/i18n';
import { assertUnlocked, ensureSpecAccount } from './accounting';
import { billAssetLines } from './assets';
import { syncDocumentStock, withStockTables } from './inventory';
import { withPosting } from './posting';

/** Activity log messages of each type (English keys, shown in the reader's language). */
const LOG: Record<DocumentType, { created: string; updated: string; deleted: string }> = {
  invoice: {
    created: msg('Invoice {number} created'),
    updated: msg('Invoice {number} updated'),
    deleted: msg('Invoice {number} deleted'),
  },
  quote: {
    created: msg('Quote {number} created'),
    updated: msg('Quote {number} updated'),
    deleted: msg('Quote {number} deleted'),
  },
  credit: {
    created: msg('Credit note {number} created'),
    updated: msg('Credit note {number} updated'),
    deleted: msg('Credit note {number} deleted'),
  },
  bill: {
    created: msg('Bill {number} created'),
    updated: msg('Bill {number} updated'),
    deleted: msg('Bill {number} deleted'),
  },
  vendor_credit: {
    created: msg('Vendor credit {number} created'),
    updated: msg('Vendor credit {number} updated'),
    deleted: msg('Vendor credit {number} deleted'),
  },
  proforma: {
    created: msg('Proforma invoice {number} created'),
    updated: msg('Proforma invoice {number} updated'),
    deleted: msg('Proforma invoice {number} deleted'),
  },
  sales_order: {
    created: msg('Sales order {number} created'),
    updated: msg('Sales order {number} updated'),
    deleted: msg('Sales order {number} deleted'),
  },
  purchase_order: {
    created: msg('Purchase order {number} created'),
    updated: msg('Purchase order {number} updated'),
    deleted: msg('Purchase order {number} deleted'),
  },
  delivery_note: {
    created: msg('Delivery note {number} created'),
    updated: msg('Delivery note {number} updated'),
    deleted: msg('Delivery note {number} deleted'),
  },
};

const STATUS_LOG: Partial<Record<DocumentStatus, string>> = {
  sent: msg('{number} marked as sent'),
  accepted: msg('{number} marked as accepted'),
  declined: msg('{number} marked as declined'),
  void: msg('{number} voided'),
  confirmed: msg('{number} confirmed'),
  issued: msg('{number} issued'),
  delivered: msg('{number} marked as delivered'),
  cancelled: msg('{number} cancelled'),
  draft: msg('{number} moved back to draft'),
};

function statusMessage(doc: InvoiceDocument, status: DocumentStatus): ActivityMessage {
  const vars = { number: doc.number };
  if (doc.status === 'void' || doc.status === 'cancelled') {
    return { text: msg('{number} restored'), vars };
  }
  if (status === 'sent' && (doc.type === 'bill' || doc.type === 'vendor_credit')) {
    return { text: msg('{number} marked as open'), vars };
  }
  return { text: STATUS_LOG[status] ?? msg('{number} updated'), vars };
}

/** Tax rates applied by default to new lines / documents. */
export async function defaultTaxes(company: Company): Promise<TaxLine[]> {
  const ids = company.defaults.defaultTaxRateIds;
  if (ids.length === 0) return [];
  const rates = await db.taxRates.bulkGet(ids);
  return rates.filter((r): r is NonNullable<typeof r> => Boolean(r && !r.archived)).map(taxLineOf);
}

/** The company's default notes and terms of a type (empty when it has none). */
export function defaultWording(
  company: Company,
  type: DocumentType,
): { notes: string; terms: string } {
  const d = company.defaults;
  if (type === 'invoice') return { notes: d.invoiceNotes, terms: d.invoiceTerms };
  if (type === 'quote') return { notes: d.quoteNotes, terms: d.quoteTerms };
  if (type === 'credit') return { notes: d.creditNotes, terms: d.creditTerms };
  return { notes: '', terms: '' };
}

/** A new, unsaved document pre-filled from company (and client) defaults. */
export async function draftDocument(
  company: Company,
  type: DocumentType,
  client: Client | null = null,
): Promise<InvoiceDocument> {
  const issueDate = today();
  const d = company.defaults;
  const terms = client?.paymentTermsDays ?? d.paymentTermsDays;
  const taxes = await defaultTaxes(company);
  const wording = defaultWording(company, type);
  const priced = type !== 'delivery_note';
  return createDocument(company.id, type, {
    ...retentionDefaults(client, type, issueDate),
    clientId: client?.id ?? '',
    issueDate,
    dueDate:
      type === 'invoice' || type === 'bill'
        ? addDaysISO(issueDate, terms)
        : type === 'quote' || type === 'proforma'
          ? addDaysISO(issueDate, d.quoteValidDays)
          : null,
    // A delivery note is usually written on the day the goods go out.
    deliveryDate: type === 'delivery_note' ? issueDate : null,
    currency: client?.currency || company.currency,
    taxes: d.documentTaxes && priced ? taxes : [],
    notes: wording.notes,
    terms: wording.terms,
    // Quotes start with the company's introduction, when it has one.
    ...(type === 'quote' && d.quoteIntro?.trim() ? { intro: d.quoteIntro } : {}),
    // Bills are the vendor's documents: nothing of ours is printed on them.
    footer: type === 'bill' || type === 'vendor_credit' ? '' : d.footer,
    pricesIncludeTax: isPurchaseType(type) ? false : d.pricesIncludeTax,
    items: [
      {
        id: shortId(),
        kind: 'item',
        productId: null,
        name: '',
        description: '',
        quantity: 1,
        unit: '',
        unitPrice: 0,
        discount: 0,
        discountType: 'percent',
        taxes: d.lineTaxes && priced ? taxes : [],
      },
    ],
  });
}

/**
 * Amount paid (invoices, bills) or applied (credit notes, vendor credits) so
 * far. Void payments (returned or cancelled cheques) don't count.
 */
export async function paidAmount(doc: Pick<InvoiceDocument, 'id' | 'type'>): Promise<number> {
  if (doc.type === 'invoice' || doc.type === 'bill') {
    const payments = await db.payments
      .where('documentIds')
      .equals(doc.id)
      .filter((p) => !p.voided)
      .toArray();
    return payments.reduce(
      (sum, p) =>
        sum +
        p.allocations.filter((a) => a.documentId === doc.id).reduce((s, a) => s + a.amount, 0),
      0,
    );
  }
  if (doc.type === 'credit' || doc.type === 'vendor_credit') {
    const uses = await db.payments
      .where('creditId')
      .equals(doc.id)
      .filter((p) => !p.voided)
      .toArray();
    return uses.reduce((sum, p) => sum + p.amount, 0);
  }
  return 0;
}

/** Recomputes cached totals and payment-driven status. */
export function applyTotals(
  doc: InvoiceDocument,
  paid: number,
  client: Pick<Client, 'taxExempt'> | null,
): InvoiceDocument {
  // An issued document keeps the tax exemption it was issued with.
  const result = computeDocument(doc, { paid, taxExempt: documentTaxExempt(doc, client) });
  const totals: InvoiceDocument['totals'] = {
    subtotal: result.subtotal,
    discount: result.discount,
    taxTotal: result.taxTotal,
    total: result.total,
    paid: result.paid,
    balance: result.balance,
  };
  if (result.retention !== 0) totals.retention = result.retention;
  // Only documents that take payments move between sent, partially paid and
  // paid. A retention still held is not due yet, so it doesn't keep them open.
  let status: DocumentStatus = doc.status;
  if (postsToLedger(doc.type) && doc.status !== 'void') {
    const due = round(
      dec(result.total).minus(dec(result.retentionHeld)),
      currencyPrecision(doc.currency || 'KWD'),
    );
    status = settledStatus(doc, due, result.paid);
  }
  const settled = status === 'paid' || status === 'applied';
  return {
    ...doc,
    totals,
    status,
    paidAt: settled ? (doc.paidAt ?? nowStamp()) : null,
    sentAt: status !== 'draft' && !doc.sentAt ? nowStamp() : doc.sentAt,
  };
}

export async function recalculateDocuments(ids: Iterable<ID>): Promise<void> {
  for (const id of new Set(ids)) {
    const doc = await db.documents.get(id);
    if (!doc) continue;
    const client = doc.clientId ? await db.clients.get(doc.clientId) : undefined;
    const updated = applyTotals(doc, await paidAmount(doc), client ?? null);
    await db.documents.put({ ...updated, updatedAt: doc.updatedAt });
  }
}

/** Documents created from `id`: invoices, bills and delivery notes of an order, credit notes… */
export async function documentsCreatedFrom(id: ID): Promise<InvoiceDocument[]> {
  return db.documents.where('sourceId').equals(id).toArray();
}

/**
 * What an order's (or invoice's) progress is worked out from: the documents
 * created from it and, for a sales order, the delivery notes of its invoices.
 */
export async function relatedForProgress(
  doc: Pick<InvoiceDocument, 'id' | 'type'>,
): Promise<InvoiceDocument[]> {
  const direct = await documentsCreatedFrom(doc.id);
  if (doc.type !== 'sales_order') return direct;
  const invoiceIds = direct.filter((d) => d.type === 'invoice').map((d) => d.id);
  if (invoiceIds.length === 0) return direct;
  const notes = await db.documents
    .where('sourceId')
    .anyOf(invoiceIds)
    .filter((d) => d.type === 'delivery_note')
    .toArray();
  return [...direct, ...notes];
}

/** Brings a sales or purchase order's stored status and delivery progress up to date. */
async function refreshOrder(id: ID | null | undefined): Promise<void> {
  if (!id) return;
  const order = await db.documents.get(id);
  if (!order || (order.type !== 'sales_order' && order.type !== 'purchase_order')) return;
  const progress = lineProgress(order, await relatedForProgress(order));
  const next: InvoiceDocument = { ...order, status: orderStatus(order, progress) };
  if (order.type === 'sales_order') next.deliveryStatus = deliveryStatusOf(progress);
  if (next.status !== order.status || next.deliveryStatus !== order.deliveryStatus) {
    await db.documents.put(next);
  }
}

/**
 * Updates the orders whose progress depends on `doc`: the order itself, the
 * order it was created from and, for a delivery note of an invoice, the
 * invoice's order.
 */
async function refreshOrdersOf(doc: Pick<InvoiceDocument, 'id' | 'type' | 'sourceId'>) {
  await refreshOrder(doc.id);
  if (!doc.sourceId) return;
  await refreshOrder(doc.sourceId);
  if (doc.type === 'delivery_note') {
    const source = await db.documents.get(doc.sourceId);
    if (source?.type === 'invoice') await refreshOrder(source.sourceId);
  }
}

/**
 * Brings the orders that depend on these documents up to date (after their
 * changes came from another device).
 */
export async function refreshOrdersFor(ids: Iterable<ID>): Promise<void> {
  await db.transaction('rw', [db.documents], async () => {
    for (const id of new Set(ids)) {
      const doc = await db.documents.get(id);
      if (doc) await refreshOrdersOf(doc);
    }
  });
}

async function takenNumbers(
  companyId: ID,
  type: DocumentType,
  exceptId?: ID,
): Promise<Set<string>> {
  const docs = await db.documents.where('[companyId+type]').equals([companyId, type]).toArray();
  return new Set(docs.filter((d) => d.id !== exceptId).map((d) => d.number.trim().toLowerCase()));
}

const sameNumber = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether another document of this kind has the number. A document keeps the
 * number it was saved with, even when another device gave it to a document
 * too (that is listed as a sync problem, in Settings → Cloud).
 */
export async function isNumberTaken(
  companyId: ID,
  type: DocumentType,
  number: string,
  exceptId?: ID,
): Promise<boolean> {
  const own = exceptId ? await db.documents.get(exceptId) : undefined;
  if (own && own.type === type && sameNumber(own.number, number)) return false;
  const taken = await takenNumbers(companyId, type, exceptId);
  return taken.has(number.trim().toLowerCase());
}

/**
 * For a new document without a number in a company kept in the cloud: the
 * next counter taken on the server while online, so two devices never give
 * the same number. Null to number on this device (offline, kept on this
 * device only, or called inside a transaction, which can't wait for the
 * network). A save that is going to be refused takes none: a number taken
 * in the cloud is used up even when the document isn't saved.
 */
async function reserveDocumentCounter(input: InvoiceDocument): Promise<ReservedCounter | null> {
  if (!canReserveCounters() || input.number.trim() || Dexie.currentTransaction) return null;
  if (await db.documents.get(input.id)) return null;
  const company = await db.companies.get(input.companyId);
  if (!company) return null;
  // What saveDocument refuses in a new document before numbering it: a date
  // in the locked period (it says so itself).
  if (isPosted(input)) {
    try {
      assertUnlocked(company, input.issueDate);
    } catch {
      return null;
    }
  }
  const rule = company.numbering[input.type] ?? defaultNumbering()[input.type];
  const taken = await takenNumbers(company.id, input.type, input.id);
  const local = allocateNumber(rule, input.issueDate, (n) => taken.has(n.toLowerCase()));
  return reserveCounter({
    companyId: company.id,
    kind: input.type,
    date: input.issueDate,
    min: local.rule.next - 1,
  });
}

/** Next number that would be assigned, for display before saving. */
export async function suggestNumber(
  company: Company,
  type: DocumentType,
  issueDate: string,
  clientNumber = '',
) {
  const taken = await takenNumbers(company.id, type);
  return allocateNumber(
    company.numbering[type] ?? defaultNumbering()[type],
    issueDate,
    (n) => taken.has(n.toLowerCase()),
    clientNumber,
  ).number;
}

export class RetentionError extends Error {}

/** Releases not undone: their entries need the document to stay in the books. */
function hasActiveReleases(doc: Pick<InvoiceDocument, 'retentionReleases'>): boolean {
  return (doc.retentionReleases ?? []).some((r) => !r.reversedOn);
}

function releasesFirstError(): RetentionError {
  return new RetentionError(t('Undo the retention releases on this document first.'));
}

/**
 * The retention fields as they may be saved: only invoices and bills hold
 * one back, and releases are only ever recorded by the retention module, so
 * an editor working on an older copy can't drop them.
 */
function withRetention(doc: InvoiceDocument, existing: InvoiceDocument | undefined) {
  const next: InvoiceDocument = { ...doc, retentionReleases: existing?.retentionReleases };
  if (!takesRetention(doc.type)) {
    delete next.retentionPercent;
    delete next.retentionKind;
  }
  if (!next.retentionReleases?.length) delete next.retentionReleases;
  return next;
}

export class DuplicateNumberError extends Error {
  constructor(number: string) {
    super(t('The number {number} is already used by another document.', { number }));
  }
}

/** A change that would leave the books out of step with what depends on the document. */
export class DocumentChangeError extends Error {}

/** A document's currency is fixed once payments or credits are recorded on it. */
async function assertCurrencyKept(
  existing: InvoiceDocument | undefined,
  next: InvoiceDocument,
): Promise<void> {
  if (!existing || existing.currency === next.currency) return;
  const [payments, uses] = await Promise.all([
    db.payments.where('documentIds').equals(existing.id).count(),
    db.payments.where('creditId').equals(existing.id).count(),
  ]);
  if (payments + uses > 0) {
    throw new DocumentChangeError(
      t('Payments or credits are recorded on {number}, so its currency can’t change.', {
        number: existing.number,
      }),
    );
  }
}

const assetLabel = (asset: Pick<FixedAsset, 'number' | 'name'>) =>
  `${asset.number} ${asset.name}`.trim();

/** Assets in the register (not void) made from lines of a bill. */
async function assetsFromBill(doc: InvoiceDocument): Promise<FixedAsset[]> {
  if (doc.type !== 'bill') return [];
  return db.assets
    .where('companyId')
    .equals(doc.companyId)
    .filter((a) => a.billId === doc.id && a.status !== 'void')
    .toArray();
}

/**
 * An asset made from a bill line is in the books through the bill: the bill
 * can't leave the books (void, draft, deleted) while the asset is in the
 * register.
 */
async function assertNoAssets(doc: InvoiceDocument): Promise<void> {
  const [asset] = await assetsFromBill(doc);
  if (asset) {
    throw new DocumentChangeError(
      t('Asset {asset} was made from this bill. Void the asset first.', {
        asset: assetLabel(asset),
      }),
    );
  }
}

/**
 * Bill lines that assets were made from must keep posting the same cost to
 * the same account, or the register and the books would disagree.
 */
async function assertAssetLinesKept(
  company: Company,
  existing: InvoiceDocument | undefined,
  next: InvoiceDocument,
  accounts: Account[],
): Promise<void> {
  if (!existing) return;
  const assets = await assetsFromBill(existing);
  if (assets.length === 0) return;
  if (!isPosted(next)) await assertNoAssets(existing);
  const p = currencyPrecision(company.currency);
  const before = billAssetLines(company, [existing], accounts, []);
  const after = billAssetLines(company, [next], accounts, []);
  for (const asset of assets) {
    const was = before.find((l) => l.line.id === asset.billLineId);
    const now = after.find((l) => l.line.id === asset.billLineId);
    const same =
      was &&
      now &&
      was.accountId === now.accountId &&
      toMinor(was.cost, p) === toMinor(now.cost, p);
    if (was && !same) {
      throw new DocumentChangeError(
        t(
          'Asset {asset} was made from line “{line}” of this bill, so the line can’t change. Void the asset first.',
          { asset: assetLabel(asset), line: was.line.name },
        ),
      );
    }
  }
}

/**
 * Takes the credit notes (vendor credits) applied to a document that leaves
 * the books off it, or, for a credit, its own applications: the credit is
 * free to use again and the invoice (bill) is owed again. Returns the other
 * documents to recalculate. An application taken off entirely is deleted
 * with its files. An application that posted an exchange difference keeps
 * its entry in a locked period, so it can't be taken off there.
 */
async function takeOffCredits(doc: InvoiceDocument, company: Company): Promise<ID[]> {
  const credit = doc.type === 'credit' || doc.type === 'vendor_credit';
  if (!credit && doc.type !== 'invoice' && doc.type !== 'bill') return [];
  const applications = (
    credit
      ? await db.payments.where('creditId').equals(doc.id).toArray()
      : await db.payments.where('documentIds').equals(doc.id).toArray()
  ).filter((p) => p.method === 'credit_note');
  const touched = new Set<ID>();
  for (const application of applications) {
    const ids = [
      ...application.documentIds,
      ...(application.creditId ? [application.creditId] : []),
    ];
    const related = await db.documents.bulkGet(ids);
    if (related.some((d) => d && d.currency !== company.currency)) {
      assertUnlocked(company, application.date);
    }
    for (const id of ids) touched.add(id);
    const rest = credit ? [] : application.allocations.filter((a) => a.documentId !== doc.id);
    if (rest.length === 0) {
      await db.payments.delete(application.id);
      await db.attachments.where('ownerId').equals(application.id).delete();
      await logActivity(
        company.id,
        'payment',
        application.id,
        'deleted',
        { text: msg('Payment {number} deleted'), vars: { number: application.number } },
        { clientId: application.clientId || null },
      );
      continue;
    }
    const removed = application.allocations
      .filter((a) => a.documentId === doc.id)
      .reduce((sum, a) => sum.plus(dec(a.amount)), dec(0));
    await db.payments.put({
      ...application,
      amount: round(
        dec(application.amount).minus(removed),
        currencyPrecision(application.currency),
      ),
      allocations: rest,
      documentIds: rest.map((a) => a.documentId),
      updatedAt: nowStamp(),
    });
  }
  touched.delete(doc.id);
  return [...touched];
}

/**
 * Saves a document: assigns a number when it has none, recomputes totals and
 * advances the company's counter. Orders it belongs to are brought up to
 * date. Returns the stored document.
 */
export async function saveDocument(input: InvoiceDocument): Promise<InvoiceDocument> {
  const reserved = await reserveDocumentCounter(input);
  return db.transaction(
    'rw',
    withStockTables([
      db.documents,
      db.companies,
      db.clients,
      db.payments,
      db.activities,
      db.accounts,
      db.products,
      db.assets,
    ]),
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new Error(t('Company not found'));
      const existing = await db.documents.get(input.id);
      if (isPosted(input) || (existing && isPosted(existing))) {
        assertUnlocked(company, input.issueDate, existing?.issueDate);
      }
      const client = input.clientId ? await db.clients.get(input.clientId) : undefined;
      let doc: InvoiceDocument = withRetention({ ...input, number: input.number.trim() }, existing);
      await assertCurrencyKept(existing, doc);
      // What it posts with is fixed when it is issued and kept through edits.
      doc = await withPosting(doc, client, existing);
      if (existing?.type === 'bill') {
        const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
        await assertAssetLinesKept(company, existing, doc, accounts);
      }

      const taken = await takenNumbers(company.id, doc.type, doc.id);
      if (!doc.number) {
        // Companies created before a document type existed have no rule for it yet.
        const rule = company.numbering[doc.type] ?? defaultNumbering()[doc.type];
        const allocated = allocateFrom(
          rule,
          doc.issueDate,
          (n) => taken.has(n.toLowerCase()),
          client?.number ?? '',
          reserved,
        );
        doc.number = allocated.number;
        await db.companies.put({
          ...company,
          numbering: { ...company.numbering, [doc.type]: allocated.rule },
        });
      } else if (
        taken.has(doc.number.toLowerCase()) &&
        // Saved again with the number it has: never refused, even when
        // another device gave the same number to a document.
        !(existing && existing.type === doc.type && sameNumber(existing.number, doc.number))
      ) {
        throw new DuplicateNumberError(doc.number);
      }

      doc = applyTotals(doc, existing ? await paidAmount(existing) : 0, client ?? null);
      if (dec(releasedRetention(doc)).gt(dec(doc.totals.retention ?? 0))) {
        throw new RetentionError(
          t(
            'More retention has been released than this document would hold. Undo a release first.',
          ),
        );
      }
      if (isPosted(doc) && doc.totals.retention) {
        // Held-back money waits in 1110 Retentions receivable (2010 payable).
        await ensureSpecAccount(
          company,
          doc.type === 'bill' ? 'retentionsPayable' : 'retentionsReceivable',
        );
      }
      doc.updatedAt = nowStamp();
      if (!existing) doc.createdAt = doc.updatedAt;
      await db.documents.put(doc);
      await syncDocumentStock(company.id, doc.id);

      await logActivity(
        company.id,
        doc.type,
        doc.id,
        existing ? 'updated' : 'created',
        { text: LOG[doc.type][existing ? 'updated' : 'created'], vars: { number: doc.number } },
        { clientId: doc.clientId || null, documentId: doc.id },
      );
      await refreshOrdersOf(doc);
      return (await db.documents.get(doc.id)) ?? doc;
    },
  );
}

/** What a status change writes to. */
const statusTables = () =>
  withStockTables([
    db.documents,
    db.clients,
    db.payments,
    db.companies,
    db.activities,
    db.accounts,
    db.products,
    db.assets,
    db.attachments,
  ]);

/**
 * Changes a document's status. `patch` is stored with it (for example who
 * signed a delivery note).
 */
export async function setDocumentStatus(
  id: ID,
  status: DocumentStatus,
  message?: ActivityMessage,
  patch: Partial<InvoiceDocument> = {},
): Promise<void> {
  await db.transaction('rw', statusTables(), async () => {
    const doc = await db.documents.get(id);
    if (!doc) return;
    const company = await db.companies.get(doc.companyId);
    const posted = isPosted({ type: doc.type, status });
    if (company && isPosted(doc) !== posted) {
      assertUnlocked(company, doc.issueDate);
    }
    if (hasActiveReleases(doc) && !posted) {
      throw releasesFirstError();
    }
    // Leaving the books: assets made from it are refused, credits applied
    // to (or from) it are taken off.
    const leaving = isPosted(doc) && !posted;
    if (leaving) await assertNoAssets(doc);
    const credited = leaving && company ? await takeOffCredits(doc, company) : [];
    let next: InvoiceDocument = { ...doc, ...patch, status, updatedAt: nowStamp() };
    if (status === issuedStatus(doc.type) && !doc.sentAt) next.sentAt = nowStamp();
    if (postsToLedger(doc.type) && status !== 'void' && status !== 'draft') {
      // Let payments decide between sent / partial / paid.
      const client = doc.clientId ? await db.clients.get(doc.clientId) : undefined;
      // Issued now: what it posts with is fixed from now on.
      if (!isPosted(doc)) next = await withPosting(next, client);
      next = applyTotals({ ...next, status: 'sent' }, await paidAmount(doc), client ?? null);
    } else if (leaving) {
      // Voided or back to draft: its totals follow what is still applied to
      // it now that its credits are off; the status stays as asked.
      const client = doc.clientId ? await db.clients.get(doc.clientId) : undefined;
      const { totals } = applyTotals(next, await paidAmount(doc), client ?? null);
      next = { ...next, totals, paidAt: null };
    }
    if (company && isPosted(next) && next.totals.retention) {
      await ensureSpecAccount(
        company,
        next.type === 'bill' ? 'retentionsPayable' : 'retentionsReceivable',
      );
    }
    await db.documents.put(next);
    // The credit is free again, and what it was applied to is owed again.
    await recalculateDocuments(credited);
    await syncDocumentStock(doc.companyId, doc.id);
    await logActivity(
      doc.companyId,
      doc.type,
      doc.id,
      `status:${status}`,
      message ?? statusMessage(doc, status),
      { clientId: doc.clientId || null, documentId: doc.id },
    );
    // A confirmed order picks up the invoices already made from it.
    await refreshOrdersOf(next);
  });
}

/**
 * Takes a draft out of the office: sent (invoices, quotes, proformas, credit
 * notes), open (bills), confirmed (sales orders) or issued (purchase orders).
 */
export async function markSent(id: ID): Promise<void> {
  const doc = await db.documents.get(id);
  if (!doc || doc.status !== 'draft') return;
  const status = issuedStatus(doc.type);
  if (status) await setDocumentStatus(id, status);
}

class TriedOnly extends Error {}

/**
 * Whether markSent would go through now, without changing anything: it runs
 * and is rolled back, and its error (a locked period, a role that may not
 * change the document…) is thrown as it would be. Done before a draft's
 * signed copy is handed out, so it never leaves while the document stays a
 * draft.
 */
export async function checkMarkSent(id: ID): Promise<void> {
  try {
    await db.transaction('rw', statusTables(), async () => {
      await markSent(id);
      throw new TriedOnly();
    });
  } catch (error) {
    if (!(error instanceof TriedOnly)) throw error;
  }
}

/** Deletes a document. Payments that referenced it keep their money as unapplied credit. */
export async function deleteDocument(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    withStockTables([
      db.documents,
      db.payments,
      db.activities,
      db.clients,
      db.companies,
      db.attachments,
      db.assets,
    ]),
    async () => {
      const doc = await db.documents.get(id);
      if (!doc) return;
      const company = await db.companies.get(doc.companyId);
      if (company && isPosted(doc)) assertUnlocked(company, doc.issueDate);
      if (hasActiveReleases(doc)) throw releasesFirstError();
      await assertNoAssets(doc);
      await db.attachments.where('ownerId').equals(id).delete();
      // Credits applied to it (or, for a credit, its applications) are taken
      // off: the credit can be used again.
      const credited = company ? await takeOffCredits(doc, company) : [];
      // Money paid against it stays on the payment as unapplied credit.
      const payments = await db.payments.where('documentIds').equals(id).toArray();
      for (const p of payments) {
        const allocations = p.allocations.filter((a) => a.documentId !== id);
        await db.payments.put({
          ...p,
          allocations,
          documentIds: allocations.map((a) => a.documentId),
        });
      }
      await recalculateDocuments(credited);
      // Documents created from this one lose the link.
      for (const d of await documentsCreatedFrom(id)) {
        await db.documents.put({ ...d, sourceId: null });
      }
      // A quote or proforma converted into this document can be converted again.
      const source = doc.sourceId ? await db.documents.get(doc.sourceId) : undefined;
      if (source && source.convertedToId === doc.id) {
        const reopened = source.status === 'invoiced' || source.status === 'converted';
        await db.documents.put({
          ...source,
          convertedToId: null,
          status: reopened ? 'accepted' : source.status,
        });
      }
      await db.documents.delete(id);
      await syncDocumentStock(doc.companyId, doc.id);
      await logActivity(
        doc.companyId,
        doc.type,
        doc.id,
        'deleted',
        { text: LOG[doc.type].deleted, vars: { number: doc.number } },
        { clientId: doc.clientId || null },
      );
      await refreshOrdersOf(doc);
    },
  );
}

/** Copies a document as a new draft (new number, today's date). */
export async function duplicateDocument(
  id: ID,
  asType?: DocumentType,
  overrides: Partial<InvoiceDocument> = {},
): Promise<InvoiceDocument> {
  const source = await db.documents.get(id);
  if (!source) throw new Error(t('Document not found'));
  const company = await db.companies.get(source.companyId);
  if (!company) throw new Error(t('Company not found'));
  const type = asType ?? source.type;
  const client = source.clientId ? await db.clients.get(source.clientId) : undefined;
  const fresh = await draftDocument(company, type, client ?? null);
  const copy: InvoiceDocument = {
    ...fresh,
    clientId: source.clientId,
    currency: source.currency,
    // A credit note of a dollar invoice is booked at the invoice's rate.
    exchangeRate: source.exchangeRate,
    poNumber: source.poNumber,
    // A copy is a document of its own: it does not count towards an order.
    items: source.items.map((i) => ({ ...i, id: shortId(), sourceLineId: undefined })),
    discount: source.discount,
    discountType: source.discountType,
    taxes: source.taxes,
    charges: source.charges.map((c) => ({ ...c, id: shortId() })),
    pricesIncludeTax: source.pricesIncludeTax,
    notes: type === source.type ? source.notes : fresh.notes,
    terms: type === source.type ? source.terms : fresh.terms,
    footer: source.footer,
    privateNotes: source.privateNotes,
    templateId: source.templateId,
    ...(source.accentColor ? { accentColor: source.accentColor } : {}),
    // A copy of a quote keeps its introduction; another type of document has none.
    ...(type === source.type ? { intro: source.intro } : {}),
    // Credit notes don't print where the goods went.
    deliveryPlace:
      type === 'credit' || type === 'vendor_credit' ? '' : (source.deliveryPlace ?? ''),
    totals: emptyTotals(),
    ...overrides,
  };
  return saveDocument(copy);
}

/**
 * Notes and terms written for a document carry over to the one made from it;
 * the company's default wording of the old type is replaced by the new type's.
 */
export function carriedWording(
  company: Company,
  source: Pick<InvoiceDocument, 'type' | 'notes' | 'terms'>,
  type: DocumentType,
): { notes: string; terms: string } {
  const before = defaultWording(company, source.type);
  const after = defaultWording(company, type);
  const keep = (value: string, standard: string, fallback: string) =>
    value.trim() && value.trim() !== standard.trim() ? value : fallback;
  return {
    notes: keep(source.notes, before.notes, after.notes),
    terms: keep(source.terms, before.terms, after.terms),
  };
}

/** One-to-one conversions: what each type can be turned into. */
export const CONVERSIONS: Partial<
  Record<DocumentType, ('invoice' | 'proforma' | 'sales_order')[]>
> = {
  quote: ['invoice', 'proforma', 'sales_order'],
  proforma: ['invoice'],
};

const CONVERTED_LOG: Record<'invoice' | 'proforma' | 'sales_order', string> = {
  invoice: msg('{number} converted to invoice {target}'),
  proforma: msg('{number} converted to proforma invoice {target}'),
  sales_order: msg('{number} converted to sales order {target}'),
};

/**
 * Turns a quote into an invoice, proforma invoice or sales order, or a
 * proforma into an invoice: lines (with their Arabic names), customer,
 * currency, PO number, notes and the deposit asked for are copied, and both
 * documents point at each other.
 */
export async function convertDocument(
  sourceId: ID,
  to: 'invoice' | 'proforma' | 'sales_order',
): Promise<InvoiceDocument> {
  const source = await db.documents.get(sourceId);
  if (!source || !CONVERSIONS[source.type]?.includes(to)) throw new Error(t('Document not found'));
  const company = await db.companies.get(source.companyId);
  if (!company) throw new Error(t('Company not found'));
  const deposit = to === 'invoice' || to === 'proforma';
  const linked = await duplicateDocument(sourceId, to, {
    sourceId: source.id,
    ...carriedWording(company, source, to),
    exchangeRate: source.exchangeRate,
    deposit: deposit ? source.deposit : 0,
    depositDueDate: deposit ? source.depositDueDate : null,
    deliveryDate: source.deliveryDate ?? null,
  });
  await db.documents.update(source.id, {
    status: source.type === 'quote' && to === 'invoice' ? 'invoiced' : 'converted',
    convertedToId: linked.id,
    updatedAt: nowStamp(),
  });
  await logActivity(
    source.companyId,
    source.type,
    source.id,
    'converted',
    { text: CONVERTED_LOG[to], vars: { number: source.number, target: linked.number } },
    { clientId: source.clientId || null, documentId: source.id },
  );
  return linked;
}

/** Creates an invoice from a quote and marks the quote as invoiced. */
export function convertQuoteToInvoice(quoteId: ID): Promise<InvoiceDocument> {
  return convertDocument(quoteId, 'invoice');
}

export function newLineItem(taxes: TaxLine[] = []) {
  return {
    id: shortId(),
    kind: 'item' as const,
    productId: null,
    name: '',
    description: '',
    quantity: 1,
    unit: '',
    unitPrice: 0,
    discount: 0,
    discountType: 'percent' as const,
    taxes,
  };
}

export function newHeading() {
  return { ...newLineItem(), kind: 'heading' as const, quantity: 0 };
}
