import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import {
  deleteCompany,
  saveClient,
  setupCompany,
  unsentChanges,
  UnsentChangesError,
} from './records';
import { draftDocument, saveDocument } from './documents';
import { FakeCloud } from '@/cloud/testing/fake-cloud';
import { startUpload, syncCompany } from '@/cloud/sync';

/**
 * Removing a company kept in the cloud from this device (Settings →
 * Companies, Settings → Cloud and sync). Made-up data only.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const OWNER = 'user-owner';

/** A company in the cloud with an invoice issued on the road, without a connection. */
async function invoiceIssuedOffline() {
  const server = new FakeCloud();
  const ctx = { api: server.client(OWNER), userId: OWNER };
  const company = await setupCompany({ name: 'Review Trading' });
  const client = await saveClient(createClient(company.id, { name: 'Made-up Client' }));
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  server.offline = true;
  const current = (await db.companies.get(company.id))!;
  const draft = await draftDocument(current, 'invoice', client);
  draft.items[0] = { ...draft.items[0], name: 'Service', quantity: 1, unitPrice: 250 };
  const invoice = await saveDocument({ ...draft, status: 'sent' });
  await expect(syncCompany(company.id, ctx)).rejects.toBeDefined();
  return { server, ctx, company, invoice };
}

describe('removing a company from this device', () => {
  it('is refused while invoices have not reached the cloud yet', async () => {
    const { server, ctx, company, invoice } = await invoiceIssuedOffline();
    const unsent = await unsentChanges(company.id);
    expect(unsent).toBeGreaterThan(0);

    const refused = await deleteCompany(company.id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(UnsentChangesError);
    expect((refused as UnsentChangesError).count).toBe(unsent);
    // Nothing was removed: back online, the invoice reaches the cloud…
    server.offline = false;
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'documents', invoice.id)).toBeDefined();
    // …and with nothing left to send, the company can leave this device.
    await deleteCompany(company.id);
    expect(await db.companies.get(company.id)).toBeUndefined();
  });

  it('goes ahead once the person has agreed to lose those changes', async () => {
    const { server, company, invoice } = await invoiceIssuedOffline();
    await deleteCompany(company.id, { force: true });
    expect(await db.companies.get(company.id)).toBeUndefined();
    expect(await db.documents.get(invoice.id)).toBeUndefined();
    // Nothing was deleted in the cloud; only the unsent invoice is gone, as agreed.
    expect(server.record(company.id, 'companies', company.id)).toBeDefined();
    expect(server.record(company.id, 'documents', invoice.id)).toBeUndefined();
  });

  it('counts only changes still waiting, not those the cloud refused', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await db.outbox.bulkAdd([
      { companyId: company.id, table: 'clients', id: 'a', op: 'put', at: '', parked: 0 },
      { companyId: company.id, table: 'clients', id: 'b', op: 'put', at: '', parked: 1 },
    ]);
    expect(await unsentChanges(company.id)).toBe(1);
    expect(await unsentChanges()).toBe(1);
  });
});
