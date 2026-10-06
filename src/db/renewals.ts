import { db } from './db';
import { logActivity } from './activity';
import { accountingSettings } from './chart-setup';
import { createAccount, saveAccount } from './accounting';
import { nowStamp } from './defaults';
import { createExpense, saveExpense } from './purchases';
import { getPeopleSettings } from './people';
import type {
  Account,
  Company,
  ComplianceDocument,
  ComplianceDocumentType,
  ComplianceMark,
  DocumentRenewal,
  Employee,
  Expense,
  ID,
  ISODate,
} from './types';
import {
  complianceCalendar,
  DOCUMENT_TYPES,
  EMPLOYEE_EXPIRY_FIELDS,
  EMPLOYEE_NUMBER_FIELDS,
  expiryStatus,
  FEE_ACCOUNT_CODES,
  isEmployeeDocumentType,
  normalizeReminderDays,
  overdueSince,
  registerEntries,
  statutoryContextOf,
  type ComplianceItem,
  type EmployeeDocumentType,
  type ExpiryInfo,
  type FeeAccountKey,
  type RegisterEntry,
  type StatutoryContext,
} from '@/lib/compliance';
import { CHART_TEMPLATES } from '@/lib/accounting/charts';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import { addDaysISO, today } from '@/lib/dates';
import { currencyPrecision, round } from '@/lib/money';
import { newId } from '@/lib/ids';
import { msg, t } from '@/i18n';

export class ComplianceError extends Error {}

/* -------------------------------------------------------------------------- */
/* Register records                                                           */
/* -------------------------------------------------------------------------- */

export function createComplianceDocument(
  companyId: ID,
  overrides: Partial<ComplianceDocument> = {},
): ComplianceDocument {
  const stamp = nowStamp();
  return {
    id: newId(),
    companyId,
    type: 'commercial_licence',
    title: '',
    number: '',
    issuer: '',
    issueDate: null,
    expiryDate: null,
    renewalCost: 0,
    reminderDays: null,
    ownerType: 'company',
    employeeId: null,
    ownerName: '',
    notes: '',
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/** Saves a register document; with `log: false` no activity entry is written (imports). */
export async function saveComplianceDocument(
  input: ComplianceDocument,
  options: { log?: boolean } = {},
): Promise<ComplianceDocument> {
  return db.transaction(
    'rw',
    [db.complianceDocuments, db.companies, db.employees, db.activities],
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new ComplianceError(t('Company not found'));
      if (DOCUMENT_TYPES[input.type].fromEmployee) {
        throw new ComplianceError(
          t('Civil ID, passport, residency and work permit are kept on the employee’s page.'),
        );
      }
      let employee: Employee | undefined;
      if (input.ownerType === 'employee') {
        employee = input.employeeId ? await db.employees.get(input.employeeId) : undefined;
        if (!employee || employee.companyId !== company.id) {
          throw new ComplianceError(t('Choose the employee the document belongs to.'));
        }
      }
      if (input.ownerType === 'vehicle' && !input.ownerName.trim()) {
        throw new ComplianceError(t('Enter the vehicle’s plate number or name.'));
      }
      if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate) {
        throw new ComplianceError(t('The expiry date is before the issue date.'));
      }
      const existing = await db.complianceDocuments.get(input.id);
      const doc: ComplianceDocument = {
        ...input,
        title: input.title.trim(),
        number: input.number.trim(),
        issuer: input.issuer.trim(),
        ownerName: input.ownerType === 'employee' ? '' : input.ownerName.trim(),
        employeeId: input.ownerType === 'employee' ? input.employeeId : null,
        renewalCost: round(Math.max(0, input.renewalCost), currencyPrecision(company.currency)),
        reminderDays: input.reminderDays?.length ? normalizeReminderDays(input.reminderDays) : null,
        updatedAt: nowStamp(),
      };
      if (!existing) doc.createdAt = doc.updatedAt;
      await db.complianceDocuments.put(doc);
      if (options.log === false) return doc;
      await logActivity(
        company.id,
        'compliance',
        doc.id,
        existing ? 'updated' : 'created',
        {
          text: existing ? msg('Document {title} updated') : msg('Document {title} added'),
          vars: { title: doc.title || DOCUMENT_TYPES[doc.type].label },
        },
        { employeeId: doc.employeeId },
      );
      return doc;
    },
  );
}

/** Stops (or resumes) tracking a document; it keeps its renewals. */
export async function setDocumentArchived(id: ID, archived: boolean): Promise<void> {
  await db.transaction('rw', [db.complianceDocuments, db.activities], async () => {
    const doc = await db.complianceDocuments.get(id);
    if (!doc) return;
    await db.complianceDocuments.put({ ...doc, archived, updatedAt: nowStamp() });
    await logActivity(
      doc.companyId,
      'compliance',
      id,
      archived ? 'archived' : 'restored',
      {
        text: archived ? msg('Document {title} archived') : msg('Document {title} restored'),
        vars: { title: doc.title || DOCUMENT_TYPES[doc.type].label },
      },
      { employeeId: doc.employeeId },
    );
  });
}

