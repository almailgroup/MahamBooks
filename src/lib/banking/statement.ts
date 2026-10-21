import type { ISODate } from '@/db/types';
import { isISODate } from '@/lib/dates';
import { normalizeDigits } from '@/lib/money';
import { msg } from '@/i18n';

/**
 * Bank statements as exported by online banking: CSV (any layout, mapped by
 * the user with a good first guess) and OFX/QFX. Excel and HTML exports are
 * read into the same rows as CSV. Amounts are positive for money coming into
 * the account and negative for money going out.
 */

export interface StatementLine {
  date: ISODate;
  description: string;
  reference: string;
  amount: number;
  /** Running balance after the line, when the bank gives it. */
  balance: number | null;
  /** The day the bank counts the money from, when the statement has its own column. */
  valueDate?: ISODate;
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Splits CSV text into rows (quotes, doubled quotes, CRLF; `,` `;` or tab).
 * A quote opens a quoted value only at the start of a cell (after spaces at
 * most); elsewhere it is part of the text, as in `Monitor 27"`. The
 * delimiter is the one the first line uses most, unless one is given.
 */
export function parseCsvRows(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  delimiter ??= lineDelimiter(clean.split(/\r?\n/, 1)[0] ?? '');
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

const DELIMITERS = [',', ';', '\t'];

function lineDelimiter(line: string): string {
  return DELIMITERS.reduce((best, d) => (count(line, d) > count(line, best) ? d : best), ',');
}

/**
 * The delimiter of a statement: the first line's, as for any CSV, or when
 * the first line has none (a title such as "Account statement"), that of the
 * first line that has one.
 */
export function statementDelimiter(text: string): string {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/, 30);
  const line = lines.find((l) => DELIMITERS.some((d) => count(l, d) > 0));
  return line === undefined ? ',' : lineDelimiter(line);
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
  /**
   * With the amount column: a column that says whether each amount is a
   * debit (money out) or a credit (money in), as "Dr" / "Cr" or مدين / دائن.
   */
  debitCredit?: number | null;
  balance: number | null;
  /** The value date, when the statement has one apart from the posting date. */
  valueDate?: number | null;
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

const VALUE_DATE =
  /value\s*date|valuta|wertstellung|date de valeur|fecha valor|تاريخ القيمة|تاريخ الاستحقاق/i;

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
  // Looked for last, so the other columns are guessed as they always were.
  const taken = [dateColumn, description, reference, amount, moneyIn, moneyOut, balance];
  const valueDate = header
    ? first.findIndex(
        (h, i) =>
          !taken.includes(i) &&
          VALUE_DATE.test(h) &&
          column(i).some((v) => v !== '') &&
          column(i).every((v) => v === '' || looksLikeDate(v)),
      )
    : -1;
  return {
    header,
    date: dateColumn,
    description,
    reference,
    amount: moneyIn !== null && moneyOut !== null ? null : amount,
    moneyIn: moneyIn !== null && moneyOut !== null ? moneyIn : null,
    moneyOut: moneyIn !== null && moneyOut !== null ? moneyOut : null,
    debitCredit: null,
    balance,
    valueDate: valueDate >= 0 ? valueDate : null,
    dateFormat: detectDateFormats(column(dateColumn), preferDayFirst)[0] ?? 'dd/MM/yyyy',
    invert: false,
  };
}

/** Whether a debit/credit column says debit (money out), credit (money in), or neither. */
export function debitOrCredit(value: string): 'debit' | 'credit' | null {
  const v = value.trim().replace(/\.$/, '').toLowerCase();
  if (/^(?:dr|db|d|debit|withdrawal|-|مدين|سحب|صادر)$/.test(v)) return 'debit';
  if (/^(?:cr|c|credit|deposit|\+|دائن|إيداع|ايداع|وارد)$/.test(v)) return 'credit';
  return null;
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
    if (mapping.amount !== null) {
      amount = parseAmount(row[mapping.amount] ?? '');
      const side =
        mapping.debitCredit == null ? null : debitOrCredit(row[mapping.debitCredit] ?? '');
      if (amount !== null && side) amount = side === 'debit' ? -Math.abs(amount) : Math.abs(amount);
    } else if (mapping.moneyIn !== null || mapping.moneyOut !== null) {
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
    const valueDate =
      mapping.valueDate == null
        ? null
        : parseStatementDate(row[mapping.valueDate] ?? '', mapping.dateFormat);
    const sign = mapping.invert ? -1 : 1;
    lines.push({
      date,
      description: row[mapping.description] ?? '',
      reference: mapping.reference === null ? '' : (row[mapping.reference] ?? ''),
      amount: sign * amount,
      balance: balance === null ? null : sign * balance,
      ...(valueDate ? { valueDate } : {}),
    });
  }
  return { lines, skipped };
}

/* -------------------------------------------------------------------------- */
/* Where the table is                                                         */
/* -------------------------------------------------------------------------- */

const anyDate = (v: string) =>
  v.trim() !== '' && DATE_FORMATS.some((f) => parseStatementDate(v, f.value) !== null);
const anyAmount = (v: string) => /\d/.test(v) && parseAmount(v) !== null && !anyDate(v);

// Column names a statement's header row has, in English and Arabic: the
// words of the guess and a few more banks use.
const HEADER_WORDS = {
  date: [HEADER_HINTS.date, /تاريخ/],
  money: [
    HEADER_HINTS.amount,
    HEADER_HINTS.moneyIn,
    HEADER_HINTS.moneyOut,
    /withdraw|deposit|مبلغ|سحوبات|إيداعات|ايداعات/i,
  ],
  balance: [HEADER_HINTS.balance, /رصيد/],
  description: [HEADER_HINTS.description, /narration|remarks|بيان|تفاصيل|وصف/i],
  reference: [HEADER_HINTS.reference, /مرجع/],
};

// Totals and notes after the last line, in English and Arabic.
const FOOTER_CELL = new RegExp(
  '^(?:' +
    [
      String.raw`(?:grand\s+|sub\s*-?\s*)?totals?`,
      String.raw`totals?\s+(?:debits?|credits?|amounts?|withdrawals?|deposits?|transactions?)`,
      String.raw`(?:closing|opening|ending|available|ledger)\s+balance`,
      String.raw`balance\s+(?:c/f|b/f|carried\s+forward|brought\s+forward)`,
      String.raw`end\s+of\s+(?:the\s+)?statement`,
      String.raw`(?:ال)?إجمالي(?:\s+(?:المدين|الدائن|الحركات|السحوبات|الإيداعات|المبلغ))?`,
      String.raw`(?:ال)?اجمالي(?:\s+(?:المدين|الدائن|الحركات|السحوبات|الايداعات|المبلغ))?`,
      String.raw`(?:ال)?مجموع(?:\s+(?:الكلي|المدين|الدائن|الحركات))?`,
      String.raw`الرصيد\s+(?:الختامي|الافتتاحي|الحالي|المتاح)`,
      String.raw`رصيد\s+(?:الإغلاق|الاغلاق|آخر\s+المدة|أول\s+المدة|افتتاحي|ختامي)`,
      String.raw`نهاية\s+الكشف`,
    ].join('|') +
    String.raw`)\s*[:：]?$`,
  'i',
);

/** How much a row reads like a statement's column names: the kinds of column it names. */
function headerScore(row: string[]): number {
  const cells = row.map((v) => v.trim()).filter((v) => v !== '');
  if (cells.length < 3 || cells.some((v) => anyDate(v) || anyAmount(v))) return 0;
  const kinds = new Set<string>();
  for (const cell of cells) {
    // Long cells are sentences, and "Total debit" is a total, not a column.
    if (cell.length > 40 || FOOTER_CELL.test(cell)) continue;
    for (const [kind, hints] of Object.entries(HEADER_WORDS)) {
      if (hints.some((h) => h.test(cell))) {
        kinds.add(kind);
        break;
      }
    }
  }
  const money = kinds.has('money') || kinds.has('balance');
  return kinds.has('date') && money ? kinds.size : 0;
}

/** A row that reads like a statement line: a date and an amount. */
function isDataRow(row: string[]): boolean {
  const cells = row.filter((v) => v.trim() !== '');
  if (cells.length < 2) return false;
  const date = cells.findIndex(anyDate);
  return date >= 0 && cells.some((v, i) => i !== date && anyAmount(v));
}

/**
 * The row a statement's table starts at (0 is the first row): banks often
 * put the account name, IBAN and period above it. It is the row that names
 * the most kinds of column (a date and an amount or balance at least), or
 * without one, the first line that reads like a transaction, with the row
 * above it when that row looks like column names. 0 when neither is found.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 50);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const score = headerScore(rows[i]);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (best >= 0) return best;
  const first = rows.slice(0, limit).findIndex(isDataRow);
  if (first <= 0) return 0;
  const above = rows[first - 1].filter((v) => v.trim() !== '');
  const width = rows[first].filter((v) => v.trim() !== '').length;
  const names =
    above.length >= Math.max(3, width - 1) && !above.some((v) => anyDate(v) || anyAmount(v));
  return names ? first - 1 : first;
}

/** Whether a row after the last line is a total or a note: no date, or a totals label. */
function isFooterRow(row: string[]): boolean {
  return !row.some(anyDate) || row.some((v) => FOOTER_CELL.test(v.trim()));
}

/**
 * The table without what comes after its last line: totals ("Total",
 * "Closing balance", الإجمالي) and notes such as "End of statement". The
 * first row (the column names) always stays.
 */
export function trimFooter(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 1 && isFooterRow(rows[end - 1])) end--;
  return end === rows.length ? rows : rows.slice(0, end);
}

