import { describe, expect, it } from 'vitest';
import type { InvoiceDocument, LineItem } from '@/db/types';
import { displayStatus, issuedStatus, settledStatus } from './status';
import {
  copyLines,
  deliveryStatusOf,
  lineProgress,
  orderStatus,
  partDiscount,
  type RelatedDocument,
} from './orders';

const line = (id: string, quantity: number, extra: Partial<LineItem> = {}): LineItem => ({
  id,
  kind: 'item',
  productId: null,
  name: `Item ${id}`,
  description: '',
  quantity,
  unit: 'pcs',
  unitPrice: 10,
  discount: 0,
  discountType: 'percent',
  taxes: [],
  ...extra,
});

const heading = (id: string): LineItem => ({ ...line(id, 0), kind: 'heading', name: 'Section' });

const order: Pick<InvoiceDocument, 'id' | 'type' | 'items'> = {
  id: 'so',
  type: 'sales_order',
  items: [heading('h'), line('a', 5), line('b', 2.5)],
};

const child = (
  id: string,
  type: InvoiceDocument['type'],
  status: InvoiceDocument['status'],
  sourceId: string,
  lines: [string, number, string?][],
): RelatedDocument => ({
  id,
  type,
  status,
  sourceId,
  items: lines.map(([source, quantity, lineId]) => ({
    ...line(lineId ?? `${id}-${source}`, quantity),
    sourceLineId: source,
  })),
});

describe('order progress', () => {
  it('counts invoices that are not void, drafts included', () => {
    const progress = lineProgress(order, [
      child('i1', 'invoice', 'draft', 'so', [['a', 2]]),
      child('i2', 'invoice', 'sent', 'so', [
        ['a', 1],
        ['b', 2.5],
      ]),
      child('i3', 'invoice', 'void', 'so', [['a', 2]]),
      // Made from another order: does not count.
      child('i4', 'invoice', 'sent', 'other', [['a', 5]]),
    ]);
    expect(progress.map((p) => [p.line.id, p.invoiced, p.toInvoice])).toEqual([
      ['a', 3, 2],
      ['b', 2.5, 0],
    ]);
  });

  it('adds up decimal quantities exactly', () => {
    const progress = lineProgress({ ...order, items: [line('a', 0.3)] }, [
      child('i1', 'invoice', 'sent', 'so', [['a', 0.1]]),
      child('i2', 'invoice', 'sent', 'so', [['a', 0.2]]),
    ]);
    expect(progress[0].invoiced).toBe(0.3);
    expect(progress[0].toInvoice).toBe(0);
  });

  it('separates signed deliveries from draft delivery notes', () => {
    const progress = lineProgress(order, [
      child('d1', 'delivery_note', 'delivered', 'so', [['a', 2]]),
      child('d2', 'delivery_note', 'draft', 'so', [['a', 1]]),
      child('d3', 'delivery_note', 'cancelled', 'so', [['a', 2]]),
    ]);
    expect(progress[0]).toMatchObject({ delivered: 2, inDelivery: 1, toDeliver: 2 });
    expect(progress[1]).toMatchObject({ delivered: 0, inDelivery: 0, toDeliver: 2.5 });
  });

  it('counts delivery notes made from the order’s invoices', () => {
    const progress = lineProgress(order, [
      child('i1', 'invoice', 'sent', 'so', [['a', 5, 'i1-line']]),
      child('d1', 'delivery_note', 'delivered', 'i1', [['i1-line', 4]]),
      // A delivery note of an invoice that is not from this order.
      child('d2', 'delivery_note', 'delivered', 'elsewhere', [['i1-line', 1]]),
    ]);
    expect(progress[0]).toMatchObject({ invoiced: 5, delivered: 4, toDeliver: 1 });
  });

  it('bills purchase orders', () => {
    const po = { ...order, id: 'po', type: 'purchase_order' as const };
    const progress = lineProgress(po, [
      child('b1', 'bill', 'sent', 'po', [['a', 5]]),
      // Invoices never count for a purchase order.
      child('i1', 'invoice', 'sent', 'po', [['b', 2.5]]),
    ]);
    expect(progress.map((p) => p.toInvoice)).toEqual([0, 2.5]);
  });

  it('tracks what an invoice has delivered', () => {
    const invoice = { id: 'inv', type: 'invoice' as const, items: [line('x', 3)] };
    const progress = lineProgress(invoice, [
      child('d1', 'delivery_note', 'delivered', 'inv', [['x', 1]]),
    ]);
    expect(progress[0]).toMatchObject({ delivered: 1, toDeliver: 2, toInvoice: 3 });
  });
});

