import { formatNumber, XlsxError } from './xlsx';
import { t } from '@/i18n';

/**
 * The "Excel" files some online banking gives that are not workbooks: an
 * HTML page with a table, or an Excel 2003 XML workbook (SpreadsheetML),
 * both saved with an .xls name. They are read with DOMParser into rows of
 * text, as `readXlsx` reads a workbook: numbers without thousands separators,
 * dates as yyyy-MM-dd where the file says it is a date, text trimmed, and rows
 * with nothing in them left out.
 */

const SPREADSHEET_NS = 'urn:schemas-microsoft-com:office:spreadsheet';

const head = (text: string) => text.replace(/^\uFEFF/, '').slice(0, 4096);

/** Whether the text is an HTML page or table (and not a CSV that mentions one). */
export function isHtmlTable(text: string): boolean {
  return (
    /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|body|table|meta|style)\b/i.test(
      head(text),
    ) && /<table\b/i.test(text)
  );
}

/** Whether the text is an Excel 2003 XML workbook. */
export function isSpreadsheetMl(text: string): boolean {
  const start = head(text);
  return start.includes(SPREADSHEET_NS) && /<(?:\w+:)?Workbook\b/.test(start);
}

const clean = (text: string) => text.replace(/[\s\u00a0]+/g, ' ').trim();

/** A cell's text, with line breaks and blocks inside it read as spaces. */
function cellText(cell: Element): string {
  for (const el of Array.from(cell.querySelectorAll('br, p, div, li'))) {
    el.before(' ');
    el.after(' ');
  }
  return clean(cell.textContent ?? '');
}

/**
 * The rows of every table in an HTML page that holds no other table, in
 * order: banks lay a page out with tables around the one with the lines.
 * Merged cells keep the columns in place: a cell spanning columns or rows
 * leaves empty cells where it reaches.
 */
export function readHtmlTable(text: string): string[][] {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const rows: string[][] = [];
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (table.querySelector('table')) continue;
    // Columns still taken by a cell from a row above: column → rows left.
    const spans = new Map<number, number>();
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const values: string[] = [];
      let column = 0;
      const skipSpans = () => {
        while ((spans.get(column) ?? 0) > 0) {
          values[column] = '';
          column++;
        }
      };
      for (const cell of Array.from(tr.children)) {
        if (cell.localName !== 'td' && cell.localName !== 'th') continue;
        skipSpans();
        const colspan = Math.min(Math.max(Number(cell.getAttribute('colspan')) || 1, 1), 100);
        const rowspan = Math.min(Math.max(Number(cell.getAttribute('rowspan')) || 1, 1), 1000);
        values[column] = cellText(cell);
        for (let c = 0; c < colspan; c++) {
          if (c > 0) values[column + c] = '';
          if (rowspan > 1) spans.set(column + c, rowspan);
        }
        column += colspan;
      }
      skipSpans();
      // This row's own cells count as one row of their span.
      for (const [c, left] of spans) spans.set(c, left - 1);
      const row = Array.from(values, (v) => v ?? '');
      if (row.some((v) => v !== '')) rows.push(row);
    }
  }
  return rows;
}

function attribute(element: Element, name: string): string | null {
  return element.getAttributeNS(SPREADSHEET_NS, name) ?? element.getAttribute(`ss:${name}`);
}

function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === name);
}

/** The rows of the first visible worksheet of an Excel 2003 XML workbook. */
export function readSpreadsheetMl(text: string): string[][] {
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new XlsxError(t('This file is not a valid Excel workbook.'));
  }
  const sheets = Array.from(doc.getElementsByTagNameNS('*', 'Worksheet'));
  const hidden = (sheet: Element) =>
    Array.from(sheet.getElementsByTagNameNS('*', 'Visible')).some((v) =>
      /hidden/i.test(v.textContent ?? ''),
    );
  const sheet = sheets.find((s) => !hidden(s)) ?? sheets[0];
  const table = sheet ? Array.from(sheet.getElementsByTagNameNS('*', 'Table'))[0] : undefined;
  if (!table) throw new XlsxError(t('This workbook has no sheets.'));
  const rows: string[][] = [];
  for (const row of children(table, 'Row')) {
    const values: string[] = [];
    for (const cell of children(row, 'Cell')) {
      // ss:Index is 1-based and skips the empty cells before it.
      const index = Math.min(Number(attribute(cell, 'Index')) || 0, 1000);
      while (values.length < index - 1) values.push('');
      const data = children(cell, 'Data')[0];
      const type = data ? attribute(data, 'Type') : null;
      const raw = data?.textContent ?? '';
      let value = clean(raw);
      if (type === 'Number' && value !== '' && Number.isFinite(Number(value))) {
        value = formatNumber(Number(value));
      } else if (type === 'DateTime' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        value = value.slice(0, 10);
      } else if (type === 'Boolean') value = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : '';
      else if (type === 'Error') value = '';
      values.push(value);
      const across = Number(attribute(cell, 'MergeAcross')) || 0;
      for (let c = 0; c < Math.min(across, 100); c++) values.push('');
    }
    if (values.some((v) => v !== '')) rows.push(values);
  }
  return rows;
}
