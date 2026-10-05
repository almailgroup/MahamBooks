import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createProduct } from './defaults';
import { deleteDocument, draftDocument, saveDocument, setDocumentStatus } from './documents';
import { loadLedger, LockedPeriodError } from './accounting';
import { saveClient, setupCompany } from './records';
import { AllocationError, createPayment, savePayment } from './payments';
import { saveItem } from './inventory';
import type { Client, Company, DocumentType, InvoiceDocument, Payment } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function lock(company: Company, date: string) {
  const fresh = (await db.companies.get(company.id))!;
  await db.companies.update(company.id, { accounting: { ...fresh.accounting!, lockDate: date } });
  return (await db.companies.get(company.id))!;
}

async function books() {
  const company = await setupCompany({ name: 'Review Co' });
  const client = await saveClient(createClient(company.id, { name: 'Sample Client' }));
  const vendor = await saveClient(
    createClient(company.id, { name: 'Sample Vendor', isVendor: true, isCustomer: false }),
  );
  return { company, client, vendor };
}

async function issue(
  company: Company,
  contact: Client,
  type: DocumentType,
  price: number,
  extra: Partial<InvoiceDocument> = {},
): Promise<InvoiceDocument> {
  const draft = await draftDocument(company, type, contact);
  return saveDocument({
    ...draft,
    status: 'sent',
    issueDate: '2026-10-01',
    items: [{ ...draft.items[0], name: 'Work', quantity: 1, unitPrice: price, taxes: [] }],
    ...extra,
  });
}

/** Applies a credit note (vendor credit) to an invoice (bill), as the "Apply credit" dialog does. */
function applyCredit(
  company: Company,
  credit: InvoiceDocument,
  allocations: Payment['allocations'],
  date = '2026-10-02',
) {
  return savePayment(
    createPayment(company.id, {
      direction: credit.type === 'vendor_credit' ? 'out' : 'in',
      clientId: credit.clientId,
      date,
      amount: allocations.reduce((s, a) => s + a.amount, 0),
      currency: credit.currency,
      method: 'credit_note',
      creditId: credit.id,
      allocations,
    }),
  );
}

async function receivable(company: Company, role: 'receivable' | 'payable' = 'receivable') {
  const { accounts, lines } = await loadLedger((await db.companies.get(company.id))!);
  const account = accounts.find((a) => a.role === role)!;
  return lines.filter((l) => l.accountId === account.id).reduce((s, l) => s + l.amount, 0) / 1000;
}

describe('payments against a draft', () => {
  it('are refused until the invoice is issued, so nothing posts in a locked period', async () => {
    const { company, client } = await books();
    const draft = await draftDocument(company, 'invoice', client);
    draft.items[0] = { ...draft.items[0], name: 'Work', quantity: 1, unitPrice: 100 };
    // Drafts are not in the books, so one can be dated in a period about to be locked.
    const invoice = await saveDocument({ ...draft, issueDate: '2026-01-15' });
    const locked = await lock(company, '2026-06-30');
    await expect(setDocumentStatus(invoice.id, 'sent')).rejects.toThrow(LockedPeriodError);

    const payment = savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-07-10',
        amount: 100,
        currency: 'KWD',
        allocations: [{ documentId: invoice.id, amount: 100 }],
      }),
    );
    await expect(payment).rejects.toThrow(AllocationError);
    await expect(payment).rejects.toThrow(`Issue invoice ${invoice.number} first.`);
    expect((await db.documents.get(invoice.id))?.status).toBe('draft');
    const { lines } = await loadLedger(locked);
    expect(lines.filter((l) => l.date <= '2026-06-30')).toEqual([]);
  });

  it('are refused for draft bills and stock is never skipped', async () => {
    const { company, client, vendor } = await books();
    const item = await saveItem(
      createProduct(company.id, { name: 'Widget', kind: 'stock', unit: 'pc', unitPrice: 5 }),
    );
    const bill = await issue(company, vendor, 'bill', 0, {
      items: [
        {
          ...(await draftDocument(company, 'bill', vendor)).items[0],
          productId: item.id,
          name: 'Widget',
          quantity: 10,
          unitPrice: 2,
        },
      ],
    });
    expect(bill.status).toBe('sent');
    const draft = await draftDocument(company, 'invoice', client);
    const invoice = await saveDocument({
      ...draft,
      issueDate: '2026-10-02',
      items: [{ ...draft.items[0], productId: item.id, name: 'Widget', quantity: 4, unitPrice: 5 }],
    });
    await expect(
      savePayment(
        createPayment(company.id, {
          clientId: client.id,
          date: '2026-10-03',
          amount: 20,
          currency: 'KWD',
          allocations: [{ documentId: invoice.id, amount: 20 }],
        }),
      ),
    ).rejects.toThrow(`Issue invoice ${invoice.number} first.`);
    const draftBill = await draftDocument(company, 'bill', vendor);
    const unopened = await saveDocument({
      ...draftBill,
      items: [{ ...draftBill.items[0], name: 'Rent', quantity: 1, unitPrice: 50 }],
    });
    await expect(
      savePayment(
        createPayment(company.id, {
          direction: 'out',
          clientId: vendor.id,
          amount: 50,
          currency: 'KWD',
          allocations: [{ documentId: unopened.id, amount: 50 }],
        }),
      ),
    ).rejects.toThrow(`Mark bill ${unopened.number} as open first.`);
    expect((await db.documents.get(invoice.id))?.status).toBe('draft');
    expect(await db.stockMovements.where('sourceId').equals(invoice.id).count()).toBe(0);
  });

  it('kept on an invoice voided since still let the payment be edited', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 100);
    const payment = await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-10-02',
        amount: 100,
        currency: 'KWD',
        allocations: [{ documentId: invoice.id, amount: 100 }],
      }),
    );
    await setDocumentStatus(invoice.id, 'void');
    const edited = await savePayment({ ...payment, notes: 'Called the client' });
    expect(edited.allocations).toEqual([{ documentId: invoice.id, amount: 100 }]);
    await expect(
      savePayment({ ...payment, allocations: [{ documentId: invoice.id, amount: 100.5 }] }),
    ).rejects.toThrow(AllocationError);
  });
});