describe('order status', () => {
  const progress = (invoiced: number[], delivered: number[] = invoiced.map(() => 0)) =>
    invoiced.map((q, i) => ({
      line: line(String(i), 4),
      ordered: 4,
      invoiced: q,
      delivered: delivered[i],
      inDelivery: 0,
      toInvoice: Math.max(0, 4 - q),
      toDeliver: Math.max(0, 4 - delivered[i]),
    }));

  it('follows the invoices of a sales order', () => {
    const so = { type: 'sales_order' as const, status: 'confirmed' as const };
    expect(orderStatus(so, progress([0, 0]))).toBe('confirmed');
    expect(orderStatus(so, progress([4, 0]))).toBe('partially_invoiced');
    expect(orderStatus(so, progress([4, 5]))).toBe('invoiced');
    expect(orderStatus({ ...so, status: 'invoiced' }, progress([0, 0]))).toBe('confirmed');
  });

  it('follows the bills of a purchase order', () => {
    const po = { type: 'purchase_order' as const, status: 'issued' as const };
    expect(orderStatus(po, progress([1, 0]))).toBe('partially_billed');
    expect(orderStatus(po, progress([4, 4]))).toBe('billed');
  });

  it('leaves drafts, cancelled orders and other documents alone', () => {
    expect(orderStatus({ type: 'sales_order', status: 'draft' }, progress([4]))).toBe('draft');
    expect(orderStatus({ type: 'sales_order', status: 'cancelled' }, progress([4]))).toBe(
      'cancelled',
    );
    expect(orderStatus({ type: 'invoice', status: 'sent' }, progress([4]))).toBe('sent');
  });

  it('works out delivery progress, ignoring lines without a quantity', () => {
    expect(deliveryStatusOf(progress([0, 0], [0, 0]))).toBe('not_delivered');
    expect(deliveryStatusOf(progress([0, 0], [2, 0]))).toBe('partially_delivered');
    expect(deliveryStatusOf(progress([0, 0], [4, 4]))).toBe('delivered');
    const withNote = [
      ...progress([0], [4]),
      { ...progress([0])[0], ordered: 0, toDeliver: 0, toInvoice: 0 },
    ];
    expect(deliveryStatusOf(withNote)).toBe('delivered');
  });
});

describe('copying lines', () => {
  it('keeps the chosen quantities, Arabic names and headings above copied items', () => {
    let n = 0;
    const items = [
      heading('h1'),
      line('a', 5, { nameAr: 'طابعة', serialNumber: 'SN-1', accountId: 'acc' }),
      heading('h2'),
      line('b', 2),
    ];
    const copied = copyLines(
      items,
      new Map([
        ['a', 2],
        ['b', 0],
      ]),
      () => `n${++n}`,
    );
    expect(copied).toHaveLength(2);
    expect(copied[0]).toMatchObject({ id: 'n1', kind: 'heading', sourceLineId: undefined });
    expect(copied[1]).toMatchObject({
      id: 'n2',
      quantity: 2,
      nameAr: 'طابعة',
      unit: 'pcs',
      serialNumber: 'SN-1',
      accountId: 'acc',
      sourceLineId: 'a',
    });
  });
});

describe('discount of a part', () => {
  const so = {
    items: [line('a', 3, { unitPrice: 33.333 }), line('b', 1, { unitPrice: 0.001 })],
    discount: 10,
    discountType: 'amount' as const,
    currency: 'KWD',
  };

  it('keeps a percentage as it is', () => {
    expect(partDiscount({ ...so, discountType: 'percent', discount: 5 }, [], [], false)).toBe(5);
  });

  it('shares a fixed amount by value and lets the last part take the rest', () => {
    // A third of the order's KD 100.000: KD 3.333 of the KD 10.000 discount.
    const first = partDiscount(so, [line('a', 1, { unitPrice: 33.333 })], [], false);
    expect(first).toBe(3.333);
    const last = partDiscount(so, [], [{ discount: first, discountType: 'amount' }], true);
    expect(last).toBe(6.667);
  });

  it('gives nothing when the order has no value', () => {
    const free = { ...so, items: [line('a', 1, { unitPrice: 0 })] };
    expect(partDiscount(free, free.items, [], false)).toBe(0);
  });
});

describe('statuses of the new documents', () => {
  const doc = (type: InvoiceDocument['type'], status: InvoiceDocument['status']) => ({
    type,
    status,
    dueDate: '2026-10-01',
    totals: { balance: 100 },
  });

  it('expire proformas sent past their valid-until date', () => {
    expect(displayStatus(doc('proforma', 'sent'), '2026-10-02')).toBe('expired');
    expect(displayStatus(doc('proforma', 'accepted'), '2026-10-02')).toBe('accepted');
    // Orders and delivery notes are never overdue.
    expect(displayStatus(doc('sales_order', 'confirmed'), '2026-10-02')).toBe('confirmed');
    expect(displayStatus(doc('delivery_note', 'delivered'), '2026-10-02')).toBe('delivered');
  });

  it('are confirmed or issued rather than sent, and never settled by payments', () => {
    expect(issuedStatus('sales_order')).toBe('confirmed');
    expect(issuedStatus('purchase_order')).toBe('issued');
    expect(issuedStatus('proforma')).toBe('sent');
    expect(issuedStatus('delivery_note')).toBeNull();
    expect(settledStatus({ type: 'sales_order', status: 'confirmed' }, 100, 100)).toBe('confirmed');
    expect(settledStatus({ type: 'proforma', status: 'sent' }, 100, 100)).toBe('sent');
    expect(settledStatus({ type: 'invoice', status: 'sent' }, 100, 100)).toBe('paid');
  });
});