/** Deletes a document added by mistake. Renewed documents are archived instead. */
export async function deleteComplianceDocument(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.complianceDocuments, db.renewals, db.attachments, db.activities],
    async () => {
      const doc = await db.complianceDocuments.get(id);
      if (!doc) return;
      if ((await db.renewals.where('documentKey').equals(`doc:${id}`).count()) > 0) {
        throw new ComplianceError(t('This document has renewals on record. Archive it instead.'));
      }
      await db.attachments.where('ownerId').equals(id).delete();
      await db.complianceDocuments.delete(id);
      await logActivity(
        doc.companyId,
        'compliance',
        id,
        'deleted',
        {
          text: msg('Document {title} deleted'),
          vars: { title: doc.title || DOCUMENT_TYPES[doc.type].label },
        },
        { employeeId: doc.employeeId },
      );
    },
  );
}

/* -------------------------------------------------------------------------- */
/* The register                                                               */
/* -------------------------------------------------------------------------- */

export interface Register {
  entries: RegisterEntry[];
  employees: Employee[];
  documents: ComplianceDocument[];
  reminderDays: number[];
}

/** Every tracked document of a company: register records and employees' papers. */
export async function loadRegister(companyId: ID): Promise<Register> {
  const [employees, documents, settings] = await Promise.all([
    db.employees.where('companyId').equals(companyId).toArray(),
    db.complianceDocuments.where('companyId').equals(companyId).toArray(),
    getPeopleSettings(companyId),
  ]);
  const reminderDays = normalizeReminderDays(settings.reminderDays);
  return {
    entries: registerEntries({ employees, documents, reminderDays }),
    employees,
    documents,
    reminderDays,
  };
}

export interface ExpiringDocument {
  entry: RegisterEntry;
  info: ExpiryInfo;
  /** The employee the document belongs to, if any. */
  employee: Employee | null;
}

/**
 * Documents that have expired or expire within `days` days from today,
 * soonest first. For the dashboard and reminders.
 */
export async function expiringDocuments(companyId: ID, days: number): Promise<ExpiringDocument[]> {
  const { entries, employees } = await loadRegister(companyId);
  const on = today();
  const until = addDaysISO(on, Math.max(0, Math.trunc(days)));
  const byId = new Map(employees.map((e) => [e.id, e]));
  return entries
    .filter((e) => e.expiryDate && e.expiryDate <= until)
    .map((entry) => ({
      entry,
      info: expiryStatus(entry.expiryDate, entry.reminderDays, on),
      employee: entry.employeeId ? (byId.get(entry.employeeId) ?? null) : null,
    }))
    .sort((a, b) => (a.entry.expiryDate ?? '').localeCompare(b.entry.expiryDate ?? ''));
}

/* -------------------------------------------------------------------------- */
/* Statutory deadlines and the calendar                                       */
/* -------------------------------------------------------------------------- */

export { OVERDUE_LOOKBACK_DAYS } from '@/lib/compliance';

export async function statutoryContext(company: Company): Promise<StatutoryContext> {
  const [settings, employees] = await Promise.all([
    getPeopleSettings(company.id),
    db.employees.where('companyId').equals(company.id).toArray(),
  ]);
  return statutoryContextOf({
    fiscalYearEnd: accountingSettings(company).fiscalYearEnd,
    profile: kuwaitProfile(company),
    settings,
    employees,
  });
}

/**
 * The compliance calendar from `from` for `days` days: statutory deadlines
 * and expiring documents, plus what is overdue (deadlines since the company
 * started using the app, at most a year back, and expired documents).
 */
export async function upcomingCompliance(
  company: Company,
  from: ISODate,
  days: number,
): Promise<ComplianceItem[]> {
  const [ctx, register, marks] = await Promise.all([
    statutoryContext(company),
    loadRegister(company.id),
    db.complianceMarks.where('companyId').equals(company.id).toArray(),
  ]);
  return complianceCalendar({
    ctx,
    entries: register.entries,
    marks,
    from,
    days,
    overdueSince: overdueSince(company.createdAt, from),
  });
}

/**
 * Marks a statutory deadline as done. `label` names it in the activity log
 * (the deadline's title in the interface language).
 */
