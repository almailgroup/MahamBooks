import { db } from './db';
import { createDocument, defaultNumbering, emptyTotals, nowStamp } from './defaults';
import { logActivity } from './activity';
import type {
  Client,
  Company,
  DocumentStatus,
  DocumentType,
  ID,
  InvoiceDocument,
  SalesDocumentType,
  TaxLine,
} from './types';
import { computeDocument } from '@/lib/document-calc';
import { taxLineOf } from '@/lib/calc';
import { allocateNumber } from '@/lib/numbering';
import { settledStatus } from '@/lib/status';
import { addDaysISO, today } from '@/lib/dates';
import { shortId } from '@/lib/ids';
import { isPosted } from '@/lib/accounting/ledger';
import { isPurchaseType } from '@/lib/document-types';
import { assertUnlocked } from './accounting';

export const DOCUMENT_NOUN: Record<DocumentType, string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  credit: 'Credit note',
  bill: 'Bill',
  vendor_credit: 'Vendor credit',
};

/** Tax rates applied by default to new lines / documents. */
export async function defaultTaxes(company: Company): Promise<TaxLine[]> {
  const ids = company.defaults.defaultTaxRateIds;
  if (ids.length === 0) return [];
  const rates = await db.taxRates.bulkGet(ids);
  return rates.filter((r): r is NonNullable<typeof r> => Boolean(r && !r.archived)).map(taxLineOf);
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
  const notes =
    { invoice: d.invoiceNotes, quote: d.quoteNotes, credit: d.creditNotes }[
      type as SalesDocumentType
    ] ?? '';
  const docTerms =
    { invoice: d.invoiceTerms, quote: d.quoteTerms, credit: d.creditTerms }[
      type as SalesDocumentType
    ] ?? '';
  return createDocument(company.id, type, {
    clientId: client?.id ?? '',
    issueDate,
    dueDate:
      type === 'invoice' || type === 'bill'
        ? addDaysISO(issueDate, terms)
        : type === 'quote'
          ? addDaysISO(issueDate, d.quoteValidDays)
          : null,
    currency: client?.currency || company.currency,
    taxes: d.documentTaxes ? taxes : [],
    notes,
    terms: docTerms,
    // Bills are the vendor's documents: nothing of ours is printed on them.
    footer: isPurchaseType(type) ? '' : d.footer,
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
        taxes: d.lineTaxes ? taxes : [],
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
  const result = computeDocument(doc, { paid, taxExempt: client?.taxExempt });
  const totals = {
    subtotal: result.subtotal,
    discount: result.discount,
    taxTotal: result.taxTotal,
    total: result.total,
    paid: result.paid,
    balance: result.balance,
  };
  let status: DocumentStatus = doc.status;
  if (doc.type !== 'quote' && doc.status !== 'void') {
    status = settledStatus(doc, result.total, result.paid);
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

async function takenNumbers(
  companyId: ID,
  type: DocumentType,
  exceptId?: ID,
): Promise<Set<string>> {
  const docs = await db.documents.where('[companyId+type]').equals([companyId, type]).toArray();
  return new Set(docs.filter((d) => d.id !== exceptId).map((d) => d.number.trim().toLowerCase()));
}

export async function isNumberTaken(
  companyId: ID,
  type: DocumentType,
  number: string,
  exceptId?: ID,
): Promise<boolean> {
  const taken = await takenNumbers(companyId, type, exceptId);
  return taken.has(number.trim().toLowerCase());
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

export class DuplicateNumberError extends Error {
  constructor(number: string) {
    super(`The number ${number} is already used by another document.`);
  }
}

/**
 * Saves a document: assigns a number when it has none, recomputes totals and
 * advances the company's counter. Returns the stored document.
 */
export async function saveDocument(input: InvoiceDocument): Promise<InvoiceDocument> {
  return db.transaction(
    'rw',
    [db.documents, db.companies, db.clients, db.payments, db.activities],
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new Error('Company not found');
      const existing = await db.documents.get(input.id);
      if (isPosted(input) || (existing && isPosted(existing))) {
        assertUnlocked(company, input.issueDate, existing?.issueDate);
      }
      const client = input.clientId ? await db.clients.get(input.clientId) : undefined;
      let doc: InvoiceDocument = { ...input, number: input.number.trim() };

      const taken = await takenNumbers(company.id, doc.type, doc.id);
      if (!doc.number) {
        // Companies created before bills existed have no rule for them yet.
        const rule = company.numbering[doc.type] ?? defaultNumbering()[doc.type];
        const allocated = allocateNumber(
          rule,
          doc.issueDate,
          (n) => taken.has(n.toLowerCase()),
          client?.number ?? '',
        );
        doc.number = allocated.number;
        await db.companies.put({
          ...company,
          numbering: { ...company.numbering, [doc.type]: allocated.rule },
        });
      } else if (taken.has(doc.number.toLowerCase())) {
        throw new DuplicateNumberError(doc.number);
      }

      doc = applyTotals(doc, existing ? await paidAmount(existing) : 0, client ?? null);
      doc.updatedAt = nowStamp();
      if (!existing) doc.createdAt = doc.updatedAt;
      await db.documents.put(doc);

      const noun = DOCUMENT_NOUN[doc.type];
      await logActivity(
        company.id,
        doc.type,
        doc.id,
        existing ? 'updated' : 'created',
        `${noun} ${doc.number} ${existing ? 'updated' : 'created'}`,
        { clientId: doc.clientId || null, documentId: doc.id },
      );
      return doc;
    },
  );
}

export async function setDocumentStatus(
  id: ID,
  status: DocumentStatus,
  message?: string,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.documents, db.clients, db.payments, db.companies, db.activities],
    async () => {
      const doc = await db.documents.get(id);
      if (!doc) return;
      const company = await db.companies.get(doc.companyId);
      if (company && isPosted(doc) !== isPosted({ type: doc.type, status })) {
        assertUnlocked(company, doc.issueDate);
      }
      let next: InvoiceDocument = { ...doc, status, updatedAt: nowStamp() };
      if (status === 'sent' && !doc.sentAt) next.sentAt = nowStamp();
      if (doc.type !== 'quote' && status !== 'void' && status !== 'draft') {
        // Let payments decide between sent / partial / paid.
        const client = doc.clientId ? await db.clients.get(doc.clientId) : undefined;
        next = applyTotals({ ...next, status: 'sent' }, await paidAmount(doc), client ?? null);
      }
      await db.documents.put(next);
      await logActivity(
        doc.companyId,
        doc.type,
        doc.id,
        `status:${status}`,
        message ?? `${DOCUMENT_NOUN[doc.type]} ${doc.number} marked as ${status}`,
        { clientId: doc.clientId || null, documentId: doc.id },
      );
    },
  );
}

export async function markSent(id: ID): Promise<void> {
  const doc = await db.documents.get(id);
  if (!doc || doc.status !== 'draft') return;
  await setDocumentStatus(id, 'sent', `${DOCUMENT_NOUN[doc.type]} ${doc.number} marked as sent`);
}

/** Deletes a document. Payments that referenced it keep their money as unapplied credit. */
export async function deleteDocument(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.documents, db.payments, db.activities, db.clients, db.companies, db.attachments],
    async () => {
      const doc = await db.documents.get(id);
      if (!doc) return;
      const company = await db.companies.get(doc.companyId);
      if (company && isPosted(doc)) assertUnlocked(company, doc.issueDate);
      await db.attachments.where('ownerId').equals(id).delete();
      const payments = await db.payments.where('documentIds').equals(id).toArray();
      for (const p of payments) {
        const allocations = p.allocations.filter((a) => a.documentId !== id);
        await db.payments.put({
          ...p,
          allocations,
          documentIds: allocations.map((a) => a.documentId),
        });
      }
      if (doc.type === 'credit' || doc.type === 'vendor_credit') {
        const uses = await db.payments.where('creditId').equals(id).toArray();
        const touched = uses.flatMap((p) => p.documentIds);
        await db.payments.bulkDelete(uses.map((p) => p.id));
        await recalculateDocuments(touched);
      }
      if (doc.type === 'quote') {
        const fromQuote = await db.documents
          .where('companyId')
          .equals(doc.companyId)
          .filter((d) => d.sourceId === id)
          .toArray();
        for (const d of fromQuote) await db.documents.put({ ...d, sourceId: null });
      }
      await db.documents.delete(id);
      await logActivity(
        doc.companyId,
        doc.type,
        doc.id,
        'deleted',
        `${DOCUMENT_NOUN[doc.type]} ${doc.number} deleted`,
        {
          clientId: doc.clientId || null,
        },
      );
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
  if (!source) throw new Error('Document not found');
  const company = await db.companies.get(source.companyId);
  if (!company) throw new Error('Company not found');
  const type = asType ?? source.type;
  const client = source.clientId ? await db.clients.get(source.clientId) : undefined;
  const fresh = await draftDocument(company, type, client ?? null);
  const copy: InvoiceDocument = {
    ...fresh,
    clientId: source.clientId,
    currency: source.currency,
    poNumber: source.poNumber,
    items: source.items.map((i) => ({ ...i, id: shortId() })),
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
    totals: emptyTotals(),
    ...overrides,
  };
  return saveDocument(copy);
}

/** Creates an invoice from a quote and marks the quote as invoiced. */
export async function convertQuoteToInvoice(quoteId: ID): Promise<InvoiceDocument> {
  const quote = await db.documents.get(quoteId);
  if (!quote || quote.type !== 'quote') throw new Error('Quote not found');
  const linked = await duplicateDocument(quoteId, 'invoice', { sourceId: quote.id });
  await db.documents.update(quote.id, {
    status: 'invoiced',
    convertedToId: linked.id,
    updatedAt: nowStamp(),
  });
  await logActivity(
    quote.companyId,
    'quote',
    quote.id,
    'converted',
    `Quote ${quote.number} converted to invoice ${linked.number}`,
    {
      clientId: quote.clientId || null,
      documentId: quote.id,
    },
  );
  return linked;
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
