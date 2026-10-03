import { describe, expect, it } from 'vitest';
import { createClient, createDocument } from '@/db/defaults';
import type { InvoiceDocument } from '@/db/types';
import { applyTotals } from '@/db/documents';
import { createPayment } from '@/db/payments';
import { agingReport, paymentsReport, presetRange, salesByClient, taxReport } from './reports';

const client = createClient('co', { id: 'c1', name: 'Acme' });

function invoice(overrides: Partial<InvoiceDocument>, price = 100, paid = 0): InvoiceDocument {
  const doc = createDocument('co', overrides.type ?? 'invoice', {
    clientId: 'c1',
    currency: 'USD',
    status: 'sent',
    items: [
      {
        id: 'i',
        kind: 'item',
        productId: null,
        name: 'x',
        description: '',
        quantity: 1,
        unit: '',
        unitPrice: price,
        discount: 0,
        discountType: 'percent',
        taxes: [{ name: 'VAT', rate: 20 }],
      },
    ],
    ...overrides,
  });
  return applyTotals(doc, paid, null);
}

describe('reports', () => {
  it('computes date presets', () => {
    expect(presetRange('this-month', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(presetRange('last-month', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('this-quarter', '2026-05-10')).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
    expect(presetRange('last-quarter', '2026-02-10')).toEqual({
      from: '2025-10-01',
      to: '2025-12-31',
    });
    expect(presetRange('last-year', '2026-02-10')).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('buckets open invoices by days overdue', () => {
    const docs = [
      invoice({ dueDate: '2026-03-20' }), // current
      invoice({ dueDate: '2026-03-01' }), // 9 days late
      invoice({ dueDate: '2026-01-01' }), // 68 days late
      invoice({ dueDate: '2025-10-01' }, 100, 20), // 160 days, partially paid
      invoice({ dueDate: '2025-10-01', status: 'paid' }, 100, 120),
    ];
    const r = agingReport(docs, [client], 'USD', '2026-03-10');
    expect(r.totals).toEqual([120, 120, 0, 120, 100]);
    expect(r.total).toBe(460);
    expect(r.rows[0]).toMatchObject({ clientName: 'Acme', total: 460 });
  });

  it('summarizes tax minus credit notes within the range', () => {
    const docs = [
      invoice({ issueDate: '2026-04-02' }, 100),
      invoice({ issueDate: '2026-04-20' }, 50),
      invoice({ issueDate: '2026-05-01' }, 1000), // outside
      invoice({ issueDate: '2026-04-05', status: 'draft' }, 1000), // draft
      invoice({ issueDate: '2026-04-25', type: 'credit' }, 30),
    ];
    const r = taxReport(docs, [client], 'USD', { from: '2026-04-01', to: '2026-04-30' });
    expect(r.rows).toEqual([
      expect.objectContaining({ name: 'VAT', rate: 20, base: 120, tax: 24 }),
    ]);
    expect(r).toMatchObject({ net: 120, tax: 24, gross: 144, documents: 3 });
  });

  it('totals sales per client', () => {
    const docs = [
      invoice({ issueDate: '2026-04-02' }, 100, 50),
      invoice({ issueDate: '2026-04-03' }, 100),
    ];
    const r = salesByClient(docs, [client], 'USD', { from: '2026-04-01', to: '2026-04-30' });
    expect(r.totals).toEqual({ invoices: 2, invoiced: 240, paid: 50, outstanding: 190 });
  });

  it('keeps sales and purchases apart', () => {
    const docs = [
      invoice({ dueDate: '2026-03-01', issueDate: '2026-02-01' }),
      invoice({ type: 'bill', dueDate: '2026-01-01', issueDate: '2026-01-01' }, 50),
    ];
    expect(agingReport(docs, [client], 'USD', '2026-03-10').total).toBe(120);
    const payables = agingReport(docs, [client], 'USD', '2026-03-10', 'bill');
    expect(payables.totals).toEqual([0, 0, 0, 60, 0]);

    const range = { from: '2026-01-01', to: '2026-12-31' };
    expect(salesByClient(docs, [client], 'USD', range, 'bill').totals.invoiced).toBe(60);

    const payments = [
      createPayment('co', { amount: 10, currency: 'USD', date: '2026-02-01' }),
      createPayment('co', { direction: 'out', amount: 4, currency: 'USD', date: '2026-02-02' }),
    ];
    expect(paymentsReport(payments, 'USD', range).total).toBe(10);
    expect(paymentsReport(payments, 'USD', range, 'out').total).toBe(4);
  });
});

describe('aging at a date', () => {
  it('counts what was owed then, after payments made by that date', async () => {
    const { agingAt } = await import('./reports');
    const doc = (id: string, issueDate: string, dueDate: string, total: number) =>
      ({
        id,
        type: 'invoice',
        status: 'partial',
        clientId: 'c1',
        issueDate,
        dueDate,
        currency: 'KWD',
        totals: { total, paid: 0, balance: total, subtotal: total, discount: 0, taxTotal: 0 },
      }) as unknown as import('@/db/types').InvoiceDocument;
    const pay = (date: string, documentId: string, amount: number) =>
      ({
        id: `${date}-${documentId}`,
        date,
        amount,
        allocations: [{ documentId, amount }],
      }) as unknown as import('@/db/types').Payment;
    const docs = [
      doc('a', '2026-10-01', '2026-10-31', 100.25),
      doc('b', '2026-12-01', '2026-12-31', 50),
      doc('late', '2027-01-05', '2027-02-04', 70),
    ];
    const payments = [pay('2026-11-15', 'a', 40), pay('2027-01-10', 'a', 60.25)];
    const clients = [{ id: 'c1', name: 'Gulf Co' }] as import('@/db/types').Client[];
    const aging = agingAt(docs, payments, clients, '2026-12-31', 'invoice', 'KWD');
    // a: 60.250 owed, 61 days late; b: 50.000, due that day.
    expect(aging.rows[0].buckets).toEqual([50_000, 0, 0, 60_250, 0]);
    expect(aging.total).toBe(110_250);
    expect(agingAt(docs, payments, clients, '2027-01-31', 'invoice', 'KWD').total).toBe(120_000);
  });
});