export async function markComplianceDone(
  companyId: ID,
  key: string,
  options: { doneOn?: ISODate; note?: string; label?: string } = {},
): Promise<ComplianceMark> {
  const mark: ComplianceMark = {
    id: `${companyId}:${key}`,
    companyId,
    key,
    doneOn: options.doneOn ?? today(),
    note: options.note?.trim() ?? '',
    createdAt: nowStamp(),
  };
  await db.transaction('rw', [db.complianceMarks, db.activities], async () => {
    await db.complianceMarks.put(mark);
    await logActivity(companyId, 'compliance', mark.id, 'done', {
      text: msg('{item} marked as done'),
      vars: { item: options.label || key },
    });
  });
  return mark;
}

export async function clearComplianceMark(
  companyId: ID,
  key: string,
  label?: string,
): Promise<void> {
  const id = `${companyId}:${key}`;
  await db.transaction('rw', [db.complianceMarks, db.activities], async () => {
    if (!(await db.complianceMarks.get(id))) return;
    await db.complianceMarks.delete(id);
    await logActivity(companyId, 'compliance', id, 'reopened', {
      text: msg('{item} marked as not done'),
      vars: { item: label || key },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Renewals                                                                   */
/* -------------------------------------------------------------------------- */

/** The fee account's line in the Kuwait chart (code, English and Arabic name). */
export function feeAccountSpec(key: FeeAccountKey) {
  const code = FEE_ACCOUNT_CODES[key];
  const spec = CHART_TEMPLATES.kw.accounts.find((a) => a.code === code);
  if (!spec) throw new Error(`Account ${code} is missing from the Kuwait chart`);
  return spec;
}

/**
 * The account a renewal fee of this document type goes to, if the company
 * has it: found by name, or by code in a company on the Kuwait chart (other
 * charts use the same codes for other things).
 */
export function findFeeAccount(
  accounts: Account[],
  company: Company,
  type: ComplianceDocumentType,
): Account | null {
  const spec = feeAccountSpec(DOCUMENT_TYPES[type].fee);
  const sameName = (a: Account) =>
    a.name.trim().toLowerCase() === spec.name.toLowerCase() ||
    (Boolean(spec.nameAr) && a.nameAr?.trim() === spec.nameAr);
  const ordered = [...accounts].sort((a, b) => Number(a.archived) - Number(b.archived));
  return (
    ordered.find(sameName) ??
    (accountingSettings(company).template === 'kw'
      ? ordered.find((a) => a.code === spec.code && a.type === spec.type)
      : undefined) ??
    null
  );
}

/** The fee account, created from the Kuwait chart when the company doesn't have it. */
export async function ensureFeeAccount(
  company: Company,
  type: ComplianceDocumentType,
): Promise<Account> {
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const found = findFeeAccount(accounts, company, type);
  if (found) return found;
  const spec = feeAccountSpec(DOCUMENT_TYPES[type].fee);
  const codes = new Set(accounts.map((a) => a.code));
  let code = spec.code;
  for (let n = Number(spec.code) + 1; codes.has(code); n++) code = String(n);
  return saveAccount(
    createAccount(company.id, {
      code,
      name: spec.name,
      nameAr: spec.nameAr,
      type: spec.type,
    }),
  );
}

export interface RenewalFee {
  amount: number;
  /** Expense category; null uses the document type's fee account. */
  accountId: ID | null;
  /** Bank, cash or card the fee was paid from; null uses the bank. */
  paidFromAccountId: ID | null;
  reference?: string;
}

export interface RenewInput {
  companyId: ID;
  /** Register key of the document ("doc:<id>" or "emp:<employeeId>:<type>"). */
  key: string;
  newExpiry: ISODate;
  /** Date of the renewal (and of the fee's expense). */
  renewedOn: ISODate;
  /** New document number, when the renewal changes it (a new passport). */
  number?: string;
  note?: string;
  fee?: RenewalFee | null;
}

/**
 * Renews a document: moves its expiry date, keeps a record of the renewal
 * and, when a fee is given, records it as an expense paid from the bank or
 * cash (it posts Dr fee account, Cr bank like any expense).
 */
export async function renewDocument(
  input: RenewInput,
): Promise<{ renewal: DocumentRenewal; expense: Expense | null }> {
  return db.transaction(
    'rw',
    [
      db.employees,
      db.complianceDocuments,
      db.renewals,
      db.expenses,
      db.companies,
      db.accounts,
      db.activities,
    ],
    async () => {
      const company = await db.companies.get(input.companyId);
      if (!company) throw new ComplianceError(t('Company not found'));
      const number = input.number?.trim();

      let type: ComplianceDocumentType;
      let previousExpiry: ISODate | null;
      let currentNumber: string;
      let numberField: keyof Employee | null = null;
      let employee: Employee | null = null;
      let record: ComplianceDocument | null = null;
      const [source, id, field] = input.key.split(':');
      if (source === 'doc') {
        record = (await db.complianceDocuments.get(id)) ?? null;
        if (!record || record.companyId !== company.id) {
          throw new ComplianceError(t('Document not found'));
        }
        type = record.type;
        previousExpiry = record.expiryDate;
        currentNumber = record.number;
        if (record.ownerType === 'employee' && record.employeeId) {
          employee = (await db.employees.get(record.employeeId)) ?? null;
        }
      } else if (source === 'emp' && isEmployeeDocumentType(field as ComplianceDocumentType)) {
        employee = (await db.employees.get(id)) ?? null;
        if (!employee || employee.companyId !== company.id) {
          throw new ComplianceError(t('Employee not found'));
        }
        type = field as EmployeeDocumentType;
        previousExpiry = employee[EMPLOYEE_EXPIRY_FIELDS[type]];
        numberField =
          type in EMPLOYEE_NUMBER_FIELDS
            ? EMPLOYEE_NUMBER_FIELDS[type as keyof typeof EMPLOYEE_NUMBER_FIELDS]
            : null;
        currentNumber = numberField ? String(employee[numberField] ?? '') : '';
      } else {
        throw new ComplianceError(t('Document not found'));
      }

      if (!input.newExpiry || input.newExpiry <= (previousExpiry ?? input.renewedOn)) {
        throw new ComplianceError(t('The new expiry date must be after the current one.'));
      }
      if (!input.renewedOn) throw new ComplianceError(t('Enter the renewal date.'));

      const precision = currencyPrecision(company.currency);
      const feeAmount = round(Math.max(0, input.fee?.amount ?? 0), precision);
      const label = DOCUMENT_TYPES[type].label;
      const title = record?.title || t(label);
      const owner = employee?.name ?? record?.ownerName ?? '';

      let expense: Expense | null = null;
      if (input.fee && feeAmount > 0) {
        const account = input.fee.accountId
          ? await db.accounts.get(input.fee.accountId)
          : await ensureFeeAccount(company, type);
        if (!account || account.companyId !== company.id) {
          throw new ComplianceError(t('Choose a category.'));
        }
        // Staff and viewers see expenses: an employee's document leaves no
        // name, number or note there. They stay on the (private) renewal.
        expense = await saveExpense(
          createExpense(company.id, {
            date: input.renewedOn,
            accountId: account.id,
            amount: feeAmount,
            currency: company.currency,
            paidFromAccountId: input.fee.paidFromAccountId,
            description: employee
              ? t('Document renewal fee')
              : owner
                ? t('{document} renewal – {owner}', { document: title, owner })
                : t('{document} renewal', { document: title }),
            reference: employee
              ? (input.fee.reference?.trim() ?? '')
              : input.fee.reference?.trim() || number || currentNumber,
            notes: employee ? '' : (input.note?.trim() ?? ''),
          }),
        );
      }

      if (record) {
        await db.complianceDocuments.put({
          ...record,
          expiryDate: input.newExpiry,
          issueDate: input.renewedOn,
          number: number || record.number,
          renewalCost: feeAmount > 0 ? feeAmount : record.renewalCost,
          updatedAt: nowStamp(),
        });
      } else if (employee) {
        await db.employees.put({
          ...employee,
          [EMPLOYEE_EXPIRY_FIELDS[type as EmployeeDocumentType]]: input.newExpiry,
          ...(numberField && number ? { [numberField]: number } : {}),
          updatedAt: nowStamp(),
        });
      }

      const renewal: DocumentRenewal = {
        id: newId(),
        companyId: company.id,
        documentKey: input.key,
        documentId: record?.id ?? null,
        employeeId: employee?.id ?? null,
        type,
        renewedOn: input.renewedOn,
        previousExpiry,
        newExpiry: input.newExpiry,
        fee: feeAmount,
        expenseId: expense?.id ?? null,
        note: input.note?.trim() ?? '',
        number: number || currentNumber,
        createdAt: nowStamp(),
      };
      await db.renewals.add(renewal);
      await logActivity(
        company.id,
        'compliance',
        renewal.id,
        'renewed',
        {
          text: owner
            ? msg('{document} of {owner} renewed until {date}')
            : msg('{document} renewed until {date}'),
          vars: { document: title, owner, date: input.newExpiry },
        },
        { employeeId: employee?.id ?? null },
      );
      return { renewal, expense };
    },
  );
}

/** Renewals of one document, latest first. */
export async function documentRenewals(key: string): Promise<DocumentRenewal[]> {
  const list = await db.renewals.where('documentKey').equals(key).toArray();
  return list.sort(
    (a, b) => b.renewedOn.localeCompare(a.renewedOn) || b.createdAt.localeCompare(a.createdAt),
  );
}
