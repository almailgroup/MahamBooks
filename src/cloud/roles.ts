import { msg } from '@/i18n';
import type { AppAccess, AppId } from '@/suite/types';

/**
 * What each role may do, as the database enforces it (see
 * supabase/migrations). The app uses the same rules to hide what a person
 * can't open and to refuse a change before the server would.
 */

export type MemberRole = 'owner' | 'admin' | 'accountant' | 'staff' | 'viewer';

export const MEMBER_ROLES: MemberRole[] = ['owner', 'admin', 'accountant', 'staff', 'viewer'];

/** Roles someone can be invited as. */
export const INVITE_ROLES: Exclude<MemberRole, 'owner'>[] = [
  'admin',
  'accountant',
  'staff',
  'viewer',
];

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: msg('Owner'),
  admin: msg('Admin'),
  accountant: msg('Accountant'),
  staff: msg('Staff'),
  viewer: msg('Viewer'),
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: msg('Everything, including the team and deleting the company.'),
  admin: msg('Everything except deleting the company. Manages the team.'),
  accountant: msg('All books and payroll. No team management.'),
  staff: msg('Sales, purchases, cheques and stock. No payroll or accounting setup.'),
  viewer: msg('Can look at everything except payroll, and change nothing.'),
};

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as string[]).includes(value);
}

/** Payroll and people data: only owners, admins and accountants see them. */
export const PEOPLE_TABLES = [
  'employees',
  'payRuns',
  'payrollSettings',
  'peopleSettings',
  'leaveRecords',
  'staffLoans',
  'finalSettlements',
  'letterTemplates',
  'employeeLetters',
] as const;

/** Tables staff may change (the company record only in its document numbers). */
export const STAFF_TABLES = [
  'companies',
  'clients',
  'products',
  'documents',
  'payments',
  'recurring',
  'securityCheques',
  'expenses',
  'warehouses',
  'stockMovements',
  'stockEntries',
  'landedCosts',
  'attachments',
  'activities',
  // To ask for approval; see guardApprovalWrite.
  'approvals',
] as const;

/** Journals staff may make: the ones their own work creates. */
export const STAFF_JOURNAL_KINDS = [
  'transfer',
  'cheque_clearing',
  'cheque_return',
  'retention_release',
] as const;

const people = new Set<string>(PEOPLE_TABLES);
const staffTables = new Set<string>(STAFF_TABLES);
const staffJournals = new Set<string>(STAFF_JOURNAL_KINDS);

type Row = Record<string, unknown> | null | undefined;

/** Looks up another record of the same company (an attachment's owner). */
export type RecordLookup = (table: string, id: string) => Row;

/** The register document a renewal is of, or null for one of an employee's own papers. */
export function renewedDocumentId(renewal: Row): string | null {
  if (typeof renewal?.documentId === 'string' && renewal.documentId !== '') {
    return renewal.documentId;
  }
  const key = renewal?.documentKey;
  return typeof key === 'string' && key.startsWith('doc:') && key.length > 4 ? key.slice(4) : null;
}

/**
 * Whether a record is payroll or people data. `lookup` finds the record an
 * attachment, an activity or a renewal is about; without it only the record
 * itself is judged.
 */
