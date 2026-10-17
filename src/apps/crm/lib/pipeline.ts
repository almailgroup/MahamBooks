import type { Client, ID, InvoiceDocument, ISODate } from '@/db/types';
import { isCustomer } from '@/db/purchases';
import { currencyPrecision, dec, round, sum } from '@/lib/money';
import { addDaysISO, daysBetween, toISODate } from '@/lib/dates';

/**
 * Maham CRM's first version reads the sales the company already records:
 * quotes are its deals, customers its accounts. Nothing new is stored, so
 * the pipeline is the same on every device and for everyone in the team.
 */

/** Where a quote stands. */
export type Stage = 'draft' | 'open' | 'won' | 'lost';

export const STAGES: readonly Stage[] = ['draft', 'open', 'won', 'lost'];

/** A quote sent this many days ago without an answer is due a follow-up. */
export const FOLLOW_UP_DAYS = 7;

/** Won and lost quotes of this many days count in the win rate. */
export const WIN_RATE_DAYS = 365;

type Quote = Pick<
  InvoiceDocument,
  | 'id'
  | 'type'
  | 'status'
  | 'clientId'
  | 'number'
  | 'issueDate'
  | 'dueDate'
  | 'currency'
  | 'exchangeRate'
  | 'totals'
  | 'sentAt'
  | 'archived'
  | 'updatedAt'
>;

export function stageOf(quote: Pick<Quote, 'status'>): Stage {
  switch (quote.status) {
    case 'draft':
      return 'draft';
    case 'sent':
      return 'open';
    case 'accepted':
    case 'invoiced':
    case 'converted':
      return 'won';
    default:
      return 'lost';
  }
}

/** The quotes of the pipeline: not archived. */
export function pipelineQuotes<T extends Quote>(docs: readonly T[]): T[] {
  return docs.filter((d) => d.type === 'quote' && !d.archived);
}

/**
 * A quote's total in the company's currency, at its exchange rate; null for
 * a quote in another currency without one (quotes don't post to the books,
 * so they rarely have a rate). Those are counted apart, never at 1.
 */
export function baseValue(
  quote: Pick<Quote, 'totals' | 'currency' | 'exchangeRate'>,
  base: string,
): number | null {
  if (quote.currency === base) return quote.totals.total;
  if (!quote.exchangeRate || !(quote.exchangeRate > 0)) return null;
  return round(dec(quote.totals.total).times(quote.exchangeRate), currencyPrecision(base));
}

/** The values of the quotes that have one in the company's currency. */
function baseValues(
  quotes: readonly Pick<Quote, 'totals' | 'currency' | 'exchangeRate'>[],
  base: string,
) {
  return quotes.flatMap((q) => {
    const value = baseValue(q, base);
    return value === null ? [] : [value];
  });
}

/** The day a quote went out, on this device's calendar: when it was sent, else its date. */
export function sentOn(quote: Pick<Quote, 'sentAt' | 'issueDate'>): ISODate {
  const sent = quote.sentAt ? new Date(quote.sentAt) : null;
  return sent && !Number.isNaN(sent.getTime()) ? toISODate(sent) : quote.issueDate;
}

export interface StageSummary {
  stage: Stage;
  count: number;
  /** In the company's currency. */
  value: number;
  /** Quotes in another currency without an exchange rate, left out of `value`. */
  foreign: number;
}

export interface PipelineSummary {
  stages: StageSummary[];
  /** Won out of won and lost in the last year, 0–100; null before any is decided. */
  winRate: number | null;
}

export function summarize(quotes: readonly Quote[], base: string, today: ISODate): PipelineSummary {
  const precision = currencyPrecision(base);
  const stages = STAGES.map((stage): StageSummary => {
    const list = quotes.filter((q) => stageOf(q) === stage);
    return {
      stage,
      count: list.length,
      value: round(sum(baseValues(list, base)), precision),
      foreign: list.filter((q) => baseValue(q, base) === null).length,
    };
  });
  const since = addDaysISO(today, -WIN_RATE_DAYS);
  const decided = quotes.filter(
    (q) => (stageOf(q) === 'won' || stageOf(q) === 'lost') && q.updatedAt.slice(0, 10) >= since,
  );
  const won = decided.filter((q) => stageOf(q) === 'won').length;
  return {
    stages,
    winRate: decided.length ? Math.round((won / decided.length) * 100) : null,
  };
}

export interface FollowUp<T extends Quote = Quote> {
  quote: T;
  /** Days since it was sent. */
  days: number;
  /** Past its valid-until date. */
  expired: boolean;
}

/**
 * Sent quotes waiting for an answer for a week or more, or past their
 * valid-until date: the oldest first.
 */
export function followUps<T extends Quote>(quotes: readonly T[], today: ISODate): FollowUp<T>[] {
  return quotes
    .filter((q) => stageOf(q) === 'open')
    .map((quote) => ({
      quote,
      days: Math.max(0, daysBetween(sentOn(quote), today)),
      expired: Boolean(quote.dueDate && quote.dueDate < today),
    }))
    .filter((f) => f.expired || f.days >= FOLLOW_UP_DAYS)
    .sort((a, b) => b.days - a.days || a.quote.number.localeCompare(b.quote.number));
}

/**
 * quoted: a quote waits for their answer; contacted: quotes went to them
 * before, none is open now; new: nothing has been sent to them.
 */
export type ProspectKind = 'quoted' | 'contacted' | 'new';

const KIND_ORDER: Record<ProspectKind, number> = { quoted: 0, contacted: 1, new: 2 };

export interface Prospect<C extends Pick<Client, 'id'> = Client> {
  client: C;
  kind: ProspectKind;
  /** Open quotes for them. */
  openQuotes: number;
  /** Their open quotes' value in the company's currency (see baseValue). */
  openValue: number;
  /** Their open quotes in another currency without a rate, left out of `openValue`. */
  foreign: number;
}

/**
 * Customers who have not bought yet: quoted, contacted or new (see
 * ProspectKind). Customers with an issued invoice are accounts, not
 * prospects. Quoted ones first, then contacted, then the newest.
 */
export function prospects<C extends Pick<Client, 'id' | 'isCustomer' | 'archived' | 'createdAt'>>(
  clients: readonly C[],
  docs: readonly Pick<
    InvoiceDocument,
    'type' | 'status' | 'clientId' | 'archived' | 'totals' | 'currency' | 'exchangeRate'
  >[],
  base: string,
): Prospect<C>[] {
  const bought = new Set<ID>();
  const contacted = new Set<ID>();
  const quoted = new Map<ID, (typeof docs)[number][]>();
  for (const d of docs) {
    if (d.type === 'invoice' && d.status !== 'draft' && d.status !== 'void') bought.add(d.clientId);
    if (d.type === 'quote' && d.status !== 'draft') contacted.add(d.clientId);
    if (d.type === 'quote' && !d.archived && stageOf(d) === 'open') {
      quoted.set(d.clientId, [...(quoted.get(d.clientId) ?? []), d]);
    }
  }
  const precision = currencyPrecision(base);
  return clients
    .filter((c) => isCustomer(c) && !c.archived && !bought.has(c.id))
    .map((client): Prospect<C> => {
      const open = quoted.get(client.id);
      return {
        client,
        kind: open ? 'quoted' : contacted.has(client.id) ? 'contacted' : 'new',
        openQuotes: open?.length ?? 0,
        openValue: round(sum(baseValues(open ?? [], base)), precision),
        foreign: (open ?? []).filter((q) => baseValue(q, base) === null).length,
      };
    })
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        b.client.createdAt.localeCompare(a.client.createdAt),
    );
}
