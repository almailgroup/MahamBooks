import { describe, expect, it } from 'vitest';
import type { StockMovement, StockSourceType } from '@/db/types';
import { costMovements, stockLevels, type CostingOptions } from './costing';

let next = 0;
function move(
  date: string,
  sourceType: StockSourceType,
  quantity: number,
  extra: Partial<StockMovement> = {},
): StockMovement {
  next += 1;
  return {
    id: `m${String(next).padStart(3, '0')}`,
    companyId: 'c',
    productId: 'p',
    warehouseId: 'main',
    date,
    quantity,
    unitCost: 0,
    value: 0,
    sourceType,
    sourceId: extra.sourceId ?? `s${next}`,
    lineId: null,
    documentId: null,
    number: '',
    sourceValue: null,
    returnOf: null,
    basisQuantity: null,
    sequence: String(next).padStart(4, '0'),
    notes: '',
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

const KWD: CostingOptions = { precision: 3, lockDate: null };

/** Costs the movements and returns them with their values, in input order. */
function cost(movements: StockMovement[], options: CostingOptions = KWD): StockMovement[] {
  const changed = new Map(costMovements(movements, options).map((m) => [m.id, m]));
  return movements.map((m) => changed.get(m.id) ?? m);
}

describe('weighted average cost', () => {
  it('costs a sale at the average of two purchases (KWD, 3 decimals)', () => {
    const [a, b, sale] = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 12.5 }),
      move('2026-10-02', 'bill', 10, { sourceValue: 15 }),
      move('2026-10-03', 'invoice', -5),
    ]);
    expect(a.value).toBe(12.5);
    expect(a.unitCost).toBe(1.25);
    expect(b.unitCost).toBe(1.5);
    // 27.500 / 20 × 5 = 6.875
    expect(sale.value).toBe(-6.875);
    expect(sale.unitCost).toBe(1.375);
  });

  it('takes the exact remaining value with the last units', () => {
    const [, s1, s2, s3] = cost([
      move('2026-10-01', 'bill', 3, { sourceValue: 1 }),
      move('2026-10-02', 'invoice', -1),
      move('2026-10-03', 'invoice', -1),
      move('2026-10-04', 'invoice', -1),
    ]);
    // 1.000 / 3 = 0.333; then 0.667 / 2 = 0.3335 → 0.334; the last unit takes what is left.
    expect([s1.value, s2.value, s3.value]).toEqual([-0.333, -0.334, -0.333]);
    expect(Math.round((s1.value + s2.value + s3.value) * 1000)).toBe(-1000);
    expect(s1.unitCost).toBe(0.333);
  });

  it('re-costs later sales when a purchase is entered back-dated', () => {
    const first = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 10 }),
      move('2026-10-10', 'invoice', -5),
    ]);
    expect(first[1].value).toBe(-5);
    // A bill dated before the sale but entered afterwards.
    const late = move('2026-10-05', 'bill', 10, { sourceValue: 20 });
    const [, sale, bill] = cost([...first, late]);
    expect(bill.value).toBe(20);
    expect(sale.value).toBe(-7.5);
  });

  it('orders same-day movements: receipts before sales, counts last', () => {
    const [sale, bill, count] = cost([
      move('2026-10-01', 'invoice', -2),
      move('2026-10-01', 'bill', 4, { sourceValue: 8 }),
      move('2026-10-01', 'adjustment', -1),
    ]);
    expect(bill.value).toBe(8);
    expect(sale.value).toBe(-4);
    expect(count.value).toBe(-2);
  });

  it('brings goods back on a credit note at the cost they left with', () => {
    const [, , sale, , credit] = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 10 }),
      move('2026-10-02', 'bill', 10, { sourceValue: 20 }),
      move('2026-10-03', 'invoice', -4, { sourceId: 'inv-1' }),
      move('2026-10-04', 'bill', 4, { sourceValue: 12 }),
      move('2026-10-05', 'credit', 2, { returnOf: 'inv-1' }),
    ]);
    expect(sale.value).toBe(-6);
    // At the 1.500 the invoice took them out at, not today's average.
    expect(credit.value).toBe(3);
    expect(credit.unitCost).toBe(1.5);
  });

  it('brings goods back at the current average when the invoice is unknown', () => {
    const [, credit] = cost([
      move('2026-10-01', 'bill', 4, { sourceValue: 5 }),
      move('2026-10-05', 'credit', 1, { returnOf: null }),
    ]);
    expect(credit.value).toBe(1.25);
  });

  it('settles stock sold short when it is received', () => {
    const [sale, bill, later] = cost(
      [
        move('2026-10-01', 'invoice', -2),
        move('2026-10-02', 'bill', 10, { sourceValue: 15 }),
        move('2026-10-03', 'invoice', -8),
      ],
      { ...KWD, fallbackUnitCost: 1 },
    );
    // Sold at the cost price before any stock came in…
    expect(sale.value).toBe(-2);
    // …the 8 units left take the cost of the bill; 1.000 more is cost of sales.
    expect(bill.value).toBe(14);
    expect(later.value).toBe(-12);
  });

  it('returns goods to a vendor at the value credited', () => {
    const [, , ret, sale] = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 10 }),
      move('2026-10-02', 'bill', 10, { sourceValue: 20 }),
      move('2026-10-03', 'vendor_credit', -5, { sourceValue: -10 }),
      move('2026-10-04', 'invoice', -15),
    ]);
    expect(ret.value).toBe(-10);
    expect(sale.value).toBe(-20);
  });

  it('returning the last units to a vendor takes the whole value', () => {
    const [, ret] = cost([
      move('2026-10-01', 'bill', 2, { sourceValue: 3 }),
      move('2026-10-02', 'vendor_credit', -2, { sourceValue: -4 }),
    ]);
    expect(ret.value).toBe(-3);
  });

  it('spreads a landed cost over what is still in stock', () => {
    const [, , landed, sale] = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 10 }),
      move('2026-10-02', 'invoice', -4),
      move('2026-10-03', 'landed_cost', 0, { sourceValue: 2, basisQuantity: 10 }),
      move('2026-10-04', 'invoice', -6),
    ]);
    // 6 of the 10 units are left: 60% of the 2.000 stays in stock.
    expect(landed.value).toBe(1.2);
    expect(landed.unitCost).toBe(0.2);
    expect(sale.value).toBe(-7.2);
  });

  it('moves stock between warehouses without changing its value', () => {
    const movements = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 15 }),
      move('2026-10-02', 'transfer', -4, { warehouseId: 'main' }),
      move('2026-10-02', 'transfer', 4, { warehouseId: 'showroom' }),
      move('2026-10-03', 'invoice', -2, { warehouseId: 'showroom' }),
    ]);
    expect(movements[1].value).toBe(-6);
    expect(movements[2].value).toBe(6);
    expect(movements[3].value).toBe(-3);
    const level = stockLevels(movements, 3).get('p')!;
    expect(level.quantity).toBe(8);
    expect(level.value).toBe(12);
    expect(level.unitCost).toBe(1.5);
    expect(level.byWarehouse.get('main')).toBe(6);
    expect(level.byWarehouse.get('showroom')).toBe(2);
  });

  it('keeps the values of a locked period', () => {
    const posted = cost([
      move('2026-09-01', 'bill', 10, { sourceValue: 10 }),
      move('2026-09-10', 'invoice', -5),
    ]);
    // A bill back-dated into the locked period can't change September.
    const late = move('2026-09-05', 'bill', 10, { sourceValue: 30, value: 30, unitCost: 3 });
    const sale = move('2026-10-02', 'invoice', -5);
    const changed = costMovements([...posted, late, sale], { ...KWD, lockDate: '2026-09-30' });
    expect(changed.map((m) => m.id)).toEqual([sale.id]);
    // October continues from the locked figures: 15 units worth 35.000.
    expect(changed[0].value).toBe(-11.667);
  });

  it('reports stock levels at a date', () => {
    const movements = cost([
      move('2026-10-01', 'bill', 10, { sourceValue: 12.5 }),
      move('2026-10-05', 'invoice', -4),
    ]);
    expect(stockLevels(movements, 3, '2026-10-04').get('p')?.quantity).toBe(10);
    const now = stockLevels(movements, 3).get('p')!;
    expect(now.quantity).toBe(6);
    expect(now.value).toBe(7.5);
  });
});
