import type { ISODate } from '../types';
import { addDaysISO, parseISODate, toISODate, today } from '@/lib/dates';
import { KUWAIT_WEEKEND } from '@/lib/kuwait';

/**
 * Dates of the demo, all relative to today: the year of activity ends on
 * the day the demo is loaded, whatever that day is.
 */
export class Calendar {
  readonly today: ISODate;
  private readonly base: Date;

  constructor(todayIso: ISODate = today()) {
    this.today = todayIso;
    const t = parseISODate(todayIso);
    this.base = new Date(t.getFullYear(), t.getMonth(), 1);
  }

  /** First day of the month `offset` months from this one (0 is this month, -1 last month). */
  monthStart(offset: number): ISODate {
    return toISODate(new Date(this.base.getFullYear(), this.base.getMonth() + offset, 1));
  }

  monthEnd(offset: number): ISODate {
    return toISODate(new Date(this.base.getFullYear(), this.base.getMonth() + offset + 1, 0));
  }

  /** Month as yyyy-MM. */
  period(offset: number): string {
    return this.monthStart(offset).slice(0, 7);
  }

  /** Day `day` of a month (the month's last day when it is shorter). */
  day(offset: number, day: number): ISODate {
    const end = this.monthEnd(offset);
    const last = Number(end.slice(8, 10));
    return `${end.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
  }

  /** A weekday on or near the date: Friday and Saturday move to Sunday (or back to Thursday). */
  workday(date: ISODate): ISODate {
    const dow = parseISODate(date).getDay();
    if (!KUWAIT_WEEKEND.includes(dow)) return date;
    const forward = addDaysISO(date, dow === 5 ? 2 : 1);
    if (forward <= this.today && forward.slice(0, 7) === date.slice(0, 7)) return forward;
    return addDaysISO(date, dow === 5 ? -1 : -2);
  }

  /** Day `day` of a month, moved off the weekend. */
  workdayOf(offset: number, day: number): ISODate {
    return this.workday(this.day(offset, day));
  }

  ago(days: number): ISODate {
    return addDaysISO(this.today, -days);
  }

  ahead(days: number): ISODate {
    return addDaysISO(this.today, days);
  }

  /** The year of a date as a number. */
  static year(date: ISODate): number {
    return Number(date.slice(0, 4));
  }
}

interface Step {
  date: ISODate;
  order: number;
  label: string;
  run: () => Promise<void>;
}

/**
 * The demo's year as a list of dated steps, played in date order (steps of
 * the same day in the order they were planned). Steps after today are left
 * out, so a story planned month by month simply stops at today.
 */
export class Timeline {
  private steps: Step[] = [];

  constructor(private readonly calendar: Calendar) {}

  at(date: ISODate, label: string, run: () => Promise<void>): void {
    if (date > this.calendar.today) return;
    this.steps.push({ date, order: this.steps.length, label, run });
  }

  async play(onStep: (date: ISODate) => void): Promise<void> {
    const ordered = [...this.steps].sort(
      (a, b) => a.date.localeCompare(b.date) || a.order - b.order,
    );
    for (const step of ordered) {
      onStep(step.date);
      try {
        await step.run();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Demo step "${step.label}" on ${step.date} failed: ${reason}`, {
          cause: error,
        });
      }
    }
  }
}
