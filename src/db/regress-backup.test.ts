import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, setupCompany } from '@/db/records';
import { draftDocument, saveDocument } from '@/db/documents';
import type { Company, InvoiceDocument } from '@/db/types';
import { FakeCloud } from '@/cloud/testing/fake-cloud';
import { startDownload, startUpload, syncCompany, type SyncContext } from '@/cloud/sync';

/**
 * Regression found by the second review (copied from its
 * src/cloud/regress-review.test.ts, made-up data only).
 */

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
  const company = await setupCompany({ name: 'Al Mail Trading' });
  const client = await saveClient(createClient(company.id, { name: 'Gulf Pearl Hotel' }));
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Installation', quantity: 2, unitPrice: 150.25 };
  const invoice = await saveDocument({ ...draft, status: 'sent' });
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return { company: (await db.companies.get(company.id))!, invoice };
}

describe('merging a backup into a device that keeps a file only in the cloud', () => {
  const PDF = `data:application/pdf;base64,${'QUJD'.repeat(500_000)}`;

  it('brings back the file content the backup holds', async () => {
    const { company, invoice } = await uploaded();
    const { addAttachment } = await import('@/db/purchases');
    const { exportBackup, importBackup, parseBackup } = await import('@/db/backup');
    const scan = await addAttachment(company.id, invoice.id, {
      name: 'contract.pdf',
      type: 'application/pdf',
      dataUrl: PDF,
    });
    await syncCompany(company.id, ctx);
    // Backed up on this device, with the scan's content.
    const backup = parseBackup(JSON.stringify(await exportBackup(company.id)));
    // A second device (a laptop) has the scan's record, its content left in the cloud.
    await db.delete();
    await db.open();
    await startDownload({ id: company.id, name: company.name, role: 'owner' }, ctx);
    await syncCompany(company.id, ctx);
    expect((await db.attachments.get(scan.id))?.dataUrl).toBe('');
    // The file is gone from the cloud (a "Delete company" that stopped after the files).
    server.files.clear();
    await importBackup(backup, 'merge');
    expect((await db.attachments.get(scan.id))?.dataUrl.length).toBe(PDF.length);
  });
});
