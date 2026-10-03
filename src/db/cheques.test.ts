import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { loadLedger, LockedPeriodError } from './accounting';
import { saveClient, setupCompany } from './records';
import { createPayment, deletePayment, newCheque, PaymentError, savePayment } from './payments';
import {
  cancelCheque,
  cashSecurityCheque,
  ChequeError,
  clearCheque,
  createSecurityCheque,
  depositCheque,
  replaceCheque,
  returnCheque,
  returnedCheques,
  returnSecurityCheque,
  saveSecurityCheque,
} from './cheques';
import type { Company, ID, InvoiceDocument, Payment } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function kuwait() {
  const company = await setupCompany({
    name: 'Al Mail Trading',
    currency: 'KWD',
    locale: 'en-KW',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'KW' },
  });
  const client = await saveClient(
    createClient(company.id, { name: 'Gulf Contracting', isVendor: true }),
  );
  return { company, client };
}

async function issue(
  company: Company,
  clientId: ID,
  type: 'invoice' | 'bill',
  unitPrice: number,
): Promise<InvoiceDocument> {
  const client = await db.clients.get(clientId);
  const draft = await draftDocument(company, type, client ?? null);
  draft.issueDate = '2026-10-01';
  draft.items[0] = { ...draft.items[0], name: 'Supplies', quantity: 1, unitPrice, taxes: [] };
  return saveDocument({ ...draft, status: 'sent' });
}

async function chequePayment(
  company: Company,
  doc: InvoiceDocument,
  overrides: Partial<Payment> = {},
): Promise<Payment> {
  return savePayment(
    createPayment(company.id, {
      direction: doc.type === 'bill' ? 'out' : 'in',
      clientId: doc.clientId,
      date: '2026-10-05',
      amount: doc.totals.balance,
      currency: 'KWD',
      method: 'cheque',
      allocations: [{ documentId: doc.id, amount: doc.totals.balance }],
      cheque: newCheque({
        number: '000123',
        bank: 'NBOK',
        date: '2026-11-15',
        drawer: 'Gulf Contracting',
      }),
      ...overrides,
    }),
  );
}

/** Balances by account code in fils (debit positive) and the trial balance total. */
async function books(company: Company) {
  const { accounts, lines, problems } = await loadLedger(company);
  expect(problems).toEqual([]);
  const byCode: Record<string, number> = {};
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)!.code;
    byCode[code] = (byCode[code] ?? 0) + l.amount;
  }
  for (const code of Object.keys(byCode)) if (byCode[code] === 0) delete byCode[code];
  return { byCode, total: lines.reduce((s, l) => s + l.amount, 0), accounts };
}

const bankId = async (company: Company) =>
  (await db.accounts.where('companyId').equals(company.id).toArray()).find(
    (a) => a.role === 'bank',
  )!.id;

describe('post-dated cheques received', () => {
  it('wait in 1150 until they clear into the bank', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 1250.75);
    const payment = await chequePayment(company, invoice);

    expect(payment.cheque?.status).toBe('held');
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');
    let ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1150': 1_250_750, '4000': -1_250_750 });
    expect(ledger.total).toBe(0);

    await depositCheque(payment.id, { date: '2026-11-15' });
    expect((await db.payments.get(payment.id))?.cheque?.status).toBe('deposited');
    // Depositing alone posts nothing.
    expect((await books(company)).byCode).toEqual(ledger.byCode);

    const cleared = await clearCheque(payment.id, {
      date: '2026-11-16',
      bankAccountId: await bankId(company),
    });
    expect(cleared.cheque).toMatchObject({ status: 'cleared', clearedOn: '2026-11-16' });
    const journal = await db.journals.get(cleared.cheque!.clearingJournalId!);
    expect(journal).toMatchObject({
      kind: 'cheque_clearing',
      paymentId: payment.id,
      date: '2026-11-16',
    });
    ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1000': 1_250_750, '4000': -1_250_750 });
    expect(ledger.total).toBe(0);
  });

  it('can be presented before their date but not deposited before they arrived', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 300);
    const payment = await chequePayment(company, invoice);
    await expect(depositCheque(payment.id, { date: '2026-10-04' })).rejects.toThrow(ChequeError);
    await expect(depositCheque(payment.id, { date: '2026-10-06' })).resolves.toMatchObject({
      cheque: { status: 'deposited', depositedOn: '2026-10-06' },
    });
  });
});

