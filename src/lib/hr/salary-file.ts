import type { SalaryFileColumn, SalaryFileLayout, SalaryPeriodFormat } from '@/db/types';
import {
  bankFromIban,
  compactIban,
  isValidCardNumber,
  isValidIban,
  KUWAIT_BANKS,
} from '@/lib/kuwait';
import { toCsv } from '@/lib/csv';
import { fromMinor, toMinor } from '@/lib/money';
import { msg } from '@/i18n';

/**
 * The salary transfer file a bank takes to pay salaries into employees'
 * accounts (Labour Law art. 57; the Wage Protection System). Kuwait has no
 * public standard layout, so the columns are configurable, with presets.
 */

export const SALARY_FILE_COLUMNS: Record<SalaryFileColumn, { label: string; header: string }> = {
  employeeNumber: { label: msg('Employee number'), header: 'Employee No' },
  civilId: { label: msg('Civil ID number'), header: 'Civil ID' },
  nameEn: { label: msg('Name (English)'), header: 'Employee Name' },
  nameAr: { label: msg('Name (Arabic)'), header: 'Employee Name (Arabic)' },
  iban: { label: msg('IBAN'), header: 'IBAN' },
  accountNumber: { label: msg('Account or salary card number'), header: 'Account/Card No' },
  bankCode: { label: msg('Bank code'), header: 'Bank Code' },
  swift: { label: msg('SWIFT code'), header: 'SWIFT' },
  amount: { label: msg('Amount'), header: 'Amount' },
  currency: { label: msg('Currency'), header: 'Currency' },
  period: { label: msg('Salary month'), header: 'Salary Month' },
  pamFile: { label: msg('PAM file number'), header: 'PAM File No' },
  reference: { label: msg('Reference'), header: 'Reference' },
};

/**
 * The number the bank's salary file gives a pay line: the Civil ID, or for
 * a stateless employee without one, their review card number.
 */
export function salaryFileCivilId(line: { civilId: string; centralCardNumber?: string }): string {
  return line.civilId || line.centralCardNumber || '';
}

export const SALARY_FILE_COLUMN_ORDER = Object.keys(SALARY_FILE_COLUMNS) as SalaryFileColumn[];

export interface SalaryFilePreset {
  id: string;
  label: string;
  layout: Omit<SalaryFileLayout, 'preset'>;
}

export const SALARY_FILE_PRESETS: SalaryFilePreset[] = [
  {
    id: 'wps',
    label: msg('Wage protection (WPS) – full details'),
    layout: {
      columns: [
        'employeeNumber',
        'civilId',
        'nameEn',
        'nameAr',
        'iban',
        'accountNumber',
        'bankCode',
        'amount',
        'period',
        'pamFile',
      ],
      header: true,
      periodFormat: 'yyyymm',
    },
  },
  {
    id: 'transfer',
    label: msg('Bulk bank transfer – IBAN, name and amount'),
    layout: {
      columns: ['iban', 'nameEn', 'amount', 'currency', 'reference'],
      header: true,
      periodFormat: 'yyyymm',
    },
  },
  {
    id: 'swift',
    label: msg('Bank transfer with SWIFT codes'),
    layout: {
      columns: ['employeeNumber', 'nameEn', 'iban', 'swift', 'amount', 'currency', 'reference'],
      header: true,
      periodFormat: 'mm/yyyy',
    },
  },
];

export function presetLayout(id: string): SalaryFileLayout {
  const preset = SALARY_FILE_PRESETS.find((p) => p.id === id) ?? SALARY_FILE_PRESETS[0];
  return { preset: preset.id, ...preset.layout, columns: [...preset.layout.columns] };
}

/**
 * A saved layout as it is used now: one saved from a preset (anything
 * changed makes it "custom") takes the preset's current columns, so the WPS
 * layout saved before gets the account or card number column.
 */
export function currentLayout(layout: SalaryFileLayout): SalaryFileLayout {
  return SALARY_FILE_PRESETS.some((p) => p.id === layout.preset)
    ? presetLayout(layout.preset)
    : layout;
}

export function formatSalaryPeriod(period: string, format: SalaryPeriodFormat): string {
  const [year, month] = period.split('-');
  if (format === 'yyyy-mm') return `${year}-${month}`;
  if (format === 'mm/yyyy') return `${month}/${year}`;
  return `${year}${month}`;
}

export interface SalaryFileEntry {
  employeeId: string;
  employeeNumber: string;
  civilId: string;
  nameEn: string;
  nameAr: string;
  iban: string;
  /** Account or salary card number, used when there is no IBAN. */
  accountNumber?: string;
  amount: number;
}

/** An account or salary card number without spaces or dashes. */
const compactAccount = (value: string | undefined) => (value ?? '').replace(/[\s-]/g, '');

/**
 * Where the salary goes: the IBAN, or for staff without one an account or
 * salary card number (common for workers paid on salary cards).
 */
