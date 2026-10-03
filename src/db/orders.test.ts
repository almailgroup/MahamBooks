import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import {
  convertDocument,
  deleteDocument,
  draftDocument,
  markSent,
  saveDocument,
  setDocumentStatus,
} from './documents';
import { createFromOrder, markDelivered, progressOf } from './orders';
import { loadLedger } from './accounting';
import { saveClient, setupCompany } from './records';
import type { Client, Company, DocumentType, InvoiceDocument, LineItem } from './types';
import { STATUSES_BY_TYPE } from '@/lib/status';
import { isPosted } from '@/lib/accounting/ledger';
import { trialBalance } from '@/lib/accounting/statements';
import { agingReport, salesByClient, taxReport } from '@/lib/reports';
import { today } from '@/lib/dates';
import { sameAmount } from '@/lib/money';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

interface Setup {
  company: Company;
  client: Client;
  vendor: Client;
}

async function setup(): Promise<Setup> {
  const company = await setupCompany({ name: 'Al Waha Trading', currency: 'KWD' });
  const client = await saveClient(
    createClient(company.id, { name: 'Al Rawda Trading', nameAr: 'الروضة التجارية' }),
  );
  const vendor = await saveClient(
    createClient(company.id, { name: 'Gulf Paper', isCustomer: false, isVendor: true }),
  );
  return { company, client, vendor };
}

const lines = (doc: InvoiceDocument, items: Partial<LineItem>[]): LineItem[] =>
  items.map((item, i) => ({ ...doc.items[0], id: `line-${i}`, taxes: [], ...item }));

/** A confirmed order for 5 printers at KD 125.250 and 40 label rolls at KD 3.125. */
async function salesOrder({ company, client }: Setup): Promise<InvoiceDocument> {
  const draft = await draftDocument(company, 'sales_order', client);
  const order = await saveDocument({
    ...draft,
    poNumber: 'LPO-55120',
    notes: 'Deliver to the Shuwaikh warehouse.',
    deliveryPlace: 'Warehouse 4, Shuwaikh Industrial',
    items: lines(draft, [
      {
        name: 'Thermal label printer',
        nameAr: 'طابعة ملصقات حرارية',
        quantity: 5,
        unit: 'pcs',
        unitPrice: 125.25,
      },
      { name: 'Label rolls', nameAr: 'لفات ملصقات', quantity: 40, unit: 'rolls', unitPrice: 3.125 },
    ]),
  });
  expect(order.totals.total).toBe(751.25);
  await markSent(order.id);
  return (await db.documents.get(order.id))!;
}

const stored = async (id: string) => (await db.documents.get(id))!;

