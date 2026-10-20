import { addMonths, lastDayOfMonth } from 'date-fns';
import type {
  ComplianceDocument,
  ComplianceDocumentType,
  ComplianceMark,
  DocumentOwnerType,
  Employee,
  ID,
  ISODate,
  KuwaitProfile,
  LegalForm,
  PeopleSettings,
  Vehicle,
} from '@/db/types';
import { addDaysISO, daysBetween, parseISODate, toISODate } from '@/lib/dates';
import { isShareholding } from '@/lib/kuwait-rules';
import { lookup } from '@/lib/known';
import { msg } from '@/i18n';
import {
  insuredWithPifss,
  isCurrent,
  isStateless,
  needsResidency,
  needsWorkPermit,
} from './hr/employees';
import { isDriverTitle } from './hr/job-titles';

/**
 * The compliance calendar: expiring documents (company licences, employee
 * residencies, vehicles…) and the statutory deadlines that follow from the
 * financial year end and the company's legal form. Deadlines are common
 * practice in Kuwait as of 2026 and are shown as reminders, not legal advice;
 * those marked `checkWithAuditor` depend on details the app doesn't know.
 */

/* -------------------------------------------------------------------------- */
/* Document types                                                             */
/* -------------------------------------------------------------------------- */

/** Expense account a renewal fee is recorded in (codes of the Kuwait chart). */
export type FeeAccountKey = 'government' | 'licence' | 'insurance' | 'rent';

export const FEE_ACCOUNT_CODES: Record<FeeAccountKey, string> = {
  government: '6090',
  licence: '6100',
  insurance: '6160',
  rent: '6060',
};

export interface DocumentTypeInfo {
  label: string;
  /** Who the document usually belongs to. */
  owner: DocumentOwnerType;
  fee: FeeAccountKey;
  /** Read from the employee record (never stored in the register). */
  fromEmployee?: boolean;
}

export const DOCUMENT_TYPES: Record<ComplianceDocumentType, DocumentTypeInfo> = {
  commercial_licence: { label: msg('Commercial licence'), owner: 'company', fee: 'licence' },
  commercial_registration: {
    label: msg('Commercial registration (CR)'),
    owner: 'company',
    fee: 'licence',
  },
  pam_company_file: { label: msg('PAM company file'), owner: 'company', fee: 'government' },
  authorised_signatories: {
    label: msg('Authorised signatories'),
    owner: 'company',
    fee: 'licence',
  },
  pam_salary_certificate: {
    label: msg('PAM salary certificate'),
    owner: 'company',
    fee: 'government',
  },
  mof_tax_card: { label: msg('MOF tax card'), owner: 'company', fee: 'government' },
  tax_clearance: { label: msg('Tax clearance certificate'), owner: 'company', fee: 'government' },
  kcci_membership: { label: msg('KCCI membership'), owner: 'company', fee: 'licence' },
  municipality_licence: {
    label: msg('Municipality licence'),
    owner: 'company',
    fee: 'licence',
  },
  fire_licence: { label: msg('Fire department licence'), owner: 'company', fee: 'licence' },
  lease_contract: { label: msg('Lease contract'), owner: 'company', fee: 'rent' },
  civil_id: { label: msg('Civil ID'), owner: 'employee', fee: 'government', fromEmployee: true },
  passport: { label: msg('Passport'), owner: 'employee', fee: 'government', fromEmployee: true },
  residency: {
    label: msg('Residency'),
    owner: 'employee',
    fee: 'government',
    fromEmployee: true,
  },
  work_permit: {
    label: msg('Work permit'),
    owner: 'employee',
    fee: 'government',
    fromEmployee: true,
  },
  employment_contract: {
    label: msg('Employment contract'),
    owner: 'employee',
    fee: 'government',
    fromEmployee: true,
  },
  central_agency_card: {
    label: msg('Central Agency review card'),
    owner: 'employee',
    fee: 'government',
    fromEmployee: true,
  },
  health_insurance: { label: msg('Health insurance'), owner: 'employee', fee: 'government' },
  driving_licence: { label: msg('Driving licence'), owner: 'employee', fee: 'government' },
  vehicle_registration: {
    label: msg('Vehicle registration'),
    owner: 'vehicle',
    fee: 'government',
  },
  vehicle_insurance: { label: msg('Vehicle insurance'), owner: 'vehicle', fee: 'insurance' },
  other: { label: msg('Other document'), owner: 'other', fee: 'government' },
};

