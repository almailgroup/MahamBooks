import { amountQuery, compactSearch, normalizeSearch } from './normalize';

export type SearchKind =
  | 'page'
  | 'action'
  | 'client'
  | 'vendor'
  | 'item'
  | 'employee'
  /** An employee of another company on this device (the search across companies). */
  | 'elsewhere'
  | 'document'
  /** A paper of the documents register, stored or on an employee's record (the document finder). */
  | 'paper'
  /** A stored file, opened in a new tab (the document finder). */
  | 'file'
  | 'recent';

/** One thing the command palette can find. Text fields are already normalised. */
export interface SearchEntry {
  /** Unique, e.g. "client:<id>". */
  key: string;
  kind: SearchKind;
  /** Shown in the list, in the interface language. */
  title: string;
  subtitle?: string;
  /** Amount shown at the end of the row. */
  amount?: string;
  to: string;
  /** The company `to` is a page of, when it is not the open one. */
  companyId?: string;
  /** Names in every language (normalised): the best matches. */
  names: string[];
  /** Numbers, emails, phones, the customer on a document (normalised). */
  terms: string[];
  /** Numbers without separators, for "inv20260001". */
  compact: string[];
  /** Amounts as plain decimals ("1250.750"). */
  amounts: string[];
  /** Small tie-breaker: recent documents and common pages come first. */
  boost: number;
}

export interface EntryInput {
  key: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  amount?: string;
  to: string;
  companyId?: string;
  names: (string | undefined | null)[];
  terms?: (string | undefined | null)[];
  numbers?: (string | undefined | null)[];
  amounts?: number[];
  precision?: number;
  boost?: number;
}

/** Normalises an entry's text once, so each keystroke only compares strings. */
export function makeEntry(input: EntryInput): SearchEntry {
  const clean = (list: (string | undefined | null)[] | undefined) =>
    [
      ...new Set((list ?? []).filter((s): s is string => Boolean(s?.trim())).map(normalizeSearch)),
    ].filter(Boolean);
  const numbers = (input.numbers ?? []).filter((s): s is string => Boolean(s?.trim()));
  return {
    key: input.key,
    kind: input.kind,
    title: input.title,
    subtitle: input.subtitle,
    amount: input.amount,
    to: input.to,
    ...(input.companyId ? { companyId: input.companyId } : {}),
    names: clean(input.names),
    terms: clean([...(input.terms ?? []), ...numbers]),
    compact: [...new Set(numbers.map(compactSearch).filter(Boolean))],
    amounts: (input.amounts ?? []).map((a) => a.toFixed(input.precision ?? 3)),
    boost: input.boost ?? 0,
  };
}

interface Query {
  text: string;
  tokens: string[];
  compact: string;
  amount: string | null;
}

export function prepareQuery(raw: string): Query {
  const text = normalizeSearch(raw);
  return {
    text,
    tokens: text.split(' ').filter(Boolean),
    compact: compactSearch(raw),
    amount: amountQuery(raw),
  };
}

/** 4 exact, 3 starts with, 2 a word starts with, 1 contains, 0 no match. */
function quality(field: string, token: string): number {
  if (field === token) return 4;
  if (field.startsWith(token)) return 3;
  const at = field.indexOf(token);
  if (at < 0) return 0;
  return /[\s.@+-]/.test(field[at - 1]) ? 2 : 1;
}

function best(fields: string[], token: string): number {
  let top = 0;
  for (const f of fields) {
    const q = quality(f, token);
    if (q > top) top = q;
    if (top === 4) break;
  }
  return top;
}

/** How well an entry matches; 0 when it doesn't. */
export function scoreEntry(entry: SearchEntry, query: Query): number {
  if (!query.text && !query.compact) return 0;
  let score = 0;

  // The whole query against a name: "al noor" finds "Al Noor Trading" first.
  const whole = best(entry.names, query.text);
  if (whole === 4) score = 1000;
  else if (whole === 3) score = 800;

  // Every word must match a name or another field.
  if (score === 0 && query.tokens.length > 0) {
    let sum = 0;
    for (const token of query.tokens) {
      const name = best(entry.names, token);
      const term = name === 4 ? 0 : best(entry.terms, token);
      if (name === 0 && term === 0) {
        sum = 0;
        break;
      }
      sum += Math.max(name * 100, term * 60);
    }
    score = query.tokens.length ? sum / query.tokens.length : 0;
  }

  // Numbers typed with or without their dashes.
  if (query.compact.length >= 2 && entry.compact.length > 0) {
    for (const c of entry.compact) {
      if (c === query.compact) score = Math.max(score, 950);
      else if (c.endsWith(query.compact)) score = Math.max(score, 650);
      else if (c.includes(query.compact)) score = Math.max(score, 450);
    }
  }

  // Amounts: "1250.75" finds a KD 1,250.750 invoice.
  if (query.amount && entry.amounts.length > 0) {
    const wanted = Number(query.amount);
    for (const a of entry.amounts) {
      if (Number(a) === wanted) score = Math.max(score, 700);
      else if (a.startsWith(query.amount)) score = Math.max(score, 350);
    }
  }

  return score > 0 ? score + entry.boost : 0;
}

/** The best matches, at most `limit`. */
export function searchEntries(entries: SearchEntry[], raw: string, limit = 50): SearchEntry[] {
  const query = prepareQuery(raw);
  if (!query.text && !query.compact) return [];
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, query);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return scored.slice(0, limit).map((s) => s.entry);
}
