import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { deleteDocument, draftDocument, saveDocument, setDocumentStatus } from './documents';
import { LockedPeriodError, loadLedger } from './accounting';
import { addAttachment } from './purchases';
import { saveClient, setupCompany } from './records';
import {
  createPayment,
  deletePayment,
  newCheque,
  PaymentError,
  savePayment,
  setPaymentLink,
} from './payments';
import type { Company, InvoiceDocument, Payment } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function company(country: string, currency: string): Promise<Company> {
  return setupCompany({
    name: 'Al Mail',
    currency,
    locale: 'en-KW',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country },
  });
}

async function invoice(c: Company, unitPrice: number): Promise<InvoiceDocument> {
  const client = await saveClient(createClient(c.id, { name: 'Salmiya Stores' }));
  const draft = await draftDocument(c, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Order', quantity: 1, unitPrice, taxes: [] };
  return saveDocument({ ...draft, status: 'sent', issueDate: '2026-10-01' });
}

function pay(c: Company, doc: InvoiceDocument, overrides: Partial<Payment>): Promise<Payment> {
  return savePayment(
    createPayment(c.id, {
      clientId: doc.clientId,
      date: '2026-10-03',
      amount: doc.totals.balance,
      currency: doc.currency,
      allocations: [{ documentId: doc.id, amount: doc.totals.balance }],
      ...overrides,
    }),
  );
}

async function balances(c: Company) {
  const { accounts, lines, problems } = await loadLedger(c);
  expect(problems).toEqual([]);
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  const out: Record<string, number> = {};
  for (const l of lines) {
    const a = accounts.find((x) => x.id === l.accountId)!;
    out[`${a.code} ${a.name}`] = (out[`${a.code} ${a.name}`] ?? 0) + l.amount;
  }
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

describe('KNET payments', () => {
  it('go to the KNET clearing account, less the fee', async () => {
    const c = await company('KW', 'KWD');
    const doc = await invoice(c, 100);
    const payment = await pay(c, doc, { method: 'knet', fee: 1.25 });
    const accounts = await db.accounts.where('companyId').equals(c.id).toArray();
    expect(accounts.find((a) => a.id === payment.accountId)?.code).toBe('1020');
    expect(accounts.find((a) => a.id === payment.feeAccountId)?.code).toBe('6180');
    expect((await db.documents.get(doc.id))?.status).toBe('paid');
    expect(await balances(c)).toEqual({
      '1020 KNET and card settlements': 98_750,
      '6180 KNET and card fees': 1_250,
      '4000 Sales': -100_000,
    });
  });

  it('can be put straight into another account the user picks', async () => {
    const c = await company('KW', 'KWD');
    const doc = await invoice(c, 40);
    const bank = (await db.accounts.where('companyId').equals(c.id).toArray()).find(
      (a) => a.role === 'bank',
    )!;
    const payment = await pay(c, doc, { method: 'knet', accountId: bank.id });
    expect(payment.accountId).toBe(bank.id);
    expect(await balances(c)).toEqual({
      '1000 Bank – current account': 40_000,
      '4000 Sales': -40_000,
    });
  });

  it('refuse a fee as large as the payment', async () => {
    const c = await company('KW', 'KWD');
    const doc = await invoice(c, 10);
    await expect(pay(c, doc, { method: 'link', fee: 10 })).rejects.toThrow(PaymentError);
  });

  it('keep the provider of links and buy-now-pay-later only', async () => {
    const c = await company('KW', 'KWD');
    const doc = await invoice(c, 230.5);
    const bnpl = await pay(c, doc, { method: 'bnpl', provider: 'tabby', fee: 11.525 });
    expect(bnpl.provider).toBe('tabby');
    expect(await balances(c)).toEqual({
      '1020 KNET and card settlements': 218_975,
      '6180 KNET and card fees': 11_525,
      '4000 Sales': -230_500,
    });
    const other = await invoice(c, 5);
    const transfer = await pay(c, other, { method: 'bank_transfer', provider: 'tap', fee: 1 });
    expect(transfer.provider).toBeNull();
    expect(transfer.fee).toBeUndefined();
  });
});

describe('other Kuwaiti methods', () => {
  it('book WAMD to the bank and cash on delivery to cash', async () => {
    const c = await company('KW', 'KWD');
    const a = await invoice(c, 12.5);
    const b = await invoice(c, 7.75);
    const wamd = await pay(c, a, { method: 'wamd' });
    const cod = await pay(c, b, { method: 'cod' });
    expect(wamd.accountId).toBeNull();
    expect(cod.accountId).toBeNull();
    expect(await balances(c)).toEqual({
      '1000 Bank – current account': 12_500,
      '1010 Petty cash': 7_750,
      '4000 Sales': -20_250,
    });
  });
});

describe('companies on other charts', () => {
  it('get the clearing and fee accounts created, without taking codes in use', async () => {
    const c = await company('US', 'KWD');
    expect(c.accounting?.template).toBe('generic');
    const doc = await invoice(c, 50);
    await pay(c, doc, { method: 'card', fee: 0.5 });
    expect(await balances(c)).toEqual({
      '1020 KNET and card settlements': 49_500,
      // 6180 is "Training" in the standard chart.
      '6181 KNET and card fees': 500,
      '4000 Sales': -50_000,
    });
    // The accounts are found again next time, not created twice.
    const next = await invoice(c, 20);
    await pay(c, next, { method: 'knet', fee: 0.2 });
    const accounts = await db.accounts.where('companyId').equals(c.id).toArray();
    expect(accounts.filter((a) => a.name === 'KNET and card fees')).toHaveLength(1);
    expect(accounts.filter((a) => a.name === 'KNET and card settlements')).toHaveLength(1);
  });

  it('get a post-dated cheques account for cheques (UK chart)', async () => {
    const c = await company('GB', 'GBP');
    const doc = await invoice(c, 120);
    await pay(c, doc, {
      method: 'cheque',
      cheque: newCheque({ number: '100200', bank: 'Barclays', drawer: 'Salmiya Stores' }),
    });
    expect(await balances(c)).toEqual({
      '1150 Post-dated cheques received': 12_000,
      '4000 Sales': -12_000,
    });
  });

  it('keep older cheque payments without cheque details on the bank', async () => {
    const c = await company('GB', 'GBP');
    const doc = await invoice(c, 30);
    const old = createPayment(c.id, {
      clientId: doc.clientId,
      date: '2026-10-03',
      amount: 30,
      currency: 'GBP',
      method: 'cheque',
      number: 'PAY-0001',
      allocations: [{ documentId: doc.id, amount: 30 }],
      documentIds: [doc.id],
    });
    // Recorded by an earlier version, before cheques were tracked.
    await db.payments.put(old);
    const saved = await savePayment({ ...old, notes: 'Edited later' });
    expect(saved.cheque).toBeNull();
    expect(await balances(c)).toEqual({
      '1200 Bank current account': 3_000,
      '4000 Sales': -3_000,
    });
  });
});

describe('payment links', () => {
  it('are stored on the document and checked', async () => {
    const c = await company('KW', 'KWD');
    const doc = await invoice(c, 10);
    await expect(
      setPaymentLink(doc.id, { provider: 'tap', url: 'tap.company/pay', expiresAt: null }),
    ).rejects.toThrow(PaymentError);
    await setPaymentLink(doc.id, {
      provider: 'myfatoorah',
      url: ' https://pay.myfatoorah.com/abc ',
      expiresAt: '2026-10-04',
    });
    expect((await db.documents.get(doc.id))?.paymentLink).toEqual({
      provider: 'myfatoorah',
      url: 'https://pay.myfatoorah.com/abc',
      expiresAt: '2026-10-04',
    });
    await setPaymentLink(doc.id, null);
    expect((await db.documents.get(doc.id))?.paymentLink).toBeNull();
  });
});

describe('payment files', () => {
  const scan = { name: 'cheque.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA' };
  const files = (ownerId: string) => db.attachments.where('ownerId').equals(ownerId).count();

  it('are deleted with the payment', async () => {
    const c = await company('KW', 'KWD');
    const doc = await invoice(c, 25);
    const payment = await pay(c, doc, {});
    await addAttachment(c.id, payment.id, scan);
    await addAttachment(c.id, payment.id, { ...scan, name: 'transfer.pdf' });
    // Another payment's scan stays.
    const other = await pay(c, await invoice(c, 10), {});
    await addAttachment(c.id, other.id, scan);
    expect(await files(payment.id)).toBe(2);
    await deletePayment(payment.id);
    expect(await db.payments.get(payment.id)).toBeUndefined();
    expect(await files(payment.id)).toBe(0);
    expect(await files(other.id)).toBe(1);
  });

  it('stay with a void or locked payment, which cannot be deleted', async () => {
    const c = await company('KW', 'KWD');
    const voided = await pay(c, await invoice(c, 25), {});
    await addAttachment(c.id, voided.id, scan);
    await db.payments.update(voided.id, { voided: true, voidReason: 'Returned' });
    await expect(deletePayment(voided.id)).rejects.toThrow(PaymentError);
    expect(await files(voided.id)).toBe(1);

    const locked = await pay(c, await invoice(c, 15), {});
    await addAttachment(c.id, locked.id, scan);
    await db.companies.update(c.id, {
      accounting: { ...c.accounting!, lockDate: '2026-10-31' },
    });
    await expect(deletePayment(locked.id)).rejects.toThrow(LockedPeriodError);
    expect(await db.payments.get(locked.id)).toBeDefined();
    expect(await files(locked.id)).toBe(1);
  });

  it('of a credit note taken off a document go with it', async () => {
    const c = await company('KW', 'KWD');
    const client = await saveClient(createClient(c.id, { name: 'Sample Trading' }));
    const issue = async (type: 'invoice' | 'credit', unitPrice: number) => {
      const draft = await draftDocument(c, type, client);
      draft.items[0] = { ...draft.items[0], name: 'Work', quantity: 1, unitPrice, taxes: [] };
      return saveDocument({ ...draft, status: 'sent', issueDate: '2026-10-01' });
    };
    const apply = async (doc: InvoiceDocument, credit: InvoiceDocument) => {
      const application = await savePayment(
        createPayment(c.id, {
          clientId: client.id,
          date: '2026-10-02',
          amount: 5,
          currency: 'KWD',
          method: 'credit_note',
          creditId: credit.id,
          allocations: [{ documentId: doc.id, amount: 5 }],
        }),
      );
      await addAttachment(c.id, application.id, scan);
      return application;
    };
    // The invoice is voided: the application is deleted, and so is its file.
    const voided = await apply(await issue('invoice', 20), await issue('credit', 5));
    await setDocumentStatus(voided.allocations[0].documentId, 'void');
    expect(await db.payments.get(voided.id)).toBeUndefined();
    expect(await files(voided.id)).toBe(0);
    // The credit note is deleted.
    const credit = await issue('credit', 5);
    const deleted = await apply(await issue('invoice', 20), credit);
    await deleteDocument(credit.id);
    expect(await db.payments.get(deleted.id)).toBeUndefined();
    expect(await files(deleted.id)).toBe(0);
  });
});
