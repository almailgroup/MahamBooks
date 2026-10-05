import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  isDateFormat,
  readXlsx,
  readXlsxSheet,
  serialToISODate,
  XlsxError,
} from './xlsx';
import { buildWorkbook, excelSerial, zohoWorkbook, ZOHO_HEADERS } from '@/test/workbook';
import { readImportFile, spreadsheetKind } from '@/features/company/import-columns';

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));

describe('reading Excel workbooks', () => {
  it('reads text, numbers, dates and booleans from the first sheet', async () => {
    const file = buildWorkbook([
      ['Name', 'Amount', 'Date', 'Paid', 'Code'],
      ['  Al Noor  Trading ', 1250.75, { date: '2026-08-15' }, true, '000424'],
      [],
      ['شركة النور', 0.1 + 0.2, { date: '1899-12-29' }, false, 289010112345],
      ['Sparse', null, null, null, 'last'],
    ]);
    expect(await readXlsx(file)).toEqual([
      ['Name', 'Amount', 'Date', 'Paid', 'Code'],
      ['Al Noor  Trading', '1250.75', '2026-08-15', 'TRUE', '000424'],
      ['شركة النور', '0.3', '1899-12-29', 'FALSE', '289010112345'],
      ['Sparse', '', '', '', 'last'],
    ]);
  });

  it('reads shared strings, compressed parts and skips hidden sheets', async () => {
    const file = buildWorkbook(
      [
        ['Name', 'Name'],
        ['Fatima & Co <W.L.L.>', 'Fatima & Co <W.L.L.>'],
      ],
      { sharedStrings: true, deflate, hiddenFirstSheet: true, sheetName: 'Staff' },
    );
    const sheet = await readXlsxSheet(file);
    expect(sheet.name).toBe('Staff');
    expect(sheet.rows).toEqual([
      ['Name', 'Name'],
      ['Fatima & Co <W.L.L.>', 'Fatima & Co <W.L.L.>'],
    ]);
  });

  it('reads the 1904 date system', async () => {
    const file = buildWorkbook([['Date'], [{ date: '2026-02-28' }]], { date1904: true });
    expect(await readXlsx(file)).toEqual([['Date'], ['2026-02-28']]);
  });

  it('reads a Zoho People export with its date cells', async () => {
    const rows = await readXlsx(zohoWorkbook());
    expect(rows[0]).toEqual(ZOHO_HEADERS);
    const first = rows[1];
    expect(first[1]).toBe('000101');
    expect(first[6]).toBe('2022-01-10');
    expect(first[8]).toBe('1990-05-01');
    expect(rows[2][8]).toBe('1899-12-29');
    // The empty row (no number, no name) still has a date of birth, so it is kept.
    expect(rows).toHaveLength(9);
  });

  it('refuses files that are not workbooks', async () => {
    await expect(readXlsx(new TextEncoder().encode('Name,Amount\nA,1'))).rejects.toThrow(XlsxError);
    const truncated = buildWorkbook([['Name']]).slice(0, 40);
    await expect(readXlsx(truncated)).rejects.toThrow(XlsxError);
  });
});

describe('Excel number formats and serials', () => {
  it('knows date formats', () => {
    expect(isDateFormat(14, undefined)).toBe(true);
    expect(isDateFormat(165, 'dd-MMM-yyyy')).toBe(true);
    expect(isDateFormat(164, 'dd-MMM-yyyy hh:mm:ss AM/PM')).toBe(true);
    expect(isDateFormat(166, '[$-F800]dddd, mmmm dd, yyyy')).toBe(true);
    expect(isDateFormat(0, 'General')).toBe(false);
    expect(isDateFormat(167, '#,##0.000 "KD"')).toBe(false);
    expect(isDateFormat(168, '0.0 "days"')).toBe(false);
    expect(isDateFormat(20, 'h:mm')).toBe(false);
  });

  it('turns serials into dates', () => {
    expect(serialToISODate(1)).toBe('1900-01-01');
    expect(serialToISODate(61)).toBe('1900-03-01');
    expect(serialToISODate(0)).toBe('1899-12-30');
    expect(serialToISODate(-1)).toBe('1899-12-29');
    expect(serialToISODate(46280)).toBe('2026-09-15');
    expect(serialToISODate(46280.99999)).toBe('2026-09-15');
    expect(serialToISODate(46280.999999999)).toBe('2026-09-16');
    expect(excelSerial('2026-09-15')).toBe(46280);
    expect(serialToISODate(0, true)).toBe('1904-01-01');
  });

  it('writes numbers as Excel shows them', () => {
    expect(formatNumber(1250.75)).toBe('1250.75');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(-12.5)).toBe('-12.5');
    expect(formatNumber(96512345678)).toBe('96512345678');
  });
});

describe('import files', () => {
  it('reads CSV and Excel files alike and refuses old .xls files', async () => {
    const csv = new TextEncoder().encode('﻿Name,Amount\n"Al Noor, Co",1.500\n');
    expect(await readImportFile(csv.buffer)).toEqual([
      ['Name', 'Amount'],
      ['Al Noor, Co', '1.500'],
    ]);
    const xlsx = buildWorkbook([
      ['Name', 'Amount'],
      ['Al Noor, Co', 1.5],
    ]);
    expect(await readImportFile(xlsx.slice().buffer, 'customers.xlsx')).toEqual([
      ['Name', 'Amount'],
      ['Al Noor, Co', '1.5'],
    ]);
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(spreadsheetKind(xls)).toBe('xls');
    await expect(readImportFile(xls.buffer, 'old.xls')).rejects.toThrow(/\.xls/);
    expect(spreadsheetKind(xlsx)).toBe('xlsx');
    expect(spreadsheetKind(csv)).toBe('text');
  });
});
