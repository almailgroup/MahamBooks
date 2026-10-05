import { db } from './db';
import { logActivity } from './activity';
import { compactAccountNumber, createEmployee, saveEmployee } from './people';
import { createComplianceDocument, saveComplianceDocument } from './renewals';
import type {
  ComplianceDocumentType,
  Employee,
  EmployeeCategory,
  Gender,
  ID,
  ISODate,
} from './types';
import type { ImportContext, ImportOptions, ImportPlan, ImportResult, RowIssue } from './import';
import {
  arabicNameFromFileName,
  IMPORT_COLUMNS,
  normalizeHeader,
  type ColumnMapping,
} from '@/features/company/import-columns';
import { parseAmount, parseStatementDate } from '@/lib/banking/statement';
import {
  bankFromIban,
  compactIban,
  findBank,
  isValidCardNumber,
  isValidCivilId,
  isValidIban,
  normalizeKuwaitPhone,
} from '@/lib/kuwait';
import { nationalityCode } from '@/lib/hr/nationalities';
import { arabicJobTitle, englishJobTitle } from '@/lib/hr/job-titles';
import { categoryForNationality, needsResidency, needsWorkPermit } from '@/lib/hr/employees';
import { DOCUMENT_TYPES } from '@/lib/compliance';
import { isValidEmail } from '@/lib/email';
import { addDaysISO, isISODate, today } from '@/lib/dates';
import { currencyPrecision, dec, normalizeDigits, round } from '@/lib/money';
import { canSeePeople } from '@/cloud/roles';
import { newId } from '@/lib/ids';
import { currentLanguage, msg, t } from '@/i18n';

/**
 * Employees from another HR system (Zoho People and the like) or a
 * spreadsheet. Every row with a name or an employee number is imported:
 * what looks wrong (a Civil ID check digit, an unknown nationality, a
 * joining date in the future, an expired document) is noted for the owner
 * to fix later, never a reason to leave someone out. Rows for employees
 * already in the company are skipped unless they are to be updated.
 */

/** What the import found, for the preview and the result. */
export interface EmployeeImportSummary {
  /** New employees. */
  add: number;
  /** Employees already in the company that the file updates. */
  update: number;
  /** Rows for employees already in the company (matched by number or Civil ID). */
  existing: number;
  /** Rows without a name or an employee number. */
  empty: number;
  /** Notes on the rows that are imported. */
  notes: number;
  /** Rows with a note. */
  rowsWithNotes: number;
  arabicNamesFromFiles: number;
  arabicJobTitles: number;
  nationalities: { mapped: number; unknown: number; missing: number };
  phones: { kuwaiti: number; international: number; kept: number };
  /** Account or salary card numbers. */
  accountNumbers: number;
  ibans: number;
  drivingLicences: number;
  civilIdsToCheck: number;
  /** Documents (Civil IDs, passports…) already expired, and expiring within 60 days. */
  expired: number;
  expiring: number;
  futureHireDates: number;
  missingHireDates: number;
  /**
   * When the residency expiry comes from a generic "Document Expiry" column:
   * how many rows have one and how many of those equal the Civil ID expiry.
   */
  documentExpiry: { total: number; sameAsCivilId: number } | null;
  /** The file has salaries; without them, salaries are added before payroll. */
  salaries: boolean;
}

export interface EmployeeRecord {
  employee: Employee;
  /** The employee already in the company this row updates. */
  existing: Employee | null;
  drivingLicence: { number: string; expiryDate: ISODate | null } | null;
}

export interface EmployeeImportProgress {
  done: number;
  total: number;
}

/** Days ahead in which an expiring document is pointed out. */
export const EXPIRY_NOTICE_DAYS = 60;

/** Employees saved per transaction, so the progress bar moves and the page stays responsive. */
const BATCH_SIZE = 25;

/** Spaces collapsed, ends trimmed. */
const collapse = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * A value from the file inside a message, kept in its own direction: an
 * Arabic file name in an English sentence (or the other way round) would
 * otherwise come out jumbled.
 */
const isolate = (text: string) => `\u2068${text}\u2069`;

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

/** Employee numbers compared without case or the leading zeros of numeric ones. */
export function employeeNumberKey(number: string): string {
  const v = normalizeDigits(number).trim().toLowerCase();
  return /^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, '') : v;
}

