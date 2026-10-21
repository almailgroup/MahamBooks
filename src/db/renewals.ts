import { db } from './db';
import { logActivity } from './activity';
import { accountingSettings } from './chart-setup';
import { createAccount, saveAccount } from './accounting';
import { nowStamp } from './defaults';
import { addAttachment, createExpense, saveExpense } from './purchases';
import { getPeopleSettings } from './people';
import type {
  Account,
  Activity,
  Attachment,
  Company,
  ComplianceDocument,
  ComplianceDocumentType,
  ComplianceMark,
  DocumentPurpose,
  DocumentRenewal,
  Employee,
  Expense,
  ID,
  ISODate,
  Vehicle,
} from './types';
import {
  checksDrivingLicences,
  complianceCalendar,
  drivingLicenceToFileOn,
  CUSTOMER_DOCUMENT_TYPES,
  documentTypeInfo,
  EMPLOYEE_EXPIRY_FIELDS,
  EMPLOYEE_NUMBER_FIELDS,
  expiryStatus,
  FEE_ACCOUNT_CODES,
  isEmployeeDocumentType,
  missingDocuments,
  needsTitle,
  normalizeReminderDays,
  overdueSince,
  registerEntries,
  statutoryContextOf,
  type ComplianceItem,
  type EmployeeDocumentType,
  type ExpiryInfo,
  type FeeAccountKey,
  recordKey,
  type MissingDocument,
  type RegisterEntry,
  type StatutoryContext,
} from '@/lib/compliance';
import { CHART_TEMPLATES } from '@/lib/accounting/charts';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import { addDaysISO, today } from '@/lib/dates';
import { currencyPrecision, round } from '@/lib/money';
import { newId } from '@/lib/ids';
import { linkHasFeature } from '@/cloud/features';
import { normalizeSearch } from '@/features/search/normalize';
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

/**
 * The document as it is saved, checked against the company's records (read
 * in the running transaction): its employee, customer and vehicle are the
 * company's, and older versions find the customer's name or the vehicle's
 * plate in `ownerName`. A confidential document stays confidential.
 */
async function preparedDocument(
  input: ComplianceDocument,
  existing: ComplianceDocument | undefined,
): Promise<{ company: Company; doc: ComplianceDocument }> {
  const company = await db.companies.get(input.companyId);
  if (!company) throw new ComplianceError(t('Company not found'));
  if (documentTypeInfo(input.type).fromEmployee) {
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
  let ownerName = input.ownerType === 'employee' ? '' : input.ownerName.trim();
  // A customer's paper is kept under Other, a vehicle's under its vehicle.
  const clientId = input.ownerType === 'other' ? input.clientId || null : null;
  if (clientId) {
    const client = await db.clients.get(clientId);
    if (!client || client.companyId !== company.id) {
      throw new ComplianceError(t('Choose a customer of this company.'));
    }
    ownerName = client.name;
  } else if (CUSTOMER_DOCUMENT_TYPES.includes(input.type)) {
    throw new ComplianceError(t('Choose the customer the document belongs to.'));
  }
  const vehicleId = input.ownerType === 'vehicle' ? input.vehicleId || null : null;
  if (vehicleId) {
    const vehicle = await db.vehicles.get(vehicleId);
    if (!vehicle || vehicle.companyId !== company.id) {
      throw new ComplianceError(t('Choose a vehicle of this company.'));
    }
    ownerName = vehicle.plate;
  }
  if (input.ownerType === 'vehicle' && !ownerName) {
    throw new ComplianceError(t('Enter the vehicle’s plate number or name.'));
  }
  if (needsTitle(input.type) && !input.title.trim()) {
    throw new ComplianceError(t('Enter the document’s title.'));
  }
  const purposeId = input.purposeId || null;
  if (
    purposeId &&
    purposeId !== existing?.purposeId &&
    !(company.documentPurposes ?? []).some((p) => p.id === purposeId)
  ) {
    throw new ComplianceError(t('Choose a purpose from the list.'));
  }
  if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate) {
    throw new ComplianceError(t('The expiry date is before the issue date.'));
  }
  const confidential = existing?.confidential === true || input.confidential === true;
  const doc: ComplianceDocument = {
    ...input,
    title: input.title.trim(),
    number: input.number.trim(),
    issuer: input.issuer.trim(),
    // Only a driving licence has a class.
    ...(input.licenceClass !== undefined
      ? { licenceClass: input.type === 'driving_licence' ? input.licenceClass.trim() : '' }
      : {}),
    ownerName,
    employeeId: input.ownerType === 'employee' ? input.employeeId : null,
    // The links are written only once there is something to say.
    ...(input.clientId !== undefined || clientId ? { clientId } : {}),
    ...(input.vehicleId !== undefined || vehicleId ? { vehicleId } : {}),
    ...(input.purposeId !== undefined ? { purposeId } : {}),
    ...(confidential
      ? { confidential: true }
      : input.confidential !== undefined
        ? { confidential: false }
        : {}),
    renewalCost: round(Math.max(0, input.renewalCost), currencyPrecision(company.currency)),
    reminderDays: input.reminderDays?.length ? normalizeReminderDays(input.reminderDays) : null,
    updatedAt: nowStamp(),
  };
  if (!existing) doc.createdAt = doc.updatedAt;
  return { company, doc };
}

