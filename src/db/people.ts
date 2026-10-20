import { db } from './db';
import { logActivity } from './activity';
import { defaultNumbering, nowStamp } from './defaults';
import type {
  Attachment,
  Department,
  Employee,
  EmployeeAllowance,
  ID,
  ISODate,
  PeopleSettings,
} from './types';
import { allocateNumber } from '@/lib/numbering';
import { newId, shortId } from '@/lib/ids';
import { isISODate, today } from '@/lib/dates';
import { currencyPrecision, normalizeDigits, round } from '@/lib/money';
import { compactIban, normalizeKuwaitPhone } from '@/lib/kuwait';
import { normalizeReminderDays } from '@/lib/compliance';
import { EOSI_RULES } from '@/lib/hr/eosi';
import { defaultPeopleSettings, withPeopleDefaults } from '@/lib/hr/people-settings';
import { ANNUAL_LEAVE_DAYS, isOpeningRecord } from '@/lib/hr/leave';
import { isStateless } from '@/lib/hr/employees';
import { departmentKey, findDepartment, normalizeDepartments } from '@/lib/hr/departments';
import { msg, t } from '@/i18n';

/* -------------------------------------------------------------------------- */
/* Employees                                                                  */
/* -------------------------------------------------------------------------- */

export function createEmployee(companyId: ID, overrides: Partial<Employee> = {}): Employee {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    number: '',
    name: '',
    nameAr: '',
    nationality: 'KW',
    category: 'kuwaiti',
    birthDate: null,
    gender: null,
    civilId: '',
    civilIdExpiry: null,
    passportNumber: '',
    passportExpiry: null,
    residencyArticle: '18',
    residencyNumber: '',
    residencyExpiry: null,
    workPermitNumber: '',
    pamJobTitle: '',
    permitSalary: 0,
    workPermitExpiry: null,
    jobTitle: '',
    jobTitleAr: '',
    department: '',
    hireDate: today(),
    probationEnd: null,
    contractType: 'unlimited',
    contractEnd: null,
    payBasis: 'monthly',
    basicSalary: 0,
    allowances: [],
    bank: '',
    iban: '',
    accountNumber: '',
    pifssNumber: '',
    phone: '',
    email: '',
    status: 'active',
    leavingDate: null,
    leavingReason: null,
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

export function newAllowance(overrides: Partial<EmployeeAllowance> = {}): EmployeeAllowance {
  return { id: shortId(), name: '', nameAr: '', amount: 0, countsForEos: true, ...overrides };
}

export class EmployeeError extends Error {}

/** An account or salary card number as stored: without spaces or dashes. */
export function compactAccountNumber(value: string | undefined): string {
  return normalizeDigits(value ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

/**
 * Saves an employee, giving new ones the next employee number. With
 * `log: false` no activity entry is written (an import writes one for all).
 *
 * `expectedUpdatedAt` is the version a form was opened on: when the record
 * changed since (on another device, in another tab, by a settlement), the
 * save is refused instead of putting back what the form still shows. An
 * employee with a final settlement stays marked as left.
 */
export async function saveEmployee(
  input: Employee,
  options: { log?: boolean; expectedUpdatedAt?: string } = {},
): Promise<Employee> {
  return db.transaction(
    'rw',
    [db.employees, db.companies, db.activities, db.finalSettlements],
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new EmployeeError(t('Company not found'));
      const name = input.name.trim();
      if (!name) throw new EmployeeError(t('Enter the employee’s name.'));
      const places = currencyPrecision(company.currency);
      const existing = await db.employees.get(input.id);
      if (
        existing &&
        options.expectedUpdatedAt !== undefined &&
        existing.updatedAt !== options.expectedUpdatedAt
      ) {
        throw new EmployeeError(
          t(
            'This employee was changed somewhere else after you opened the form. Reload the page to see the changes, then make yours again.',
          ),
        );
      }
      if (existing && input.status !== 'left') {
        const settled = await db.finalSettlements
          .where('employeeId')
          .equals(existing.id)
          .filter((s) => s.status !== 'reversed')
          .count();
        if (settled > 0) {
          throw new EmployeeError(
            t(
              '{name} has a final settlement, so they stay marked as left. Reverse the settlement to make them current again.',
              { name: existing.name },
            ),
          );
        }
      }

      let employee: Employee = {
        ...input,
        name,
        nameAr: input.nameAr?.trim() ?? '',
        number: input.number.trim(),
        jobTitle: input.jobTitle.trim(),
        jobTitleAr: input.jobTitleAr?.trim() ?? '',
        department: input.department.trim(),
        civilId: input.civilId.replace(/\s/g, ''),
        ...(input.centralCardNumber !== undefined
          ? { centralCardNumber: input.centralCardNumber.trim() }
          : {}),
        iban: compactIban(input.iban),
        accountNumber: compactAccountNumber(input.accountNumber),
        birthDate: input.birthDate || null,
        gender: input.gender === 'male' || input.gender === 'female' ? input.gender : null,
        // Changed only by setEmployeePhoto and removeEmployeePhoto: a form
        // opened before a new photo doesn't bring the old one back.
        photoId: existing ? (existing.photoId ?? null) : (input.photoId ?? null),
        // Changed only by setLeaveOpening, likewise.
        leaveOpening: existing ? (existing.leaveOpening ?? null) : (input.leaveOpening ?? null),
        phone: input.phone.trim() ? (normalizeKuwaitPhone(input.phone) ?? input.phone.trim()) : '',
        email: input.email.trim(),
        basicSalary: round(Math.max(0, input.basicSalary), places),
        permitSalary: round(Math.max(0, input.permitSalary), places),
        allowances: input.allowances
          .map((a) => ({
            ...a,
            name: a.name.trim(),
            nameAr: a.nameAr?.trim() ?? '',
            amount: round(Math.max(0, a.amount), places),
          }))
          .filter((a) => a.name || a.nameAr || a.amount > 0),
        contractEnd: input.contractType === 'fixed' ? input.contractEnd : null,
        leavingDate: input.status === 'left' ? (input.leavingDate ?? today()) : null,
        // Only a reason someone chose: the form and "Mark as left" ask for it,
        // and the final settlement asks again when it is missing.
        leavingReason: input.status === 'left' ? (input.leavingReason ?? null) : null,
        updatedAt: nowStamp(),
      };
      // The flag counts only on an expatriate; when it doesn't, it is left out.
      if (!isStateless(employee)) delete employee.stateless;
      // Days a year of their own: none, or at least the law's 30.
      if (employee.annualLeaveDays !== undefined) {
        const days = employee.annualLeaveDays;
        if (days === null || !Number.isFinite(days) || days <= 0) {
          employee.annualLeaveDays = null;
        } else if (days < ANNUAL_LEAVE_DAYS) {
          throw new EmployeeError(t('Annual leave can’t be less than 30 days a year (art. 70).'));
        } else {
          employee.annualLeaveDays = round(Math.min(366, days), 2);
        }
      }

      const others = (await db.employees.where('companyId').equals(company.id).toArray()).filter(
        (e) => e.id !== employee.id,
      );
      const taken = new Set(others.map((e) => e.number.toLowerCase()));
      if (employee.number && taken.has(employee.number.toLowerCase())) {
        throw new EmployeeError(
          t('Employee number {number} is already used.', { number: employee.number }),
        );
      }
      if (!employee.number) {
        const rule = company.numbering.employee ?? defaultNumbering().employee;
        const allocated = allocateNumber(rule, employee.hireDate ?? today(), (n) =>
          taken.has(n.toLowerCase()),
        );
        employee = { ...employee, number: allocated.number };
        await db.companies.put({
          ...company,
          numbering: { ...company.numbering, employee: allocated.rule },
        });
      }
      if (!existing) employee.createdAt = employee.updatedAt;
      await db.employees.put(employee);
      if (options.log === false) return employee;

      const vars = { name: employee.name, number: employee.number };
      const arabic = { name: employee.nameAr };
      if (!existing) {
        await logActivity(company.id, 'employee', employee.id, 'created', {
          text: msg('Employee {name} ({number}) added'),
          vars,
          arabic,
        });
      } else if (existing.status !== 'left' && employee.status === 'left') {
        await logActivity(company.id, 'employee', employee.id, 'left', {
          text: msg('Employee {name} ({number}) marked as left'),
          vars,
          arabic,
        });
      } else {
        await logActivity(company.id, 'employee', employee.id, 'updated', {
          text: msg('Employee {name} ({number}) updated'),
          vars,
          arabic,
        });
      }
      return employee;
    },
  );
}

/** An opening leave balance as entered: a date and days (0 or more, to 2 decimals). */
export function checkLeaveOpening(input: { date: ISODate; days: number }): {
  date: ISODate;
  days: number;
} {
  if (!isISODate(input.date)) throw new EmployeeError(t('Enter the date.'));
  const days = Math.round(input.days * 100) / 100;
  if (!Number.isFinite(days) || days < 0) {
    throw new EmployeeError(t('Enter the number of days.'));
  }
  return { date: input.date, days };
}

/**
 * Puts an employee's opening leave balance, confirmed. With `replace` (a
 * spreadsheet or an import that names the employee wins), opening leave
 * records on or after its date are cancelled: they would count instead.
 * Runs in a transaction with the employees and leave records.
 */
export async function putLeaveOpening(
  employee: Employee,
  opening: { date: ISODate; days: number },
  options: { replace?: boolean } = {},
): Promise<Employee> {
  const stamp = nowStamp();
  const updated: Employee = {
    ...employee,
    leaveOpening: { date: opening.date, days: opening.days, confirmed: true },
    updatedAt: stamp,
  };
  await db.employees.put(updated);
  if (options.replace) {
    const later = await db.leaveRecords
      .where('employeeId')
      .equals(employee.id)
      .filter((r) => isOpeningRecord(r) && r.start >= opening.date)
      .toArray();
    for (const record of later) {
      await db.leaveRecords.put({ ...record, status: 'cancelled', updatedAt: stamp });
    }
  }
  return updated;
}

/**
 * Sets the annual leave an employee brought forward (from the records kept
 * before) and marks it as confirmed. Leave accrues only from its date, so
 * nothing before it is counted, provisioned or paid out.
 */
export async function setLeaveOpening(
  employeeId: ID,
  input: { date: ISODate; days: number },
): Promise<Employee> {
  return db.transaction('rw', [db.employees, db.leaveRecords, db.activities], async () => {
    const employee = await db.employees.get(employeeId);
    if (!employee) throw new EmployeeError(t('This employee could not be found.'));
    const { days } = checkLeaveOpening(input);
    const updated = await putLeaveOpening(employee, { date: input.date, days });
    await logActivity(employee.companyId, 'employee', employee.id, 'leave_opening', {
      text: msg('Leave brought forward for {name}: {days} days on {date}'),
      vars: { name: employee.name, days, date: input.date },
      arabic: { name: employee.nameAr },
    });
    return updated;
  });
}

/** Whether the employee has renewals or register documents. */
export async function employeeHasHistory(id: ID): Promise<boolean> {
  const [renewals, documents] = await Promise.all([
    db.renewals.where('employeeId').equals(id).count(),
    db.complianceDocuments.where('employeeId').equals(id).count(),
  ]);
  return renewals + documents > 0;
}

/**
 * Whether the employee has payroll history: pay-run lines, leave, staff loans
 * or a final settlement. These are part of the accounts, so the employee is
 * marked as left instead of deleted.
 */
export async function employeeHasPayrollHistory(employee: Pick<Employee, 'id' | 'companyId'>) {
  const [runs, loans, leave, settlements] = await Promise.all([
    db.payRuns
      .where('companyId')
      .equals(employee.companyId)
      .filter((run) => run.lines.some((line) => line.employeeId === employee.id))
      .count(),
    db.staffLoans.where('employeeId').equals(employee.id).count(),
    db.leaveRecords.where('employeeId').equals(employee.id).count(),
    db.finalSettlements.where('employeeId').equals(employee.id).count(),
  ]);
  return runs + loans + leave + settlements > 0;
}

/** What deleting an employee removes, for the confirmation. */
export interface EmployeeDeletion {
  documents: number;
  renewals: number;
  files: number;
  /** Payroll history: the employee can't be deleted, only marked as left. */
  payroll: boolean;
}

async function personnelFile(id: ID) {
  const [documents, renewals] = await Promise.all([
    db.complianceDocuments.where('employeeId').equals(id).toArray(),
    db.renewals.where('employeeId').equals(id).toArray(),
  ]);
  const owners = [id, ...documents.map((d) => d.id), ...renewals.map((r) => r.id)];
  const files = await db.attachments.where('ownerId').anyOf(owners).toArray();
  return { documents, renewals, files, owners };
}

export async function employeeDeletion(employee: Employee): Promise<EmployeeDeletion> {
  const [file, payroll] = await Promise.all([
    personnelFile(employee.id),
    employeeHasPayrollHistory(employee),
  ]);
  return {
    documents: file.documents.length,
    renewals: file.renewals.length,
    files: file.files.length,
    payroll,
  };
}

/**
 * Deletes an employee and everything about them: their documents and
 * renewals in the register, every file kept with them or with those, and
 * the activity entries about them (those about documents deleted before
 * too). One entry records the deletion, with only the employee number.
 * Renewal fees stay in the books as expenses, described as a document
 * renewal fee, without the name, the document's number or the renewal's
 * note. Employees with payroll history can't be deleted (the accounts depend
 * on it): mark them as left.
 */
export async function deleteEmployee(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.employees,
      db.renewals,
      db.complianceDocuments,
      db.attachments,
      db.activities,
      db.expenses,
      db.payRuns,
      db.staffLoans,
      db.leaveRecords,
      db.finalSettlements,
    ],
    async () => {
      const employee = await db.employees.get(id);
      if (!employee) return;
      if (await employeeHasPayrollHistory(employee)) {
        throw new EmployeeError(
          t(
            'This employee has payroll records, which are part of the accounts. Mark them as left instead.',
          ),
        );
      }
      const { documents, renewals, files, owners } = await personnelFile(id);
      const names = [employee.name, employee.nameAr].filter((n): n is string => Boolean(n?.trim()));
      const plain = (text: string) => normalizeDigits(text).replace(/[\s-]/g, '').toUpperCase();
      const numbers = new Set(
        [
          employee.civilId,
          employee.passportNumber,
          employee.residencyNumber,
          employee.workPermitNumber,
          employee.centralCardNumber ?? '',
          ...documents.map((d) => d.number),
          ...renewals.map((r) => r.number ?? ''),
        ]
          .map(plain)
          .filter(Boolean),
      );
      const unnamed = (text: string) =>
        names.reduce((out, name) => out.split(name).join(employee.number), text);
      for (const renewal of renewals) {
        if (!renewal.expenseId) continue;
        const expense = await db.expenses.get(renewal.expenseId);
        if (!expense) continue;
        // Expenses are seen by staff: no name, document number or renewal note.
        const scrubbed = {
          description: t('Document renewal fee'),
          reference: numbers.has(plain(expense.reference)) ? '' : unnamed(expense.reference),
          notes:
            expense.notes.trim() && expense.notes.trim() === renewal.note.trim()
              ? ''
              : unnamed(expense.notes),
        };
        if (
          scrubbed.description !== expense.description ||
          scrubbed.reference !== expense.reference ||
          scrubbed.notes !== expense.notes
        ) {
          await db.expenses.put({ ...expense, ...scrubbed, updatedAt: nowStamp() });
        }
      }
      await db.attachments.bulkDelete(files.map((f) => f.id));
      await db.activities.where('entityId').anyOf(owners).delete();
      // About their documents, also those deleted before (they carry the employee).
      await db.activities
        .where('companyId')
        .equals(employee.companyId)
        .filter((a) => a.employeeId === id)
        .delete();
      await db.renewals.bulkDelete(renewals.map((r) => r.id));
      await db.complianceDocuments.bulkDelete(documents.map((d) => d.id));
      await db.employees.delete(id);
      await logActivity(employee.companyId, 'employee', id, 'deleted', {
        text: msg('Employee {number} deleted'),
        vars: { number: employee.number },
      });
    },
  );
}

