import { downloadName } from './file-names';

/** What a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain number such as "-12.500" or "1,250.000": a value, not a formula. */
const PLAIN_NUMBER = /^[-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)$/;

/**
 * Text that a spreadsheet would run as a formula when the file is opened (a
 * client named "=HYPERLINK(…)") gets an apostrophe in front, so it stays
 * text. Numbers are left alone.
 */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : neutralizeFormula(String(value));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds CSV text (RFC 4180) from rows of plain values. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Downloads CSV with a BOM so Excel opens UTF-8 correctly; the name is made ASCII. */
export function downloadCsv(fileName: string, headers: string[], rows: unknown[][]): void {
  const blob = new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