/** Tables saveComplianceDocument writes or reads: a transaction around it includes them. */
export const DOCUMENT_TABLES = () => [
  db.complianceDocuments,
  db.companies,
  db.employees,
  db.clients,
  db.vehicles,
  db.activities,
  db.syncState,
  // Made confidential: the fees of its renewals lose its details.
  db.renewals,
  db.expenses,
];

/**
 * The company's link to the cloud, if any, once a confidential document may
 * be kept there: its server must have the records of version 16, whose rules
 * keep them from staff and viewers.
 */
async function cloudKeepingConfidential(companyId: ID) {
  const link = await db.syncState.get(companyId);
  if (link && !linkHasFeature(link, 'tables_v16')) {
    throw new ComplianceError(
      t(
        'The cloud needs the latest database script first. Ask the owner of the company to run it.',
      ),
    );
  }
  return link;
}

/**
 * Saves a register document; with `log: false` no activity entry is written
 * (imports). A document already in the cloud is made confidential with
 * makeDocumentConfidential, never by saving it with the mark.
 */
export async function saveComplianceDocument(
  input: ComplianceDocument,
  options: { log?: boolean } = {},
): Promise<ComplianceDocument> {
  return db.transaction('rw', DOCUMENT_TABLES(), async () => {
    const existing = await db.complianceDocuments.get(input.id);
    const { company, doc } = await preparedDocument(input, existing);
    // A customer's cost sheet (guards' pay) is kept confidential: never added
    // where the mark can't be kept yet.
    if (doc.type === 'customer_cost' && existing?.type !== 'customer_cost') {
      await cloudKeepingConfidential(company.id);
    }
    if (doc.confidential && existing?.confidential !== true) {
      const link = await cloudKeepingConfidential(company.id);
      if (link && existing) {
        throw new ComplianceError(
          t('This document is in the cloud already: make it confidential from its form.'),
        );
      }
      // Fees already recorded for it lose its name, number and note, as a
      // confidential document's are recorded: expenses aren't private.
      if (existing) {
        const renewals = await db.renewals
          .where('documentKey')
          .equals(recordKey(existing.id))
          .filter((r) => r.companyId === existing.companyId)
          .toArray();
        await scrubFees(renewals, [
          existing.number,
          doc.number,
          ...renewals.map((r) => r.number ?? ''),
        ]);
      }
    }
    await db.complianceDocuments.put(doc);
    if (options.log === false) return doc;
    await logActivity(
      company.id,
      'compliance',
      doc.id,
      existing ? 'updated' : 'created',
      {
        text: existing ? msg('Document {title} updated') : msg('Document {title} added'),
        vars: { title: doc.title || documentTypeInfo(doc.type).label },
      },
      { employeeId: doc.employeeId, confidential: doc.confidential },
    );
    return doc;
  });
}