/**
 * One activity entry for scans added to several personnel files at once
 * (each file is added with `addAttachment`).
 */
export async function logPersonnelFilesAdded(
  companyId: ID,
  files: number,
  employees: number,
): Promise<void> {
  if (files === 0) return;
  await logActivity(companyId, 'employee', newId(), 'files', {
    text:
      files === 1
        ? msg('{count} file added to a personnel file')
        : msg('{count} files added to {employees} personnel files'),
    vars: { count: files, employees },
  });
}

/** One activity entry for the scans "Add documents" filed as driving licences. */
export async function logDrivingLicencesFiled(
  companyId: ID,
  files: number,
  employees: number,
): Promise<void> {
  if (files === 0) return;
  await logActivity(companyId, 'employee', newId(), 'files', {
    text:
      files === 1
        ? msg('{count} scan filed as a driving licence')
        : msg('{count} scans filed as the driving licences of {employees} employees'),
    vars: { count: files, employees },
  });
}

/* -------------------------------------------------------------------------- */
/* Photos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Gives an employee a photo (a small square JPEG, see photoFromFile),
 * replacing the one they had. The photo is one of their attachments, so it
 * syncs and stays private like the rest of their personnel file.
 */
export async function setEmployeePhoto(
  employeeId: ID,
  photo: { name: string; dataUrl: string },
): Promise<Employee> {
  return db.transaction('rw', [db.employees, db.attachments], async () => {
    const employee = await db.employees.get(employeeId);
    if (!employee) throw new EmployeeError(t('This employee could not be found.'));
    const attachment: Attachment = {
      id: newId(),
      companyId: employee.companyId,
      ownerId: employee.id,
      name: photo.name.replace(/\.[a-z0-9]{1,5}$/i, '') + '.jpg',
      type: 'image/jpeg',
      size: Math.round((photo.dataUrl.length * 3) / 4),
      dataUrl: photo.dataUrl,
      createdAt: nowStamp(),
    };
    await db.attachments.add(attachment);
    if (employee.photoId) await db.attachments.delete(employee.photoId);
    const updated: Employee = { ...employee, photoId: attachment.id, updatedAt: nowStamp() };
    await db.employees.put(updated);
    return updated;
  });
}

