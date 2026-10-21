import { buildWorkbook, type Cell, type WorkbookOptions } from './workbook';

/**
 * Made-up bank statements for tests, in the shapes online banking exports
 * them: account details above the table, separate debit and credit columns
 * with 3 decimals, a value date, and totals after the last line. The same
 * statement comes as CSV, as an Excel workbook, as an HTML table saved as
 * .xls and as Excel 2003 XML. No real account, customer or bank layout is
 * in them. Imports are relative so the end-to-end tests can use them too.
 */

interface Line {
  date: string;
  valueDate: string;
  description: string;
  reference: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

export const STATEMENT_LINES: Line[] = [
  {
    date: '2026-10-01',
    valueDate: '2026-10-01',
    description: 'POS PURCHASE TEST STATIONERY',
    reference: 'R0001',
    debit: 45.6,
    credit: null,
    balance: 1954.4,
  },
  {
    date: '2026-10-02',
    valueDate: '2026-10-03',
    description: 'TRF FROM TEST CUSTOMER ONE',
    reference: 'R0002',
    debit: null,
    credit: 1200,
    balance: 3154.4,
  },
  {
    date: '2026-10-05',
    valueDate: '2026-10-05',
    description: 'SWIFT CHARGES',
    reference: 'R0003',
    debit: 3.5,
    credit: null,
    balance: 3150.9,
  },
];

/** The lines as the import reads them. */
export const STATEMENT_RESULT = STATEMENT_LINES.map((l) => ({
  date: l.date,
  description: l.description,
  reference: l.reference,
  amount: (l.credit ?? 0) - (l.debit ?? 0),
  balance: l.balance,
  valueDate: l.valueDate,
}));

const WORDS = {
  en: {
    preamble: [
      ['Account Statement'],
      ['Account Name', 'TEST TRADING COMPANY'],
      ['Account Number', 'TEST-0001'],
      ['IBAN', 'KW00TEST0000000000000000000001'],
      ['Period', '01/10/2026', '31/10/2026'],
    ],
    header: [
      'Posting Date',
      'Value Date',
      'Description',
      'Reference',
      'Debit',
      'Credit',
      'Balance',
    ],
    total: 'Total',
    closing: 'Closing Balance',
    end: 'End of statement',
  },
  ar: {
    preamble: [
      ['كشف حساب'],
      ['اسم الحساب', 'شركة تجريبية للتجارة'],
      ['رقم الحساب', 'TEST-0001'],
      ['الآيبان', 'KW00TEST0000000000000000000001'],
      ['الفترة', '01/10/2026', '31/10/2026'],
    ],
    header: ['التاريخ', 'تاريخ القيمة', 'البيان', 'المرجع', 'مدين', 'دائن', 'الرصيد'],
    total: 'الإجمالي',
    closing: 'الرصيد الختامي',
    end: 'نهاية الكشف',
  },
};

const kd = (n: number | null) =>
  n === null
    ? ''
    : n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dmy = (iso: string) => iso.split('-').reverse().join('/');

const totals = (lines: Line[]) => ({
  debit: lines.reduce((s, l) => s + (l.debit ?? 0), 0),
  credit: lines.reduce((s, l) => s + (l.credit ?? 0), 0),
});

/** The statement as rows of text, as a CSV export has them. */
export function statementRows(lang: 'en' | 'ar' = 'en', lines = STATEMENT_LINES): string[][] {
  const w = WORDS[lang];
  const sum = totals(lines);
  return [
    ...w.preamble,
    w.header,
    ...lines.map((l) => [
      dmy(l.date),
      dmy(l.valueDate),
      l.description,
      l.reference,
      kd(l.debit),
      kd(l.credit),
      kd(l.balance),
    ]),
    ['', '', w.total, '', kd(sum.debit), kd(sum.credit), ''],
    [w.closing, '', '', '', '', '', kd(lines[lines.length - 1]?.balance ?? 0)],
    [w.end],
  ];
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The statement as a CSV file's text. */
export function statementCsv(lang: 'en' | 'ar' = 'en', lines = STATEMENT_LINES): string {
  return statementRows(lang, lines)
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

/** The statement as an Excel workbook: real dates and numbers, as banks' Excel exports have. */
export function statementWorkbook(
  lang: 'en' | 'ar' = 'en',
  options: WorkbookOptions = {},
  lines = STATEMENT_LINES,
): Uint8Array {
  const w = WORDS[lang];
  const sum = totals(lines);
  const rows: Cell[][] = [
    ...w.preamble,
    w.header,
    ...lines.map((l) => [
      { date: l.date },
      { date: l.valueDate },
      l.description,
      l.reference,
      l.debit,
      l.credit,
      l.balance,
    ]),
    [null, null, w.total, null, sum.debit, sum.credit, null],
    [w.closing, null, null, null, null, null, lines[lines.length - 1]?.balance ?? 0],
    [w.end],
  ];
  return buildWorkbook(rows, { sheetName: 'Statement', ...options });
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The statement as an HTML page saved as .xls: a layout table around a
 * table of account details and the table of lines, merged cells, a line
 * break inside a cell and non-breaking spaces.
 */
export function statementHtml(lang: 'en' | 'ar' = 'en'): string {
  const rows = statementRows(lang);
  const preamble = rows.slice(0, 5);
  const table = rows.slice(5);
  const td = (v: string) => `<td>${escapeHtml(v).replace(/ /g, '&nbsp;')}</td>`;
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>td { mso-number-format: "\\@"; }</style></head>
<body${lang === 'ar' ? ' dir="rtl"' : ''}>
<table><tr><td>
<table>
<tr><td colspan="7"><b>${escapeHtml(preamble[0][0])}</b></td></tr>
${preamble
  .slice(1)
  .map((r) => `<tr>${r.map(td).join('')}</tr>`)
  .join('\n')}
</table>
</td></tr><tr><td>
<table border="1">
<thead><tr>${table[0].map((v) => `<th>${escapeHtml(v)}</th>`).join('')}</tr></thead>
<tbody>
${table
  .slice(1)
  .map((r, i) =>
    i === 1
      ? // A line break inside the description.
        `<tr>${r.map((v, c) => (c === 2 ? `<td>${escapeHtml(v).replace(' FROM ', '<br>FROM ')}</td>` : td(v))).join('')}</tr>`
      : `<tr>${r.map(td).join('')}</tr>`,
  )
  .join('\n')}
</tbody>
</table>
</td></tr></table>
</body></html>`;
}

/** The statement as an Excel 2003 XML workbook (SpreadsheetML), as some banks save ".xls" files. */
export function statementSpreadsheetMl(lang: 'en' | 'ar' = 'en'): string {
  const w = WORDS[lang];
  const sum = totals(STATEMENT_LINES);
  const text = (v: string) => `<Cell><Data ss:Type="String">${escapeHtml(v)}</Data></Cell>`;
  const number = (v: number | null, index?: number) =>
    v === null
      ? ''
      : `<Cell${index ? ` ss:Index="${index}"` : ''}><Data ss:Type="Number">${v}</Data></Cell>`;
  const date = (v: string) =>
    `<Cell ss:StyleID="d"><Data ss:Type="DateTime">${v}T00:00:00.000</Data></Cell>`;
  const rows = [
    `<Row><Cell ss:MergeAcross="6"><Data ss:Type="String">${escapeHtml(w.preamble[0][0])}</Data></Cell></Row>`,
    ...w.preamble.slice(1).map((r) => `<Row>${r.map(text).join('')}</Row>`),
    `<Row>${w.header.map(text).join('')}</Row>`,
    // The empty debit or credit cell is skipped with ss:Index, as Excel writes it.
    ...STATEMENT_LINES.map(
      (l) =>
        `<Row>${date(l.date)}${date(l.valueDate)}${text(l.description)}${text(l.reference)}${
          l.debit !== null
            ? `${number(l.debit)}${number(l.balance, 7)}`
            : `${number(l.credit, 6)}${number(l.balance)}`
        }</Row>`,
    ),
    `<Row><Cell ss:Index="3"><Data ss:Type="String">${w.total}</Data></Cell>${number(sum.debit, 5)}${number(sum.credit)}</Row>`,
    `<Row>${text(w.closing)}${number(STATEMENT_LINES[STATEMENT_LINES.length - 1].balance, 7)}</Row>`,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="d"><NumberFormat ss:Format="dd/mm/yyyy"/></Style></Styles>
<Worksheet ss:Name="Notes"><Table><Row><Cell><Data ss:Type="String">Hidden</Data></Cell></Row></Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><Visible>SheetHidden</Visible></WorksheetOptions></Worksheet>
<Worksheet ss:Name="Statement"><Table>
${rows.join('\n')}
</Table></Worksheet>
</Workbook>`;
}
