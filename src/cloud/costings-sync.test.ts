import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DATA_TABLES } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, setupCompany } from '@/db/records';
import { createQuoteFromCosting, getCostingSettings, newCosting, saveCosting } from '@/db/costings';
import type { Company } from '@/db/types';
import { newPost } from '@/lib/hr/costing';
import { FakeCloud } from './testing/fake-cloud';
import { markRemote } from './outbox';
import {
  FEATURES_RECHECK_MS,
  pulledTables,
  startDownload,
  startUpload,
  syncCompany,
  type SyncContext,
} from './sync';

/**
 * Manpower costings (#3) and the sync: a server without
 * 20261207000000_staffing_costings.sql never gets a costing or its activity
 * (they wait on the device until it has it); a device whose earlier version
 * pulled without the table catches up on it; and staff never receive
 * costings or their activity, while the quote made from one reaches them
 * with sell prices only. Invented names and amounts only.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const PHASE_4 = [
  'tables_v16',
  'super_admin',
  'approvals',
  'cheque_approvals',
  'change_feed',
  'payroll_approvals',
  'document_alerts',
  'employee_letters',
];

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  server.features = [...PHASE_4, 'staffing_costings'];
  ctx = { api: server.client(OWNER), userId: OWNER };
});

afterEach(() => vi.restoreAllMocks());

async function newDevice(userId: string): Promise<SyncContext> {
  await db.delete();
  await db.open();
  return { api: server.client(userId), userId };
}

/** A costing of guards for a made-up customer, with its quote. */
async function costingWithQuote(company: Company) {
  const client = await saveClient(createClient(company.id, { name: 'Made-up Towers Co.' }));
  const costing = await saveCosting({
    ...newCosting(company.id, await getCostingSettings(company.id), client.id),
    name: 'Tower A, night shift',
    posts: [
      {
        ...newPost(),
        jobTitle: 'Security Guard',
        headcount: 4,
        hoursPerDay: 12,
        basic: 137.25,
        allowances: 41.5,
      },
    ],
  });
  const quote = await createQuoteFromCosting(costing.id);
  return { costing, quote };
}

const parked = (companyId: string) =>
  db.outbox.where('[companyId+parked]').equals([companyId, 1]).toArray();

describe('a server without the costings file', () => {
  it('gets neither costings nor their activity until it has it; then they go', async () => {
    // Made in a company kept on this device, then uploaded to an older server.
    const company = await setupCompany({ name: 'Made-up Guarding' });
    const { costing, quote } = await costingWithQuote(company);
    server.features = [...PHASE_4];
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);

    expect(server.record(company.id, 'staffingCostings', costing.id)).toBeUndefined();
    expect(
      server.rows(company.id, 'activities').filter((r) => r.data.entity === 'costing'),
    ).toEqual([]);
    // The quote is an ordinary document and goes.
    expect(server.record(company.id, 'documents', quote.id)).toMatchObject({
      costingId: costing.id,
    });
    const waiting = await parked(company.id);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((e) => e.error === 'server_outdated')).toBe(true);
    expect(waiting.map((e) => e.table)).toContain('staffingCostings');

    // Asked again later, it still hasn't the file: they keep waiting.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + FEATURES_RECHECK_MS + 1000);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'staffingCostings', costing.id)).toBeUndefined();
    expect((await parked(company.id)).length).toBe(waiting.length);

    // The owner runs the file.
    server.features = [...PHASE_4, 'staffing_costings'];
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * FEATURES_RECHECK_MS + 2000);
    await syncCompany(company.id, ctx);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'staffingCostings', costing.id)).toMatchObject({
      quoteId: quote.id,
    });
    const activity = server
      .rows(company.id, 'activities')
      .filter((r) => r.data.entity === 'costing');
    expect(activity.length).toBeGreaterThan(0);
    // Marked private for older servers' rules too.
    expect(activity.every((r) => r.data._private === true)).toBe(true);
    expect(await parked(company.id)).toEqual([]);
  });
});

describe('a device whose earlier version pulled without the costings table', () => {
  it('gets the costings once, and keeps its cursor', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    // Saved on a newer device meanwhile.
    await server.client(OWNER).pushRecords(company.id, [
      {
        tbl: 'staffingCostings',
        id: 'cost-1',
        data: {
          ...newCosting(company.id, { overheadPercent: 10, marginPercent: 15 }),
          id: 'cost-1',
          name: 'Tower A, night shift',
        },
      },
    ]);
    // What the version before this one left: its cursor past it, its tables without it.
    const before = DATA_TABLES.filter((name) => name !== 'staffingCostings');
    await db.syncState.update(company.id, { cursor: server.rev, tables: [...before] });
    expect(pulledTables((await db.syncState.get(company.id))!)).not.toContain('staffingCostings');
    const cursor = server.rev;

    await syncCompany(company.id, ctx);
    expect(await db.staffingCostings.get('cost-1')).toMatchObject({
      name: 'Tower A, night shift',
    });
    const link = (await db.syncState.get(company.id))!;
    expect(link.cursor).toBe(cursor);
    expect(link.tables).toEqual([...DATA_TABLES]);
    // Nothing goes back to the cloud.
    expect(await db.outbox.count()).toBe(0);
  });

  it('counts a link noted before version 16 as without it too', () => {
    expect(pulledTables({ tables: undefined })).not.toContain('staffingCostings');
    expect(pulledTables({ tables: undefined })).not.toContain('employeeLetters');
  });
});

