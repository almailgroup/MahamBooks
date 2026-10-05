import type { ISODate } from '@/db/types';
import { isISODate } from '@/lib/dates';
import { normalizeDigits } from '@/lib/money';
import { msg } from '@/i18n';

/**
 * Bank statements as exported by online banking: CSV (any layout, mapped by
 * the user with a good first guess) and OFX/QFX. Amounts are positive for
 * money coming into the account and negative for money going out.
 */

export interface StatementLine {
  date: ISODate;
  description: string;
  reference: string;
  amount: number;
  /** Running balance after the line, when the bank gives it. */
  balance: number | null;
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Splits CSV text into rows (quotes, doubled quotes, CRLF; `,` `;` or tab).
 * A quote opens a quoted value only at the start of a cell (after spaces at
 * most); elsewhere it is part of the text, as in `Monitor 27"`.
 */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce(
    (best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  // The cell had a quoted part: later quotes are text.
  let wasQuoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !wasQuoted && cell.trim() === '') {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
      wasQuoted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      wasQuoted = false;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ''));
}

function count(text: string, char: string): number {
  // Only delimiters outside quotes matter for detection.
  return text.replace(/"[^"]*"/g, '').split(char).length - 1;
}

export type DateFormat =
  | 'yyyy-MM-dd'
  | 'dd/MM/yyyy'
  | 'MM/dd/yyyy'
  | 'dd.MM.yyyy'
  | 'dd-MM-yyyy'
  | 'd MMM yyyy'
  | 'yyyyMMdd';

/** Translate the label where it is shown: `t(format.label)`. */
export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'dd/MM/yyyy', label: msg('31/12/2026 (day first)') },
  { value: 'MM/dd/yyyy', label: msg('12/31/2026 (month first)') },
  { value: 'yyyy-MM-dd', label: '2026-12-31' },
  { value: 'dd.MM.yyyy', label: '31.12.2026' },
  { value: 'dd-MM-yyyy', label: '31-12-2026' },
  { value: 'd MMM yyyy', label: '31 Dec 2026' },
  { value: 'yyyyMMdd', label: '20261231' },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Month names as Kuwaiti banks print them in Arabic.
const ARABIC_MONTHS: string[][] = [
  ['يناير'],
  ['فبراير'],
  ['مارس'],
  ['أبريل', 'ابريل', 'إبريل'],
  ['مايو'],
  ['يونيو'],
  ['يوليو'],
  ['أغسطس', 'اغسطس'],
  ['سبتمبر'],
  ['أكتوبر', 'اكتوبر'],
  ['نوفمبر'],
  ['ديسمبر'],
];

function monthIndex(name: string): number {
  const arabic = ARABIC_MONTHS.findIndex((names) => names.includes(name));
  return arabic >= 0 ? arabic : MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

function iso(y: number, m: number, d: number): ISODate | null {
  const year = y < 100 ? 2000 + y : y;
  const value = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isISODate(value) ? value : null;
}

/** Reads a statement date; null when it doesn't fit the format. */
export function parseStatementDate(value: string, format: DateFormat): ISODate | null {
  const v = normalizeDigits(value).trim();
  let m: RegExpExecArray | null;
  switch (format) {
    case 'yyyy-MM-dd':
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(v);
      return m ? iso(+m[1], +m[2], +m[3]) : null;
    case 'yyyyMMdd':
      m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
      return m ? iso(+m[1], +m[2], +m[3]) : null;
    case 'dd/MM/yyyy':
    case 'MM/dd/yyyy':
    case 'dd.MM.yyyy':
    case 'dd-MM-yyyy': {
      const sep = format[2];
      m = new RegExp(`^(\\d{1,2})\\${sep}(\\d{1,2})\\${sep}(\\d{2}|\\d{4})(?:\\s.*)?$`).exec(v);
      if (!m) return null;
      return format.startsWith('MM') ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
    }
    case 'd MMM yyyy': {
      m = /^(\d{1,2})[\s-](\p{L}{3,9})[\s-](\d{2}|\d{4})$/u.exec(v);
      if (!m) return null;
      const month = monthIndex(m[2]);
      return month < 0 ? null : iso(+m[3], month + 1, +m[1]);
    }
  }
}

/** Formats that read every value; day-first or month-first first, as preferred. */
export function detectDateFormats(values: string[], preferDayFirst = true): DateFormat[] {
  const filled = values.filter((v) => v.trim() !== '');
  if (!filled.length) return [];
  const order = DATE_FORMATS.map((f) => f.value).sort((a, b) => {
    if (preferDayFirst) return 0;
    if (a === 'MM/dd/yyyy') return -1;
    if (b === 'MM/dd/yyyy') return 1;
    return 0;
  });
  return order.filter((format) => filled.every((v) => parseStatementDate(v, format) !== null));
}

/**
 * Reads an amount as banks write it: currency signs, thousands separators,
 * decimal commas, minus signs before or after, (brackets), CR/DR.
 */
export function parseAmount(value: string): number | null {
  let v = normalizeDigits(value).replace(/[\s\u00a0\u200e\u200f\u061c]/g, '');
  if (!v) return null;
  let negative = false;
  // Arabic statements mark debits and credits with words: مدين (debit) / دائن (credit).
  if (v.includes('مدين')) negative = true;
  v = v.replace(/مدين|دائن/g, '');
  if (/DR$/i.test(v)) {
    negative = !negative;
    v = v.slice(0, -2);
  } else if (/CR$/i.test(v)) v = v.slice(0, -2);
  // Kuwaiti dinar signs contain dots ("د.ك.", "K.D."); remove them before the
  // dots are read as separators.
  v = v.replace(/د\.?ك\.?|دينار(?:كويتي)?|فلس|K\.D\.?/gi, '');
  // Other currency signs and codes (KWD, KD, $, AED…).
  v = v.replace(/[^\d.,()+-]/g, '');
  if (/^\(.*\)$/.test(v)) {
    negative = !negative;
    v = v.slice(1, -1);
  }
  if (v.endsWith('-')) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  if (v.startsWith('-')) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith('+')) v = v.slice(1);
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(v)) return null;
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // The separator that comes last is the decimal one.
    normal = lastComma > lastDot ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = v.length - lastComma - 1;
    // "0,250" is a decimal comma; "12,500" is twelve thousand five hundred.
    const decimalComma = (v.match(/,/g) ?? []).length === 1 && (decimals !== 3 || /^0?,/.test(v));
    normal = decimalComma ? v.replace(',', '.') : v.replace(/,/g, '');
  } else {
    normal = (v.match(/\./g) ?? []).length > 1 ? v.replace(/\./g, '') : v;
  }
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export interface CsvMapping {
  /** The first row holds column names. */
  header: boolean;
  date: number;
  description: number;
  reference: number | null;
  /** One signed amount column… */
  amount: number | null;
  /** …or separate money in / money out columns. */
  moneyIn: number | null;
  moneyOut: number | null;
  balance: number | null;
  dateFormat: DateFormat;
  /** Flip signs (some card statements show spending as positive). */
  invert: boolean;
}