/** What the app knows of a type of document; a type a newer version saved is an other document. */
export function documentTypeInfo(type: string): DocumentTypeInfo {
  return lookup(DOCUMENT_TYPES, type, DOCUMENT_TYPES.other);
}

export const OWNER_LABELS: Record<DocumentOwnerType, string> = {
  company: msg('Company'),
  employee: msg('Employee'),
  vehicle: msg('Vehicle'),
  other: msg('Other'),
};

/** Who a kind of owner is, in words (English key); one a newer version saved is other. */
export function ownerLabel(owner: string): string {
  return lookup(OWNER_LABELS, owner, OWNER_LABELS.other);
}

/** Types that can be added to the register for an owner (employee papers on file are excluded). */
export function registerTypesFor(owner: DocumentOwnerType): ComplianceDocumentType[] {
  return (Object.keys(DOCUMENT_TYPES) as ComplianceDocumentType[]).filter((type) => {
    const info = DOCUMENT_TYPES[type];
    if (info.fromEmployee) return false;
    if (type === 'other') return true;
    return owner === 'other' || info.owner === owner;
  });
}

/* -------------------------------------------------------------------------- */
/* Expiry status                                                              */
/* -------------------------------------------------------------------------- */

export const DEFAULT_REMINDER_DAYS = [60, 30, 7];

export type ExpiryStatus = 'valid' | 'expiring' | 'expired';

export const EXPIRY_LABELS: Record<ExpiryStatus, string> = {
  valid: msg('Valid'),
  expiring: msg('Expiring'),
  expired: msg('Expired'),
};

/** Reminder days cleaned up: whole positive numbers, no repeats, largest first. */
export function normalizeReminderDays(days: readonly number[] | null | undefined): number[] {
  const clean = [...new Set((days ?? []).map((d) => Math.trunc(d)).filter((d) => d > 0))];
  clean.sort((a, b) => b - a);
  return clean.length ? clean : [...DEFAULT_REMINDER_DAYS];
}

export interface ExpiryInfo {
  status: ExpiryStatus;
  /** Days from `on` to the expiry (negative once expired); null without an expiry date. */
  daysLeft: number | null;
  /** The reminder reached, e.g. 30 when 20 days are left with reminders at 60/30/7. */
  reminder: number | null;
}

/**
 * Valid, expiring (within the first reminder) or expired. A document is still
 * valid on its expiry date and expired the day after. Without an expiry date
 * it is valid.
 */
export function expiryStatus(
  expiryDate: ISODate | null | undefined,
  reminderDays: readonly number[],
  on: ISODate,
): ExpiryInfo {
  if (!expiryDate) return { status: 'valid', daysLeft: null, reminder: null };
  const daysLeft = daysBetween(on, expiryDate);
  if (daysLeft < 0) return { status: 'expired', daysLeft, reminder: null };
  const days = normalizeReminderDays(reminderDays);
  const reached = days.filter((d) => daysLeft <= d);
  if (!reached.length) return { status: 'valid', daysLeft, reminder: null };
  return { status: 'expiring', daysLeft, reminder: Math.min(...reached) };
}

/* -------------------------------------------------------------------------- */
/* Register entries                                                           */
/* -------------------------------------------------------------------------- */

/** A line of the documents register: a stored record or a document on an employee's file. */
export interface RegisterEntry {
  /** "doc:<id>" or "emp:<employeeId>:<type>". */
  key: string;
  source: 'record' | 'employee';
  recordId: ID | null;
  employeeId: ID | null;
  type: ComplianceDocumentType;
  /** Free title of a stored record; empty means "use the type's name". */
  title: string;
  number: string;
  issuer: string;
  issueDate: ISODate | null;
  expiryDate: ISODate | null;
  renewalCost: number;
  reminderDays: number[];
  ownerType: DocumentOwnerType;
  /** Vehicle or other owner's name (stored records). */
  ownerName: string;
}

