import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import {
  exportBackup,
  fetchMissingFiles,
  filesNotHere,
  importBackup,
  parseBackup,
  restoreImpact,
} from './backup';
import { saveClient, setupCompany, UnsentChangesError } from './records';
import { draftDocument, saveDocument } from './documents';
import { createPayment, savePayment } from './payments';
import { addAttachment, createExpense, deleteExpense, saveExpense } from './purchases';
import type { Company } from './types';
import { FakeCloud } from '@/cloud/testing/fake-cloud';
import {
  downloadMissingFiles,
  fetchAttachmentContent,
  startDownload,
  startUpload,
  syncCompany,
  type SyncContext,
} from '@/cloud/sync';
import { EAGER_DOWNLOAD_BYTES } from '@/cloud/files';
import { attachmentContent } from '@/cloud/attachments';

/**
 * Backups and restores that keep every file and every newer record.
 * Made-up data only.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const OWNER = 'user-owner';

async function companyWithInvoice() {
  const company = await setupCompany({ name: 'Review Trading' });
  const client = await saveClient(createClient(company.id, { name: 'Made-up Client' }));
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice: 100 };
  const invoice = await saveDocument({ ...draft, status: 'sent' });
  return { company: (await db.companies.get(company.id))!, invoice };
}

/**
 * A company kept in the cloud with a scanned contract of about 2 MB, then
 * opened on a second device (an office laptop) the way CloudManager does:
 * downloaded, synced, small files fetched. The scan stays in the cloud.
 */
async function laptopWithLargeScan() {
  const server = new FakeCloud();
  let ctx: SyncContext = { api: server.client(OWNER), userId: OWNER };
  const { company, invoice } = await companyWithInvoice();
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  const content = `data:application/pdf;base64,${'QUJD'.repeat(560_000)}`;
  const file = await addAttachment(company.id, invoice.id, {
    name: 'contract.pdf',
    type: 'application/pdf',
    dataUrl: content,
  });
  expect(file.size).toBeGreaterThan(EAGER_DOWNLOAD_BYTES);
  await syncCompany(company.id, ctx);

  await db.delete();
  await db.open();
  ctx = { api: server.client(OWNER), userId: OWNER };
  await startDownload({ id: company.id, name: company.name, role: 'owner' }, ctx);
  await syncCompany(company.id, ctx);
  await downloadMissingFiles(company.id, ctx, EAGER_DOWNLOAD_BYTES);
  expect((await filesNotHere(company.id)).map((f) => f.id)).toEqual([file.id]);
  return { server, ctx, company, file, content };
}

describe('backing up a company kept in the cloud', () => {
  it('brings the files that are only in the cloud first, so the backup holds them', async () => {
    const { ctx, company, file, content } = await laptopWithLargeScan();
    const progress: string[] = [];
    const { total, failed } = await fetchMissingFiles(
      company.id,
      (f) => fetchAttachmentContent(f, ctx),
      (done, of) => progress.push(`${done}/${of}`),
    );
    expect({ total, failed }).toEqual({ total: 1, failed: [] });
    expect(progress).toEqual(['0/1', '1/1']);

    const backup = parseBackup(JSON.stringify(await exportBackup(company.id)));
    const saved = backup.data.attachments.find((a) => a.id === file.id);
    expect(String(saved?.dataUrl ?? '').length).toBe(content.length);
    expect(backup.missingFiles).toBeUndefined();

    // The backup opens its files on a device that has no cloud.
    await db.delete();
    await db.open();
    await importBackup(backup, 'replace');
    const opened = await attachmentContent(file.id);
    expect(opened.dataUrl.length).toBe(content.length);
  });

  it('lists the files it could not bring, offline', async () => {
    const { server, ctx, company, file } = await laptopWithLargeScan();
    server.offline = true;
    const { failed } = await fetchMissingFiles(company.id, (f) => fetchAttachmentContent(f, ctx));
    expect(failed.map((f) => f.id)).toEqual([file.id]);
    // Backed up without it (the person agreed): the backup says which file is missing.
    const backup = parseBackup(JSON.stringify(await exportBackup(company.id)));
    expect(backup.missingFiles).toEqual([
      expect.objectContaining({ id: file.id, companyId: company.id, name: 'contract.pdf' }),
    ]);
  });
});

