import type { CounterReset, ID, ISODate, NumberedEntity, NumberingRule } from '@/db/types';

export const NUMBER_PLACEHOLDERS = [
  { token: '{counter}', description: 'Sequential counter, zero padded (required)' },
  { token: '{year}', description: 'Year of the document date, e.g. 2026' },
  { token: '{yy}', description: 'Two-digit year, e.g. 26' },
  { token: '{month}', description: 'Two-digit month, e.g. 09' },
  { token: '{day}', description: 'Two-digit day, e.g. 05' },
  { token: '{client}', description: "The client's number" },
] as const;

export function periodKey(reset: CounterReset, date: ISODate): string {
  if (reset === 'yearly') return date.slice(0, 4);
  if (reset === 'monthly') return date.slice(0, 7);
  return '';
}

/** Counter to use for a document dated `date`, honouring yearly/monthly resets. */
export function currentCounter(rule: NumberingRule, date: ISODate): number {
  const key = periodKey(rule.reset, date);
  if (rule.reset !== 'never' && rule.period && rule.period !== key) return 1;
  return Math.max(1, Math.trunc(rule.next) || 1);
}

export function formatNumber(
  rule: Pick<NumberingRule, 'pattern' | 'padding'>,
  counter: number,
  date: ISODate,
  clientNumber = '',
): string {
  const padded = String(counter).padStart(Math.max(0, Math.min(12, rule.padding)), '0');
  let pattern = rule.pattern.trim() || '{counter}';
  if (!/\{counter\}/i.test(pattern)) pattern = `${pattern}{counter}`;
  const [year = '', month = '', day = ''] = date.split('-');
  const values: Record<string, string> = {
    counter: padded,
    year,
    yy: year.slice(-2),
    month,
    day,
    client: clientNumber,
  };
  return pattern.replace(/\{(\w+)\}/g, (match, token: string) => {
    const value = values[token.toLowerCase()];
    return value === undefined ? match : value;
  });
}

/**
 * Whether `text` is a number `rule` writes, for any counter and date (letters
 * in any case): a code given by the app rather than typed in another way.
 */
export function writtenBy(rule: Pick<NumberingRule, 'pattern' | 'padding'>, text: string): boolean {
  let pattern = rule.pattern.trim() || '{counter}';
  if (!/\{counter\}/i.test(pattern)) pattern = `${pattern}{counter}`;
  const width = Math.max(1, Math.min(12, rule.padding));
  const tokens: Record<string, string> = {
    counter: `\\d{${width},}`,
    year: '\\d{4}',
    yy: '\\d{2}',
    month: '\\d{2}',
    day: '\\d{2}',
    client: '.*',
  };
  const source = pattern
    .split(/(\{\w+\})/)
    .map((part) => {
      const token = /^\{(\w+)\}$/.exec(part)?.[1]?.toLowerCase();
      if (token && tokens[token]) return tokens[token];
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`, 'i').test(text.trim());
}

/**
 * Picks the next free number for a document dated `date`. Numbers already in
 * use (e.g. typed in manually) are skipped. Returns the number and the rule
 * to store back on the company.
 */
export function allocateNumber(
  rule: NumberingRule,
  date: ISODate,
  isTaken: (candidate: string) => boolean,
  clientNumber = '',
): { number: string; rule: NumberingRule } {
  let counter = currentCounter(rule, date);
  let number = formatNumber(rule, counter, date, clientNumber);
  for (let guard = 0; isTaken(number) && guard < 100000; guard++) {
    counter += 1;
    number = formatNumber(rule, counter, date, clientNumber);
  }
  return {
    number,
    rule: { ...rule, next: counter + 1, period: periodKey(rule.reset, date) },
  };
}

/* -------------------------------------------------------------------------- */
/* Numbers taken on the server                                                */
/* -------------------------------------------------------------------------- */

/** A counter taken on the server for one new number (see cloud/reserve.ts). */
export interface ReservedCounter {
  counter: number;
  /** Period key the counter belongs to. */
  period: string;
}

export interface CounterRequest {
  companyId: ID;
  kind: NumberedEntity;
  date: ISODate;
  /** The counter this device would use itself; the one taken is never lower. */
  min: number;
}

/** Takes the next counter on the server, or null to number on this device. */
export type CounterReserver = (request: CounterRequest) => Promise<ReservedCounter | null>;

let reserver: CounterReserver | null = null;

/**
 * Set while someone is signed in: devices that share a company take new
 * numbers from its counter in the cloud when they can, so two of them never
 * give the same number. Offline (or for a company kept on this device only)
 * numbers are allocated here, as always.
 */
export function setCounterReserver(next: CounterReserver | null): void {
  reserver = next;
}

/** Whether new numbers may come from the server (someone is signed in). */
export function canReserveCounters(): boolean {
  return reserver !== null;
}

/** A counter taken on the server for this number, or null to number on this device. */
export async function reserveCounter(request: CounterRequest): Promise<ReservedCounter | null> {
  if (!reserver) return null;
  try {
    return await reserver(request);
  } catch {
    return null;
  }
}

/**
 * allocateNumber, starting from a counter taken on the server when there is
 * one for the document's period (never below this device's own counter).
 */
export function allocateFrom(
  rule: NumberingRule,
  date: ISODate,
  isTaken: (candidate: string) => boolean,
  clientNumber: string,
  reserved: ReservedCounter | null,
): { number: string; rule: NumberingRule } {
  if (!reserved || reserved.period !== periodKey(rule.reset, date)) {
    return allocateNumber(rule, date, isTaken, clientNumber);
  }
  const next = Math.max(reserved.counter, currentCounter(rule, date));
  return allocateNumber({ ...rule, next, period: reserved.period }, date, isTaken, clientNumber);
}

export function previewNumber(rule: NumberingRule, date: ISODate, clientNumber = 'C-0001'): string {
  return formatNumber(rule, currentCounter(rule, date), date, clientNumber);
}
