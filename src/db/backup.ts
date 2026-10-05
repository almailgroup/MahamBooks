import { z } from 'zod';
import { db, DATA_TABLES, setMeta, getMeta, type DataTable } from './db';
import { assertNothingUnsent, CURRENT_COMPANY_KEY, SYNC_TABLES, unsentChanges } from './records';
import { seedMissingCharts } from './chart-setup';
import { recalculateDocuments, refreshOrdersFor } from './documents';
import { rebuildStock } from './inventory';
import type { Attachment, Company, ID, Payment } from './types';
import { APP_NAME, appName, FILE_PREFIX } from '@/lib/brand';
import { t } from '@/i18n';

export const BACKUP_FORMAT = 1;
export const LAST_BACKUP_KEY = 'lastBackupAt';

export type BackupData = Record<DataTable, Record<string, unknown>[]>;

/** A file listed in a backup without its content (it could not be downloaded from the cloud). */
export interface MissingFile {
  id: ID;
  companyId: ID;
  /** Record the file belongs to. */
  ownerId: ID;
  name: string;
  type: string;
  size: number;
}

export interface Backup {
  /** Written as the app name. Files are recognised by their structure, so
   * backups from earlier builds restore whatever they were labelled. */
  app: string;
  format: number;
  exportedAt: string;
  data: BackupData;
  /**
   * Files whose content is not in the backup: they were kept in the cloud
   * and could not be downloaded when it was made. Their records are in
   * `data.attachments`, with no content.
   */
  missingFiles?: MissingFile[];
}

const row = z.looseObject({ id: z.string().min(1) });
const ownedRow = z.looseObject({ id: z.string().min(1), companyId: z.string().min(1) });

const backupSchema = z.object({
  app: z.string().min(1),
  format: z.number().int().min(1),
  exportedAt: z.string(),
  data: z.object({
    companies: z.array(row),
    clients: z.array(ownedRow).default([]),
    products: z.array(ownedRow).default([]),
    taxRates: z.array(ownedRow).default([]),
    documents: z.array(ownedRow).default([]),
    payments: z.array(ownedRow).default([]),
    recurring: z.array(ownedRow).default([]),
    activities: z.array(ownedRow).default([]),
    accounts: z.array(ownedRow).default([]),
    journals: z.array(ownedRow).default([]),
    expenses: z.array(ownedRow).default([]),
    attachments: z.array(ownedRow).default([]),
    vatReturns: z.array(ownedRow).default([]),
    bankTransactions: z.array(ownedRow).default([]),
    employees: z.array(ownedRow).default([]),
    complianceDocuments: z.array(ownedRow).default([]),
    renewals: z.array(ownedRow).default([]),
    complianceMarks: z.array(ownedRow).default([]),
    peopleSettings: z.array(ownedRow).default([]),
    securityCheques: z.array(ownedRow).default([]),
    assets: z.array(ownedRow).default([]),
    depreciationRuns: z.array(ownedRow).default([]),
    yearEnds: z.array(ownedRow).default([]),
    payRuns: z.array(ownedRow).default([]),
    payrollSettings: z.array(ownedRow).default([]),
    leaveRecords: z.array(ownedRow).default([]),
    staffLoans: z.array(ownedRow).default([]),
    finalSettlements: z.array(ownedRow).default([]),
    warehouses: z.array(ownedRow).default([]),
    stockMovements: z.array(ownedRow).default([]),
    stockEntries: z.array(ownedRow).default([]),
    landedCosts: z.array(ownedRow).default([]),
  }),
  missingFiles: z.array(z.looseObject({ id: z.string().min(1) })).optional(),
});

export class BackupError extends Error {}

/**
 * Exports all data, or a single company with everything that belongs to it.
 * Files whose content is not on this device go in without it and are listed
 * in `missingFiles`; bring them here first with `fetchMissingFiles`.
 */
export async function exportBackup(companyId?: ID): Promise<Backup> {
  const data = {} as BackupData;
  for (const table of DATA_TABLES) {
    const rows =
      table === 'companies'
        ? await db.companies.toArray()
        : companyId
          ? await db[table].where('companyId').equals(companyId).toArray()
          : await db[table].toArray();
    data[table] = (companyId && table === 'companies'
      ? rows.filter((r) => r.id === companyId)
      : rows) as unknown as Record<string, unknown>[];
  }
  const missingFiles = (data.attachments as unknown as Attachment[])
    .filter((a) => !a.dataUrl)
    .map((a): MissingFile => ({
      id: a.id,
      companyId: a.companyId,
      ownerId: a.ownerId,
      name: a.name,
      type: a.type,
      size: a.size,
    }));
  return {
    app: APP_NAME,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    data,
    ...(missingFiles.length ? { missingFiles } : {}),
  };
}

