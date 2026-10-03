import { describe, expect, it } from 'vitest';
import type { ChequeStatus } from '@/db/types';
import {
  bankName,
  daysToMaturity,
  matchesChequeFilter,
  maturity,
  paymentMinor,
  sortCheques,
} from './cheques';

const TODAY = '2026-10-03';
const cheque = (date: string, status: ChequeStatus, amount = 1_000) => ({ date, status, amount });

describe('cheque register', () => {
  it('counts days to the cheque date', () => {
    expect(daysToMaturity('2026-10-10', TODAY)).toBe(7);
    expect(daysToMaturity('2026-10-03', TODAY)).toBe(0);
    expect(daysToMaturity('2026-09-30', TODAY)).toBe(-3);
  });

  it('totals the open cheques due today, this week and this month', () => {
    const result = maturity(
      [
        cheque('2026-09-28', 'held', 100_000),
        cheque('2026-09-29', 'deposited', 200_000),
        cheque('2026-10-03', 'held', 1_250_750),
        cheque('2026-10-09', 'deposited', 300_000),
        cheque('2026-10-10', 'held', 400_000),
        cheque('2026-11-01', 'held', 500_000),
        cheque('2026-11-02', 'held', 600_000),
        cheque('2026-10-04', 'cleared', 9_999_000),
        cheque('2026-10-04', 'returned', 9_999_000),
      ],
      TODAY,
    );
    expect(result.overdue).toEqual({ count: 1, amount: 100_000 });
    expect(result.today).toEqual({ count: 1, amount: 1_250_750 });
    expect(result.week).toEqual({ count: 2, amount: 1_550_750 });
    expect(result.month).toEqual({ count: 4, amount: 2_450_750 });
  });

  it('filters by what needs doing', () => {
    expect(matchesChequeFilter(cheque('2026-10-01', 'held'), 'overdue', TODAY)).toBe(true);
    expect(matchesChequeFilter(cheque('2026-10-01', 'deposited'), 'overdue', TODAY)).toBe(false);
    expect(matchesChequeFilter(cheque('2026-10-09', 'held'), 'week', TODAY)).toBe(true);
    expect(matchesChequeFilter(cheque('2026-10-10', 'held'), 'week', TODAY)).toBe(false);
    expect(matchesChequeFilter(cheque('2026-10-09', 'cleared'), 'open', TODAY)).toBe(false);
    expect(matchesChequeFilter(cheque('2026-10-09', 'returned'), 'returned', TODAY)).toBe(true);
    expect(matchesChequeFilter(cheque('2026-10-09', 'cancelled'), 'all', TODAY)).toBe(true);
  });

  it('lists open cheques soonest first and the rest newest first', () => {
    const rows = [{ cheque: { date: '2026-11-01' } }, { cheque: { date: '2026-10-05' } }];
    expect(sortCheques(rows, 'open').map((r) => r.cheque.date)).toEqual([
      '2026-10-05',
      '2026-11-01',
    ]);
    expect(sortCheques(rows, 'all').map((r) => r.cheque.date)).toEqual([
      '2026-11-01',
      '2026-10-05',
    ]);
  });

  it('values cheques in the company currency', () => {
    expect(paymentMinor({ amount: 1250.75, currency: 'KWD' }, 'KWD', 3)).toBe(1_250_750);
    expect(paymentMinor({ amount: 100, currency: 'USD', exchangeRate: 0.3075 }, 'KWD', 3)).toBe(
      30_750,
    );
  });

  it('names Kuwaiti banks from their code', () => {
    expect(bankName('NBOK', 'en')).toBe('National Bank of Kuwait');
    expect(bankName('kfho', 'ar')).toBe('بيت التمويل الكويتي');
    expect(bankName(' Barclays ', 'en')).toBe('Barclays');
  });
});
