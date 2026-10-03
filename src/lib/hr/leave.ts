import { addDays, addMonths, differenceInMonths } from 'date-fns';
import type { ISODate, LeaveRecord, LeaveType, ReducedPayDays } from '@/db/types';
import { addDaysISO, parseISODate, toISODate } from '@/lib/dates';
import { KUWAIT_WEEKEND } from '@/lib/kuwait';
import { msg } from '@/i18n';
import { periodEnd, periodStart } from './payroll';

/**
 * Leave under Labour Law 6/2010: 30 days' annual leave (art. 70), usable in
 * the first year after nine months and paid out when unused at the end
 * (art. 73); sick leave in tiers of full, three-quarter, half, quarter and no
 * pay (art. 69); 70 days' maternity leave (art. 24); Hajj once; bereavement;
 * unpaid leave. Leave is counted in working days (not Fridays, Saturdays or
 * public holidays) except maternity and Hajj leave, which run in calendar days.
 */

export interface LeaveTypeInfo {
  label: string;
  /** Days allowed (a year, or once for Hajj); null when there is no limit. */
  days: number | null;
  counting: 'working' | 'calendar';
}

export const LEAVE_TYPES: Record<LeaveType, LeaveTypeInfo> = {
  annual: { label: msg('Annual leave'), days: 30, counting: 'working' },
  sick: { label: msg('Sick leave'), days: 75, counting: 'working' },
  maternity: { label: msg('Maternity leave'), days: 70, counting: 'calendar' },
  hajj: { label: msg('Hajj leave'), days: 21, counting: 'calendar' },
  bereavement: { label: msg('Bereavement leave'), days: 3, counting: 'working' },
  unpaid: { label: msg('Unpaid leave'), days: null, counting: 'working' },
};

export const LEAVE_TYPE_ORDER: LeaveType[] = [
  'annual',
  'sick',
  'maternity',
  'hajj',
  'bereavement',
  'unpaid',
];

export const ANNUAL_LEAVE_DAYS = 30;
/** Months of service before annual leave can be taken in the first year. */
export const FIRST_YEAR_MONTHS = 9;

/** Sick leave in a calendar year: days at each share of pay, in order (art. 69). */
export const SICK_TIERS = [
  { days: 15, percent: 100 },
  { days: 10, percent: 75 },
  { days: 10, percent: 50 },
  { days: 10, percent: 25 },
  { days: 30, percent: 0 },
] as const;

/** Share of pay for a sick day, given the sick days already taken that year. */
export function sickPercent(daysBefore: number): number {
  let limit = 0;
  for (const tier of SICK_TIERS) {
    limit += tier.days;
    if (daysBefore < limit) return tier.percent;
  }
  return 0;
}

export type DayOff = (date: ISODate) => boolean;

/** Fridays, Saturdays and the public holidays `holidaysOf` lists for each year. */
export function dayOffChecker(holidaysOf: (year: number) => ISODate[]): DayOff {
  const cache = new Map<number, Set<ISODate>>();
  return (date) => {
    if (KUWAIT_WEEKEND.includes(parseISODate(date).getDay())) return true;
    const year = Number(date.slice(0, 4));
    let days = cache.get(year);
    if (!days) {
      days = new Set(holidaysOf(year));
      cache.set(year, days);
    }
    return days.has(date);
  };
}

/** Longest leave the app counts, in calendar days. */
export const MAX_LEAVE_SPAN = 366;

/** The days a leave counts: working days, or every day for calendar-day leave. */
export function countedDates(
  type: LeaveType,
  start: ISODate,
  end: ISODate,
  isDayOff: DayOff,
): ISODate[] {
  if (!start || !end || end < start) return [];
  const calendar = LEAVE_TYPES[type].counting === 'calendar';
  const out: ISODate[] = [];
  let date = start;
  for (let i = 0; i < MAX_LEAVE_SPAN && date <= end; i++) {
    if (calendar || !isDayOff(date)) out.push(date);
    date = addDaysISO(date, 1);
  }
  return out;
}

export function countLeaveDays(
  type: LeaveType,
  start: ISODate,
  end: ISODate,
  isDayOff: DayOff,
): number {
  return countedDates(type, start, end, isDayOff).length;
}

const isTaken = (r: LeaveRecord) => r.kind === 'leave' && r.status === 'approved';

/** Each sick day of a calendar year with the share of pay it earns. */
export function sickDayRates(
  records: LeaveRecord[],
  year: number,
  isDayOff: DayOff,
): Map<ISODate, number> {
  const days = new Set<ISODate>();
  for (const r of records) {
    if (r.type !== 'sick' || !isTaken(r)) continue;
    for (const d of countedDates('sick', r.start, r.end, isDayOff)) {
      if (d.startsWith(`${year}-`)) days.add(d);
    }
  }
  const rates = new Map<ISODate, number>();
  [...days].sort().forEach((d, i) => rates.set(d, sickPercent(i)));
  return rates;
}

/** Sick days taken in a year at each share of pay. */
export function sickDaysByTier(
  records: LeaveRecord[],
  year: number,
  isDayOff: DayOff,
): { percent: number; days: number }[] {
  const counts = new Map<number, number>();
  for (const percent of sickDayRates(records, year, isDayOff).values()) {
    counts.set(percent, (counts.get(percent) ?? 0) + 1);
  }
  return SICK_TIERS.map((t) => ({ percent: t.percent, days: counts.get(t.percent) ?? 0 }));
}

