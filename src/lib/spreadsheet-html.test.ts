import { describe, expect, it } from 'vitest';
import { isHtmlTable, isSpreadsheetMl, readHtmlTable, readSpreadsheetMl } from './spreadsheet-html';
import { XlsxError } from './xlsx';
import { statementHtml, statementRows, statementSpreadsheetMl } from '@/test/bank-statements';

describe('HTML tables saved as Excel files', () => {
  it('are told apart from CSV and XML', () => {
    expect(isHtmlTable(statementHtml())).toBe(true);
    expect(isHtmlTable('<table><tr><td>1</td></tr></table>')).toBe(true);
    expect(isHtmlTable('\uFEFF<!DOCTYPE html><html><body><table></table></body></html>')).toBe(
      true,
    );
    expect(isHtmlTable('Date,Description\n01/10/2026,"<table> booking"\n')).toBe(false);
    expect(isHtmlTable(statementSpreadsheetMl())).toBe(false);
    expect(isHtmlTable('<html><body>No table</body></html>')).toBe(false);
  });

  it('read the rows of the tables that hold no other table, in order', () => {
    const rows = readHtmlTable(statementHtml());
    const csv = statementRows();
    // The title spans the table: its other cells are empty.
    expect(rows[0]).toEqual(['Account Statement', '', '', '', '', '', '']);
    // Non-breaking spaces and the line break inside a cell read as spaces.
    expect(rows.slice(1)).toEqual(csv.slice(1));
  });

  it('keep columns in place under cells spanning rows and columns', () => {
    const rows = readHtmlTable(`<table>
      <tr><th rowspan="2">Date</th><th colspan="2">Amount</th><th>Note</th></tr>
      <tr><th>Debit</th><th>Credit</th><th></th></tr>
      <tr><td>01/10/2026</td><td>1.250</td><td></td><td>Fee</td></tr>
      <tr><td></td><td></td><td></td><td></td></tr>
    </table>`);
    expect(rows).toEqual([
      ['Date', 'Amount', '', 'Note'],
      ['', 'Debit', 'Credit', ''],
      ['01/10/2026', '1.250', '', 'Fee'],
    ]);
  });

  it('read Arabic statements', () => {
    expect(readHtmlTable(statementHtml('ar')).slice(1)).toEqual(statementRows('ar').slice(1));
  });
});

describe('Excel 2003 XML workbooks', () => {
  it('are recognised by their namespace', () => {
    expect(isSpreadsheetMl(statementSpreadsheetMl())).toBe(true);
    expect(isSpreadsheetMl(statementHtml())).toBe(false);
    expect(isSpreadsheetMl('<?xml version="1.0"?><OFX></OFX>')).toBe(false);
  });

  it('read the first visible sheet: skipped and merged cells, dates and numbers', () => {
    const rows = readSpreadsheetMl(statementSpreadsheetMl());
    expect(rows[0]).toEqual(['Account Statement', '', '', '', '', '', '']);
    expect(rows[5]).toEqual([
      'Posting Date',
      'Value Date',
      'Description',
      'Reference',
      'Debit',
      'Credit',
      'Balance',
    ]);
    expect(rows.slice(6, 9)).toEqual([
      ['2026-10-01', '2026-10-01', 'POS PURCHASE TEST STATIONERY', 'R0001', '45.6', '', '1954.4'],
      ['2026-10-02', '2026-10-03', 'TRF FROM TEST CUSTOMER ONE', 'R0002', '', '1200', '3154.4'],
      ['2026-10-05', '2026-10-05', 'SWIFT CHARGES', 'R0003', '3.5', '', '3150.9'],
    ]);
    expect(rows[9]).toEqual(['', '', 'Total', '', '49.1', '1200']);
    expect(rows).toHaveLength(11);
  });

  it('refuse a broken file', () => {
    expect(() =>
      readSpreadsheetMl(
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet>',
      ),
    ).toThrow(XlsxError);
    expect(() =>
      readSpreadsheetMl('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"/>'),
    ).toThrow(XlsxError);
  });
});