const civilIdKey = (value: string) => normalizeDigits(value).replace(/[\s-]/g, '');

/** Male or female in English or Arabic; null when empty or not recognised. */
export function readGender(value: string): Gender | null {
  const v = normalizeHeader(value);
  if (/^(m|male|man|ذكر|رجل)$/.test(v)) return 'male';
  if (/^(f|female|woman|انثي|امراه|انثى)$/.test(v)) return 'female';
  return null;
}

/** "A +ve", "a pos", "O-" → "A+", "O−"; other text is kept as written. */
export function readBloodGroup(value: string): string {
  const v = value.toUpperCase().replace(/\s+/g, '');
  const m = /^(AB|A|B|O)(\+|-|−|\+VE|-VE|POS|POSITIVE|NEG|NEGATIVE)?$/.exec(v);
  if (!m) return collapse(value);
  const sign = !m[2] ? '' : /^(\+|POS)/.test(m[2]) ? '+' : '-';
  return `${m[1]}${sign}`;
}

export type PhoneKind = 'kuwaiti' | 'international' | 'kept';

/**
 * A phone number as stored: Kuwaiti numbers "+965 5000 0000", others
 * "+977 9812345678" (Zoho writes them "977-9812345678"). Numbers that don't
 * look like either are kept as written.
 */
export function readPhone(value: string): { phone: string; kind: PhoneKind } | null {
  const v = normalizeDigits(value).trim();
  if (!v) return null;
  const kuwaiti = normalizeKuwaitPhone(v);
  if (kuwaiti) return { phone: kuwaiti, kind: 'kuwaiti' };
  const coded = /^(?:\+|00)?(\d{1,3})[\s-]+(\d[\d\s-]{5,}\d)$/.exec(v);
  if (coded && coded[1] !== '965') {
    return { phone: `+${coded[1]} ${coded[2].replace(/[\s-]/g, '')}`, kind: 'international' };
  }
  const plus = /^(?:\+|00)(\d[\d\s-]{6,}\d)$/.exec(v);
  if (plus && !plus[1].replace(/\D/g, '').startsWith('965')) {
    return { phone: `+${plus[1].replace(/[\s-]/g, '')}`, kind: 'international' };
  }
  return { phone: v, kind: 'kept' };
}

/** What exports write for "nothing": a dash, N/A and the like. */
const PLACEHOLDER = /^(-+|—|–|\.|n\/a|#n\/a|nil|null|none)$/i;

/** The value of each field in a row (placeholders read as empty). */
function cellsOf(row: string[], mapping: ColumnMapping): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const column of IMPORT_COLUMNS.employees) {
    const index = mapping[column.key];
    const value = index == null ? '' : (row[index] ?? '').trim();
    cells[column.key] = PLACEHOLDER.test(value) ? '' : value;
  }
  return cells;
}

const LABELS = Object.fromEntries(IMPORT_COLUMNS.employees.map((c) => [c.key, c.label]));

/** Documents whose expiry the preview points out. */
const EXPIRY_DOCUMENTS: { key: keyof Employee | 'drivingLicence'; type: ComplianceDocumentType }[] =
  [
    { key: 'civilIdExpiry', type: 'civil_id' },
    { key: 'residencyExpiry', type: 'residency' },
    { key: 'passportExpiry', type: 'passport' },
    { key: 'workPermitExpiry', type: 'work_permit' },
    { key: 'drivingLicence', type: 'driving_licence' },
  ];

function listOf(items: string[]): string {
  try {
    return new Intl.ListFormat(currentLanguage() === 'ar' ? 'ar' : 'en', {
      type: 'conjunction',
    }).format(items);
  } catch {
    return items.join(', ');
  }
}

function emptySummary(): EmployeeImportSummary {
  return {
    add: 0,
    update: 0,
    existing: 0,
    empty: 0,
    notes: 0,
    rowsWithNotes: 0,
    arabicNamesFromFiles: 0,
    arabicJobTitles: 0,
    nationalities: { mapped: 0, unknown: 0, missing: 0 },
    phones: { kuwaiti: 0, international: 0, kept: 0 },
    accountNumbers: 0,
    ibans: 0,
    drivingLicences: 0,
    civilIdsToCheck: 0,
    expired: 0,
    expiring: 0,
    futureHireDates: 0,
    missingHireDates: 0,
    documentExpiry: null,
    salaries: false,
  };
}

