import Dexie, {
  type DBCore,
  type DBCoreMutateRequest,
  type DBCoreMutateResponse,
  type DBCoreTable,
  type DBCoreTransaction,
  type Middleware,
} from 'dexie';
import { t } from '@/i18n';
import { canWriteRecord, sameData, staffCompanyChangeOk } from './roles';
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
 * setup and payroll), with a message they can act on. The server enforces the
 * same rules on its own.
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

function refuse(link: CloudLink, table: string, change: Change): string | null {
  if (link.status === 'removed') {
    return t(
      'This company is no longer shared with you. Keep it as a company on this device or remove it.',
    );
  }
  if (link.role === 'viewer') return t('You can view this company but not change it.');
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
  const links = await linksFor(
    down,
    trans,
    changes.map((c) => c.companyId),
  );
  for (const change of changes) {
    const link = change.companyId ? links.get(change.companyId) : null;
    if (!link) continue;
    const reason = refuse(link, name, change);
    if (reason) throw new CloudPermissionError(reason, link.companyId);
  }

  const result = await table.mutate(req);

  const at = new Date().toISOString();
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
    name: 'AlmailBooksOutbox',
    // Above Dexie's own middleware, so it sees the same transaction objects as Dexie.
    level: 20,
    create(down) {
      const enabled = down.schema.tables.some((t) => t.name === 'outbox');
      if (!enabled) return {};
      return {
        transaction(stores, mode, options) {
          if (mode === 'readwrite' && stores.some((s) => synced.has(s))) {
            const extra = ['outbox', 'syncState'].filter((s) => !stores.includes(s));
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