describe('post-dated cheques issued', () => {
  it('wait in 2150 until the vendor presents them', async () => {
    const { company, client } = await kuwait();
    const bill = await issue(company, client.id, 'bill', 480.25);
    const payment = await chequePayment(company, bill, {
      cheque: newCheque({ number: '500017', bank: 'KFHO', date: '2026-12-01', drawer: 'Gulf' }),
    });
    expect((await db.documents.get(bill.id))?.status).toBe('paid');
    let ledger = await books(company);
    expect(ledger.byCode).toEqual({ '2150': -480_250, '6000': 480_250 });

    await clearCheque(payment.id, { date: '2026-12-02' });
    ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1000': -480_250, '6000': 480_250 });
    expect(ledger.total).toBe(0);
  });

  it('that bounce open the bill again', async () => {
    const { company, client } = await kuwait();
    const bill = await issue(company, client.id, 'bill', 480.25);
    const payment = await chequePayment(company, bill, {
      cheque: newCheque({ number: '500018', bank: 'KFHO', date: '2026-12-01', drawer: 'Gulf' }),
    });
    await returnCheque(payment.id, { date: '2026-12-03', reason: 'Insufficient funds' });
    expect((await db.documents.get(bill.id))?.status).toBe('sent');
    const ledger = await books(company);
    expect(ledger.byCode).toEqual({ '2000': -480_250, '6000': 480_250 });
  });
});

describe('returned cheques', () => {
  it('void the payment, reopen the invoice and reverse the clearing', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 1250.75);
    const payment = await chequePayment(company, invoice);
    await clearCheque(payment.id, { date: '2026-11-16' });

    const returned = await returnCheque(payment.id, {
      date: '2026-11-20',
      reason: 'Insufficient funds',
      charge: 5,
    });
    expect(returned).toMatchObject({
      voided: true,
      voidReason: 'Insufficient funds',
      voidedOn: '2026-11-20',
      cheque: { status: 'returned', returnedOn: '2026-11-20', returnReason: 'Insufficient funds' },
    });
    const reopened = await db.documents.get(invoice.id);
    expect(reopened?.status).toBe('sent');
    expect(reopened?.totals.paid).toBe(0);
    expect(reopened?.totals.balance).toBe(1250.75);

    const reversal = await db.journals.get(returned.cheque!.reversalJournalId!);
    expect(reversal).toMatchObject({ kind: 'cheque_return', paymentId: payment.id });
    const charge = await db.expenses.get(returned.cheque!.returnChargeExpenseId!);
    expect(charge).toMatchObject({ amount: 5, date: '2026-11-20' });

    // Receivable is owed again; the bank only lost the 5.000 charge (6170 bank charges).
    const ledger = await books(company);
    expect(ledger.byCode).toEqual({
      '1100': 1_250_750,
      '4000': -1_250_750,
      '1000': -5_000,
      '6170': 5_000,
    });
    expect(ledger.total).toBe(0);
    expect((await returnedCheques(client.id)).map((p) => p.id)).toEqual([payment.id]);
  });

  it('that never cleared leave no entries behind', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 75.5);
    const payment = await chequePayment(company, invoice);
    await depositCheque(payment.id, { date: '2026-11-15' });
    const returned = await returnCheque(payment.id, { date: '2026-11-17', reason: '' });
    expect(returned.voidReason).toBe('Cheque returned');
    expect(returned.cheque?.reversalJournalId).toBeUndefined();
    expect(await db.journals.count()).toBe(0);
    const ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1100': 75_500, '4000': -75_500 });
  });

  it('are replaced by a new cheque that pays the invoice again', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 600);
    const payment = await chequePayment(company, invoice);
    await returnCheque(payment.id, { date: '2026-11-20', reason: 'Signature differs' });

    const replacement = await replaceCheque(payment.id, {
      date: '2026-11-22',
      amount: 600,
      cheque: { number: '000200', bank: 'NBOK', date: '2026-11-30', drawer: 'Gulf Contracting' },
    });
    expect(replacement.cheque).toMatchObject({ status: 'held', replacesId: payment.id });
    expect(replacement.allocations).toEqual([{ documentId: invoice.id, amount: 600 }]);
    expect((await db.payments.get(payment.id))?.cheque?.replacedById).toBe(replacement.id);
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');
    await expect(
      replaceCheque(payment.id, { date: '2026-11-23', amount: 600, cheque: replacement.cheque! }),
    ).rejects.toThrow(ChequeError);
    expect((await books(company)).byCode).toEqual({ '1150': 600_000, '4000': -600_000 });
  });

  it('replace an open cheque by cancelling it first', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 250);
    const payment = await chequePayment(company, invoice);
    const replacement = await replaceCheque(payment.id, {
      date: '2026-10-10',
      amount: 250,
      cheque: { number: '000124', bank: 'NBOK', date: '2026-12-15', drawer: 'Gulf Contracting' },
    });
    const old = await db.payments.get(payment.id);
    expect(old).toMatchObject({ voided: true, cheque: { status: 'cancelled' } });
    expect(old?.cheque?.replacedById).toBe(replacement.id);
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');
  });

  it('respect the lock date of the payment', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 100);
    const payment = await chequePayment(company, invoice);
    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: '2026-10-31' },
    });
    await expect(
      returnCheque(payment.id, { date: '2026-11-20', reason: 'Insufficient funds' }),
    ).rejects.toThrow(LockedPeriodError);
    await expect(clearCheque(payment.id, { date: '2026-10-20' })).rejects.toThrow(
      LockedPeriodError,
    );
    await expect(clearCheque(payment.id, { date: '2026-11-20' })).resolves.toBeTruthy();
  });
});

