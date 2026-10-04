import { z } from 'zod';
import { db, DATA_TABLES, setMeta, getMeta, type DataTable } from './db';
import { CURRENT_COMPANY_KEY } from './records';
import { seedMissingCharts } from './chart-setup';
import type { Company, ID } from './types';
import { APP_NAME } from '@/lib/brand';
import { t } from '@/i18n';

export const BACKUP_FORMAT = 1;
export const LAST_BACKUP_KEY = 'lastBackupAt';

export type BackupData = Record<DataTable, Record<string, unknown>[]>;

export interface Backup {
  /** Written as the app name. Files are recognised by their structure, so
   * backups from earlier builds restore whatever they were labelled. */
  app: string;
  format: number;
  exportedAt: string;
  data: BackupData;
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
});

export class BackupError extends Error {}

/** Exports all data, or a single company with everything that belongs to it. */
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
  return {
    app: APP_NAME,
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function backupFileName(company?: Pick<Company, 'name'>): string {
  const stamp = new Date().toISOString().slice(0, 10);
  // Letters and digits only, so the name saves the same everywhere.
  const slug = (company?.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${APP_NAME}-backup${slug ? `-${slug}` : ''}-${stamp}.json`;
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
      t('This file is not an {app} backup, or it is damaged.', { app: APP_NAME }),
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

/**
 * Restores a backup. "replace" wipes existing data first; "merge" keeps it and
 * overwrites records with the same id. `sanitizeLogo` lets the caller
 * re-encode images (it must return a safe data URL or null).
 */
export async function importBackup(
  backup: Backup,
  mode: 'replace' | 'merge',
  sanitizeLogo?: (logo: string) => Promise<string | null>,
): Promise<void> {
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
  await db.transaction('rw', [...DATA_TABLES.map((t) => db[t]), db.meta], async () => {
    if (mode === 'replace') {
      for (const table of DATA_TABLES) await db[table].clear();
    }
    for (const table of DATA_TABLES) {
      const rows = backup.data[table];
      // Dexie's typing is per table; the rows were validated above.
      if (rows.length)
        await (db[table] as unknown as { bulkPut: (r: unknown[]) => Promise<unknown> }).bulkPut(
          rows,
        );
    }
    // Backups made before accounting existed have no chart of accounts.
    await seedMissingCharts(db);
    const current = await getMeta<string | null>(CURRENT_COMPANY_KEY, null);
    const exists = current ? await db.companies.get(current) : undefined;
    if (!exists && companies[0]) await setMeta(CURRENT_COMPANY_KEY, companies[0].id);
  });
}

export async function markBackedUp(): Promise<void> {
  await setMeta(LAST_BACKUP_KEY, new Date().toISOString());
}

/** Removes every record (all companies) from this browser. */
export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', [...DATA_TABLES.map((t) => db[t]), db.meta], async () => {
    for (const table of DATA_TABLES) await db[table].clear();
    await db.meta.clear();
  });
}
