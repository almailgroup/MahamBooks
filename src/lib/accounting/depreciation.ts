import type { DepreciationMethod, ISODate } from '@/db/types';
import { Decimal, dec, round, toMinor } from '@/lib/money';
import { addDaysISO, parseISODate, toISODate } from '@/lib/dates';

/**
 * Depreciation of fixed assets. Every figure is worked out as the total
 * depreciation an asset should have at the end of a day, in integer minor
 * units (fils). A monthly run posts the difference between that total and
 * what is already in the books, so running a month twice adds nothing and a
 * skipped month is caught up by the next run.
 *
 * Part months count by days: an asset put to use on 15 January (31 days)
 * takes 17/31 of a month's depreciation for January, and the rest of its last
 * month after its useful life runs out.
 */

export interface DepreciationTerms {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** Declining balance: yearly rate in percent; empty means twice the straight-line rate. */
  decliningRate?: number | null;
  depreciationStart: ISODate;
  /** Depreciation charged before the asset was entered, up to `openingDepreciationDate`. */
  openingDepreciation: number;
  openingDepreciationDate: ISODate | null;
}

/* -------------------------------------------------------------------------- */
/* Months                                                                     */
/* -------------------------------------------------------------------------- */

/** `yyyy-MM` of a date. */
export function periodOf(date: ISODate): string {
  return date.slice(0, 7);
}

/** Last day of a `yyyy-MM` month. */
export function periodEnd(period: string): ISODate {
  const [y, m] = period.split('-').map(Number);
  return toISODate(new Date(y, m, 0));
}

/** Last day of the month a date is in. */
export function monthEnd(date: ISODate): ISODate {
  return periodEnd(periodOf(date));
}

/** The month after (or before, with a negative step) a `yyyy-MM` month. */
export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

interface Segment {
  period: string;
  /** Share of the month covered, 0–1. */
  fraction: Decimal;
}