export const recordKey = (id: ID) => `doc:${id}`;
export const employeeDocumentKey = (employeeId: ID, type: ComplianceDocumentType) =>
  `emp:${employeeId}:${type}`;

/** The employee field holding each document's expiry date. */
export const EMPLOYEE_EXPIRY_FIELDS = {
  civil_id: 'civilIdExpiry',
  passport: 'passportExpiry',
  residency: 'residencyExpiry',
  work_permit: 'workPermitExpiry',
  employment_contract: 'contractEnd',
  central_agency_card: 'centralCardExpiry',
} as const satisfies Partial<Record<ComplianceDocumentType, keyof Employee>>;

export type EmployeeDocumentType = keyof typeof EMPLOYEE_EXPIRY_FIELDS;

/** The employee field holding each document's number, when it has one. */
export const EMPLOYEE_NUMBER_FIELDS = {
  civil_id: 'civilId',
  passport: 'passportNumber',
  residency: 'residencyNumber',
  work_permit: 'workPermitNumber',
  central_agency_card: 'centralCardNumber',
} as const satisfies Partial<Record<EmployeeDocumentType, keyof Employee>>;

export function isEmployeeDocumentType(type: ComplianceDocumentType): type is EmployeeDocumentType {
  return type in EMPLOYEE_EXPIRY_FIELDS;
}

/**
 * The documents on an employee's own record, as register entries: Civil ID
 * and passport for everyone, residency for expatriates and domestic workers,
 * the work permit for expatriates, the Central Agency review card for
 * stateless staff (who need no residency), and the end of a fixed-term
 * contract. Only documents with a number or an expiry date are listed.
 */
export function employeeDocuments(employee: Employee, reminderDays: number[]): RegisterEntry[] {
  const entry = (
    type: EmployeeDocumentType,
    number: string,
    expiryDate: ISODate | null,
  ): RegisterEntry => ({
    key: employeeDocumentKey(employee.id, type),
    source: 'employee',
    recordId: null,
    employeeId: employee.id,
    type,
    title: '',
    number,
    issuer: '',
    issueDate: null,
    expiryDate,
    renewalCost: 0,
    reminderDays,
    ownerType: 'employee',
    ownerName: '',
  });
  const out: RegisterEntry[] = [];
  const has = (number: string | undefined, expiry: ISODate | null | undefined) =>
    Boolean(number?.trim() || expiry);
  if (has(employee.civilId, employee.civilIdExpiry)) {
    out.push(entry('civil_id', employee.civilId, employee.civilIdExpiry));
  }
  if (has(employee.passportNumber, employee.passportExpiry)) {
    out.push(entry('passport', employee.passportNumber, employee.passportExpiry));
  }
  if (needsResidency(employee) && has(employee.residencyNumber, employee.residencyExpiry)) {
    out.push(entry('residency', employee.residencyNumber, employee.residencyExpiry));
  }
  if (needsWorkPermit(employee) && has(employee.workPermitNumber, employee.workPermitExpiry)) {
    out.push(entry('work_permit', employee.workPermitNumber, employee.workPermitExpiry));
  }
  if (isStateless(employee) && has(employee.centralCardNumber, employee.centralCardExpiry)) {
    out.push(
      entry(
        'central_agency_card',
        employee.centralCardNumber ?? '',
        employee.centralCardExpiry ?? null,
      ),
    );
  }
  if (employee.contractType === 'fixed' && employee.contractEnd) {
    out.push(entry('employment_contract', '', employee.contractEnd));
  }
  return out;
}

export function recordEntry(doc: ComplianceDocument, reminderDays: number[]): RegisterEntry {
  return {
    key: recordKey(doc.id),
    source: 'record',
    recordId: doc.id,
    employeeId: doc.ownerType === 'employee' ? doc.employeeId : null,
    type: doc.type,
    title: doc.title,
    number: doc.number,
    issuer: doc.issuer,
    issueDate: doc.issueDate,
    expiryDate: doc.expiryDate,
    renewalCost: doc.renewalCost,
    reminderDays: doc.reminderDays?.length ? normalizeReminderDays(doc.reminderDays) : reminderDays,
    ownerType: doc.ownerType,
    ownerName: doc.ownerName,
  };
}