/**
 * Checks every row of an employee file and prepares the employees to save.
 * Rows are only left out when they have neither a name nor an employee
 * number, or belong to an employee already here (unless updating).
 */
export function planEmployeeRows(
  plan: ImportPlan,
  body: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
  ctx: ImportContext,
  headers: string[] = [],
): ImportPlan {
  const summary = emptySummary();
  plan.employees = summary;
  const on = options.today ?? today();
  const soon = addDaysISO(on, EXPIRY_NOTICE_DAYS);
  const fmtDate = options.formatDate ?? ((d: ISODate) => d);
  const places = currencyPrecision(ctx.company.currency);
  const byNumber = new Map<string, Employee>();
  const byCivilId = new Map<string, Employee>();
  for (const e of ctx.employees) {
    if (e.number.trim()) byNumber.set(employeeNumberKey(e.number), e);
    if (e.civilId.trim()) byCivilId.set(civilIdKey(e.civilId), e);
  }
  const seenNumbers = new Map<string, number>();
  const seenCivilIds = new Map<string, number>();
  const residencyHeader = mapping.residencyExpiry == null ? '' : headers[mapping.residencyExpiry];
  const fromDocumentExpiry = /document/.test(normalizeHeader(residencyHeader ?? ''));
  if (fromDocumentExpiry) summary.documentExpiry = { total: 0, sameAsCivilId: 0 };
  summary.salaries = mapping.basicSalary != null;

  /** yyyy-MM-dd from a cell (ISO from spreadsheets, else as the file writes dates). */
  const readDate = (field: string, value: string, issues: RowIssue[]): ISODate | null => {
    if (!value) return null;
    const v = normalizeDigits(value).trim();
    const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
    const date = iso && isISODate(iso) ? iso : parseStatementDate(v, options.dateFormat);
    if (!date) {
      issues.push({
        level: 'warning',
        text: t('{field}: “{value}” is not a date.', {
          field: t(LABELS[field]),
          value: isolate(value),
        }),
      });
      return null;
    }
    // Excel's empty date (1899-12-30 and thereabouts) and other placeholders.
    return date < '1901-01-01' ? null : date;
  };

  body.forEach((row, i) => {
    const line = i + 2;
    const cells = cellsOf(row, mapping);
    const issues: RowIssue[] = [];
    const note = (text: string) => issues.push({ level: 'warning', text });
    const info = (text: string) => issues.push({ level: 'info', text });

    // Who: number and names.
    let number = normalizeDigits(cells.number).trim();
    let english =
      collapse(cells.name) ||
      collapse([cells.firstName, cells.middleName, cells.lastName].join(' '));
    let nameAr = collapse(cells.nameAr);
    if (english && ARABIC.test(english) && !LATIN.test(english) && !nameAr) {
      // A name column in Arabic only.
      nameAr = english;
      english = '';
    }
    let nameFromFile = false;
    if (!nameAr && cells.nameArFile) {
      const found = arabicNameFromFileName(cells.nameArFile);
      if (
        found?.number &&
        number &&
        employeeNumberKey(found.number) !== employeeNumberKey(number)
      ) {
        note(
          t('The Arabic name was not taken from “{file}”: it has another employee number.', {
            file: isolate(cells.nameArFile),
          }),
        );
      } else if (found) {
        nameAr = found.name;
        nameFromFile = true;
      }
    }
    if (!english && !nameAr && !number) {
      plan.rows.push({
        line,
        status: 'skipped',
        issues: [{ level: 'skip', text: t('No name or employee number.') }],
        cells,
        record: null,
      });
      summary.empty += 1;
      return;
    }

    // Already in the file or in the company.
    const civilId = civilIdKey(cells.civilId);
    const numberKey = number ? employeeNumberKey(number) : '';
    const sameNumber = numberKey ? seenNumbers.get(numberKey) : undefined;
    if (sameNumber !== undefined) {
      note(
        t('Employee number {number} is also on row {line}: this one gets the next free number.', {
          number,
          line: sameNumber,
        }),
      );
      number = '';
    } else if (numberKey) seenNumbers.set(numberKey, line);
    const sameCivilId = civilId ? seenCivilIds.get(civilId) : undefined;
    if (sameCivilId !== undefined) {
      note(t('The same Civil ID is also on row {line}.', { line: sameCivilId }));
    } else if (civilId) seenCivilIds.set(civilId, line);
    const existing =
      (number ? byNumber.get(employeeNumberKey(number)) : undefined) ??
      (civilId && sameCivilId === undefined ? byCivilId.get(civilId) : undefined) ??
      null;
    if (existing) summary.existing += 1;
    if (existing && !options.updateExisting) {
      plan.rows.push({
        line,
        status: 'skipped',
        issues: [
          {
            level: 'skip',
            text: t('{name} ({number}) is already in your employees.', {
              name: isolate(existing.name),
              number: existing.number,
            }),
          },
        ],
        cells,
        record: null,
      });
      return;
    }

    const patch: Partial<Employee> = {};
    if (english || nameAr) patch.name = english || nameAr;
    if (nameAr) {
      patch.nameAr = nameAr;
      if (nameFromFile) summary.arabicNamesFromFiles += 1;
    }
    if (!english && !nameAr && !existing) {
      patch.name = t('Employee {number}', { number });
      note(t('No name in the file.'));
    }

    // Nationality and category.
    let category: EmployeeCategory = existing?.category ?? 'expat';
    if (cells.nationality) {
      const code = nationalityCode(cells.nationality);
      if (code) {
        patch.nationality = code;
        summary.nationalities.mapped += 1;
        if (category !== 'domestic') category = categoryForNationality(code);
      } else {
        summary.nationalities.unknown += 1;
        note(t('Nationality “{value}” not recognised.', { value: isolate(cells.nationality) }));
      }
    } else if (mapping.nationality != null) {
      summary.nationalities.missing += 1;
      if (!existing) note(t('No nationality in the file.'));
    }
    if (!existing && !patch.nationality) patch.nationality = '';
    patch.category = category;

    // Personal details.
    if (cells.gender) {
      const gender = readGender(cells.gender);
      if (gender) patch.gender = gender;
      else note(t('Gender “{value}” not recognised.', { value: isolate(cells.gender) }));
    }
    const birthDate = readDate('birthDate', cells.birthDate, issues);
    if (birthDate) patch.birthDate = birthDate;

    // Civil ID and documents.
    if (civilId) {
      patch.civilId = civilId;
      if (!isValidCivilId(civilId)) {
        summary.civilIdsToCheck += 1;
        note(t('This does not look like a valid Civil ID. Check the 12 digits.'));
      }
    }
    const civilIdExpiry = readDate('civilIdExpiry', cells.civilIdExpiry, issues);
    if (civilIdExpiry) patch.civilIdExpiry = civilIdExpiry;
    if (cells.passportNumber) {
      patch.passportNumber = normalizeDigits(cells.passportNumber).replace(/\s/g, '').toUpperCase();
    }
    const passportExpiry = readDate('passportExpiry', cells.passportExpiry, issues);
    if (passportExpiry) patch.passportExpiry = passportExpiry;
    const residencyExpiry = readDate('residencyExpiry', cells.residencyExpiry, issues);
    if (needsResidency(category)) {
      if (cells.residencyNumber) patch.residencyNumber = collapse(cells.residencyNumber);
      if (residencyExpiry) patch.residencyExpiry = residencyExpiry;
    }
    if (summary.documentExpiry && residencyExpiry) {
      summary.documentExpiry.total += 1;
      const civil = civilIdExpiry ?? existing?.civilIdExpiry;
      if (civil === residencyExpiry) summary.documentExpiry.sameAsCivilId += 1;
    }
    if (needsWorkPermit(category)) {
      if (cells.workPermitNumber) patch.workPermitNumber = collapse(cells.workPermitNumber);
      const permit = readDate('workPermitExpiry', cells.workPermitExpiry, issues);
      if (permit) patch.workPermitExpiry = permit;
    }
    const licenceExpiry = readDate('drivingLicenceExpiry', cells.drivingLicenceExpiry, issues);
    const licenceNumber = collapse(cells.drivingLicenceNumber);
    const drivingLicence =
      licenceExpiry || licenceNumber ? { number: licenceNumber, expiryDate: licenceExpiry } : null;
    if (drivingLicence) summary.drivingLicences += 1;

    // Job.
    if (cells.department) patch.department = collapse(cells.department);
    const title = collapse(cells.jobTitle);
    const titleAr = collapse(cells.jobTitleAr);
    if (title && ARABIC.test(title) && !LATIN.test(title)) {
      patch.jobTitleAr = titleAr || title;
      patch.jobTitle = englishJobTitle(title) || title;
    } else {
      if (title) patch.jobTitle = title;
      const arabic = titleAr || (title ? arabicJobTitle(title) : '');
      if (arabic) {
        patch.jobTitleAr = arabic;
        if (!titleAr) summary.arabicJobTitles += 1;
      }
    }
    const hireDate = readDate('hireDate', cells.hireDate, issues);
    if (hireDate) {
      patch.hireDate = hireDate;
      if (hireDate > on) {
        summary.futureHireDates += 1;
        note(t('The hire date is in the future ({date}).', { date: fmtDate(hireDate) }));
      }
    } else if (!existing?.hireDate) {
      if (!existing) patch.hireDate = null;
      // Noted on each row when the file has the column; a file without it is one remark.
      if (mapping.hireDate != null) {
        summary.missingHireDates += 1;
        if (!cells.hireDate) note(t('No hire date in the file.'));
      }
    }

    // Pay.
    if (cells.basicSalary) {
      const amount = parseAmount(cells.basicSalary);
      if (amount === null || amount < 0) {
        note(t('Basic salary: “{value}” is not an amount.', { value: isolate(cells.basicSalary) }));
      } else patch.basicSalary = round(dec(amount), places);
    }
    let iban = compactIban(normalizeDigits(cells.iban));
    const account = compactAccountNumber(cells.accountNumber);
    if (account && /^[A-Z]{2}\d{2}[A-Z0-9]{8,}$/.test(account) && !iban) iban = account;
    else if (account) {
      patch.accountNumber = account;
      summary.accountNumbers += 1;
      if (/^[45]\d{12,18}$/.test(account) && !isValidCardNumber(account)) {
        note(t('The salary card number looks wrong. Check it.'));
      }
    }
    if (iban) {
      patch.iban = iban;
      summary.ibans += 1;
      if (!isValidIban(iban)) note(t('This IBAN is not valid. Check the number.'));
    }
    const bank =
      bankFromIban(iban)?.code ??
      (cells.bank ? (findBank(cells.bank)?.code ?? collapse(cells.bank)) : '');
    if (bank) patch.bank = bank;

    // Contact.
    const phone = readPhone(cells.phone);
    if (phone) {
      patch.phone = phone.phone;
      summary.phones[phone.kind] += 1;
      if (phone.kind === 'kept') note(t('Phone number kept as written.'));
    }
    if (cells.email) {
      patch.email = cells.email.trim();
      if (!isValidEmail(cells.email)) note(t('The email address looks wrong.'));
    }
    if (cells.pifssNumber) patch.pifssNumber = collapse(cells.pifssNumber);

    // Notes: the blood group and the file's own notes.
    const extra = [
      cells.bloodGroup
        ? t('Blood group: {group}', { group: readBloodGroup(cells.bloodGroup) })
        : '',
      cells.notes,
    ].filter((line) => line && !(existing?.notes ?? '').includes(line));
    if (extra.length) patch.notes = [existing?.notes ?? '', ...extra].filter(Boolean).join('\n');

    // Papers that have expired or expire soon (informational).
    const merged = { ...existing, ...patch };
    const expiries = new Map<ISODate, string[]>();
    for (const doc of EXPIRY_DOCUMENTS) {
      const date =
        doc.key === 'drivingLicence'
          ? (drivingLicence?.expiryDate ?? null)
          : ((merged[doc.key] as ISODate | null | undefined) ?? null);
      if (!date || date > soon) continue;
      if (doc.type === 'residency' && !needsResidency(category)) continue;
      if (date < on) summary.expired += 1;
      else summary.expiring += 1;
      expiries.set(date, [...(expiries.get(date) ?? []), t(DOCUMENT_TYPES[doc.type].label)]);
    }
    for (const [date, names] of [...expiries].sort(([a], [b]) => a.localeCompare(b))) {
      const vars = { document: names[0], documents: listOf(names), date: fmtDate(date) };
      if (date < on) {
        info(
          names.length === 1
            ? t('{document} expired on {date}.', vars)
            : t('{documents} expired on {date}.', vars),
        );
      } else {
        info(
          names.length === 1
            ? t('{document} expires on {date}.', vars)
            : t('{documents} expire on {date}.', vars),
        );
      }
    }

    const notes = issues.filter((x) => x.level === 'warning' || x.level === 'info').length;
    summary.notes += notes;
    if (notes > 0) summary.rowsWithNotes += 1;
    if (existing) {
      info(
        t('Updates {name} ({number}).', {
          name: isolate(existing.name),
          number: existing.number,
        }),
      );
      summary.update += 1;
    } else summary.add += 1;

    const employee: Employee = existing
      ? { ...existing, ...patch }
      : createEmployee(ctx.company.id, {
          hireDate: null,
          ...patch,
          number,
          name: patch.name ?? '',
          status: 'active',
        });
    plan.rows.push({
      line,
      status: 'ready',
      issues,
      cells,
      record: { kind: 'employees', value: { employee, existing, drivingLicence } },
    });
  });
  return plan;
}