/* -------------------------------------------------------------------------- */
/* Running balance                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Whether the amounts add up to the running balances the statement gives,
 * whichever order its lines are in (oldest or newest first): 'agrees',
 * 'flipped' when they add up only with the signs the other way (money in and
 * money out swapped), 'differs', or null without two balances to compare.
 */
export function checkBalances(
  lines: StatementLine[],
  tolerance = 0.0005,
): 'agrees' | 'flipped' | 'differs' | null {
  const pairs: { from: number; to: number; between: number; last: number }[] = [];
  let previous = -1;
  lines.forEach((line, i) => {
    if (line.balance === null) return;
    if (previous >= 0) {
      let between = 0;
      for (let k = previous + 1; k < i; k++) between += lines[k].amount;
      pairs.push({ from: previous, to: i, between, last: line.amount });
    }
    previous = i;
  });
  if (!pairs.length) return null;
  const close = (a: number, b: number) => Math.abs(a - b) < tolerance;
  const holds = (sign: 1 | -1) =>
    // Oldest first: each balance is the one before plus the lines since.
    pairs.every((p) =>
      close(lines[p.to].balance!, lines[p.from].balance! + sign * (p.between + p.last)),
    ) ||
    // Newest first: each balance is the one below plus its own line and those between.
    pairs.every((p) =>
      close(
        lines[p.from].balance!,
        lines[p.to].balance! + sign * (lines[p.from].amount + p.between),
      ),
    );
  if (holds(1)) return 'agrees';
  if (holds(-1)) return 'flipped';
  return 'differs';
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
