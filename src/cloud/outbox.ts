import Dexie, {
  type DBCore,
  type DBCoreMutateRequest,
  type DBCoreMutateResponse,
  type DBCoreTable,
  type DBCoreTransaction,
  type Middleware,
} from 'dexie';
import { t } from '@/i18n';
import { shortId } from '@/lib/ids';
import {
  approvalRulesChanged,
  approvalRulesOf,
  canWriteRecord,
  chequeChangeNeedsApprover,
  deleteKeptBy,
  documentChangeNeedsApproval,
  guardApprovalWrite,
  isApprover,
  issuesWithoutNumber,
  limitBlocksWrite,
  sameData,
  staffCompanyChangeOk,
} from './roles';
import type { CloudLink, OutboxEntry } from './types';

/**
 * Change capture. Every write to a synced table of a company kept in the
 * cloud also writes an outbox entry, in the same IndexedDB transaction, so a
 * change can't be saved without being queued for the server (and a failed
 * write queues nothing). Writes that bring changes from the server are tagged
 * with `markRemote()` and are not sent back. Saving something unchanged queues
 * nothing.
 *
 * The capture also refuses, before anything is written, changes the person's
 * role does not allow (viewers change nothing; staff stay out of accounting
 * setup and payroll), the owner's limits on them (an app made view only) or
 * the company's approval rules (an issued invoice only an approver may
 * change, a cheque only an approver may record), with a message they can
 * act on. The server enforces the same rules on its own.
 */

export class CloudPermissionError extends Error {
  constructor(
    message: string,
    readonly companyId: string,
  ) {
    super(message);
    this.name = 'CloudPermissionError';
  }
}

const remote = new WeakSet<object>();
const linkCache = new WeakMap<object, Map<string, CloudLink | null>>();
/** The group of the changes of each transaction (OutboxEntry.group). */
const groups = new WeakMap<object, string>();

function groupOf(trans: object): string {
  let group = groups.get(trans);
  if (!group) groups.set(trans, (group = shortId()));
  return group;
}
const notified = new WeakSet<object>();

/** Marks the running transaction as applying the server's changes: they are not queued. */
export function markRemote(): void {
  const tx = Dexie.currentTransaction;
  if (!tx) throw new Error('markRemote() needs a transaction');
  remote.add(tx.idbtrans);
}

type Listener = (companyIds: string[]) => void;
const listeners = new Set<Listener>();

/** Called after a transaction that queued changes has been saved. */
export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyOnCommit(trans: DBCoreTransaction, companyIds: Set<string>) {
  const native = trans as unknown as IDBTransaction;
  const pending = ((native as unknown as { _almailCompanies?: Set<string> })._almailCompanies ??=
    new Set());
  for (const id of companyIds) pending.add(id);
  if (notified.has(native) || typeof native.addEventListener !== 'function') return;
  notified.add(native);
  native.addEventListener('complete', () => {
    const ids = [...pending];
    for (const listener of listeners) {
      try {
        listener(ids);
      } catch {
        // A listener's problem must not affect saving.
      }
    }
  });
}

interface Change {
  key: unknown;
  before: Record<string, unknown> | undefined;
  after: Record<string, unknown> | undefined;
  companyId: string | null;
}

function companyOf(table: string, change: Omit<Change, 'companyId'>): string | null {
  if (table === 'companies') return typeof change.key === 'string' ? change.key : null;
  const row = change.after ?? change.before;
  return typeof row?.companyId === 'string' ? row.companyId : null;
}

async function linksFor(
  down: DBCore,
  trans: DBCoreTransaction,
  companyIds: (string | null)[],
): Promise<Map<string, CloudLink | null>> {
  let cache = linkCache.get(trans);
  if (!cache) {
    cache = new Map();
    linkCache.set(trans, cache);
  }
  const missing = [...new Set(companyIds.filter((id): id is string => !!id && !cache.has(id)))];
  if (missing.length) {
    const rows = (await down.table('syncState').getMany({ trans, keys: missing })) as (
      CloudLink | undefined
    )[];
    missing.forEach((id, i) => cache.set(id, rows[i] ?? null));
  }
  return cache;
}

/** Tables whose changes the company's approval rules decide on (see refuseByRules). */
const RULED = new Set(['documents', 'approvals', 'payments', 'securityCheques']);

