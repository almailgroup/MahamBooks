import { addDays, addMonths, differenceInMonths } from 'date-fns';
import type {
  Employee,
  EmployeeCategory,
  ID,
  ISODate,
  LeaveOpening,
  LeavePolicy,
  LeaveReason,
  LeaveReasonPay,
  LeaveRecord,
  LeaveType,
  ReducedPayDays,
} from '@/db/types';
import { addDaysISO, daysBetween, parseISODate, toISODate } from '@/lib/dates';
import { KUWAIT_WEEKEND } from '@/lib/kuwait';
import { lookup } from '@/lib/known';
import { msg, t } from '@/i18n';
import { localName } from '@/i18n/names';
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

/** Leave of a type this version doesn't know: no limit, counted in working days. */
const OTHER_LEAVE: LeaveTypeInfo = { label: msg('Other leave'), days: null, counting: 'working' };

/** What the app knows of a type of leave, also for a type a newer version saved. */
export function leaveTypeInfo(type: string): LeaveTypeInfo {
  return lookup(LEAVE_TYPES, type, OTHER_LEAVE);
}

export const LEAVE_TYPE_ORDER: LeaveType[] = [
  'annual',
  'sick',
  'maternity',
  'hajj',
  'bereavement',
  'unpaid',
];

/* -------------------------------------------------------------------------- */
/* The company's own leave reasons (D11)                                      */
/* -------------------------------------------------------------------------- */

export interface LeaveReasonPayInfo {
  label: string;
  /** The type older versions read for leave of it. */
  base: LeaveType;
  /** Share of pay of its days, in percent. */
  percent: number;
}

/**
 * How a reason is paid, and the type its leave keeps for older versions:
 * annual leave for leave taken from the annual balance; unpaid leave for
 * leave without pay or paid in part (older versions pay it as unpaid); and
 * bereavement leave, which older versions pay in full, for the rest.
 */
export const LEAVE_REASON_PAY: Record<LeaveReasonPay, LeaveReasonPayInfo> = {
  full: { label: msg('Full pay'), base: 'bereavement', percent: 100 },
  half: { label: msg('Half pay'), base: 'unpaid', percent: 50 },
  unpaid: { label: msg('Without pay'), base: 'unpaid', percent: 0 },
  annual: { label: msg('Taken from annual leave'), base: 'annual', percent: 100 },
  balance: { label: msg('Full pay, from days added by hand'), base: 'bereavement', percent: 100 },
};

export const LEAVE_REASON_PAY_ORDER: LeaveReasonPay[] = [
  'full',
  'half',
  'unpaid',
  'annual',
  'balance',
];

/** What the app knows of how a reason is paid, also for a way a newer version saved. */
export function leaveReasonPay(reason: Pick<LeaveReason, 'pay' | 'base'>): LeaveReasonPayInfo {
  return lookup(LEAVE_REASON_PAY, reason.pay, {
    label: msg('Other leave'),
    base: reason.base,
    percent: reason.base === 'unpaid' ? 0 : 100,
  });
}

/** The type leave of a reason keeps, from how it is paid. */
export function leaveReasonBase(pay: LeaveReasonPay): LeaveType {
  return LEAVE_REASON_PAY[pay].base;
}

/** The reason a record was recorded with, when the company still has it. */
export function reasonOf(
  record: Pick<LeaveRecord, 'reasonId'>,
  reasons: readonly LeaveReason[] | null | undefined,
): LeaveReason | null {
  if (!record.reasonId) return null;
  return reasons?.find((r) => r.id === record.reasonId) ?? null;
}

/** The reasons offered for an employee's new leave: not archived, and for their category. */
export function reasonsFor(
  reasons: readonly LeaveReason[] | null | undefined,
  employee: { category: EmployeeCategory } | null | undefined,
): LeaveReason[] {
  return (reasons ?? []).filter(
    (r) =>
      !r.archived &&
      (!r.categories?.length || (employee ? r.categories.includes(employee.category) : true)),
  );
}

