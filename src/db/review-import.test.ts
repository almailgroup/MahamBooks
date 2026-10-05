import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { loadImportContext, planImport, readFileDate, type ImportOptions } from './import';
import type { Company } from './types';
import {
  DATE_COLUMNS,
  guessColumns,
  readImportFile,
  type ColumnMapping,
  type ImportKind,
} from '@/features/company/import-columns';
import { detectDateFormats, parseCsvRows, type DateFormat } from '@/lib/banking/statement';
import { buildWorkbook } from '@/test/workbook';

/**
 * Imports that read every date and every row as written. Made-up data only.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const OPTIONS: ImportOptions = {
  contactType: 'customer',
  documentType: 'invoice',
  asOf: '2026-09-30',
  dateFormat: 'dd/MM/yyyy',
  fileName: 'review.xlsx',
  today: '2026-10-05',
};

const company = (): Promise<Company> => setupCompany({ name: 'Review Trading' });

/**
 * What settings/import.tsx does when a file is chosen: read it, guess the
 * columns, and guess the date format from dates written as text (ISO dates
 * from spreadsheets are left out of the guess). The page starts at dd/MM/yyyy.
 */
function pageDateFormat(rows: string[][], map: ColumnMapping, kind: ImportKind): DateFormat {
  const values = DATE_COLUMNS[kind]
    .map((key) => map[key])
    .filter((index): index is number => index != null)
    .flatMap((index) => rows.slice(1).map((r) => r[index] ?? ''))
    .filter((v) => v.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim()));
  if (!values.length) return 'dd/MM/yyyy';
  return detectDateFormats(values, true)[0] ?? 'dd/MM/yyyy';
}

describe('open invoices from Excel', () => {
  it('reads real Excel date cells, whatever format is chosen for text dates', async () => {
    const c = await company();
    const workbook = buildWorkbook([
      ['Invoice number', 'Customer', 'Date', 'Due date', 'Amount due'],
      ['INV-9001', 'Made-up Customer', { date: '2026-08-15' }, { date: '2026-09-14' }, 1250.75],
      ['INV-9002', 'Made-up Customer', { date: '2026-09-02' }, null, 480],
      // Typed as text in the same file: read the way the file writes dates.
      ['INV-9003', 'Made-up Customer', '03/09/2026', '', 15],
    ]);
    const rows = await readImportFile(workbook.slice().buffer, 'open-invoices.xlsx');
    expect(rows[1].slice(2, 4)).toEqual(['2026-08-15', '2026-09-14']);
    const mapping = guessColumns('documents', rows[0], rows);
    const dateFormat = pageDateFormat(rows, mapping, 'documents');
    const plan = planImport(
      'documents',
      rows,
      mapping,
      { ...OPTIONS, dateFormat },
      await loadImportContext(c.id),
    );
    expect(
      plan.rows.map((r) => r.status),
      JSON.stringify(plan.rows.map((r) => r.issues.map((i) => i.text))),
    ).toEqual(['ready', 'ready', 'ready']);
    const dates = plan.rows.map((r) =>
      r.record?.kind === 'documents'
        ? [r.record.value.doc.issueDate, r.record.value.doc.dueDate]
        : [],
    );
    expect(dates).toEqual([
      ['2026-08-15', '2026-09-14'],
      ['2026-09-02', '2026-10-02'],
      ['2026-09-03', '2026-10-03'],
    ]);
  });

  it('reads ISO dates first, then the chosen format', () => {
    expect(readFileDate('2026-08-15', 'MM/dd/yyyy')).toBe('2026-08-15');
    expect(readFileDate('٢٠٢٦-٠٨-١٥', 'dd/MM/yyyy')).toBe('2026-08-15');
    expect(readFileDate('2026-02-30', 'dd/MM/yyyy')).toBeNull();
    expect(readFileDate('03/09/2026', 'dd/MM/yyyy')).toBe('2026-09-03');
    expect(readFileDate('03/09/2026', 'MM/dd/yyyy')).toBe('2026-03-09');
  });
});

describe('employees from a CSV', () => {
  async function birthDates(lines: string[]) {
    const c = await company();
    const rows = parseCsvRows(
      ['Employee number,Name,Nationality,Date of birth,Date of joining', ...lines].join('\n'),
    );
    const mapping = guessColumns('employees', rows[0], rows);
    expect(mapping.birthDate).toBe(3);
    const dateFormat = pageDateFormat(rows, mapping, 'employees');
    expect(dateFormat).toBe('dd/MM/yyyy');
    const plan = planImport(
      'employees',
      rows,
      mapping,
      { ...OPTIONS, dateFormat },
      await loadImportContext(c.id),
    );
    return plan.rows.map((r) => ({
      birthDate: r.record?.kind === 'employees' ? r.record.value.employee.birthDate : null,
      notes: r.issues.filter((i) => /birth/i.test(i.text)).map((i) => i.text),
    }));
  }

  it('reads a two-digit year of birth in the century before when it would be in the future', async () => {
    expect(
      await birthDates([
        '1001,Made-up Person,India,02/07/94,10/09/23',
        '1002,Another Person,Nepal,15/11/88,01/03/24',
        '1003,Third Person,India,01/01/01,01/03/24',
      ]),
    ).toEqual([
      { birthDate: '1994-07-02', notes: [] },
      { birthDate: '1988-11-15', notes: [] },
      { birthDate: '2001-01-01', notes: [] },
    ]);
  });

  it('leaves out a birth date written in full that is in the future, and says so', async () => {
    const [row] = await birthDates(['1001,Made-up Person,India,02/07/2094,10/09/2023']);
    expect(row.birthDate).toBeNull();
    expect(row.notes).toHaveLength(1);
    expect(row.notes[0]).toMatch(
      /Date of birth .*02\/07\/2094.* is in the future, so it was left empty\./,
    );
  });
});

describe('CSV text', () => {
  it('keeps rows apart when a value holds an inch mark', () => {
    const csv = ['Name,SKU,Price', 'Pipe 12",P-12,5.250', 'Monitor 27",M-27,89.000'].join('\n');
    expect(parseCsvRows(csv)).toEqual([
      ['Name', 'SKU', 'Price'],
      ['Pipe 12"', 'P-12', '5.250'],
      ['Monitor 27"', 'M-27', '89.000'],
    ]);
  });

  it('still reads quoted values, also after spaces, with commas, quotes and line breaks', () => {
    const csv = [
      'Name,Notes,Price',
      ' "Gulf, Trading","Said ""yes""\nby phone", "1,250.500"',
      '"Monitor 27"" wide",""," 5"',
      '"Quoted"then text,x"y,""',
    ].join('\r\n');
    expect(parseCsvRows(csv)).toEqual([
      ['Name', 'Notes', 'Price'],
      ['Gulf, Trading', 'Said "yes"\nby phone', '1,250.500'],
      ['Monitor 27" wide', '', '5'],
      ['Quotedthen text', 'x"y', ''],
    ]);
  });
});
