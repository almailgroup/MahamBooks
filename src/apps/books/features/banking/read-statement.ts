import { decodeCsv, spreadsheetKind } from '@/features/company/import-columns';
import {
  isOfx,
  parseCsvRows,
  parseOfx,
  statementDelimiter,
  type StatementLine,
} from '@/lib/banking/statement';
import { t } from '@/i18n';

/**
 * What a statement file holds: the lines of an OFX or QFX file, or the rows
 * of a table (CSV, an Excel workbook, or an HTML or Excel 2003 XML table
 * saved as .xls). The Excel and HTML readers are loaded only when needed.
 */
export type StatementFile =
  { kind: 'ofx'; lines: StatementLine[] } | { kind: 'csv' | 'xlsx' | 'html'; rows: string[][] };

export class StatementFileError extends Error {}

export async function readStatementFile(data: ArrayBuffer | Uint8Array): Promise<StatementFile> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // The bytes decide, not the name: banks give HTML and XML files an .xls name.
  const kind = spreadsheetKind(bytes);
  if (kind === 'xlsx') {
    const { readXlsx } = await import('@/lib/xlsx');
    return { kind: 'xlsx', rows: await readXlsx(bytes) };
  }
  if (kind === 'xls') {
    throw new StatementFileError(
      t('Older Excel files (.xls) can’t be read. In Excel, save the file as .xlsx or CSV.'),
    );
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    throw new StatementFileError(
      t('PDF statements can’t be read. Download the statement as Excel or CSV instead.'),
    );
  }
  const text = decodeCsv(bytes);
  if (isOfx(text)) return { kind: 'ofx', lines: parseOfx(text).lines };
  if (/^\s*</.test(text.replace(/^\uFEFF/, ''))) {
    const html = await import('@/lib/spreadsheet-html');
    if (html.isSpreadsheetMl(text)) return { kind: 'html', rows: html.readSpreadsheetMl(text) };
    if (html.isHtmlTable(text)) return { kind: 'html', rows: html.readHtmlTable(text) };
  }
  return { kind: 'csv', rows: parseCsvRows(text, statementDelimiter(text)) };
}