export function isPrivateRecord(table: string, record: Row, lookup?: RecordLookup): boolean {
  if (people.has(table)) return true;
  if (!record) return false;
  if (record._private === true) return true;
  const employeeOwned = (row: Row) => typeof row?.employeeId === 'string' && row.employeeId !== '';
  // An employee's paper in the register, or one marked confidential.
  const privateDocument = (row: Row) => employeeOwned(row) || row?.confidential === true;
  // A renewal of either (the document is found with `lookup`).
  const privateRenewal = (row: Row) => {
    const documentId = renewedDocumentId(row);
    return (
      employeeOwned(row) ||
      Boolean(documentId && lookup && privateDocument(lookup('complianceDocuments', documentId)))
    );
  };
  switch (table) {
    case 'complianceDocuments':
      return privateDocument(record);
    case 'renewals':
      return privateRenewal(record);
    case 'journals':
      return record.kind === 'payroll';
    case 'approvals':
      // A request about payroll or people data (a pay run…).
      return typeof record.subjectTbl === 'string' && people.has(record.subjectTbl);
    case 'activities': {
      if (record.entity === 'employee' || record.entity === 'payroll') return true;
      // Logged about an employee's documents, or a confidential one: private
      // even once they are deleted.
      if (employeeOwned(record) || record.confidential === true) return true;
      if (record.entity !== 'compliance' || !lookup || typeof record.entityId !== 'string') {
        return false;
      }
      return (
        privateDocument(lookup('complianceDocuments', record.entityId)) ||
        privateRenewal(lookup('renewals', record.entityId))
      );
    }
    case 'attachments': {
      if (!lookup || typeof record.ownerId !== 'string') return false;
      return (
        Boolean(lookup('employees', record.ownerId)) ||
        Boolean(lookup('letterTemplates', record.ownerId)) ||
        Boolean(lookup('employeeLetters', record.ownerId)) ||
        privateDocument(lookup('complianceDocuments', record.ownerId)) ||
        privateRenewal(lookup('renewals', record.ownerId))
      );
    }
    default:
      return false;
  }
}

/** Sees payroll and people data. */
export function canSeePeople(role: MemberRole | null | undefined): boolean {
  return role == null || role === 'owner' || role === 'admin' || role === 'accountant';
}

/** May change anything at all. */
export function canEdit(role: MemberRole | null | undefined): boolean {
  return role !== 'viewer';
}

