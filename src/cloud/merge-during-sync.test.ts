/**
 * Merging a backup while a company is still coming down from the cloud must
 * never send the backup's older records over the cloud's newer ones.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, setupCompany } from '@/db/records';
import { draftDocument, saveDocument } from '@/db/documents';
import { exportBackup, importBackup } from '@/db/backup';
import type { Company, InvoiceDocument } from '@/db/types';
import { FakeCloud } from './testing/fake-cloud';
import { syncLockName, withAllSyncLocks, withLock } from './lock';
import { startDownload, startUpload, syncCompany, type SyncContext } from './sync';

const OWNER = 'user-owner';
let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  ctx = { api: server.client(OWNER), userId: OWNER };
});

async function uploaded(): Promise<{ company: Company; invoice: InvoiceDocument }> {
  const company = await setupCompany({ name: 'Test Trading Co' });
  const client = await saveClient(createClient(company.id, { name: 'Test Hotel' }));
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice: 100 };
  const invoice = await saveDocument({ ...draft, status: 'sent' });
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return { company: (await db.companies.get(company.id))!, invoice };
}

async function scenario(stopFirst: boolean, options?: { stop?: boolean }) {
  const { company } = await uploaded();
  const client = (await db.clients.where('companyId').equals(company.id).first())!;
  // A backup of the company, made now.
  const backup = await exportBackup(company.id);
  // Later another device changes the client in the cloud.
  const remote = server.record(company.id, 'clients', client.id)!;
  await server
    .client(OWNER)
    .pushRecords(company.id, [
      { tbl: 'clients', id: client.id, data: { ...remote, phone: '+965 2222 0000' } },
    ]);
  // A new device downloads the company; the cloud is slow to answer.
  await db.delete();
  await db.open();
  const fresh: SyncContext = { api: server.client(OWNER), userId: OWNER };
  await startDownload({ id: company.id, name: company.name, role: 'owner' }, fresh);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const api = fresh.api;
  const slow: SyncContext = {
    ...fresh,
    api: {
      ...api,
      pullRecords: async (id, since, limit) => {
        await gate;
        return api.pullRecords(id, since, limit);
      },
    },
  };
  // The sync manager holds the sync lock while it syncs.
  const sync = withLock(syncLockName(company.id), () => syncCompany(company.id, slow));
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Before d2cb9eb the merge waited for the sync holding the lock to finish.
  if (!stopFirst) {
    release();
    await sync;
  }
  // Settings → Data → merge a backup; the cloud answers 50 ms later.
  const merge = withAllSyncLocks(() => importBackup(backup, 'merge'), options).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  const outcome = await sync;
  const refused = await merge;
  // The app keeps syncing.
  await syncCompany(company.id, fresh);
  await syncCompany(company.id, fresh);
  return {
    refused,
    stopped: Boolean(outcome.stopped),
    cloudPhone: server.record(company.id, 'clients', client.id)?.phone,
    localPhone: (await db.clients.get(client.id))?.phone,
  };
}

describe('merge restore while a company is downloading', () => {
  it('after the download, keeps the cloud’s newer client', async () => {
    expect(await scenario(false)).toMatchObject({
      refused: null,
      stopped: false,
      cloudPhone: '+965 2222 0000',
      localPhone: '+965 2222 0000',
    });
  });

  it('during the download, waits for it (as Settings → Data does) and keeps the cloud’s newer client', async () => {
    expect(await scenario(true, { stop: false })).toMatchObject({
      refused: null,
      stopped: false,
      cloudPhone: '+965 2222 0000',
      localPhone: '+965 2222 0000',
    });
  });

  it('is refused for a company whose download stopped before it finished', async () => {
    const outcome = await scenario(true);
    expect(outcome.stopped).toBe(true);
    expect(outcome.refused).toMatch(/is still coming down from the cloud/);
    expect(outcome.cloudPhone).toBe('+965 2222 0000');
    expect(outcome.localPhone).toBe('+965 2222 0000');
  });
});