describe('an advance received in a locked period', () => {
  it('can be applied to an invoice issued after the lock date, and nothing else changes', async () => {
    const { company, client } = await books();
    const advance = await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-12-20',
        amount: 300,
        currency: 'KWD',
        allocations: [],
      }),
    );
    const locked = await lock(company, '2026-12-31');
    const invoice = await issue(company, client, 'invoice', 300, { issueDate: '2027-01-05' });
    const before = (await loadLedger(locked)).lines
      .map((l) => `${l.date}:${l.accountId}:${l.amount}`)
      .sort();
    await savePayment({ ...advance, allocations: [{ documentId: invoice.id, amount: 300 }] });
    const after = (await loadLedger(locked)).lines
      .map((l) => `${l.date}:${l.accountId}:${l.amount}`)
      .sort();
    expect(after).toEqual(before);
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');

    // What the books show of it still can't change.
    const stored = (await db.payments.get(advance.id))!;
    await expect(savePayment({ ...stored, amount: 350 })).rejects.toThrow(LockedPeriodError);
    await expect(savePayment({ ...stored, date: '2027-01-02' })).rejects.toThrow(LockedPeriodError);
  });
});

describe('credits applied to documents that leave the books', () => {
  it('voiding a credit note takes it off the invoice, which is owed again', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 100);
    const credit = await issue(company, client, 'credit', 40, { issueDate: '2026-10-02' });
    await applyCredit(company, credit, [{ documentId: invoice.id, amount: 40 }]);
    expect((await db.documents.get(invoice.id))?.totals.balance).toBe(60);

    await setDocumentStatus(credit.id, 'void');
    const inv = (await db.documents.get(invoice.id))!;
    expect({ status: inv.status, balance: inv.totals.balance }).toEqual({
      status: 'sent',
      balance: 100,
    });
    expect(await db.payments.where('creditId').equals(credit.id).count()).toBe(0);
    expect(await receivable(company)).toBe(100);
    // Restored, the credit note is free to use again.
    await setDocumentStatus(credit.id, 'sent');
    const restored = (await db.documents.get(credit.id))!;
    expect({ status: restored.status, balance: restored.totals.balance }).toEqual({
      status: 'sent',
      balance: 40,
    });
  });

  it('deleting the invoice gives the credit back to the credit note', async () => {
    const { company, client } = await books();
    const invoice = await issue(company, client, 'invoice', 100);
    const credit = await issue(company, client, 'credit', 40, { issueDate: '2026-10-02' });
    await applyCredit(company, credit, [{ documentId: invoice.id, amount: 40 }]);
    expect((await db.documents.get(credit.id))?.status).toBe('applied');

    await deleteDocument(invoice.id);
    const after = (await db.documents.get(credit.id))!;
    expect({ status: after.status, balance: after.totals.balance }).toEqual({
      status: 'sent',
      balance: 40,
    });
    expect(await db.payments.where('creditId').equals(credit.id).count()).toBe(0);
    expect(await receivable(company)).toBe(-40);
  });

  it('voiding the invoice gives the credit back; other invoices keep theirs', async () => {
    const { company, client } = await books();
    const first = await issue(company, client, 'invoice', 100);
    const second = await issue(company, client, 'invoice', 50);
    const credit = await issue(company, client, 'credit', 70, { issueDate: '2026-10-02' });
    const application = await applyCredit(company, credit, [
      { documentId: first.id, amount: 40 },
      { documentId: second.id, amount: 30 },
    ]);

    await setDocumentStatus(first.id, 'void');
    const stored = (await db.payments.get(application.id))!;
    expect(stored).toMatchObject({
      amount: 30,
      allocations: [{ documentId: second.id, amount: 30 }],
      documentIds: [second.id],
    });
    const [voided, kept, cn] = await db.documents.bulkGet([first.id, second.id, credit.id]);
    expect(voided?.status).toBe('void');
    expect(kept?.totals.balance).toBe(20);
    expect({ status: cn?.status, balance: cn?.totals.balance }).toEqual({
      status: 'partial',
      balance: 40,
    });
    // The books agree: 50 − 70 of credit, of which 30 applied.
    expect(await receivable(company)).toBe(-20);
  });

  it('works the same for vendor credits and bills', async () => {
    const { company, vendor } = await books();
    const bill = await issue(company, vendor, 'bill', 200);
    const credit = await issue(company, vendor, 'vendor_credit', 80, { issueDate: '2026-10-02' });
    await applyCredit(company, credit, [{ documentId: bill.id, amount: 80 }]);
    expect((await db.documents.get(bill.id))?.totals.balance).toBe(120);

    await setDocumentStatus(credit.id, 'void');
    expect((await db.documents.get(bill.id))?.totals.balance).toBe(200);
    expect(await receivable(company, 'payable')).toBe(-200);

    await setDocumentStatus(credit.id, 'sent');
    await applyCredit(company, credit, [{ documentId: bill.id, amount: 80 }]);
    await deleteDocument(bill.id);
    const after = (await db.documents.get(credit.id))!;
    expect({ status: after.status, balance: after.totals.balance }).toEqual({
      status: 'sent',
      balance: 80,
    });
  });
});
