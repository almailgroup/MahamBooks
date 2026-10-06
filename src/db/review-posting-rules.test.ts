/**
 * Payments in another currency across the upgrade: what was saved before
 * keeps posting as it did, so a locked period never changes by itself, and
 * a cheque replaced on one day leaves nothing behind. Made-up data only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { loadLedger, LockedPeriodError } from './accounting';
import { saveClient, setupCompany } from './records';
import { createPayment, newCheque, savePayment } from './payments';
import { replaceCheque } from './cheques';
import type { Client, Company, DocumentType, InvoiceDocument, Payment } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function books() {
  const company = await setupCompany({ name: 'Test Export Co' });
  const client = await saveClient(
    createClient(company.id, { name: 'Overseas Buyer', currency: 'USD' }),
  );
  return { company, client };
}

async function issue(
  company: Company,
  contact: Client,
  type: DocumentType,
  price: number,
  rate: number,
  issueDate: string,
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

/** USD received against an invoice at 0.30471. */
function receive(company: Company, invoice: InvoiceDocument, amount: number, date: string) {
  return savePayment(
    createPayment(company.id, {
      clientId: invoice.clientId,
      date,
      amount,
      currency: 'USD',
      exchangeRate: 0.30471,
      allocations: [{ documentId: invoice.id, amount }],
    }),
  );
}

function applyCredit(
  company: Company,
  credit: InvoiceDocument,
  invoice: InvoiceDocument,
  amount: number,
  date: string,
) {
  return savePayment(
    createPayment(company.id, {
      clientId: credit.clientId,
      date,
      amount,
      currency: 'USD',
      method: 'credit_note',
      creditId: credit.id,
      allocations: [{ documentId: invoice.id, amount }],
    }),
  );
}

/** Stores a payment the way the version before posting rules saved it. */
async function savedBeforeUpgrade(payment: Payment) {
  const stored = (await db.payments.get(payment.id))!;
  delete stored.postingRules;
  await db.payments.put(stored);
}

/** Saves a stored payment again, as the payment form does. */
async function saveAgain(payment: Payment) {
  return savePayment((await db.payments.get(payment.id))!);
}

async function lock(company: Company, date: string) {
  const fresh = (await db.companies.get(company.id))!;
  await db.companies.update(company.id, { accounting: { ...fresh.accounting!, lockDate: date } });
}

/** Receivable and exchange difference posted up to a date (fils). */
async function posted(company: Company, upTo = '9999-12-31') {
  const { accounts, lines } = await loadLedger((await db.companies.get(company.id))!);
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  const sum = (role: 'receivable' | 'fx') => {
    const account = accounts.find((a) => a.role === role)!;
    return lines
      .filter((l) => l.accountId === account.id && l.date <= upTo)
      .reduce((s, l) => s + l.amount, 0);
  };
  return { ar: sum('receivable'), fx: sum('fx') };
}