describe('sales orders', () => {
  it('get their own numbers and are confirmed rather than sent', async () => {
    const s = await setup();
    const order = await salesOrder(s);
    expect(order.number).toBe(`SO-${today().slice(0, 4)}-0001`);
    expect(order.status).toBe('confirmed');
    expect(order.deliveryStatus).toBe('not_delivered');
  });

  it('are invoiced in two parts, line by line', async () => {
    const s = await setup();
    const order = await salesOrder(s);
    const [printers, rolls] = order.items;

    const first = await createFromOrder(order.id, 'invoice', { [printers.id]: 2, [rolls.id]: 40 });
    expect(first).toMatchObject({
      type: 'invoice',
      status: 'draft',
      sourceId: order.id,
      clientId: s.client.id,
      currency: 'KWD',
      poNumber: 'LPO-55120',
      notes: 'Deliver to the Shuwaikh warehouse.',
    });
    expect(first.number).toMatch(/^INV-/);
    expect(first.items.map((i) => [i.nameAr, i.quantity, i.unit, i.sourceLineId])).toEqual([
      ['طابعة ملصقات حرارية', 2, 'pcs', printers.id],
      ['لفات ملصقات', 40, 'rolls', rolls.id],
    ]);
    // 2 × 125.250 + 40 × 3.125
    expect(first.totals.total).toBe(375.5);
    expect((await stored(order.id)).status).toBe('partially_invoiced');
    const progress = await progressOf(order);
    expect(progress.map((p) => [p.invoiced, p.toInvoice])).toEqual([
      [2, 3],
      [40, 0],
    ]);

    // The rest: only the printers are left.
    const second = await createFromOrder(order.id, 'invoice');
    expect(second.items.map((i) => [i.name, i.quantity])).toEqual([['Thermal label printer', 3]]);
    expect(second.totals.total).toBe(375.75);
    expect(sameAmount(first.totals.total + second.totals.total, order.totals.total, 'KWD')).toBe(
      true,
    );
    expect((await stored(order.id)).status).toBe('invoiced');
    await expect(createFromOrder(order.id, 'invoice')).rejects.toThrow(/already invoiced/);

    // Voiding or deleting an invoice puts its quantities back on the order.
    await setDocumentStatus(second.id, 'void');
    expect((await stored(order.id)).status).toBe('partially_invoiced');
    await deleteDocument(first.id);
    expect((await stored(order.id)).status).toBe('confirmed');
  });

  it('never invoice more than is left', async () => {
    const s = await setup();
    const order = await salesOrder(s);
    const invoice = await createFromOrder(order.id, 'invoice', { [order.items[0].id]: 9 });
    expect(invoice.items.map((i) => i.quantity)).toEqual([5]);
  });

  it('are delivered in parts, from the order and from its invoices', async () => {
    const s = await setup();
    const order = await salesOrder(s);
    const [printers, rolls] = order.items;

    const note = await createFromOrder(order.id, 'delivery_note', { [printers.id]: 2 });
    expect(note).toMatchObject({
      type: 'delivery_note',
      status: 'draft',
      sourceId: order.id,
      deliveryDate: today(),
      deliveryPlace: 'Warehouse 4, Shuwaikh Industrial',
      discount: 0,
      charges: [],
      taxes: [],
    });
    expect(note.number).toMatch(/^DN-/);
    // A draft delivery note is on its way: not delivered yet, not offered again.
    let progress = await progressOf(order);
    expect(progress[0]).toMatchObject({ delivered: 0, inDelivery: 2, toDeliver: 3 });
    expect((await stored(order.id)).deliveryStatus).toBe('not_delivered');

    await markDelivered(note.id, {
      date: today(),
      receiverName: 'Ahmad Al-Mutairi',
      receiverCivilId: '2870 1011 2349',
    });
    expect(await stored(note.id)).toMatchObject({
      status: 'delivered',
      receiverName: 'Ahmad Al-Mutairi',
      receiverCivilId: '287010112349',
    });
    expect((await stored(order.id)).deliveryStatus).toBe('partially_delivered');

    // Invoicing everything, then delivering the rest from the invoice.
    const invoice = await createFromOrder(order.id, 'invoice');
    const fromInvoice = await createFromOrder(invoice.id, 'delivery_note');
    // The two printers already delivered against the order are not offered again.
    expect(fromInvoice.items.map((i) => i.quantity)).toEqual([3, 40]);
    expect(fromInvoice.sourceId).toBe(invoice.id);
    await markDelivered(fromInvoice.id, { date: today(), receiverName: 'Ahmad Al-Mutairi' });
    progress = await progressOf(order);
    expect(progress.map((p) => p.delivered)).toEqual([5, 40]);
    expect(await stored(order.id)).toMatchObject({
      status: 'invoiced',
      deliveryStatus: 'delivered',
    });
    expect(rolls.id).toBe(progress[1].line.id);

    // Undoing the delivery shows it again.
    await setDocumentStatus(fromInvoice.id, 'draft');
    expect((await stored(order.id)).deliveryStatus).toBe('partially_delivered');
  });

  it('share a fixed discount and charge the shipping once', async () => {
    const s = await setup();
    const draft = await draftDocument(s.company, 'sales_order', s.client);
    const order = await saveDocument({
      ...draft,
      status: 'confirmed',
      discount: 10,
      discountType: 'amount',
      charges: [{ id: 'ship', label: 'Delivery', amount: 5, taxes: [] }],
      items: lines(draft, [
        { name: 'A', quantity: 3, unitPrice: 33.333 },
        { name: 'B', quantity: 1, unitPrice: 0.001 },
      ]),
    });
    expect(order.totals.total).toBe(95);
    const first = await createFromOrder(order.id, 'invoice', { [order.items[0].id]: 1 });
    expect(first.discount).toBe(3.333);
    expect(first.charges.map((c) => c.amount)).toEqual([5]);
    const rest = await createFromOrder(order.id, 'invoice');
    expect(rest.discount).toBe(6.667);
    expect(rest.charges).toEqual([]);
    expect(sameAmount(first.totals.total + rest.totals.total, order.totals.total, 'KWD')).toBe(
      true,
    );
  });

  it('keep their status when cancelled, and pick up their invoices when reopened', async () => {
    const s = await setup();
    const order = await salesOrder(s);
    await createFromOrder(order.id, 'invoice', { [order.items[0].id]: 1 });
    await setDocumentStatus(order.id, 'cancelled');
    expect((await stored(order.id)).status).toBe('cancelled');
    await expect(createFromOrder(order.id, 'invoice')).rejects.toThrow(/cancelled/);
    await setDocumentStatus(order.id, 'confirmed');
    expect((await stored(order.id)).status).toBe('partially_invoiced');
  });
});