/** Removes an employee's photo, and its file. */
export async function removeEmployeePhoto(employeeId: ID): Promise<void> {
  await db.transaction('rw', [db.employees, db.attachments], async () => {
    const employee = await db.employees.get(employeeId);
    if (!employee?.photoId) return;
    await db.attachments.delete(employee.photoId);
    await db.employees.put({ ...employee, photoId: null, updatedAt: nowStamp() });
  });
}

/** One activity entry for photos given to several employees at once. */
export async function logEmployeePhotosAdded(companyId: ID, photos: number): Promise<void> {
  if (photos === 0) return;
  await logActivity(companyId, 'employee', newId(), 'photos', {
    text: photos === 1 ? msg('{count} employee photo added') : msg('{count} employee photos added'),
    vars: { count: photos },
  });
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export { defaultPeopleSettings };

/** A company's people and compliance settings, with defaults for anything not set. */
export async function getPeopleSettings(companyId: ID): Promise<PeopleSettings> {
  return withPeopleDefaults(companyId, await db.peopleSettings.get(companyId));
}

export function normalizePeopleSettings(input: PeopleSettings): PeopleSettings {
  const whole = (n: number, min: number, max: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  const target = input.kuwaitizationTarget;
  return {
    ...input,
    ...(input.departments ? { departments: normalizeDepartments(input.departments) } : {}),
    id: input.companyId,
    kuwaitizationTarget:
      target === null || !Number.isFinite(target) || target <= 0
        ? null
        : Math.min(100, round(target, 1)),
    eosDailyDivisor: whole(input.eosDailyDivisor, 1, 31, EOSI_RULES.defaultDailyDivisor),
    reminderDays: normalizeReminderDays(input.reminderDays).slice(0, 5),
    auditFilingMonths: whole(input.auditFilingMonths, 1, 12, 3),
    pifssDueDay: whole(input.pifssDueDay, 1, 28, 15),
  };
}

/**
 * Saves the reminders, deadlines and end-of-service settings. The search
 * across companies and the departments keep what is saved: they are changed
 * by their own functions, so a form opened before a change doesn't put the
 * old value back.
 */
export async function savePeopleSettings(input: PeopleSettings): Promise<PeopleSettings> {
  return db.transaction('rw', [db.peopleSettings, db.activities], async () => {
    const stored = await db.peopleSettings.get(input.companyId);
    const next: PeopleSettings = { ...input };
    if (stored) {
      delete next.groupSearch;
      delete next.departments;
      if (stored.groupSearch !== undefined) next.groupSearch = stored.groupSearch;
      if (stored.departments !== undefined) next.departments = stored.departments;
    }
    const settings = { ...normalizePeopleSettings(next), updatedAt: nowStamp() };
    await db.peopleSettings.put(settings);
    await logActivity(settings.companyId, 'compliance', settings.id, 'settings', {
      text: msg('Employee and compliance settings updated'),
    });
    return settings;
  });
}

/**
 * Lets the company's employees be found from the other companies on this
 * device (People → All companies, and search), or stops it.
 */
export async function setGroupSearch(companyId: ID, on: boolean): Promise<PeopleSettings> {
  return db.transaction('rw', [db.peopleSettings, db.activities], async () => {
    const before = await getPeopleSettings(companyId);
    if ((before.groupSearch === true) === on) return before;
    const settings = {
      ...normalizePeopleSettings({ ...before, groupSearch: on }),
      updatedAt: nowStamp(),
    };
    await db.peopleSettings.put(settings);
    // Private, like the rest of payroll and people.
    await logActivity(companyId, 'payroll', settings.id, 'settings', {
      text: on
        ? msg('Employees included in the search across companies')
        : msg('Employees left out of the search across companies'),
    });
    return settings;
  });
}

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */

const tidyName = (text: string | undefined) => (text ?? '').trim().replace(/\s+/g, ' ');

/** The company's settings and its list of departments, read in the running transaction. */
async function departmentList(companyId: ID) {
  const settings = await getPeopleSettings(companyId);
  return { settings, list: normalizeDepartments(settings.departments) };
}

async function putDepartments(settings: PeopleSettings, list: Department[]) {
  const next = {
    ...normalizePeopleSettings({ ...settings, departments: list }),
    updatedAt: nowStamp(),
  };
  await db.peopleSettings.put(next);
  return next;
}

/** Names checked before saving: an English name, and neither name already another department's. */
function checkDepartmentNames(
  list: readonly Department[],
  input: { name: string; nameAr?: string },
  exceptId?: ID,
): { name: string; nameAr: string } {
  const nameAr = tidyName(input.nameAr);
  const name = tidyName(input.name) || nameAr;
  if (!name) throw new EmployeeError(t('Enter the department’s name.'));
  const others = list.filter((d) => d.id !== exceptId);
  for (const text of [name, nameAr]) {
    const taken = text ? findDepartment(others, text) : undefined;
    if (taken) {
      throw new EmployeeError(
        t('There is already a department called {name}.', { name: taken.name }),
      );
    }
  }
  return { name, nameAr };
}

/** Logged as people data: only owners, admins and accountants see it. */
function logDepartment(
  companyId: ID,
  text: string,
  vars: Record<string, string | number>,
  arabic: Record<string, string | undefined> = {},
) {
  return logActivity(companyId, 'employee', newId(), 'departments', { text, vars, arabic });
}

/** Adds a department to the company's list, which starts the list when there is none. */
export async function addDepartment(
  companyId: ID,
  input: { name: string; nameAr?: string },
): Promise<Department> {
  return db.transaction('rw', [db.peopleSettings, db.activities], async () => {
    const { settings, list } = await departmentList(companyId);
    const department: Department = { id: newId(), ...checkDepartmentNames(list, input) };
    await putDepartments(settings, [...list, department]);
    await logDepartment(
      companyId,
      msg('Department {name} added'),
      { name: department.name },
      { name: department.nameAr },
    );
    return department;
  });
}

/**
 * Adds the departments the company's employees have that aren't in the
 * list yet (a name that is another one's Arabic name is left out: it is the
 * same department). Returns how many were added.
 */
export async function addDepartmentsInUse(companyId: ID): Promise<number> {
  return db.transaction('rw', [db.peopleSettings, db.employees, db.activities], async () => {
    const { settings, list } = await departmentList(companyId);
    const employees = await db.employees.where('companyId').equals(companyId).toArray();
    // Each department once, spelt as most of its employees have it (capitals first).
    const spellings = new Map<string, Map<string, number>>();
    for (const e of employees) {
      const name = tidyName(e.department);
      if (!name) continue;
      const forms = spellings.get(departmentKey(name)) ?? new Map<string, number>();
      forms.set(name, (forms.get(name) ?? 0) + 1);
      spellings.set(departmentKey(name), forms);
    }
    const byUse = (a: [string, number], b: [string, number]) =>
      b[1] - a[1] || a[0].localeCompare(b[0], undefined, { caseFirst: 'upper' });
    const names = [...spellings.values()]
      .map((forms) => [...forms].sort(byUse)[0][0])
      .sort((a, b) => a.localeCompare(b));
    const added: Department[] = [];
    for (const name of names) {
      if (findDepartment([...list, ...added], name)) continue;
      added.push({ id: newId(), name, nameAr: '' });
    }
    if (!added.length) return 0;
    await putDepartments(settings, [...list, ...added]);
    await logDepartment(companyId, msg('Departments added from the employees: {names}'), {
      names: added.map((d) => d.name).join(', '),
    });
    return added.length;
  });
}

/**
 * Renames a department or changes its Arabic name. A new English name is
 * given to every employee in the department in the same transaction (they
 * keep the English name), so the list and the employees never disagree on
 * this device. Returns the department and how many employees moved.
 */
export async function updateDepartment(
  companyId: ID,
  id: ID,
  input: { name: string; nameAr?: string },
): Promise<{ department: Department; moved: number }> {
  return db.transaction('rw', [db.peopleSettings, db.employees, db.activities], async () => {
    const { settings, list } = await departmentList(companyId);
    const before = list.find((d) => d.id === id);
    if (!before) throw new EmployeeError(t('This department could not be found.'));
    const department: Department = { ...before, ...checkDepartmentNames(list, input, id) };
    let moved = 0;
    if (department.name !== before.name) {
      const key = departmentKey(before.name);
      const stamp = nowStamp();
      const employees = (await db.employees.where('companyId').equals(companyId).toArray())
        .filter((e) => departmentKey(e.department) === key)
        .map((e) => ({ ...e, department: department.name, updatedAt: stamp }));
      await db.employees.bulkPut(employees);
      moved = employees.length;
    }
    await putDepartments(
      settings,
      list.map((d) => (d.id === id ? department : d)),
    );
    if (department.name !== before.name) {
      await logDepartment(
        companyId,
        msg('Department {from} renamed {to}'),
        { from: before.name, to: department.name },
        { from: before.nameAr, to: department.nameAr },
      );
    } else if (department.nameAr !== before.nameAr) {
      await logDepartment(
        companyId,
        msg('Arabic name of the department {name} changed'),
        { name: department.name },
        { name: department.nameAr },
      );
    }
    return { department, moved };
  });
}

/** Archives a department (no longer offered; its employees keep it), or restores it. */
export async function setDepartmentArchived(
  companyId: ID,
  id: ID,
  archived: boolean,
): Promise<void> {
  await db.transaction('rw', [db.peopleSettings, db.activities], async () => {
    const { settings, list } = await departmentList(companyId);
    const before = list.find((d) => d.id === id);
    if (!before) throw new EmployeeError(t('This department could not be found.'));
    if ((before.archived === true) === archived) return;
    const department: Department = { ...before };
    if (archived) department.archived = true;
    else delete department.archived;
    await putDepartments(
      settings,
      list.map((d) => (d.id === id ? department : d)),
    );
    await logDepartment(
      companyId,
      archived ? msg('Department {name} archived') : msg('Department {name} restored'),
      { name: department.name },
      { name: department.nameAr },
    );
  });
}

/**
 * Moves the employees of a department, or of a name that isn't in the list
 * (another spelling, a typo), into a department of the list, in one
 * transaction; a department of the list merged this way leaves it. Returns
 * how many employees moved.
 */
export async function mergeDepartment(companyId: ID, from: string, intoId: ID): Promise<number> {
  return db.transaction('rw', [db.peopleSettings, db.employees, db.activities], async () => {
    const { settings, list } = await departmentList(companyId);
    const into = list.find((d) => d.id === intoId);
    if (!into) throw new EmployeeError(t('This department could not be found.'));
    const key = departmentKey(from);
    if (!key || key === departmentKey(into.name)) {
      throw new EmployeeError(t('Choose another department to merge into.'));
    }
    const stamp = nowStamp();
    const employees = (await db.employees.where('companyId').equals(companyId).toArray())
      .filter((e) => departmentKey(e.department) === key)
      .map((e) => ({ ...e, department: into.name, updatedAt: stamp }));
    await db.employees.bulkPut(employees);
    const merged = list.find((d) => departmentKey(d.name) === key);
    if (merged) {
      await putDepartments(
        settings,
        list.filter((d) => d.id !== merged.id),
      );
    }
    await logDepartment(
      companyId,
      msg('Department {from} merged into {to}'),
      { from: merged?.name ?? tidyName(from), to: into.name },
      { from: merged?.nameAr, to: into.nameAr },
    );
    return employees.length;
  });
}

/**
 * Puts employees of the company in a department (or in none, with an empty
 * name), in one transaction with one activity entry. Returns how many
 * changed.
 */
export async function assignDepartment(
  companyId: ID,
  employeeIds: readonly ID[],
  name: string,
): Promise<number> {
  return db.transaction('rw', [db.peopleSettings, db.employees, db.activities], async () => {
    const { list } = await departmentList(companyId);
    // A department of the list is given its English name, however it was typed.
    const department = findDepartment(list, name)?.name ?? tidyName(name);
    const stamp = nowStamp();
    const employees = (await db.employees.bulkGet([...employeeIds]))
      .filter((e): e is Employee => Boolean(e && e.companyId === companyId))
      .filter((e) => e.department !== department)
      .map((e) => ({ ...e, department, updatedAt: stamp }));
    if (!employees.length) return 0;
    await db.employees.bulkPut(employees);
    const count = employees.length;
    const found = findDepartment(list, department);
    if (department) {
      await logDepartment(
        companyId,
        count === 1
          ? msg('{count} employee moved to {department}')
          : msg('{count} employees moved to {department}'),
        { count, department },
        { department: found?.nameAr },
      );
    } else {
      await logDepartment(
        companyId,
        count === 1
          ? msg('{count} employee taken out of their department')
          : msg('{count} employees taken out of their department'),
        { count },
      );
    }
    return count;
  });
}