// Column names in English, Arabic and the languages documents are offered in.
const HEADER_HINTS: Record<
  'date' | 'description' | 'reference' | 'amount' | 'moneyIn' | 'moneyOut' | 'balance',
  RegExp
> = {
  date: /date|datum|fecha|data|buchungstag|valuta|تاريخ/i,
  description:
    /description|details|narrative|memo|payee|particulars|name|merchant|beneficiary|verwendungszweck|libell|concepto|omschrijving|descri|البيان|الوصف|التفاصيل|الشرح/i,
  reference:
    /reference|^ref|transaction id|cheque|check|referenz|r[ée]f[ée]rence|referencia|المرجع|رقم الشيك/i,
  moneyIn:
    /paid in|money in|credit|deposit|^in$|receipts?|haben|cr[ée]dit|abono|ingreso|دائن|إيداع|ايداع|وارد/i,
  moneyOut:
    /paid out|money out|debit|withdrawal|payment|^out$|spent|soll|d[ée]bit|cargo|gasto|مدين|سحب|صادر/i,
  amount: /amount|value|sum|betrag|montant|importe|bedrag|valor|importo|المبلغ|القيمة/i,
  balance: /balance|saldo|solde|kontostand|الرصيد/i,
};

/** A first guess at what each column holds, from names or contents. */
export function guessMapping(rows: string[][], preferDayFirst = true): CsvMapping {
  const first = rows[0] ?? [];
  const width = Math.max(...rows.slice(0, 20).map((r) => r.length), 0);
  const looksLikeDate = (v: string) => detectDateFormats([v], preferDayFirst).length > 0;
  const header = first.length > 0 && !first.some(looksLikeDate);
  const body = header ? rows.slice(1) : rows;
  const sample = body.slice(0, 50);
  const column = (i: number) => sample.map((r) => r[i] ?? '');

  const used = new Set<number>();
  const find = (hint: RegExp, test?: (i: number) => boolean) => {
    if (!header) return null;
    const index = first.findIndex((h, i) => !used.has(i) && hint.test(h) && (!test || test(i)));
    if (index >= 0) used.add(index);
    return index >= 0 ? index : null;
  };
  const numeric = (i: number) =>
    column(i).filter((v) => v !== '').length > 0 &&
    column(i).every((v) => v === '' || parseAmount(v) !== null);

  let date = find(HEADER_HINTS.date);
  if (date === null) {
    for (let i = 0; i < width; i++) {
      if (column(i).length && column(i).every((v) => v === '' || looksLikeDate(v))) {
        date = i;
        used.add(i);
        break;
      }
    }
  }
  const balance = find(HEADER_HINTS.balance, numeric);
  const moneyIn = find(HEADER_HINTS.moneyIn, numeric);
  const moneyOut = find(HEADER_HINTS.moneyOut, numeric);
  let amount = moneyIn !== null && moneyOut !== null ? null : find(HEADER_HINTS.amount, numeric);
  if (amount === null && (moneyIn === null || moneyOut === null)) {
    for (let i = 0; i < width; i++) {
      if (!used.has(i) && numeric(i)) {
        amount = i;
        used.add(i);
        break;
      }
    }
  }
  const reference = find(HEADER_HINTS.reference);
  let description = find(HEADER_HINTS.description);
  if (description === null) {
    // The column with the longest text.
    let best = -1;
    let length = -1;
    for (let i = 0; i < width; i++) {
      if (used.has(i) || numeric(i)) continue;
      const total = column(i).reduce((s, v) => s + v.length, 0);
      if (total > length) {
        best = i;
        length = total;
      }
    }
    description = best >= 0 ? best : 0;
  }
  const dateColumn = date ?? 0;
  return {
    header,
    date: dateColumn,
    description,
    reference,
    amount: moneyIn !== null && moneyOut !== null ? null : amount,
    moneyIn: moneyIn !== null && moneyOut !== null ? moneyIn : null,
    moneyOut: moneyIn !== null && moneyOut !== null ? moneyOut : null,
    balance,
    dateFormat: detectDateFormats(column(dateColumn), preferDayFirst)[0] ?? 'dd/MM/yyyy',
    invert: false,
  };
}