/** Invites people and changes roles. */
export function canManageTeam(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * The Super Admin: the owner of the company. Whoever should be Super Admin is
 * made the owner with Transfer ownership; no account is named in the app.
 */
export function isSuperAdmin(role: MemberRole | null | undefined): boolean {
  return role === 'owner';
}

/** Roles only the owner gives once the owner keeps them (Settings → Team). */
export const SENIOR_ROLES: readonly MemberRole[] = ['admin', 'accountant'];

const senior = (role: MemberRole) => SENIOR_ROLES.includes(role);

/** At most this many admins or accountants approve besides the owner. */
export const MAX_APPROVERS = 2;

/**
 * Decides approval requests: the owner, or an admin or accountant the owner
 * allowed to (`canApprove`), as almailbooks.is_approver.
 */
export function isApprover(
  role: MemberRole | null | undefined,
  canApprove: boolean | undefined,
): boolean {
  return role === 'owner' || (Boolean(canApprove) && (role === 'admin' || role === 'accountant'));
}

/**
 * Gets the changes of the team (the bell and its emails): the owner and the
 * approvers, as notification_feed of 20261123000000_change_feed.sql.
 */
export function getsChangeFeed(
  role: MemberRole | null | undefined,
  canApprove: boolean | undefined,
): boolean {
  return isApprover(role, canApprove);
}

/**
 * Whether a change of the feed is shown to someone who gets the feed: never
 * their own, and one about payroll or people data only to owners, admins
 * and accountants (as every approver is), as notification_feed.
 */
export function seesChange(
  change: { actor: string | null; private: boolean },
  viewer: { userId: string; role: MemberRole | null | undefined },
): boolean {
  return change.actor !== viewer.userId && (!change.private || canSeePeople(viewer.role));
}

/**
 * The roles `me` may invite someone as, or give a member. With the owner's
 * rule on (`ownerOnly`), admins give staff and viewer only, as the server
 * does (create_invite, set_member_role).
 */
export function grantableRoles(
  me: MemberRole | null | undefined,
  ownerOnly: boolean,
): Exclude<MemberRole, 'owner'>[] {
  if (me === 'owner') return [...INVITE_ROLES];
  if (me !== 'admin') return [];
  return ownerOnly ? INVITE_ROLES.filter((role) => !senior(role)) : [...INVITE_ROLES];
}

/** Whether `me` may change the role of, or remove, a member who is `role`. */
export function canChangeMember(
  me: MemberRole | null | undefined,
  role: MemberRole,
  ownerOnly: boolean,
): boolean {
  if (role === 'owner') return false;
  if (me === 'owner') return true;
  return me === 'admin' && !(ownerOnly && senior(role));
}

/**
 * What the owner lets a member do, app by app. Limits only ever take away:
 * the member keeps the lower of their role's access and the limit. Missing
 * (every member until the owner sets some) means the role's access.
 */
export interface MemberPermissions {
  apps?: Partial<Record<AppId, AppAccess>>;
}

const ACCESS_ORDER: readonly AppAccess[] = ['none', 'view', 'edit', 'manage'];

/** The apps the owner can limit: every app of Maham One. */
export const LIMIT_APPS: readonly AppId[] = ['books', 'people', 'crm', 'compliance'];

/**
 * Limits as the server sent them, keeping only apps and levels this version
 * knows (a newer server may know more): what isn't understood limits nothing.
 */
export function readPermissions(value: unknown): MemberPermissions {
  const apps = (value as { apps?: unknown } | null)?.apps;
  if (!apps || typeof apps !== 'object' || Array.isArray(apps)) return {};
  const known: Partial<Record<AppId, AppAccess>> = {};
  for (const app of LIMIT_APPS) {
    const limit = (apps as Record<string, unknown>)[app];
    if (typeof limit === 'string' && (ACCESS_ORDER as string[]).includes(limit)) {
      known[app] = limit as AppAccess;
    }
  }
  return Object.keys(known).length ? { apps: known } : {};
}

/** The lower of a role's access and a limit. */
export function lowerAccess(access: AppAccess, limit: AppAccess | undefined): AppAccess {
  if (!limit || !ACCESS_ORDER.includes(limit)) return access;
  return ACCESS_ORDER.indexOf(limit) < ACCESS_ORDER.indexOf(access) ? limit : access;
}

/** The owner's limit on an app for a member; never for the owner. */
export function appLimit(
  role: MemberRole | null | undefined,
  permissions: MemberPermissions | undefined,
  app: AppId,
): AppAccess | undefined {
  if (role == null || role === 'owner') return undefined;
  const limit = permissions?.apps?.[app];
  return limit && ACCESS_ORDER.includes(limit) ? limit : undefined;
}

const PEOPLE_APP = new Set<string>(PEOPLE_TABLES);
const COMPLIANCE_APP = new Set(['complianceDocuments', 'renewals', 'complianceMarks', 'vehicles']);
const BOOKS_APP = new Set([
  'clients',
  'products',
  'taxRates',
  'documents',
  'payments',
  'recurring',
  'accounts',
  'journals',
  'expenses',
  'vatReturns',
  'bankTransactions',
  'securityCheques',
  'assets',
  'depreciationRuns',
  'yearEnds',
  'warehouses',
  'stockMovements',
  'stockEntries',
  'landedCosts',
  'chequeLayouts',
]);

/**
 * The app a record belongs to, for the owner's limits; null for what every
 * app shares (the company record, activity, files, approval requests). The
 * same as almailbooks.record_app on the server. Maham CRM works on Books'
 * customers and quotes, so it has none of its own.
 */
export function recordApp(table: string, record: Row): AppId | null {
  if (PEOPLE_APP.has(table)) return 'people';
  if (table === 'journals' && record?.kind === 'payroll') return 'people';
  const employee = typeof record?.employeeId === 'string' && record.employeeId !== '';
  if ((table === 'complianceDocuments' || table === 'renewals') && employee) return 'people';
  if (COMPLIANCE_APP.has(table)) return 'compliance';
  if (BOOKS_APP.has(table)) return 'books';
  return null;
}

/**
 * Whether the owner's limits keep this member from storing `record` in
 * `table` (an app limited to view only or no access), as the server does in
 * can_write_record. Never the owner, never a company kept on this device.
 */
export function limitBlocksWrite(
  role: MemberRole | null | undefined,
  permissions: MemberPermissions | undefined,
  table: string,
  record: Row,
): boolean {
  const app = recordApp(table, record);
  if (!app) return false;
  const limit = appLimit(role, permissions, app);
  return limit === 'none' || limit === 'view';
}

/** Changes accounting setup: accounts, tax rates, manual journals, year-end. */
export function canEditAccounting(role: MemberRole | null | undefined): boolean {
  return role == null || role === 'owner' || role === 'admin' || role === 'accountant';
}

/**
 * Whether `role` may store `record` in `table` (null role: a company kept on
 * this device only, where everything is allowed). Staff may change the
 * company record only in its document counters; see `staffCompanyChangeOk`.
 */
export function canWriteRecord(
  role: MemberRole | null | undefined,
  table: string,
  record: Row,
  lookup?: RecordLookup,
): boolean {
  if (role == null || role === 'owner' || role === 'admin' || role === 'accountant') return true;
  if (role !== 'staff') return false;
  if (isPrivateRecord(table, record, lookup)) return false;
  if (table === 'journals') return staffJournals.has(String(record?.kind ?? ''));
  return staffTables.has(table);
}

/** Staff saving the company record: only document counters (next, period) may differ. */
export function staffCompanyChangeOk(before: Row, after: Row): boolean {
  if (!before || !after) return false;
  const strip = (row: Record<string, unknown>) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.numbering;
    delete copy.updatedAt;
    return copy;
  };
  if (!sameData(strip(before), strip(after))) return false;
  const old = (before.numbering ?? {}) as Record<string, Record<string, unknown>>;
  const next = (after.numbering ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, rule] of Object.entries(old)) {
    const changed = next[key];
    if (!changed) continue;
    const shape = (r: Record<string, unknown>) => {
      const copy = { ...r };
      delete copy.next;
      delete copy.period;
      return copy;
    };
    if (!sameData(shape(rule), shape(changed))) return false;
  }
  return true;
}

