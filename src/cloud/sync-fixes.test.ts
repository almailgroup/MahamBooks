import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createClient, createProduct } from '@/db/defaults';
import { deleteCompany, saveClient, saveCompany, setupCompany } from '@/db/records';
import { draftDocument, isNumberTaken, saveDocument } from '@/db/documents';
import { addAttachment } from '@/db/purchases';
import { createPayment, newCheque, savePayment } from '@/db/payments';
import { recordChequePrinted } from '@/db/cheque-print';
import { saveItem } from '@/db/inventory';
import { addProductImages } from '@/db/product-images';
import { createEmployee, saveEmployee } from '@/db/people';
import { exportBackup, importBackup, wipeAllData } from '@/db/backup';
import {
  createComplianceDocument,
  deleteComplianceDocument,
  saveComplianceDocument,
} from '@/db/renewals';
import type { Company, InvoiceDocument } from '@/db/types';
import { setCounterReserver } from '@/lib/numbering';
import { today } from '@/lib/dates';
import { printRefusal } from '@/lib/cheque-print';
import { storageCloudError } from './api';
import { downloadAccountCompanies } from './auto-download';
import { FakeCloud } from './testing/fake-cloud';
import { companySettingLabels } from './labels';
import { withLock, withSyncLock } from './lock';
import { failedFileRemovals, numberProblems } from './problems';
import { cloudCounterReserver } from './reserve';
import {
  applyRole,
  applyRows,
  deleteFromCloud,
  discardParked,
  parkedEntries,
  retryFileRemovals,
  retryParked,
  startDownload,
  startUpload,
  syncCompany,
  type SyncContext,
} from './sync';

/**
 * Regressions found in the review of cloud sync: two devices, two tabs, role
 * changes and deletes. Devices other than "this one" are played by pushing to
 * the fake server what that device would send.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  ctx = { api: server.client(OWNER), userId: OWNER };
});

afterEach(() => setCounterReserver(null));

async function newDevice(userId = OWNER): Promise<SyncContext> {
  await db.delete();
  await db.open();
  return { api: server.client(userId), userId };
}

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

/** Issues an invoice on this device. */
async function issueInvoice(companyId: string): Promise<InvoiceDocument> {
  const company = (await db.companies.get(companyId))!;
  const client = (await db.clients.where('companyId').equals(companyId).first())!;
  const draft = await draftDocument(company, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice: 10 };
  return saveDocument({ ...draft, status: 'sent' });
}

