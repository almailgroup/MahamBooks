import type { Client, InvoiceDocument, ISODate, Payment } from '@/db/types';
import { msg } from '@/i18n';
import { computeDocument } from './document-calc';
import { daysBetween, toISODate, parseISODate } from './dates';
import { round, currencyPrecision, dec, toMinor } from './money';

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

export type RangePreset =
  'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'this-year' | 'last-year' | 'all';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'this-month', label: msg('This month') },
  { value: 'last-month', label: msg('Last month') },
  { value: 'this-quarter', label: msg('This quarter') },
  { value: 'last-quarter', label: msg('Last quarter') },
  { value: 'this-year', label: msg('This year') },
  { value: 'last-year', label: msg('Last year') },
  { value: 'all', label: msg('All time') },
];

export function presetRange(preset: RangePreset, todayIso: ISODate): DateRange {
  const t = parseISODate(todayIso);
  const y = t.getFullYear();
  const m = t.getMonth();
  const q = Math.floor(m / 3);
  const span = (start: Date, end: Date) => ({ from: toISODate(start), to: toISODate(end) });
  switch (preset) {
    case 'this-month':
      return span(new Date(y, m, 1), new Date(y, m + 1, 0));
    case 'last-month':
      return span(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'this-quarter':
      return span(new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0));
    case 'last-quarter':
      return span(new Date(y, q * 3 - 3, 1), new Date(y, q * 3, 0));
    case 'this-year':
      return span(new Date(y, 0, 1), new Date(y, 11, 31));
    case 'last-year':
      return span(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    case 'all':
      return { from: '0000-01-01', to: '9999-12-31' };
  }
}

const inRange = (date: ISODate, range: DateRange) => date >= range.from && date <= range.to;
const counts = (d: InvoiceDocument) => d.status !== 'draft' && d.status !== 'void';

/* -------------------------------------------------------------------------- */
/* Aging                                                                      */
/* -------------------------------------------------------------------------- */

export const AGING_BUCKETS = [
  msg('Current'),
  msg('1–30 days'),
  msg('31–60 days'),
  msg('61–90 days'),
  msg('90+ days'),
] as const;

export interface AgingRow {
  clientId: string;
  clientName: string;
  buckets: number[];
  total: number;
}

/** Unpaid invoices (receivables) or bills (payables) by how late they are. */
export function agingReport(
  docs: InvoiceDocument[],
  clients: Client[],
  currency: string,
  asOf: ISODate,
  type: 'invoice' | 'bill' = 'invoice',
): { rows: AgingRow[]; totals: number[]; total: number } {
  const p = currencyPrecision(currency);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const byClient = new Map<string, number[]>();
  for (const d of docs) {
    if (d.type !== type || d.currency !== currency) continue;
    if (d.status !== 'sent' && d.status !== 'partial') continue;
    if (d.totals.balance <= 0) continue;
    const late = d.dueDate ? daysBetween(d.dueDate, asOf) : 0;
    const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    const row = byClient.get(d.clientId) ?? [0, 0, 0, 0, 0];
    row[bucket] = round(row[bucket] + d.totals.balance, p);
    byClient.set(d.clientId, row);
  }
  const rows = [...byClient.entries()]
    .map(([clientId, buckets]) => ({
      clientId,
      clientName: names.get(clientId) ?? '—',
      buckets,
      total: round(
        buckets.reduce((s, v) => s + v, 0),
        p,
      ),
    }))
    .sort((a, b) => b.total - a.total);
  const totals = [0, 1, 2, 3, 4].map((i) =>
    round(
      rows.reduce((s, r) => s + r.buckets[i], 0),
      p,
    ),
  );
  return {
    rows,
    totals,
    total: round(
      totals.reduce((s, v) => s + v, 0),
      p,
    ),
  };
}

/**
 * Aging at a past date (for the auditor pack), in the company currency at
 * each document's own rate: what was still owed on invoices or bills issued
 * by `asOf`, after payments and credits applied by then. Minor units.
 */
export function agingAt(
  docs: InvoiceDocument[],
  payments: Payment[],
  clients: Client[],
  asOf: ISODate,
  type: 'invoice' | 'bill',
  companyCurrency: string,
): { rows: AgingRow[]; totals: number[]; total: number } {
  const p = currencyPrecision(companyCurrency);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const applied = new Map<string, number>();
  for (const payment of payments) {
    if (payment.date > asOf || (payment as Payment & { voided?: boolean }).voided) continue;
    for (const a of payment.allocations) {
      applied.set(a.documentId, (applied.get(a.documentId) ?? 0) + a.amount);
    }
  }
  const byClient = new Map<string, number[]>();
  for (const d of docs) {
    if (d.type !== type || !counts(d) || d.issueDate > asOf) continue;
    const owed = dec(d.totals.total).minus(dec(applied.get(d.id) ?? 0));
    if (owed.lte(0)) continue;
    const rate = d.currency === companyCurrency ? 1 : d.exchangeRate || 1;
    const minor = toMinor(owed.times(rate), p);
    const late = d.dueDate ? daysBetween(d.dueDate, asOf) : 0;
    const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    const row = byClient.get(d.clientId) ?? [0, 0, 0, 0, 0];
    row[bucket] += minor;
    byClient.set(d.clientId, row);
  }
  const rows = [...byClient.entries()]
    .map(([clientId, buckets]) => ({
      clientId,
      clientName: names.get(clientId) ?? '—',
      buckets,
      total: buckets.reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.total - a.total);
  const totals = [0, 1, 2, 3, 4].map((i) => rows.reduce((s, r) => s + r.buckets[i], 0));
  return { rows, totals, total: totals.reduce((s, v) => s + v, 0) };
}

/* -------------------------------------------------------------------------- */
/* Tax summary                                                                */
/* -------------------------------------------------------------------------- */

export interface TaxSummaryRow {
  key: string;
  name: string;
  rate: number;
  base: number;
  tax: number;
}

/**
 * Tax collected on invoices issued in the range, minus tax on credit notes.
 * Invoices are counted by issue date (accrual basis).
 */
export function taxReport(
  docs: InvoiceDocument[],
  clients: Client[],
  currency: string,
  range: DateRange,
): { rows: TaxSummaryRow[]; net: number; tax: number; gross: number; documents: number } {
  const p = currencyPrecision(currency);
  const exempt = new Map(clients.map((c) => [c.id, c.taxExempt]));
  const map = new Map<string, TaxSummaryRow>();
  let net = 0;
  let tax = 0;
  let gross = 0;
  let documents = 0;
  for (const d of docs) {
    if ((d.type !== 'invoice' && d.type !== 'credit') || d.currency !== currency) continue;
    if (!counts(d) || !inRange(d.issueDate, range)) continue;
    const sign = d.type === 'credit' ? -1 : 1;
    const result = computeDocument(d, { taxExempt: exempt.get(d.clientId) });
    documents += 1;
    net += sign * result.netTotal;
    tax += sign * result.taxTotal;
    gross += sign * result.total;
    for (const t of result.taxes) {
      // Reverse charge is the customer's to pay, not collected tax.
      if (t.kind === 'reverse_charge') continue;
      const row = map.get(t.key) ?? { key: t.key, name: t.name, rate: t.rate, base: 0, tax: 0 };
      row.base = round(row.base + sign * t.base, p);
      row.tax = round(row.tax + sign * t.amount, p);
      map.set(t.key, row);
    }
  }
  return {
    rows: [...map.values()].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name)),
    net: round(net, p),
    tax: round(tax, p),
    gross: round(gross, p),
    documents,
  };
}

/* -------------------------------------------------------------------------- */
/* Sales by client                                                            */
/* -------------------------------------------------------------------------- */

export interface ClientSalesRow {
  clientId: string;
  clientName: string;
  invoices: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

/** Invoices per client, or bills per vendor (`type: 'bill'`). */
export function salesByClient(
  docs: InvoiceDocument[],
  clients: Client[],
  currency: string,
  range: DateRange,
  type: 'invoice' | 'bill' = 'invoice',
): { rows: ClientSalesRow[]; totals: Omit<ClientSalesRow, 'clientId' | 'clientName'> } {
  const p = currencyPrecision(currency);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const map = new Map<string, ClientSalesRow>();
  for (const d of docs) {
    if (d.type !== type || d.currency !== currency || !counts(d) || !inRange(d.issueDate, range))
      continue;
    const row = map.get(d.clientId) ?? {
      clientId: d.clientId,
      clientName: names.get(d.clientId) ?? '—',
      invoices: 0,
      invoiced: 0,
      paid: 0,
      outstanding: 0,
    };
    row.invoices += 1;
    row.invoiced = round(row.invoiced + d.totals.total, p);
    row.paid = round(row.paid + d.totals.paid, p);
    row.outstanding = round(row.outstanding + Math.max(0, d.totals.balance), p);
    map.set(d.clientId, row);
  }
  const rows = [...map.values()].sort((a, b) => b.invoiced - a.invoiced);
  return {
    rows,
    totals: {
      invoices: rows.reduce((s, r) => s + r.invoices, 0),
      invoiced: round(
        rows.reduce((s, r) => s + r.invoiced, 0),
        p,
      ),
      paid: round(
        rows.reduce((s, r) => s + r.paid, 0),
        p,
      ),
      outstanding: round(
        rows.reduce((s, r) => s + r.outstanding, 0),
        p,
      ),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

/** Payments received (`in`) or made (`out`) in a period, by method. */
export function paymentsReport(
  payments: Payment[],
  currency: string,
  range: DateRange,
  direction: 'in' | 'out' = 'in',
) {
  const p = currencyPrecision(currency);
  const list = payments
    .filter(
      (x) =>
        (x.direction === 'out') === (direction === 'out') &&
        !x.voided &&
        x.currency === currency &&
        x.method !== 'credit_note' &&
        inRange(x.date, range),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const byMethod = new Map<string, number>();
  for (const x of list) byMethod.set(x.method, round((byMethod.get(x.method) ?? 0) + x.amount, p));
  return {
    list,
    byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]),
    total: round(
      list.reduce((s, x) => s + x.amount, 0),
      p,
    ),
  };
}