/**
 * Deep equality of JSON data, ignoring key order and properties that are
 * undefined (they are not stored).
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    // JSON has no undefined: a missing value and null are the same.
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, i) => sameData(value, other[i]));
  }
  const left = Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== undefined);
  const right = Object.entries(b as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (left.length !== right.length) return false;
  const lookup = new Map(right);
  return left.every(([key, value]) => lookup.has(key) && sameData(value, lookup.get(key)));
}

/* -------------------------------------------------------------------------- */
/* Approvals (20261116000000_super_admin_approvals.sql)                       */
/* -------------------------------------------------------------------------- */

/**
 * The fields of a document that say what it is, as it is printed and sent:
 * the same as almailbooks.invoice_content. What payments and the books write
 * (totals, status, paid and sent times, retention releases, the posting
 * snapshot), the payment link and the internal notes are not among them.
 */
export const INVOICE_CONTENT_FIELDS = [
  'type',
  'number',
  'clientId',
  'issueDate',
  'dueDate',
  'poNumber',
  'vendorReference',
  'currency',
  'exchangeRate',
  'items',
  'discount',
  'discountType',
  'taxes',
  'charges',
  'pricesIncludeTax',
  'deposit',
  'depositDueDate',
  'notes',
  'terms',
  'footer',
  'intro',
  'templateId',
  'accentColor',
  'deliveryDate',
  'deliveryPlace',
  'retentionPercent',
  'retentionKind',
  'replacesNumber',
] as const;

/** A record of any shape (the app's own types included). */
type AnyRecord = object | null | undefined;
const asRow = (record: AnyRecord) => record as Row;

/** JSON without its nulls, at every level, as jsonb_strip_nulls. */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[key] = stripNulls(v);
  }
  return out;
}

/** What a document says (see INVOICE_CONTENT_FIELDS), as almailbooks.invoice_content. */
export function invoiceContent(doc: AnyRecord): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of INVOICE_CONTENT_FIELDS) picked[field] = asRow(doc)?.[field];
  return stripNulls(picked) as Record<string, unknown>;
}

/** The company's approval rules (Company.approvalRules), or null while they were never turned on. */
export function approvalRulesOf(company: AnyRecord): Record<string, unknown> | null {
  const rules = asRow(company)?.approvalRules;
  return rules && typeof rules === 'object' && !Array.isArray(rules)
    ? (rules as Record<string, unknown>)
    : null;
}