/**
 * Files a scan as the employee's driving licence: on their licence in the
 * register (one still without dates, else the one that expires last), or on
 * a new one without dates when they have none, whose expiry is then filled
 * in by hand; until then the driver stays flagged. Nothing is logged:
 * "Add documents" logs the files it filed at once.
 */
export async function fileDrivingLicence(
  employeeId: ID,
  file: { name: string; type: string; dataUrl: string },
): Promise<ComplianceDocument> {
  return db.transaction('rw', [...DOCUMENT_TABLES(), db.attachments], async () => {
    const employee = await db.employees.get(employeeId);
    if (!employee) throw new ComplianceError(t('Choose the employee the document belongs to.'));
    const held = await db.complianceDocuments.where('employeeId').equals(employeeId).toArray();
    const licence =
      drivingLicenceToFileOn(held, employeeId) ??
      (await saveComplianceDocument(
        createComplianceDocument(employee.companyId, {
          type: 'driving_licence',
          ownerType: 'employee',
          employeeId,
        }),
        { log: false },
      ));
    await addAttachment(employee.companyId, licence.id, file);
    return licence;
  });
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
        vars: { title: doc.title || documentTypeInfo(doc.type).label },
      },
      { employeeId: doc.employeeId, confidential: doc.confidential },
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
      if (doc.confidential === true) {
        // Once it is gone nothing else tells that its activity is private:
        // what was logged before it was marked, or by an earlier version,
        // gets the mark too.
        const unmarked = await db.activities
          .where('entityId')
          .equals(id)
          .filter((a) => a.entity === 'compliance' && a.confidential !== true)
          .toArray();
        await db.activities.bulkPut(unmarked.map((a) => ({ ...a, confidential: true })));
      }
      await logActivity(
        doc.companyId,
        'compliance',
        id,
        'deleted',
        {
          text: msg('Document {title} deleted'),
          vars: { title: doc.title || documentTypeInfo(doc.type).label },
        },
        { employeeId: doc.employeeId, confidential: doc.confidential },
      );
    },
  );
}

/** Some of a document's files are kept in the cloud and not on this device. */
export class FilesNotHereError extends ComplianceError {}

/**
 * Marks a document confidential, with the changes in `input` (the document
 * as edited). Only owners, admins and accountants then see it, its files,
 * renewals and activity. A document that may already be on staff's and
 * viewers' devices (the company is in the cloud) is saved again under a new
 * id, with its renewals, files and activity, and the old ones are deleted in
 * the same transaction: their deletion reaches those devices like any other
 * (a record that turned private would stay there, since the cloud only
 * filters what it sends). Fees already recorded for it lose its name, number
 * and note, as a confidential document's fees are recorded. Every file must
 * be on this device (FilesNotHereError otherwise). `removedFiles` are its
 * files taken off its form: they are not copied, and are deleted with the
 * rest once every check has passed (in a company kept on this device the
 * form removes them after). Returns the document as saved.
 */
