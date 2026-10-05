import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createProduct } from './defaults';
import { draftDocument, recalculateDocuments, saveDocument } from './documents';
import { loadLedger } from './accounting';
import { saveClient, setupCompany } from './records';
import { saveItem } from './inventory';
import { createPayment, savePayment } from './payments';
import type { Client, Company, InvoiceDocument, Product } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** Ledger lines on or before a date, as "account code: amount". */
async function linesTo(company: Company, date: string) {
  const { accounts, lines } = await loadLedger((await db.companies.get(company.id))!);
  const code = new Map(accounts.map((a) => [a.id, a.code]));
  return lines
    .filter((l) => l.date <= date)
    .map((l) => `${code.get(l.accountId)}: ${l.amount}`)
    .sort();
}

async function books() {
  const company = await setupCompany({ name: 'Review Co' }, [{ name: 'VAT', rate: 5 }]);
  const client = await saveClient(createClient(company.id, { name: 'Sample Client' }));
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const services = accounts.find((a) => a.code === '4100')!;
  const contracts = accounts.find((a) => a.code === '4150')!;
  const product = await saveItem(
    createProduct(company.id, {
      name: 'Maintenance',
      unitPrice: 100,
      incomeAccountId: services.id,
    }),
  );
  return { company, client, product, services, contracts };
}

async function invoice(
  company: Company,
  client: Client,
  product: Product,
  issueDate: string,
): Promise<InvoiceDocument> {
  const draft = await draftDocument(company, 'invoice', client);
  return saveDocument({
    ...draft,
    status: 'sent',
    issueDate,
    items: [{ ...draft.items[0], productId: product.id, name: 'Maintenance', unitPrice: 100 }],
  });
}

async function lock(company: Company, date: string) {
  await db.companies.update(company.id, {
    accounting: { ...company.accounting!, lockDate: date },
  });
}

/** A document as issued before snapshots were kept. */
async function withoutSnapshot(id: string) {
  const doc = (await db.documents.get(id))!;
  delete doc.posting;
  await db.documents.put(doc);
}

describe('issued documents', () => {
  it('keep the tax and income account they were issued with', async () => {
    const { company, client, product, contracts } = await books();
    const issued = await invoice(company, client, product, '2026-03-10');
    expect(issued.totals.total).toBe(105);
    expect(issued.posting).toMatchObject({ taxExempt: false });
    const before = await linesTo(company, '2099-12-31');
    expect(before).toEqual(['1100: 105000', '2100: -5000', '4100: -100000']);

    // Months later the client shows an exemption certificate and the item
    // moves to another income account.
    await saveClient({ ...client, taxExempt: true });
    await saveItem({ ...product, incomeAccountId: contracts.id });
    expect(await linesTo(company, '2099-12-31')).toEqual(before);
    // A payment recalculates the invoice with the tax it was issued with.
    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-04-01',
        amount: 105,
        currency: 'KWD',
        allocations: [{ documentId: issued.id, amount: 105 }],
      }),
    );
    expect((await db.documents.get(issued.id))?.totals).toMatchObject({ total: 105, balance: 0 });

    // Editing it keeps what it was issued with; a line added now takes the
    // item's income account of the day.
    const stored = (await db.documents.get(issued.id))!;
    const edited = await saveDocument({
      ...stored,
      notes: 'Thank you',
      items: [...stored.items, { ...stored.items[0], id: 'extra', quantity: 0.5 }],
    });
    expect(edited.totals.total).toBe(157.5);
    expect(edited.posting).toEqual({
      taxExempt: false,
      accounts: { [stored.items[0].id]: product.incomeAccountId, extra: contracts.id },
    });
  });
});

describe('documents issued before snapshots were kept', () => {
  it('in a locked period, don’t change with the client or the item', async () => {
    const { company, client, product, contracts } = await books();
    const old = await invoice(company, client, product, '2026-03-10');
    const open = await invoice(company, client, product, '2026-08-10');
    await withoutSnapshot(old.id);
    await withoutSnapshot(open.id);
    await lock(company, '2026-06-30');
    const locked = await linesTo(company, '2026-06-30');

    await saveClient({ ...client, taxExempt: true });
    await saveItem({ ...product, incomeAccountId: contracts.id });
    expect(await linesTo(company, '2026-06-30')).toEqual(locked);
    expect((await db.documents.get(old.id))?.posting).toEqual({
      taxExempt: false,
      accounts: { [old.items[0].id]: product.incomeAccountId },
    });
    // After the lock date they follow the settings, as before.
    expect((await db.documents.get(open.id))?.posting).toBeUndefined();
    const all = await linesTo(company, '2099-12-31');
    expect(all.filter((l) => !locked.includes(l))).toEqual(['1100: 100000', '4150: -100000']);
    await recalculateDocuments([old.id]);
    expect((await db.documents.get(old.id))?.totals.total).toBe(105);
  });
});
