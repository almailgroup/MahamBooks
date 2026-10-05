import { beforeEach, describe, expect, it } from 'vitest';
import type { Client, InvoiceDocument, Payment } from '@/db/types';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { draftDocument, saveDocument } from '@/db/documents';
import { loadLedger } from '@/db/accounting';
import { saveClient, setupCompany } from '@/db/records';
import { createPayment, savePayment } from '@/db/payments';
import { financialPosition, specialAccounts } from './accounting/statements';
import { agingAt } from './reports';
import { buildStatement } from './statements';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const invoice = {
  id: 'inv1',
  type: 'invoice',
  status: 'sent',
  number: 'INV-1',
  clientId: 'c1',
  issueDate: '2026-11-01',
  dueDate: '2026-11-30',
  currency: 'KWD',
  items: [],
  totals: { total: 500, paid: 0, balance: 500, subtotal: 500, discount: 0, taxTotal: 0 },
} as unknown as InvoiceDocument;

// Paid by cheque in December; the bank returned it in February.
const cheque = {
  id: 'p1',
  number: 'PAY-1',
  clientId: 'c1',
  direction: 'in',
  method: 'cheque',
  date: '2026-12-10',
  amount: 500,
  currency: 'KWD',
  reference: '',
  allocations: [{ documentId: 'inv1', amount: 500 }],
  documentIds: ['inv1'],
  voided: true,
  voidedOn: '2027-02-05',
  cheque: { number: '000123', bank: 'NBK', date: '2026-12-10', drawer: '', status: 'returned' },
} as unknown as Payment;

const clients = [{ id: 'c1', name: 'Sample Client' }] as Client[];

describe('receivables aging at a past date (auditor pack)', () => {
  it('counts a cheque returned after that date as paying the invoice then', () => {
    const statement = buildStatement({
      side: 'customer',
      documents: [invoice],
      payments: [cheque],
      from: '2026-01-01',
      to: '2026-12-31',
      currency: 'KWD',
    });
    expect(statement.closing).toBe(0);
    expect(agingAt([invoice], [cheque], clients, '2026-12-31', 'invoice', 'KWD').total).toBe(0);
    // Once it came back, the invoice is owed again.
    expect(agingAt([invoice], [cheque], clients, '2027-02-05', 'invoice', 'KWD').total).toBe(
      500_000,
    );
  });

  it('adds payments and credit notes not applied yet, so the total is the books’ figure', async () => {
    const company = await setupCompany({ name: 'Review Co' });
    const client = await saveClient(createClient(company.id, { name: 'Sample Client' }));
    const issue = async (type: 'invoice' | 'credit', price: number) => {
      const draft = await draftDocument(company, type, client);
      return saveDocument({
        ...draft,
        status: 'sent',
        issueDate: '2026-11-01',
        dueDate: type === 'invoice' ? '2026-11-30' : null,
        items: [{ ...draft.items[0], name: 'Work', quantity: 1, unitPrice: price }],
      });
    };
    await issue('invoice', 100);
    await issue('credit', 30);
    await savePayment(
      createPayment(company.id, {
        clientId: client.id,
        date: '2026-12-01',
        amount: 50,
        currency: 'KWD',
        allocations: [],
      }),
    );
    const ledger = await loadLedger(company);
    const [documents, payments] = await Promise.all([
      db.documents.where('companyId').equals(company.id).toArray(),
      db.payments.where('companyId').equals(company.id).toArray(),
    ]);
    const aging = agingAt(documents, payments, [client], '2026-12-31', 'invoice', 'KWD', ledger);
    expect(aging.totals).toEqual([0, 0, 100_000, 0, 0]);
    expect(aging.unapplied).toBe(-80_000);
    const position = financialPosition(
      ledger.lines,
      ledger.accounts,
      '2026-12-31',
      { month: 12, day: 31 },
      specialAccounts(ledger.accounts, 'kw'),
    );
    const trade = position.currentAssets.find((c) => c.key === 'receivables')!.total;
    expect(aging.total).toBe(trade);
    expect(trade).toBe(20_000);
  });
});
