import type {
  ContributionRates,
  Employee,
  EmployeeCategory,
  ISODate,
  LeavingReason,
  LoanRecovery,
  PayBasis,
  PayLine,
  PayRules,
  PayrollAccountKey,
  SettlementSalary,
} from '@/db/types';
import { daysBetween } from '@/lib/dates';
import { dec, fromMinor, round, toMinor, type Decimal, type Numeric } from '@/lib/money';
import { isValidIban } from '@/lib/kuwait';
import { msg } from '@/i18n';
import { calculateEosi, eosWage, serviceYears, type EosiResult } from './eosi';
import { eosiReasonFor } from './employees';

/**
 * Kuwait private sector payroll (Labour Law 6/2010). There is no income tax;
 * Kuwaiti staff pay PIFSS social security, GCC nationals their home scheme
 * through PIFSS. The figures that change (contribution rates and their cap,
 * the minimum wage) are settings with dates; these are the defaults.
 */
export const PAYROLL_RULES = {
  law: 'Labour Law 6/2010',
  /** Working days in a month for the daily rate: 26 for a six-day week (art. 67). */
  dailyDivisor: 26,
  hoursPerDay: 8,
  /** Overtime pay as a multiple of the hourly rate (art. 66, 67 and 68). */
  overtime: { normal: 1.25, restDay: 1.5, holiday: 2 },
  /** Loan recoveries may take at most 10% of the wage, all deductions 25% (art. 59). */
  loanCapPercent: 10,
  deductionCapPercent: 25,
  /** Commonly cited private sector minimum wage; check before relying on it. */
  minimumWage: 75,
  /** PIFSS rates for Kuwaiti staff and the insured salary cap; check before relying on them. */
  pifss: { from: '2026-01-01', employer: 11.5, employee: 10.5, cap: 2750 },
  /** Notice the employer gives on an unlimited contract (art. 44), in months. */
  noticeMonths: { monthly: 3, other: 1 },
} as const;

/* -------------------------------------------------------------------------- */
/* Months                                                                     */
/* -------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** A pay period is a month written yyyy-MM. */
export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function periodOf(date: ISODate): string {
  return date.slice(0, 7);
}

export function periodStart(period: string): ISODate {
  return `${period}-01`;
}

export function daysInPeriod(period: string): number {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function periodEnd(period: string): ISODate {
  return `${period}-${pad(daysInPeriod(period))}`;
}

export function addPeriods(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** The pay day in a month; a day past the month's end is its last day. */
export function payDateFor(period: string, payDay: number): ISODate {
  const day = Math.min(Math.max(1, Math.round(payDay) || 1), daysInPeriod(period));
  return `${period}-${pad(day)}`;
}

/** "September 2026", "سبتمبر 2026". */
export function formatPeriod(period: string, locale: string): string {
  if (!isPeriod(period)) return period;
  const [year, month] = period.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
      new Date(year, month - 1, 1),
    );
  } catch {
    return period;
  }
}

/** Calendar days of the month the employee was employed (hire and leaving dates included). */
export function employedDays(
  period: string,
  hireDate: ISODate | null,
  leavingDate: ISODate | null,
): number {
  const start = periodStart(period);
  const end = periodEnd(period);
  const from = hireDate && hireDate > start ? hireDate : start;
  const to = leavingDate && leavingDate < end ? leavingDate : end;
  return to < from ? 0 : daysBetween(from, to) + 1;
}

/* -------------------------------------------------------------------------- */
/* Rates                                                                      */
/* -------------------------------------------------------------------------- */

/** The rates in force on a date: the latest that started by then, else the earliest set. */
export function ratesOn(list: ContributionRates[], date: ISODate): ContributionRates | null {
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
  return [...sorted].reverse().find((r) => r.from <= date) ?? sorted[0];
}

export type Rates = Pick<ContributionRates, 'employer' | 'employee' | 'cap'>;

/**
 * Contribution rates for an employee: PIFSS for Kuwaitis, the home scheme for
 * GCC nationals (missing until entered), none for expatriates and domestic
 * workers.
 */
export function contributionRates(
  who: { category: EmployeeCategory; nationality: string },
  rules: Pick<PayRules, 'pifss' | 'gcc'>,
): { rates: Rates | null; missing: boolean } {
  if (who.category === 'kuwaiti') return { rates: rules.pifss, missing: !rules.pifss };
  if (who.category === 'gcc') {
    const scheme = rules.gcc.find((s) => s.country === who.nationality.toUpperCase());
    return { rates: scheme ?? null, missing: !scheme };
  }
  return { rates: null, missing: false };
}

