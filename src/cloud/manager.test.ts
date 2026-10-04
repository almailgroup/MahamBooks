import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createClient } from '@/db/defaults';
import { saveClient, setupCompany } from '@/db/records';
import { FakeCloud } from './testing/fake-cloud';
import { backoff, SyncManager } from './manager';
import { syncStatus } from './status';
import { startUpload, syncCompany } from './sync';

const USER = 'user-1';

/** Timers that only fire when the test moves the clock. */
function clock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      pending.delete(id as unknown as number);
    },
    /** Moves time on, firing due timers in order, and lets their work finish. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
    pending: () => [...pending.values()].map((t) => t.at - now).sort((a, b) => a - b),
  };
}

async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let server: FakeCloud;
let manager: SyncManager | null = null;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  syncStatus.clear();
});

afterEach(() => manager?.stop());

async function linked() {
  const company = await setupCompany({ name: 'Al Mail' });
  const ctx = { api: server.client(USER), userId: USER };
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return { company, ctx };
}

function start(
  ctx: { api: ReturnType<FakeCloud['client']>; userId: string },
  c: ReturnType<typeof clock>,
) {
  const locks: string[] = [];
  manager = new SyncManager(ctx, {
    ...c,
    random: () => 0.5,
    lock: (name, fn) => {
      locks.push(name);
      return fn();
    },
  });
  manager.start();
  return locks;
}

const pushes = () => server.calls.filter((call) => call.endsWith('pushRecords')).length;

describe('the sync schedule', () => {
  it('sends changes a second after the last one, once', async () => {
    const { company, ctx } = await linked();
    const c = clock();
    const locks = start(ctx, c);
    manager!.setCompanies([company.id]);
    await c.advance(0);
    const before = pushes();
    await saveClient(createClient(company.id, { name: 'A' }));
    await saveClient(createClient(company.id, { name: 'B' }));
    await settle();
    await c.advance(500);
    expect(pushes()).toBe(before);
    await c.advance(600);
    expect(pushes()).toBe(before + 1);
    expect(await db.outbox.count()).toBe(0);
    expect(locks.every((name) => name === `almailbooks-sync-${company.id}`)).toBe(true);
    expect(syncStatus.get(company.id)).toMatchObject({ phase: 'idle', syncedOnce: true });
  });

  it('retries failures with growing pauses and keeps the changes', async () => {
    const { company, ctx } = await linked();
    const c = clock();
    start(ctx, c);
    manager!.setCompanies([company.id]);
    await c.advance(0);
    server.offline = true;
    await saveClient(createClient(company.id, { name: 'Offline' }));
    await settle();
    await c.advance(1000);
    expect(syncStatus.get(company.id).phase).toBe('offline');
    expect(c.pending()[0]).toBe(backoff(1, () => 0.5));
    await c.advance(backoff(1, () => 0.5));
    expect(c.pending()[0]).toBe(backoff(2, () => 0.5));
    expect(await db.outbox.count()).toBeGreaterThan(0);
    server.offline = false;
    await c.advance(backoff(2, () => 0.5));
    expect(syncStatus.get(company.id).phase).toBe('idle');
    expect(await db.outbox.count()).toBe(0);
  });

  it('syncs when the cloud says the company changed', async () => {
    const { company, ctx } = await linked();
    const c = clock();
    start(ctx, c);
    manager!.setCompanies([company.id]);
    await c.advance(0);
    const pulls = server.calls.filter((call) => call.endsWith('pullRecords')).length;
    await server
      .client('someone')
      .pushRecords(company.id, [])
      .catch(() => undefined);
    server.addMember(company.id, 'someone', 'admin');
    await server.client('someone').pushRecords(company.id, [
      {
        tbl: 'clients',
        id: 'c1',
        data: { id: 'c1', companyId: company.id, name: 'From the team', contacts: [] },
      },
    ]);
    await c.advance(600);
    expect(server.calls.filter((call) => call.endsWith('pullRecords')).length).toBeGreaterThan(
      pulls,
    );
    expect((await db.clients.get('c1'))?.name).toBe('From the team');
  });

  it('syncs every minute and when the connection comes back', async () => {
    const { company, ctx } = await linked();
    const c = clock();
    start(ctx, c);
    manager!.setCompanies([company.id]);
    await c.advance(0);
    const before = server.calls.length;
    await c.advance(60_000);
    expect(server.calls.length).toBeGreaterThan(before);
    const later = server.calls.length;
    window.dispatchEvent(new Event('online'));
    await c.advance(0);
    expect(server.calls.length).toBeGreaterThan(later);
  });

  it('notices a role change and a company the account has left', async () => {
    const { company, ctx } = await linked();
    const c = clock();
    start(ctx, c);
    manager!.setCompanies([company.id]);
    await c.advance(0);
    server.addMember(company.id, USER, 'viewer');
    await manager!.refreshMembership();
    expect((await db.syncState.get(company.id))?.role).toBe('viewer');
    server.members.get(company.id)!.delete(USER);
    await manager!.refreshMembership();
    expect((await db.syncState.get(company.id))?.status).toBe('removed');
  });
});

describe('backoff', () => {
  it('doubles from 2 seconds up to 5 minutes', () => {
    const middle = () => 0.5;
    expect([1, 2, 3, 4].map((n) => backoff(n, middle))).toEqual([2000, 4000, 8000, 16000]);
    expect(backoff(20, middle)).toBe(300_000);
  });
});