/**
 * Files (receipts, scans, employee photos…) whose content is not on this
 * device: kept in the cloud and not downloaded yet. Read one at a time, so
 * the content of the others is never all in memory.
 */
export async function filesNotHere(companyId?: ID): Promise<Attachment[]> {
  const found: Attachment[] = [];
  const files = companyId
    ? db.attachments.where('companyId').equals(companyId)
    : db.attachments.toCollection();
  await files.each((file) => {
    if (!file.dataUrl) found.push(file);
  });
  return found;
}

/** Files downloaded at the same time before a backup. */
const DOWNLOADS_AT_ONCE = 4;

/**
 * Brings the content of every file that is not on this device yet, before a
 * backup. `fetchFile` downloads one and stores it (see cloud/attachments);
 * the files it could not bring (offline, signed out, no longer in the cloud)
 * are returned.
 */
export async function fetchMissingFiles(
  companyId: ID | undefined,
  fetchFile: (file: Attachment) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; failed: Attachment[] }> {
  const missing = await filesNotHere(companyId);
  const failed: Attachment[] = [];
  let done = 0;
  onProgress?.(0, missing.length);
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const file = missing[next++];
      try {
        await fetchFile(file);
        // Only content that is stored here goes into the backup.
        const stored = await db.attachments.get(file.id);
        if (stored && !stored.dataUrl) failed.push(file);
      } catch {
        failed.push(file);
      }
      done += 1;
      onProgress?.(done, missing.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, missing.length) }, worker));
  return { total: missing.length, failed };
}

