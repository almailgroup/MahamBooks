import { describe, expect, it } from 'vitest';
import { calculateEosi, eosiShare, eosWage, EOSI_RULES, serviceYears } from './eosi';

const monthly = (
  years: number,
  reason: 'termination' | 'resignation' | 'dismissal' = 'termination',
) => calculateEosi({ payBasis: 'monthly', monthlyWage: 600, years, reason, dailyDivisor: 26 });

describe('end-of-service indemnity (Labour Law 6/2010 art. 51)', () => {
  it('matches the golden figure: KD 600, 7 years, ended by the employer', () => {
    const result = monthly(7);
    // 5 × 15 days × 600 / 26 = 1,730.769 (the daily wage is not rounded first).
    expect(result.dailyWage).toBe(23.077);
    expect(result.first).toEqual({
      years: 5,
      daysPerYear: 15,
      monthsPerYear: null,
      amount: 1730.769,
    });
    // 2 × one month's wage.
    expect(result.later).toEqual({ years: 2, daysPerYear: null, monthsPerYear: 1, amount: 1200 });
    expect(result.gross).toBe(2930.769);
    expect(result.capApplied).toBe(false);
    expect(result.payable).toBe(2930.769);
    expect(result.rulesVersion).toBe(EOSI_RULES.version);
  });

  it('counts part years pro rata', () => {
    // 2.5 × 15 × 600 / 26 = 865.3846…
    expect(monthly(2.5).payable).toBe(865.385);
    // 1,730.769 + 1.25 × 600
    expect(monthly(6.25).payable).toBe(2480.769);
    // Fils precision on an odd wage: 3.4 × 15 × 437.250 / 26 = 857.6827…
    expect(
      calculateEosi({ payBasis: 'monthly', monthlyWage: 437.25, years: 3.4, reason: 'termination' })
        .payable,
    ).toBe(857.683);
  });

  it('caps monthly-paid staff at 18 months’ wage', () => {
    const result = monthly(25);
    // 1,730.769 + 20 × 600 = 13,730.769 > 18 × 600
    expect(result.gross).toBe(13730.769);
    expect(result.cap).toBe(10800);
    expect(result.capApplied).toBe(true);
    expect(result.payable).toBe(10800);
  });

  it('uses 10 then 15 days a year for daily, hourly and piece-rate staff', () => {
    const result = calculateEosi({
      payBasis: 'daily',
      monthlyWage: 260,
      years: 7,
      reason: 'termination',
    });
    // 5 × 10 × 260 / 26 = 500; 2 × 15 × 260 / 26 = 300.
    expect(result.first.amount).toBe(500);
    expect(result.later).toEqual({ years: 2, daysPerYear: 15, monthsPerYear: null, amount: 300 });
    expect(result.payable).toBe(800);
    expect(
      calculateEosi({ payBasis: 'piece', monthlyWage: 260, years: 7, reason: 'termination' })
        .payable,
    ).toBe(800);
  });

  it('caps daily-paid staff at 12 months’ wage', () => {
    const result = calculateEosi({
      payBasis: 'hourly',
      monthlyWage: 260,
      years: 30,
      reason: 'termination',
    });
    // 500 + 25 × 15 × 10 = 4,250 > 12 × 260
    expect(result.gross).toBe(4250);
    expect(result.capApplied).toBe(true);
    expect(result.payable).toBe(3120);
  });

  it('pays a share on resignation (art. 53)', () => {
    expect(monthly(2.99, 'resignation').payable).toBe(0);
    // 3 years: 3 × 15 × 600 / 26 = 1,038.462 → half
    expect(monthly(3, 'resignation').payable).toBe(519.231);
    expect(monthly(4.5, 'resignation').share).toEqual({ numerator: 1, denominator: 2 });
    // 5 years: 1,730.769 × 2/3
    expect(monthly(5, 'resignation').payable).toBe(1153.846);
    // 7 years: 2,930.769 × 2/3
    expect(monthly(7, 'resignation').payable).toBe(1953.846);
    expect(monthly(9.99, 'resignation').share).toEqual({ numerator: 2, denominator: 3 });
    // 10 years: 1,730.769 + 5 × 600, in full
    expect(monthly(10, 'resignation').payable).toBe(4730.769);
    // The share applies after the cap.
    expect(monthly(25, 'resignation').payable).toBe(10800);
  });

  it('pays nothing on dismissal for a serious fault', () => {
    expect(monthly(12, 'dismissal').payable).toBe(0);
    expect(eosiShare('dismissal', 12)).toEqual({ numerator: 0, denominator: 1 });
  });

  it('deducts what PIFSS contributions already cover, never below zero', () => {
    const result = calculateEosi({
      payBasis: 'monthly',
      monthlyWage: 600,
      years: 7,
      reason: 'termination',
      pifssOffset: 1000,
    });
    expect(result.pifssOffset).toBe(1000);
    expect(result.payable).toBe(1930.769);
    expect(
      calculateEosi({
        payBasis: 'monthly',
        monthlyWage: 600,
        years: 7,
        reason: 'termination',
        pifssOffset: 5000,
      }).payable,
    ).toBe(0);
  });

  it('uses the daily divisor setting', () => {
    const result = calculateEosi({
      payBasis: 'monthly',
      monthlyWage: 600,
      years: 1,
      reason: 'termination',
      dailyDivisor: 30,
    });
    expect(result.dailyWage).toBe(20);
    expect(result.payable).toBe(300);
    // An invalid divisor falls back to 26.
    expect(
      calculateEosi({
        payBasis: 'monthly',
        monthlyWage: 600,
        years: 1,
        reason: 'termination',
        dailyDivisor: 0,
      }).dailyDivisor,
    ).toBe(26);
  });
});

describe('service and wage', () => {
  it('counts years of service with part years', () => {
    expect(serviceYears('2019-10-03', '2026-10-03')).toBe(7);
    expect(serviceYears('2024-01-01', '2024-07-01')).toBe(0.4973); // 182 / 366 days
    // A 29 February start has its anniversary on 28 February in other years.
    expect(serviceYears('2020-02-29', '2021-02-28')).toBe(1);
    expect(serviceYears('2026-10-03', '2026-01-01')).toBe(0);
  });

  it('adds only the allowances that count toward end of service', () => {
    expect(
      eosWage(500, [
        { amount: 100, countsForEos: true },
        { amount: 25.5, countsForEos: false },
        { amount: 0.125, countsForEos: true },
      ]),
    ).toBe(600.125);
  });
});