/** The register document for an employee's driving licence, new or updated. */
async function saveDrivingLicence(
  employee: Employee,
  licence: NonNullable<EmployeeRecord['drivingLicence']>,
): Promise<void> {
  const current = await db.complianceDocuments
    .where('employeeId')
    .equals(employee.id)
    .filter((d) => d.type === 'driving_licence' && !d.archived)
    .first();
  const doc = current
    ? {
        ...current,
        number: licence.number || current.number,
        expiryDate: licence.expiryDate ?? current.expiryDate,
      }
    : createComplianceDocument(employee.companyId, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: employee.id,
        number: licence.number,
        expiryDate: licence.expiryDate,
      });
  await saveComplianceDocument(doc, { log: false });
}

/** Thrown when the person may not import employees (staff and viewers). */
export class EmployeeImportError extends Error {}

/** Whether the person may import employees into the company (not staff or viewers). */
export async function mayImportEmployees(companyId: ID): Promise<boolean> {
  const link = await db.syncState.get(companyId);
  return !link || (canSeePeople(link.role) && link.status !== 'removed');
}

/**
 * Saves the employees of a planned file in batches, reporting progress, and
 * logs one activity entry for the whole import. Plan the file just before
 * (see `importEmployees` in import.ts). Staff and viewers of a company kept
 * in the cloud can't import employees.
 */
