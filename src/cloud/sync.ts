import type { Table } from 'dexie';
import { db, DATA_TABLES, type DataTable } from '@/db/db';
import { forgetCloudLink } from '@/db/records';
import { logActivity } from '@/db/activity';
import type { ActivityEntity, Attachment, Company, DocumentType, ID } from '@/db/types';
import { msg, t } from '@/i18n';
import {
  cloudError,
  CloudError,
  type CloudApi,
  type PulledRow,
  type PushChange,
  type PushResult,
} from './api';
import { blobToDataUrl, contentHash, dataUrlToBlob, filePath } from './files';
import { markRemote } from './outbox';
import { mergeNumbering } from './numbering';
import { canSeePeople, isPrivateRecord, PEOPLE_TABLES, sameData, type MemberRole } from './roles';
import type { CloudLink, OutboxEntry } from './types';

/**
 * The sync engine. For each company kept in the cloud: send the changes
 * queued in the outbox in batches, then bring in what changed in the cloud
 * since the last rev seen, page by page, each page in one transaction.
 *
 * Nothing is lost: an outbox entry is removed only once the server has
 * confirmed that exact change; a change the server refuses is parked with its
 * reason and shown; a record with unsent changes here is never overwritten or
 * deleted by what comes from the cloud (the local change is sent and wins,
 * and the activity log notes the conflict).
 */

export const PUSH_BATCH = 200;
export const PUSH_BYTES = 512 * 1024;
export const PULL_PAGE = 500;
const ID_PAGE = 1000;
/** Files younger than this are left alone by the clean-up: they may be on their way. */
const ORPHAN_AGE_MS = 60 * 60 * 1000;

export interface SyncProgress {
  companyId: string;
  kind: 'upload' | 'download';
  done: number;
  total: number;
}

export interface SyncContext {
  api: CloudApi;
  userId: string;
  onProgress?: (progress: SyncProgress) => void;
  /** Records per pull (tests use small pages). */
  pullPage?: number;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  parked: number;
}

const SYNCED = new Set<string>(DATA_TABLES);

const table = (name: string): Table<Record<string, unknown>, string> =>
  db.table(name) as Table<Record<string, unknown>, string>;

const tablesForApply = () => [
  ...DATA_TABLES.map((name) => db[name] as Table),
  db.syncState,
  db.syncRevs,
  db.outbox,
];

/* -------------------------------------------------------------------------- */
/* Demo and links                                                             */
/* -------------------------------------------------------------------------- */

/** The demo's address, on a reserved domain no real company has. */
const DEMO_EMAIL = 'accounts@rawdat-alkhaleej.example';

/** The demo company stays on the device it was made on. */
export function isDemoCompany(company: Pick<Company, 'demo' | 'email'>): boolean {
  return company.demo === true || company.email === DEMO_EMAIL;
}

export async function getLink(companyId: string): Promise<CloudLink | undefined> {
  return db.syncState.get(companyId);
}

function newLink(
  companyId: string,
  userId: string,
  role: MemberRole,
  status: CloudLink['status'],
  name: string,
): CloudLink {
  return {
    companyId,
    userId,
    role,
    status,
    cursor: 0,
    name,
    linkedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  };
}

/**
 * Keeps a company of this device in the cloud: creates it there with the
 * person as owner and queues every one of its records for upload. The
 * upload itself is the next sync (with progress).
 */
export async function startUpload(companyId: ID, ctx: SyncContext): Promise<void> {
  const company = await db.companies.get(companyId);
  if (!company) throw new Error(t('Company not found'));
  if (isDemoCompany(company)) {
    throw new CloudError('invalid', t('The demo company stays on this device.'));
  }
  const existing = await db.syncState.get(companyId);
  if (existing && existing.status !== 'removed') return;
  try {
    await ctx.api.createCompany(companyId, company.name);
  } catch (error) {
    throw cloudError(error);
  }
  await db.transaction('rw', tablesForApply(), async () => {
    const at = new Date().toISOString();
    const entries: OutboxEntry[] = [];
    for (const name of DATA_TABLES) {
      const keys =
        name === 'companies'
          ? [companyId]
          : await table(name).where('companyId').equals(companyId).primaryKeys();
      for (const id of keys) {
        entries.push({ companyId, table: name, id: String(id), op: 'put', at, parked: 0 });
      }
    }
    await forgetCloudLink(companyId);
    await db.outbox.bulkAdd(entries);
    await db.syncState.put({
      ...newLink(companyId, ctx.userId, 'owner', 'uploading', company.name),
      total: entries.length,
    });
  });
}

