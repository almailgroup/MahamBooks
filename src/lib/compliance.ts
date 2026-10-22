import { addMonths, lastDayOfMonth } from 'date-fns';
import type {
  ComplianceDocument,
  ComplianceDocumentType,
  ComplianceMark,
  DocumentOwnerType,
  DocumentRenewal,
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
  company_contract: { label: msg('Company contract'), owner: 'company', fee: 'government' },
  client_contract: { label: msg('Customer contract'), owner: 'other', fee: 'government' },
  customer_cost: { label: msg('Customer cost sheet'), owner: 'other', fee: 'government' },
  other: { label: msg('Other document'), owner: 'other', fee: 'government' },
};

/**
 * Types offered only with the register's extras (Company.registerExtras):
 * older versions show them as other documents.
 */
export const EXTRA_DOCUMENT_TYPES: readonly ComplianceDocumentType[] = [
  'company_contract',
  'client_contract',
  'customer_cost',
];

/** A customer's papers: kept under Other with the customer (clientId), who must be chosen. */
export const CUSTOMER_DOCUMENT_TYPES: readonly ComplianceDocumentType[] = [
  'client_contract',
  'customer_cost',
];

/** Contracts and cost sheets have no name of their own: their title is asked for. */
export function needsTitle(type: string): boolean {
  return (EXTRA_DOCUMENT_TYPES as readonly string[]).includes(type);
}

/** The company keeps contracts, customers' papers, vehicles and confidential documents (off until switched on). */
export function registerExtrasOn(
  company: { registerExtras?: boolean } | null | undefined,
): boolean {
  return company?.registerExtras === true;
}

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

/**
 * Types that can be added to the register for an owner (employee papers on
 * file are excluded); contracts and cost sheets only with the register's
 * extras.
 */
