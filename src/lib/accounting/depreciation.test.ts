import { describe, expect, it } from 'vitest';
import {
  accumulatedAt,
  defaultDecliningRate,
  depreciationSchedule,
  elapsedMonths,
  fullyDepreciated,
  monthEnd,
  periodEnd,
  shiftPeriod,
  type DepreciationTerms,
} from './depreciation';

const KWD = 3;

const terms = (overrides: Partial<DepreciationTerms> = {}): DepreciationTerms => ({
  cost: 1200,
  salvageValue: 0,
  usefulLifeMonths: 12,
  method: 'straight_line',
  decliningRate: null,
  depreciationStart: '2026-01-01',
  openingDepreciation: 0,
  openingDepreciationDate: null,
  ...overrides,
});

describe('months', () => {
  it('finds month ends and moves between months', () => {
    expect(periodEnd('2026-02')).toBe('2026-02-28');
    expect(periodEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-04-10')).toBe('2026-04-30');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
  });

  it('counts part months by days', () => {
    expect(elapsedMonths('2026-01-01', '2026-01-31').toNumber()).toBe(1);
    expect(elapsedMonths('2026-01-15', '2026-01-31').toFixed(6)).toBe((17 / 31).toFixed(6));
    expect(elapsedMonths('2026-01-15', '2026-03-31').toFixed(6)).toBe((2 + 17 / 31).toFixed(6));
    expect(elapsedMonths('2026-02-01', '2026-02-14').toNumber()).toBe(0.5);
    expect(elapsedMonths('2026-03-01', '2026-02-28').toNumber()).toBe(0);
  });
});

describe('straight line', () => {
  it('charges the same every full month', () => {
    const asset = terms();
    expect(accumulatedAt(asset, '2026-01-31', KWD)).toBe(100_000);
    expect(accumulatedAt(asset, '2026-06-30', KWD)).toBe(600_000);
    expect(accumulatedAt(asset, '2026-12-31', KWD)).toBe(1_200_000);
    expect(accumulatedAt(asset, '2027-06-30', KWD)).toBe(1_200_000);
    expect(accumulatedAt(asset, '2025-12-31', KWD)).toBe(0);
    const schedule = depreciationSchedule(asset, KWD);
    expect(schedule).toHaveLength(12);
    expect(schedule.every((r) => r.charge === 100_000)).toBe(true);
    expect(schedule.at(-1)).toMatchObject({ date: '2026-12-31', bookValue: 0 });
  });

  it('charges part months by days and finishes in the month the life ends', () => {
    // KD 1,000.000 less KD 100.000 salvage over 3 years, in use from 15 January.
    const asset = terms({
      cost: 1000,
      salvageValue: 100,
      usefulLifeMonths: 36,
      depreciationStart: '2026-01-15',
    });
    // 900 × (17/31) / 36 = 13.7097 → KD 13.710
    expect(accumulatedAt(asset, '2026-01-31', KWD)).toBe(13_710);
    // A full month is KD 25.000.
    expect(accumulatedAt(asset, '2026-02-28', KWD)).toBe(38_710);
    const schedule = depreciationSchedule(asset, KWD);
    expect(schedule).toHaveLength(37);
    expect(schedule[0]).toMatchObject({ period: '2026-01', charge: 13_710 });
    expect(schedule[1].charge).toBe(25_000);
    // The last 14 days of the life fall in January 2029: 25 × 14/31 = KD 11.290.
    expect(schedule.at(-1)).toMatchObject({ period: '2029-01', charge: 11_290 });
    expect(schedule.reduce((s, r) => s + r.charge, 0)).toBe(900_000);
    expect(schedule.at(-1)!.bookValue).toBe(100_000);
    expect(fullyDepreciated(asset, '2029-01-31', KWD)).toBe(true);
    expect(fullyDepreciated(asset, '2028-12-31', KWD)).toBe(false);
  });

  it('works out depreciation to the day for a disposal in the middle of a month', () => {
    expect(accumulatedAt(terms(), '2026-02-14', KWD)).toBe(150_000);
  });

  it('spreads what is left over the remaining life after opening depreciation', () => {
    // Bought 1 Jan 2024 for KD 6,000 over 5 years; KD 2,400 charged by the end of 2025.
    const asset = terms({
      cost: 6000,
      usefulLifeMonths: 60,
      depreciationStart: '2024-01-01',
      openingDepreciation: 2400,
      openingDepreciationDate: '2025-12-31',
    });
    expect(accumulatedAt(asset, '2025-06-30', KWD)).toBe(2_400_000);
    expect(accumulatedAt(asset, '2026-01-31', KWD)).toBe(2_500_000);
    const schedule = depreciationSchedule(asset, KWD);
    expect(schedule).toHaveLength(36);
    expect(schedule[0]).toMatchObject({ period: '2026-01', charge: 100_000 });
    expect(schedule.at(-1)).toMatchObject({ period: '2028-12', accumulated: 6_000_000 });

    // More was charged before: the remaining KD 3,000 is spread over 36 months.
    const faster = { ...asset, openingDepreciation: 3000 };
    expect(accumulatedAt(faster, '2026-01-31', KWD)).toBe(3_083_333);
    expect(depreciationSchedule(faster, KWD).reduce((s, r) => s + r.charge, 0)).toBe(3_000_000);
  });

  it('charges nothing when the opening depreciation already covers the cost', () => {
    const asset = terms({ openingDepreciation: 1200, openingDepreciationDate: '2026-03-31' });
    expect(depreciationSchedule(asset, KWD)).toEqual([]);
    expect(accumulatedAt(asset, '2026-12-31', KWD)).toBe(1_200_000);
  });
});

describe('declining balance', () => {
  // KD 10,000 with KD 1,000 salvage over 5 years at 40% a year (twice straight line).
  const asset = terms({
    cost: 10000,
    salvageValue: 1000,
    usefulLifeMonths: 60,
    method: 'declining_balance',
  });

  it('defaults to twice the straight-line rate', () => {
    expect(defaultDecliningRate(60)).toBe(40);
    expect(defaultDecliningRate(36)).toBe(66.67);
  });

  it('charges a share of the book value each month', () => {
    const schedule = depreciationSchedule(asset, KWD);
    // 10,000 × 40% / 12 = 333.333; then 9,666.667 × 40% / 12 = 322.222 …
    expect(schedule.slice(0, 4).map((r) => r.charge)).toEqual([333_333, 322_222, 311_482, 301_099]);
    expect(accumulatedAt(asset, '2026-12-31', KWD)).toBe(3_342_350);
  });

  it('switches to straight line and stops at the salvage value when the life ends', () => {
    const schedule = depreciationSchedule(asset, KWD);
    expect(schedule).toHaveLength(60);
    expect(schedule.at(-1)).toMatchObject({ period: '2030-12', bookValue: 1_000_000 });
    expect(schedule.slice(-3).map((r) => r.charge)).toEqual([78_091, 78_092, 78_091]);
    expect(schedule.every((r) => r.bookValue >= 1_000_000)).toBe(true);
    // Charges never go up.
    expect(schedule.every((r, i) => i === 0 || r.charge <= schedule[i - 1].charge + 1)).toBe(true);
  });

  it('uses a chosen rate and part months', () => {
    const custom = { ...asset, decliningRate: 30, depreciationStart: '2026-01-15' };
    // 10,000 × 30% / 12 × 17/31 = 137.097
    expect(accumulatedAt(custom, '2026-01-31', KWD)).toBe(137_097);
  });
});