describe('cancelled cheques', () => {
  it('void the payment and reopen the invoice', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 90.125);
    const payment = await chequePayment(company, invoice);
    await cancelCheque(payment.id, { date: '2026-10-07', reason: 'Given back to the client' });
    expect(await db.payments.get(payment.id)).toMatchObject({
      voided: true,
      cheque: { status: 'cancelled' },
    });
    expect((await db.documents.get(invoice.id))?.totals.balance).toBe(90.125);
    expect((await books(company)).byCode).toEqual({ '1100': 90_125, '4000': -90_125 });
  });

  it('are refused once the cheque cleared', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 90);
    const payment = await chequePayment(company, invoice);
    await clearCheque(payment.id, { date: '2026-11-16' });
    await expect(cancelCheque(payment.id, { date: '2026-11-17', reason: '' })).rejects.toThrow(
      ChequeError,
    );
  });
});

describe('cheque payments', () => {
  it('need a cheque number and a valid Civil ID, and are not recorded twice', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 100);
    await expect(
      chequePayment(company, invoice, { cheque: newCheque({ number: ' ', bank: 'NBOK' }) }),
    ).rejects.toThrow('Enter the cheque number.');
    await expect(
      chequePayment(company, invoice, {
        cheque: newCheque({ number: '1', bank: 'NBOK', drawerCivilId: '123' }),
      }),
    ).rejects.toThrow(PaymentError);
    await chequePayment(company, invoice, { allocations: [] });
    await expect(chequePayment(company, invoice, { allocations: [] })).rejects.toThrow(
      /already recorded/,
    );
  });

  it('stay on record once they have entries of their own', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 100);
    const payment = await chequePayment(company, invoice);
    await clearCheque(payment.id, { date: '2026-11-16' });
    await expect(deletePayment(payment.id)).rejects.toThrow(PaymentError);
    const cleared = (await db.payments.get(payment.id))!;
    await expect(savePayment({ ...cleared, amount: 50 })).rejects.toThrow(PaymentError);
    // Notes can still change, and the form can't touch the cheque's status.
    const saved = await savePayment({
      ...cleared,
      notes: 'Collected by hand',
      cheque: { ...cleared.cheque!, status: 'held' },
    });
    expect(saved.cheque?.status).toBe('cleared');
    await returnCheque(payment.id, { date: '2026-11-20', reason: 'Account closed' });
    const voided = (await db.payments.get(payment.id))!;
    await expect(savePayment({ ...voided, notes: 'x' })).rejects.toThrow(PaymentError);
    await expect(deletePayment(payment.id)).rejects.toThrow(PaymentError);
  });
});

describe('security cheques', () => {
  it('stay off the books until they are cashed', async () => {
    const { company, client } = await kuwait();
    const invoice = await issue(company, client.id, 'invoice', 400);
    const security = await saveSecurityCheque(
      createSecurityCheque(company.id, {
        clientId: client.id,
        number: '771100',
        bank: 'GULB',
        amount: 1000,
        drawer: 'Gulf Contracting',
        purpose: 'Rent deposit, shop 4',
      }),
    );
    expect((await books(company)).byCode).toEqual({ '1100': 400_000, '4000': -400_000 });

    const payment = await cashSecurityCheque(security.id, {
      date: '2026-11-01',
      applyToOpen: true,
    });
    expect(payment).toMatchObject({
      amount: 1000,
      method: 'cheque',
      cheque: { status: 'deposited', depositedOn: '2026-11-01', number: '771100' },
      allocations: [{ documentId: invoice.id, amount: 400 }],
    });
    expect(await db.securityCheques.get(security.id)).toMatchObject({
      status: 'cashed',
      paymentId: payment.id,
    });
    // 400 paid the invoice; 600 is client credit until the cheque clears.
    const ledger = await books(company);
    expect(ledger.byCode).toEqual({ '1150': 1_000_000, '1100': -600_000, '4000': -400_000 });
    expect(ledger.total).toBe(0);
  });

  it('can be given back', async () => {
    const { company } = await kuwait();
    const security = await saveSecurityCheque(
      createSecurityCheque(company.id, { number: '9', amount: 250, drawer: 'Tenant' }),
    );
    const back = await returnSecurityCheque(security.id, '2026-12-31');
    expect(back).toMatchObject({ status: 'returned', returnedOn: '2026-12-31' });
    await expect(cashSecurityCheque(security.id, { date: '2027-01-01' })).rejects.toThrow(
      ChequeError,
    );
  });
});