export function payAccount(entry: Pick<SalaryFileEntry, 'iban' | 'accountNumber'>): string {
  const iban = compactIban(entry.iban);
  if (iban) return iban;
  return compactAccount(entry.accountNumber);
}

/** A number that looks like a payment card (16 to 19 digits from 4 or 5) but fails its check digit. */
function doubtfulCard(account: string): boolean {
  return /^[45]\d{12,18}$/.test(account) && !isValidCardNumber(account);
}

/** Whether the salary can be paid: a valid IBAN, or no IBAN and an account or card number. */
export function hasPayAccount(entry: Pick<SalaryFileEntry, 'iban' | 'accountNumber'>): boolean {
  if (compactIban(entry.iban)) return isValidIban(entry.iban);
  return payAccount(entry) !== '';
}

export interface SalaryFileOptions {
  layout: SalaryFileLayout;
  period: string;
  currency: string;
  precision: number;
  pamFileNumber: string;
  reference: string;
}

export interface SalaryFile {
  headers: string[];
  rows: string[][];
  /** Total of the amounts in the file, in minor units. */
  totalMinor: number;
  count: number;
  /**
   * Employees whose IBAN is invalid, or who have neither an IBAN nor an
   * account number; the file is not ready while there are any.
   */
  problems: SalaryFileEntry[];
  /**
   * Staff paid on an account or salary card number, left out of a layout
   * without the column for it: they are paid another way.
   */
  leftOut: SalaryFileEntry[];
  /** Total of the amounts left out, in minor units. */
  leftOutMinor: number;
  /** In the file with a card number that doesn't pass its check digit: worth checking. */
  checks: SalaryFileEntry[];
}

function cell(column: SalaryFileColumn, entry: SalaryFileEntry, options: SalaryFileOptions) {
  const iban = compactIban(entry.iban);
  switch (column) {
    case 'employeeNumber':
      return entry.employeeNumber;
    case 'civilId':
      return entry.civilId;
    case 'nameEn':
      return entry.nameEn;
    case 'nameAr':
      return entry.nameAr || entry.nameEn;
    case 'iban':
      // Only an IBAN: a card number in it would be refused or paid wrongly.
      return iban;
    case 'accountNumber':
      // The salary goes to the IBAN while there is one.
      return iban ? '' : compactAccount(entry.accountNumber);
    case 'bankCode':
      return iban ? (bankFromIban(iban)?.code ?? iban.slice(4, 8)) : '';
    case 'swift': {
      const code = bankFromIban(iban)?.code;
      return KUWAIT_BANKS.find((b) => b.code === code)?.swift ?? '';
    }
    case 'amount':
      return fromMinor(toMinor(entry.amount, options.precision), options.precision).toFixed(
        options.precision,
      );
    case 'currency':
      return options.currency;
    case 'period':
      return formatSalaryPeriod(options.period, options.layout.periodFormat);
    case 'pamFile':
      return options.pamFileNumber;
    case 'reference':
      return options.reference;
  }
}

/**
 * Builds the file: one row per employee with pay to transfer (net pay above
 * zero), amounts with the currency's decimals and no thousands separators.
 * An IBAN goes in the IBAN column only; staff paid on an account or salary
 * card number go in the file when the layout has a column for it, and are
 * listed as left out when it hasn't.
 */
export function buildSalaryFile(
  entries: SalaryFileEntry[],
  options: SalaryFileOptions,
): SalaryFile {
  const paid = entries.filter((e) => toMinor(e.amount, options.precision) > 0);
  const columns = options.layout.columns.length ? options.layout.columns : ['amount' as const];
  const cards = columns.includes('accountNumber');
  const problems = paid.filter((e) => !hasPayAccount(e));
  const onCard = (e: SalaryFileEntry) => !compactIban(e.iban) && hasPayAccount(e);
  const leftOut = cards ? [] : paid.filter(onCard);
  // Rows with problems stay in the preview; the file isn't offered until they are fixed.
  const inFile = paid.filter((e) => !leftOut.includes(e));
  const minor = (list: SalaryFileEntry[]) =>
    list.reduce((s, e) => s + toMinor(e.amount, options.precision), 0);
  return {
    headers: columns.map((c) => SALARY_FILE_COLUMNS[c].header),
    rows: inFile.map((e) => columns.map((c) => cell(c, e, options))),
    totalMinor: minor(inFile),
    count: inFile.length,
    problems,
    leftOut,
    leftOutMinor: minor(leftOut),
    checks: inFile.filter(
      (e) => !problems.includes(e) && onCard(e) && doubtfulCard(compactAccount(e.accountNumber)),
    ),
  };
}

/** The file as CSV text, with or without the header row. */
export function salaryFileCsv(file: SalaryFile, header: boolean): string {
  if (header) return toCsv(file.headers, file.rows);
  if (file.rows.length === 0) return '';
  return toCsv(file.rows[0], file.rows.slice(1));
}