/** Whether the rules cover issued documents of this type. */
export function rulesCoverDocument(rules: AnyRecord, type: unknown): boolean {
  const types = asRow(rules)?.documentTypes;
  return Array.isArray(types) && types.includes(typeof type === 'string' ? type : '');
}

/** A document's stage: payments move an issued document within it only. */
export function documentStage(status: unknown): 'draft' | 'void' | 'issued' {
  return status === 'draft' || status === 'void' ? status : 'issued';
}

/**
 * Whether storing `after` over `before` needs an approver, as records_guard:
 * an issued document of a type the rules cover whose content changes, or
 * that is voided, comes back from void or goes back to draft. New documents
 * and drafts never do.
 */
export function documentChangeNeedsApproval(
  rules: AnyRecord,
  before: AnyRecord,
  after: AnyRecord,
): boolean {
  const old = asRow(before);
  const next = asRow(after);
  if (!rules || !old || !next || old.status === 'draft') return false;
  if (!rulesCoverDocument(rules, old.type) && !rulesCoverDocument(rules, next.type)) {
    return false;
  }
  return (
    !sameData(invoiceContent(old), invoiceContent(next)) ||
    documentStage(old.status) !== documentStage(next.status)
  );
}

/**
 * What keeps a record from being deleted, as can_delete_record: approval
 * requests always ('request', whether or not the rules are on); with the
 * company's rules on, an issued document of a type they cover, for everyone
 * with "Void instead of delete" ('void': it is voided instead, so its number
 * stays used) and otherwise for anyone but an approver ('approver': a void
 * is asked for instead). Null when nothing keeps it.
 */
export function deleteKeptBy(
  rules: AnyRecord,
  table: string,
  record: AnyRecord,
  approver: boolean,
): 'request' | 'void' | 'approver' | null {
  if (table === 'approvals') return 'request';
  const ruled = asRow(rules);
  const row = asRow(record);
  if (!ruled || table !== 'documents' || row?.status === 'draft') return null;
  if (!rulesCoverDocument(ruled, row?.type)) return null;
  if (ruled.voidInsteadOfDelete === true) return 'void';
  return approver ? null : 'approver';
}

/** Whether the rules keep a record from being deleted by anyone, approvers too (see deleteKeptBy). */
export function rulesKeepRecord(rules: AnyRecord, table: string, record: AnyRecord): boolean {
  return deleteKeptBy(rules, table, record, true) !== null;
}

/**
 * Whether storing `after` over `before` (undefined: new) issues an invoice
 * or credit note without its number while the company numbers them when
 * they are issued (DocumentDefaults.numberOnIssue), as records_guard
 * refuses: an older version of the app issuing a draft that waits for its
 * number gives it none.
 */
export function issuesWithoutNumber(
  company: AnyRecord,
  before: AnyRecord,
  after: AnyRecord,
): boolean {
  const next = asRow(after);
  const defaults = asRow(asRow(company)?.defaults as AnyRecord);
  if (!next || defaults?.numberOnIssue !== true) return false;
  if (next.type !== 'invoice' && next.type !== 'credit') return false;
  if (documentStage(next.status) !== 'issued') return false;
  if (String(next.number ?? '').trim() !== '') return false;
  const old = asRow(before);
  return !old || old.status === 'draft';
}

/* Cheque confirmation (the cheques part of the rules) ---------------------- */

const chequeRules = (rules: AnyRecord): Row => {
  const cheques = asRow(rules)?.cheques;
  return cheques && typeof cheques === 'object' && !Array.isArray(cheques)
    ? (cheques as Row)
    : null;
};

/**
 * Whether the rules ask an approver to confirm this payment, as
 * almailbooks.rules_cover_cheque: a cheque the company writes (issued) or
 * receives (received).
 */
export function rulesCoverCheque(rules: AnyRecord, payment: AnyRecord): boolean {
  const row = asRow(payment);
  const cheques = chequeRules(rules);
  if (!row || !cheques || row.method !== 'cheque') return false;
  return cheques[row.direction === 'out' ? 'issued' : 'received'] === true;
}

