import { db } from './db';
import { logActivity } from './activity';
import { defaultNumbering, nowStamp } from './defaults';
import type { Employee, EmployeeAllowance, ID, PeopleSettings } from './types';
import { allocateNumber } from '@/lib/numbering';
import { newId, shortId } from '@/lib/ids';
import { today } from '@/lib/dates';
import { currencyPrecision, round } from '@/lib/money';
import { compactIban, normalizeKuwaitPhone } from '@/lib/kuwait';
import { DEFAULT_REMINDER_DAYS, normalizeReminderDays } from '@/lib/compliance';
import { EOSI_RULES } from '@/lib/hr/eosi';
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

/** Saves an employee, giving new ones the next employee number. */
export async function saveEmployee(input: Employee): Promise<Employee> {
  return db.transaction('rw', [db.employees, db.companies, db.activities], async () => {
    const company = await db.companies.get(input.companyId);
    if (!company) throw new EmployeeError(t('Company not found'));
    const name = input.name.trim();
    if (!name) throw new EmployeeError(t('Enter the employee’s name.'));
    const places = currencyPrecision(company.currency);
    const existing = await db.employees.get(input.id);

    let employee: Employee = {
      ...input,
      name,
      nameAr: input.nameAr?.trim() ?? '',
      number: input.number.trim(),
      jobTitle: input.jobTitle.trim(),
      jobTitleAr: input.jobTitleAr?.trim() ?? '',
      department: input.department.trim(),
      civilId: input.civilId.replace(/\s/g, ''),
      iban: compactIban(input.iban),
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
      leavingReason: input.status === 'left' ? (input.leavingReason ?? 'other') : null,
      updatedAt: nowStamp(),
    };

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
  });
}

/** Whether the employee has renewals or register documents that must be kept. */
export async function employeeHasHistory(id: ID): Promise<boolean> {
  const [renewals, documents] = await Promise.all([
    db.renewals.where('employeeId').equals(id).count(),
    db.complianceDocuments.where('employeeId').equals(id).count(),
  ]);
  return renewals + documents > 0;
}

/**
 * Deletes an employee added by mistake, with their personnel file. Anyone
 * with renewals or documents on record is marked as left instead, so the
 * history stays.
 */
export async function deleteEmployee(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.employees, db.renewals, db.complianceDocuments, db.attachments, db.activities],
    async () => {
      const employee = await db.employees.get(id);
      if (!employee) return;
      if (await employeeHasHistory(id)) {
        throw new EmployeeError(
          t('This employee has documents or renewals on record. Mark them as left instead.'),
        );
      }
      await db.attachments.where('ownerId').equals(id).delete();
      await db.employees.delete(id);
      await logActivity(employee.companyId, 'employee', id, 'deleted', {
        text: msg('Employee {name} ({number}) deleted'),
        vars: { name: employee.name, number: employee.number },
        arabic: { name: employee.nameAr },
      });
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export function defaultPeopleSettings(companyId: ID): PeopleSettings {
  return {
    id: companyId,
    companyId,
    kuwaitizationTarget: null,
    eosDailyDivisor: EOSI_RULES.defaultDailyDivisor,
    reminderDays: [...DEFAULT_REMINDER_DAYS],
    auditFilingMonths: 3,
    pifssDueDay: 15,
    updatedAt: nowStamp(),
  };
}

/** A company's people and compliance settings, with defaults for anything not set. */
export async function getPeopleSettings(companyId: ID): Promise<PeopleSettings> {
  const saved = await db.peopleSettings.get(companyId);
  return { ...defaultPeopleSettings(companyId), ...saved };
}

export function normalizePeopleSettings(input: PeopleSettings): PeopleSettings {
  const whole = (n: number, min: number, max: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  const target = input.kuwaitizationTarget;
  return {
    ...input,
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

export async function savePeopleSettings(input: PeopleSettings): Promise<PeopleSettings> {
  const settings = { ...normalizePeopleSettings(input), updatedAt: nowStamp() };
  await db.transaction('rw', [db.peopleSettings, db.activities], async () => {
    await db.peopleSettings.put(settings);
    await logActivity(settings.companyId, 'compliance', settings.id, 'settings', {
      text: msg('Employee and compliance settings updated'),
    });
  });
  return settings;
}