describe('purchase orders', () => {
  async function purchaseOrder({ company, vendor }: Setup): Promise<InvoiceDocument> {
    const expense = await db.accounts
      .where('[companyId+role]')
      .equals([company.id, 'expense'])
      .first();
    const draft = await draftDocument(company, 'purchase_order', vendor);
    const order = await saveDocument({
      ...draft,
      items: lines(draft, [
        { name: 'A4 paper', nameAr: 'ورق A4', quantity: 100, unitPrice: 1.375 },
        { name: 'Toner', quantity: 4, unitPrice: 18.5, accountId: expense?.id },
      ]),
    });
    await markSent(order.id);
    return stored(order.id);
  }

  it('are issued and billed in two parts', async () => {
    const s = await setup();
    const order = await purchaseOrder(s);
    expect(order.number).toBe(`PO-${today().slice(0, 4)}-0001`);
    expect(order.status).toBe('issued');
    expect(order.totals.total).toBe(211.5);

    const first = await createFromOrder(order.id, 'bill', { [order.items[0].id]: 60 });
    expect(first).toMatchObject({
      type: 'bill',
      status: 'draft',
      sourceId: order.id,
      clientId: s.vendor.id,
      poNumber: order.number,
      notes: '',
    });
    expect(first.items.map((i) => [i.name, i.nameAr, i.quantity])).toEqual([
      ['A4 paper', 'ورق A4', 60],
    ]);
    expect(first.totals.total).toBe(82.5);
    expect((await stored(order.id)).status).toBe('partially_billed');

    const second = await createFromOrder(order.id, 'bill');
    expect(second.items.map((i) => [i.quantity, i.accountId])).toEqual([
      [40, order.items[0].accountId],
      [4, order.items[1].accountId],
    ]);
    expect(second.totals.total).toBe(129);
    expect((await stored(order.id)).status).toBe('billed');
  });
});

describe('conversions', () => {
  async function acceptedQuote({ company, client }: Setup): Promise<InvoiceDocument> {
    const draft = await draftDocument(company, 'quote', client);
    const quote = await saveDocument({
      ...draft,
      poNumber: 'LPO-9',
      notes: 'Includes installation.',
      items: lines(draft, [{ name: 'Sorting machine', nameAr: 'آلة فرز', unitPrice: 1450.5 }]),
    });
    await setDocumentStatus(quote.id, 'accepted');
    return stored(quote.id);
  }

  it('turn a quote into a proforma and the proforma into an invoice with its deposit', async () => {
    const s = await setup();
    const quote = await acceptedQuote(s);
    const proforma = await convertDocument(quote.id, 'proforma');
    expect(proforma).toMatchObject({
      type: 'proforma',
      status: 'draft',
      sourceId: quote.id,
      poNumber: 'LPO-9',
      notes: 'Includes installation.',
    });
    expect(proforma.number).toMatch(/^PF-/);
    expect(proforma.items[0].nameAr).toBe('آلة فرز');
    expect(await stored(quote.id)).toMatchObject({
      status: 'converted',
      convertedToId: proforma.id,
    });

    await saveDocument({ ...proforma, deposit: 725.25, depositDueDate: today() });
    await markSent(proforma.id);
    expect((await stored(proforma.id)).status).toBe('sent');
    const invoice = await convertDocument(proforma.id, 'invoice');
    expect(invoice).toMatchObject({
      type: 'invoice',
      sourceId: proforma.id,
      deposit: 725.25,
      depositDueDate: today(),
    });
    expect(invoice.totals.total).toBe(1450.5);
    expect(await stored(proforma.id)).toMatchObject({
      status: 'converted',
      convertedToId: invoice.id,
    });

    // Deleting the invoice lets the proforma be converted again.
    await deleteDocument(invoice.id);
    expect(await stored(proforma.id)).toMatchObject({ status: 'accepted', convertedToId: null });
  });

  it('turn a quote into a sales order', async () => {
    const s = await setup();
    const quote = await acceptedQuote(s);
    const order = await convertDocument(quote.id, 'sales_order');
    expect(order).toMatchObject({ type: 'sales_order', status: 'draft', sourceId: quote.id });
    expect((await stored(quote.id)).status).toBe('converted');
    await expect(convertDocument(order.id, 'invoice')).rejects.toThrow();
  });
});

