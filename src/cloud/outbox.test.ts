import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { deleteCompany, saveClient, setupCompany } from '@/db/records';
import { wipeAllData } from '@/db/backup';
import type { Company } from '@/db/types';
import { CloudPermissionError, markRemote, onLocalChange } from './outbox';
import type { CloudLink } from './types';
import type { MemberRole } from './roles';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function link(company: Company, role: MemberRole = 'owner'): Promise<void> {
  const row: CloudLink = {
    companyId: company.id,
    userId: 'user-1',
    role,
    status: 'ready',
    cursor: 0,
    name: company.name,
    linkedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  };
  await db.syncState.put(row);
  await db.outbox.clear();
}

const queued = async () =>
  (await db.outbox.toArray()).map((e) => `${e.op} ${e.table} ${e.id === undefined ? '' : e.id}`);

async function company(name = 'Acme'): Promise<Company> {
  return setupCompany({ name });
}

describe('change capture', () => {
  it('queues nothing for companies kept on this device only', async () => {
    const acme = await company();
    await saveClient(createClient(acme.id, { name: 'Gulf Pearl' }));
    expect(await db.outbox.count()).toBe(0);
  });

  it('queues adds, puts, updates and deletes of a cloud company with the change', async () => {
    const acme = await company();
    await link(acme);
    const client = createClient(acme.id, { name: 'Gulf Pearl', number: 'C-1' });
    await db.clients.add(client);
    await db.clients.put({ ...client, name: 'Gulf Pearl Hotel' });
    await db.clients.update(client.id, { email: 'a@example.com' });
    await db.clients.delete(client.id);
    expect(await queued()).toEqual([
      `put clients ${client.id}`,
      `put clients ${client.id}`,
      `put clients ${client.id}`,
      `delete clients ${client.id}`,
    ]);
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({ companyId: acme.id, parked: 0 });
  });

  it('queues bulk writes, collection changes and range deletes', async () => {
    const acme = await company();
    await link(acme);
    const a = createClient(acme.id, { name: 'A', number: 'C-1' });
    const b = createClient(acme.id, { name: 'B', number: 'C-2' });
    await db.clients.bulkPut([a, b]);
    await db.clients.where('companyId').equals(acme.id).modify({ notes: 'VIP' });
    await db.clients.where('companyId').equals(acme.id).delete();
    const ops = await queued();
    expect(ops.filter((o) => o.startsWith('put'))).toHaveLength(4);
    expect(ops.filter((o) => o.startsWith('delete')).sort()).toEqual(
      [`delete clients ${a.id}`, `delete clients ${b.id}`].sort(),
    );
    // Clearing a whole table is a range delete: each record is queued.
    await db.clients.bulkPut([a, b]);
    await db.outbox.clear();
    await db.clients.clear();
    expect((await queued()).sort()).toEqual(
      [`delete clients ${a.id}`, `delete clients ${b.id}`].sort(),
    );
  });

  it('knows the company of a record that is deleted', async () => {
    const acme = await company('Acme');
    const other = await company('Other');
    await link(acme);
    const mine = createClient(acme.id, { name: 'Mine', number: 'C-1' });
    const theirs = createClient(other.id, { name: 'Theirs', number: 'C-1' });
    await db.clients.bulkPut([mine, theirs]);
    await db.outbox.clear();
    await db.clients.bulkDelete([mine.id, theirs.id]);
    expect(await queued()).toEqual([`delete clients ${mine.id}`]);
  });

  it('does not queue saving something unchanged', async () => {
    const acme = await company();
    await link(acme);
    const client = createClient(acme.id, { name: 'Same', number: 'C-1' });
    await db.clients.put(client);
    await db.outbox.clear();
    // Same data, keys in another order.
    const reordered = Object.fromEntries(Object.entries(client).reverse()) as typeof client;
    await db.clients.put(reordered);
    expect(await db.outbox.count()).toBe(0);
  });

  it('does not send back what came from the server', async () => {
    const acme = await company();
    await link(acme);
    await db.transaction('rw', db.clients, async () => {
      markRemote();
      await db.clients.put(createClient(acme.id, { name: 'From the cloud', number: 'C-9' }));
    });
    expect(await db.outbox.count()).toBe(0);
  });

  it('queues nothing when the transaction fails', async () => {
    const acme = await company();
    await link(acme);
    await expect(
      db.transaction('rw', db.clients, async () => {
        await db.clients.put(createClient(acme.id, { name: 'Lost', number: 'C-1' }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.outbox.count()).toBe(0);
    expect(await db.clients.count()).toBe(0);
  });

  it('tells the sync engine once the change is saved', async () => {
    const acme = await company();
    await link(acme);
    const seen: string[][] = [];
    const stop = onLocalChange((ids) => seen.push(ids));
    await saveClient(createClient(acme.id, { name: 'Told' }));
    stop();
    expect(seen).toEqual([[acme.id]]);
  });

  it('never deletes in the cloud when a company is removed from this device', async () => {
    const acme = await company();
    await link(acme);
    await saveClient(createClient(acme.id, { name: 'Kept in the cloud' }));
    await deleteCompany(acme.id);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.syncState.count()).toBe(0);
    const again = await company('Again');
    await link(again);
    await saveClient(createClient(again.id, { name: 'X' }));
    await wipeAllData();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('roles on this device', () => {
  it('let viewers change nothing', async () => {
    const acme = await company();
    await link(acme, 'viewer');
    await expect(saveClient(createClient(acme.id, { name: 'Nope' }))).rejects.toBeInstanceOf(
      CloudPermissionError,
    );
    expect(await db.clients.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('let staff record sales but not change accounts or company settings', async () => {
    const acme = await company();
    await link(acme, 'staff');
    await saveClient(createClient(acme.id, { name: 'Allowed' }));
    // The client number came from the company's counter: allowed.
    const ops = await queued();
    expect(ops).toContain(`put companies ${acme.id}`);
    const account = (await db.accounts.where('companyId').equals(acme.id).first())!;
    await expect(db.accounts.put({ ...account, name: 'Renamed' })).rejects.toThrow(
      /Your role can’t make this change/,
    );
    const current = (await db.companies.get(acme.id))!;
    await expect(db.companies.put({ ...current, currency: 'USD' })).rejects.toBeInstanceOf(
      CloudPermissionError,
    );
    await expect(
      db.journals.put({
        id: 'j1',
        companyId: acme.id,
        number: 'MJ-1',
        date: '2026-10-01',
        reference: '',
        notes: '',
        status: 'posted',
        lines: [],
        createdAt: '',
        updatedAt: '',
      }),
    ).rejects.toBeInstanceOf(CloudPermissionError);
  });
});
