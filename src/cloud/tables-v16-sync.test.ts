import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DATA_TABLES } from '@/db/db';
import { setupCompany } from '@/db/records';
import { addAttachment } from '@/db/purchases';
import { createComplianceDocument, renewDocument, saveComplianceDocument } from '@/db/renewals';
import type { CloudApi } from './api';
import { companyHasFeature, linkHasFeature } from './features';
import { FakeCloud } from './testing/fake-cloud';
import {
  applyRole,
  FEATURES_RECHECK_MS,
  pulledTables,
  startDownload,
  startUpload,
  syncCompany,
  type SyncContext,
} from './sync';

/**
 * The tables of database version 16 and the sync: a device whose earlier
 * version moved its cursor past their records catches up on them once, for
 * its role; what the server has is kept on the link; confidential register
 * documents stay with the roles that see people data.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
type NewTable = 'chequeLayouts' | 'vehicles' | 'approvals' | 'letterTemplates' | 'employeeLetters';

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  ctx = { api: server.client(OWNER), userId: OWNER };
});

afterEach(() => vi.restoreAllMocks());

async function newDevice(userId: string): Promise<SyncContext> {
  await db.delete();
  await db.open();
  return { api: server.client(userId), userId };
}

async function uploaded() {
  const company = await setupCompany({ name: 'Test Trading' });
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return company;
}

const rec = (companyId: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  companyId,
  ...extra,
});

/** Records of the new tables saved on another device (a newer version). */
async function newerDeviceSaves(companyId: string) {
  await server.client(OWNER).pushRecords(companyId, [
    { tbl: 'vehicles', id: 'veh-1', data: rec(companyId, 'veh-1', { plate: 'TEST-1' }) },
    { tbl: 'vehicles', id: 'veh-2', data: rec(companyId, 'veh-2', { plate: 'TEST-2' }) },
    { tbl: 'chequeLayouts', id: 'lay-1', data: rec(companyId, 'lay-1', { bank: 'BRGN' }) },
    { tbl: 'letterTemplates', id: 'tpl-1', data: rec(companyId, 'tpl-1', { kind: 'noc' }) },
    {
      tbl: 'employeeLetters',
      id: 'let-1',
      data: rec(companyId, 'let-1', { employeeId: 'emp-1', body: 'Salary 450.000' }),
    },
    {
      tbl: 'approvals',
      id: 'apr-pay',
      data: rec(companyId, 'apr-pay', { kind: 'payroll', subjectTbl: 'payRuns' }),
    },
    {
      tbl: 'approvals',
      id: 'apr-inv',
      data: rec(companyId, 'apr-inv', { kind: 'invoice_void', subjectTbl: 'documents' }),
    },
  ]);
}

/** What an earlier version left: its cursor past every change, no table list. */
async function asEarlierVersion(companyId: string) {
  await db.syncState.update(companyId, { cursor: server.rev, tables: undefined });
}

const ids = async (table: NewTable, companyId: string) =>
  (await db.table(table).where('companyId').equals(companyId).primaryKeys()).map(String).sort();

