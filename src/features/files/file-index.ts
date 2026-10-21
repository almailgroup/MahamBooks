import { db } from '@/db/db';
import type {
  Client,
  ClearanceCertificate,
  Company,
  ComplianceDocument,
  DocumentRenewal,
  ID,
  ISODate,
} from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES } from '@/app/company';
import { isPrivateRecord, renewedDocumentId, type RecordLookup } from '@/cloud/roles';
import { documentTypeInfo } from '@/lib/compliance';
import { isKnown } from '@/lib/known';
import { entryOwner, entryTitle } from '@/features/renewals/text';
import { localName } from '@/i18n/names';
import { msg, t } from '@/i18n';

/**
 * The document finder's list of files: every file kept with a record of the
 * company (a scanned bill, a receipt, a paper of the register, a personnel
 * file…), with what it is kept with and the page that shows it. Built from
 * the attachments' indexes only: a file's content, which can be megabytes,
 * is never read. The records the files are kept with are read by id.
 */

/** What a file is kept with. */
export type FileOwnerKind =
  | 'document'
  | 'expense'
  | 'payment'
  | 'asset'
  | 'paper'
  | 'employee'
  | 'letter'
  | 'certificate'
  | 'other';

/** Each kind's name (English keys: `t()` them), in the order the Files page offers them. */
export const FILE_OWNER_LABELS: Record<FileOwnerKind, string> = {
  document: msg('Sales and purchases'),
  expense: msg('Expenses'),
  payment: msg('Payments'),
  asset: msg('Fixed assets'),
  paper: msg('Papers'),
  employee: msg('Employees'),
  letter: msg('Letters'),
  certificate: msg('Clearance certificates'),
  other: msg('Other'),
};

/** What a file holds, told by its name. */
export type FileFormat = 'pdf' | 'image' | 'other';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
  'avif',
]);

export function fileFormat(name: string): FileFormat {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'pdf';
  return IMAGE_EXTENSIONS.has(extension) ? 'image' : 'other';
}

export interface FileEntry {
  /** The attachment's id: `openStoredAttachment` opens it. */
  id: ID;
  name: string;
  format: FileFormat;
  kind: FileOwnerKind;
  ownerId: ID;
  /** What it is kept with, in the interface language: "Bill BILL-0004", an employee's name. */
  owner: string;
  /** More about that: the vendor, "Personnel file", whom a paper belongs to. */
  detail: string;
  /** The page of what it is kept with; null when there is none on this device. */
  to: string | null;
  /** The date of what it is kept with (newest first). */
  date: ISODate | null;
  /** Its content is in the cloud and not on this device yet. */
  inCloud: boolean;
  /** Payroll and people data, or a confidential paper's (`isPrivateRecord`). */
  private: boolean;
  /** Other words it is found by, in both languages. */
  terms: string[];
  /** Numbers it is found by, with or without their separators. */
  numbers: string[];
}

/** The company's files as the indexes have them: id, what it is kept with, name. */
async function fileKeys(companyId: ID): Promise<{ id: ID; ownerId: ID; name: string }[]> {
  const ids = new Set(await db.attachments.where('companyId').equals(companyId).primaryKeys());
  if (!ids.size) return [];
  const found: { id: ID; ownerId: ID; name: string }[] = [];
  // A key cursor: the files' records, with their content, are never loaded.
  await db.attachments.orderBy('[ownerId+name]').eachKey((key, cursor) => {
    const id = cursor.primaryKey;
    if (!ids.has(id) || !Array.isArray(key)) return;
    const [ownerId, name] = key;
    if (typeof ownerId === 'string' && typeof name === 'string') found.push({ id, ownerId, name });
  });
  return found;
}

/** Rows read by id, of this company only. */
async function byId<T extends { id: ID; companyId: ID }>(
  table: { bulkGet: (keys: ID[]) => Promise<(T | undefined)[]> },
  ids: ID[],
  companyId: ID,
): Promise<Map<ID, T>> {
  if (!ids.length) return new Map();
  const rows = await table.bulkGet(ids);
  return new Map(
    rows
      .filter((row): row is T => row !== undefined && row.companyId === companyId)
      .map((row) => [row.id, row]),
  );
}

type Described = Pick<FileEntry, 'kind' | 'owner' | 'detail' | 'to' | 'date' | 'terms' | 'numbers'>;

const words = (...list: (string | null | undefined)[]) =>
  list.filter((s): s is string => Boolean(s?.trim()));

/**
 * Every file of the company, newest record first. Without `people` (staff
 * and viewers), files of payroll and people data and of confidential papers
 * are left out, and so are files whose record isn't on this device, since
 * they can't be told apart.
 */