/**
 * The name of a record's leave in the interface language: its reason's name,
 * or its type's. A reason the company no longer has shows as its type.
 */
export function leaveLabel(
  record: Pick<LeaveRecord, 'type' | 'reasonId'>,
  reasons: readonly LeaveReason[] | null | undefined,
): string {
  const reason = reasonOf(record, reasons);
  return reason ? localName(reason) : t(leaveTypeInfo(record.type).label);
}

/**
 * Share of pay of a day of unpaid leave: what a reason paid in part fixed
 * when it was recorded (LeaveRecord.payPercent), otherwise nothing.
 */
export function unpaidShare(record: Pick<LeaveRecord, 'payPercent'>): number {
  const percent = record.payPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** How the company counts leave days: to split leave that crosses 31 December by year. */
export interface DayCounting {
  isDayOff: DayOff;
  policy?: LeavePolicy | null;
}

/**
 * A leave's days in a calendar year: all its days (as recorded) when it is
 * within the year. One that crosses 31 December is split by its counted
 * dates when `counting` is given (as sick days are), otherwise it counts in
 * the year it starts, as before.
 */
export function leaveDaysInYear(
  record: Pick<LeaveRecord, 'type' | 'start' | 'end' | 'days'>,
  year: number,
  counting?: DayCounting,
): number {
  const prefix = `${year}-`;
  const startsIn = record.start.startsWith(prefix);
  const end = record.end || record.start;
  if (startsIn && end.startsWith(prefix)) return record.days;
  if (!counting) return startsIn ? record.days : 0;
  return countedDates(record.type, record.start, end, counting.isDayOff, counting.policy).filter(
    (d) => d.startsWith(prefix),
  ).length;
}

/**
 * Days of a reason's leave in a calendar year: leave that crosses 31
 * December is split between the years when `counting` is given (see
 * leaveDaysInYear), otherwise counted in the year it starts.
 */
export function reasonDaysInYear(
  records: readonly LeaveRecord[],
  reasonId: ID,
  year: number,
  exceptId?: ID,
  counting?: DayCounting,
): number {
  return twoPlaces(
    records
      .filter((r) => r.reasonId === reasonId && r.id !== exceptId && isTaken(r))
      .reduce((s, r) => s + leaveDaysInYear(r, year, counting), 0),
  );
}

export interface ReasonBalance {
  /** Days added by hand (less any removed). */
  added: number;
  taken: number;
  balance: number;
}

/**
 * A reason's own balance on a date, for reasons paid from days added by hand
 * (compensatory days): the days added less the leave taken with it.
 */
export function reasonBalance(
  records: readonly LeaveRecord[],
  reasonId: ID,
  on: ISODate,
  exceptId?: ID,
): ReasonBalance {
  const own = records.filter(
    (r) => r.reasonId === reasonId && r.id !== exceptId && r.status === 'approved' && r.start <= on,
  );
  const sum = (kind: LeaveRecord['kind']) =>
    twoPlaces(own.filter((r) => r.kind === kind).reduce((s, r) => s + r.days, 0));
  const added = sum('adjustment');
  const taken = sum('leave');
  return { added, taken, balance: twoPlaces(added - taken) };
}

export const ANNUAL_LEAVE_DAYS = 30;
/** Months of service before annual leave can be taken in the first year. */
export const FIRST_YEAR_MONTHS = 9;

/**
 * The law's leave, which applies until a company saves a policy of its own
 * (PayrollSettings.leavePolicy): 30 days a year from the start, usable after
 * nine months of service, every unused day carried forward (art. 73), counted
 * in working days.
 */
export const DEFAULT_LEAVE_POLICY: LeavePolicy = {
  annualDays: [],
  firstYearMonths: FIRST_YEAR_MONTHS,
  carryForwardMax: null,
  counting: 'working',
};

/** How leave of a type is counted: annual leave as the policy says, other leave by its type. */
export function leaveCounting(
  type: LeaveType,
  policy?: LeavePolicy | null,
): LeaveTypeInfo['counting'] {
  if (type === 'annual' && policy) return policy.counting === 'calendar' ? 'calendar' : 'working';
  return leaveTypeInfo(type).counting;
}

/** The first date of a policy: balances before it are the law's. */
export function leavePolicyStart(policy: LeavePolicy | null | undefined): ISODate | null {
  const dates = (policy?.annualDays ?? []).map((r) => r.from).sort();
  return dates[0] ?? null;
}

/**
 * Whether annual leave has been recorded in a company: from then on the way
 * it is counted stays as it is, since each record keeps the days it was saved
 * with.
 */
export function annualLeaveRecorded(records: LeaveRecord[]): boolean {
  return records.some((r) => r.type === 'annual' && r.kind === 'leave' && r.status !== 'cancelled');
}

/** Days a year in force from a date on; `from` is null for the first, which has no start. */
interface AccrualRate {
  from: ISODate | null;
  days: number;
}

/**
 * The days a year an employee earns from each date: the law's 30 until the
 * policy's first date and then the policy's; with an entitlement of their
 * own, its days from its date on (the company's before it), or throughout
 * when it has no date.
 */
function accrualRates(
  policy: LeavePolicy,
  entitlement?: number | null,
  entitlementFrom?: ISODate | null,
): AccrualRate[] {
  const dated = [...policy.annualDays].sort((a, b) => a.from.localeCompare(b.from));
  const company: AccrualRate[] = [{ from: null, days: ANNUAL_LEAVE_DAYS }, ...dated];
  if (!entitlement || entitlement <= 0) return company;
  if (!entitlementFrom) return [{ from: null, days: entitlement }];
  return [
    ...company.filter((r) => r.from === null || r.from < entitlementFrom),
    { from: entitlementFrom, days: entitlement },
  ];
}

function rateOn(rates: AccrualRate[], date: ISODate): number {
  let days = rates[0].days;
  for (const r of rates) if (r.from === null || r.from <= date) days = r.days;
  return days;
}

/**
 * Days of annual leave a year on a date: the employee's own entitlement
 * (from its date on, when it has one), or the policy's.
 */
export function annualDaysOn(
  date: ISODate,
  policy?: LeavePolicy | null,
  entitlement?: number | null,
  entitlementFrom?: ISODate | null,
): number {
  return rateOn(accrualRates(policy ?? DEFAULT_LEAVE_POLICY, entitlement, entitlementFrom), date);
}

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

/**
 * The days a leave counts: working days, or every day for calendar-day leave
 * (annual leave as the company's policy counts it).
 */
export function countedDates(
  type: LeaveType,
  start: ISODate,
  end: ISODate,
  isDayOff: DayOff,
  policy?: LeavePolicy | null,
): ISODate[] {
  if (!start || !end || end < start) return [];
  const calendar = leaveCounting(type, policy) === 'calendar';
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
  policy?: LeavePolicy | null,
): number {
  return countedDates(type, start, end, isDayOff, policy).length;
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
  /**
   * Leave of the company's reasons in the month, within the employment:
   * days by reason and share of pay. Missing when there is none.
   */
  byReason?: { reasonId: ID; type: LeaveType; days: number; percent: number }[];
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
  policy?: LeavePolicy | null,
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
  /** Days of each reason's leave, with the first day of it, to list them in order. */
  const byReason = new Map<
    string,
    { reasonId: ID; type: LeaveType; days: number; percent: number; first: ISODate }
  >();
  for (const r of records) {
    if (!isTaken(r) || r.end < start || r.start > end) continue;
    const counted = countedDates(r.type, r.start, r.end, isDayOff);
    const inThisMonth = counted.filter(inMonth).length;
    if (inThisMonth > 0) byType[r.type] = (byType[r.type] ?? 0) + inThisMonth;
    // Unpaid leave pays nothing, or the share a reason paid in part fixed.
    const share = r.type === 'unpaid' ? unpaidShare(r) : 100;
    if (r.reasonId) {
      // A reason's days as it counts them: one taken from annual leave as the
      // policy counts annual leave (as its record's days were counted).
      const own = policy ? countedDates(r.type, r.start, r.end, isDayOff, policy) : counted;
      const days = own.filter((d) => inMonth(d) && paidDay(d));
      const key = `${r.reasonId}:${r.type}:${share}`;
      const entry = byReason.get(key) ?? {
        reasonId: r.reasonId,
        type: r.type,
        days: 0,
        percent: share,
        first: days[0],
      };
      if (days.length > 0) {
        byReason.set(key, {
          ...entry,
          days: entry.days + days.length,
          first: days[0] < entry.first ? days[0] : entry.first,
        });
      }
    }
    if (r.type === 'unpaid' && share < 100) {
      for (const d of calendarDates(r.start, r.end)) {
        if (inMonth(d) && paidDay(d)) lower(d, share);
      }
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
  return {
    ...payDays([...pay.values()]),
    working: payDays(working),
    byType,
    ...(byReason.size > 0
      ? {
          byReason: [...byReason.values()]
            .sort((a, b) => a.first.localeCompare(b.first) || a.reasonId.localeCompare(b.reasonId))
            .map(({ first: _first, ...x }) => x),
        }
      : {}),
  };
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
  /**
   * Unused days lost at the start of a year for being over the policy's
   * carry-forward cap; missing when none were.
   */
  forfeited?: number;
  /**
   * Months of service that earned nothing for more than 15 days of unpaid
   * leave in them (once switched on); missing when none did.
   */
  pausedMonths?: number;
  balance: number;
  /** First day annual leave can be taken (nine months after hiring, or the policy's months). */
  eligibleFrom: ISODate | null;
}

const twoPlaces = (n: number) => Math.round(n * 100) / 100;

/** Whole months from `from` to the end of `on` (a month of service ends the day before the same date). */
export function completedMonths(from: ISODate, on: ISODate): number {
  if (on < from) return 0;
  return Math.max(0, differenceInMonths(addDays(parseISODate(on), 1), parseISODate(from)));
}

const addMonthsISO = (date: ISODate, months: number) =>
  toISODate(addMonths(parseISODate(date), months));

/** Unpaid days in a month of service above which it earns no annual leave, once switched on. */
export const ACCRUAL_PAUSE_DAYS = 15;

/** How annual leave accrues besides the policy (PayrollSettings). */
export interface AccrualOptions {
  /**
   * From this date on, a month of service with more than 15 days of unpaid
   * leave earns no annual leave (PayrollSettings.leaveAccrualPause). Missing:
   * every month earns, as before.
   */
  pauseFrom?: ISODate | null;
}

/** The accrual options a company's payroll settings give. */
export function accrualOptions(
  settings: { leaveAccrualPause?: { from: ISODate } | null } | null | undefined,
): AccrualOptions {
  const from = settings?.leaveAccrualPause?.from;
  return from ? { pauseFrom: from } : {};
}

/** Whether a month of service, from `first` to the day before `next`, earns no annual leave. */
type PausedMonth = (first: ISODate, next: ISODate) => boolean;

/**
 * The months of service that earn nothing: from the date the pause applies
 * from, those with more than 15 calendar days of unpaid leave (leave paid in
 * part doesn't count). Null when none can be.
 */
function pausedMonthsOf(
  records: readonly LeaveRecord[],
  options: AccrualOptions | undefined,
): PausedMonth | null {
  const from = options?.pauseFrom;
  if (!from) return null;
  const unpaid = new Set<ISODate>();
  for (const r of records) {
    if (r.type !== 'unpaid' || !isTaken(r) || unpaidShare(r) > 0) continue;
    for (const d of calendarDates(r.start, r.end)) unpaid.add(d);
  }
  if (unpaid.size <= ACCRUAL_PAUSE_DAYS) return null;
  const days = [...unpaid];
  return (first, next) =>
    first >= from && days.filter((d) => d >= first && d < next).length > ACCRUAL_PAUSE_DAYS;
}

/** What one month of service, from `first` to the day before `next`, earns. */
function monthEarned(first: ISODate, next: ISODate, rates: AccrualRate[]): number {
  const changes = rates.filter((r): r is AccrualRate & { from: ISODate } => r.from !== null);
  const length = daysBetween(first, next);
  let earned = 0;
  let start = first;
  for (const change of changes.filter((r) => r.from > first && r.from < next)) {
    earned += (rateOn(rates, start) * daysBetween(start, change.from)) / length / 12;
    start = change.from;
  }
  return earned + (rateOn(rates, start) * daysBetween(start, next)) / length / 12;
}

/** The months of service from `from` to the end of `on` that earn nothing. */
function pausedMonthsBetween(from: ISODate, on: ISODate, paused: PausedMonth | null): ISODate[] {
  if (!paused) return [];
  const out: ISODate[] = [];
  const months = completedMonths(from, on);
  for (let i = 0; i < months; i++) {
    const first = addMonthsISO(from, i);
    if (paused(first, addMonthsISO(from, i + 1))) out.push(first);
  }
  return out;
}

/**
 * Annual leave earned from `from` to the end of `on`: a twelfth of the days a
 * year for each complete month of service. A month in which the days a year
 * change earns a share of each, by its days. Months `paused` says earn
 * nothing (long unpaid leave, once switched on).
 */
function earnedDays(
  from: ISODate,
  on: ISODate,
  rates: AccrualRate[],
  paused: PausedMonth | null = null,
): number {
  const lost = pausedMonthsBetween(from, on, paused).reduce(
    (total, first) => total + monthEarned(first, addMonthsISO(first, 1), rates),
    0,
  );
  const months = completedMonths(from, on);
  const changes = rates.filter((r): r is AccrualRate & { from: ISODate } => r.from !== null);
  const last = addDaysISO(addMonthsISO(from, months), -1);
  if (!changes.some((r) => r.from > from && r.from <= last)) {
    return (months * rateOn(rates, from)) / 12 - lost;
  }
  let earned = 0;
  for (let i = 0; i < months; i++) {
    const first = addMonthsISO(from, i);
    const next = addMonthsISO(from, i + 1);
    const length = daysBetween(first, next);
    let start = first;
    for (const change of changes.filter((r) => r.from > first && r.from < next)) {
      earned += (rateOn(rates, start) * daysBetween(start, change.from)) / length / 12;
      start = change.from;
    }
    earned += (rateOn(rates, start) * daysBetween(start, next)) / length / 12;
  }
  return earned - lost;
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
 * Days over the carry-forward cap lost at each new year from `from` to `on`:
 * what the balance on 31 December was above the cap, from the first new year
 * on or after the policy's first date (earlier years are the law's, which
 * carries every day forward). Leave counts in the year it starts.
 *
 * Days held the day before the policy's first date were earned under the
 * law and are never lost: leave taken from then on uses them first, and the
 * cap applies to what is held above those left. (A balance that starts on or
 * after the first date, an opening balance entered then, is the policy's.)
 */
function forfeitedDays(
  from: ISODate,
  on: ISODate,
  opening: number,
  records: LeaveRecord[],
  rates: AccrualRate[],
  policy: LeavePolicy,
  paused: PausedMonth | null = null,
): number {
  const cap = policy.carryForwardMax;
  const start = leavePolicyStart(policy);
  if (cap === null || cap === undefined || !start) return 0;
  const sum = (kind: LeaveRecord['kind'], until: ISODate) =>
    records
      .filter((r) => r.kind === kind && r.start <= until)
      .reduce((total, r) => total + r.days, 0);
  const heldOn = (date: ISODate, lostBefore: number) =>
    twoPlaces(
      opening +
        earnedDays(from, date, rates, paused) +
        sum('adjustment', date) -
        sum('leave', date) -
        lostBefore,
    );
  // The law's days, held the day before the policy starts.
  const dayBefore = addDaysISO(start, -1);
  const lawDays = from < start ? Math.max(0, heldOn(dayBefore, 0)) : 0;
  let lost = 0;
  for (let year = Number(from.slice(0, 4)); `${year}-12-31` < on; year++) {
    const yearEnd = `${year}-12-31`;
    if (`${year + 1}-01-01` < start) continue;
    const held = heldOn(yearEnd, lost);
    const kept = Math.max(0, lawDays - (sum('leave', yearEnd) - sum('leave', dayBefore)));
    if (held - kept > cap) lost += held - kept - cap;
  }
  return twoPlaces(lost);
}

/**
 * Annual leave balance on a date: the latest opening balance by then (or
 * nothing from the hire date), the days earned for each month of service
 * since (2.5 a month under the law; see earnedDays), adjustments, less the
 * annual leave taken. Unused days carry forward, up to the policy's cap when
 * it has one.
 *
 * Opening balances are opening leave records and `brought`, the leave the
 * employee brought forward (see Employee.leaveOpening and openingsOf). Leave
 * brought forward accrues from its date, or the hire date when later. Before
 * an employee's first opening balance their leave isn't here, so the balance
 * is worked back from it, never from the hire date: its days less what each
 * complete month in between earned, plus the annual leave taken in between
 * and less the adjustments made then, never below 0.
 *
 * `policy` is the company's leave policy (the law's when missing) and
 * `entitlement` the employee's own days a year, in place of the policy's
 * from `entitlementFrom` on (throughout when it has no date). `accrual` can
 * pause the months of long unpaid leave (see AccrualOptions); annual leave
 * of a company's reason (taken from the annual balance) is annual leave.
 */
export function annualLeaveBalance(
  records: LeaveRecord[],
  hireDate: ISODate | null,
  on: ISODate,
  brought: LeaveOpening | null = null,
  policy: LeavePolicy | null = null,
  entitlement: number | null = null,
  entitlementFrom: ISODate | null = null,
  accrual: AccrualOptions = {},
): LeaveBalance {
  const rules = policy ?? DEFAULT_LEAVE_POLICY;
  const rates = accrualRates(rules, entitlement, entitlementFrom);
  const paused = pausedMonthsOf(records, accrual);
  const annual = records.filter((r) => r.type === 'annual' && r.status === 'approved');
  const eligibleFrom = hireDate
    ? toISODate(addMonths(parseISODate(hireDate), rules.firstYearMonths))
    : null;
  const none = { opening: 0, accrued: 0, adjusted: 0, taken: 0, balance: 0, eligibleFrom };
  const openings = openingsOf(annual, brought);
  const opening = openings.filter((o) => o.date <= on).sort(latestFirst)[0];
  if (!opening) {
    if (hireDate && hireDate > on) return { from: hireDate, ...none };
    const next = openings.filter((o) => o.date > on).sort(earliestFirst)[0];
    if (next) {
      const earned = earnedDays(addDaysISO(on, 1), addDaysISO(next.date, -1), rates, paused);
      // Leave taken between the day and the opening was still to come on the
      // day (it is added back); adjustments made then were not there yet.
      const between = annual.filter(
        (r) => r.start > on && r.start < next.date && r.kind !== 'opening',
      );
      const sum = (kind: LeaveRecord['kind']) =>
        between.filter((r) => r.kind === kind).reduce((total, r) => total + r.days, 0);
      const balance = twoPlaces(Math.max(0, next.days - earned + sum('leave') - sum('adjustment')));
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
  const accrued = twoPlaces(earnedDays(from, on, rates, paused));
  const pausedMonths = pausedMonthsBetween(from, on, paused).length;
  const adjusted = twoPlaces(
    after.filter((r) => r.kind === 'adjustment').reduce((s, r) => s + r.days, 0),
  );
  const taken = twoPlaces(after.filter((r) => r.kind === 'leave').reduce((s, r) => s + r.days, 0));
  const openingDays = opening?.days ?? 0;
  const forfeited = forfeitedDays(from, on, openingDays, after, rates, rules, paused);
  return {
    from,
    opening: openingDays,
    accrued,
    adjusted,
    taken,
    ...(forfeited > 0 ? { forfeited } : {}),
    ...(pausedMonths > 0 ? { pausedMonths } : {}),
    balance: twoPlaces(openingDays + accrued + adjusted - taken - forfeited),
    eligibleFrom,
  };
}

/**
 * An employee's annual leave balance on a date, from their leave records,
 * the leave they brought forward, their own entitlement, the company's
 * leave policy (the law's when missing) and how leave accrues
 * (accrualOptions of the payroll settings).
 */
export function employeeLeaveBalance(
  employee: Pick<
    Employee,
    'id' | 'hireDate' | 'leaveOpening' | 'annualLeaveDays' | 'annualLeaveDaysFrom'
  >,
  records: LeaveRecord[],
  on: ISODate,
  policy?: LeavePolicy | null,
  accrual: AccrualOptions = {},
): LeaveBalance {
  return annualLeaveBalance(
    records.filter((r) => r.employeeId === employee.id),
    employee.hireDate,
    on,
    employee.leaveOpening ?? null,
    policy ?? null,
    employee.annualLeaveDays ?? null,
    employee.annualLeaveDaysFrom ?? null,
    accrual,
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
  | { code: 'overlap' }
  /** More than a reason's days a year, with what was taken that year before. */
  | { code: 'over_year_max'; limit: number; taken: number }
  /** More than a reason's own balance (compensatory days). */
  | { code: 'over_reason_balance'; balance: number };

/**
 * Checks leave about to be recorded against the balance, the limits and
 * other leave. Leave of a company's reason (`reason`) is checked against the
 * reason's days a year and its own balance instead of its type's limit.
 */
export function leaveWarnings(
  record: Pick<LeaveRecord, 'id' | 'type' | 'kind' | 'start' | 'end' | 'days'>,
  others: LeaveRecord[],
  balance: LeaveBalance | null,
  reason: LeaveReason | null = null,
  counting?: DayCounting,
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
  const limit = reason ? null : leaveTypeInfo(record.type).days;
  if (limit !== null && record.type !== 'annual' && record.type !== 'sick' && record.days > limit) {
    out.push({ code: 'over_limit', limit });
  }
  const max = reason?.maxDaysPerYear;
  if (reason && typeof max === 'number' && max > 0) {
    // Each calendar year the leave falls in (one crossing 31 December, split).
    const first = Number(record.start.slice(0, 4));
    const last = Math.max(first, Number((record.end || record.start).slice(0, 4)));
    for (let year = first; year <= last; year++) {
      const mine = leaveDaysInYear(record, year, counting);
      if (mine <= 0 && year !== first) continue;
      const before = reasonDaysInYear(others, reason.id, year, record.id, counting);
      if (before + mine > max) {
        out.push({ code: 'over_year_max', limit: max, taken: before });
        break;
      }
    }
  }
  if (reason?.pay === 'balance') {
    // Every day added and taken, whatever its date.
    const own = reasonBalance(others, reason.id, '9999-12-31', record.id).balance;
    if (record.days > own) out.push({ code: 'over_reason_balance', balance: own });
  }
  if (record.type === 'hajj' && taken.some((r) => r.type === 'hajj'))
    out.push({ code: 'hajj_taken' });
  if (taken.some((r) => r.start <= record.end && r.end >= record.start)) {
    out.push({ code: 'overlap' });
  }
  return out;
}
