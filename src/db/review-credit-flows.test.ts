/**
 * Credit notes taken off the documents they were applied to: by voiding,
 * deleting or moving either one back to draft. Made-up data only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { deleteDocument, draftDocument, saveDocument, setDocumentStatus } from './documents';
import { loadLedger } from './accounting';
import { saveClient, setupCompany } from './records';
import { createPayment, savePayment } from './payments';
import type { Client, Company, DocumentType, InvoiceDocument } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function books() {
  const company = await setupCompany({ name: 'Flow Co' });
  const client = await saveClient(createClient(company.id, { name: 'Sample Client' }));
  const invoice = await issue(company, client, 'invoice', 100);
  const credit = await issue(company, client, 'credit', 30);
  await savePayment(
    createPayment(company.id, {
      clientId: client.id,
      date: '2026-10-02',
      amount: 30,
      currency: 'KWD',
      method: 'credit_note',
      creditId: credit.id,
      allocations: [{ documentId: invoice.id, amount: 30 }],
    }),
  );
  return { company, client, invoice, credit };
}

async function issue(company: Company, contact: Client, type: DocumentType, price: number) {
  const draft = await draftDocument(company, type, contact);
  return saveDocument({
    ...draft,
    status: 'sent',
    issueDate: '2026-10-01',
    items: [{ ...draft.items[0], name: 'Work', quantity: 1, unitPrice: price, taxes: [] }],
  });
}

/** Receivable in KWD. */
async function receivable(company: Company) {
  const { accounts, lines } = await loadLedger((await db.companies.get(company.id))!);
  const id = accounts.find((a) => a.role === 'receivable')!.id;
  return lines.filter((l) => l.accountId === id).reduce((s, l) => s + l.amount, 0) / 1000;
}

async function stored(doc: InvoiceDocument) {
  const { status, totals } = (await db.documents.get(doc.id))!;
  return { status, paid: totals.paid, balance: totals.balance };
}

const applications = (credit: InvoiceDocument) =>
  db.payments.where('creditId').equals(credit.id).count();

describe('a credit note applied to an invoice', () => {
  it('voided after the rest was paid, leaves the invoice owing it; deleting the invoice keeps the money', async () => {
    const { company, client, invoice, credit } = await books();
    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-10-03',
        amount: 70,
        currency: 'KWD',
        allocations: [{ documentId: invoice.id, amount: 70 }],
      }),
    );
    expect((await stored(invoice)).status).toBe('paid');
    expect(await receivable(company)).toBe(0);
    await setDocumentStatus(credit.id, 'void');
    expect(await stored(invoice)).toEqual({ status: 'partial', paid: 70, balance: 30 });
    expect(await stored(credit)).toEqual({ status: 'void', paid: 0, balance: 30 });
    expect(await receivable(company)).toBe(30);
    await deleteDocument(invoice.id);
    // The 70 received stays as the client's unapplied credit.
    expect(await receivable(company)).toBe(-70);
  });

  it('moved back to draft, shows nothing applied and the invoice is owed again', async () => {
    const { company, invoice, credit } = await books();
    expect(await stored(credit)).toEqual({ status: 'applied', paid: 30, balance: 0 });
    await setDocumentStatus(credit.id, 'draft');
    expect(await applications(credit)).toBe(0);
    expect(await stored(credit)).toEqual({ status: 'draft', paid: 0, balance: 30 });
    expect(await stored(invoice)).toEqual({ status: 'sent', paid: 0, balance: 100 });
    expect(await receivable(company)).toBe(100);
  });

  it('whose invoice is moved back to draft, can be used again', async () => {
    const { company, invoice, credit } = await books();
    expect(await stored(invoice)).toEqual({ status: 'partial', paid: 30, balance: 70 });
    await setDocumentStatus(invoice.id, 'draft');
    expect(await applications(credit)).toBe(0);
    expect(await stored(invoice)).toEqual({ status: 'draft', paid: 0, balance: 100 });
    expect(await stored(credit)).toEqual({ status: 'sent', paid: 0, balance: 30 });
    expect(await receivable(company)).toBe(-30);
  });
});
