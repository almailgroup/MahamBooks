import { describe, expect, it } from 'vitest';
import { calculate, retentionOf, taxKey, taxKind, type CalcInput } from './calc';

const base: Omit<CalcInput, 'items'> = { precision: 2 };
const vat20 = { name: 'VAT', rate: 20 };

describe('calculate', () => {
  it('sums quantity x unit price', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 2, unitPrice: 50 },
        { quantity: 1, unitPrice: 25.5 },
      ],
    });
    expect(r.subtotal).toBe(125.5);
    expect(r.total).toBe(125.5);
    expect(r.balance).toBe(125.5);
    expect(r.lines.map((l) => l.net)).toEqual([100, 25.5]);
  });

  it('avoids floating point drift', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 0.1 },
        { quantity: 1, unitPrice: 0.2 },
      ],
    });
    expect(r.total).toBe(0.3);
  });

  it('supports fractional unit prices (e.g. per-piece postage)', () => {
    const r = calculate({ ...base, items: [{ quantity: 10000, unitPrice: 0.537 }] });
    expect(r.total).toBe(5370);
    const r2 = calculate({ ...base, items: [{ quantity: 1234, unitPrice: 0.4125 }] });
    expect(r2.total).toBe(509.03); // 509.025 rounds half up
  });

  it('applies percent and amount line discounts', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 100, discount: 10, discountType: 'percent' },
        { quantity: 2, unitPrice: 50, discount: 15, discountType: 'amount' },
      ],
    });
    expect(r.lines[0]).toMatchObject({ gross: 100, discount: 10, net: 90 });
    expect(r.lines[1]).toMatchObject({ gross: 100, discount: 15, net: 85 });
    expect(r.lineDiscountTotal).toBe(25);
    expect(r.subtotal).toBe(175);
  });

  it('applies a document discount before tax', () => {
    const r = calculate({
      ...base,
      items: [{ quantity: 2, unitPrice: 100 }],
      discount: 10,
      discountType: 'percent',
      taxes: [vat20],
    });
    expect(r.subtotal).toBe(200);
    expect(r.discount).toBe(20);
    expect(r.taxes).toEqual([
      expect.objectContaining({ name: 'VAT', rate: 20, base: 180, amount: 36 }),
    ]);
    expect(r.total).toBe(216);
    expect(r.netTotal).toBe(180);
  });

  it('prorates the document discount into line tax bases', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 100, taxes: [vat20] },
        { quantity: 1, unitPrice: 100 },
      ],
      discount: 20,
      discountType: 'amount',
    });
    // ratio = 180 / 200 = 0.9 -> taxable base 90 -> tax 18
    expect(r.taxes[0]).toMatchObject({ base: 90, amount: 18 });
    expect(r.total).toBe(198);
  });

  it('groups identical taxes across lines and document', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 100, taxes: [vat20] },
        { quantity: 1, unitPrice: 50, taxes: [{ name: 'Zero rated', rate: 0 }] },
        { quantity: 1, unitPrice: 50, taxes: [{ name: 'vat ', rate: 20 }] },
      ],
    });
    expect(r.taxes).toHaveLength(2);
    expect(r.taxes.find((t) => t.rate === 20)).toMatchObject({ base: 150, amount: 30 });
    expect(r.taxes.find((t) => t.rate === 0)).toMatchObject({ base: 50, amount: 0 });
    expect(r.total).toBe(230);
  });

  it('applies multiple taxes on the same base (not compounded)', () => {
    const r = calculate({
      ...base,
      items: [
        {
          quantity: 1,
          unitPrice: 100,
          taxes: [
            { name: 'GST', rate: 5 },
            { name: 'PST', rate: 7 },
          ],
        },
      ],
    });
    expect(r.taxTotal).toBe(12);
    expect(r.total).toBe(112);
    expect(r.lines[0].tax).toBe(12);
  });

  it('rounds taxes once per tax group', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 0.05, taxes: [{ name: 'T', rate: 10 }] },
        { quantity: 1, unitPrice: 0.05, taxes: [{ name: 'T', rate: 10 }] },
        { quantity: 1, unitPrice: 0.05, taxes: [{ name: 'T', rate: 10 }] },
      ],
    });
    // 3 x 0.005 = 0.015 -> 0.02 (not 3 x 0.01)
    expect(r.taxTotal).toBe(0.02);
    expect(r.total).toBe(0.17);
  });

  it('backs tax out of tax-inclusive prices', () => {
    const r = calculate({
      ...base,
      pricesIncludeTax: true,
      items: [{ quantity: 1, unitPrice: 120, taxes: [vat20] }],
    });
    expect(r.total).toBe(120);
    expect(r.taxTotal).toBe(20);
    expect(r.netTotal).toBe(100);
    expect(r.taxes[0]).toMatchObject({ base: 100, amount: 20 });
  });

  it('handles inclusive prices with a document discount', () => {
    const r = calculate({
      ...base,
      pricesIncludeTax: true,
      items: [
        { quantity: 1, unitPrice: 120 },
        { quantity: 1, unitPrice: 120 },
      ],
      taxes: [vat20],
      discount: 10,
      discountType: 'percent',
    });
    expect(r.subtotal).toBe(240);
    expect(r.discount).toBe(24);
    expect(r.total).toBe(216);
    expect(r.taxTotal).toBe(36);
    expect(r.netTotal).toBe(180);
  });

  it('adds charges outside the document discount, with their own taxes', () => {
    const r = calculate({
      ...base,
      items: [{ quantity: 1, unitPrice: 100, taxes: [vat20] }],
      discount: 50,
      discountType: 'percent',
      charges: [{ amount: 10, taxes: [vat20] }],
    });
    expect(r.discount).toBe(50);
    expect(r.chargesTotal).toBe(10);
    expect(r.taxes[0]).toMatchObject({ base: 60, amount: 12 });
    expect(r.total).toBe(72);
  });

  it('respects currency precision', () => {
    const jpy = calculate({ precision: 0, items: [{ quantity: 3, unitPrice: 333.33 }] });
    expect(jpy.total).toBe(1000);
    const kwd = calculate({ precision: 3, items: [{ quantity: 3, unitPrice: 0.4115 }] });
    expect(kwd.total).toBe(1.235);
  });

  it('computes balance and outstanding deposit', () => {
    const input: CalcInput = { ...base, items: [{ quantity: 1, unitPrice: 1000 }], deposit: 300 };
    expect(calculate({ ...input, paid: 100 })).toMatchObject({ balance: 900, depositDue: 200 });
    expect(calculate({ ...input, paid: 400 })).toMatchObject({ balance: 600, depositDue: 0 });
    expect(calculate({ ...input, deposit: 5000 })).toMatchObject({ depositDue: 1000 });
    expect(calculate({ ...input, deposit: 0 })).toMatchObject({ depositDue: 0 });
  });

  it('ignores headings and invalid taxes', () => {
    const r = calculate({
      ...base,
      items: [
        { kind: 'heading', quantity: 99, unitPrice: 99 },
        { quantity: 1, unitPrice: 10, taxes: [{ name: '', rate: 50 }] },
      ],
    });
    expect(r.lines[0]).toEqual({ gross: 0, discount: 0, net: 0, tax: 0 });
    expect(r.total).toBe(10);
    expect(r.taxes).toEqual([]);
  });

  it('supports negative amounts for credits and adjustments', () => {
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 100, taxes: [vat20] },
        { quantity: -1, unitPrice: 40, taxes: [vat20] },
      ],
    });
    expect(r.subtotal).toBe(60);
    expect(r.taxTotal).toBe(12);
    expect(r.total).toBe(72);
  });

  it('works out reverse charge without charging it', () => {
    const rc = { name: 'VAT', rate: 20, kind: 'reverse_charge' as const };
    const r = calculate({
      ...base,
      items: [
        { quantity: 1, unitPrice: 100, taxes: [rc] },
        { quantity: 1, unitPrice: 50, taxes: [vat20] },
      ],
    });
    expect(r.taxes).toEqual([
      expect.objectContaining({ kind: 'reverse_charge', base: 100, amount: 20 }),
      expect.objectContaining({ kind: 'standard', base: 50, amount: 10 }),
    ]);
    expect(r.taxTotal).toBe(10);
    expect(r.total).toBe(160);
    expect(r.lines.map((l) => l.tax)).toEqual([0, 10]);

    // Inclusive prices never contain reverse charge, so nothing is backed out.
    const inclusive = calculate({
      ...base,
      pricesIncludeTax: true,
      items: [{ quantity: 1, unitPrice: 100, taxes: [rc] }],
    });
    expect(inclusive.taxes[0]).toMatchObject({ base: 100, amount: 20 });
    expect(inclusive.total).toBe(100);
  });

  it('keeps reverse charge apart from the same rate charged normally', () => {
    expect(taxKey({ name: 'VAT', rate: 20, kind: 'reverse_charge' })).not.toBe(taxKey(vat20));
    expect(taxKey({ name: 'VAT', rate: 20, kind: 'standard' })).toBe(taxKey(vat20));
    expect(taxKind(vat20)).toBe('standard');
    expect(taxKind({ name: 'VAT', rate: 0 })).toBe('zero');
    expect(taxKind({ name: 'Exempt', rate: 0 })).toBe('exempt');
    expect(taxKind({ name: 'VAT', rate: 0, kind: 'out_of_scope' })).toBe('out_of_scope');
  });

  it('returns zeros for an empty document', () => {
    const r = calculate({ ...base, items: [] });
    expect(r).toMatchObject({ subtotal: 0, total: 0, balance: 0, taxTotal: 0 });
  });
});