/**
 * Employee and employer contributions on the insured salary: the monthly
 * wage up to the cap, for the share of the month employed.
 */
export function contributions(
  monthlyWage: Numeric,
  fraction: Numeric,
  rates: Rates,
  precision: number,
): { base: number; employee: number; employer: number } {
  const wage = dec(monthlyWage);
  const insured = rates.cap !== null && rates.cap > 0 && wage.gt(rates.cap) ? dec(rates.cap) : wage;
  const base = round(insured.times(dec(fraction)), precision);
  return {
    base,
    employee: round(dec(base).times(dec(rates.employee)).dividedBy(100), precision),
    employer: round(dec(base).times(dec(rates.employer)).dividedBy(100), precision),
  };
}

/** Daily rate: the monthly amount over the working days in a month (not rounded). */
export function dailyRate(monthly: Numeric, divisor: number): Decimal {
  return dec(monthly).dividedBy(divisor > 0 ? divisor : PAYROLL_RULES.dailyDivisor);
}

/** Hourly rate: the daily rate over an eight-hour day (not rounded). */
export function hourlyRate(monthly: Numeric, divisor: number): Decimal {
  return dailyRate(monthly, divisor).dividedBy(PAYROLL_RULES.hoursPerDay);
}

/** Overtime pay: hours × hourly rate × 1.25 (normal days), 1.5 (rest days) or 2 (holidays). */
export function overtimePay(
  hourly: Decimal,
  hours: PayLine['overtime'],
  precision: number,
): number {
  const { normal, restDay, holiday } = PAYROLL_RULES.overtime;
  const weighted = dec(hours.normal)
    .times(normal)
    .plus(dec(hours.restDay).times(restDay))
    .plus(dec(hours.holiday).times(holiday));
  return round(hourly.times(weighted), precision);
}

/* -------------------------------------------------------------------------- */
/* Pay lines                                                                  */
/* -------------------------------------------------------------------------- */

const total = (values: Numeric[]) => values.reduce<Decimal>((s, v) => s.plus(dec(v)), dec(0));

/** Basic salary plus all allowances, for a full month. */
export function monthlyWage(line: Pick<PayLine, 'monthlyBasic' | 'allowances'>): Decimal {
  return dec(line.monthlyBasic).plus(total(line.allowances.map((a) => a.monthly)));
}

/** The monthly amount the daily and hourly rates are worked out on. */
export function rateWage(
  line: Pick<PayLine, 'monthlyBasic' | 'allowances'>,
  rules: Pick<PayRules, 'rateBase'>,
): Decimal {
  return rules.rateBase === 'basic' ? dec(line.monthlyBasic) : monthlyWage(line);
}

/**
 * Works out a pay line from what was entered: pay for the days employed,
 * overtime, pay lost to unpaid days and reduced-pay sick days, additions,
 * contributions, loan recoveries and other deductions. Each amount is rounded
 * to the currency's decimals once, so the totals add up to the fils.
 */
export function calculatePayLine(line: PayLine, rules: PayRules, precision: number): PayLine {
  const p = precision;
  const daysInMonth = Math.max(1, line.daysInMonth);
  const daysWorked = Math.min(Math.max(0, line.daysWorked), daysInMonth);
  const fraction = dec(daysWorked).dividedBy(daysInMonth);

  const basic = round(dec(line.monthlyBasic).times(fraction), p);
  const allowances = line.allowances.map((a) => ({
    ...a,
    amount: round(dec(a.monthly).times(fraction), p),
  }));
  const allowanceTotal = round(total(allowances.map((a) => a.amount)), p);
  const earned = dec(basic).plus(allowanceTotal);

  const daily = dailyRate(rateWage(line, rules), rules.dailyDivisor);
  const hourly = daily.dividedBy(PAYROLL_RULES.hoursPerDay);
  const overtime = overtimePay(hourly, line.overtime, p);

  const lostDays = dec(Math.max(0, line.absentDays))
    .plus(Math.max(0, line.unpaidLeaveDays))
    .plus(
      total(
        line.reducedPay.map((r) =>
          dec(Math.max(0, r.days))
            .times(100 - Math.min(100, Math.max(0, r.percent)))
            .dividedBy(100),
        ),
      ),
    );
  const lost = daily.times(lostDays);
  const absenceDeduction = round(lost.gt(earned) ? earned : lost, p);

  const additions = round(
    total(line.adjustments.filter((a) => a.type === 'addition').map((a) => Math.max(0, a.amount))),
    p,
  );
  const otherDeductions = round(
    total(line.adjustments.filter((a) => a.type === 'deduction').map((a) => Math.max(0, a.amount))),
    p,
  );
  const gross = round(earned.plus(overtime).plus(additions).minus(absenceDeduction), p);

  const { rates } = contributionRates(line, rules);
  const pifss = rates
    ? contributions(monthlyWage(line), fraction, rates, p)
    : { base: 0, employee: 0, employer: 0 };
  const loanDeduction = round(total(line.loans.map((l) => Math.max(0, l.amount))), p);
  const net = round(
    dec(gross).minus(pifss.employee).minus(loanDeduction).minus(otherDeductions),
    p,
  );

  return {
    ...line,
    daysWorked,
    daysInMonth,
    allowances,
    basic,
    allowanceTotal,
    overtimePay: overtime,
    absenceDeduction,
    additions,
    gross,
    pifssBase: pifss.base,
    pifssEmployee: pifss.employee,
    pifssEmployer: pifss.employer,
    loanDeduction,
    otherDeductions,
    net,
  };
}

