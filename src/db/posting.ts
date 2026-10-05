import { db } from './db';
import { accountingSettings } from './chart-setup';
import type { Client, Company, ID, InvoiceDocument, PostingSnapshot } from './types';
import { isPosted, postingSnapshot } from '@/lib/accounting/ledger';

/**
 * What an issued document posts with (see `InvoiceDocument.posting`): fixed
 * when it is issued, so that later changes to its contact's tax exemption or
 * to a product's income account leave the books as they were.
 */

/** The snapshot of a document being issued: its contact and products as they are now. */
export async function currentPosting(
  doc: InvoiceDocument,
  client: Pick<Client, 'taxExempt'> | null | undefined,
): Promise<PostingSnapshot> {
  const ids = [...new Set(doc.items.map((i) => i.productId).filter((id): id is ID => Boolean(id)))];
  const products = ids.length ? await db.products.bulkGet(ids) : [];
  const accounts = new Map(
    products.filter((p) => p !== undefined).map((p) => [p.id, p.incomeAccountId]),
  );
  return postingSnapshot(doc, Boolean(client?.taxExempt), accounts);
}

/**
 * A document as it is saved: in the books, with its snapshot; otherwise
 * without one. Editing an issued document keeps what it was issued with
 * (same contact; the same product on a line); new lines, a new product or
 * another contact take the settings of the day, and so does a document
 * issued now (from a draft, or restored from void).
 */
export async function withPosting(
  doc: InvoiceDocument,
  client: Pick<Client, 'taxExempt'> | null | undefined,
  existing?: InvoiceDocument,
): Promise<InvoiceDocument> {
  if (!isPosted(doc)) {
    const next = { ...doc };
    delete next.posting;
    return next;
  }
  const fresh = await currentPosting(doc, client);
  const before =
    existing && isPosted(existing) && existing.clientId === doc.clientId
      ? existing.posting
      : undefined;
  if (!before) return { ...doc, posting: fresh };
  const accounts = { ...fresh.accounts };
  for (const item of doc.items) {
    const was = existing!.items.find((i) => i.id === item.id);
    if (!was || was.productId !== item.productId) continue;
    const account = before.accounts[item.id];
    if (account) accounts[item.id] = account;
    else delete accounts[item.id];
  }
  return { ...doc, posting: { taxExempt: before.taxExempt, accounts } };
}

/** Sales documents with a line of the product: they post to its income account. */
export function sellsProduct(productId: ID): (doc: InvoiceDocument) => boolean {
  return (doc) =>
    (doc.type === 'invoice' || doc.type === 'credit') &&
    doc.items.some((i) => i.productId === productId);
}

/**
 * Before a contact's tax exemption or a product's income account changes:
 * issued documents dated on or before the lock date that still follow the
 * settings (issued before snapshots were kept) get one with the settings
 * they post with now, so a closed period doesn't change. Must run in a
 * transaction that can write documents and read clients and products.
 */
export async function freezeLockedPostings(
  company: Company,
  affected: (doc: InvoiceDocument) => boolean,
): Promise<void> {
  const lock = accountingSettings(company).lockDate;
  if (!lock) return;
  const docs = (await db.documents.where('companyId').equals(company.id).toArray()).filter(
    (d) => !d.posting && isPosted(d) && d.issueDate <= lock && affected(d),
  );
  if (docs.length === 0) return;
  const [clients, products] = await Promise.all([
    db.clients.where('companyId').equals(company.id).toArray(),
    db.products.where('companyId').equals(company.id).toArray(),
  ]);
  const exempt = new Set(clients.filter((c) => c.taxExempt).map((c) => c.id));
  const accounts = new Map(products.map((p) => [p.id, p.incomeAccountId]));
  await db.documents.bulkPut(
    docs.map((d) => ({ ...d, posting: postingSnapshot(d, exempt.has(d.clientId), accounts) })),
  );
}