/**
 * Everything the register tracks: stored records that are not archived and
 * the documents of current employees. Papers of employees who have left
 * are not tracked any more.
 */
export function registerEntries(input: {
  employees: Employee[];
  documents: ComplianceDocument[];
  reminderDays: number[];
}): RegisterEntry[] {
  const current = new Map(input.employees.filter(isCurrent).map((e) => [e.id, e]));
  const days = normalizeReminderDays(input.reminderDays);
  return [
    ...input.documents
      .filter((d) => !d.archived && (d.ownerType !== 'employee' || current.has(d.employeeId ?? '')))
      .map((d) => recordEntry(d, days)),
    ...[...current.values()].flatMap((e) => employeeDocuments(e, days)),
  ];
}

/* -------------------------------------------------------------------------- */
/* Documents an employee needs                                                */
/* -------------------------------------------------------------------------- */

/** The company checks that drivers hold a valid driving licence (off until switched on). */
export function checksDrivingLicences(
  settings: Pick<PeopleSettings, 'drivingLicences'> | null | undefined,
): boolean {
  return settings?.drivingLicences === true;
}

/**
 * Whether the employee drives for work and so needs a driving licence:
 * what is set on their page first, then a vehicle they are the driver of,
 * then their job title (isDriverTitle). Vehicles are passed once the
 * company's vehicles have drivers (#17); without them only the setting and
 * the title count.
 */
export function requiresDrivingLicence(
  employee: Pick<
    Employee,
    'id' | 'jobTitle' | 'jobTitleAr' | 'pamJobTitle' | 'drivingLicenceRequired'
  >,
  vehicles?: readonly Pick<Vehicle, 'driverEmployeeId' | 'archived'>[],
): boolean {
  if (typeof employee.drivingLicenceRequired === 'boolean') return employee.drivingLicenceRequired;
  if (vehicles?.some((v) => !v.archived && v.driverEmployeeId === employee.id)) return true;
  return isDriverTitle(employee);
}

/** Latest expiry first; a licence without an expiry date counts as the latest. */
const byExpiryDesc = (a: ComplianceDocument, b: ComplianceDocument) =>
  (b.expiryDate ?? '9999').localeCompare(a.expiryDate ?? '9999');

/**
 * The employee's driving licence in the register, the one that expires
 * last; archived ones don't count. Null when they have none.
 */
export function currentDrivingLicence(
  documents: readonly ComplianceDocument[],
  employeeId: ID,
): ComplianceDocument | null {
  const held = documents.filter(
    (d) =>
      d.type === 'driving_licence' &&
      !d.archived &&
      d.ownerType === 'employee' &&
      d.employeeId === employeeId,
  );
  return held.sort(byExpiryDesc)[0] ?? null;
}

/** A document a current employee needs and doesn't hold valid. */
export interface MissingDocument {
  employeeId: ID;
  type: ComplianceDocumentType;
  /** None on file (archived ones don't count), or only expired ones. */
  reason: 'missing' | 'expired';
  /** The one that expired last, to renew it; null when there is none. */
  document: ComplianceDocument | null;
}

/**
 * What current employees need and don't hold valid, by employee: for now a
 * driving licence for those who drive for work. A licence is valid until
 * the day after its expiry date, and without an expiry date (as in the
 * register). Employees who have left need nothing.
 */