/** Something to check on a pay line before approving the run. */
export type PayWarning =
  | { code: 'negative_net' }
  | { code: 'loan_cap'; limit: number }
  | { code: 'deduction_cap'; limit: number }
  | { code: 'minimum_wage'; minimum: number }
  | { code: 'permit_salary'; permit: number }
  | { code: 'iban' }
  | { code: 'gcc_rates'; country: string }
  | { code: 'pifss_rates' }
  | { code: 'no_salary' };

/**
 * Checks a worked-out pay line against the law: loan recoveries over 10%
 * and all deductions (other than social security) over 25% of the wage
 * (art. 59), net pay below the minimum wage, a basic salary below the work
 * permit salary, and a missing or invalid IBAN (salaries are paid into a
 * local bank account, art. 57).
 */
export function payLineWarnings(line: PayLine, rules: PayRules, precision: number): PayWarning[] {
  const p = precision;
  const out: PayWarning[] = [];
  const minor = (n: Numeric) => toMinor(n, p);
  if (minor(line.monthlyBasic) === 0 && line.allowances.every((a) => minor(a.monthly) === 0)) {
    out.push({ code: 'no_salary' });
  }
  if (minor(line.net) < 0) out.push({ code: 'negative_net' });
  const loanLimit = round(dec(line.gross).times(PAYROLL_RULES.loanCapPercent).dividedBy(100), p);
  if (minor(line.loanDeduction) > minor(loanLimit))
    out.push({ code: 'loan_cap', limit: loanLimit });
  const deductionLimit = round(
    dec(line.gross).times(PAYROLL_RULES.deductionCapPercent).dividedBy(100),
    p,
  );
  if (minor(line.loanDeduction) + minor(line.otherDeductions) > minor(deductionLimit)) {
    out.push({ code: 'deduction_cap', limit: deductionLimit });
  }
  if (line.category !== 'domestic' && line.daysWorked > 0 && rules.minimumWage > 0) {
    const minimum = round(
      dec(rules.minimumWage).times(line.daysWorked).dividedBy(Math.max(1, line.daysInMonth)),
      p,
    );
    if (minor(line.net) >= 0 && minor(line.net) < minor(minimum)) {
      out.push({ code: 'minimum_wage', minimum });
    }
  }
  if (line.category === 'expat' && minor(line.permitSalary) > minor(line.monthlyBasic)) {
    out.push({ code: 'permit_salary', permit: line.permitSalary });
  }
  if (minor(line.net) > 0 && !isValidIban(line.iban)) out.push({ code: 'iban' });
  if (contributionRates(line, rules).missing) {
    out.push(
      line.category === 'gcc'
        ? { code: 'gcc_rates', country: line.nationality.toUpperCase() }
        : { code: 'pifss_rates' },
    );
  }
  return out;
}

/** Warnings that stop a run from being approved. */
export function isBlocking(warning: PayWarning): boolean {
  return warning.code === 'negative_net';
}

/* -------------------------------------------------------------------------- */
/* Totals and postings                                                        */
/* -------------------------------------------------------------------------- */

