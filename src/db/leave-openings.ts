import { db } from './db';
import { logActivity } from './activity';
import { checkLeaveOpening, EmployeeError, putLeaveOpening } from './people';
import { employeeNumberKey } from './import-employees';
import type { Employee, ID, ISODate, LeaveRecord } from './types';
import {
  IMPORT_COLUMNS,
  LEAVE_BALANCE_ALIASES,
  LEAVE_BALANCE_EXACT,
  matchColumns,
  type ImportColumn,
} from '@/features/company/import-columns';
import {
  DATE_FORMATS,
  detectDateFormats,
  parseAmount,
  parseStatementDate,
  type DateFormat,
} from '@/lib/banking/statement';
import { employeesNeedingLeaveOpening, isOpeningRecord } from '@/lib/hr/leave';
import { isISODate } from '@/lib/dates';
import { normalizeDigits } from '@/lib/money';
import { newId } from '@/lib/ids';
import { msg, t } from '@/i18n';

/**
 * Opening leave balances for many employees at once: the same number of
 * days for everyone who has none yet, or each employee's own from a
 * spreadsheet (from the HR system or the records kept before).
 */

/** The columns of a leave balances spreadsheet. */
export const LEAVE_SHEET_COLUMNS: ImportColumn[] = [
  { ...IMPORT_COLUMNS.employees.find((c) => c.key === 'number')!, required: true },
  {
    key: 'days',
    label: msg('Days'),
    required: true,
    aliases: [...LEAVE_BALANCE_ALIASES, 'days brought forward', 'opening balance'],
    exact: [...LEAVE_BALANCE_EXACT, 'days', 'الأيام', 'أيام'],
  },
  {
    key: 'asOf',
    label: msg('As of'),
    aliases: ['as of date', 'as at', 'balance date', 'balance as of', 'تاريخ الرصيد', 'كما في'],
    // "Date" alone: a "Hire date" column is not the date of the balance.
    exact: ['date', 'on', 'التاريخ', 'تاريخ', 'بتاريخ'],
  },
];

export type LeaveSheetRowStatus = 'ready' | 'unmatched' | 'invalid';

export interface LeaveSheetRow {
  /** Row of the file: 2 is the first under the column names. */
  line: number;
  /** Employee number as the file writes it. */
  number: string;
  employee: Employee | null;
  days: number | null;
  /** The row's own date; null takes the date chosen for the whole file. */
  date: ISODate | null;
  status: LeaveSheetRowStatus;
  /** Why the row is not used. */
  problem: string;
  /** The employee has an opening balance already: the spreadsheet replaces it. */
  replaces: boolean;
}

export interface LeaveSheetPlan {
  /** Where each column is in the file, or null when it isn't. */
  columns: { number: number | null; days: number | null; asOf: number | null };
  headers: string[];
  /** Labels of the columns the file needs and doesn't have. */
  missing: string[];
  rows: LeaveSheetRow[];
  matched: number;
  unmatched: number;
  invalid: number;
}

/** The date format that reads the most of the values (day first on a tie). */
function dateFormatOf(values: string[], preferDayFirst: boolean): DateFormat | null {
  if (!values.length) return null;
  const every = detectDateFormats(values, preferDayFirst)[0];
  if (every) return every;
  let best: { format: DateFormat; read: number } | null = null;
  for (const { value: format } of DATE_FORMATS) {
    const read = values.filter((v) => parseStatementDate(v, format) !== null).length;
    if (read > (best?.read ?? 0)) best = { format, read };
  }
  return best?.format ?? null;
}

/**
 * Reads a spreadsheet of leave balances (the column names first): which
 * employee each row is for, by employee number, the days and the row's own
 * date. Rows that can't be used say why.
 */