describe('a device whose earlier version skipped the new tables', () => {
  it('gets their records once, and keeps its cursor', async () => {
    const company = await uploaded();
    await newerDeviceSaves(company.id);
    await asEarlierVersion(company.id);
    const cursor = server.rev;
    expect(pulledTables((await db.syncState.get(company.id))!)).not.toContain('vehicles');

    await syncCompany(company.id, ctx);
    expect(await ids('vehicles', company.id)).toEqual(['veh-1', 'veh-2']);
    expect(await ids('chequeLayouts', company.id)).toEqual(['lay-1']);
    expect(await ids('letterTemplates', company.id)).toEqual(['tpl-1']);
    expect(await ids('employeeLetters', company.id)).toEqual(['let-1']);
    expect(await ids('approvals', company.id)).toEqual(['apr-inv', 'apr-pay']);
    expect(await db.vehicles.get('veh-1')).toMatchObject({ plate: 'TEST-1' });
    expect(await db.syncRevs.get(['vehicles', 'veh-1'])).toMatchObject({ companyId: company.id });
    const link = (await db.syncState.get(company.id))!;
    expect(link.cursor).toBe(cursor);
    expect(link.tables).toEqual([...DATA_TABLES]);
    // Nothing goes back to the cloud.
    expect(await db.outbox.count()).toBe(0);

    // The next sync is an ordinary one, and later changes arrive as usual.
    await server
      .client(OWNER)
      .pushRecords(company.id, [
        { tbl: 'vehicles', id: 'veh-1', data: rec(company.id, 'veh-1', { plate: 'TEST-9' }) },
      ]);
    const calls = server.calls.length;
    await syncCompany(company.id, ctx);
    expect(server.calls.slice(calls).some((c) => c.endsWith('recordIds'))).toBe(false);
    expect(await db.vehicles.get('veh-1')).toMatchObject({ plate: 'TEST-9' });
  });

  it('tries again at the next sync when it can’t finish, and doing it twice changes nothing', async () => {
    const company = await uploaded();
    await newerDeviceSaves(company.id);
    await asEarlierVersion(company.id);
    server.failNext('getRecord', 'offline');
    await expect(syncCompany(company.id, ctx)).rejects.toMatchObject({ code: 'offline' });
    expect((await db.syncState.get(company.id))?.tables).toBeUndefined();

    await syncCompany(company.id, ctx);
    expect(await ids('vehicles', company.id)).toEqual(['veh-1', 'veh-2']);
    const first = await db.vehicles.toArray();

    await asEarlierVersion(company.id);
    await syncCompany(company.id, ctx);
    expect(await db.vehicles.toArray()).toEqual(first);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.syncState.get(company.id))?.tables).toEqual([...DATA_TABLES]);
  });

  it('keeps a change made here that the cloud hasn’t taken over the cloud’s copy', async () => {
    const company = await uploaded();
    await newerDeviceSaves(company.id);
    await asEarlierVersion(company.id);
    await db.vehicles.put({
      ...server.record(company.id, 'vehicles', 'veh-2'),
      plate: 'MINE-2',
    } as never);
    server.failNext('pushRecords', 'invalid');
    await syncCompany(company.id, ctx);
    expect(await db.vehicles.get('veh-2')).toMatchObject({ plate: 'MINE-2' });
    expect(server.record(company.id, 'vehicles', 'veh-2')).toMatchObject({ plate: 'TEST-2' });
    expect(await db.outbox.where('[companyId+parked]').equals([company.id, 1]).count()).toBe(1);
    expect(await ids('vehicles', company.id)).toEqual(['veh-1', 'veh-2']);
  });

  it('never gives staff payroll or people data', async () => {
    const company = await uploaded();
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    await newerDeviceSaves(company.id);
    await asEarlierVersion(company.id);

    await syncCompany(company.id, staff);
    expect(await ids('vehicles', company.id)).toEqual(['veh-1', 'veh-2']);
    expect(await ids('chequeLayouts', company.id)).toEqual(['lay-1']);
    expect(await ids('approvals', company.id)).toEqual(['apr-inv']);
    expect(await ids('letterTemplates', company.id)).toEqual([]);
    expect(await ids('employeeLetters', company.id)).toEqual([]);
    expect((await db.syncState.get(company.id))?.tables).toEqual([...DATA_TABLES]);
  });

  it('leaves out what staff may not hold even when the cloud sends it', async () => {
    const company = await uploaded();
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    await newerDeviceSaves(company.id);
    await asEarlierVersion(company.id);

    // Ids and records asked for under another role (as a page asked before a role change).
    const owner = server.client(OWNER);
    const leaky: CloudApi = {
      ...staff.api,
      recordIds: owner.recordIds,
      getRecord: owner.getRecord,
    };
    await syncCompany(company.id, { ...staff, api: leaky });
    expect(await ids('vehicles', company.id)).toEqual(['veh-1', 'veh-2']);
    expect(await ids('approvals', company.id)).toEqual(['apr-inv']);
    expect(await ids('letterTemplates', company.id)).toEqual([]);
    expect(await ids('employeeLetters', company.id)).toEqual([]);
  });
});

describe('a link made by this version', () => {
  it('pulls every table from the start and never catches up', async () => {
    const company = await uploaded();
    await newerDeviceSaves(company.id);
    expect((await db.syncState.get(company.id))?.tables).toEqual([...DATA_TABLES]);
    await syncCompany(company.id, ctx);
    expect(await ids('vehicles', company.id)).toEqual(['veh-1', 'veh-2']);

    const other = await newDevice(OWNER);
    await startDownload({ id: company.id, name: company.name, role: 'owner' }, other);
    await syncCompany(company.id, other);
    expect(await ids('approvals', company.id)).toEqual(['apr-inv', 'apr-pay']);
    expect(server.calls.some((c) => c.endsWith('recordIds'))).toBe(false);
  });

  it('pulls everything again when the role sees more', async () => {
    const company = await uploaded();
    await applyRole(company.id, 'staff');
    await db.syncState.update(company.id, { tables: undefined });
    await applyRole(company.id, 'owner');
    expect(await db.syncState.get(company.id)).toMatchObject({
      cursor: 0,
      tables: [...DATA_TABLES],
    });
  });
});

