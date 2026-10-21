import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, setupCompany } from '@/db/records';
import { draftDocument, saveDocument } from '@/db/documents';
import { FakeCloud } from './testing/fake-cloud';
import { CloudPermissionError } from './outbox';
import {
  PERMISSIONS_RECHECK_MS,
  startDownload,
  startUpload,
  syncCompany,
  type SyncContext,
} from './sync';

/**
 * The owner's limits on a member reach the member's device as it syncs, once
 * the server has them: kept on the link, applied before anything is saved,
 * and asked again at once when the server refused a change. Made-up data only.
 */

const OWNER = 'user-owner';
const ACCOUNTANT = 'user-accountant';

let server: FakeCloud;
let owner: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  server.features = ['tables_v16', 'super_admin'];
  owner = { api: server.client(OWNER), userId: OWNER };
});

afterEach(() => vi.restoreAllMocks());

/** The owner's company in the cloud, with an invoice, opened by the accountant on their device. */
async function accountantDevice() {
  const company = await setupCompany({ name: 'Test Trading' });
  const client = await saveClient(createClient(company.id, { name: 'Made-up Customer' }));
  await saveDocument(await draftDocument(company, 'invoice', client));
  await startUpload(company.id, owner);
  await syncCompany(company.id, owner);
  server.addMember(company.id, ACCOUNTANT, 'accountant');
  await db.delete();
  await db.open();
  const accountant = { api: server.client(ACCOUNTANT), userId: ACCOUNTANT };
  await startDownload({ id: company.id, name: company.name, role: 'accountant' }, accountant);
  await syncCompany(company.id, accountant);
  return { company, accountant };
}

describe('the owner’s limits on this device', () => {
  it('are none until the owner sets some, and none on a server without them', async () => {
    const { company, accountant } = await accountantDevice();
    expect((await db.syncState.get(company.id))?.permissions).toEqual({});
    server.features = ['tables_v16'];
    await db.syncState.update(company.id, { features: ['tables_v16'], permissions: undefined });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PERMISSIONS_RECHECK_MS + 1000);
    const asked = () => server.calls.filter((c) => c.endsWith('myPermissions')).length;
    const before = asked();
    await syncCompany(company.id, accountant);
    expect(asked()).toBe(before);
    expect((await db.syncState.get(company.id))?.permissions).toBeUndefined();
  });

  it('come with the next sync after a while, and are applied before anything is saved', async () => {
    const { company, accountant } = await accountantDevice();
    server.setAccess(company.id, ACCOUNTANT, { apps: { books: 'view' } }, true);
    // Asked again only after a while.
    await syncCompany(company.id, accountant);
    expect((await db.syncState.get(company.id))?.permissions).toEqual({});
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PERMISSIONS_RECHECK_MS + 1000);
    await syncCompany(company.id, accountant);
    expect(await db.syncState.get(company.id)).toMatchObject({
      permissions: { apps: { books: 'view' } },
      approver: true,
      seniorRolesOwnerOnly: false,
    });
    await expect(
      saveClient(createClient(company.id, { name: 'Another customer' })),
    ).rejects.toBeInstanceOf(CloudPermissionError);
    expect(await db.outbox.count()).toBe(0);
  });

  it('refuse a change made before the device knew them: it is parked, and they are asked at once', async () => {
    const { company, accountant } = await accountantDevice();
    server.setAccess(company.id, ACCOUNTANT, { apps: { books: 'view' } });
    await saveClient(createClient(company.id, { name: 'Made before the limit' }));
    const result = await syncCompany(company.id, accountant);
    // The customer, and the line of its log written with it, wait together.
    expect(result.parked).toBe(2);
    const parked = (await db.outbox.toArray()).filter((e) => e.parked === 1);
    expect(parked.map((e) => `${e.table} ${e.error}`).sort()).toEqual([
      'activities permission',
      'clients permission',
    ]);
    expect(server.rows(company.id, 'clients').map((r) => r.data.name)).toEqual([
      'Made-up Customer',
    ]);
    // Known now: Books is view only on this device too.
    expect((await db.syncState.get(company.id))?.permissions).toEqual({
      apps: { books: 'view' },
    });
  });

  it('let a Books-limited member keep syncing what others change', async () => {
    const { company, accountant } = await accountantDevice();
    server.setAccess(company.id, ACCOUNTANT, { apps: { books: 'view' } });
    await db.syncState.update(company.id, { permissions: { apps: { books: 'view' } } });
    // The owner records more meanwhile.
    await server.client(OWNER).pushRecords(company.id, [
      {
        tbl: 'clients',
        id: 'cl-new',
        data: { id: 'cl-new', companyId: company.id, name: 'From the owner' },
      },
    ]);
    const result = await syncCompany(company.id, accountant);
    expect(result.parked).toBe(0);
    expect(await db.clients.get('cl-new')).toMatchObject({ name: 'From the owner' });
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('the owner’s switch in the fake cloud', () => {
  it('keeps admins to staff and viewers, as the server does', async () => {
    const company = await setupCompany({ name: 'Test Trading' });
    await startUpload(company.id, owner);
    await syncCompany(company.id, owner);
    server.addMember(company.id, 'user-admin', 'admin');
    server.addMember(company.id, 'user-staff', 'staff');
    const admin = server.client('user-admin');
    await admin.setMemberRole(company.id, 'user-staff', 'accountant');
    await admin.setMemberRole(company.id, 'user-staff', 'staff');
    await owner.api.setTeamRules(company.id, { seniorRolesOwnerOnly: true });
    await expect(admin.setMemberRole(company.id, 'user-staff', 'accountant')).rejects.toMatchObject(
      { code: 'permission' },
    );
    await expect(admin.createInvite(company.id, 'x@example.com', 'admin')).rejects.toMatchObject({
      code: 'permission',
    });
    await admin.createInvite(company.id, 'x@example.com', 'viewer');
    await expect(
      admin.setTeamRules(company.id, { seniorRolesOwnerOnly: false }),
    ).rejects.toMatchObject({ code: 'permission' });
    expect(await admin.myPermissions(company.id)).toMatchObject({ seniorRolesOwnerOnly: true });
    expect(await owner.api.ownedCompanies()).toEqual([
      { id: company.id, name: 'Test Trading', members: 3, pendingApprovals: 0 },
    ]);
  });
});