/** Whether the rules ask an approver to confirm this security cheque: one the company hands over. */
export function rulesCoverSecurityCheque(rules: AnyRecord, cheque: AnyRecord): boolean {
  const row = asRow(cheque);
  return Boolean(row && row.direction === 'out' && chequeRules(rules)?.securityOut === true);
}

/**
 * What an approver confirms on a cheque payment, as
 * almailbooks.cheque_content: the money and the account it is booked to,
 * who it is for and the cheque itself. Its life (deposited, cleared,
 * returned), its prints, the notes and the documents it pays are not part
 * of it.
 */
export function chequeContent(payment: AnyRecord): Record<string, unknown> {
  const row = asRow(payment) ?? {};
  const cheque = row.cheque && typeof row.cheque === 'object' ? (row.cheque as Row) : null;
  return stripNulls({
    method: row.method,
    direction: row.direction ?? 'in',
    clientId: row.clientId,
    date: row.date,
    amount: row.amount,
    currency: row.currency,
    exchangeRate: row.exchangeRate ?? 1,
    accountId: row.accountId,
    number: cheque?.number,
    bank: cheque?.bank,
    chequeDate: cheque?.date,
    drawer: cheque?.drawer,
    drawerCivilId: cheque?.drawerCivilId === '' ? undefined : cheque?.drawerCivilId,
  }) as Record<string, unknown>;
}

/** The same for a security cheque, as almailbooks.security_cheque_content. */
export function securityChequeContent(cheque: AnyRecord): Record<string, unknown> {
  const row = asRow(cheque) ?? {};
  return stripNulls({
    direction: row.direction ?? 'in',
    number: row.number,
    bank: row.bank,
    date: row.date,
    amount: row.amount,
    currency: row.currency,
    drawer: row.drawer,
    drawerCivilId: row.drawerCivilId === '' ? undefined : row.drawerCivilId,
  }) as Record<string, unknown>;
}

/** A cheque number as text without the spaces around it; null when there is none. */
function leafNumber(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value).trim();
}

/** The leaves a cheque records as spoiled, by number. */
function spoiledNumbers(payment: Row): (string | null)[] {
  const cheque =
    payment?.cheque && typeof payment.cheque === 'object' ? (payment.cheque as Row) : null;
  const leaves = cheque?.spoiledLeaves;
  if (!Array.isArray(leaves)) return [];
  return leaves.map((leaf) =>
    leaf && typeof leaf === 'object' ? leafNumber((leaf as Row)?.number) : null,
  );
}

/**
 * Whether storing `after` over `before` (undefined: new, or deleted) waits
 * for an approver, as almailbooks.cheque_change_needs_approver: a new cheque
 * the rules cover, a change of what is confirmed on one they cover, or
 * deleting one. A printed cheque moved to its next leaf, with the spoiled
 * leaf on record, keeps its confirmation; so does one given its first
 * account.
 */
export function chequeChangeNeedsApprover(
  rules: AnyRecord,
  table: string,
  before: AnyRecord,
  after: AnyRecord,
): boolean {
  const old = asRow(before) ?? null;
  const next = asRow(after) ?? null;
  if (!rules) return false;
  if (table === 'payments') {
    if (!rulesCoverCheque(rules, old) && !rulesCoverCheque(rules, next)) return false;
    if (!old || !next) return true;
    const a = chequeContent(old);
    const b = chequeContent(next);
    const moved = leafNumber(a.number);
    if (!sameData(a.number, b.number) && moved !== null && spoiledNumbers(next).includes(moved)) {
      delete a.number;
      delete b.number;
    }
    // A cheque saved before it had an account gets one: only moving it needs an approver.
    if (a.accountId === undefined || a.accountId === '') {
      delete a.accountId;
      delete b.accountId;
    }
    return !sameData(a, b);
  }
  if (table === 'securityCheques') {
    if (!rulesCoverSecurityCheque(rules, old) && !rulesCoverSecurityCheque(rules, next)) {
      return false;
    }
    if (!old || !next) return true;
    return !sameData(securityChequeContent(old), securityChequeContent(next));
  }
  return false;
}