/** Statement lines from CSV rows; rows that can't be read are counted, not kept. */
export function csvStatement(
  rows: string[][],
  mapping: CsvMapping,
): { lines: StatementLine[]; skipped: number } {
  const body = mapping.header ? rows.slice(1) : rows;
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of body) {
    const date = parseStatementDate(row[mapping.date] ?? '', mapping.dateFormat);
    let amount: number | null = null;
    if (mapping.amount !== null) amount = parseAmount(row[mapping.amount] ?? '');
    else if (mapping.moneyIn !== null || mapping.moneyOut !== null) {
      const cell = (i: number | null) => (i === null ? null : parseAmount(row[i] ?? ''));
      const inValue = cell(mapping.moneyIn);
      const outValue = cell(mapping.moneyOut);
      amount =
        inValue === null && outValue === null
          ? null
          : Math.abs(inValue ?? 0) - Math.abs(outValue ?? 0);
    }
    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    const balance = mapping.balance === null ? null : parseAmount(row[mapping.balance] ?? '');
    const sign = mapping.invert ? -1 : 1;
    lines.push({
      date,
      description: row[mapping.description] ?? '',
      reference: mapping.reference === null ? '' : (row[mapping.reference] ?? ''),
      amount: sign * amount,
      balance: balance === null ? null : sign * balance,
    });
  }
  return { lines, skipped };
}

/* -------------------------------------------------------------------------- */
/* OFX / QFX                                                                  */
/* -------------------------------------------------------------------------- */

export function isOfx(text: string): boolean {
  return /OFXHEADER|<OFX>/i.test(text.slice(0, 2000));
}

/** OFX 1 (SGML, no closing tags) and OFX 2 (XML) statements. */
export function parseOfx(text: string): {
  lines: StatementLine[];
  balance: { amount: number; date: ISODate | null } | null;
  currency: string | null;
} {
  const field = (block: string, tag: string) => {
    const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
    return m ? m[1].trim() : '';
  };
  const date = (value: string) => parseStatementDate(value, 'yyyyMMdd');
  const lines: StatementLine[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) ?? [];
  for (const block of blocks) {
    const posted = date(field(block, 'DTPOSTED'));
    const amount = parseAmount(field(block, 'TRNAMT'));
    if (!posted || amount === null) continue;
    const name = field(block, 'NAME');
    const memo = field(block, 'MEMO');
    lines.push({
      date: posted,
      description: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' · '),
      reference: field(block, 'CHECKNUM') || field(block, 'REFNUM') || field(block, 'FITID'),
      amount,
      balance: null,
    });
  }
  const ledger = /<LEDGERBAL>[\s\S]*?(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(text)?.[0];
  const balanceAmount = ledger ? parseAmount(field(ledger, 'BALAMT')) : null;
  return {
    lines,
    balance:
      balanceAmount === null
        ? null
        : { amount: balanceAmount, date: ledger ? date(field(ledger, 'DTASOF')) : null },
    currency: field(text, 'CURDEF') || null,
  };
}

/* -------------------------------------------------------------------------- */
/* Duplicates                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Keys that identify statement lines, so importing an overlapping statement
 * again skips what is already there. Identical lines on the same day (two
 * coffees) are told apart by their order.
 */
export function fingerprints(accountId: string, lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const key = [
      accountId,
      l.date,
      l.amount.toFixed(4),
      l.description.trim().toLowerCase().replace(/\s+/g, ' '),
    ].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${key}#${n}`;
  });
}
