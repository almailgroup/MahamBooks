import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { deleteDocument, draftDocument, saveDocument } from './documents';
import { createPayment, savePayment } from './payments';
import {
  addAttachment,
  createExpense,
  deleteExpense,
  ExpenseError,
  isCustomer,
  isVendor,
  saveExpense,
} from './purchases';
import { clientHasRecords, saveClient, setupCompany } from './records';
import { LockedPeriodError } from './accounting';
import type { Client, Company, InvoiceDocument } from './types';

const FILE = { name: 'receipt.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA' };

async function setup(): Promise<{ company: Company; vendor: Client }> {
  const company = await setupCompany({ name: 'Acme Mail', currency: 'USD', locale: 'en-US' }, [
    { name: 'VAT', rate: 20 },
  ]);
  const vendor = await saveClient(
    createClient(company.id, { name: 'Paper Co', isCustomer: false, isVendor: true }),
  );
  return { company, vendor };
}

async function bill(
  company: Company,
  vendor: Client,
  unitPrice: number,
  type: 'bill' | 'vendor_credit' = 'bill',
): Promise<InvoiceDocument> {
  const draft = await draftDocument(company, type, vendor);
  draft.items[0] = { ...draft.items[0], name: 'Paper', quantity: 1, unitPrice, taxes: [] };
  return saveDocument({ ...draft, status: 'sent' });
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('contacts', () => {
  it('treats older records as clients and needs a flag for vendors', () => {
    expect(isCustomer({})).toBe(true);
    expect(isVendor({})).toBe(false);
    expect(isCustomer({ isCustomer: false })).toBe(false);
    expect(isVendor({ isVendor: true })).toBe(true);
  });
});

describe('bills', () => {
  it('have their own numbers and are settled by payments made', async () => {
    const { company, vendor } = await setup();
    const first = await bill(company, vendor, 100);
    const year = first.issueDate.slice(0, 4);
    expect(first.number).toBe(`BILL-${year}-0001`);
    expect(first.status).toBe('sent');
    expect(first.totals.balance).toBe(100);

    const payment = await savePayment(
      createPayment(company.id, {
        direction: 'out',
        clientId: vendor.id,
        amount: 40,
        currency: 'USD',
        allocations: [{ documentId: first.id, amount: 40 }],
      }),
    );
    // Payments made have their own series; payments received keep theirs.
    expect(payment.number).toBe('PM-0001');
    expect(await db.documents.get(first.id)).toMatchObject({
      status: 'partial',
      totals: { paid: 40, balance: 60 },
    });

    const received = await savePayment(
      createPayment(company.id, { clientId: vendor.id, amount: 5, currency: 'USD' }),
    );
    expect(received.number).toBe('PAY-0001');
  });

  it('are reduced by vendor credits, which give the amount back when deleted', async () => {
    const { company, vendor } = await setup();
    const owed = await bill(company, vendor, 100);
    const credit = await bill(company, vendor, 30, 'vendor_credit');
    expect(credit.number).toMatch(/^VC-\d{4}-0001$/);

    await savePayment(
      createPayment(company.id, {
        direction: 'out',
        clientId: vendor.id,
        amount: 30,
        currency: 'USD',
        method: 'credit_note',
        creditId: credit.id,
        allocations: [{ documentId: owed.id, amount: 30 }],
      }),
    );
    expect((await db.documents.get(owed.id))?.totals.balance).toBe(70);
    expect((await db.documents.get(credit.id))?.status).toBe('applied');

    await deleteDocument(credit.id);
    expect(await db.payments.count()).toBe(0);
    expect((await db.documents.get(owed.id))?.totals.balance).toBe(100);
  });

  it('take their attached files with them when deleted', async () => {
    const { company, vendor } = await setup();
    const owed = await bill(company, vendor, 100);
    await addAttachment(company.id, owed.id, FILE);
    expect(await db.attachments.where('ownerId').equals(owed.id).count()).toBe(1);
    await deleteDocument(owed.id);
    expect(await db.attachments.count()).toBe(0);
  });
});

describe('expenses', () => {
  it('need an amount and a category, and are numbered', async () => {
    const { company } = await setup();
    const category = (await db.accounts
      .where('[companyId+role]')
      .equals([company.id, 'expense'])
      .first())!;
    await expect(
      saveExpense(createExpense(company.id, { accountId: category.id, amount: 0 })),
    ).rejects.toThrow(ExpenseError);
    await expect(saveExpense(createExpense(company.id, { amount: 12 }))).rejects.toThrow(
      'Choose a category.',
    );
    const saved = await saveExpense(
      createExpense(company.id, { accountId: category.id, amount: 12.345, date: '2026-05-04' }),
    );
    expect(saved).toMatchObject({ number: 'EXP-2026-0001', amount: 12.35, currency: 'USD' });
  });

  it('keep who was paid when it is not a vendor, trimmed', async () => {
    const { company } = await setup();
    const category = (await db.accounts
      .where('[companyId+role]')
      .equals([company.id, 'expense'])
      .first())!;
    const named = await saveExpense(
      createExpense(company.id, { accountId: category.id, amount: 5, payee: '  Corner shop ' }),
    );
    expect((await db.expenses.get(named.id))?.payee).toBe('Corner shop');
    // Nothing typed: no name kept, as before.
    const blank = await saveExpense(
      createExpense(company.id, { accountId: category.id, amount: 5, payee: '  ' }),
    );
    expect(await db.expenses.get(blank.id)).not.toHaveProperty('payee');
    const plain = await saveExpense(
      createExpense(company.id, { accountId: category.id, amount: 5 }),
    );
    expect(await db.expenses.get(plain.id)).not.toHaveProperty('payee');
  });

  it('respect the lock date and delete their receipts with them', async () => {
    const { company, vendor } = await setup();
    const category = (await db.accounts
      .where('[companyId+role]')
      .equals([company.id, 'expense'])
      .first())!;
    const expense = await saveExpense(
      createExpense(company.id, {
        accountId: category.id,
        amount: 20,
        date: '2026-03-10',
        vendorId: vendor.id,
      }),
    );
    await addAttachment(company.id, expense.id, FILE);
    // A vendor with expenses is kept (it can be archived instead).
    expect(await clientHasRecords(vendor.id)).toBe(true);

    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: '2026-03-31' },
    });
    await expect(deleteExpense(expense.id)).rejects.toThrow(LockedPeriodError);
    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: null },
    });

    await deleteExpense(expense.id);
    expect(await db.expenses.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });
});