export interface PayRunTotals {
  employees: number;
  /** Basic salaries less pay lost to absence (6010). */
  salaries: number;
  /** Allowances, overtime and additions (6020). */
  allowances: number;
  gross: number;
  overtime: number;
  absence: number;
  pifssEmployee: number;
  pifssEmployer: number;
  loans: number;
  otherDeductions: number;
  /** Employee contributions, loan recoveries and other deductions. */
  deductions: number;
  net: number;
  /** What the month costs the company: gross pay and employer contributions. */
  cost: number;
}

/** Adds up a run's lines in minor units, so the totals match the journal to the fils. */
export function payRunTotals(lines: PayLine[], precision: number): PayRunTotals {
  const m = (n: Numeric) => toMinor(n, precision);
  const sums = {
    salaries: 0,
    allowances: 0,
    gross: 0,
    overtime: 0,
    absence: 0,
    pifssEmployee: 0,
    pifssEmployer: 0,
    loans: 0,
    otherDeductions: 0,
    net: 0,
  };
  for (const line of lines) {
    const basic = m(line.basic);
    const absence = m(line.absenceDeduction);
    const fromBasic = Math.min(absence, basic);
    sums.salaries += basic - fromBasic;
    sums.allowances +=
      m(line.allowanceTotal) - (absence - fromBasic) + m(line.overtimePay) + m(line.additions);
    sums.gross += m(line.gross);
    sums.overtime += m(line.overtimePay);
    sums.absence += absence;
    sums.pifssEmployee += m(line.pifssEmployee);
    sums.pifssEmployer += m(line.pifssEmployer);
    sums.loans += m(line.loanDeduction);
    sums.otherDeductions += m(line.otherDeductions);
    sums.net += m(line.net);
  }
  const f = (n: number) => fromMinor(n, precision);
  return {
    employees: lines.length,
    salaries: f(sums.salaries),
    allowances: f(sums.allowances),
    gross: f(sums.gross),
    overtime: f(sums.overtime),
    absence: f(sums.absence),
    pifssEmployee: f(sums.pifssEmployee),
    pifssEmployer: f(sums.pifssEmployer),
    loans: f(sums.loans),
    otherDeductions: f(sums.otherDeductions),
    deductions: f(sums.pifssEmployee + sums.loans + sums.otherDeductions),
    net: f(sums.net),
    cost: f(sums.gross + sums.pifssEmployer),
  };
}

/** One side of an entry the payroll posts: positive minor units are a debit, negative a credit. */
export interface Posting {
  key: PayrollAccountKey;
  amount: number;
  description: string;
}

/** Descriptions of the payroll's journal lines (translated when posted). */
export const POSTING_LABELS = {
  salaries: msg('Basic salaries'),
  allowances: msg('Allowances and overtime'),
  pifssExpense: msg('PIFSS – employer share'),
  salariesPayable: msg('Net salaries payable'),
  pifssPayable: msg('PIFSS contributions'),
  advances: msg('Loan recoveries'),
  otherDeductions: msg('Other deductions'),
  eosExpense: msg('End-of-service indemnity'),
  eosProvision: msg('End-of-service indemnity provision'),
  leaveExpense: msg('Leave salary'),
  leaveProvision: msg('Leave salary provision'),
  noticePay: msg('Notice pay'),
} as const;

function postings(entries: [PayrollAccountKey, number, string][]): Posting[] {
  const merged = new Map<string, Posting>();
  for (const [key, amount, description] of entries) {
    if (amount === 0) continue;
    const id = `${key}|${amount > 0 ? 'dr' : 'cr'}|${description}`;
    const before = merged.get(id);
    merged.set(id, { key, description, amount: (before?.amount ?? 0) + amount });
  }
  return [...merged.values()];
}

/**
 * The entry that records a pay run: Dr 6010 basic, Dr 6020 allowances and
 * overtime, Dr 6030 employer PIFSS; Cr 2300 net pay, Cr 2310 employee and
 * employer PIFSS, Cr 1320 loan recoveries, Cr other deductions.
 */
export function payRunPostings(totals: PayRunTotals, precision: number): Posting[] {
  const m = (n: number) => toMinor(n, precision);
  const L = POSTING_LABELS;
  return postings([
    ['salaries', m(totals.salaries), L.salaries],
    ['allowances', m(totals.allowances), L.allowances],
    ['pifssExpense', m(totals.pifssEmployer), L.pifssExpense],
    ['salariesPayable', -m(totals.net), L.salariesPayable],
    ['pifssPayable', -(m(totals.pifssEmployee) + m(totals.pifssEmployer)), L.pifssPayable],
    ['advances', -m(totals.loans), L.advances],
    ['otherDeductions', -m(totals.otherDeductions), L.otherDeductions],
  ]);
}