export interface PeriodLeave {
  /** Unpaid leave and sick days without pay. */
  unpaidDays: number;
  /** Sick days at a reduced share of pay. */
  reducedPay: ReducedPayDays[];
  /** Leave days in the month by type. */
  byType: Partial<Record<LeaveType, number>>;
}

/** What an employee's leave in a month means for their pay. */
export function leaveInPeriod(
  records: LeaveRecord[],
  period: string,
  isDayOff: DayOff,
): PeriodLeave {
  const start = periodStart(period);
  const end = periodEnd(period);
  const inMonth = (d: ISODate) => d >= start && d <= end;
  const byType: Partial<Record<LeaveType, number>> = {};
  let unpaidDays = 0;
  const reduced = new Map<number, number>();
  const sick = sickDayRates(records, Number(period.slice(0, 4)), isDayOff);
  for (const r of records) {
    if (!isTaken(r) || r.end < start || r.start > end) continue;
    const dates = countedDates(r.type, r.start, r.end, isDayOff).filter(inMonth);
    if (dates.length === 0) continue;
    byType[r.type] = (byType[r.type] ?? 0) + dates.length;
    if (r.type === 'unpaid') unpaidDays += dates.length;
    if (r.type !== 'sick') continue;
    for (const d of dates) {
      const percent = sick.get(d) ?? 100;
      if (percent === 0) unpaidDays += 1;
      else if (percent < 100) reduced.set(percent, (reduced.get(percent) ?? 0) + 1);
    }
  }
  const reducedPay = [...reduced.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([percent, days]) => ({ percent, days }));
  return { unpaidDays, reducedPay, byType };
}

export interface LeaveBalance {
  /** Day accrual counts from: the latest opening balance, or the hire date. */
  from: ISODate | null;
  opening: number;
  accrued: number;
  adjusted: number;
  taken: number;
  balance: number;
  /** First day annual leave can be taken (nine months after hiring). */
  eligibleFrom: ISODate | null;
}

const twoPlaces = (n: number) => Math.round(n * 100) / 100;

/** Whole months from `from` to the end of `on` (a month of service ends the day before the same date). */
export function completedMonths(from: ISODate, on: ISODate): number {
  if (on < from) return 0;
  return Math.max(0, differenceInMonths(addDays(parseISODate(on), 1), parseISODate(from)));
}

/**
 * Annual leave balance on a date: the opening balance (or nothing from the
 * hire date), 2.5 days for each month of service since, adjustments, less the
 * annual leave taken. Unused days carry forward.
 */
export function annualLeaveBalance(
  records: LeaveRecord[],
  hireDate: ISODate | null,
  on: ISODate,
  entitlement = ANNUAL_LEAVE_DAYS,
): LeaveBalance {
  const annual = records.filter(
    (r) => r.type === 'annual' && r.status === 'approved' && r.start <= on,
  );
  const opening = annual
    .filter((r) => r.kind === 'opening')
    .sort((a, b) => b.start.localeCompare(a.start) || b.createdAt.localeCompare(a.createdAt))[0];
  const from = opening?.start ?? hireDate;
  const eligibleFrom = hireDate
    ? toISODate(addMonths(parseISODate(hireDate), FIRST_YEAR_MONTHS))
    : null;
  if (!from || from > on) {
    return { from, opening: 0, accrued: 0, adjusted: 0, taken: 0, balance: 0, eligibleFrom };
  }
  const after = annual.filter((r) => r.start >= from && r !== opening);
  const accrued = twoPlaces((completedMonths(from, on) * entitlement) / 12);
  const adjusted = twoPlaces(
    after.filter((r) => r.kind === 'adjustment').reduce((s, r) => s + r.days, 0),
  );
  const taken = twoPlaces(after.filter((r) => r.kind === 'leave').reduce((s, r) => s + r.days, 0));
  const openingDays = opening?.days ?? 0;
  return {
    from,
    opening: openingDays,
    accrued,
    adjusted,
    taken,
    balance: twoPlaces(openingDays + accrued + adjusted - taken),
    eligibleFrom,
  };
}

/** Something to check before recording leave. */
export type LeaveWarning =
  | { code: 'over_balance'; balance: number }
  | { code: 'not_eligible'; date: ISODate }
  | { code: 'over_limit'; limit: number }
  | { code: 'hajj_taken' }
  | { code: 'overlap' };

/** Checks leave about to be recorded against the balance, the limits and other leave. */
export function leaveWarnings(
  record: Pick<LeaveRecord, 'id' | 'type' | 'kind' | 'start' | 'end' | 'days'>,
  others: LeaveRecord[],
  balance: LeaveBalance | null,
): LeaveWarning[] {
  if (record.kind !== 'leave') return [];
  const out: LeaveWarning[] = [];
  const taken = others.filter((r) => r.id !== record.id && isTaken(r));
  if (record.type === 'annual' && balance) {
    if (record.days > balance.balance) out.push({ code: 'over_balance', balance: balance.balance });
    if (balance.eligibleFrom && record.start < balance.eligibleFrom) {
      out.push({ code: 'not_eligible', date: balance.eligibleFrom });
    }
  }
  const limit = LEAVE_TYPES[record.type].days;
  if (limit !== null && record.type !== 'annual' && record.type !== 'sick' && record.days > limit) {
    out.push({ code: 'over_limit', limit });
  }
  if (record.type === 'hajj' && taken.some((r) => r.type === 'hajj'))
    out.push({ code: 'hajj_taken' });
  if (taken.some((r) => r.start <= record.end && r.end >= record.start)) {
    out.push({ code: 'overlap' });
  }
  return out;
}