/** Another device of the team changes the company record. */
async function otherDeviceChangesCompany(companyId: string, patch: Record<string, unknown>) {
  const remote = server.record(companyId, 'companies', companyId)!;
  await server
    .client(OWNER)
    .pushRecords(companyId, [{ tbl: 'companies', id: companyId, data: { ...remote, ...patch } }]);
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('removing a company from this device', () => {
  it('never deletes records in the cloud, even while a sync is under way', async () => {
    const { company, invoice } = await uploaded();
    const client = (await db.clients.where('companyId').equals(company.id).first())!;
    await addAttachment(company.id, invoice.id, { name: 'r.png', type: 'image/png', dataUrl: PNG });
    await saveClient({ ...client, phone: '+965 9999 0000' });
    await saveDocument({ ...invoice, notes: 'Delivered' });
    // While the receipt uploads, the company is removed from this device.
    const api = ctx.api;
    ctx = {
      ...ctx,
      api: {
        ...api,
        uploadFile: async (path, blob, type) => {
          // The person confirmed losing the changes not sent yet.
          await deleteCompany(company.id, { force: true });
          return api.uploadFile(path, blob, type);
        },
      },
    };
    await syncCompany(company.id, ctx).catch(() => undefined);
    // A record gone without a delete is dropped from the outbox, never sent as one.
    expect(server.record(company.id, 'clients', client.id)).toBeDefined();
    expect(server.record(company.id, 'documents', invoice.id)).toBeDefined();
    expect(server.markers.size).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('waits for a sync under way to finish', async () => {
    const { company } = await uploaded();
    const client = (await db.clients.where('companyId').equals(company.id).first())!;
    await saveClient({ ...client, phone: '+965 9999 0000' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = ctx.api;
    ctx = {
      ...ctx,
      api: {
        ...api,
        pushRecords: async (id, changes) => {
          await gate;
          return api.pushRecords(id, changes);
        },
      },
    };
    const order: string[] = [];
    const sync = withSyncLock(company.id, async () => {
      await syncCompany(company.id, ctx);
      order.push('synced');
    });
    await settle();
    const removal = withSyncLock(company.id, async () => {
      await deleteCompany(company.id);
      order.push('removed');
    });
    await settle();
    expect(order).toEqual([]);
    release();
    await Promise.all([sync, removal]);
    expect(order).toEqual(['synced', 'removed']);
    expect(server.record(company.id, 'clients', client.id)?.phone).toBe('+965 9999 0000');
    expect(await db.companies.get(company.id)).toBeUndefined();
  });

  it('goes ahead when the sync under way waits for an answer that never comes', async () => {
    const { company } = await uploaded();
    // A request that never answers (a dead connection after a network change).
    const api = ctx.api;
    ctx = { ...ctx, api: { ...api, pullRecords: () => new Promise<never>(() => undefined) } };
    const sync = withSyncLock(company.id, () => syncCompany(company.id, ctx));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // "Remove from this device", with nothing left to send.
    const removal = withSyncLock(company.id, () => deleteCompany(company.id));
    const outcome = await Promise.race([
      removal.then(() => 'removed'),
      new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2000)),
    ]);
    expect(outcome).toBe('removed');
    // The sync stopped quietly: not a problem to show.
    await expect(sync).resolves.toMatchObject({ stopped: true });
    expect(await db.companies.get(company.id)).toBeUndefined();
  });

  it('gives up waiting with a message when a sync keeps the lock (another tab’s)', async () => {
    const name = 'almailbooks-sync-test';
    let release!: () => void;
    const held = withLock(name, () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ran: string[] = [];
    await expect(withLock(name, async () => void ran.push('impatient'), 50)).rejects.toMatchObject({
      message: 'A sync is still running. Try again in a moment.',
    });
    // Whoever waits without a limit still waits for the sync, then runs.
    const patient = withLock(name, async () => void ran.push('patient'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toEqual([]);
    release();
    await Promise.all([held, patient]);
    expect(ran).toEqual(['patient']);
  });
});

describe('a request of a sync that never answers', () => {
  it('is given up, and nothing is lost', async () => {
    const { company } = await uploaded();
    const client = (await db.clients.where('companyId').equals(company.id).first())!;
    await saveClient({ ...client, phone: '+965 9999 0000' });
    const api = ctx.api;
    const stuck: SyncContext = {
      ...ctx,
      timeoutMs: 50,
      api: { ...api, pushRecords: () => new Promise<never>(() => undefined) },
    };
    await expect(syncCompany(company.id, stuck)).rejects.toMatchObject({ code: 'server' });
    expect((await db.syncState.get(company.id))?.lastError).toBe('server');
    // The change goes with the next sync.
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'clients', client.id)?.phone).toBe('+965 9999 0000');
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('a file the cloud refuses', () => {
  it('is parked with its reason, and the sync goes on (a viewer with a receipt to send)', async () => {
    const { company, invoice } = await uploaded();
    const receipt = await addAttachment(company.id, invoice.id, {
      name: 'r.png',
      type: 'image/png',
      dataUrl: PNG,
    });
    server.addMember(company.id, 'user-boss', 'owner');
    server.addMember(company.id, OWNER, 'viewer');
    await applyRole(company.id, 'viewer');
    await server.client('user-boss').pushRecords(company.id, [
      {
        tbl: 'products',
        id: 'p-later',
        data: { id: 'p-later', companyId: company.id, name: 'Later', unitPrice: 1 },
      },
    ]);
    const result = await syncCompany(company.id, ctx);
    expect(result.parked).toBe(1);
    expect(await db.products.get('p-later')).toBeDefined();
    const parked = await db.outbox.where('[companyId+parked]').equals([company.id, 1]).toArray();
    expect(parked).toEqual([
      expect.objectContaining({
        table: 'attachments',
        id: receipt.id,
        error: 'permission',
        file: 1,
      }),
    ]);
    // A viewer can never send it: not tried again by itself, for ever.
    expect(parked[0].retryAt).toBeUndefined();
    const uploads = server.calls.filter((call) => call.endsWith('uploadFile')).length;
    await syncCompany(company.id, ctx);
    expect(server.calls.filter((call) => call.endsWith('uploadFile')).length).toBe(uploads);
  });

  describe('while the owner deletes the company (uploads refused for an hour)', () => {
    async function receiptDuringDeletion() {
      const { company, invoice } = await uploaded();
      // The owner starts "Delete company" on another device; it stops half
      // way (connection lost), and the owner decides to keep the company.
      await server.client(OWNER).beginDeleteCompany(company.id);
      // Meanwhile a receipt is added here and synced.
      const receipt = await addAttachment(company.id, invoice.id, {
        name: 'receipt.png',
        type: 'image/png',
        dataUrl: PNG,
      });
      await syncCompany(company.id, ctx);
      return { company, receipt };
    }

    it('is sent by itself once the cloud takes files again', async () => {
      const { company, receipt } = await receiptDuringDeletion();
      expect(await parkedEntries(company.id)).toEqual([
        expect.objectContaining({ id: receipt.id, file: 1, error: 'permission' }),
      ]);
      // An hour later uploads are allowed again; the app keeps syncing.
      server.companies.get(company.id)!.deletingUntil = 0;
      await syncCompany(company.id, ctx);
      await syncCompany(company.id, ctx);
      expect({
        record: Boolean(server.record(company.id, 'attachments', receipt.id)),
        file: server.files.has(`${company.id}/${receipt.id}`),
        parked: (await parkedEntries(company.id)).length,
      }).toEqual({ record: true, file: true, parked: 0 });
    });

    it('is tried again less and less often while it is refused, and shown meanwhile', async () => {
      const { company } = await receiptDuringDeletion();
      const uploads = () => server.calls.filter((call) => call.endsWith('uploadFile')).length;
      expect(uploads()).toBe(1);
      // Tried again at the next sync, then after a pause.
      await syncCompany(company.id, ctx);
      expect(uploads()).toBe(2);
      await syncCompany(company.id, ctx);
      expect(uploads()).toBe(2);
      const [entry] = await parkedEntries(company.id);
      expect(entry).toMatchObject({ file: 1, error: 'permission', attempts: 2 });
      expect(entry.retryAt).toBeGreaterThan(Date.now() + 30_000);
      // "Try again" doesn't wait.
      await retryParked(company.id);
      await syncCompany(company.id, ctx);
      expect(uploads()).toBe(3);
    });

    it('“Undo my change” deletes the receipt the cloud never had only once agreed', async () => {
      const { company, receipt } = await receiptDuringDeletion();
      const [entry] = await parkedEntries(company.id);
      expect(await discardParked(company.id, entry, ctx)).toBe('not_in_cloud');
      expect(await db.attachments.get(receipt.id)).toBeDefined();
      expect(await parkedEntries(company.id)).toHaveLength(1);
      expect(await discardParked(company.id, entry, ctx, { deleteNew: true })).toBe('undone');
      expect(await db.attachments.get(receipt.id)).toBeUndefined();
      expect(await db.outbox.where('[table+id]').equals(['attachments', receipt.id]).count()).toBe(
        0,
      );
    });
  });

  it('is not retried as it is when Storage says no (4xx); network trouble is', () => {
    const code = (error: unknown) => storageCloudError(error).code;
    expect(
      code({
        status: 400,
        statusCode: '403',
        message: 'new row violates row-level security policy',
      }),
    ).toBe('permission');
    expect(code({ status: 413, statusCode: '413', message: 'Payload too large' })).toBe(
      'too_large',
    );
    expect(
      code({ status: 400, statusCode: '415', message: 'mime type text/html is not supported' }),
    ).toBe('invalid');
    expect(code({ status: 400, statusCode: '404', message: 'Object not found' })).toBe('invalid');
    expect(code({ status: 400, statusCode: 'InvalidJWT', message: 'jwt expired' })).toBe('auth');
    expect(code({ status: 503, statusCode: '503', message: 'Service unavailable' })).toBe('server');
    expect(code({ status: 429, statusCode: '429', message: 'Too many requests' })).toBe('server');
    expect(code(new TypeError('Failed to fetch'))).toBe('offline');
    expect(storageCloudError({ status: 400, statusCode: '403' }).retryable).toBe(false);
  });
});

describe('the company record', () => {
  it('keeps a settings change made on another device when this one numbers a document', async () => {
    const { company } = await uploaded();
    const accounting = server.record(company.id, 'companies', company.id)!.accounting as object;
    await otherDeviceChangesCompany(company.id, {
      phone: '+965 2222 0000',
      accounting: { ...accounting, lockDate: '2026-09-30' },
    });
    server.offline = true;
    const mine = await issueInvoice(company.id);
    server.offline = false;
    const result = await syncCompany(company.id, ctx);
    const cloud = server.record(company.id, 'companies', company.id)!;
    expect(cloud.phone).toBe('+965 2222 0000');
    expect((cloud.accounting as { lockDate: string | null }).lockDate).toBe('2026-09-30');
    // This device's counter went up with it.
    expect((cloud.numbering as Company['numbering']).invoice.next).toBe(
      (await db.companies.get(company.id))!.numbering.invoice.next,
    );
    const local = (await db.companies.get(company.id))!;
    expect(local.phone).toBe('+965 2222 0000');
    expect(local.accounting?.lockDate).toBe('2026-09-30');
    expect(result.conflicts).toBe(0);
    expect(mine.number).toBeTruthy();
  });

  it('notes the fields both devices changed, keeping this device’s value', async () => {
    const { company } = await uploaded();
    await otherDeviceChangesCompany(company.id, {
      phone: '+965 2222 0000',
      website: 'gulf.example',
    });
    server.offline = true;
    await db.companies.update(company.id, { phone: '+965 3333 0000' });
    server.offline = false;
    const result = await syncCompany(company.id, ctx);
    expect(result.conflicts).toBe(1);
    expect(server.record(company.id, 'companies', company.id)).toMatchObject({
      phone: '+965 3333 0000',
      website: 'gulf.example',
    });
    const [note] = await db.activities.filter((a) => a.action === 'sync_conflict').toArray();
    // Named as Settings names it, in English and in Arabic (not as a field path).
    expect(note).toMatchObject({
      entity: 'company',
      messageVars: { fields: 'Phone' },
      messageVarsAr: { fields: 'الهاتف' },
    });
  });

  it('names changed settings the way Settings does', () => {
    expect(
      companySettingLabels([
        ['phone'],
        ['address', 'line1'],
        ['accounting', 'lockDate'],
        ['numbering', 'invoice', 'pattern'],
        ['numbering', 'quote', 'pattern'],
        ['bankAccount', 'iban'],
        ['somethingNew'],
      ]),
    ).toEqual([
      'Phone',
      'Address',
      'Lock date',
      'Number formats',
      'Bank account',
      'Other settings',
    ]);
  });

  it('lays this device’s unsent changes over a newer copy from the cloud', async () => {
    const { company } = await uploaded();
    const cursor = (await db.syncState.get(company.id))!.cursor;
    await db.companies.update(company.id, { website: 'almail.example' });
    await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
    await applyRows(company.id, await ctx.api.pullRecords(company.id, cursor, 100));
    expect(await db.companies.get(company.id)).toMatchObject({
      website: 'almail.example',
      phone: '+965 2222 0000',
    });
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'companies', company.id)).toMatchObject({
      website: 'almail.example',
      phone: '+965 2222 0000',
    });
  });

  it('lets staff number documents after the owner changed the company details', async () => {
    const { company } = await uploaded();
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
    await issueInvoice(company.id);
    const result = await syncCompany(company.id, staff);
    expect(result.parked).toBe(0);
    expect((await db.companies.get(company.id))?.phone).toBe('+965 2222 0000');
    const cloud = server.record(company.id, 'companies', company.id)!
      .numbering as Company['numbering'];
    expect(cloud.invoice.next).toBe((await db.companies.get(company.id))!.numbering.invoice.next);
  });

  it('gets staff unstuck on a device synced by the previous version (no base copy)', async () => {
    const { company } = await uploaded();
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    // The previous version kept no base copy of the company record.
    await db.syncRevs.update(['companies', company.id], { base: undefined });
    await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
    await issueInvoice(company.id);
    // Sent whole, refused (an older copy), then laid over the cloud's copy and sent again.
    await syncCompany(company.id, staff);
    await syncCompany(company.id, staff);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.companies.get(company.id))?.phone).toBe('+965 2222 0000');
    const cloud = server.record(company.id, 'companies', company.id)!
      .numbering as Company['numbering'];
    expect(cloud.invoice.next).toBe((await db.companies.get(company.id))!.numbering.invoice.next);
  });

  describe('on a server without the new functions', () => {
    it('is laid over the copy the cloud has, so others’ changes stay', async () => {
      const { company } = await uploaded();
      server.legacy = true;
      await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
      server.offline = true;
      await issueInvoice(company.id);
      server.offline = false;
      await syncCompany(company.id, ctx);
      expect(server.record(company.id, 'companies', company.id)?.phone).toBe('+965 2222 0000');
    });

    it('lets staff number documents, never stuck', async () => {
      const { company } = await uploaded();
      server.legacy = true;
      server.addMember(company.id, STAFF, 'staff');
      const staff = await newDevice(STAFF);
      await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
      await syncCompany(company.id, staff);
      await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
      await issueInvoice(company.id);
      expect((await syncCompany(company.id, staff)).parked).toBe(0);
      expect(await db.outbox.count()).toBe(0);
    });

    it('keeps another device’s setting after a push whose pull did not happen', async () => {
      const { company } = await uploaded();
      server.legacy = true;
      await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
      // This device changes the website; the push goes through, the pull doesn't.
      await db.companies.update(company.id, { website: 'almail.example' });
      server.failNext('pullRecords', 'offline');
      await expect(syncCompany(company.id, ctx)).rejects.toMatchObject({ code: 'offline' });
      expect(server.record(company.id, 'companies', company.id)).toMatchObject({
        phone: '+965 2222 0000',
        website: 'almail.example',
      });
      // Before the next sync this device changes another field.
      await db.companies.update(company.id, { email: 'accounts@almail.example' });
      await syncCompany(company.id, ctx);
      expect(server.record(company.id, 'companies', company.id)).toMatchObject({
        email: 'accounts@almail.example',
        website: 'almail.example',
        phone: '+965 2222 0000',
      });
      expect((await db.companies.get(company.id))?.phone).toBe('+965 2222 0000');
    });

    it('keeps another device’s setting when a document is numbered here during the sync', async () => {
      const { company } = await uploaded();
      server.legacy = true;
      await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
      await db.companies.update(company.id, { website: 'almail.example' });
      // While the sync brings in the cloud's changes, an invoice is numbered
      // here (the counter on the company record goes up).
      const api = ctx.api;
      let once = false;
      ctx = {
        ...ctx,
        api: {
          ...api,
          pullRecords: async (id, since, limit) => {
            if (!once) {
              once = true;
              const local = (await db.companies.get(company.id))!;
              await db.companies.put({
                ...local,
                numbering: {
                  ...local.numbering,
                  invoice: { ...local.numbering.invoice, next: local.numbering.invoice.next + 1 },
                },
              });
            }
            return api.pullRecords(id, since, limit);
          },
        },
      };
      await syncCompany(company.id, ctx);
      expect(server.record(company.id, 'companies', company.id)).toMatchObject({
        website: 'almail.example',
        phone: '+965 2222 0000',
      });
    });

    it('keeps sending staff counters after a push whose pull did not happen', async () => {
      const { company } = await uploaded();
      server.legacy = true;
      server.addMember(company.id, STAFF, 'staff');
      const staff = await newDevice(STAFF);
      await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
      await syncCompany(company.id, staff);
      // The owner changes the phone number on their device.
      await otherDeviceChangesCompany(company.id, { phone: '+965 2222 0000' });
      // Staff numbers an invoice; the push goes through, the pull doesn't.
      await issueInvoice(company.id);
      server.failNext('pullRecords', 'offline');
      await expect(syncCompany(company.id, staff)).rejects.toMatchObject({ code: 'offline' });
      // Staff numbers another invoice and syncs (twice, to settle).
      await issueInvoice(company.id);
      await syncCompany(company.id, staff);
      await syncCompany(company.id, staff);
      const cloud = server.record(company.id, 'companies', company.id)!;
      expect({
        stuck: await parkedEntries(company.id),
        cloudNext: (cloud.numbering as Company['numbering']).invoice.next,
        phoneHere: (await db.companies.get(company.id))!.phone,
      }).toEqual({
        stuck: [],
        cloudNext: (await db.companies.get(company.id))!.numbering.invoice.next,
        phoneHere: '+965 2222 0000',
      });
    });
  });
});

describe('document numbers', () => {
  it('online, are taken from the cloud’s counter, so two devices never share one', async () => {
    const { company } = await uploaded();
    setCounterReserver(cloudCounterReserver(ctx.api, OWNER));
    // Another device takes the next invoice number a moment before this one.
    const theirs = await server.client(OWNER).reserveNumber(company.id, 'invoice', today(), 1);
    const mine = await issueInvoice(company.id);
    expect(theirs).not.toBeNull();
    expect(mine.number).toContain(String(theirs!.counter + 1).padStart(4, '0'));
  });

  it('are not used up by a save that is refused', async () => {
    const { company, invoice } = await uploaded();
    expect(invoice.number).toBe('INV-2026-0001');
    setCounterReserver(cloudCounterReserver(ctx.api, OWNER));
    // The books are locked up to the end of September.
    const local = (await db.companies.get(company.id))!;
    await db.companies.put({
      ...local,
      accounting: { ...local.accounting!, lockDate: '2026-09-30' },
    });
    await syncCompany(company.id, ctx);
    const client = (await db.clients.where('companyId').equals(company.id).first())!;
    const draft = await draftDocument((await db.companies.get(company.id))!, 'invoice', client);
    draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice: 10 };
    // An invoice dated in the locked period is refused…
    await expect(
      saveDocument({ ...draft, issueDate: '2026-09-15', dueDate: '2026-09-15', status: 'sent' }),
    ).rejects.toThrow();
    // …and the next one takes the number that was not used.
    const next = await saveDocument({ ...draft, id: `${draft.id}-2`, status: 'sent' });
    expect(next.number).toBe('INV-2026-0002');
  });

  it('offline, a duplicate from another device is listed as a problem, and both can be saved', async () => {
    const { company, invoice } = await uploaded();
    server.offline = true;
    const mine = await issueInvoice(company.id);
    server.offline = false;
    const theirs = {
      ...server.record(company.id, 'documents', invoice.id)!,
      id: 'invoice-from-the-other-device',
      number: mine.number,
    };
    await server
      .client(OWNER)
      .pushRecords(company.id, [{ tbl: 'documents', id: theirs.id, data: theirs }]);
    await syncCompany(company.id, ctx);

    const problems = await numberProblems(company.id);
    expect(problems.map((docs) => docs.map((d) => d.id).sort())).toEqual([
      [mine.id, theirs.id].sort(),
    ]);
    // Nothing is renumbered by itself, and saving either again is never refused.
    expect((await db.documents.get(mine.id))?.number).toBe(mine.number);
    await expect(saveDocument({ ...mine, notes: 'Paid by cheque' })).resolves.toBeDefined();
    expect(await isNumberTaken(company.id, 'invoice', mine.number, mine.id)).toBe(false);
    // Giving one a new number clears the problem.
    await saveDocument({ ...(await db.documents.get(mine.id))!, number: 'INV-2026-0900' });
    expect(await numberProblems(company.id)).toEqual([]);
  });
});

describe('deleting a company in the cloud', () => {
  it('removes no file when the person is no longer the owner', async () => {
    const { company, invoice } = await uploaded();
    await addAttachment(company.id, invoice.id, { name: 'r.png', type: 'image/png', dataUrl: PNG });
    await syncCompany(company.id, ctx);
    // Ownership was transferred; this device still shows the person as owner.
    server.addMember(company.id, 'user-new-owner', 'owner');
    server.addMember(company.id, OWNER, 'admin');
    await expect(deleteFromCloud(company.id, ctx)).rejects.toMatchObject({ code: 'permission' });
    expect(server.files.size).toBe(1);
    expect(server.companies.has(company.id)).toBe(true);
    // A server without begin_delete_company: the role is asked for first.
    server.legacy = true;
    await expect(deleteFromCloud(company.id, ctx)).rejects.toMatchObject({ code: 'permission' });
    expect(server.files.size).toBe(1);
  });

  it('stops other members’ uploads while the files go', async () => {
    const { company } = await uploaded();
    server.addMember(company.id, STAFF, 'staff');
    await ctx.api.beginDeleteCompany(company.id);
    await expect(
      server.client(STAFF).uploadFile(`${company.id}/late`, new Blob(['x']), 'image/png'),
    ).rejects.toMatchObject({ code: 'permission' });
    await deleteFromCloud(company.id, ctx);
    expect(server.companies.has(company.id)).toBe(false);
  });
});

describe('keeping a company in the cloud', () => {
  it('never overwrites the team’s newer data with an older copy from this device', async () => {
    const { company } = await uploaded();
    const backup = await exportBackup();
    const id = (await db.clients.where('companyId').equals(company.id).first())!.id;
    const remote = server.record(company.id, 'clients', id)!;
    await server
      .client(OWNER)
      .pushRecords(company.id, [
        { tbl: 'clients', id, data: { ...remote, name: 'Gulf Pearl Hotel – Salmiya' } },
      ]);
    await importBackup(backup, 'replace');
    await expect(startUpload(company.id, ctx)).rejects.toMatchObject({ code: 'company_exists' });
    // The same on a server without the change to create_company.
    server.legacy = true;
    await expect(startUpload(company.id, ctx)).rejects.toMatchObject({ code: 'company_exists' });
    expect(await db.syncState.get(company.id)).toBeUndefined();
    expect(server.record(company.id, 'clients', id)?.name).toBe('Gulf Pearl Hotel – Salmiya');
  });

  it('takes up an empty company of the person’s own (an upload that stopped early)', async () => {
    const company = await setupCompany({ name: 'Al Mail Trading' });
    await ctx.api.createCompany(company.id, company.name);
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'companies', company.id)).toBeDefined();
    // The server refuses it too once it has records.
    await expect(ctx.api.createCompany(company.id, 'Again')).rejects.toMatchObject({
      code: 'company_exists',
    });
  });
});

describe('role changes', () => {
  async function staffDevice() {
    const { company, invoice } = await uploaded();
    await saveEmployee(createEmployee(company.id, { name: 'Rajesh Kumar', basicSalary: 450 }));
    await syncCompany(company.id, ctx);
    // Work goes on after the employee was added (the usual case).
    const client = (await db.clients.where('companyId').equals(company.id).first())!;
    await saveClient({ ...client, phone: '+965 2200 1100' });
    await syncCompany(company.id, ctx);
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    expect(await db.employees.count()).toBe(0);
    return { company, invoice, staff };
  }

  it('a promotion brings in the people data even when a pull is under way', async () => {
    const { company, staff } = await staffDevice();
    await server.client(OWNER).pushRecords(company.id, [
      {
        tbl: 'products',
        id: 'p-new',
        data: { id: 'p-new', companyId: company.id, name: 'New', unitPrice: 1 },
      },
    ]);
    // Made accountant; the device notices while a pull is on its way.
    server.addMember(company.id, STAFF, 'accountant');
    const api = staff.api;
    let noticed = false;
    staff.api = {
      ...api,
      pullRecords: async (id, since, limit) => {
        const rows = await api.pullRecords(id, since, limit);
        if (!noticed) {
          noticed = true;
          await applyRole(company.id, 'accountant');
        }
        return rows;
      },
    };
    await syncCompany(company.id, staff);
    expect(await db.employees.count()).toBe(1);
  });

  it('a demotion leaves no people data, even with a page pulled before it', async () => {
    const ACC = 'user-accountant';
    const { company } = await uploaded();
    server.addMember(company.id, ACC, 'accountant');
    const device = await newDevice(ACC);
    await startDownload({ id: company.id, name: company.name, role: 'accountant' }, device);
    await syncCompany(company.id, device);
    const employee = createEmployee(company.id, { name: 'Rajesh Kumar', basicSalary: 450 });
    await server
      .client(OWNER)
      .pushRecords(company.id, [
        { tbl: 'employees', id: employee.id, data: employee as unknown as Record<string, unknown> },
      ]);
    // Answered as accountant; demoted to staff before the page is stored.
    const api = device.api;
    device.api = {
      ...api,
      pullRecords: async (id, since, limit) => {
        const rows = await api.pullRecords(id, since, limit);
        server.addMember(company.id, ACC, 'staff');
        await applyRole(company.id, 'staff');
        return rows;
      },
    };
    await syncCompany(company.id, device);
    expect(await db.employees.get(employee.id)).toBeUndefined();
  });

  it('a demotion whose clean-up failed is cleaned up next time', async () => {
    const ACC = 'user-accountant';
    const { company } = await uploaded();
    await saveEmployee(createEmployee(company.id, { name: 'Rajesh Kumar', basicSalary: 450 }));
    await syncCompany(company.id, ctx);
    server.addMember(company.id, ACC, 'accountant');
    const device = await newDevice(ACC);
    await startDownload({ id: company.id, name: company.name, role: 'accountant' }, device);
    await syncCompany(company.id, device);
    expect(await db.employees.count()).toBe(1);
    // The clean-up fails (IndexedDB aborts it): the role is not saved either.
    const spy = vi.spyOn(db.syncRevs, 'bulkDelete').mockRejectedValueOnce(new Error('aborted'));
    await expect(applyRole(company.id, 'staff')).rejects.toThrow('aborted');
    spy.mockRestore();
    expect((await db.syncState.get(company.id))?.role).toBe('accountant');
    await applyRole(company.id, 'staff');
    expect(await db.employees.count()).toBe(0);
  });
});

describe('removing files of deleted records', () => {
  async function receiptStillToRemove() {
    const { company, invoice } = await uploaded();
    const file = await addAttachment(company.id, invoice.id, {
      name: 'r.png',
      type: 'image/png',
      dataUrl: PNG,
    });
    await syncCompany(company.id, ctx);
    return { company, file, path: `${company.id}/${file.id}` };
  }

  it('waits for the account that deleted the record', async () => {
    const { company, file, path } = await receiptStillToRemove();
    server.storageDown = true;
    await db.attachments.delete(file.id);
    await syncCompany(company.id, ctx);
    expect(await db.fileQueue.toArray()).toEqual([
      expect.objectContaining({ path, userId: OWNER }),
    ]);
    server.storageDown = false;
    // A colleague signs in on this computer and their own company syncs.
    const OTHER = 'user-other';
    const theirs = await setupCompany({ name: 'Other Co' });
    const other = { api: server.client(OTHER), userId: OTHER };
    await startUpload(theirs.id, other);
    await syncCompany(theirs.id, other);
    expect(await db.fileQueue.count()).toBe(1);
    // Back as the owner: removed.
    await syncCompany(company.id, ctx);
    expect(server.files.has(path)).toBe(false);
    expect(await db.fileQueue.count()).toBe(0);
  });

  it('counts a removal that removed nothing as a failure, retried then shown', async () => {
    const { company, file, path } = await receiptStillToRemove();
    // Storage answers without removing it (its rules hid it from this person).
    const api = ctx.api;
    ctx = { ...ctx, api: { ...api, removeFiles: async () => [] } };
    await db.attachments.delete(file.id);
    await syncCompany(company.id, ctx);
    expect(await db.fileQueue.count()).toBe(1);
    for (let i = 0; i < 4; i++) await syncCompany(company.id, ctx);
    expect(await failedFileRemovals(company.id)).toEqual([
      expect.objectContaining({ path, attempts: 5, failed: 1 }),
    ]);
    // Shown until tried again, with a working Storage this time.
    ctx = { ...ctx, api };
    await retryFileRemovals(company.id);
    await syncCompany(company.id, ctx);
    expect(server.files.has(path)).toBe(false);
    expect(await db.fileQueue.count()).toBe(0);
  });

  it('a removal of a file that is already gone is done', async () => {
    const { company, file, path } = await receiptStillToRemove();
    server.files.delete(path);
    await db.attachments.delete(file.id);
    await syncCompany(company.id, ctx);
    expect(await db.fileQueue.count()).toBe(0);
  });
});

describe('a payment deleted on another device', () => {
  async function paymentWithScan() {
    const { company, invoice } = await uploaded();
    const payment = await savePayment(
      createPayment(company.id, {
        clientId: invoice.clientId,
        amount: 50,
        currency: 'KWD',
        documentIds: [invoice.id],
        allocations: [{ documentId: invoice.id, amount: 50 }],
      }),
    );
    const scan = await addAttachment(company.id, payment.id, {
      name: 'cheque.png',
      type: 'image/png',
      dataUrl: PNG,
    });
    await syncCompany(company.id, ctx);
    const path = `${company.id}/${scan.id}`;
    expect(server.files.has(path)).toBe(true);
    return { company, payment, scan, path };
  }

  it('by an older build, which leaves its scans: they are deleted here and in the cloud', async () => {
    const { company, payment, scan, path } = await paymentWithScan();
    // An older build's deletePayment deletes the payment only.
    const rev = (await db.syncRevs.get(['payments', payment.id]))!.rev;
    await server
      .client(OWNER)
      .pushRecords(company.id, [{ tbl: 'payments', id: payment.id, deleted: true, base_rev: rev }]);
    await syncCompany(company.id, ctx);
    expect(await db.payments.get(payment.id)).toBeUndefined();
    expect(await db.attachments.get(scan.id)).toBeUndefined();
    expect(server.record(company.id, 'attachments', scan.id)).toBeUndefined();
    expect(server.files.has(path)).toBe(false);
    expect(await db.outbox.count()).toBe(0);
  });

  it('by this build, with its scans: nothing more to do', async () => {
    const { company, payment, scan } = await paymentWithScan();
    const revs = [
      (await db.syncRevs.get(['payments', payment.id]))!.rev,
      (await db.syncRevs.get(['attachments', scan.id]))!.rev,
    ];
    await server.client(OWNER).pushRecords(company.id, [
      { tbl: 'payments', id: payment.id, deleted: true, base_rev: revs[0] },
      { tbl: 'attachments', id: scan.id, deleted: true, base_rev: revs[1] },
    ]);
    const pushed = vi.spyOn(ctx.api, 'pushRecords');
    await syncCompany(company.id, ctx);
    expect(await db.attachments.get(scan.id)).toBeUndefined();
    // (The invoice is sent again, its balance recalculated, as before.)
    const sent = pushed.mock.calls.flatMap(([, changes]) => changes.map((c) => c.tbl));
    expect(sent).not.toContain('attachments');
  });

  it('is left alone on a viewer’s device, which can’t delete files', async () => {
    const { company, payment, scan } = await paymentWithScan();
    await db.syncState.update(company.id, { role: 'viewer' });
    const rev = (await db.syncRevs.get(['payments', payment.id]))!.rev;
    await server
      .client(OWNER)
      .pushRecords(company.id, [{ tbl: 'payments', id: payment.id, deleted: true, base_rev: rev }]);
    await syncCompany(company.id, ctx);
    expect(await db.payments.get(payment.id)).toBeUndefined();
    expect(await db.attachments.get(scan.id)).toBeDefined();
    expect(server.record(company.id, 'attachments', scan.id)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('a printed cheque changed on a device with an older version of the app', () => {
  async function printedCheque() {
    const { company } = await uploaded();
    await saveCompany({ ...company, chequePrinting: true });
    const vendor = await saveClient(
      createClient(company.id, { name: 'Example Supplies Co.', isVendor: true }),
    );
    const payment = await savePayment(
      createPayment(company.id, {
        direction: 'out',
        clientId: vendor.id,
        date: '2026-10-20',
        amount: 1250,
        currency: 'KWD',
        method: 'cheque',
        cheque: newCheque({ number: '000123', bank: 'BRGN', date: '2026-11-15', drawer: '' }),
      }),
    );
    const printed = await recordChequePrinted(payment.id, {
      layout: { id: 'preset-BRGN' },
      text: {
        date: '15/11/2026',
        payee: 'Example Supplies Co.',
        words: ['فقط ألف ومائتان وخمسون دينارًا كويتيًا لا غير'],
        figures: '**1,250.000**',
        layoutVersion: 1,
      },
      crossed: false,
    });
    await syncCompany(company.id, ctx);
    return { company, printed };
  }

  /** What an older build sends: the payment as it saved it. */
  async function olderBuildSends(companyId: string, id: string, patch: Record<string, unknown>) {
    const rev = (await db.syncRevs.get(['payments', id]))!.rev;
    const data = patch.deleted
      ? undefined
      : { ...server.record(companyId, 'payments', id)!, ...patch };
    await server
      .client(OWNER)
      .pushRecords(companyId, [
        data
          ? { tbl: 'payments', id, data, base_rev: rev }
          : { tbl: 'payments', id, deleted: true, base_rev: rev },
      ]);
  }

  const lostLog = async (paymentId: string) =>
    (await db.activities.where('entityId').equals(paymentId).toArray()).filter(
      (a) => a.action === 'cheque_leaves_lost',
    );

  it('paid another way: the printed leaf is logged, here and for the team', async () => {
    const { company, printed } = await printedCheque();
    await olderBuildSends(company.id, printed.id, { method: 'bank_transfer', cheque: null });
    await syncCompany(company.id, ctx);
    expect((await db.payments.get(printed.id))?.cheque).toBeNull();
    const [lost] = await lostLog(printed.id);
    expect(lost?.messageVars).toEqual({ payment: printed.number, numbers: '000123' });
    expect(server.record(company.id, 'activities', lost.id)).toBeDefined();
    // Logged once.
    await syncCompany(company.id, ctx);
    expect(await lostLog(printed.id)).toHaveLength(1);
  });

  it('deleted: the printed leaf is logged', async () => {
    const { company, printed } = await printedCheque();
    await olderBuildSends(company.id, printed.id, { deleted: true });
    await syncCompany(company.id, ctx);
    expect(await db.payments.get(printed.id)).toBeUndefined();
    expect((await lostLog(printed.id)).map((a) => a.messageVars?.numbers)).toEqual(['000123']);
  });

  it('with a new amount: nothing is lost, and the print shows it changed', async () => {
    const { company, printed } = await printedCheque();
    await olderBuildSends(company.id, printed.id, { amount: 1520 });
    await syncCompany(company.id, ctx);
    const changed = (await db.payments.get(printed.id))!;
    expect(changed.amount).toBe(1520);
    expect(changed.cheque?.printedAt).toBe(printed.cheque?.printedAt);
    expect(printRefusal(changed)).toBe('changed');
    expect(await lostLog(printed.id)).toEqual([]);
  });
});

describe('an item deleted on another device', () => {
  it('by an older build, which leaves its pictures: they are deleted here and in the cloud', async () => {
    const { company } = await uploaded();
    const item = await saveItem(createProduct(company.id, { name: 'A4 paper box', sku: 'PAP-A4' }));
    await addProductImages(item.id, [{ name: 'box.png', dataUrl: PNG }]);
    const [pictureId] = (await db.products.get(item.id))!.imageIds!;
    await syncCompany(company.id, ctx);
    const path = `${company.id}/${pictureId}`;
    expect(server.files.has(path)).toBe(true);
    // An older build's deleteItem deletes the item only.
    const rev = (await db.syncRevs.get(['products', item.id]))!.rev;
    await server
      .client(OWNER)
      .pushRecords(company.id, [{ tbl: 'products', id: item.id, deleted: true, base_rev: rev }]);
    await syncCompany(company.id, ctx);
    expect(await db.products.get(item.id)).toBeUndefined();
    expect(await db.attachments.get(pictureId)).toBeUndefined();
    expect(server.record(company.id, 'attachments', pictureId)).toBeUndefined();
    expect(server.files.has(path)).toBe(false);
  });
});

describe('a server without the new functions (feature detection)', () => {
  it('numbers on the device and syncs as before', async () => {
    server.legacy = true;
    const { company } = await uploaded();
    setCounterReserver(cloudCounterReserver(ctx.api, OWNER));
    const invoice = await issueInvoice(company.id);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'documents', invoice.id)?.number).toBe(invoice.number);
    expect(await db.outbox.count()).toBe(0);
  });
});

// Handled in other changes; kept here as the scenarios found in the review.
describe.skip('handled separately', () => {
  it('a form open while another device’s change arrives does not undo it', async () => {
    const { company } = await uploaded();
    const id = (await db.clients.where('companyId').equals(company.id).first())!.id;
    const form = (await db.clients.get(id))!;
    const remote = server.record(company.id, 'clients', id)!;
    await server
      .client(OWNER)
      .pushRecords(company.id, [
        { tbl: 'clients', id, data: { ...remote, phone: '+965 2222 3333' } },
      ]);
    await syncCompany(company.id, ctx);
    await saveClient({ ...form, email: 'accounts@gulfpearl.example' });
    await syncCompany(company.id, ctx);
    const noted = await db.activities.filter((a) => a.action === 'sync_conflict').count();
    expect(server.record(company.id, 'clients', id)?.phone === '+965 2222 3333' || noted > 0).toBe(
      true,
    );
  });

  it('the log entry about deleting an employee’s document stays private', async () => {
    const { company } = await uploaded();
    const employee = await saveEmployee(createEmployee(company.id, { name: 'Rajesh Kumar' }));
    const licence = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: employee.id,
        title: 'Driving licence – Rajesh Kumar',
      }),
    );
    await syncCompany(company.id, ctx);
    await deleteComplianceDocument(licence.id);
    await syncCompany(company.id, ctx);
    server.addMember(company.id, STAFF, 'staff');
    const seen = await server.client(STAFF).pullRecords(company.id, 0, 1000);
    expect(seen.filter((r) => JSON.stringify(r.data).includes('Rajesh'))).toEqual([]);
  });

  it('"Delete all data in this browser" keeps the account’s companies off it', async () => {
    const { company } = await uploaded();
    await wipeAllData();
    const started = await downloadAccountCompanies(await ctx.api.myCompanies(), ctx);
    expect(started).not.toContain(company.id);
  });
});