/**
 * Month-end provisions: brings the end-of-service provision (2700) and the
 * leave salary provision (2320) to their targets, expensing the change.
 */
export function provisionPostings(eosChange: number, leaveChange: number): Posting[] {
  const L = POSTING_LABELS;
  return postings([
    ['eosExpense', eosChange, L.eosExpense],
    ['eosProvision', -eosChange, L.eosProvision],
    ['leaveExpense', leaveChange, L.leaveExpense],
    ['leaveProvision', -leaveChange, L.leaveProvision],
  ]);
}

/** True when the postings balance to the fils. */
export function balanced(list: Posting[]): boolean {
  return list.reduce((s, p) => s + p.amount, 0) === 0;
}

/* -------------------------------------------------------------------------- */
/* Provisions                                                                 */
/* -------------------------------------------------------------------------- */

type ProvisionEmployee = Pick<
  Employee,
  'category' | 'hireDate' | 'basicSalary' | 'allowances' | 'payBasis'
>;

/** End-of-service indemnity on a date if the employer ended the contract then (art. 51). */
export function eosProvisionFor(
  employee: ProvisionEmployee,
  on: ISODate,
  divisor: number,
  precision: number,
): number {
  if (employee.category === 'domestic' || !employee.hireDate || employee.hireDate > on) return 0;
  const wage = eosWage(employee.basicSalary, employee.allowances, precision);
  if (wage <= 0) return 0;
  return calculateEosi({
    payBasis: employee.payBasis,
    monthlyWage: wage,
    years: serviceYears(employee.hireDate, on),
    reason: 'termination',
    dailyDivisor: divisor,
    precision,
  }).payable;
}

/** Pay for leave days: the monthly wage over the working days in a month, times the days. */
export function leaveValue(
  days: number,
  monthly: Numeric,
  divisor: number,
  precision: number,
): number {
  if (days <= 0) return 0;
  return round(dailyRate(monthly, divisor).times(dec(days)), precision);
}

/* -------------------------------------------------------------------------- */
/* Final settlement                                                           */
/* -------------------------------------------------------------------------- */

/** Notice the employer owes when it ends an unlimited contract without notice (art. 44). */
export function noticeMonthsFor(reason: LeavingReason, payBasis: PayBasis): number {
  if (reason !== 'termination') return 0;
  return payBasis === 'monthly'
    ? PAYROLL_RULES.noticeMonths.monthly
    : PAYROLL_RULES.noticeMonths.other;
}

export interface SettlementInput {
  employee: Pick<
    Employee,
    'payBasis' | 'basicSalary' | 'allowances' | 'hireDate' | 'category' | 'nationality'
  >;
  leavingDate: ISODate;
  reason: LeavingReason;
  rules: PayRules;
  /** Working days in a month for the indemnity's daily wage (people settings). */
  eosDivisor: number;
  pifssOffset: number;
  /** Replaces the worked-out indemnity, e.g. for domestic workers; null to use it. */
  indemnityOverride: number | null;
  noticeMonths: number;
  leaveDays: number;
  /** Calendar days of the leaving month paid with the settlement (0 when paid in a pay run). */
  lastSalaryDays: number;
  loans: LoanRecovery[];
  otherDeductions: number;
  /** The employee's share of the provisions, released by the settlement. */
  eosProvision: number;
  leaveProvision: number;
  precision: number;
}

export interface SettlementAmounts {
  years: number;
  eosWage: number;
  monthlyWage: number;
  /** Null for domestic workers, who are outside the Labour Law. */
  eosi: EosiResult | null;
  indemnity: number;
  noticePay: number;
  leavePay: number;
  lastSalary: SettlementSalary | null;
  loanRecovery: number;
  otherDeductions: number;
  dues: number;
  deductions: number;
  net: number;
}

/** Days of the leaving month the employee worked (from the 1st or the hire date). */
export function lastMonthDays(hireDate: ISODate | null, leavingDate: ISODate): number {
  return employedDays(periodOf(leavingDate), hireDate, leavingDate);
}

/**
 * Works out a final settlement: the indemnity (art. 51–53, or one month's
 * wage per year for domestic workers under Law 68/2015), notice pay, unused
 * leave, the last salary with its contributions, less loans and other
 * deductions.
 */