/** Whether the approval rules differ between two copies of the company record (the owner's alone). */
export function approvalRulesChanged(before: AnyRecord, after: AnyRecord): boolean {
  return !sameData(asRow(before)?.approvalRules ?? null, asRow(after)?.approvalRules ?? null);
}

const APPROVAL_FIXED = [
  'kind',
  'subjectTbl',
  'subjectId',
  'subjectNumber',
  'before',
  'after',
  'reason',
  'requestedBy',
  'requestedByName',
  'requestedAt',
  'createdAt',
] as const;

const DECIDED = new Set(['rejected', 'cancelled', 'applied']);
const DECISIONS = new Set(['approved', 'rejected', 'cancelled', 'applied']);

export type ApprovalWrite =
  { data: Record<string, unknown> } | { refused: 'permission' | 'invalid' };

/** A key of `before` kept as it was (or left out, as it was), as almailbooks.kept_key. */
function keptKey(data: Record<string, unknown>, before: Record<string, unknown>, key: string) {
  if (key in before && before[key] !== undefined) data[key] = before[key];
  else delete data[key];
}

/**
 * What the cloud stores when someone writes an approval request
 * (records_guard, whether or not the company's rules are on), or why it
 * refuses: a new request waits, stamped with who asked and when; what was
 * asked never changes; only an approver decides (whoever asked may take it
 * back while it waits, and changes nothing else); a decision made stays
 * made, whatever an older copy says. A decided request sent up new is kept
 * as it is from the owner (their company sent up again) and stamped as
 * asked and decided by anyone else. `now` is the server's time.
 */
export function guardApprovalWrite(
  before: Row,
  after: Record<string, unknown>,
  who: { userId: string; approver: boolean; owner?: boolean; now: string },
): ApprovalWrite {
  if (!before) {
    if (who.approver && (after.status ?? 'pending') !== 'pending') {
      if (who.owner) return { data: after };
      const data: Record<string, unknown> = { ...after };
      if (data.requestedBy !== who.userId) {
        delete data.requestedByName;
        Object.assign(data, { requestedBy: who.userId, requestedAt: who.now });
      }
      if (data.decidedBy !== who.userId) {
        Object.assign(data, { decidedBy: who.userId, decidedAt: who.now });
      }
      return { data };
    }
    const data: Record<string, unknown> = { ...after };
    delete data.expired;
    delete data.resultId;
    return {
      data: {
        ...data,
        status: 'pending',
        requestedBy: who.userId,
        requestedAt: who.now,
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
      },
    };
  }
  const was = typeof before.status === 'string' ? before.status : 'pending';
  const status = typeof after.status === 'string' ? after.status : was;
  // Whoever isn't an approver changes nothing of a request but taking it back.
  const data: Record<string, unknown> = who.approver
    ? { ...after }
    : { ...before, status, ...('updatedAt' in after ? { updatedAt: after.updatedAt } : {}) };
  for (const key of APPROVAL_FIXED) keptKey(data, before, key);
  const kept = {
    decidedBy: before.decidedBy ?? null,
    decidedAt: before.decidedAt ?? null,
    decisionNote: before.decisionNote ?? '',
  };
  // No decision now (an older copy that still waits, sent again), or one made before.
  if (status === was || status === 'pending' || DECIDED.has(was)) {
    const same: Record<string, unknown> = { ...data, status: was, ...kept };
    keptKey(same, before, 'expired');
    keptKey(same, before, 'resultId');
    return { data: same };
  }
  if (!DECISIONS.has(status)) return { refused: 'invalid' };
  const takenBack =
    was === 'pending' && status === 'cancelled' && before.requestedBy === who.userId;
  if (!who.approver && !takenBack) return { refused: 'permission' };
  // Expired only when an approver cancels a waiting request; what it made only when carried out.
  if (!(who.approver && was === 'pending' && status === 'cancelled')) {
    keptKey(data, before, 'expired');
  }
  if (!(who.approver && status === 'applied')) keptKey(data, before, 'resultId');
  if (was === 'approved' && status === 'applied') return { data: { ...data, ...kept } };
  return { data: { ...data, decidedBy: who.userId, decidedAt: who.now } };
}
