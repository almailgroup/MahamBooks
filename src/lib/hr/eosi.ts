import { addDays, addYears, differenceInCalendarDays, differenceInCalendarYears } from 'date-fns';
import type { EmployeeAllowance, ISODate, PayBasis } from '@/db/types';
import { parseISODate } from '@/lib/dates';
import { dec, round, type Numeric } from '@/lib/money';

/**
 * End-of-service indemnity under Kuwait's private sector Labour Law 6/2010.
 *
 * Article 51: monthly-paid workers get 15 days' wage for each of the first
 * five years and one month's wage for each later year, at most 18 months'
 * wage; workers paid by the day, hour or piece get 10 days' wage for each of
 * the first five years and 15 days for each later year, at most 12 months'
 * wage. Part years count pro rata.
 *
 * Article 53: a worker who resigns gets nothing with less than 3 years of
 * service, half with 3 to 5 years, two thirds with 5 to 10 years and the full
 * amount after 10 years.
 *
 * Kuwaiti staff insured with PIFSS: the employer pays only the difference
 * between the indemnity and what its PIFSS contributions already cover.
 *
 * The rules are kept in one versioned object so a change in the law is a
 * change in one place. This is an estimate, not legal advice.
 */
export const EOSI_RULES = {
  version: 'KW-LL-6-2010',
  law: 'Labour Law 6/2010, articles 51 and 53',
  /** Working days in a month used to turn the monthly wage into a daily wage. */
  defaultDailyDivisor: 26,
  monthly: {
    firstYears: 5,
    /** Days' wage per year for the first years. */
    firstDays: 15,
    /** Months' wage per year after the first years. */
    laterMonths: 1,
    capMonths: 18,
  },
  /** Daily, hourly and piece-rate workers. */
  other: {
    firstYears: 5,
    firstDays: 10,
    laterDays: 15,
    capMonths: 12,
  },
  /** Share of the indemnity paid on resignation, by completed years of service. */
  resignation: [
    { fromYears: 10, numerator: 1, denominator: 1 },
    { fromYears: 5, numerator: 2, denominator: 3 },
    { fromYears: 3, numerator: 1, denominator: 2 },
    { fromYears: 0, numerator: 0, denominator: 1 },
  ],
} as const;

/**
 * Why the employment ends. "termination" covers every case paid in full
 * (the employer ends the contract, the contract expires, retirement, death);
 * "dismissal" is a dismissal for a serious fault under article 41, which
 * carries no indemnity.
 */
export type EosiReason = 'termination' | 'resignation' | 'dismissal';

export interface EosiInput {
  payBasis: PayBasis;
  /** Monthly wage the indemnity is based on (basic salary + qualifying allowances). */
  monthlyWage: number;
  /** Years of service, fractions allowed (see serviceYears). */
  years: number;
  reason: EosiReason;
  /** Working days in a month; defaults to EOSI_RULES.defaultDailyDivisor. */
  dailyDivisor?: number;
  /** Employer PIFSS contributions that already cover part of the indemnity (Kuwaiti staff). */
  pifssOffset?: number;
  /** Decimal places of the currency (3 for KWD). */
  precision?: number;
}

export interface EosiPortion {
  /** Years of service in this band. */
  years: number;
  /** Days' wage per year, or null when the band is paid in months. */
  daysPerYear: number | null;
  /** Months' wage per year, or null when the band is paid in days. */
  monthsPerYear: number | null;
  amount: number;
}

export interface EosiResult {
  rulesVersion: string;
  years: number;
  monthlyWage: number;
  dailyDivisor: number;
  /** Daily wage rounded to the currency's decimals, for display only. */
  dailyWage: number;
  first: EosiPortion;
  later: EosiPortion;
  /** Indemnity before the cap. */
  gross: number;
  cap: number;
  capApplied: boolean;
  /** After the cap. */
  capped: number;
  /** Share paid for the reason, e.g. 2/3 on resignation after 6 years. */
  share: { numerator: number; denominator: number };
  afterShare: number;
  pifssOffset: number;
  /** What the employer owes. */
  payable: number;
}

/** Share of the indemnity paid for the reason and completed years of service. */
export function eosiShare(
  reason: EosiReason,
  years: number,
): { numerator: number; denominator: number } {
  if (reason === 'termination') return { numerator: 1, denominator: 1 };
  if (reason === 'dismissal') return { numerator: 0, denominator: 1 };
  const tier = EOSI_RULES.resignation.find((t) => years >= t.fromYears);
  return tier
    ? { numerator: tier.numerator, denominator: tier.denominator }
    : { numerator: 0, denominator: 1 };
}