export async function makeDocumentConfidential(
  input: ComplianceDocument,
  options: { removedFiles?: readonly ID[] } = {},
): Promise<ComplianceDocument> {
  return db.transaction('rw', [...DOCUMENT_TABLES(), db.attachments], async () => {
    const existing = await db.complianceDocuments.get(input.id);
    const link = await cloudKeepingConfidential(input.companyId);
    // Not in the cloud, or never saved: nothing of it is anywhere else.
    if (!existing || existing.confidential === true || !link) {
      return saveComplianceDocument({ ...input, confidential: true });
    }
    const oldKey = recordKey(existing.id);
    const renewals = await db.renewals
      .where('documentKey')
      .equals(oldKey)
      .filter((r) => r.companyId === existing.companyId)
      .toArray();
    const ids = new Map<ID, ID>([
      [existing.id, newId()],
      ...renewals.map((r) => [r.id, newId()] as [ID, ID]),
    ]);
    const removed = new Set(options.removedFiles ?? []);
    const stored = await db.attachments
      .where('ownerId')
      .anyOf([...ids.keys()])
      .toArray();
    const files = stored.filter((f) => !(f.ownerId === existing.id && removed.has(f.id)));
    if (files.some((f) => !f.dataUrl)) {
      throw new FilesNotHereError(
        t('Some of its files are not on this device yet. Open them once, then try again.'),
      );
    }
    const activities = await db.activities
      .where('entityId')
      .anyOf([...ids.keys()])
      .filter((a) => a.entity === 'compliance' && a.companyId === existing.companyId)
      .toArray();

    const id = ids.get(existing.id)!;
    const { company, doc } = await preparedDocument(
      { ...input, id, confidential: true, createdAt: existing.createdAt },
      existing,
    );
    doc.createdAt = existing.createdAt;
    await db.complianceDocuments.put(doc);
    await db.renewals.bulkPut(
      renewals.map((r) => ({
        ...r,
        id: ids.get(r.id)!,
        documentKey: recordKey(id),
        documentId: id,
      })),
    );
    await db.attachments.bulkPut(
      files.map((f) => {
        const copy: Attachment = { ...f, id: newId(), ownerId: ids.get(f.ownerId)! };
        // The new copy is uploaded under its own id.
        delete copy.storagePath;
        delete copy.contentHash;
        delete copy.contentMissing;
        if (f.docKey === oldKey) copy.docKey = recordKey(id);
        return copy;
      }),
    );
    await db.activities.bulkPut(
      activities.map((a): Activity => ({
        ...a,
        id: newId(),
        entityId: ids.get(a.entityId)!,
        confidential: true,
      })),
    );
    await scrubFees(renewals, [existing.number, ...renewals.map((r) => r.number ?? '')]);

    await db.activities.bulkDelete(activities.map((a) => a.id));
    await db.attachments.bulkDelete(stored.map((f) => f.id));
    await db.renewals.bulkDelete(renewals.map((r) => r.id));
    await db.complianceDocuments.delete(existing.id);
    await logActivity(
      company.id,
      'compliance',
      id,
      'updated',
      {
        text: msg('Document {title} made confidential'),
        vars: { title: doc.title || documentTypeInfo(doc.type).label },
      },
      { employeeId: doc.employeeId, confidential: true },
    );
    return doc;
  });
}

/** The fees of these renewals as a confidential document's are recorded: without its name, number or note. */
async function scrubFees(renewals: DocumentRenewal[], numbers: string[]): Promise<void> {
  const known = new Set(numbers.map((n) => n.trim()).filter(Boolean));
  for (const renewal of renewals) {
    const expense = renewal.expenseId ? await db.expenses.get(renewal.expenseId) : undefined;
    if (!expense) continue;
    const description = t('Document renewal fee');
    const reference = known.has(expense.reference.trim()) ? '' : expense.reference;
    if (
      expense.description === description &&
      expense.reference === reference &&
      expense.notes === ''
    ) {
      continue;
    }
    await db.expenses.put({ ...expense, description, reference, notes: '', updatedAt: nowStamp() });
  }
}

/* -------------------------------------------------------------------------- */
/* The register's extras                                                      */
/* -------------------------------------------------------------------------- */

const tidyName = (text: string | undefined) => (text ?? '').trim().replace(/\s+/g, ' ');