export function computeSettlement(input: SettlementInput): SettlementAmounts {
  const p = input.precision;
  const e = input.employee;
  const years = e.hireDate ? serviceYears(e.hireDate, input.leavingDate) : 0;
  const wageForEos = eosWage(e.basicSalary, e.allowances, p);
  const monthly = round(total(e.allowances.map((a) => a.amount)).plus(dec(e.basicSalary)), p);

  const eosi =
    e.category === 'domestic'
      ? null
      : calculateEosi({
          payBasis: e.payBasis,
          monthlyWage: wageForEos,
          years,
          reason: eosiReasonFor(input.reason),
          dailyDivisor: input.eosDivisor,
          pifssOffset: input.pifssOffset,
          precision: p,
        });
  const worked = eosi ? eosi.payable : round(dec(wageForEos).times(dec(years)), p);
  const indemnity =
    input.indemnityOverride !== null ? round(Math.max(0, input.indemnityOverride), p) : worked;

  const noticePay = round(dec(monthly).times(dec(Math.max(0, input.noticeMonths))), p);
  const leavePay = leaveValue(input.leaveDays, monthly, input.rules.dailyDivisor, p);

  let lastSalary: SettlementSalary | null = null;
  const period = periodOf(input.leavingDate);
  const daysInMonth = daysInPeriod(period);
  const days = Math.min(Math.max(0, Math.round(input.lastSalaryDays)), daysInMonth);
  if (days > 0) {
    const fraction = dec(days).dividedBy(daysInMonth);
    const basic = round(dec(e.basicSalary).times(fraction), p);
    const allowances = round(
      total(e.allowances.map((a) => round(dec(a.amount).times(fraction), p))),
      p,
    );
    const { rates } = contributionRates(e, input.rules);
    const pifss = rates
      ? contributions(monthly, fraction, rates, p)
      : { base: 0, employee: 0, employer: 0 };
    lastSalary = {
      period,
      days,
      daysInMonth,
      basic,
      allowances,
      gross: round(dec(basic).plus(allowances), p),
      pifssEmployee: pifss.employee,
      pifssEmployer: pifss.employer,
    };
  }

  const loanRecovery = round(total(input.loans.map((l) => Math.max(0, l.amount))), p);
  const otherDeductions = round(Math.max(0, input.otherDeductions), p);
  const dues = round(
    dec(indemnity)
      .plus(noticePay)
      .plus(leavePay)
      .plus(lastSalary?.gross ?? 0),
    p,
  );
  const deductions = round(
    dec(lastSalary?.pifssEmployee ?? 0)
      .plus(loanRecovery)
      .plus(otherDeductions),
    p,
  );
  return {
    years,
    eosWage: wageForEos,
    monthlyWage: monthly,
    eosi,
    indemnity,
    noticePay,
    leavePay,
    lastSalary,
    loanRecovery,
    otherDeductions,
    dues,
    deductions,
    net: round(dec(dues).minus(deductions), p),
  };
}

/**
 * The entry that records a final settlement: releases the employee's share
 * of the end-of-service (2700) and leave (2320) provisions and expenses the
 * difference (6040, 6050), expenses notice pay and the last salary, credits
 * contributions, loan recoveries and other deductions, and Cr 2300 the net
 * amount due to the employee.
 */
export function settlementPostings(
  amounts: SettlementAmounts,
  provisions: { eos: number; leave: number },
  precision: number,
): Posting[] {
  const m = (n: number) => toMinor(n, precision);
  const L = POSTING_LABELS;
  const last = amounts.lastSalary;
  return postings([
    ['eosProvision', m(provisions.eos), L.eosProvision],
    ['eosExpense', m(amounts.indemnity) - m(provisions.eos), L.eosExpense],
    ['leaveProvision', m(provisions.leave), L.leaveProvision],
    ['leaveExpense', m(amounts.leavePay) - m(provisions.leave), L.leaveExpense],
    ['salaries', m(amounts.noticePay), L.noticePay],
    ['salaries', m(last?.basic ?? 0), L.salaries],
    ['allowances', m(last?.allowances ?? 0), L.allowances],
    ['pifssExpense', m(last?.pifssEmployer ?? 0), L.pifssExpense],
    ['pifssPayable', -(m(last?.pifssEmployee ?? 0) + m(last?.pifssEmployer ?? 0)), L.pifssPayable],
    ['advances', -m(amounts.loanRecovery), L.advances],
    ['otherDeductions', -m(amounts.otherDeductions), L.otherDeductions],
    ['salariesPayable', -m(amounts.net), L.salariesPayable],
  ]);
}