describe('staff', () => {
  it('never receive costings or their activity; the quote reaches them with sell prices only', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    const { costing, quote } = await costingWithQuote(company);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'staffingCostings', costing.id)).toBeDefined();

    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    expect(await db.companies.get(company.id)).toBeDefined();
    expect(await db.staffingCostings.count()).toBe(0);
    expect(await db.activities.filter((a) => a.entity === 'costing').count()).toBe(0);
    const received = await db.documents.get(quote.id);
    expect(received).toMatchObject({ type: 'quote', costingId: costing.id });
    const text = JSON.stringify([received, await db.activities.toArray()]);
    for (const secret of ['137.25', '41.5', 'Tower A, night shift']) {
      expect(text).not.toContain(secret);
    }
  });

  it('lose costing activity an older build kept for them, once this build catches up', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    server.addMember(company.id, STAFF, 'staff');
    const staff = await newDevice(STAFF);
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    // What a Phase 4 build stored while its member was still an accountant,
    // and kept when they became staff: it didn't know the entity, and its
    // copy drops the _private mark.
    await db.transaction('rw', db.activities, async () => {
      markRemote();
      await db.activities.add({
        id: 'act-old',
        companyId: company.id,
        at: new Date().toISOString(),
        entity: 'costing',
        entityId: 'cost-1',
        clientId: null,
        documentId: null,
        action: 'created',
        message: 'Manpower costing Tower B night guards created',
      });
    });
    const before = DATA_TABLES.filter((name) => name !== 'staffingCostings');
    await db.syncState.update(company.id, { tables: [...before] });

    await syncCompany(company.id, staff);
    expect(await db.activities.get('act-old')).toBeUndefined();
    expect((await db.syncState.get(company.id))!.tables).toEqual([...DATA_TABLES]);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('costing activity', () => {
  it('is marked confidential, which every build since Phase 0 keeps from staff and viewers', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await costingWithQuote(company);
    const logged = await db.activities.filter((a) => a.entity === 'costing').toArray();
    expect(logged.length).toBeGreaterThan(1);
    expect(logged.every((a) => a.confidential === true)).toBe(true);
  });
});

describe('a conflict on payroll or people data', () => {
  /**
   * Changed on another device, then here before this device synced: the
   * note this device logs names the record.
   */
  async function conflictOn(
    companyId: string,
    tbl: string,
    id: string,
    changeHere: () => Promise<unknown>,
  ) {
    const theirs = server.record(companyId, tbl, id)!;
    await server
      .client(OWNER)
      .pushRecords(companyId, [{ tbl, id, data: { ...theirs, updatedAt: 'elsewhere' } }]);
    await changeHere();
    const result = await syncCompany(companyId, ctx);
    expect(result.conflicts).toBe(1);
    const notes = await db.activities
      .filter((a) => a.action === 'sync_conflict' && a.entityId === id)
      .toArray();
    expect(notes).toHaveLength(1);
    return notes[0];
  }

  it('is logged confidential for a costing, so builds that don’t know costings keep it from staff', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    const costing = await saveCosting({
      ...newCosting(company.id, await getCostingSettings(company.id)),
      name: 'Tower B night guards',
    });
    await syncCompany(company.id, ctx);

    const note = await conflictOn(company.id, 'staffingCostings', costing.id, () =>
      saveCosting({ ...costing, notes: 'Two more posts from January' }),
    );
    expect(note).toMatchObject({ entity: 'costing', entityId: costing.id, confidential: true });
    expect(note.message).toContain('Tower B night guards');
    await syncCompany(company.id, ctx);
    // As the cloud keeps it: what a Phase 4 build pulls, without the _private mark.
    expect(server.record(company.id, 'activities', note.id)).toMatchObject({
      entity: 'costing',
      confidential: true,
    });
  });

  it('is logged confidential for the renewal of a confidential paper, and not for a customer', async () => {
    const company = await setupCompany({ name: 'Made-up Guarding' });
    await startUpload(company.id, ctx);
    await syncCompany(company.id, ctx);
    const now = new Date().toISOString();
    await db.complianceDocuments.put({
      id: 'doc-1',
      companyId: company.id,
      type: 'commercial_licence',
      title: 'Guards’ cost sheet for a made-up customer',
      number: 'CS-0001',
      issuer: '',
      issueDate: null,
      expiryDate: '2027-01-31',
      renewalCost: 0,
      reminderDays: null,
      ownerType: 'company',
      employeeId: null,
      ownerName: '',
      notes: '',
      archived: false,
      confidential: true,
      createdAt: now,
      updatedAt: now,
    });
    const renewal = {
      id: 'ren-1',
      companyId: company.id,
      documentKey: 'doc:doc-1',
      documentId: 'doc-1',
      employeeId: null,
      type: 'commercial_licence' as const,
      renewedOn: '2026-10-01',
      previousExpiry: '2026-01-31',
      newExpiry: '2027-01-31',
      fee: 0,
      expenseId: null,
      note: '',
      number: 'CS-0001',
      createdAt: now,
    };
    await db.renewals.put(renewal);
    await syncCompany(company.id, ctx);

    const note = await conflictOn(company.id, 'renewals', 'ren-1', () =>
      db.renewals.put({ ...renewal, note: 'Paid at the counter' }),
    );
    expect(note.message).toContain('CS-0001');
    expect(note.confidential).toBe(true);

    // A customer is no one's private data: its note stays as it always was.
    const client = await saveClient(createClient(company.id, { name: 'Made-up Towers Co.' }));
    await syncCompany(company.id, ctx);
    const plain = await conflictOn(company.id, 'clients', client.id, () =>
      saveClient({ ...client, phone: '+965 0000 0000' }),
    );
    expect(plain.entity).toBe('client');
    expect(plain.confidential).toBeUndefined();
  });
});