/** The months between two dates (both included), as fractions of each month. */
function segments(from: ISODate, to: ISODate): Segment[] {
  if (to < from) return [];
  const out: Segment[] = [];
  let cursor = parseISODate(from);
  const last = parseISODate(to);
  while (cursor <= last) {
    const days = daysInMonth(cursor);
    const sameMonth =
      cursor.getFullYear() === last.getFullYear() && cursor.getMonth() === last.getMonth();
    const endDay = sameMonth ? last.getDate() : days;
    const covered = endDay - cursor.getDate() + 1;
    out.push({
      period: periodOf(toISODate(cursor)),
      fraction: covered === days ? new Decimal(1) : new Decimal(covered).dividedBy(days),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return out;
}

/** Months (with fractions for part months) from `from` to `to`, both included. */
export function elapsedMonths(from: ISODate, to: ISODate): Decimal {
  return segments(from, to).reduce((acc, s) => acc.plus(s.fraction), new Decimal(0));
}

/* -------------------------------------------------------------------------- */
/* Depreciation                                                               */
/* -------------------------------------------------------------------------- */

/** Twice the straight-line rate, e.g. 40% a year for a 5-year life. */
export function defaultDecliningRate(usefulLifeMonths: number): number {
  if (!(usefulLifeMonths > 0)) return 0;
  return round(dec(2400).dividedBy(usefulLifeMonths), 2);
}

export function decliningRateOf(
  terms: Pick<DepreciationTerms, 'decliningRate' | 'usefulLifeMonths'>,
) {
  return terms.decliningRate && terms.decliningRate > 0
    ? terms.decliningRate
    : defaultDecliningRate(terms.usefulLifeMonths);
}

interface Start {
  /** First day AlmailBooks charges depreciation for. */
  begin: ISODate;
  /** Depreciation already charged at `begin` (minor units). */
  accumulated: number;
  /** Months of the useful life used up before `begin`. */
  used: Decimal;
}

function startOf(terms: DepreciationTerms, precision: number): Start {
  const start = terms.depreciationStart;
  const openingDate = terms.openingDepreciationDate;
  if (terms.openingDepreciation > 0 && openingDate) {
    const after = addDaysISO(openingDate, 1);
    return {
      begin: after > start ? after : start,
      accumulated: toMinor(terms.openingDepreciation, precision),
      used: elapsedMonths(start, openingDate),
    };
  }
  return { begin: start, accumulated: 0, used: new Decimal(0) };
}

/** What can be depreciated in total: cost less salvage value (minor units). */
export function depreciableAmount(terms: DepreciationTerms, precision: number): number {
  return Math.max(0, toMinor(terms.cost, precision) - toMinor(terms.salvageValue, precision));
}

/**
 * Walks the months from the first day AlmailBooks depreciates, calling
 * `visit` with the accumulated depreciation at the end of each piece. Stops
 * when the asset is fully depreciated, at `until`, or after 100 years.
 */
function walk(
  terms: DepreciationTerms,
  precision: number,
  until: ISODate | null,
  visit: (period: string, accumulated: number, partial: boolean) => void,
): number {
  const start = startOf(terms, precision);
  const total = depreciableAmount(terms, precision);
  let accumulated = start.accumulated;
  if (accumulated >= total) return accumulated;
  const leftAtStart = total - accumulated;
  const lifeLeft = new Decimal(Math.max(0, terms.usefulLifeMonths)).minus(start.used);
  // Yearly rate in percent; divided by 1,200 for a month (last, to stay exact).
  const rate = dec(decliningRateOf(terms));
  const cost = toMinor(terms.cost, precision);
  const end = until ?? addDaysISO(start.begin, 36525);
  let used = new Decimal(0);
  for (const seg of segments(start.begin, end)) {
    const left = total - accumulated;
    if (left <= 0) break;
    // Life left before this piece of the month.
    const remaining = lifeLeft.minus(used);
    used = used.plus(seg.fraction);
    if (remaining.lte(seg.fraction)) {
      // The useful life ends in this month (or has already ended).
      accumulated = total;
    } else if (terms.method === 'declining_balance') {
      const declining = dec(cost - accumulated)
        .times(rate)
        .times(seg.fraction)
        .dividedBy(1200);
      // Switch to straight line once it gives more, so the asset reaches its
      // salvage value exactly when its life ends.
      const straight = dec(left).times(seg.fraction).dividedBy(remaining);
      accumulated += Math.min(left, toMinor(declining.gt(straight) ? declining : straight, 0));
    } else {
      // Straight line: what is left is spread evenly over the life that is left.
      const share = toMinor(dec(leftAtStart).times(used).dividedBy(lifeLeft), 0);
      accumulated = Math.min(total, start.accumulated + share);
    }
    const partial = seg.period === periodOf(end) && end !== periodEnd(seg.period);
    visit(seg.period, accumulated, partial);
  }
  return accumulated;
}

/**
 * Accumulated depreciation (minor units) an asset should have at the end of
 * `date`, including depreciation charged before it was entered.
 */
export function accumulatedAt(terms: DepreciationTerms, date: ISODate, precision: number): number {
  if (date < terms.depreciationStart) return 0;
  const start = startOf(terms, precision);
  if (date < start.begin) return start.accumulated;
  return walk(terms, precision, date, () => undefined);
}

export interface ScheduleRow {
  period: string;
  /** Last day of the month. */
  date: ISODate;
  /** Minor units. */
  charge: number;
  accumulated: number;
  bookValue: number;
}

/** Month-by-month depreciation from the first month AlmailBooks depreciates to the end of the life. */
export function depreciationSchedule(terms: DepreciationTerms, precision: number): ScheduleRow[] {
  const start = startOf(terms, precision);
  const cost = toMinor(terms.cost, precision);
  const rows: ScheduleRow[] = [];
  let previous = start.accumulated;
  walk(terms, precision, null, (period, accumulated, partial) => {
    if (partial) return;
    rows.push({
      period,
      date: periodEnd(period),
      charge: accumulated - previous,
      accumulated,
      bookValue: cost - accumulated,
    });
    previous = accumulated;
  });
  return rows;
}

/** Whether an asset is depreciated down to its salvage value by `date`. */
export function fullyDepreciated(terms: DepreciationTerms, date: ISODate, precision: number) {
  return accumulatedAt(terms, date, precision) >= depreciableAmount(terms, precision);
}
