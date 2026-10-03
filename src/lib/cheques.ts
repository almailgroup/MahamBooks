import type { ChequeDetails, ChequeStatus, ISODate, Payment } from '@/db/types';
import { KUWAIT_BANKS } from './kuwait';
import { addDaysISO, daysBetween } from './dates';
import { dec, toMinor } from './money';

/**
 * The cheque register: post-dated cheques received from customers and
 * issued to vendors, by date. A cheque is payable on sight (Commercial Code
 * art. 532), so a post-dated cheque can be presented early; the register
 * shows which ones are due, overdue to deposit or returned.
 */

/** A bank's name from its code (KUWAIT_BANKS), or the text as entered. */
export function bankName(value: string, language: 'en' | 'ar'): string {
  const text = value.trim();
  const bank = KUWAIT_BANKS.find((b) => b.code === text.toUpperCase());
  return bank ? bank.name[language] : text;
}

/** Still waiting for the money: in hand (or issued) or deposited. */
export function isOpenCheque(status: ChequeStatus): boolean {
  return status === 'held' || status === 'deposited';
}

/** Days from today to the cheque date: positive when it is still ahead, negative when past. */
export function daysToMaturity(date: ISODate, todayIso: ISODate): number {
  return daysBetween(todayIso, date);
}

export type ChequeFilter = 'open' | 'week' | 'overdue' | 'returned' | 'all';

/** Last day of the "due this week" window (seven days including today). */
export const weekEnd = (todayIso: ISODate) => addDaysISO(todayIso, 6);
/** Last day of the "due this month" window (thirty days including today). */
export const monthEnd = (todayIso: ISODate) => addDaysISO(todayIso, 29);

export function matchesChequeFilter(
  cheque: Pick<ChequeDetails, 'date' | 'status'>,
  filter: ChequeFilter,
  todayIso: ISODate,
): boolean {
  switch (filter) {
    case 'open':
      return isOpenCheque(cheque.status);
    case 'week':
      return (
        isOpenCheque(cheque.status) && cheque.date >= todayIso && cheque.date <= weekEnd(todayIso)
      );
    case 'overdue':
      // Due but still in hand: not deposited yet (received) or not presented (issued).
      return cheque.status === 'held' && cheque.date < todayIso;
    case 'returned':
      return cheque.status === 'returned';
    case 'all':
      return true;
  }
}

/** A payment's amount in company-currency minor units. */
export function paymentMinor(
  payment: Pick<Payment, 'amount' | 'currency' | 'exchangeRate'>,
  companyCurrency: string,
  precision: number,
): number {
  const rate =
    payment.currency === companyCurrency
      ? 1
      : payment.exchangeRate && payment.exchangeRate > 0
        ? payment.exchangeRate
        : 1;
  return toMinor(dec(payment.amount).times(dec(rate)), precision);
}

export interface MaturityBucket {
  count: number;
  /** Company-currency minor units. */
  amount: number;
}

export interface Maturity {
  /** Dated before today and still in hand (or not presented). */
  overdue: MaturityBucket;
  today: MaturityBucket;
  /** Today and the next six days. */
  week: MaturityBucket;
  /** Today and the next twenty-nine days. */
  month: MaturityBucket;
}

/** Totals of the open cheques that fall due today, this week and this month. */
export function maturity(
  cheques: { date: ISODate; status: ChequeStatus; amount: number }[],
  todayIso: ISODate,
): Maturity {
  const empty = (): MaturityBucket => ({ count: 0, amount: 0 });
  const result: Maturity = { overdue: empty(), today: empty(), week: empty(), month: empty() };
  const add = (bucket: MaturityBucket, amount: number) => {
    bucket.count += 1;
    bucket.amount += amount;
  };
  const week = weekEnd(todayIso);
  const month = monthEnd(todayIso);
  for (const c of cheques) {
    if (!isOpenCheque(c.status)) continue;
    if (c.status === 'held' && c.date < todayIso) add(result.overdue, c.amount);
    if (c.date === todayIso) add(result.today, c.amount);
    if (c.date >= todayIso && c.date <= week) add(result.week, c.amount);
    if (c.date >= todayIso && c.date <= month) add(result.month, c.amount);
  }
  return result;
}

/** Payments with a tracked cheque, received (`in`) or issued (`out`). */
export function chequePayments(
  payments: Payment[],
  direction: 'in' | 'out',
): (Payment & { cheque: ChequeDetails })[] {
  return payments.filter(
    (p): p is Payment & { cheque: ChequeDetails } =>
      p.method === 'cheque' &&
      Boolean(p.cheque) &&
      (p.direction === 'out') === (direction === 'out'),
  );
}

/** Open cheques soonest first; the rest newest first. */
export function sortCheques<T extends { cheque: Pick<ChequeDetails, 'date'> }>(
  rows: T[],
  filter: ChequeFilter,
): T[] {
  const ascending = filter === 'open' || filter === 'week' || filter === 'overdue';
  return [...rows].sort((a, b) =>
    ascending
      ? a.cheque.date.localeCompare(b.cheque.date)
      : b.cheque.date.localeCompare(a.cheque.date),
  );
}