export async function commitEmployeeImport(
  companyId: ID,
  plan: ImportPlan,
  onProgress?: (progress: EmployeeImportProgress) => void,
): Promise<ImportResult> {
  if (!(await mayImportEmployees(companyId))) {
    throw new EmployeeImportError(t('Only owners, admins and accountants can import employees.'));
  }
  const records = plan.rows.flatMap((r) =>
    r.record?.kind === 'employees' ? [r.record.value] : [],
  );
  if (records.length === 0) throw new EmployeeImportError(t('There is nothing to import.'));
  let added = 0;
  let updated = 0;
  let documents = 0;
  onProgress?.({ done: 0, total: records.length });
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    await db.transaction(
      'rw',
      [db.employees, db.companies, db.activities, db.complianceDocuments],
      async () => {
        for (const record of batch) {
          // An employee that arrived meanwhile (from another device) is not added twice.
          if (!record.existing && record.employee.number) {
            const twin = await db.employees
              .where('[companyId+number]')
              .equals([companyId, record.employee.number])
              .first();
            if (twin) continue;
          }
          const saved = await saveEmployee(record.employee, { log: false });
          if (record.existing) updated += 1;
          else added += 1;
          if (record.drivingLicence) {
            await saveDrivingLicence(saved, record.drivingLicence);
            documents += 1;
          }
        }
      },
    );
    onProgress?.({ done: Math.min(records.length, start + batch.length), total: records.length });
  }
  await logActivity(companyId, 'employee', newId(), 'imported', {
    text:
      updated > 0
        ? msg('{count} employees imported and {updated} updated')
        : added === 1
          ? msg('{count} employee imported')
          : msg('{count} employees imported'),
    vars: { count: added, updated },
  });
  return {
    kind: 'employees',
    added,
    updated,
    skipped: plan.rows.length - added - updated,
    salaries: plan.employees?.salaries ?? false,
    newContacts: 0,
    documents,
    journalNumber: null,
  };
}