export function backupFileName(company?: Pick<Company, 'name'>): string {
  const stamp = new Date().toISOString().slice(0, 10);
  // Letters and digits only, so the name saves the same everywhere.
  const slug = (company?.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${FILE_PREFIX}-backup${slug ? `-${slug}` : ''}-${stamp}.json`;
}

export function parseBackup(text: string): Backup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError(t('This file is not a valid backup (it is not JSON).'));
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) {
    throw new BackupError(
      t('This file is not a {app} backup, or it is damaged.', { app: appName() }),
    );
  }
  if (result.data.format > BACKUP_FORMAT) {
    throw new BackupError(
      t('This backup was made by a newer version of the app. Please update first.'),
    );
  }
  return result.data as Backup;
}

export function summarizeBackup(backup: Backup): Record<DataTable, number> {
  return Object.fromEntries(DATA_TABLES.map((t) => [t, backup.data[t].length])) as Record<
    DataTable,
    number
  >;
}

/** What restoring a backup on this device touches, for the screens to say before. */
export interface RestoreImpact {
  /** Changes made here that have not reached the cloud yet (Replace loses them). */
  unsent: number;
  /** Companies of the backup that this device keeps in the cloud. */
  inCloud: Company[];
}

export async function restoreImpact(backup: Backup): Promise<RestoreImpact> {
  const linked = new Set(await db.syncState.toCollection().primaryKeys());
  return {
    unsent: await unsentChanges(),
    inCloud: (backup.data.companies as unknown as Company[]).filter((c) => linked.has(c.id)),
  };
}

export interface RestoreResult {
  /** Records written from the backup. */
  added: number;
  /** Merge: records already on this device, kept as they are. */
  kept: number;
}

type Rows = Record<string, unknown>[];
type WritableTable = {
  bulkAdd: (rows: unknown[]) => Promise<unknown>;
  bulkPut: (rows: unknown[]) => Promise<unknown>;
  where: (index: string) => {
    anyOf: (keys: string[]) => { primaryKeys: () => Promise<unknown[]> };
  };
};

/** One row per id (a damaged file may repeat one). */
function uniqueRows(rows: Rows): Rows {
  const seen = new Set<unknown>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
}

/**
 * Restores a backup.
 *
 * - "replace" deletes everything on this device first. Companies kept in the
 *   cloud stay there: this device stops syncing them (its copy becomes a
 *   company on this device only), so nothing is deleted in the cloud. It is
 *   refused while changes have not reached the cloud yet
 *   (UnsentChangesError), unless `force` is given after the person agreed.
 * - "merge" adds only the records this device doesn't have; every record
 *   already here is kept as it is. Balances of invoices and bills, order
 *   progress and stock are then worked out again where the backup's records
 *   meet this device's. For a company kept in the cloud the added records go
 *   to the team like any other change.
 *
 * `sanitizeLogo` lets the caller re-encode images (it must return a safe data
 * URL or null).
 */
export async function importBackup(
  backup: Backup,
  mode: 'replace' | 'merge',
  sanitizeLogo?: (logo: string) => Promise<string | null>,
  { force = false }: { force?: boolean } = {},
): Promise<RestoreResult> {
  const companies = backup.data.companies as unknown as Company[];
  if (sanitizeLogo) {
    for (const c of companies) {
      if (c.branding?.logo) {
        try {
          c.branding.logo = await sanitizeLogo(c.branding.logo);
        } catch {
          c.branding.logo = null;
        }
      }
    }
  }
  return db.transaction(
    'rw',
    [...DATA_TABLES.map((t) => db[t]), ...SYNC_TABLES(), db.meta],
    async () => {
      const result: RestoreResult = { added: 0, kept: 0 };
      if (mode === 'replace') {
        await assertNothingUnsent(undefined, force);
        // Companies kept in the cloud stay there: this device stops syncing them
        // before its copy is replaced, so nothing is deleted in the cloud.
        for (const table of SYNC_TABLES()) await table.clear();
        for (const table of DATA_TABLES) await db[table].clear();
        for (const table of DATA_TABLES) {
          const rows = uniqueRows(backup.data[table]);
          // Dexie's typing is per table; the rows were validated above.
          if (rows.length) await (db[table] as unknown as WritableTable).bulkPut(rows);
          result.added += rows.length;
        }
      } else {
        const before = new Set(await db.companies.toCollection().primaryKeys());
        const added = {} as Record<DataTable, Rows>;
        for (const table of DATA_TABLES) {
          const rows = uniqueRows(backup.data[table]);
          const store = db[table] as unknown as WritableTable;
          const here = rows.length
            ? new Set(
                await store
                  .where(':id')
                  .anyOf(rows.map((r) => String(r.id)))
                  .primaryKeys(),
              )
            : new Set<unknown>();
          added[table] = rows.filter((r) => !here.has(r.id));
          if (added[table].length) await store.bulkAdd(added[table]);
          result.added += added[table].length;
          result.kept += rows.length - added[table].length;
        }
        await settleMerged(added, before);
      }
      // Backups made before accounting existed have no chart of accounts.
      await seedMissingCharts(db);
      const current = await getMeta<string | null>(CURRENT_COMPANY_KEY, null);
      const exists = current ? await db.companies.get(current) : undefined;
      if (!exists && companies[0]) await setMeta(CURRENT_COMPANY_KEY, companies[0].id);
      return result;
    },
  );
}

/** Tables whose records the stock levels and costs are worked out from. */
const STOCK_TABLES: DataTable[] = [
  'documents',
  'stockEntries',
  'landedCosts',
  'stockMovements',
  'products',
  'warehouses',
];

/**
 * After a merge, works out again what is stored with the records it comes
 * from, for companies that were already on this device (a company that
 * arrives whole from the backup is consistent as it is): the balance and
 * status of invoices, bills and credit notes, order progress and stock.
 */
async function settleMerged(added: Record<DataTable, Rows>, before: Set<string>): Promise<void> {
  const known = (r: Record<string, unknown>) => before.has(String(r.companyId));
  const documents = new Set<ID>();
  for (const doc of added.documents) if (known(doc)) documents.add(String(doc.id));
  for (const payment of added.payments as unknown as Payment[]) {
    if (!before.has(payment.companyId)) continue;
    for (const id of payment.documentIds ?? []) documents.add(id);
    for (const allocation of payment.allocations ?? []) documents.add(allocation.documentId);
    if (payment.creditId) documents.add(payment.creditId);
  }
  if (documents.size) {
    await recalculateDocuments(documents);
    await refreshOrdersFor(documents);
  }
  const stock = new Set<ID>();
  for (const table of STOCK_TABLES) {
    for (const r of added[table]) if (known(r)) stock.add(String(r.companyId));
  }
  for (const companyId of stock) {
    if (await keepsStock(companyId)) await rebuildStock(companyId);
  }
}

/** Whether the company has stock to keep in step (stock items or movements). */
async function keepsStock(companyId: ID): Promise<boolean> {
  if ((await db.stockMovements.where('companyId').equals(companyId).count()) > 0) return true;
  return (
    (await db.products
      .where('companyId')
      .equals(companyId)
      .filter((p) => p.kind === 'stock')
      .count()) > 0
  );
}

export async function markBackedUp(): Promise<void> {
  await setMeta(LAST_BACKUP_KEY, new Date().toISOString());
}

/**
 * Removes every record (all companies) from this browser. Companies kept in
 * the cloud stay there; this device just stops syncing them. Refused while
 * changes have not reached the cloud yet (UnsentChangesError), unless
 * `force` is given after the person agreed to lose them.
 */
export async function wipeAllData({ force = false }: { force?: boolean } = {}): Promise<void> {
  await db.transaction(
    'rw',
    [...DATA_TABLES.map((t) => db[t]), ...SYNC_TABLES(), db.meta],
    async () => {
      await assertNothingUnsent(undefined, force);
      for (const table of SYNC_TABLES()) await table.clear();
      for (const table of DATA_TABLES) await db[table].clear();
      await db.meta.clear();
    },
  );
}