describe('what the server has', () => {
  it('is kept on the link, and asked again only after a while', async () => {
    const company = await uploaded();
    const link = (await db.syncState.get(company.id))!;
    expect(link.features).toEqual(['tables_v16']);
    expect(linkHasFeature(link, 'tables_v16')).toBe(true);
    expect(await companyHasFeature(company.id, 'tables_v16')).toBe(true);

    server.features = [];
    const asked = () => server.calls.filter((c) => c.endsWith('serverFeatures')).length;
    const before = asked();
    await syncCompany(company.id, ctx);
    expect(asked()).toBe(before);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + FEATURES_RECHECK_MS + 1000);
    await syncCompany(company.id, ctx);
    expect(asked()).toBe(before + 1);
    expect(await companyHasFeature(company.id, 'tables_v16')).toBe(false);
  });

  it('is nothing on a server without the migration, and stays known when it can’t be asked', async () => {
    server.legacy = true;
    const company = await uploaded();
    expect((await db.syncState.get(company.id))?.features).toEqual([]);
    expect(await companyHasFeature(company.id, 'tables_v16')).toBe(false);

    server.legacy = false;
    server.failNext('serverFeatures', 'offline');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + FEATURES_RECHECK_MS + 1000);
    await syncCompany(company.id, ctx);
    expect((await db.syncState.get(company.id))?.features).toEqual([]);
    await syncCompany(company.id, ctx);
    expect((await db.syncState.get(company.id))?.features).toEqual(['tables_v16']);
  });

  it('doesn’t matter for a company kept on this device only', async () => {
    const company = await setupCompany({ name: 'On this device' });
    expect(await companyHasFeature(company.id, 'tables_v16')).toBe(true);
    expect(linkHasFeature(null, 'tables_v16')).toBe(true);
  });
});

describe('a confidential register document', () => {
  async function confidentialDocument(companyId: string) {
    const doc = await saveComplianceDocument(
      createComplianceDocument(companyId, {
        type: 'other',
        title: 'Guards cost sheet',
        expiryDate: '2026-12-31',
      }),
    );
    await db.complianceDocuments.update(doc.id, { confidential: true });
    const scan = await addAttachment(companyId, doc.id, {
      name: 'cost-sheet.png',
      type: 'image/png',
      dataUrl: PNG,
    });
    const { renewal } = await renewDocument({
      companyId,
      key: `doc:${doc.id}`,
      renewedOn: '2026-10-20',
      newExpiry: '2027-12-31',
    });
    return { doc, scan, renewal };
  }

  it('goes to the cloud with its files and activity marked private', async () => {
    const company = await uploaded();
    const { doc, scan } = await confidentialDocument(company.id);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'complianceDocuments', doc.id)?.confidential).toBe(true);
    expect(server.record(company.id, 'attachments', scan.id)?._private).toBe(true);
    const activity = server
      .rows(company.id, 'activities')
      .filter((r) => r.data.entityId === doc.id);
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((r) => r.data._private === true)).toBe(true);
  });

  it('never reaches staff, nor its renewals and files', async () => {
    const company = await uploaded();
    const { doc, scan, renewal } = await confidentialDocument(company.id);
    await syncCompany(company.id, ctx);
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    expect(await db.companies.get(company.id)).toBeDefined();
    expect(await db.complianceDocuments.get(doc.id)).toBeUndefined();
    expect(await db.renewals.get(renewal.id)).toBeUndefined();
    expect(await db.attachments.get(scan.id)).toBeUndefined();
    expect(JSON.stringify(await db.activities.toArray())).not.toContain('Guards cost sheet');
  });

  it('leaves a device whose role no longer sees people data, with its renewals and files', async () => {
    const company = await uploaded();
    const { doc, scan, renewal } = await confidentialDocument(company.id);
    const open = await saveComplianceDocument(createComplianceDocument(company.id));
    await syncCompany(company.id, ctx);
    await db.approvals.put(
      rec(company.id, 'apr-pay', { kind: 'payroll', subjectTbl: 'payRuns' }) as never,
    );
    await db.letterTemplates.put(rec(company.id, 'tpl-1', { kind: 'noc' }) as never);
    await db.vehicles.put(rec(company.id, 'veh-1', { plate: 'TEST-1' }) as never);
    await syncCompany(company.id, ctx);

    await applyRole(company.id, 'staff');
    expect(await db.complianceDocuments.get(doc.id)).toBeUndefined();
    expect(await db.renewals.get(renewal.id)).toBeUndefined();
    expect(await db.attachments.get(scan.id)).toBeUndefined();
    expect(await db.approvals.get('apr-pay')).toBeUndefined();
    expect(await db.letterTemplates.get('tpl-1')).toBeUndefined();
    expect(await db.vehicles.get('veh-1')).toBeDefined();
    expect(await db.complianceDocuments.get(open.id)).toBeDefined();
    // Nothing of it is deleted in the cloud.
    expect(await db.outbox.count()).toBe(0);
    expect(server.record(company.id, 'complianceDocuments', doc.id)).toBeDefined();
  });
});