/**
 * Calculates the indemnity. Amounts are worked out exactly from the monthly
 * wage (days × wage ÷ divisor) and rounded to the currency's decimals once
 * per band, so the daily wage is never rounded before it is multiplied: with
 * a KD 600 wage and a 26-day divisor the daily wage shows as KD 23.077, and
 * 75 days come to KD 1,730.769 (not 75 × 23.077 = 1,730.775).
 */
export function calculateEosi(input: EosiInput): EosiResult {
  const precision = input.precision ?? 3;
  const divisor =
    input.dailyDivisor && input.dailyDivisor > 0
      ? input.dailyDivisor
      : EOSI_RULES.defaultDailyDivisor;
  const wage = dec(Math.max(0, input.monthlyWage));
  const years = Math.max(0, input.years);
  const monthly = input.payBasis === 'monthly';
  const rules = monthly ? EOSI_RULES.monthly : EOSI_RULES.other;

  const firstYears = Math.min(years, rules.firstYears);
  const laterYears = Math.max(0, years - rules.firstYears);
  const days = (n: Numeric) => wage.times(n).dividedBy(divisor);

  const firstAmount = round(days(dec(firstYears).times(rules.firstDays)), precision);
  const laterAmount = monthly
    ? round(wage.times(laterYears).times(EOSI_RULES.monthly.laterMonths), precision)
    : round(days(dec(laterYears).times(EOSI_RULES.other.laterDays)), precision);

  const gross = round(dec(firstAmount).plus(laterAmount), precision);
  const cap = round(wage.times(rules.capMonths), precision);
  const capApplied = gross > cap;
  const capped = capApplied ? cap : gross;
  const share = eosiShare(input.reason, Math.floor(years + 1e-9));
  const afterShare = round(
    dec(capped).times(share.numerator).dividedBy(share.denominator),
    precision,
  );
  const offset = round(Math.max(0, input.pifssOffset ?? 0), precision);
  const payable = Math.max(0, round(dec(afterShare).minus(offset), precision));

  return {
    rulesVersion: EOSI_RULES.version,
    years,
    monthlyWage: wage.toNumber(),
    dailyDivisor: divisor,
    dailyWage: round(wage.dividedBy(divisor), precision),
    first: {
      years: firstYears,
      daysPerYear: rules.firstDays,
      monthsPerYear: null,
      amount: firstAmount,
    },
    later: monthly
      ? {
          years: laterYears,
          daysPerYear: null,
          monthsPerYear: EOSI_RULES.monthly.laterMonths,
          amount: laterAmount,
        }
      : {
          years: laterYears,
          daysPerYear: EOSI_RULES.other.laterDays,
          monthsPerYear: null,
          amount: laterAmount,
        },
    gross,
    cap,
    capApplied,
    capped,
    share,
    afterShare,
    pifssOffset: offset,
    payable,
  };
}

/**
 * Years of service from the hire date through `until`, both days counted
 * (the leaving date is a day worked and paid): completed years plus the days
 * since the last anniversary over the days in that service year, so part
 * years count pro rata. Hired 1 October 2023 with a last day of 30 September
 * 2026 is three years. Rounded to 4 decimals (about an hour).
 */
export function serviceYears(hireDate: ISODate, until: ISODate): number {
  const start = parseISODate(hireDate);
  const end = addDays(parseISODate(until), 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  let whole = differenceInCalendarYears(end, start);
  if (addYears(start, whole) > end) whole -= 1;
  const anniversary = addYears(start, whole);
  const next = addYears(start, whole + 1);
  const part =
    differenceInCalendarDays(end, anniversary) / differenceInCalendarDays(next, anniversary);
  return Math.round((whole + part) * 10_000) / 10_000;
}

/** Monthly wage for the indemnity: basic salary plus the allowances that count. */
export function eosWage(
  basicSalary: number,
  allowances: Pick<EmployeeAllowance, 'amount' | 'countsForEos'>[],
  precision = 3,
): number {
  return round(
    allowances
      .filter((a) => a.countsForEos)
      .reduce((sum, a) => sum.plus(dec(a.amount)), dec(basicSalary)),
    precision,
  );
}