describe('payments saved before the upgrade, in a locked period', () => {
  it('a USD credit note applied at another rate posts what it posted then', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 1000, 0.3, '2026-01-05');
    const credit = await issue(company, client, 'credit', 400, 0.31, '2026-01-20');
    const application = await applyCredit(company, credit, invoice, 400, '2026-01-21');
    await savedBeforeUpgrade(application);
    await lock(company, '2026-01-31');
    // No exchange difference, and 300.000 − 124.000 on receivables.
    expect(await posted(company, '2026-01-31')).toEqual({ ar: 176_000, fx: 0 });
    // Saving it again would change January, so it is refused.
    await expect(saveAgain(application)).rejects.toThrow(LockedPeriodError);
    expect(await posted(company, '2026-01-31')).toEqual({ ar: 176_000, fx: 0 });
  });

  it('USD instalments post what they posted then', async () => {
    const { company, client } = await books();
    // USD 100 at 0.30471 is 30.471; each half (15.2355) was booked as 15.236.
    const invoice = await issue(company, client, 'invoice', 100, 0.30471, '2026-01-05');
    await savedBeforeUpgrade(await receive(company, invoice, 50, '2026-01-10'));
    await savedBeforeUpgrade(await receive(company, invoice, 50, '2026-01-20'));
    await lock(company, '2026-01-31');
    expect(await posted(company, '2026-01-31')).toEqual({ ar: -1, fx: 0 });
  });

  it('a payment saved after the lock date settles what they left, and January stays', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 100, 0.30471, '2026-01-05');
    await savedBeforeUpgrade(await receive(company, invoice, 50, '2026-01-10'));
    await lock(company, '2026-01-31');
    const january = { ar: 30_471 - 15_236, fx: 0 };
    expect(await posted(company, '2026-01-31')).toEqual(january);
    await receive(company, invoice, 50, '2026-02-10');
    expect(await posted(company, '2026-01-31')).toEqual(january);
    // The second half clears the 15.235 left; the fils it brought in is a gain.
    expect(await posted(company)).toEqual({ ar: 0, fx: -1 });
  });
});

describe('payments saved before the upgrade, in an open period', () => {
  it('keep posting as they did until they are saved again', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 100, 0.30471, '2026-10-01');
    await savedBeforeUpgrade(await receive(company, invoice, 50, '2026-10-02'));
    const second = await receive(company, invoice, 50, '2026-10-03');
    await savedBeforeUpgrade(second);
    expect(await posted(company)).toEqual({ ar: -1, fx: 0 });
    expect((await saveAgain(second)).postingRules).toBeGreaterThan(1);
    expect(await posted(company)).toEqual({ ar: 0, fx: -1 });
  });

  it('a credit application saved again posts its exchange difference', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 1000, 0.3, '2026-10-01');
    const credit = await issue(company, client, 'credit', 400, 0.31, '2026-10-02');
    const application = await applyCredit(company, credit, invoice, 400, '2026-10-03');
    await savedBeforeUpgrade(application);
    expect(await posted(company)).toEqual({ ar: 176_000, fx: 0 });
    await saveAgain(application);
    // USD 600 is still owed at 0.3; 4.000 was gained on the exchange.
    expect(await posted(company)).toEqual({ ar: 180_000, fx: -4_000 });
  });
});

describe('a USD cheque replaced', () => {
  async function chequeFor(company: Company, invoice: InvoiceDocument, date: string) {
    return savePayment(
      createPayment(company.id, {
        clientId: invoice.clientId,
        date,
        amount: 50,
        currency: 'USD',
        exchangeRate: 0.30471,
        method: 'cheque',
        cheque: newCheque({ number: '000111', bank: 'NBK', date, drawer: 'Overseas Buyer' }),
        allocations: [{ documentId: invoice.id, amount: 50 }],
      }),
    );
  }

  async function replace(old: Payment, date: string) {
    return replaceCheque(old.id, {
      cheque: { number: '000222', bank: 'NBK', date, drawer: 'Overseas Buyer' },
      amount: 50,
      date,
    });
  }

  it('on a later day leaves nothing on the receivable', async () => {
    const { company, client } = await books();
    // USD 50 at 0.30471 is 15.2355, booked as 15.236.
    const invoice = await issue(company, client, 'invoice', 50, 0.30471, '2026-10-01');
    await replace(await chequeFor(company, invoice, '2026-10-02'), '2026-10-05');
    expect((await db.documents.get(invoice.id))?.totals.balance).toBe(0);
    expect(await posted(company)).toEqual({ ar: 0, fx: 0 });
  });

  it('on the day it was received leaves nothing on the receivable', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 50, 0.30471, '2026-10-01');
    await replace(await chequeFor(company, invoice, '2026-10-02'), '2026-10-02');
    expect((await db.documents.get(invoice.id))?.totals.balance).toBe(0);
    expect(await posted(company)).toEqual({ ar: 0, fx: 0 });
  });
});
