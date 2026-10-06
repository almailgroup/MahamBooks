import { addDays, addMonths, differenceInMonths } from 'date-fns';
import type {
  Employee,
  ID,
  ISODate,
  LeaveOpening,
  LeaveRecord,
  LeaveType,
  ReducedPayDays,
} from '@/db/types';
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
 * public holidays) except maternity, Hajj and unpaid leave, which run in
 * calendar days.
 *
 * Pay lost to leave is a share of the month's pay, like the pay of someone
 * who joins or leaves during the month: every calendar day of unpaid leave
 * costs a day's pay (wage × days ÷ days in the month), so a whole month of
 * unpaid leave leaves nothing to pay. Sick leave tiers are counted in working
 * days; a weekend or holiday within sick leave is paid at the share of the
 * working day before it.
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
  unpaid: { label: msg('Unpaid leave'), days: null, counting: 'calendar' },
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
  /** Calendar days of unpaid leave and of sick leave without pay. */
  unpaidDays: number;
  /** Calendar days of sick leave at a reduced share of pay. */
  reducedPay: ReducedPayDays[];
  /**
   * The same days counting working days only, as versions of the app before
   * October 2026 count them (and deduct them at the daily rate).
   */
  working: { unpaidDays: number; reducedPay: ReducedPayDays[] };
  /** Leave days in the month by type, counted as each type counts them. */
  byType: Partial<Record<LeaveType, number>>;
}

/** Days without pay, and days at each reduced share of pay, from each day's share of pay. */
function payDays(shares: number[]): { unpaidDays: number; reducedPay: ReducedPayDays[] } {
  let unpaidDays = 0;
  const reduced = new Map<number, number>();
  for (const percent of shares) {
    if (percent === 0) unpaidDays += 1;
    else if (percent < 100) reduced.set(percent, (reduced.get(percent) ?? 0) + 1);
  }
  const reducedPay = [...reduced.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([percent, days]) => ({ percent, days }));
  return { unpaidDays, reducedPay };
}

/** Every date from `start` to `end` (at most MAX_LEAVE_SPAN of them). */
function calendarDates(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let date = start;
  for (let i = 0; i < MAX_LEAVE_SPAN && date <= end; i++) {
    out.push(date);
    date = addDaysISO(date, 1);
  }
  return out;
}

/**
 * What an employee's leave in a month means for their pay, in calendar days
 * of the month (and of the employment, when `employed` gives its first and
 * last day): unpaid days, and sick days at a reduced share of pay. A weekend
 * or holiday within sick leave takes the share of the working day before it
 * (or after it, when the leave starts on a day off). A day on two kinds of
 * leave counts once, at the lower pay. `working` has the working days among
 * them, for pay lines read by older versions of the app (see PayLine).
 */
export function leaveInPeriod(
  records: LeaveRecord[],
  period: string,
  isDayOff: DayOff,
  employed: { from?: ISODate | null; to?: ISODate | null } = {},
): PeriodLeave {
  const start = periodStart(period);
  const end = periodEnd(period);
  const inMonth = (d: ISODate) => d >= start && d <= end;
  const first = employed.from && employed.from > start ? employed.from : start;
  const last = employed.to && employed.to < end ? employed.to : end;
  const paidDay = (d: ISODate) => d >= first && d <= last;
  const byType: Partial<Record<LeaveType, number>> = {};
  /** Share of pay (in percent) of each day of the month on leave that costs pay. */
  const pay = new Map<ISODate, number>();
  const lower = (d: ISODate, percent: number) => pay.set(d, Math.min(pay.get(d) ?? 100, percent));
  const sick = sickDayRates(records, Number(period.slice(0, 4)), isDayOff);
  for (const r of records) {
    if (!isTaken(r) || r.end < start || r.start > end) continue;
    const counted = countedDates(r.type, r.start, r.end, isDayOff);
    const inThisMonth = counted.filter(inMonth).length;
    if (inThisMonth > 0) byType[r.type] = (byType[r.type] ?? 0) + inThisMonth;
    if (r.type === 'unpaid') {
      for (const d of calendarDates(r.start, r.end)) if (inMonth(d) && paidDay(d)) lower(d, 0);
    }
    if (r.type !== 'sick') continue;
    const working = new Set(counted);
    let tierDay: ISODate | undefined = counted[0];
    for (const d of calendarDates(r.start, r.end)) {
      if (working.has(d)) tierDay = d;
      if (!inMonth(d) || !paidDay(d)) continue;
      const percent = tierDay ? (sick.get(tierDay) ?? 100) : 100;
      if (percent < 100) lower(d, percent);
    }
  }
  const working = [...pay].filter(([d]) => !isDayOff(d)).map(([, percent]) => percent);
  return { ...payDays([...pay.values()]), working: payDays(working), byType };
}