/** Switches contracts, customers' papers, vehicles and confidential documents on or off. */
export async function setRegisterExtras(companyId: ID, on: boolean): Promise<void> {
  await db.transaction('rw', [db.companies, db.activities], async () => {
    const company = await db.companies.get(companyId);
    if (!company || (company.registerExtras === true) === on) return;
    await db.companies.put({ ...company, registerExtras: on, updatedAt: nowStamp() });
    await logActivity(companyId, 'company', companyId, 'updated', {
      text: on
        ? msg('Contracts, customers and vehicles switched on in the register')
        : msg('Contracts, customers and vehicles switched off in the register'),
    });
  });
}

/** The purpose of the list with either of these names (in either language), if any. */
export function findPurpose(
  list: readonly DocumentPurpose[],
  names: { name: string; nameAr?: string },
  exceptId?: ID,
): DocumentPurpose | undefined {
  const keys = [names.name, names.nameAr ?? ''].map(normalizeSearch).filter(Boolean);
  return list.find(
    (p) =>
      p.id !== exceptId && [p.name, p.nameAr].some((n) => keys.includes(normalizeSearch(n ?? ''))),
  );
}

/**
 * Saves the company's list of purposes as edited in Compliance → Settings:
 * names tidied, an English name (else the Arabic one) for each, and no name
 * twice. Purposes are archived, never removed, so documents keep theirs.
 */
export async function saveDocumentPurposes(
  companyId: ID,
  input: readonly DocumentPurpose[],
): Promise<DocumentPurpose[]> {
  return db.transaction('rw', [db.companies, db.activities], async () => {
    const company = await db.companies.get(companyId);
    if (!company) throw new ComplianceError(t('Company not found'));
    const before = company.documentPurposes ?? [];
    const list: DocumentPurpose[] = [];
    for (const item of input) {
      const nameAr = tidyName(item.nameAr);
      const name = tidyName(item.name) || nameAr;
      if (!name) {
        // A row left empty: a new one is dropped, one in use keeps its name.
        const kept = before.find((p) => p.id === item.id);
        if (kept) list.push(item.archived ? { ...kept, archived: true } : kept);
        continue;
      }
      const taken = findPurpose(list, { name, nameAr }, item.id);
      if (taken) {
        throw new ComplianceError(
          t('There is already a purpose called {name}.', { name: taken.name }),
        );
      }
      list.push({ id: item.id, name, nameAr, ...(item.archived ? { archived: true } : {}) });
    }
    // One this list didn't have (added meanwhile on another screen) stays.
    for (const p of before) if (!list.some((q) => q.id === p.id)) list.push(p);
    if (JSON.stringify(list) === JSON.stringify(before)) return before;
    await db.companies.put({ ...company, documentPurposes: list, updatedAt: nowStamp() });
    await logActivity(companyId, 'company', companyId, 'updated', {
      text: msg('Document purposes updated'),
    });
    return list;
  });
}

/**
 * Adds a purpose to the company's list (the list starts with it). A purpose
 * named like one in the list, in either language, is that one (restored
 * when it was archived).
 */
export async function addDocumentPurpose(
  companyId: ID,
  input: { name: string; nameAr?: string },
): Promise<DocumentPurpose> {
  return db.transaction('rw', [db.companies, db.activities], async () => {
    const company = await db.companies.get(companyId);
    if (!company) throw new ComplianceError(t('Company not found'));
    const nameAr = tidyName(input.nameAr);
    const name = tidyName(input.name) || nameAr;
    if (!name) throw new ComplianceError(t('Enter the purpose’s name.'));
    const list = company.documentPurposes ?? [];
    const same = findPurpose(list, { name, nameAr });
    if (same) {
      if (!same.archived) return same;
      return setDocumentPurposeArchived(companyId, same.id, false);
    }
    const purpose: DocumentPurpose = { id: newId(), name, nameAr };
    await db.companies.put({
      ...company,
      documentPurposes: [...list, purpose],
      updatedAt: nowStamp(),
    });
    await logActivity(companyId, 'company', companyId, 'updated', {
      text: msg('Document purpose {name} added'),
      vars: { name },
      arabic: { name: nameAr },
    });
    return purpose;
  });
}

