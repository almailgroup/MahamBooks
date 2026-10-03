import type { Company, CompanyHoliday, ISODate } from '@/db/types';
import { KUWAIT_WEEKEND, kuwaitHolidays } from '@/lib/kuwait';
import { parseISODate } from '@/lib/dates';

/**
 * Public holidays as the company observes them. The official list is an
 * estimate: Islamic holidays follow the Umm al-Qura calendar and can move by
 * a day after the moon sighting, and the government may add bridge days. A
 * company changes a year's list in Settings → Company profile; years it has
 * not changed keep the estimates.
 */

const byDate = (a: CompanyHoliday, b: CompanyHoliday) =>
  a.date.localeCompare(b.date) || a.name.localeCompare(b.name);

/** The official estimates for a Gregorian year. */
export function officialHolidays(year: number): CompanyHoliday[] {
  return kuwaitHolidays(year).map((h) => ({ date: h.date, name: h.name.en, nameAr: h.name.ar }));
}

const inYear = (year: number) => (h: CompanyHoliday) => h.date.startsWith(`${year}-`);

/** Whether the company changed the holidays of a year. */
export function hasOwnHolidays(company: Pick<Company, 'holidays'>, year: number): boolean {
  return (company.holidays ?? []).some(inYear(year));
}

/** The company's holidays in a year: its own list when it changed it, else the estimates. */
export function companyHolidays(
  company: Pick<Company, 'holidays'>,
  year: number,
): CompanyHoliday[] {
  const own = (company.holidays ?? []).filter(inYear(year));
  return (own.length ? own : officialHolidays(year)).sort(byDate);
}

/** The stored overrides with one year's list replaced (an empty list restores the estimates). */
export function replaceYear(
  holidays: CompanyHoliday[] | undefined,
  year: number,
  list: CompanyHoliday[],
): CompanyHoliday[] | undefined {
  const others = (holidays ?? []).filter((h) => !inYear(year)(h));
  const next = [...others, ...list.filter(inYear(year))].sort(byDate);
  return next.length ? next : undefined;
}

/** True on the Kuwaiti weekend (Friday and Saturday) and on the company's public holidays. */
export function isDayOff(company: Pick<Company, 'holidays'>, date: ISODate): boolean {
  if (KUWAIT_WEEKEND.includes(parseISODate(date).getDay())) return true;
  const year = Number(date.slice(0, 4));
  return companyHolidays(company, year).some((h) => h.date === date);
}