/** The company records of these companies, as stored in this transaction. */
async function companiesFor(
  down: DBCore,
  trans: DBCoreTransaction,
  companyIds: string[],
): Promise<Map<string, Record<string, unknown> | null>> {
  const ids = [...new Set(companyIds)];
  const found = new Map<string, Record<string, unknown> | null>();
  if (ids.length === 0) return found;
  const rows = (await down.table('companies').getMany({ trans, keys: ids })) as (
    Record<string, unknown> | undefined
  )[];
  ids.forEach((id, i) => found.set(id, rows[i] ?? null));
  return found;
}

/**
 * The company's approval rules, as the server applies them (records_guard,
 * can_delete_record). `company` is the company's record as stored here; its
 * rules are null while never turned on. Approval requests are kept honest,
 * and invoices numbered when they are issued are never issued without a
 * number, whether or not the rules are on.
 */
function refuseByRules(
  link: CloudLink,
  table: string,
  change: Change,
  company: Record<string, unknown> | null | undefined,
): string | null {
  if (table === 'companies') {
    return link.role !== 'owner' &&
      change.after !== undefined &&
      approvalRulesChanged(change.before, change.after)
      ? t('Only the owner changes the approval rules.')
      : null;
  }
  const rules = approvalRulesOf(company);
  const approver = isApprover(link.role, link.approver);
  if (!change.after) {
    if (!change.before) return null;
    const kept = deleteKeptBy(rules, table, change.before, approver);
    if (kept === 'request') {
      return t('Approval requests are kept as the record of who asked and who decided.');
    }
    if (kept === 'void') {
      return t('Issued documents are voided, never deleted, so their numbers stay used.');
    }
    if (kept === 'approver') {
      return t(
        'This document is issued, so only an approver can delete it. Ask for a void instead.',
      );
    }
  }
  if (table === 'documents' && issuesWithoutNumber(company, change.before, change.after)) {
    return t('This invoice has no number yet. Issue it again to give it one.');
  }
  if (table === 'approvals' && change.after) {
    const write = guardApprovalWrite(change.before, change.after, {
      userId: link.userId,
      approver,
      owner: link.role === 'owner',
      now: new Date().toISOString(),
    });
    return 'refused' in write ? t('Only an approver decides approval requests.') : null;
  }
  if (!rules) return null;
  if (table === 'payments' || table === 'securityCheques') {
    // A cheque the rules keep for approvers: recorded, changed or deleted by them only.
    return !approver && chequeChangeNeedsApprover(rules, table, change.before, change.after)
      ? t('This cheque needs confirmation. Send it for confirmation instead.')
      : null;
  }
  if (table === 'documents' && change.after) {
    return !approver && documentChangeNeedsApproval(rules, change.before, change.after)
      ? t('This change needs approval. Send it for approval instead.')
      : null;
  }
  return null;
}

function refuse(
  link: CloudLink,
  table: string,
  change: Change,
  company: Record<string, unknown> | null | undefined,
): string | null {
  return refuseByRole(link, table, change) ?? refuseByRules(link, table, change, company);
}

function refuseByRole(link: CloudLink, table: string, change: Change): string | null {
  if (link.status === 'removed') {
    return t(
      'This company is no longer shared with you. Keep it as a company on this device or remove it.',
    );
  }
  if (link.role === 'viewer') return t('You can view this company but not change it.');
  // The owner's limits on this person, as the server applies them.
  const limited = (row: Record<string, unknown> | undefined) =>
    row !== undefined && limitBlocksWrite(link.role, link.permissions, table, row);
  if (limited(change.before) || limited(change.after)) {
    return t(
      'The owner has made this app view only for you. Ask the owner if you need to change it.',
    );
  }
  if (link.role !== 'staff') return null;
  const denied = t('Your role can’t make this change. Ask an owner, admin or accountant.');
  if (table === 'companies') {
    if (!change.after) return denied;
    return change.before && staffCompanyChangeOk(change.before, change.after) ? null : denied;
  }
  if (change.before && !canWriteRecord('staff', table, change.before)) return denied;
  if (change.after && !canWriteRecord('staff', table, change.after)) return denied;
  return null;
}