/**
 * Brings a company from the cloud to this device. Its records arrive page by
 * page; the company itself is stored last, so it only appears once it is
 * complete. A copy already on this device is replaced.
 */
export async function startDownload(
  company: { id: string; name: string; role: MemberRole },
  ctx: SyncContext,
): Promise<void> {
  let total = 0;
  try {
    total = (await ctx.api.syncInfo(company.id)).recordCount;
  } catch (error) {
    throw cloudError(error);
  }
  await db.transaction(
    'rw',
    [...DATA_TABLES.map((name) => db[name] as Table), db.syncState, db.outbox, db.syncRevs],
    async () => {
      await forgetCloudLink(company.id);
      // Whatever an earlier copy left behind, without telling the cloud.
      for (const name of DATA_TABLES) {
        if (name === 'companies') await db.companies.delete(company.id);
        else await table(name).where('companyId').equals(company.id).delete();
      }
      await db.syncState.put({
        ...newLink(company.id, ctx.userId, company.role, 'downloading', company.name),
        total,
      });
    },
  );
}

/* -------------------------------------------------------------------------- */
/* One sync                                                                   */
/* -------------------------------------------------------------------------- */

/** Sends what is queued, then brings in what changed. Throws a CloudError when it can't. */
export async function syncCompany(companyId: string, ctx: SyncContext): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, parked: 0 };
  const link = await db.syncState.get(companyId);
  if (!link || link.status === 'removed' || link.userId !== ctx.userId) return result;
  try {
    await processFileQueue(ctx);
    await pushAll(companyId, ctx, result);
    const touched = await pullAll(companyId, ctx, result);
    await reconcile(companyId, touched);
    // Reconciling may have corrected something here: send that too.
    await pushAll(companyId, ctx, result);
    const after = await db.syncState.get(companyId);
    if (after && after.status !== 'removed') {
      await db.syncState.update(companyId, {
        status:
          after.status === 'uploading' && (await pendingCount(companyId)) === 0
            ? 'ready'
            : after.status,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        lastErrorAt: null,
      });
    }
    return result;
  } catch (error) {
    const e = cloudError(error);
    if (e.code === 'not_member') {
      await db.syncState.update(companyId, { status: 'removed', removedReason: 'access' });
    }
    await db.syncState.update(companyId, {
      lastError: e.code,
      lastErrorAt: new Date().toISOString(),
    });
    throw e;
  }
}

export async function pendingCount(companyId: string): Promise<number> {
  return db.outbox.where('[companyId+parked]').equals([companyId, 0]).count();
}

