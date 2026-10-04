import { downloadName } from './file-names';

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : String(value);
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