async function capture(
  down: DBCore,
  table: DBCoreTable,
  name: string,
  req: DBCoreMutateRequest,
): Promise<DBCoreMutateResponse> {
  const { trans } = req;
  if (remote.has(trans)) return table.mutate(req);
  const primaryKey = table.schema.primaryKey;
  const keyOf = (value: unknown) => primaryKey.extractKey!(value);

  let keys: unknown[];
  let before: (Record<string, unknown> | undefined)[];
  let after: (Record<string, unknown> | undefined)[];
  if (req.type === 'add' || req.type === 'put') {
    after = req.values as Record<string, unknown>[];
    keys = req.keys ?? after.map(keyOf);
    before = await table.getMany({ trans, keys });
  } else if (req.type === 'delete') {
    keys = req.keys;
    before = await table.getMany({ trans, keys });
    after = keys.map(() => undefined);
  } else {
    const found = await table.query({
      trans,
      values: true,
      query: { index: primaryKey, range: req.range },
    });
    before = found.result as Record<string, unknown>[];
    keys = before.map(keyOf);
    after = keys.map(() => undefined);
  }

  const changes: Change[] = keys.map((key, i) => {
    const change = { key, before: before[i], after: after[i] };
    return { ...change, companyId: companyOf(name, change) };
  });
  const companyIds = changes.map((c) => c.companyId);
  // Both at once: Dexie keeps its transaction across only so many waits.
  const [links, companies] = await Promise.all([
    linksFor(down, trans, companyIds),
    RULED.has(name) && down.schema.tables.some((t) => t.name === 'companies')
      ? companiesFor(
          down,
          trans,
          companyIds.filter((id): id is string => !!id),
        )
      : null,
  ]);
  for (const change of changes) {
    const link = change.companyId ? links.get(change.companyId) : null;
    if (!link) continue;
    const reason = refuse(link, name, change, companies?.get(link.companyId));
    if (reason) throw new CloudPermissionError(reason, link.companyId);
  }

  const result = await table.mutate(req);

  const at = new Date().toISOString();
  const group = groupOf(trans);
  const entries: OutboxEntry[] = [];
  changes.forEach((change, i) => {
    if (result.failures[i] || !change.companyId || !links.get(change.companyId)) return;
    if (change.after === undefined && change.before === undefined) return;
    if (change.after !== undefined && sameData(change.before, change.after)) return;
    entries.push({
      companyId: change.companyId,
      table: name,
      id: String(change.key),
      op: change.after === undefined ? 'delete' : 'put',
      at,
      parked: 0,
      group,
    });
  });
  if (entries.length) {
    await down.table('outbox').mutate({ type: 'add', trans, values: entries });
    notifyOnCommit(trans, new Set(entries.map((e) => e.companyId)));
  }
  return result;
}

/**
 * The middleware for the app's database. `tables` are the synced tables; the
 * database must have `outbox` and `syncState` tables.
 */
export function outboxMiddleware(tables: readonly string[]): Middleware<DBCore> {
  const synced = new Set(tables);
  return {
    stack: 'dbcore',
    name: 'MahamBooksOutbox',
    // Above Dexie's own middleware, so it sees the same transaction objects as Dexie.
    level: 20,
    create(down) {
      const enabled = down.schema.tables.some((t) => t.name === 'outbox');
      if (!enabled) return {};
      const withCompanies = down.schema.tables.some((t) => t.name === 'companies');
      return {
        transaction(stores, mode, options) {
          if (mode === 'readwrite' && stores.some((s) => synced.has(s))) {
            // The company record too where its approval rules decide on a change.
            const wanted =
              stores.some((s) => RULED.has(s)) && withCompanies
                ? ['outbox', 'syncState', 'companies']
                : ['outbox', 'syncState'];
            const extra = wanted.filter((s) => !stores.includes(s));
            return down.transaction([...stores, ...extra], mode, options);
          }
          return down.transaction(stores, mode, options);
        },
        table(name) {
          const table = down.table(name);
          if (name === 'syncState') {
            // A link changed in this transaction: look it up again.
            return {
              ...table,
              mutate: (req) => {
                linkCache.delete(req.trans);
                return table.mutate(req);
              },
            };
          }
          if (!synced.has(name)) return table;
          return { ...table, mutate: (req) => capture(down, table, name, req) };
        },
      };
    },
  };
}
