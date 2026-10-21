import { describe, expect, it } from 'vitest';
import type { NumberingRule } from '@/db/types';
import {
  allocateNumber,
  currentCounter,
  formatNumber,
  previewNumber,
  writtenBy,
} from './numbering';

const rule = (overrides: Partial<NumberingRule> = {}): NumberingRule => ({
  pattern: 'INV-{year}-{counter}',
  next: 1,
  padding: 4,
  reset: 'never',
  period: '',
  ...overrides,
});

describe('numbering', () => {
  it('formats placeholders', () => {
    expect(formatNumber(rule(), 7, '2026-03-09')).toBe('INV-2026-0007');
    expect(
      formatNumber(
        { pattern: '{client}/{yy}{month}{day}/{counter}', padding: 3 },
        12,
        '2026-03-09',
        'C-01',
      ),
    ).toBe('C-01/260309/012');
  });

  it('appends the counter when the pattern has none', () => {
    expect(formatNumber({ pattern: 'Q-', padding: 2 }, 3, '2026-01-01')).toBe('Q-03');
    expect(formatNumber({ pattern: '', padding: 0 }, 3, '2026-01-01')).toBe('3');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(formatNumber({ pattern: '{foo}-{counter}', padding: 1 }, 1, '2026-01-01')).toBe(
      '{foo}-1',
    );
  });

  it('resets yearly and monthly counters when the period changes', () => {
    expect(currentCounter(rule({ next: 40, reset: 'yearly', period: '2025' }), '2026-01-02')).toBe(
      1,
    );
    expect(currentCounter(rule({ next: 40, reset: 'yearly', period: '2026' }), '2026-05-02')).toBe(
      40,
    );
    expect(
      currentCounter(rule({ next: 9, reset: 'monthly', period: '2026-04' }), '2026-05-02'),
    ).toBe(1);
    expect(currentCounter(rule({ next: 9, reset: 'never', period: '2020' }), '2026-05-02')).toBe(9);
  });

  it('allocates the next free number and advances the rule', () => {
    const taken = new Set(['INV-2026-0003', 'INV-2026-0004']);
    const result = allocateNumber(
      rule({ next: 3, reset: 'yearly', period: '2026' }),
      '2026-06-01',
      (n) => taken.has(n),
    );
    expect(result.number).toBe('INV-2026-0005');
    expect(result.rule).toMatchObject({ next: 6, period: '2026' });
  });

  it('previews without mutating', () => {
    const r = rule({ next: 12 });
    expect(previewNumber(r, '2026-02-01')).toBe('INV-2026-0012');
    expect(r.next).toBe(12);
  });

  it('knows the numbers a rule writes', () => {
    const sku = { pattern: 'SKU-{counter}', padding: 5 };
    expect(writtenBy(sku, 'SKU-00004')).toBe(true);
    expect(writtenBy(sku, ' sku-123456 ')).toBe(true);
    expect(writtenBy(sku, 'SKU-04')).toBe(false);
    expect(writtenBy(sku, 'GL-01')).toBe(false);
    expect(writtenBy(sku, 'SKU-00004-B')).toBe(false);
    const dated = { pattern: 'P.{yy}{month}-{counter}', padding: 3 };
    expect(writtenBy(dated, 'P.2610-007')).toBe(true);
    expect(writtenBy(dated, 'PX2610-007')).toBe(false);
  });
});
