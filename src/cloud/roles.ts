import { msg } from '@/i18n';

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

/**
 * Whether a record is payroll or people data. `lookup` finds the record an
 * attachment or an activity is about; without it only the record itself is
 * judged.
 */
export function isPrivateRecord(table: string, record: Row, lookup?: RecordLookup): boolean {
  if (people.has(table)) return true;
  if (!record) return false;
  if (record._private === true) return true;
  const employeeOwned = (row: Row) => typeof row?.employeeId === 'string' && row.employeeId !== '';
  switch (table) {
    case 'complianceDocuments':
    case 'renewals':
      return employeeOwned(record);
    case 'journals':
      return record.kind === 'payroll';
    case 'activities': {
      if (record.entity === 'employee' || record.entity === 'payroll') return true;
      // Logged about an employee's documents: private even once they are deleted.
      if (employeeOwned(record)) return true;
      if (record.entity !== 'compliance' || !lookup || typeof record.entityId !== 'string') {
        return false;
      }
      return (
        employeeOwned(lookup('complianceDocuments', record.entityId)) ||
        employeeOwned(lookup('renewals', record.entityId))
      );
    }
    case 'attachments': {
      if (!lookup || typeof record.ownerId !== 'string') return false;
      return (
        Boolean(lookup('employees', record.ownerId)) ||
        employeeOwned(lookup('complianceDocuments', record.ownerId)) ||
        employeeOwned(lookup('renewals', record.ownerId))
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
