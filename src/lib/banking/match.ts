import type { BankMatch, ID, ISODate } from '@/db/types';
import type { LedgerLabel, LedgerLine } from '@/lib/accounting/ledger';
import { daysBetween } from '@/lib/dates';

/**
 * Matching statement lines to the books. What the books hold for a bank
 * account is read from the ledger, one entry per payment, expense or
 * journal, so anything that moves money there can be matched.
 */

export interface BookEntry extends BankMatch {
  date: ISODate;
  /** Movement on the account, minor units; positive is money in. */
  amount: number;
  number: string;
  /** In English; show it with `lineDescription`. */
  description: string;
  label?: LedgerLabel;
  contactId: ID | null;
}

export const matchKey = (m: BankMatch) => `${m.source}:${m.id}`;

/** What the books show for one bank, cash or card account. */
export function bookEntries(lines: LedgerLine[], accountId: ID): BookEntry[] {
  const entries = new Map<string, BookEntry>();
  for (const l of lines) {
    if (l.accountId !== accountId) continue;
    if (l.source !== 'payment' && l.source !== 'expense' && l.source !== 'journal') continue;
    const key = `${l.source}:${l.sourceId}`;
    const entry = entries.get(key);
    if (entry) entry.amount += l.amount;
    else {
      entries.set(key, {
        source: l.source,
        id: l.sourceId,
        date: l.date,
        amount: l.amount,
        number: l.number,
        description: l.description,
        ...(l.label ? { label: l.label } : {}),
        contactId: l.contactId,
      });
    }
  }
  return [...entries.values()].filter((e) => e.amount !== 0);
}

export interface MatchCandidate {
  entry: BookEntry;
  /** Higher is a better match. */
  score: number;
}

// Words that appear in most business names and say nothing about who paid.
const COMMON_WORDS = new Set([
  'company',
  'trading',
  'general',
  'contracting',
  'w.l.l',
  'wll',
  'the',
  'and',
  'شركه',
  'مؤسسه',
  'للتجاره',
  'التجاره',
  'العامه',
  'والمقاولات',
  'المقاولات',
]);

/** Folds Arabic spelling variants (أ/إ/آ → ا, ى → ي, ة → ه) and drops diacritics. */
function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

const words = (text: string) =>
  new Set(
    normalizeArabic(text.toLowerCase())
      .split(/[^\p{L}\p{N}.-]+/u)
      .filter((w) => w.length > 2 && !COMMON_WORDS.has(w)),
  );

/**
 * Book entries that could be this statement line: the same amount, a date
 * close by, preferring a number or name mentioned in the description.
 */
export function suggestMatches(
  line: { date: ISODate; amount: number; description: string; reference: string },
  entries: BookEntry[],
  taken: Set<string>,
  names: Map<ID, string> = new Map(),
  maxDays = 14,
): MatchCandidate[] {
  const text = `${line.description} ${line.reference}`.toLowerCase();
  const textWords = words(text);
  return entries
    .filter((e) => e.amount === line.amount && !taken.has(matchKey(e)))
    .map((entry) => {
      const days = Math.abs(daysBetween(entry.date, line.date));
      let score = 100 - days * 4;
      if (entry.number && text.includes(entry.number.toLowerCase())) score += 50;
      const name = entry.contactId ? names.get(entry.contactId) : undefined;
      if (name && [...words(name)].some((w) => textWords.has(w))) score += 25;
      return { entry, score, days };
    })
    .filter((c) => c.days <= maxDays)
    .sort((a, b) => b.score - a.score)
    .map(({ entry, score }) => ({ entry, score }));
}

export interface Reconciliation {
  /** Last balance printed on the statement, with its date. */
  statementBalance: number | null;
  statementDate: ISODate | null;
  /** The account in the books at that date (minor units). */
  bookBalance: number;
  difference: number | null;
  unmatched: number;
  total: number;
}

/**
 * How far the books agree with the bank: every line matched, and the book
 * balance equal to the statement balance on the last statement date.
 */
export function reconciliation(
  transactions: {
    date: ISODate;
    position: number;
    balance: number | null;
    match: BankMatch | null;
    ignored: boolean;
  }[],
  lines: LedgerLine[],
  accountId: ID,
  toMinorUnits: (major: number) => number,
): Reconciliation {
  const ordered = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.position - b.position,
  );
  const last = [...ordered].reverse().find((t) => t.balance !== null);
  const statementDate = ordered.length ? ordered[ordered.length - 1].date : null;
  const asOf = last?.date ?? statementDate;
  const bookBalance = lines
    .filter((l) => l.accountId === accountId && (!asOf || l.date <= asOf))
    .reduce((s, l) => s + l.amount, 0);
  const statementBalance = last ? toMinorUnits(last.balance!) : null;
  return {
    statementBalance,
    statementDate: last?.date ?? null,
    bookBalance,
    difference: statementBalance === null ? null : statementBalance - bookBalance,
    unmatched: transactions.filter((t) => !t.match && !t.ignored).length,
    total: transactions.length,
  };
}