export interface LeaveBalance {
  /**
   * Day accrual counts from: the latest opening balance (a leave record, or
   * the leave the employee brought forward), or the hire date.
   */
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

/** An opening balance: the annual leave an employee had left on a date. */
interface Opening {
  date: ISODate;
  days: number;
  /** The opening leave record, or null for the leave brought forward. */
  record: LeaveRecord | null;
}

/**
 * The opening balances that count: approved opening leave records, and the
 * leave brought forward unless a record replaces it. A record replaces leave
 * brought forward nobody has confirmed (an import's 0 days) whatever its
 * date; confirmed leave brought forward gives way to a record from the
 * record's date on, and counts before it.
 */
function openingsOf(annual: LeaveRecord[], brought: LeaveOpening | null): Opening[] {
  const records = annual.filter((r) => r.kind === 'opening');
  const out: Opening[] = records.map((r) => ({ date: r.start, days: r.days, record: r }));
  if (brought && (brought.confirmed || records.length === 0)) {
    out.push({ date: brought.date, days: brought.days, record: null });
  }
  return out;
}

/** On the same day a record counts before leave brought forward, and a newer record first. */
const sameDay = (a: Opening, b: Opening) =>
  Number(Boolean(b.record)) - Number(Boolean(a.record)) ||
  (b.record?.createdAt ?? '').localeCompare(a.record?.createdAt ?? '');
const latestFirst = (a: Opening, b: Opening) => b.date.localeCompare(a.date) || sameDay(a, b);
const earliestFirst = (a: Opening, b: Opening) => a.date.localeCompare(b.date) || sameDay(a, b);

/**
 * Annual leave balance on a date: the latest opening balance by then (or
 * nothing from the hire date), 2.5 days for each month of service since,
 * adjustments, less the annual leave taken. Unused days carry forward.
 *
 * Opening balances are opening leave records and `brought`, the leave the
 * employee brought forward (see Employee.leaveOpening and openingsOf). Leave
 * brought forward accrues from its date, or the hire date when later. Before
 * an employee's first opening balance their leave isn't here, so the balance
 * is worked back from it, never from the hire date: its days less 2.5 for
 * each complete month in between, never below 0.
 */
export function annualLeaveBalance(
  records: LeaveRecord[],
  hireDate: ISODate | null,
  on: ISODate,
  brought: LeaveOpening | null = null,
): LeaveBalance {
  const annual = records.filter((r) => r.type === 'annual' && r.status === 'approved');
  const eligibleFrom = hireDate
    ? toISODate(addMonths(parseISODate(hireDate), FIRST_YEAR_MONTHS))
    : null;
  const none = { opening: 0, accrued: 0, adjusted: 0, taken: 0, balance: 0, eligibleFrom };
  const openings = openingsOf(annual, brought);
  const opening = openings.filter((o) => o.date <= on).sort(latestFirst)[0];
  if (!opening) {
    if (hireDate && hireDate > on) return { from: hireDate, ...none };
    const next = openings.filter((o) => o.date > on).sort(earliestFirst)[0];
    if (next) {
      const months = completedMonths(addDaysISO(on, 1), addDaysISO(next.date, -1));
      const balance = twoPlaces(Math.max(0, next.days - (months * ANNUAL_LEAVE_DAYS) / 12));
      return {
        from: next.date,
        opening: next.days,
        accrued: twoPlaces(balance - next.days),
        adjusted: 0,
        taken: 0,
        balance,
        eligibleFrom,
      };
    }
  }
  const from = !opening
    ? hireDate
    : !opening.record && hireDate && hireDate > opening.date
      ? hireDate
      : opening.date;
  if (!from || from > on) return { from, ...none };
  const after = annual.filter((r) => r.start >= from && r.start <= on && r.kind !== 'opening');
  const accrued = twoPlaces((completedMonths(from, on) * ANNUAL_LEAVE_DAYS) / 12);
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

/**
 * An employee's annual leave balance on a date, from their leave records and
 * the leave they brought forward.
 */
export function employeeLeaveBalance(
  employee: Pick<Employee, 'id' | 'hireDate' | 'leaveOpening'>,
  records: LeaveRecord[],
  on: ISODate,
): LeaveBalance {
  return annualLeaveBalance(
    records.filter((r) => r.employeeId === employee.id),
    employee.hireDate,
    on,
    employee.leaveOpening ?? null,
  );
}

/** A record that sets the annual leave balance on its date (see LeaveRecord). */
export function isOpeningRecord(record: LeaveRecord): boolean {
  return record.kind === 'opening' && record.type === 'annual' && record.status === 'approved';
}

/**
 * Days between the hire date and the day an employee was added here within
 * which all their leave is here: nothing was taken before to bring forward.
 */
export const ADDED_AT_HIRE_DAYS = 31;

type OpeningFields = Pick<Employee, 'id' | 'status' | 'hireDate' | 'createdAt' | 'leaveOpening'>;

/**
 * The employees who still need an opening leave balance: current staff
 * whose balance counts no opening balance (see openingsOf) and who were hired
 * more than a month before they were added here (or have no hire date), so
 * their leave is counted from the hire date as if they had taken none
 * before; and staff whose only opening is leave brought forward by an import
 * that nobody has confirmed. Staff added when they joined have all their
 * leave here and need none.
 */
export function employeesNeedingLeaveOpening<T extends OpeningFields>(
  employees: T[],
  records: LeaveRecord[],
): T[] {
  const byEmployee = new Map<ID, LeaveRecord[]>();
  for (const r of records.filter(isOpeningRecord)) {
    byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
  }
  return employees.filter((e) => {
    if (e.status === 'left') return false;
    const openings = openingsOf(byEmployee.get(e.id) ?? [], e.leaveOpening ?? null);
    if (openings.some((o) => o.record)) return false;
    if (openings.length > 0) return !e.leaveOpening?.confirmed;
    const added = e.createdAt?.slice(0, 10);
    if (!e.hireDate || !added) return true;
    return e.hireDate < addDaysISO(added, -ADDED_AT_HIRE_DAYS);
  });
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
