import { describe, expect, it } from 'vitest';
import type { LegalForm } from '@/db/types';
import {
  DEFAULT_LEVY_RATES,
  financialYearLabel,
  foreignShare,
  keepsStatutoryReserve,
  levyRates,
  yearEndProposals,
  type YearEndInput,
} from './year-end';

const KD = (n: number) => Math.round(n * 1000);

const input = (overrides: Partial<YearEndInput> = {}): YearEndInput => ({
  profitBeforeLevies: KD(3000),
  legalForm: 'wll',
  foreignOwnershipPercent: 0,
  capital: KD(10000),
  statutoryReserve: 0,
  lossesBroughtForward: 0,
  rates: DEFAULT_LEVY_RATES,
  ...overrides,
});

const amounts = (i: YearEndInput) =>
  Object.fromEntries(
    yearEndProposals(i)
      .filter((p) => p.applies)
      .map((p) => [p.kind, p.amount]),
  );

describe('statutory reserve', () => {
  it('takes 10% of the profit', () => {
    expect(amounts(input()).statutory_reserve).toBe(KD(300));
  });

  it('stops when the reserve reaches half of the capital', () => {
    // Capital 10,000, reserve 4,800, profit 3,000: 10% is 300 but only 200 fits under 5,000.
    const [reserve] = yearEndProposals(input({ statutoryReserve: KD(4800) }));
    expect(reserve).toMatchObject({ amount: KD(200), uncapped: KD(300), room: KD(200) });
    expect(amounts(input({ statutoryReserve: KD(5000) })).statutory_reserve).toBe(0);
  });

  it('is not limited when the capital is unknown, and not kept by sole traders', () => {
    const [reserve] = yearEndProposals(input({ capital: 0 }));
    expect(reserve).toMatchObject({ amount: KD(300), room: null });
    expect(keepsStatutoryReserve('sole_proprietorship')).toBe(false);
    expect(keepsStatutoryReserve('freelance')).toBe(false);
    expect(amounts(input({ legalForm: 'sole_proprietorship' }))).toEqual({});
  });

  it('is nothing in a loss year', () => {
    expect(amounts(input({ profitBeforeLevies: KD(-500) })).statutory_reserve).toBe(0);
  });
});

describe('levies by legal form', () => {
  const forForm = (legalForm: LegalForm, extra: Partial<YearEndInput> = {}) =>
    amounts(input({ legalForm, profitBeforeLevies: KD(100000), capital: KD(1000000), ...extra }));

  it('charges nothing more to a Kuwaiti-owned W.L.L.', () => {
    expect(forForm('wll')).toEqual({ statutory_reserve: KD(10000), voluntary_reserve: 0 });
  });

  it('charges KFAS and Zakat to closed shareholding companies', () => {
    // KFAS: 1% of (100,000 − 10,000 reserve − 5,000 losses brought forward).
    expect(forForm('kscc', { lossesBroughtForward: KD(5000) })).toEqual({
      statutory_reserve: KD(10000),
      voluntary_reserve: 0,
      kfas: KD(850),
      zakat: KD(1000),
    });
  });

  it('adds NLST for listed companies', () => {
    expect(forForm('ksc_listed')).toMatchObject({ kfas: KD(900), zakat: KD(1000), nlst: KD(2500) });
  });

  it('taxes the foreign-owned share of the profit', () => {
    // 40% foreign: 15% of 40,000.
    expect(forForm('wll', { foreignOwnershipPercent: 40 }).income_tax).toBe(KD(6000));
    expect(foreignShare('foreign_branch', 0)).toBe(100);
    expect(forForm('foreign_branch').income_tax).toBe(KD(15000));
  });

  it('uses the rates set for the company', () => {
    const rates = levyRates({ levies: { ...DEFAULT_LEVY_RATES, zakat: 2 } });
    expect(forForm('kscc', { rates }).zakat).toBe(KD(2000));
    expect(levyRates(undefined)).toEqual(DEFAULT_LEVY_RATES);
  });

  it('rounds to the fils', () => {
    expect(
      amounts(input({ legalForm: 'kscc', profitBeforeLevies: 1_234_567, capital: 0 })).zakat,
    ).toBe(12_346);
  });
});

describe('labels', () => {
  it('names calendar and other financial years', () => {
    expect(financialYearLabel('2026-01-01', '2026-12-31')).toBe('2026');
    expect(financialYearLabel('2025-04-01', '2026-03-31')).toBe('2025–2026');
  });
});
