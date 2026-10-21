import type { StatementFormat } from '@/db/types';
import { presetOf } from './presets';
import {
  csvStatement,
  DATE_FORMATS,
  detectDateFormats,
  findHeaderRow,
  guessMapping,
  trimFooter,
  type CsvMapping,
} from './statement';

/**
 * Where a statement's table is and how its columns read: guessed from the
 * file, or the layout its account remembers from an earlier import.
 */

export interface StatementLayout {
  /** The row of the file the table starts at. */
  start: number;
  mapping: CsvMapping;
  /** Read with the account's remembered layout. */
  remembered: boolean;
}

/** The table of a statement: from its first row, without the totals after it. */
export function statementTable(rows: string[][], start: number): string[][] {
  return trimFooter(rows.slice(start));
}

const name = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** The column names of a header row, without the empty cells at its end. */
function columnNames(row: string[]): string[] {
  const names = row.map((v) => v.trim());
  while (names.length && names[names.length - 1] === '') names.pop();
  return names;
}

const sameColumns = (row: string[], columns: string[]) => {
  const names = columnNames(row);
  return names.length === columns.length && names.every((v, i) => name(v) === name(columns[i]));
};

const COLUMN_KEYS = [
  'date',
  'description',
  'reference',
  'amount',
  'moneyIn',
  'moneyOut',
  'debitCredit',
  'balance',
  'valueDate',
] as const;

/**
 * A remembered mapping as this version reads it, or null when it can't be
 * used: it is stored data, perhaps from another version of the app.
 */
function storedMapping(value: unknown): CsvMapping | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  const column = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);
  const date = column(m.date);
  const description = column(m.description);
  if (date === null || description === null) return null;
  const mapping: CsvMapping = {
    header: m.header === true,
    date,
    description,
    reference: column(m.reference),
    amount: column(m.amount),
    moneyIn: column(m.moneyIn),
    moneyOut: column(m.moneyOut),
    debitCredit: column(m.debitCredit),
    balance: column(m.balance),
    valueDate: column(m.valueDate),
    dateFormat: DATE_FORMATS.some((f) => f.value === m.dateFormat)
      ? (m.dateFormat as CsvMapping['dateFormat'])
      : 'dd/MM/yyyy',
    invert: m.invert === true,
  };
  if (mapping.amount === null && mapping.moneyIn === null && mapping.moneyOut === null) {
    return null;
  }
  return mapping;
}

/**
 * The remembered mapping fitted to this table: its columns are there and it
 * reads lines, with the date format found again when the dates are written
 * another way (the same bank's CSV and Excel files often differ there).
 */
function fitted(table: string[][], mapping: CsvMapping, preferDayFirst: boolean) {
  const width = Math.max(0, ...table.slice(0, 20).map((r) => r.length));
  if (COLUMN_KEYS.some((key) => (mapping[key] ?? -1) >= width)) return null;
  if (csvStatement(table, mapping).lines.length) return mapping;
  const body = mapping.header ? table.slice(1) : table;
  const format = detectDateFormats(
    body.map((r) => r[mapping.date] ?? ''),
    preferDayFirst,
  )[0];
  if (!format) return null;
  const other = { ...mapping, dateFormat: format };
  return csvStatement(table, other).lines.length ? other : null;
}

/** The layout to read a statement with: the account's remembered one when it fits, else a guess. */
export function statementLayout(
  rows: string[][],
  saved: StatementFormat | undefined,
  preferDayFirst = true,
): StatementLayout {
  const mapping = saved && saved.kind !== 'pdf' ? storedMapping(saved.mapping) : null;
  if (saved && mapping) {
    const columns = Array.isArray(saved.columns) ? saved.columns.map(String) : [];
    const starts: number[] = [];
    if (mapping.header && columns.length) {
      // The header row, wherever it is now.
      const at = rows.slice(0, 50).findIndex((r) => sameColumns(r, columns));
      if (at >= 0) starts.push(at);
    } else {
      if (Number.isInteger(saved.headerRow) && saved.headerRow >= 0) starts.push(saved.headerRow);
      starts.push(findHeaderRow(rows));
    }
    for (const start of starts) {
      if (start >= rows.length) continue;
      const fit = fitted(statementTable(rows, start), mapping, preferDayFirst);
      if (fit) return { start, mapping: fit, remembered: true };
    }
  }
  return guessLayout(rows, findHeaderRow(rows), preferDayFirst);
}

/** The guessed layout of the table starting at `start`. */
export function guessLayout(
  rows: string[][],
  start: number,
  preferDayFirst = true,
): StatementLayout {
  return {
    start,
    mapping: guessMapping(statementTable(rows, start), preferDayFirst),
    remembered: false,
  };
}

/** What an account remembers of the layout a statement was read with. */
export function rememberedFormat(
  kind: StatementFormat['kind'],
  rows: string[][],
  start: number,
  mapping: CsvMapping,
): StatementFormat {
  const names = mapping.header ? columnNames(rows[start] ?? []) : [];
  return {
    kind,
    headerRow: start,
    mapping: { ...mapping },
    preset: presetOf(mapping),
    ...(names.length ? { columns: names } : {}),
  };
}