export function registerTypesFor(
  owner: DocumentOwnerType,
  extras = false,
): ComplianceDocumentType[] {
  return (Object.keys(DOCUMENT_TYPES) as ComplianceDocumentType[]).filter((type) => {
    const info = DOCUMENT_TYPES[type];
    if (info.fromEmployee) return false;
    if (!extras && EXTRA_DOCUMENT_TYPES.includes(type)) return false;
    if (type === 'other') return true;
    // A customer's papers belong to the customer, never to the company or a vehicle.
    if (CUSTOMER_DOCUMENT_TYPES.includes(type)) return owner === 'other';
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
  const clean = cleanReminderDays(days);
  return clean.length ? clean : [...DEFAULT_REMINDER_DAYS];
}

/**
 * Reminder days cleaned up as normalizeReminderDays does, but never filled
 * in: none stay none. Anything that isn't a list of numbers is none.
 */
export function cleanReminderDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  // As before: numbers written as text count too, anything else is dropped.
  const clean = [
    ...new Set(days.map((d) => Math.trunc(d as number)).filter((d) => Number.isFinite(d) && d > 0)),
  ];
  return clean.sort((a, b) => b - a);
}

/** At most this many reminders before an expiry (the company's, a type's). */
export const MAX_REMINDERS = 5;

/** Days before an expiry to remind, by document type (PeopleSettings.reminderDaysByType). */
export type ReminderDaysByType = Partial<Record<string, number[]>>;

/**
 * The lead times the owner chose (#18), offered when reminders by document
 * type are turned on: residencies 90, 60, 30 and 7 days before, passports
 * 180, 90 and 30, vehicles' papers 30, 14 and 7.
 */
export const RECOMMENDED_REMINDER_DAYS_BY_TYPE: Readonly<
  Partial<Record<ComplianceDocumentType, readonly number[]>>
> = {
  residency: [90, 60, 30, 7],
  passport: [180, 90, 30],
  vehicle_registration: [30, 14, 7],
  vehicle_insurance: [30, 14, 7],
};

/** Once expired, a paper is reminded of again every 7 days (the owner's choice, #18). */
export const RECOMMENDED_EXPIRED_REPEAT_DAYS = 7;

/** The new copy of a renewed paper is asked for 14 days after the renewal. */
export const RECOMMENDED_NEW_COPY_GRACE_DAYS = 14;

/**
 * Reminders by document type cleaned up: each type's days as
 * cleanReminderDays leaves them (at most MAX_REMINDERS), types without any
 * left out. Types this version doesn't know are kept as they are.
 */
export function normalizeReminderDaysByType(value: unknown): ReminderDaysByType {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ReminderDaysByType = {};
  for (const [type, days] of Object.entries(value as Record<string, unknown>)) {
    const clean = cleanReminderDays(days).slice(0, MAX_REMINDERS);
    if (type && clean.length) out[type] = clean;
  }
  return out;
}

/** What a company's reminder days are set in (PeopleSettings). */
export interface ReminderSettings {
  reminderDays?: readonly number[] | null;
  reminderDaysByType?: ReminderDaysByType | null;
}

/** A type's own days in the company's list, or none. */
function typeDays(byType: ReminderDaysByType | null | undefined, type: string): number[] {
  if (!byType || !Object.prototype.hasOwnProperty.call(byType, type)) return [];
  return cleanReminderDays(byType[type]);
}

/**
 * The days before its expiry a paper is reminded of: its own (`override`)
 * first, then its type's in the company's reminders by document type (#18),
 * then the company's days for every type (60, 30 and 7 by default). Without
 * reminders by type, exactly what it was before.
 */
export function reminderDaysFor(
  type: string,
  settings: ReminderSettings | null | undefined,
  override?: readonly number[] | null,
): number[] {
  return entryReminderDays(
    type,
    normalizeReminderDays(settings?.reminderDays),
    settings?.reminderDaysByType,
    override,
  );
}

/** reminderDaysFor with the company's days already worked out (`fallback`). */
function entryReminderDays(
  type: string,
  fallback: number[],
  byType: ReminderDaysByType | null | undefined,
  override?: readonly number[] | null,
): number[] {
  if (override?.length) return normalizeReminderDays(override);
  const own = typeDays(byType, type);
  return own.length ? own : fallback;
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
  /** What it is for, the customer and the vehicle (stored records, with the register's extras). */
  purposeId?: ID | null;
  clientId?: ID | null;
  vehicleId?: ID | null;
  /** Seen only by owners, admins and accountants (stored records). */
  confidential?: boolean;
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
export function employeeDocuments(
  employee: Employee,
  reminderDays: number[],
  byType?: ReminderDaysByType | null,
): RegisterEntry[] {
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
    reminderDays: entryReminderDays(type, reminderDays, byType),
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

/**
 * A stored record as a register entry, with its own reminder days, its
 * type's (`byType`, #18) or the company's (`reminderDays`).
 */
export function recordEntry(
  doc: ComplianceDocument,
  reminderDays: number[],
  byType?: ReminderDaysByType | null,
): RegisterEntry {
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
    reminderDays: entryReminderDays(doc.type, reminderDays, byType, doc.reminderDays),
    ownerType: doc.ownerType,
    ownerName: doc.ownerName,
    ...(doc.purposeId ? { purposeId: doc.purposeId } : {}),
    ...(doc.clientId ? { clientId: doc.clientId } : {}),
    ...(doc.vehicleId ? { vehicleId: doc.vehicleId } : {}),
    ...(doc.confidential === true ? { confidential: true } : {}),
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
  /** The company's reminders by document type (#18); none: every type uses `reminderDays`. */
  reminderDaysByType?: ReminderDaysByType | null;
}): RegisterEntry[] {
  const current = new Map(input.employees.filter(isCurrent).map((e) => [e.id, e]));
  const days = normalizeReminderDays(input.reminderDays);
  const byType = input.reminderDaysByType;
  return [
    ...input.documents
      .filter((d) => !d.archived && (d.ownerType !== 'employee' || current.has(d.employeeId ?? '')))
      .map((d) => recordEntry(d, days, byType)),
    ...[...current.values()].flatMap((e) => employeeDocuments(e, days, byType)),
  ];
}

/* -------------------------------------------------------------------------- */
/* Reminders after expiry and the new copy (#18)                              */
/* -------------------------------------------------------------------------- */

/** The kinds of paper a person may choose to be told about (email_alerts.document_kinds). */
export const DOCUMENT_ALERT_KINDS = ['company', 'vehicle', 'staff', 'client'] as const;
export type DocumentAlertKind = (typeof DOCUMENT_ALERT_KINDS)[number];

export function isDocumentAlertKind(value: unknown): value is DocumentAlertKind {
  return (DOCUMENT_ALERT_KINDS as readonly unknown[]).includes(value);
}

/**
 * Whose paper a register entry is, for the choice of kinds: an employee's
 * (staff), a vehicle's, a customer's (client) or the company's (everything
 * else, other owners included).
 */
export function documentAlertKind(
  entry: Pick<RegisterEntry, 'ownerType' | 'clientId'>,
): DocumentAlertKind {
  if (entry.ownerType === 'employee') return 'staff';
  if (entry.ownerType === 'vehicle') return 'vehicle';
  if (entry.clientId) return 'client';
  return 'company';
}

/** Whole days between 1 and `max`, or none (0) for anything else. */
export function wholeDays(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const days = Math.trunc(value);
  return days >= 1 && days <= max ? days : 0;
}

/** The most days between two reminders after expiry, and before the new copy is asked for. */
export const MAX_REPEAT_DAYS = 90;
export const MAX_NEW_COPY_DAYS = 365;

/**
 * The stage of something that lasts (expired, new copy missing) `daysIn`
 * days after it began (0 the first day): `base` first, then with
 * `repeatDays` every so many days `base+7`, `base+14`… Without repeats it
 * stays `base`.
 */
export function repeatedStage(base: string, daysIn: number, repeatDays: number): string {
  const every = wholeDays(repeatDays, MAX_REPEAT_DAYS);
  if (!every || daysIn < every) return base;
  return `${base}+${Math.floor(daysIn / every) * every}`;
}

/**
 * The stage of an expired paper `daysLeft` days from its expiry (-1 the
 * day after): "expired", then every `repeatDays` days "expired+7",
 * "expired+14"… until it is renewed.
 */
export function expiredStage(daysLeft: number, repeatDays: number | null | undefined): string {
  return repeatedStage('expired', Math.max(0, -daysLeft - 1), repeatDays ?? 0);
}

/** A file kept with the company, as far as the new copy is concerned. */
export interface CopyFile {
  id: ID;
  /** The register entry it is a copy of ("doc:<id>", "emp:<employeeId>:<type>"). */
  docKey?: string | null;
  /** The last day the paper in it is valid. */
  validUntil?: ISODate | null;
}

/** When the new copy of a renewed paper is asked for (PeopleSettings). */
export interface NewCopyRules {
  /** Days after the renewal; 0 or none: never. */
  newCopyGraceDays?: number | null;
  /** Renewals recorded before this day are not asked for theirs. */
  newCopySince?: ISODate | null;
}

/** Each register entry's latest renewal, by the entry's key. */
export function latestRenewals(renewals: readonly DocumentRenewal[]): Map<string, DocumentRenewal> {
  const latest = new Map<string, DocumentRenewal>();
  for (const renewal of renewals) {
    if (typeof renewal?.documentKey !== 'string' || typeof renewal.newExpiry !== 'string') continue;
    const before = latest.get(renewal.documentKey);
    if (
      !before ||
      renewal.newExpiry > before.newExpiry ||
      (renewal.newExpiry === before.newExpiry &&
        String(renewal.createdAt ?? '') > String(before.createdAt ?? ''))
    ) {
      latest.set(renewal.documentKey, renewal);
    }
  }
  return latest;
}

export interface NewCopyMissing {
  renewal: DocumentRenewal;
  /** The last day the new copy was waited for (the renewal and the days allowed). */
  due: ISODate;
  /** Days since then (1 the first day it is missing). */
  daysLate: number;
}

/**
 * Whether the new copy of a renewed paper is missing on `on`: the paper was
 * renewed (its latest renewal, recorded since the rule was turned on, gave
 * it the expiry it has now), the days allowed have passed, and no file is
 * its new copy: neither the renewal's own (`newCopyId`, still kept) nor a
 * file marked as this paper's copy valid until the new expiry. Null when
 * nothing is missing, or the rule is off.
 */
export function newCopyMissing(
  entry: Pick<RegisterEntry, 'key' | 'expiryDate'>,
  renewal: DocumentRenewal | undefined,
  files: readonly CopyFile[],
  rules: NewCopyRules | null | undefined,
  on: ISODate,
): NewCopyMissing | null {
  const grace = wholeDays(rules?.newCopyGraceDays, MAX_NEW_COPY_DAYS);
  if (!grace || !renewal || !entry.expiryDate || renewal.newExpiry !== entry.expiryDate) {
    return null;
  }
  const since = rules?.newCopySince;
  if (since && String(renewal.createdAt ?? '').slice(0, 10) < since) return null;
  const due = addDaysISO(renewal.renewedOn, grace);
  if (on <= due) return null;
  const copied = files.some(
    (f) =>
      (Boolean(renewal.newCopyId) && f.id === renewal.newCopyId) ||
      (f.docKey === entry.key && Boolean(f.validUntil) && f.validUntil! >= entry.expiryDate!),
  );
  if (copied) return null;
  return { renewal, due, daysLate: daysBetween(due, on) };
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

/** The employee's driving licences in the register; archived ones don't count. */
const heldLicences = (documents: readonly ComplianceDocument[], employeeId: ID) =>
  documents.filter(
    (d) =>
      d.type === 'driving_licence' &&
      !d.archived &&
      d.ownerType === 'employee' &&
      d.employeeId === employeeId,
  );

/**
 * The employee's driving licence in the register, the one that expires
 * last; archived ones don't count. A licence without an expiry date (such
 * as one filed from a scan, waiting for its dates) comes after every dated
 * one, so it never hides a licence that has expired. Null when they have none.
 */
export function currentDrivingLicence(
  documents: readonly ComplianceDocument[],
  employeeId: ID,
): ComplianceDocument | null {
  return (
    heldLicences(documents, employeeId).sort(
      (a, b) =>
        Number(!a.expiryDate) - Number(!b.expiryDate) ||
        (b.expiryDate ?? '').localeCompare(a.expiryDate ?? ''),
    )[0] ?? null
  );
}

/**
 * The licence a scan of the employee's driving licence is filed on: one
 * still waiting for its expiry date first (the newest record, as a scan
 * filed earlier made it), then the one that expires last. Null when they
 * have none.
 */
export function drivingLicenceToFileOn(
  documents: readonly ComplianceDocument[],
  employeeId: ID,
): ComplianceDocument | null {
  return (
    heldLicences(documents, employeeId).sort((a, b) =>
      (b.expiryDate ?? '9999').localeCompare(a.expiryDate ?? '9999'),
    )[0] ?? null
  );
}

/** A document a current employee needs and doesn't hold valid. */
export interface MissingDocument {
  employeeId: ID;
  type: ComplianceDocumentType;
  /**
   * None on file (archived ones don't count), only expired ones, or only
   * ones without an expiry date (filed from a scan, its dates not entered).
   */
  reason: 'missing' | 'expired' | 'undated';
  /** The one that expired last (or the undated one), to renew or complete it; null when there is none. */
  document: ComplianceDocument | null;
}

/**
 * What current employees need and don't hold valid, by employee: for now a
 * driving licence for those who drive for work. A licence is valid until
 * the day after its expiry date. One without an expiry date doesn't count
 * as valid: a scan filed as a licence makes one, and its dates have to be
 * entered. Employees who have left need nothing.
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
    // The one expiring last is valid: nothing is missing.
    if (licence?.expiryDate && licence.expiryDate >= input.on) continue;
    out.push({
      employeeId: employee.id,
      type: 'driving_licence',
      reason: !licence ? 'missing' : licence.expiryDate ? 'expired' : 'undated',
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