describe('documents that never reach the books', () => {
  const ORDERS: DocumentType[] = ['proforma', 'sales_order', 'purchase_order', 'delivery_note'];

  it('are never posted, whatever their status', () => {
    for (const type of ORDERS) {
      for (const status of STATUSES_BY_TYPE[type]) {
        expect(isPosted({ type, status }), `${type} ${status}`).toBe(false);
      }
    }
    expect(isPosted({ type: 'invoice', status: 'sent' })).toBe(true);
  });

  it('leave the ledger, receivables, sales and tax figures to invoices and bills', async () => {
    const s = await setup();
    const order = await salesOrder(s);
    // Everything that can happen to the new documents…
    const proforma = await convertDocument(
      (await saveDocument({ ...(await draftDocument(s.company, 'quote', s.client)) })).id,
      'proforma',
    );
    await saveDocument({
      ...proforma,
      items: lines(proforma, [{ name: 'Advance', unitPrice: 999 }]),
    });
    await setDocumentStatus(proforma.id, 'accepted');
    const note = await createFromOrder(order.id, 'delivery_note');
    await markDelivered(note.id, { date: today(), receiverName: 'Ahmad' });
    const poDraft = await draftDocument(s.company, 'purchase_order', s.vendor);
    const po = await saveDocument({
      ...poDraft,
      items: lines(poDraft, [{ name: 'Paper', quantity: 10, unitPrice: 2 }]),
    });
    await markSent(po.id);
    // …and one invoice, sent: the only thing that counts.
    const invoice = await createFromOrder(order.id, 'invoice', { [order.items[1].id]: 40 });
    await markSent(invoice.id);
    expect((await stored(invoice.id)).totals.total).toBe(125);

    const { accounts, lines: ledger, problems } = await loadLedger(s.company);
    expect(problems).toEqual([]);
    const sources = new Set(ledger.map((l) => l.sourceId));
    expect([...sources]).toEqual([invoice.id]);
    const receivable = accounts.find((a) => a.role === 'receivable')!;
    expect(
      ledger.filter((l) => l.accountId === receivable.id).reduce((sum, l) => sum + l.amount, 0),
    ).toBe(125000);
    const tb = trialBalance(ledger, accounts, today(), { month: 12, day: 31 });
    expect(tb.totalDebit).toBe(tb.totalCredit);

    const docs = await db.documents.where('companyId').equals(s.company.id).toArray();
    expect(docs.map((d) => d.type).sort()).toEqual(
      ['delivery_note', 'invoice', 'proforma', 'purchase_order', 'quote', 'sales_order'].sort(),
    );
    const all = { from: '0000-01-01', to: '9999-12-31' };
    const clients = [s.client, s.vendor];
    expect(salesByClient(docs, clients, 'KWD', all).totals).toMatchObject({
      invoices: 1,
      invoiced: 125,
      outstanding: 125,
    });
    expect(salesByClient(docs, clients, 'KWD', all, 'bill').totals.invoices).toBe(0);
    expect(agingReport(docs, clients, 'KWD', today()).total).toBe(125);
    expect(agingReport(docs, clients, 'KWD', today(), 'bill').total).toBe(0);
    expect(taxReport(docs, clients, 'KWD', all)).toMatchObject({ documents: 1, gross: 125 });
  });
});