export function missingDocuments(input: {
  employees: Employee[];
  documents: ComplianceDocument[];
  on: ISODate;
  vehicles?: readonly Pick<Vehicle, 'driverEmployeeId' | 'archived'>[];
}): MissingDocument[] {
  const licences = new Map<ID, ComplianceDocument[]>();
  for (const doc of input.documents) {
    if (doc.type !== 'driving_licence' || doc.ownerType !== 'employee' || !doc.employeeId) continue;
    licences.set(doc.employeeId, [...(licences.get(doc.employeeId) ?? []), doc]);
  }
  const out: MissingDocument[] = [];
  for (const employee of input.employees) {
    if (!isCurrent(employee) || !requiresDrivingLicence(employee, input.vehicles)) continue;
    const licence = currentDrivingLicence(licences.get(employee.id) ?? [], employee.id);
    // The one expiring last is valid (or has no expiry date): nothing is missing.
    if (licence && (!licence.expiryDate || licence.expiryDate >= input.on)) continue;
    out.push({
      employeeId: employee.id,
      type: 'driving_licence',
      reason: licence ? 'expired' : 'missing',
      document: licence,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Statutory deadlines                                                        */
/* -------------------------------------------------------------------------- */

export type StatutoryRule =
  | 'audited_statements'
  | 'income_tax_return'
  | 'income_tax_instalment'
  | 'zakat'
  | 'kfas'
  | 'nlst'
  | 'pifss';

export interface StatutoryDeadline {
  /** Stable key for marking it done, e.g. "income_tax_instalment_2:2026-12-31". */
  key: string;
  rule: StatutoryRule;
  title: string;
  /** Values for the title's placeholders (e.g. the instalment number). */
  vars: Record<string, number>;
  /** The financial year end (yyyy-MM-dd) or, for PIFSS, the month paid for (yyyy-MM). */
  period: string;
  periodKind: 'year' | 'month';
  dueDate: ISODate;
  /** One line on what it is and who it applies to. */
  explanation: string;
  /** The rule depends on details the app can't know. */
  checkWithAuditor: boolean;
}

export interface StatutoryContext {
  fiscalYearEnd: { month: number; day: number };
  profile: Pick<KuwaitProfile, 'legalForm' | 'foreignOwnershipPercent'>;
  settings: Pick<PeopleSettings, 'auditFilingMonths' | 'pifssDueDay'>;
  /** The company has Kuwaiti or GCC staff (or a PIFSS employer number). */
  pifss: boolean;
}

/** What the deadlines of a company depend on: its year end, legal form, settings and staff. */
export function statutoryContextOf(input: {
  fiscalYearEnd: { month: number; day: number };
  profile: KuwaitProfile;
  settings: Pick<PeopleSettings, 'auditFilingMonths' | 'pifssDueDay'>;
  employees: Employee[];
}): StatutoryContext {
  return {
    fiscalYearEnd: input.fiscalYearEnd,
    profile: input.profile,
    settings: input.settings,
    pifss:
      Boolean(input.profile.pifssEmployerNumber.trim()) ||
      input.employees.some((e) => isCurrent(e) && insuredWithPifss(e.category)),
  };
}

/** Legal forms that file audited financial statements with MOCI. */
const NO_AUDIT_FORMS: LegalForm[] = ['sole_proprietorship', 'freelance'];

export function filesAuditedStatements(form: LegalForm): boolean {
  return !NO_AUDIT_FORMS.includes(form);
}

/** Foreign (non-GCC) shareholders or a foreign branch: 15% income tax on their share. */
export function paysIncomeTax(
  profile: Pick<KuwaitProfile, 'legalForm' | 'foreignOwnershipPercent'>,
): boolean {
  return profile.legalForm === 'foreign_branch' || profile.foreignOwnershipPercent > 0;
}

const RULE_TEXT: Record<StatutoryRule, { title: string; explanation: string; check: boolean }> = {
  audited_statements: {
    title: msg('Audited financial statements to MOCI'),
    explanation: msg(
      'Companies file their audited statements with the Ministry of Commerce each year; the licence renewal needs them.',
    ),
    check: true,
  },
  income_tax_return: {
    title: msg('Income tax declaration'),
    explanation: msg(
      'Foreign shareholders’ share of the profit is taxed at 15%. The declaration is due by the 15th day of the fourth month after the year end.',
    ),
    check: true,
  },
  income_tax_instalment: {
    title: msg('Income tax instalment {number} of 4'),
    explanation: msg(
      'The tax can be paid in four instalments: the 15th day of the 4th, 6th, 9th and 12th months after the year end.',
    ),
    check: true,
  },
  zakat: {
    title: msg('Zakat return'),
    explanation: msg(
      'Kuwaiti shareholding companies pay Zakat of 1% of net profit, filed with the Ministry of Finance.',
    ),
    check: true,
  },
  kfas: {
    title: msg('KFAS contribution'),
    explanation: msg(
      'Shareholding companies contribute 1% of net profit to the Kuwait Foundation for the Advancement of Sciences.',
    ),
    check: true,
  },
  nlst: {
    title: msg('NLST return'),
    explanation: msg(
      'Companies listed on Boursa Kuwait pay the National Labour Support Tax of 2.5% of net profit.',
    ),
    check: true,
  },
  pifss: {
    title: msg('PIFSS contributions'),
    explanation: msg(
      'Monthly social security contributions for Kuwaiti and GCC staff, paid to PIFSS by the due day of the next month.',
    ),
    check: true,
  },
};

/** End of the financial year that ends in calendar year `year`. */
export function fiscalYearEndIn(year: number, end: { month: number; day: number }): ISODate {
  const month = Math.min(12, Math.max(1, Math.trunc(end.month) || 12));
  const last = lastDayOfMonth(new Date(year, month - 1, 1)).getDate();
  const day = Math.min(last, Math.max(1, Math.trunc(end.day) || last));
  return toISODate(new Date(year, month - 1, day));
}

/** The `day` of the `n`-th month after the month of `date` (clamped to the month's length). */
export function dayOfMonthAfter(date: ISODate, months: number, day: number): ISODate {
  const start = parseISODate(date);
  const target = addMonths(new Date(start.getFullYear(), start.getMonth(), 1), months);
  const last = lastDayOfMonth(target).getDate();
  return toISODate(new Date(target.getFullYear(), target.getMonth(), Math.min(day, last)));
}

/** `months` after a date; a month-end date stays at the month end (31 Dec + 3 → 31 Mar). */
export function monthsAfter(date: ISODate, months: number): ISODate {
  const start = parseISODate(date);
  const moved = addMonths(start, months);
  return toISODate(
    start.getDate() === lastDayOfMonth(start).getDate() ? lastDayOfMonth(moved) : moved,
  );
}

/** Deadlines that follow from one financial year ending on `yearEnd`. */
export function yearDeadlines(ctx: StatutoryContext, yearEnd: ISODate): StatutoryDeadline[] {
  const out: StatutoryDeadline[] = [];
  const add = (
    rule: StatutoryRule,
    dueDate: ISODate,
    key: string = rule,
    vars: Record<string, number> = {},
  ) => {
    const text = RULE_TEXT[rule];
    out.push({
      key: `${key}:${yearEnd}`,
      rule,
      title: text.title,
      vars,
      period: yearEnd,
      periodKind: 'year',
      dueDate,
      explanation: text.explanation,
      checkWithAuditor: text.check,
    });
  };
  const form = ctx.profile.legalForm;
  if (filesAuditedStatements(form)) {
    const months = Math.max(1, Math.trunc(ctx.settings.auditFilingMonths) || 3);
    add('audited_statements', monthsAfter(yearEnd, months));
  }
  const fourth = dayOfMonthAfter(yearEnd, 4, 15);
  if (paysIncomeTax(ctx.profile)) {
    add('income_tax_return', fourth);
    [4, 6, 9, 12].forEach((month, i) =>
      add(
        'income_tax_instalment',
        dayOfMonthAfter(yearEnd, month, 15),
        `income_tax_instalment_${i + 1}`,
        {
          number: i + 1,
        },
      ),
    );
  }
  if (isShareholding(form)) {
    add('zakat', fourth);
    add('kfas', fourth);
  }
  if (form === 'ksc_listed') add('nlst', fourth);
  return out;
}

/** PIFSS payment for the contributions of `month` (yyyy-MM). */
export function pifssDeadline(month: string, dueDay: number): StatutoryDeadline {
  const text = RULE_TEXT.pifss;
  const day = Math.min(28, Math.max(1, Math.trunc(dueDay) || 15));
  return {
    key: `pifss:${month}`,
    rule: 'pifss',
    title: text.title,
    vars: {},
    period: month,
    periodKind: 'month',
    dueDate: dayOfMonthAfter(`${month}-01`, 1, day),
    explanation: text.explanation,
    checkWithAuditor: text.check,
  };
}

/** Statutory deadlines falling due between `from` and `to` (inclusive), by due date. */
export function statutoryDeadlines(
  ctx: StatutoryContext,
  from: ISODate,
  to: ISODate,
): StatutoryDeadline[] {
  if (to < from) return [];
  const out: StatutoryDeadline[] = [];
  // A year's deadlines run up to 12 months after its end.
  const firstYear = Number(from.slice(0, 4)) - 2;
  const lastYear = Number(to.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    out.push(...yearDeadlines(ctx, fiscalYearEndIn(year, ctx.fiscalYearEnd)));
  }
  if (ctx.pifss) {
    // The month before `from` is paid in `from`'s month.
    let cursor = dayOfMonthAfter(from, -1, 1);
    while (cursor <= to) {
      out.push(pifssDeadline(cursor.slice(0, 7), ctx.settings.pifssDueDay));
      cursor = dayOfMonthAfter(cursor, 1, 1);
    }
  }
  return out
    .filter((d) => d.dueDate >= from && d.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}

/* -------------------------------------------------------------------------- */
/* The calendar                                                               */
/* -------------------------------------------------------------------------- */

export type ComplianceItemStatus = 'overdue' | 'due_soon' | 'upcoming' | 'done';

export const ITEM_STATUS_LABELS: Record<ComplianceItemStatus, string> = {
  overdue: msg('Overdue'),
  due_soon: msg('Due soon'),
  upcoming: msg('Upcoming'),
  done: msg('Done'),
};

/** Statutory items within this many days are "due soon". */
export const DUE_SOON_DAYS = 14;

/** How far back unfinished deadlines are reported as overdue. */
export const OVERDUE_LOOKBACK_DAYS = 365;

/**
 * The earliest due date to report as overdue on `from`: when the company
 * started using the app, at most a year back.
 */
export function overdueSince(companyCreatedAt: string, from: ISODate): ISODate {
  const started = companyCreatedAt.slice(0, 10);
  const lookback = addDaysISO(from, -OVERDUE_LOOKBACK_DAYS);
  return started > lookback ? started : lookback;
}

export interface ComplianceItem {
  key: string;
  kind: 'statutory' | 'document';
  dueDate: ISODate;
  /** Days from today; negative when overdue. */
  daysLeft: number;
  status: ComplianceItemStatus;
  deadline: StatutoryDeadline | null;
  entry: RegisterEntry | null;
  mark: ComplianceMark | null;
}

/**
 * The calendar from `from` for `days` days, plus what is overdue: statutory
 * deadlines not marked done since `overdueSince`, and expired documents.
 * Documents expiring in the window are listed, renewed ones drop out.
 */
export function complianceCalendar(input: {
  ctx: StatutoryContext;
  entries: RegisterEntry[];
  marks: ComplianceMark[];
  from: ISODate;
  days: number;
  /** Earliest due date to report as overdue (e.g. when the company started using the app). */
  overdueSince: ISODate;
}): ComplianceItem[] {
  const { from } = input;
  const to = addDaysISO(from, Math.max(0, Math.trunc(input.days)));
  const marks = new Map(input.marks.map((m) => [m.key, m]));
  const items: ComplianceItem[] = [];
  const since = input.overdueSince < from ? input.overdueSince : from;
  for (const deadline of statutoryDeadlines(input.ctx, since, to)) {
    const mark = marks.get(deadline.key) ?? null;
    const daysLeft = daysBetween(from, deadline.dueDate);
    // Done items stay in the window but not in the overdue list.
    if (mark && daysLeft < 0) continue;
    items.push({
      key: deadline.key,
      kind: 'statutory',
      dueDate: deadline.dueDate,
      daysLeft,
      status: mark
        ? 'done'
        : daysLeft < 0
          ? 'overdue'
          : daysLeft <= DUE_SOON_DAYS
            ? 'due_soon'
            : 'upcoming',
      deadline,
      entry: null,
      mark,
    });
  }
  for (const entry of input.entries) {
    if (!entry.expiryDate || entry.expiryDate > to) continue;
    const info = expiryStatus(entry.expiryDate, entry.reminderDays, from);
    items.push({
      key: entry.key,
      kind: 'document',
      dueDate: entry.expiryDate,
      daysLeft: info.daysLeft ?? 0,
      status:
        info.status === 'expired'
          ? 'overdue'
          : info.status === 'expiring'
            ? 'due_soon'
            : 'upcoming',
      deadline: null,
      entry,
      mark: null,
    });
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}