export function planLeaveSheet(
  rows: string[][],
  employees: Employee[],
  records: LeaveRecord[],
  options: { preferDayFirst?: boolean } = {},
): LeaveSheetPlan {
  const headers = rows[0] ?? [];
  const mapping = matchColumns(LEAVE_SHEET_COLUMNS, headers);
  const columns = {
    number: mapping.number ?? null,
    days: mapping.days ?? null,
    asOf: mapping.asOf ?? null,
  };
  const plan: LeaveSheetPlan = {
    columns,
    headers,
    missing: LEAVE_SHEET_COLUMNS.filter((c) => c.required && mapping[c.key] == null).map(
      (c) => c.label,
    ),
    rows: [],
    matched: 0,
    unmatched: 0,
    invalid: 0,
  };
  if (plan.missing.length) return plan;

  const byNumber = new Map<string, Employee>();
  for (const e of employees) if (e.number.trim()) byNumber.set(employeeNumberKey(e.number), e);
  const opened = new Set(records.filter(isOpeningRecord).map((r) => r.employeeId));
  const cell = (row: string[], index: number | null) =>
    index == null ? '' : normalizeDigits(row[index] ?? '').trim();
  const body = rows.slice(1);
  // Spreadsheet dates come as yyyy-MM-dd; dates written as text, the way most of them read.
  const ISO = /^\d{4}-\d{2}-\d{2}/;
  const format = dateFormatOf(
    body.map((r) => cell(r, columns.asOf)).filter((v) => v && !ISO.test(v)),
    options.preferDayFirst ?? true,
  );
  const readDate = (value: string): ISODate | null => {
    if (ISO.test(value)) return isISODate(value.slice(0, 10)) ? value.slice(0, 10) : null;
    return format ? parseStatementDate(value, format) : null;
  };

  const seen = new Map<ID, number>();
  body.forEach((row, i) => {
    const line = i + 2;
    const number = cell(row, columns.number);
    const daysText = cell(row, columns.days);
    const dateText = cell(row, columns.asOf);
    if (!number && !daysText && !dateText) return;
    const add = (status: LeaveSheetRowStatus, problem: string, fields: Partial<LeaveSheetRow>) => {
      plan.rows.push({
        line,
        number,
        employee: null,
        days: null,
        date: null,
        replaces: false,
        ...fields,
        status,
        problem,
      });
      if (status === 'ready') plan.matched += 1;
      else if (status === 'unmatched') plan.unmatched += 1;
      else plan.invalid += 1;
    };
    if (!number) return add('unmatched', t('No employee number.'), {});
    const employee = byNumber.get(employeeNumberKey(number)) ?? null;
    if (!employee) return add('unmatched', t('No employee has this number.'), {});
    const before = seen.get(employee.id);
    if (before !== undefined) {
      return add('invalid', t('The same employee is on row {line}.', { line: before }), {
        employee,
      });
    }
    seen.set(employee.id, line);
    const amount = daysText ? parseAmount(daysText) : null;
    if (amount === null) {
      return add(
        'invalid',
        daysText
          ? t('“{value}” is not a number of days.', { value: `⁨${daysText}⁩` })
          : t('No days.'),
        { employee },
      );
    }
    if (amount < 0) return add('invalid', t('The days can’t be below 0.'), { employee });
    const date = dateText ? readDate(dateText) : null;
    if (dateText && !date) {
      return add('invalid', t('“{value}” is not a date.', { value: `⁨${dateText}⁩` }), {
        employee,
      });
    }
    add('ready', '', {
      employee,
      days: Math.round(amount * 100) / 100,
      date,
      replaces: Boolean(employee.leaveOpening?.confirmed) || opened.has(employee.id),
    });
  });
  return plan;
}

/** One employee's opening leave balance to set. */
export interface LeaveOpeningEntry {
  employeeId: ID;
  date: ISODate;
  days: number;
}

/**
 * Sets the opening leave balances a spreadsheet gives, confirmed, with one
 * activity entry for all. The spreadsheet wins: an opening balance an
 * employee it names already had is replaced.
 */
export async function setLeaveOpeningsFromSheet(
  companyId: ID,
  entries: LeaveOpeningEntry[],
): Promise<number> {
  const checked = entries.map((e) => ({ employeeId: e.employeeId, ...checkLeaveOpening(e) }));
  if (checked.length === 0) throw new EmployeeError(t('There is nothing to set.'));
  return db.transaction('rw', [db.employees, db.leaveRecords, db.activities], async () => {
    let count = 0;
    for (const entry of checked) {
      const employee = await db.employees.get(entry.employeeId);
      if (!employee || employee.companyId !== companyId) continue;
      await putLeaveOpening(employee, entry, { replace: true });
      count += 1;
    }
    if (count > 0) {
      await logActivity(companyId, 'employee', newId(), 'leave_opening', {
        text:
          count === 1
            ? msg('Leave brought forward set for {count} employee from a spreadsheet')
            : msg('Leave brought forward set for {count} employees from a spreadsheet'),
        vars: { count },
      });
    }
    return count;
  });
}

/**
 * Gives every employee who needs an opening leave balance (see
 * employeesNeedingLeaveOpening) the same one, confirmed, with one activity
 * entry for all. Employees with a balance keep theirs.
 */
export async function setLeaveOpeningForEveryone(
  companyId: ID,
  input: { date: ISODate; days: number },
): Promise<number> {
  const opening = checkLeaveOpening(input);
  return db.transaction('rw', [db.employees, db.leaveRecords, db.activities], async () => {
    const [employees, records] = await Promise.all([
      db.employees.where('companyId').equals(companyId).toArray(),
      db.leaveRecords.where('companyId').equals(companyId).toArray(),
    ]);
    const targets = employeesNeedingLeaveOpening(employees, records);
    if (targets.length === 0) {
      throw new EmployeeError(t('Every current employee has an opening leave balance already.'));
    }
    for (const employee of targets) await putLeaveOpening(employee, opening);
    await logActivity(companyId, 'employee', newId(), 'leave_opening', {
      text:
        targets.length === 1
          ? msg('Leave brought forward set for {count} employee: {days} days on {date}')
          : msg('Leave brought forward set for {count} employees: {days} days on {date}'),
      vars: { count: targets.length, days: opening.days, date: opening.date },
    });
    return targets.length;
  });
}
