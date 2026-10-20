import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { convertDocument, draftDocument, duplicateDocument, saveDocument } from './documents';
import { createFromOrder } from './orders';
import { saveClient, saveCompany, setupCompany } from './records';
import type { Company, InvoiceDocument } from './types';

/** Made-up company and customer only. */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const INTRO = 'Further to your request, we are pleased to quote as follows.';

async function setup(quoteIntro?: string) {
  let company: Company = await setupCompany({ name: 'Al Waha Trading', currency: 'KWD' });
  if (quoteIntro !== undefined) {
    company = await saveCompany({ ...company, defaults: { ...company.defaults, quoteIntro } });
  }
  const client = await saveClient(createClient(company.id, { name: 'Al Rawda Trading' }));
  return { company, client };
}

async function quote(extra: Partial<InvoiceDocument> = {}, quoteIntro?: string) {
  const { company, client } = await setup(quoteIntro);
  const draft = await draftDocument(company, 'quote', client);
  return saveDocument({
    ...draft,
    items: [{ ...draft.items[0], name: 'Folding machine', unitPrice: 1180, sku: 'FLD-85' }],
    ...extra,
  });
}

describe('the quote introduction and colour', () => {
  it('starts new quotes with the company’s introduction, and nothing else', async () => {
    const { company, client } = await setup(INTRO);
    expect((await draftDocument(company, 'quote', client)).intro).toBe(INTRO);
    for (const type of ['invoice', 'proforma', 'credit'] as const) {
      expect('intro' in (await draftDocument(company, type, client))).toBe(false);
    }
  });

  it('writes no introduction while the company has none', async () => {
    const { company, client } = await setup();
    expect('intro' in (await draftDocument(company, 'quote', client))).toBe(false);
    const blank = await setup('  ');
    expect('intro' in (await draftDocument(blank.company, 'quote', blank.client))).toBe(false);
  });

  it('keeps the introduction, colour and SKUs on a copy of the quote', async () => {
    const source = await quote({ intro: 'For the new branch.', accentColor: '#0f766e' }, INTRO);
    const copy = await duplicateDocument(source.id);
    expect(copy.intro).toBe('For the new branch.');
    expect(copy.accentColor).toBe('#0f766e');
    expect(copy.items[0].sku).toBe('FLD-85');
  });

  it('leaves the introduction behind when the quote is invoiced, but keeps its colour', async () => {
    const source = await quote({ intro: INTRO, accentColor: '#0f766e' });
    const invoice = await convertDocument(source.id, 'invoice');
    expect(invoice.intro).toBeUndefined();
    expect(invoice.accentColor).toBe('#0f766e');
    expect(invoice.items[0].sku).toBe('FLD-85');
    // A quote with no colour of its own gives the invoice none either.
    const plain = await convertDocument((await quote()).id, 'invoice');
    expect('accentColor' in plain).toBe(false);
  });

  it('gives an order’s colour to its invoices', async () => {
    const { company, client } = await setup();
    const draft = await draftDocument(company, 'sales_order', client);
    const order = await saveDocument({
      ...draft,
      status: 'confirmed',
      accentColor: '#be123c',
      items: [{ ...draft.items[0], name: 'Label rolls', quantity: 10, unitPrice: 3.125 }],
    });
    expect((await createFromOrder(order.id, 'invoice')).accentColor).toBe('#be123c');
  });
});