/** Stops (or starts again) offering a purpose; documents keep it. */
export async function setDocumentPurposeArchived(
  companyId: ID,
  id: ID,
  archived: boolean,
): Promise<DocumentPurpose> {
  return db.transaction('rw', [db.companies], async () => {
    const company = await db.companies.get(companyId);
    const list = company?.documentPurposes ?? [];
    const found = list.find((p) => p.id === id);
    if (!company || !found) throw new ComplianceError(t('Purpose not found'));
    const next: DocumentPurpose = { ...found, archived: true };
    if (!archived) delete next.archived;
    await db.companies.put({
      ...company,
      documentPurposes: list.map((p) => (p.id === id ? next : p)),
      updatedAt: nowStamp(),
    });
    return next;
  });
}

/* -------------------------------------------------------------------------- */
/* The register                                                               */
/* -------------------------------------------------------------------------- */

export interface Register {
  entries: RegisterEntry[];
  employees: Employee[];
  documents: ComplianceDocument[];
  reminderDays: number[];
  /** The company checks drivers' licences (PeopleSettings.drivingLicences). */
  drivingLicences: boolean;
  /** What current employees need and don't hold valid; empty while nothing is checked. */
  missing: MissingDocument[];
  /** The company's vehicles, archived ones too. */
  vehicles: Vehicle[];
  /** How many files each register record has, by its id (none: not listed). */
  files: Map<ID, number>;
}

/** Every tracked document of a company: register records and employees' papers. */
export async function loadRegister(companyId: ID): Promise<Register> {
  const [employees, documents, settings, vehicles] = await Promise.all([
    db.employees.where('companyId').equals(companyId).toArray(),
    db.complianceDocuments.where('companyId').equals(companyId).toArray(),
    getPeopleSettings(companyId),
    db.vehicles.where('companyId').equals(companyId).toArray(),
  ]);
  // The owners of the files only, from the index: their content is never read.
  const owners = documents.length
    ? ((await db.attachments
        .where('ownerId')
        .anyOf(documents.map((d) => d.id))
        .keys()) as string[])
    : [];
  const files = new Map<ID, number>();
  for (const owner of owners) files.set(owner, (files.get(owner) ?? 0) + 1);
  const reminderDays = normalizeReminderDays(settings.reminderDays);
  const drivingLicences = checksDrivingLicences(settings);
  return {
    entries: registerEntries({ employees, documents, reminderDays }),
    employees,
    documents,
    reminderDays,
    drivingLicences,
    // The driver of a company vehicle needs a licence too.
    missing: drivingLicences
      ? missingDocuments({ employees, documents, on: today(), vehicles })
      : [],
    vehicles,
    files,
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
  const spec = feeAccountSpec(documentTypeInfo(type).fee);
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
  const spec = feeAccountSpec(documentTypeInfo(type).fee);
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
        previousExpiry = employee[EMPLOYEE_EXPIRY_FIELDS[type]] ?? null;
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
      const label = documentTypeInfo(type).label;
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
        // Staff and viewers see expenses: an employee's document, or a
        // confidential one, leaves no name, number or note there. They stay
        // on the (private) renewal.
        const unnamed = Boolean(employee) || record?.confidential === true;
        expense = await saveExpense(
          createExpense(company.id, {
            date: input.renewedOn,
            accountId: account.id,
            amount: feeAmount,
            currency: company.currency,
            paidFromAccountId: input.fee.paidFromAccountId,
            description: unnamed
              ? t('Document renewal fee')
              : owner
                ? t('{document} renewal – {owner}', { document: title, owner })
                : t('{document} renewal', { document: title }),
            reference: unnamed
              ? (input.fee.reference?.trim() ?? '')
              : input.fee.reference?.trim() || number || currentNumber,
            notes: unnamed ? '' : (input.note?.trim() ?? ''),
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
        { employeeId: employee?.id ?? null, confidential: record?.confidential },
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