export async function parkedEntries(companyId: string): Promise<OutboxEntry[]> {
  return db.outbox.where('[companyId+parked]').equals([companyId, 1]).toArray();
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

/** Owners before what refers to them, so the server can tell what is private. */
const PUSH_ORDER: Partial<Record<DataTable, number>> = {
  companies: 0,
  employees: 1,
  complianceDocuments: 2,
  renewals: 2,
  attachments: 8,
  activities: 9,
};

interface Outgoing {
  change: PushChange;
  seqs: number[];
  /** Attachment content uploaded with this change. */
  file?: { storagePath: string; contentHash: string };
}

async function pushAll(companyId: string, ctx: SyncContext, result: SyncResult): Promise<void> {
  const link = await db.syncState.get(companyId);
  const total = link?.status === 'uploading' ? (link.total ?? 0) : 0;
  for (;;) {
    const entries = await db.outbox
      .where('[companyId+parked]')
      .equals([companyId, 0])
      .limit(PUSH_BATCH * 5)
      .toArray();
    if (entries.length === 0) return;
    const batch = await buildBatch(companyId, entries, ctx);
    if (batch.length === 0) return;
    await sendBatch(companyId, batch, ctx, result);
    if (total) {
      ctx.onProgress?.({
        companyId,
        kind: 'upload',
        total,
        done: Math.max(0, total - (await pendingCount(companyId))),
      });
    }
  }
}

async function buildBatch(
  companyId: string,
  entries: OutboxEntry[],
  ctx: SyncContext,
): Promise<Outgoing[]> {
  const groups = new Map<string, { table: string; id: string; seqs: number[] }>();
  for (const entry of entries) {
    const key = `${entry.table}/${entry.id}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { table: entry.table, id: entry.id, seqs: [] }));
    group.seqs.push(entry.seq!);
  }
  const privateOwners = await privateOwnerIds(companyId);
  const batch: Outgoing[] = [];
  let bytes = 0;
  for (const group of groups.values()) {
    if (batch.length >= PUSH_BATCH) break;
    if (!SYNCED.has(group.table)) {
      // Not something the cloud keeps: drop it.
      await db.outbox.bulkDelete(group.seqs);
      continue;
    }
    const record = await table(group.table).get(group.id);
    const ours =
      record &&
      (group.table === 'companies' ? group.id === companyId : record.companyId === companyId);
    const base = (await db.syncRevs.get([group.table, group.id]))?.rev ?? null;
    const item: Outgoing = {
      change: { tbl: group.table, id: group.id, deleted: true, base_rev: base },
      seqs: group.seqs,
    };
    if (ours) {
      const data = cloudCopy(group.table, record, privateOwners);
      if (group.table === 'attachments') {
        item.file = await uploadContent(companyId, record as unknown as Attachment, ctx);
        if (item.file) Object.assign(data, { dataUrl: '', ...item.file });
      }
      item.change = { tbl: group.table, id: group.id, data, base_rev: base };
    }
    const size = JSON.stringify(item.change).length;
    if (batch.length > 0 && bytes + size > PUSH_BYTES) break;
    bytes += size;
    batch.push(item);
  }
  return batch.sort(
    (a, b) =>
      (PUSH_ORDER[a.change.tbl as DataTable] ?? 5) - (PUSH_ORDER[b.change.tbl as DataTable] ?? 5),
  );
}

/** Ids of employees and of their documents and renewals: what makes a file private. */
async function privateOwnerIds(companyId: string): Promise<Set<string>> {
  const [employees, documents, renewals] = await Promise.all([
    db.employees.where('companyId').equals(companyId).primaryKeys(),
    db.complianceDocuments
      .where('companyId')
      .equals(companyId)
      .filter((d) => Boolean(d.employeeId))
      .primaryKeys(),
    db.renewals
      .where('companyId')
      .equals(companyId)
      .filter((r) => Boolean(r.employeeId))
      .primaryKeys(),
  ]);
  return new Set([...employees, ...documents, ...renewals].map(String));
}

/** The record as the cloud keeps it, with files and activity about employees marked private. */
function cloudCopy(
  name: string,
  record: Record<string, unknown>,
  privateOwners: Set<string>,
): Record<string, unknown> {
  const data: Record<string, unknown> = JSON.parse(JSON.stringify(record));
  delete data._private;
  // Bookkeeping of this device.
  delete data.contentMissing;
  // Any owner in the set makes the record private, whatever kind it is.
  const lookup = (_table: string, id: string) =>
    privateOwners.has(id) ? { employeeId: id } : null;
  if ((name === 'attachments' || name === 'activities') && isPrivateRecord(name, data, lookup)) {
    data._private = true;
  }
  return data;
}

/**
 * Uploads an attachment's content to Storage unless that exact content is
 * already there. Returns where it is, or nothing when this device doesn't
 * have the content (it came from the cloud and wasn't downloaded).
 */
async function uploadContent(
  companyId: string,
  attachment: Attachment,
  ctx: SyncContext,
): Promise<{ storagePath: string; contentHash: string } | undefined> {
  if (!attachment.dataUrl) return undefined;
  const blob = dataUrlToBlob(attachment.dataUrl);
  const hash = await contentHash(blob);
  const path = filePath(companyId, attachment.id);
  if (attachment.storagePath !== path || attachment.contentHash !== hash) {
    try {
      // The same path: a new version replaces the old file.
      await ctx.api.uploadFile(path, blob, attachment.type || blob.type);
    } catch (error) {
      throw cloudError(error);
    }
  }
  return { storagePath: path, contentHash: hash };
}

async function sendBatch(
  companyId: string,
  batch: Outgoing[],
  ctx: SyncContext,
  result: SyncResult,
): Promise<void> {
  let results: PushResult[];
  try {
    results = await ctx.api.pushRecords(
      companyId,
      batch.map((item) => item.change),
    );
  } catch (error) {
    const e = cloudError(error);
    if (e.retryable || e.code === 'not_member' || e.code === 'resync') throw e;
    // The server refused something in the batch: find it by halves and park it.
    if (batch.length === 1) {
      await db.outbox
        .where('seq')
        .anyOf(batch[0].seqs)
        .modify({ parked: 1, error: e.code, detail: e.detail.slice(0, 500) });
      result.parked += 1;
      return;
    }
    const half = Math.ceil(batch.length / 2);
    await sendBatch(companyId, batch.slice(0, half), ctx, result);
    await sendBatch(companyId, batch.slice(half), ctx, result);
    return;
  }
  await confirm(companyId, batch, results, ctx, result);
}

/** The server has these changes: forget them here, note their versions and conflicts. */
async function confirm(
  companyId: string,
  batch: Outgoing[],
  results: PushResult[],
  ctx: SyncContext,
  result: SyncResult,
): Promise<void> {
  const byKey = new Map(results.map((r) => [`${r.tbl}/${r.id}`, r]));
  const conflicts: Outgoing[] = [];
  const removedFiles: string[] = [];
  await db.transaction('rw', [db.outbox, db.syncRevs, db.attachments], async () => {
    markRemote();
    for (const item of batch) {
      const { tbl, id } = item.change;
      const answer = byKey.get(`${tbl}/${id}`);
      await db.outbox.bulkDelete(item.seqs);
      // A later version got through: an earlier refusal no longer matters.
      await db.outbox
        .where('[table+id]')
        .equals([tbl, id])
        .filter((e) => e.parked === 1)
        .delete();
      if (item.change.deleted) {
        await db.syncRevs.delete([tbl, id]);
        if (tbl === 'attachments') removedFiles.push(filePath(companyId, id));
      } else if (answer?.rev != null) {
        await db.syncRevs.put({ table: tbl, id, companyId, rev: answer.rev });
      }
      if (item.file) {
        await db.attachments.where('id').equals(id).modify(item.file);
      }
      if (answer?.conflict) conflicts.push(item);
    }
  });
  result.pushed += batch.length;
  if (removedFiles.length) await removeFiles(companyId, removedFiles, ctx);
  for (const item of conflicts) {
    if (await logConflict(companyId, item.change)) result.conflicts += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                  */
/* -------------------------------------------------------------------------- */

const ENTITY: Partial<Record<DataTable, ActivityEntity>> = {
  clients: 'client',
  products: 'product',
  payments: 'payment',
  recurring: 'recurring',
  accounts: 'account',
  journals: 'journal',
  expenses: 'expense',
  vatReturns: 'vat_return',
  bankTransactions: 'bank',
  employees: 'employee',
  complianceDocuments: 'compliance',
  securityCheques: 'cheque',
  assets: 'asset',
  yearEnds: 'year_end',
  payRuns: 'payroll',
  stockEntries: 'stock',
};

/** Changes of these are expected on several devices at once and merge on their own. */
const QUIET = new Set<string>(['companies', 'activities', 'stockMovements', 'syncRevs']);

async function logConflict(companyId: string, change: PushChange): Promise<boolean> {
  if (QUIET.has(change.tbl)) return false;
  const data = (change.data ?? {}) as Record<string, unknown>;
  const label =
    (typeof data.number === 'string' && data.number) ||
    (typeof data.name === 'string' && data.name) ||
    (typeof data.reference === 'string' && data.reference) ||
    change.id.slice(0, 8);
  const entity: ActivityEntity =
    change.tbl === 'documents' && typeof data.type === 'string'
      ? (data.type as DocumentType)
      : (ENTITY[change.tbl as DataTable] ?? 'company');
  try {
    await logActivity(
      companyId,
      entity,
      change.id,
      'sync_conflict',
      change.deleted
        ? {
            text: msg(
              '{record} was changed on another device while it was deleted here. It was deleted.',
            ),
            vars: { record: label },
          }
        : {
            text: msg(
              '{record} was also changed on another device. The version saved on this device was kept.',
            ),
            vars: { record: label },
          },
      { documentId: change.tbl === 'documents' ? change.id : null },
    );
    return true;
  } catch {
    // A viewer can't write to the log; the change itself went through.
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Receiving                                                                  */
/* -------------------------------------------------------------------------- */

interface Touched {
  tables: Set<string>;
  documents: Set<string>;
}

async function pullAll(companyId: string, ctx: SyncContext, result: SyncResult): Promise<Touched> {
  const touched: Touched = { tables: new Set(), documents: new Set() };
  let resynced = false;
  for (;;) {
    const link = await db.syncState.get(companyId);
    if (!link || link.status === 'removed') return touched;
    let rows: PulledRow[];
    try {
      rows = await ctx.api.pullRecords(companyId, link.cursor, ctx.pullPage ?? PULL_PAGE);
    } catch (error) {
      const e = cloudError(error);
      if (e.code !== 'resync' || resynced) throw e;
      resynced = true;
      await fullResync(companyId, ctx, touched);
      continue;
    }
    if (rows.length) await applyRows(companyId, rows, touched);
    result.pulled += rows.length;
    if (link.status === 'downloading' && link.total) {
      ctx.onProgress?.({
        companyId,
        kind: 'download',
        total: link.total,
        done: Math.min(link.total, result.pulled),
      });
    }
    if (rows.length < (ctx.pullPage ?? PULL_PAGE)) break;
  }
  await finishPull(companyId, ctx, resynced);
  return touched;
}

/** Stores a page of the cloud's changes in one transaction and moves the cursor past it. */
export async function applyRows(
  companyId: string,
  rows: PulledRow[],
  touched: Touched = { tables: new Set(), documents: new Set() },
): Promise<void> {
  await db.transaction('rw', tablesForApply(), async () => {
    markRemote();
    const link = await db.syncState.get(companyId);
    if (!link || link.status === 'removed') return;
    const pending = new Set(
      (await db.outbox.where('companyId').equals(companyId).toArray()).map(
        (e) => `${e.table}/${e.id}`,
      ),
    );
    const holding = link.status === 'downloading';
    let cursor = link.cursor;
    let pendingCompany = link.pendingCompany ?? null;
    let pendingCompanyRev = link.pendingCompanyRev;
    for (const row of rows) {
      cursor = Math.max(cursor, row.rev);
      if (!SYNCED.has(row.tbl)) continue;
      const store = table(row.tbl);
      const local = await store.get(row.id);
      // A record of another company with the same id is never touched.
      if (local && row.tbl !== 'companies' && local.companyId !== companyId) continue;
      if (pending.has(`${row.tbl}/${row.id}`)) {
        // This device's own change goes up and wins; only the document
        // counters are taken from the cloud, so numbers aren't used twice.
        if (row.tbl === 'companies' && row.data && local) {
          const numbering = mergeNumbering(
            local.numbering as Company['numbering'],
            row.data.numbering as Company['numbering'],
          );
          if (!sameData(numbering, local.numbering)) await store.put({ ...local, numbering });
        }
        continue;
      }
      if (row.deleted) {
        // The company itself is only ever removed by the person, on purpose.
        if (row.tbl === 'companies') continue;
        if (local) {
          noteTouched(touched, row.tbl, local);
          await store.delete(row.id);
        }
        await db.syncRevs.delete([row.tbl, row.id]);
        continue;
      }
      const data = localCopy(companyId, row, local);
      if (!data) continue;
      if (row.tbl === 'companies' && holding) {
        pendingCompany = data;
        pendingCompanyRev = row.rev;
        continue;
      }
      if (!sameData(local, data)) {
        if (local) noteTouched(touched, row.tbl, local);
        noteTouched(touched, row.tbl, data);
        await store.put(data);
      }
      await db.syncRevs.put({ table: row.tbl, id: row.id, companyId, rev: row.rev });
    }
    await db.syncState.update(companyId, { cursor, pendingCompany, pendingCompanyRev });
  });
}

function noteTouched(touched: Touched, name: string, record: Record<string, unknown>) {
  touched.tables.add(name);
  if (name === 'documents') touched.documents.add(String(record.id));
  if (name === 'payments') {
    for (const id of (record.documentIds as string[] | undefined) ?? []) touched.documents.add(id);
    if (typeof record.creditId === 'string') touched.documents.add(record.creditId);
  }
}

/**
 * A record from the cloud as this device stores it, or null when it is not
 * one of this company's records. Attachments keep content already here.
 */
function localCopy(
  companyId: string,
  row: PulledRow,
  local: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const data = row.data;
  if (!data || typeof data !== 'object' || data.id !== row.id) return null;
  if (row.tbl === 'companies' ? row.id !== companyId : data.companyId !== companyId) return null;
  const copy: Record<string, unknown> = { ...data };
  delete copy._private;
  if (row.tbl === 'attachments') {
    const same =
      local &&
      typeof local.dataUrl === 'string' &&
      local.dataUrl !== '' &&
      (local.contentHash === copy.contentHash || !copy.storagePath);
    copy.dataUrl = same ? local.dataUrl : typeof copy.dataUrl === 'string' ? copy.dataUrl : '';
    if (copy.dataUrl === '' && typeof copy.storagePath === 'string' && copy.storagePath) {
      copy.contentMissing = 1;
    } else {
      delete copy.contentMissing;
    }
  }
  return copy;
}

/** Ends a pull: a download stores its company last; a resync moves the cursor past purged deletes. */
async function finishPull(companyId: string, ctx: SyncContext, resynced: boolean): Promise<void> {
  const link = await db.syncState.get(companyId);
  if (!link) return;
  if (link.status !== 'downloading' && !resynced) return;
  const info = await ctx.api.syncInfo(companyId).catch((error) => {
    throw cloudError(error);
  });
  await db.transaction('rw', tablesForApply(), async () => {
    markRemote();
    const current = await db.syncState.get(companyId);
    if (!current) return;
    const patch: Partial<CloudLink> = { cursor: Math.max(current.cursor, info.purgedUntilRev) };
    if (current.status === 'downloading') {
      if (!current.pendingCompany) {
        // The company record isn't in the cloud yet (still uploading): try later.
        throw new CloudError('server', t('This company is still being uploaded. Try again soon.'));
      }
      await db.companies.put(current.pendingCompany as unknown as Company);
      if (current.pendingCompanyRev) {
        await db.syncRevs.put({
          table: 'companies',
          id: companyId,
          companyId,
          rev: current.pendingCompanyRev,
        });
      }
      Object.assign(patch, { status: 'ready', pendingCompany: null, pendingCompanyRev: undefined });
    }
    await db.syncState.update(companyId, patch);
  });
}

/**
 * The device was away longer than deletes are remembered: keep only what the
 * cloud still has (and what is waiting to be sent from here), then bring in
 * everything again.
 */
async function fullResync(companyId: string, ctx: SyncContext, touched: Touched): Promise<void> {
  const ids = new Set<string>();
  let after: { tbl: string; id: string } | null = null;
  try {
    for (;;) {
      const page = await ctx.api.recordIds(companyId, after, ID_PAGE);
      for (const key of page) ids.add(`${key.tbl}/${key.id}`);
      if (page.length < ID_PAGE) break;
      after = page[page.length - 1];
    }
  } catch (error) {
    throw cloudError(error);
  }
  await db.transaction('rw', tablesForApply(), async () => {
    markRemote();
    const pending = new Set(
      (await db.outbox.where('companyId').equals(companyId).toArray()).map(
        (e) => `${e.table}/${e.id}`,
      ),
    );
    for (const name of DATA_TABLES) {
      if (name === 'companies') continue;
      const records = await table(name).where('companyId').equals(companyId).toArray();
      const gone = records.filter(
        (r) => !ids.has(`${name}/${String(r.id)}`) && !pending.has(`${name}/${String(r.id)}`),
      );
      if (gone.length === 0) continue;
      for (const record of gone) noteTouched(touched, name, record);
      await table(name).bulkDelete(gone.map((r) => String(r.id)));
      await db.syncRevs.bulkDelete(gone.map((r) => [name, String(r.id)] as [string, string]));
    }
    await db.syncState.update(companyId, { cursor: 0 });
  });
  const link = await db.syncState.get(companyId);
  if (link?.role === 'owner') {
    // Left-over files of records deleted while this device was away.
    void cleanupFiles(companyId, ctx).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* Derived data                                                               */
/* -------------------------------------------------------------------------- */

const STOCK_TABLES = [
  'documents',
  'stockEntries',
  'landedCosts',
  'stockMovements',
  'products',
  'warehouses',
  'companies',
];

/**
 * Stock levels and costs, document balances and order progress are stored
 * with the records they come from. After changes from the cloud they are
 * worked out again here (the same everywhere, so every device agrees), and
 * whatever differs is saved and sent like any other change.
 */
async function reconcile(companyId: string, touched: Touched): Promise<void> {
  if (touched.tables.size === 0) return;
  const link = await db.syncState.get(companyId);
  if (!link || link.role === 'viewer' || link.status !== 'ready') return;
  const [{ rebuildStock }, { recalculateDocuments, refreshOrdersFor }] = await Promise.all([
    import('@/db/inventory'),
    import('@/db/documents'),
  ]);
  if (STOCK_TABLES.some((name) => touched.tables.has(name)) && (await keepsStock(companyId))) {
    await rebuildStock(companyId);
  }
  if (touched.documents.size) {
    const ids = [...touched.documents];
    await db.transaction('rw', [db.documents, db.clients, db.payments], () =>
      recalculateDocuments(ids),
    );
    await refreshOrdersFor(ids);
  }
}

/** Whether the company has stock to keep in step (stock items or movements). */
async function keepsStock(companyId: string): Promise<boolean> {
  if ((await db.stockMovements.where('companyId').equals(companyId).count()) > 0) return true;
  return (
    (await db.products
      .where('companyId')
      .equals(companyId)
      .filter((p) => p.kind === 'stock')
      .count()) > 0
  );
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Applies a role change. A role that no longer sees payroll and people data
 * loses this device's copy of it; a role that sees more brings everything in
 * again, since it was left out before.
 */
export async function applyRole(companyId: string, role: MemberRole): Promise<void> {
  const link = await db.syncState.get(companyId);
  if (!link || link.role === role) return;
  const seesMore = !canSeePeople(link.role) && canSeePeople(role);
  await db.syncState.update(companyId, { role, ...(seesMore ? { cursor: 0 } : {}) });
  if (!canSeePeople(role)) await removeHiddenData(companyId);
}

/** Removes from this device what the person's role may not see (payroll and people data). */
export async function removeHiddenData(companyId: string): Promise<void> {
  await db.transaction('rw', tablesForApply(), async () => {
    markRemote();
    const owners = await privateOwnerIds(companyId);
    const lookup = (_table: string, id: string) => (owners.has(id) ? { employeeId: id } : null);
    for (const name of DATA_TABLES) {
      if (name === 'companies') continue;
      const records = await table(name).where('companyId').equals(companyId).toArray();
      const hidden = records.filter(
        (r) =>
          (PEOPLE_TABLES as readonly string[]).includes(name) ||
          isPrivateRecord(name, r, lookup) ||
          owners.has(String(r.id)),
      );
      if (hidden.length === 0) continue;
      const keys = hidden.map((r) => String(r.id));
      await table(name).bulkDelete(keys);
      await db.syncRevs.bulkDelete(keys.map((id) => [name, id] as [string, string]));
      await db.outbox
        .where('companyId')
        .equals(companyId)
        .filter((e) => e.table === name && keys.includes(e.id))
        .delete();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Files                                                                      */
/* -------------------------------------------------------------------------- */

/** Removes files from Storage; what can't be removed now waits in the file queue. */
async function removeFiles(companyId: string, paths: string[], ctx: SyncContext): Promise<void> {
  try {
    await ctx.api.removeFiles(paths);
  } catch (error) {
    const at = new Date().toISOString();
    await db.fileQueue.bulkAdd(
      paths.map((path) => ({
        companyId,
        path,
        at,
        attempts: 1,
        lastError: cloudError(error).code,
      })),
    );
  }
}

/** Tries the file removals that failed before. */
export async function processFileQueue(ctx: SyncContext): Promise<void> {
  const tasks = await db.fileQueue.limit(100).toArray();
  if (tasks.length === 0) return;
  try {
    await ctx.api.removeFiles(tasks.map((task) => task.path));
    await db.fileQueue.bulkDelete(tasks.map((task) => task.seq!));
  } catch (error) {
    const code = cloudError(error).code;
    await db.fileQueue
      .where('seq')
      .anyOf(tasks.map((task) => task.seq!))
      .modify((task) => {
        task.attempts += 1;
        task.lastError = code;
      });
  }
}

/** Downloads the content of attachments that arrived without it (small ones). */
export async function downloadMissingFiles(
  companyId: string,
  ctx: SyncContext,
  maxBytes: number,
): Promise<void> {
  // Only files marked missing are read: reading every file would load all
  // their content.
  const missing = await db.attachments
    .where('[companyId+contentMissing]')
    .equals([companyId, 1])
    .filter((a) => !a.dataUrl && Boolean(a.storagePath) && (a.size ?? 0) <= maxBytes)
    .toArray();
  for (const attachment of missing) {
    await fetchAttachmentContent(attachment, ctx).catch(() => undefined);
  }
}

/** The content of an attachment, downloading it from the cloud when needed. */
export async function fetchAttachmentContent(
  attachment: Pick<Attachment, 'id' | 'dataUrl' | 'storagePath' | 'contentHash' | 'type'>,
  ctx: SyncContext,
): Promise<string> {
  if (attachment.dataUrl) return attachment.dataUrl;
  if (!attachment.storagePath) throw new Error(t('This file is not available.'));
  let blob: Blob;
  try {
    blob = await ctx.api.downloadFile(attachment.storagePath);
  } catch (error) {
    throw cloudError(error);
  }
  const dataUrl = await blobToDataUrl(blob, attachment.type || blob.type);
  await db.transaction('rw', db.attachments, async () => {
    markRemote();
    const current = await db.attachments.get(attachment.id);
    if (current && !current.dataUrl && current.contentHash === attachment.contentHash) {
      const filled: Attachment = { ...current, dataUrl };
      delete filled.contentMissing;
      await db.attachments.put(filled);
    }
  });
  return dataUrl;
}

/**
 * Removes files in the company's folder that no attachment uses any more
 * (owners only). Returns how many were removed.
 */
export async function cleanupFiles(companyId: string, ctx: SyncContext): Promise<number> {
  try {
    const files = await ctx.api.listFiles(companyId);
    const used = new Set<string>();
    let after: { tbl: string; id: string } | null = null;
    for (;;) {
      const page = await ctx.api.recordIds(companyId, after, ID_PAGE, 'attachments');
      for (const key of page) used.add(filePath(companyId, key.id));
      if (page.length < ID_PAGE) break;
      after = page[page.length - 1];
    }
    const cutoff = Date.now() - ORPHAN_AGE_MS;
    const orphans = files
      .filter((file) => !used.has(file.path))
      .filter((file) => !file.createdAt || Date.parse(file.createdAt) < cutoff)
      .map((file) => file.path);
    for (let i = 0; i < orphans.length; i += 100) {
      await ctx.api.removeFiles(orphans.slice(i, i + 100));
    }
    return orphans.length;
  } catch (error) {
    throw cloudError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Refused changes                                                            */
/* -------------------------------------------------------------------------- */

/** Sends a refused change again (after the role was changed, say). */
export async function retryParked(companyId: string): Promise<void> {
  await db.outbox
    .where('[companyId+parked]')
    .equals([companyId, 1])
    .modify({ parked: 0, error: undefined, detail: undefined });
}

/**
 * Gives up a refused change: this device takes the record back as the cloud
 * has it (or removes it when the cloud doesn't have it).
 */
export async function discardParked(
  companyId: string,
  entry: Pick<OutboxEntry, 'table' | 'id'>,
  ctx: SyncContext,
): Promise<void> {
  let remote: { data: Record<string, unknown>; rev: number } | null;
  try {
    remote = await ctx.api.getRecord(companyId, entry.table, entry.id);
  } catch (error) {
    throw cloudError(error);
  }
  await db.transaction('rw', tablesForApply(), async () => {
    markRemote();
    await db.outbox.where('[table+id]').equals([entry.table, entry.id]).delete();
    const store = table(entry.table);
    if (!remote) {
      await store.delete(entry.id);
      await db.syncRevs.delete([entry.table, entry.id]);
      return;
    }
    const local = await store.get(entry.id);
    const data = localCopy(
      companyId,
      { tbl: entry.table, id: entry.id, data: remote.data, rev: remote.rev, deleted: false },
      local,
    );
    if (data) await store.put(data);
    await db.syncRevs.put({ table: entry.table, id: entry.id, companyId, rev: remote.rev });
  });
}

/* -------------------------------------------------------------------------- */
/* Leaving the cloud                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Deletes the company in the cloud (owners): its files first, then the
 * company with everything in it, then this device's copy.
 */
export async function deleteFromCloud(companyId: string, ctx: SyncContext): Promise<void> {
  try {
    const files = await ctx.api.listFiles(companyId);
    for (let i = 0; i < files.length; i += 100) {
      await ctx.api.removeFiles(files.slice(i, i + 100).map((file) => file.path));
    }
    await ctx.api.deleteCompany(companyId);
  } catch (error) {
    throw cloudError(error);
  }
  await db.fileQueue.where('companyId').equals(companyId).delete();
  const { deleteCompany } = await import('@/db/records');
  await deleteCompany(companyId);
}

/** Stops syncing a company here and keeps this device's copy as a local company. */
export async function keepAsLocal(companyId: string): Promise<void> {
  await db.transaction('rw', [db.syncState, db.outbox, db.syncRevs], () =>
    forgetCloudLink(companyId),
  );
}
