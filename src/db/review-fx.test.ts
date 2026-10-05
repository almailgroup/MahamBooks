import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createRecurring } from './defaults';
import { DocumentChangeError, draftDocument, duplicateDocument, saveDocument } from './documents';
import { loadLedger } from './accounting';
import { saveClient, setupCompany } from './records';
import { createPayment, newCheque, savePayment } from './payments';
import { returnCheque } from './cheques';
import { invoiceFromProfile } from './recurring';
import type { Client, Company, DocumentType, InvoiceDocument } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function books() {
  const company = await setupCompany({ name: 'Review Co' });
  const client = await saveClient(
    createClient(company.id, { name: 'Overseas Buyer', currency: 'USD' }),
  );
  const vendor = await saveClient(
    createClient(company.id, {
      name: 'Overseas Supplier',
      currency: 'USD',
      isVendor: true,
      isCustomer: false,
    }),
  );
  return { company, client, vendor };
}

async function issue(
  company: Company,
  contact: Client,
  type: DocumentType,
  price: number,
  rate: number,
  issueDate = '2026-10-01',
): Promise<InvoiceDocument> {
  const draft = await draftDocument(company, type, contact);
  return saveDocument({
    ...draft,
    status: 'sent',
    issueDate,
    currency: 'USD',
    exchangeRate: rate,
    items: [{ ...draft.items[0], name: 'Consulting', quantity: 1, unitPrice: price, taxes: [] }],
  });
}

async function balances(company: Company) {
  const { accounts, lines, problems } = await loadLedger((await db.companies.get(company.id))!);
  const sum = (role: 'receivable' | 'payable' | 'fx') => {
    const account = accounts.find((a) => a.role === role)!;
    return lines.filter((l) => l.accountId === account.id).reduce((s, l) => s + l.amount, 0);
  };
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  return { problems, ar: sum('receivable'), ap: sum('payable'), fx: sum('fx') };
}

describe('credit notes in another currency', () => {
  it('a credit note made from a USD invoice keeps its exchange rate', async () => {
    const { company, client, vendor } = await books();
    const invoice = await issue(company, client, 'invoice', 1000, 0.305);
    const credit = await duplicateDocument(invoice.id, 'credit', { sourceId: invoice.id });
    expect(credit).toMatchObject({ currency: 'USD', exchangeRate: 0.305 });
    const bill = await issue(company, vendor, 'bill', 500, 0.307);
    const vendorCredit = await duplicateDocument(bill.id, 'vendor_credit', { sourceId: bill.id });
    expect(vendorCredit).toMatchObject({ currency: 'USD', exchangeRate: 0.307 });
  });

  it('applied at another rate, books the difference as an exchange gain or loss', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 1000, 0.3);
    const credit = await issue(company, client, 'credit', 1000, 0.31, '2026-11-01');
    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-11-01',
        amount: 1000,
        currency: 'USD',
        method: 'credit_note',
        creditId: credit.id,
        allocations: [{ documentId: invoice.id, amount: 1000 }],
      }),
    );
    const [inv, cn] = await db.documents.bulkGet([invoice.id, credit.id]);
    expect(inv?.totals.balance).toBe(0);
    expect(cn?.totals.balance).toBe(0);
    const { ar, fx, problems } = await balances(company);
    expect(problems).toEqual([]);
    // Nothing is owed on either document; 10.000 was gained on the exchange.
    expect(ar).toBe(0);
    expect(fx).toBe(-10_000);
  });

  it('works the same for vendor credits, in parts', async () => {
    const { company, vendor } = await books();
    const bill = await issue(company, vendor, 'bill', 1000, 0.3);
    const credit = await issue(company, vendor, 'vendor_credit', 1000, 0.3005, '2026-11-01');
    for (const amount of [333.33, 333.33, 333.34]) {
      await savePayment(
        createPayment(company.id, {
          direction: 'out',
          clientId: vendor.id,
          date: '2026-11-02',
          amount,
          currency: 'USD',
          method: 'credit_note',
          creditId: credit.id,
          allocations: [{ documentId: bill.id, amount }],
        }),
      );
    }
    const { ap, fx } = await balances(company);
    expect(ap).toBe(0);
    // The credit was booked at a higher rate than the bill: a loss of 0.500.
    expect(fx).toBe(500);
  });
});

describe('an invoice with payments', () => {
  it('can’t change currency under them', async () => {
    const company = await setupCompany({ name: 'Review Co' });
    const client = await saveClient(createClient(company.id, { name: 'Sample Client' }));
    const draft = await draftDocument(company, 'invoice', client);
    const invoice = await saveDocument({
      ...draft,
      status: 'sent',
      issueDate: '2026-10-01',
      items: [{ ...draft.items[0], name: 'Work', quantity: 1, unitPrice: 100 }],
    });
    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-10-02',
        amount: 100,
        currency: 'KWD',
        allocations: [{ documentId: invoice.id, amount: 100 }],
      }),
    );
    const stored = (await db.documents.get(invoice.id))!;
    await expect(saveDocument({ ...stored, currency: 'USD', exchangeRate: 0.305 })).rejects.toThrow(
      DocumentChangeError,
    );
    // Other changes are still fine.
    await expect(saveDocument({ ...stored, notes: 'Thank you' })).resolves.toMatchObject({
      currency: 'KWD',
      notes: 'Thank you',
    });
  });
});

describe('a dollar invoice paid in instalments', () => {
  it('leaves no fils on the receivable once paid', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 2.02, 0.3005);
    for (const date of ['2026-10-05', '2026-10-06']) {
      await savePayment(
        createPayment(company.id, {
          clientId: client.id,
          date,
          amount: 1.01,
          currency: 'USD',
          exchangeRate: 0.3005,
          allocations: [{ documentId: invoice.id, amount: 1.01 }],
        }),
      );
    }
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');
    const { ar, fx, problems } = await balances(company);
    expect(problems).toEqual([]);
    expect(ar).toBe(0);
    // Each payment reached the bank as 0.304; the invoice was 0.607. The fils
    // of rounding is an exchange difference, not something the client owes.
    expect(fx).toBe(-1);
  });

  it('still clears to the last fils when a cheque in between came back', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 3.03, 0.3005);
    const pay = (amount: number, date: string, cheque = false) =>
      savePayment(
        createPayment(company.id, {
          clientId: client.id,
          date,
          amount,
          currency: 'USD',
          exchangeRate: 0.3005,
          method: cheque ? 'cheque' : 'bank_transfer',
          cheque: cheque ? newCheque({ number: '000777', bank: 'NBOK', date }) : null,
          allocations: [{ documentId: invoice.id, amount }],
        }),
      );
    await pay(1.01, '2026-10-05');
    const bounced = await pay(1.01, '2026-10-06', true);
    await returnCheque(bounced.id, { date: '2026-10-09', reason: 'Insufficient funds' });
    await pay(1.01, '2026-10-10');
    await pay(1.01, '2026-10-11');
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');
    const { ar } = await balances(company);
    expect(ar).toBe(0);
  });
});

describe('recurring invoices in another currency', () => {
  it('are issued at the profile’s exchange rate', async () => {
    const { company, client } = await books();
    const profile = createRecurring(company.id, {
      clientId: client.id,
      template: {
        ...createRecurring(company.id).template,
        currency: 'USD',
        exchangeRate: 0.3051,
      },
    });
    const invoice = invoiceFromProfile(profile, '2026-10-01', 'en', client);
    expect(invoice).toMatchObject({ currency: 'USD', exchangeRate: 0.3051 });
  });
});