export async function loadFileIndex(
  company: Company,
  { people = true }: { people?: boolean } = {},
): Promise<FileEntry[]> {
  const keys = await fileKeys(company.id);
  if (!keys.length) return [];
  const inCloud = new Set(
    await db.attachments.where('[companyId+contentMissing]').equals([company.id, 1]).primaryKeys(),
  );
  const ownerIds = [...new Set(keys.map((k) => k.ownerId))];
  const [documents, expenses, payments, assets, papers, renewals, owners, letters, templates] =
    await Promise.all([
      byId(db.documents, ownerIds, company.id),
      byId(db.expenses, ownerIds, company.id),
      byId(db.payments, ownerIds, company.id),
      byId(db.assets, ownerIds, company.id),
      byId(db.complianceDocuments, ownerIds, company.id),
      byId(db.renewals, ownerIds, company.id),
      byId(db.employees, ownerIds, company.id),
      byId(db.employeeLetters, ownerIds, company.id),
      byId(db.letterTemplates, ownerIds, company.id),
    ]);
  // The papers renewals are of, and the employees papers and letters belong to.
  const renewedId = (renewal: DocumentRenewal) => renewedDocumentId({ ...renewal });
  const renewed = await byId(
    db.complianceDocuments,
    [...renewals.values()].flatMap((r) => {
      const id = renewedId(r);
      return id && !papers.has(id) ? [id] : [];
    }),
    company.id,
  );
  const allPapers = new Map([...papers, ...renewed]);
  const related = await byId(
    db.employees,
    [
      ...[...allPapers.values()].map((d) => d.employeeId),
      ...[...renewals.values()].map((r) => r.employeeId),
      ...[...letters.values()].map((l) => l.employeeId),
    ].filter((id): id is ID => Boolean(id) && !owners.has(id!)),
    company.id,
  );
  const employees = new Map([...owners, ...related]);
  const clients = await db.clients.where('companyId').equals(company.id).toArray();
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const certificates = new Map<ID, { client: Client; certificate: ClearanceCertificate }>();
  for (const client of clients) {
    for (const certificate of client.clearanceCertificates ?? []) {
      certificates.set(certificate.id, { client, certificate });
    }
  }

  const tables: Record<string, Map<ID, unknown>> = {
    employees,
    letterTemplates: templates,
    employeeLetters: letters,
    complianceDocuments: allPapers,
    renewals,
  };
  const lookup: RecordLookup = (table, id) =>
    (tables[table]?.get(id) as Record<string, unknown> | undefined) ?? null;

  const paper = (doc: ComplianceDocument): Described => {
    const type = documentTypeInfo(doc.type).label;
    const employee = doc.employeeId ? employees.get(doc.employeeId) : undefined;
    const client = doc.clientId ? clientsById.get(doc.clientId) : undefined;
    return {
      kind: 'paper',
      owner: entryTitle(doc),
      detail: entryOwner(doc, employees, company, { clients: clientsById }),
      // An employee's paper is kept on their page, as People keeps it.
      to: doc.employeeId ? `/employees/${doc.employeeId}` : `/compliance/documents?doc=${doc.id}`,
      date: doc.expiryDate ?? doc.issueDate,
      terms: words(
        doc.title,
        t(type),
        type,
        doc.ownerName,
        doc.issuer,
        employee?.name,
        employee?.nameAr,
        client?.name,
        client?.nameAr,
      ),
      numbers: words(doc.number),
    };
  };

  const describe = (ownerId: ID): Described => {
    const document = documents.get(ownerId);
    if (document) {
      const label = isKnown(DOCUMENT_LABELS, document.type)
        ? DOCUMENT_LABELS[document.type].singular
        : msg('Document');
      const client = clientsById.get(document.clientId);
      return {
        kind: 'document',
        owner: `${t(label)} ${document.number}`.trim(),
        detail: localName(client),
        to: isKnown(DOCUMENT_ROUTES, document.type)
          ? `${DOCUMENT_ROUTES[document.type]}/${document.id}`
          : null,
        date: document.issueDate,
        terms: words(t(label), label, client?.name, client?.nameAr),
        numbers: words(document.number, document.poNumber, document.vendorReference),
      };
    }
    const expense = expenses.get(ownerId);
    if (expense) {
      const vendor = expense.vendorId ? clientsById.get(expense.vendorId) : undefined;
      return {
        kind: 'expense',
        owner: `${t('Expense')} ${expense.number}`.trim(),
        detail: expense.description || localName(vendor),
        to: `/expenses?open=${expense.id}`,
        date: expense.date,
        terms: words(expense.description, vendor?.name, vendor?.nameAr),
        numbers: words(expense.number, expense.reference),
      };
    }
    const payment = payments.get(ownerId);
    if (payment) {
      const out = payment.direction === 'out';
      const client = clientsById.get(payment.clientId);
      return {
        kind: 'payment',
        owner: `${out ? t('Payment made') : t('Payment received')} ${payment.number}`.trim(),
        detail: localName(client),
        to: `${out ? '/payments-made' : '/payments'}/${payment.id}`,
        date: payment.date,
        terms: words(client?.name, client?.nameAr),
        numbers: words(payment.number, payment.reference, payment.cheque?.number),
      };
    }
    const asset = assets.get(ownerId);
    if (asset) {
      return {
        kind: 'asset',
        owner: localName(asset) || asset.number,
        detail: [t('Fixed asset'), asset.number].filter(Boolean).join(' · '),
        to: `/assets/${asset.id}`,
        date: asset.purchaseDate,
        terms: words(asset.name, asset.nameAr, asset.location, asset.custodian),
        numbers: words(asset.number, asset.serialNumber),
      };
    }
    const doc = papers.get(ownerId);
    if (doc) return paper(doc);
    const renewal = renewals.get(ownerId);
    if (renewal) {
      const of = allPapers.get(renewedId(renewal) ?? '');
      if (of) {
        const described = paper(of);
        return { ...described, detail: [t('Renewal'), described.detail].join(' · ') };
      }
      const employee = renewal.employeeId ? employees.get(renewal.employeeId) : undefined;
      return {
        kind: 'paper',
        owner: t(documentTypeInfo(renewal.type).label),
        detail: [t('Renewal'), localName(employee)].filter(Boolean).join(' · '),
        to: renewal.employeeId ? `/employees/${renewal.employeeId}` : null,
        date: renewal.renewedOn,
        terms: words(employee?.name, employee?.nameAr),
        numbers: words(renewal.number),
      };
    }
    const employee = owners.get(ownerId);
    if (employee) {
      return {
        kind: 'employee',
        owner: localName(employee),
        detail: t('Personnel file'),
        to: `/employees/${employee.id}`,
        date: null,
        terms: words(employee.name, employee.nameAr, employee.jobTitle, employee.jobTitleAr),
        numbers: words(employee.number),
      };
    }
    const letter = letters.get(ownerId);
    if (letter) {
      const person = employees.get(letter.employeeId);
      return {
        kind: 'letter',
        owner: localName(person) || t('Letter'),
        detail: [t('Letter'), letter.number].filter(Boolean).join(' · '),
        to: `/employees/${letter.employeeId}`,
        date: letter.issuedOn,
        terms: words(person?.name, person?.nameAr, letter.subject),
        numbers: words(letter.number),
      };
    }
    const template = templates.get(ownerId);
    if (template) {
      return {
        kind: 'letter',
        owner: localName(template) || t('Letter template'),
        detail: t('Letter template'),
        to: null,
        date: null,
        terms: words(template.name, template.nameAr),
        numbers: [],
      };
    }
    const held = certificates.get(ownerId);
    if (held) {
      return {
        kind: 'certificate',
        owner: `${t('Clearance certificate')} ${held.certificate.number}`.trim(),
        detail: localName(held.client),
        to: `/clients/${held.client.id}`,
        date: held.certificate.issueDate,
        terms: words(held.client.name, held.client.nameAr),
        numbers: words(held.certificate.number),
      };
    }
    return {
      kind: 'other',
      owner: t('Other'),
      detail: '',
      to: null,
      date: null,
      terms: [],
      numbers: [],
    };
  };

  const described = new Map(ownerIds.map((id) => [id, describe(id)]));
  const entries: FileEntry[] = [];
  for (const key of keys) {
    // An employee's photo is shown as their photo, not as a file.
    if (owners.get(key.ownerId)?.photoId === key.id) continue;
    const owner = described.get(key.ownerId)!;
    const isPrivate = isPrivateRecord('attachments', { ownerId: key.ownerId }, lookup);
    if (!people && (isPrivate || owner.kind === 'other')) continue;
    entries.push({
      id: key.id,
      name: key.name,
      format: fileFormat(key.name),
      ownerId: key.ownerId,
      ...owner,
      inCloud: inCloud.has(key.id),
      private: isPrivate,
    });
  }
  return entries.sort(
    (a, b) =>
      (b.date ?? '').localeCompare(a.date ?? '') ||
      a.owner.localeCompare(b.owner) ||
      a.name.localeCompare(b.name),
  );
}