describe('retention', () => {
  const kwd = (unitPrice: number, extra: Partial<CalcInput> = {}): CalcInput => ({
    precision: 3,
    items: [{ quantity: 1, unitPrice }],
    ...extra,
  });

  it('holds back a share of the total, rounded to the fils', () => {
    expect(retentionOf(1234.567, 5, 3)).toBe(61.728);
    // 5% of 0.010 is 0.0005: half a fils rounds up.
    expect(retentionOf(0.01, 5, 3)).toBe(0.001);
    expect(retentionOf(1000, 0, 3)).toBe(0);
    expect(retentionOf(1000, -5, 3)).toBe(0);
    expect(retentionOf(1000, 150, 3)).toBe(1000);
  });

  it('is not due: the balance leaves it out until it is released', () => {
    const held = calculate(kwd(1234.567, { retentionPercent: 5, paid: 500 }));
    expect(held).toMatchObject({
      total: 1234.567,
      retention: 61.728,
      retentionHeld: 61.728,
      paid: 500,
      balance: 672.839,
    });
    const released = calculate(
      kwd(1234.567, { retentionPercent: 5, paid: 500, retentionReleased: 61.728 }),
    );
    expect(released).toMatchObject({ retentionHeld: 0, balance: 734.567 });
    // More released than held counts as fully released.
    expect(calculate(kwd(100, { retentionPercent: 10, retentionReleased: 50 })).balance).toBe(100);
  });

  it('is never part of the deposit asked for', () => {
    expect(calculate(kwd(1000, { retentionPercent: 10, deposit: 1000 })).depositDue).toBe(900);
  });
});