describe('merging an older backup', () => {
  it('keeps an invoice paid after the backup was made', async () => {
    const { company, invoice } = await companyWithInvoice();
    // Backup on Monday.
    const monday = JSON.stringify(await exportBackup(company.id));
    // Tuesday: the customer pays the invoice in full.
    await savePayment(
      createPayment(company.id, {
        clientId: invoice.clientId,
        amount: 100,
        currency: company.currency,
        date: invoice.issueDate,
        allocations: [{ documentId: invoice.id, amount: 100 }],
        documentIds: [invoice.id],
      }),
    );
    expect((await db.documents.get(invoice.id))?.status).toBe('paid');
    // Wednesday: an expense was deleted by mistake, so Monday's backup is merged.
    await importBackup(parseBackup(monday), 'merge');

    const payments = await db.payments.where('documentIds').equals(invoice.id).toArray();
    expect(payments).toHaveLength(1);
    const after = (await db.documents.get(invoice.id))!;
    expect({ status: after.status, balance: after.totals.balance }).toEqual({
      status: 'paid',
      balance: 0,
    });
  });

  it('brings back what was deleted here, keeps what changed, and settles the balances', async () => {
    const { company, invoice } = await companyWithInvoice();
    const category = (await db.accounts.where('companyId').equals(company.id).toArray()).find(
      (a) => a.type === 'expense',
    )!;
    const expense = await saveExpense(
      createExpense(company.id, {
        amount: 12.5,
        accountId: category.id,
        description: 'Made-up taxi fare',
      }),
    );
    // A payment recorded on Monday, then the backup.
    const payment = await savePayment(
      createPayment(company.id, {
        clientId: invoice.clientId,
        amount: 40,
        currency: company.currency,
        date: invoice.issueDate,
        allocations: [{ documentId: invoice.id, amount: 40 }],
        documentIds: [invoice.id],
      }),
    );
    const monday = JSON.stringify(await exportBackup(company.id));
    // Tuesday: the invoice gets a note, the expense and the payment are deleted by mistake.
    await saveDocument({ ...(await db.documents.get(invoice.id))!, notes: 'Updated on Tuesday' });
    await deleteExpense(expense.id);
    await db.payments.delete(payment.id);
    await db.documents.update(invoice.id, { totals: { ...invoice.totals, paid: 0, balance: 100 } });

    const result = await importBackup(parseBackup(monday), 'merge');
    expect(result.added).toBeGreaterThanOrEqual(2);
    expect(result.kept).toBeGreaterThan(0);
    expect(await db.expenses.get(expense.id)).toMatchObject({ description: 'Made-up taxi fare' });
    const after = (await db.documents.get(invoice.id))!;
    // Tuesday's note stays; the payment that came back counts again.
    expect(after.notes).toBe('Updated on Tuesday');
    expect({ paid: after.totals.paid, balance: after.totals.balance }).toEqual({
      paid: 40,
      balance: 60,
    });
  });

  it('does not send Monday’s versions to the cloud over newer data', async () => {
    const server = new FakeCloud();
    const ctx = { api: server.client(OWNER), userId: OWNER };
    const { company, invoice } = await companyWithInvoice();
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    const monday = JSON.stringify(await exportBackup(company.id));
    await saveDocument({ ...(await db.documents.get(invoice.id))!, notes: 'Updated on Tuesday' });
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'documents', invoice.id)?.notes).toBe('Updated on Tuesday');

    await importBackup(parseBackup(monday), 'merge');
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'documents', invoice.id)?.notes).toBe('Updated on Tuesday');
  });
});

describe('Replace on a device that has the company in the cloud', () => {
  async function inTheCloud(): Promise<{ server: FakeCloud; ctx: SyncContext; company: Company }> {
    const server = new FakeCloud();
    const ctx = { api: server.client(OWNER), userId: OWNER };
    const { company } = await companyWithInvoice();
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    return { server, ctx, company };
  }

  it('says beforehand which companies become copies on this device only', async () => {
    const { company } = await inTheCloud();
    const backup = parseBackup(JSON.stringify(await exportBackup(company.id)));
    const impact = await restoreImpact(backup);
    expect(impact).toMatchObject({ unsent: 0, inCloud: [{ id: company.id }] });
    await importBackup(backup, 'replace');
    // As the dialog said: a copy here only, the cloud copy untouched.
    expect(await db.syncState.get(company.id)).toBeUndefined();
  });

  it('refuses while changes have not reached the cloud, until the person agrees', async () => {
    const { server, ctx, company } = await inTheCloud();
    const backup = parseBackup(JSON.stringify(await exportBackup(company.id)));
    server.offline = true;
    await saveClient(createClient(company.id, { name: 'Added offline' }));
    await expect(syncCompany(company.id, ctx)).rejects.toBeDefined();
    expect((await restoreImpact(backup)).unsent).toBeGreaterThan(0);

    await expect(importBackup(backup, 'replace')).rejects.toBeInstanceOf(UnsentChangesError);
    // Nothing was touched.
    expect(await db.syncState.get(company.id)).toBeDefined();
    expect(await db.clients.where('name').equals('Added offline').count()).toBe(1);

    await importBackup(backup, 'replace', undefined, { force: true });
    expect(await db.clients.where('name').equals('Added offline').count()).toBe(0);
  });
});
