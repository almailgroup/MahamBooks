import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { FakeCloud } from './testing/fake-cloud';
import { keepAsLocal, startUpload, syncCompany, type SyncContext } from './sync';
import { arrivals, downloadAccountCompanies } from './auto-download';
import { allowOnDevice, keepOffDevice, keptOffDevice } from './kept-off';

const OWNER = 'user-owner';

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  ctx = { api: server.client(OWNER), userId: OWNER };
});

/** A device starting afresh: same account, empty browser. */
async function newDevice(): Promise<SyncContext> {
  await db.delete();
  await db.open();
  return { api: server.client(OWNER), userId: OWNER };
}

async function cloudCompany(name: string) {
  const company = await setupCompany({ name });
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return company;
}

describe("the account's companies", () => {
  it('come to a new device by themselves, once', async () => {
    const a = await cloudCompany('Al Mail Trading');
    const b = await cloudCompany('Gulf Lights Trading');
    const device = await newDevice();
    const mine = await device.api.myCompanies();
    expect((await arrivals(mine, OWNER)).get(a.id)).toBe('auto');

    const started = await downloadAccountCompanies(mine, device);
    expect([...started].sort()).toEqual([a.id, b.id].sort());
    for (const id of started) await syncCompany(id, device);
    expect((await db.companies.get(a.id))?.name).toBe('Al Mail Trading');
    expect((await db.companies.get(b.id))?.name).toBe('Gulf Lights Trading');
    expect((await db.syncState.get(a.id))?.status).toBe('ready');

    // Already here: nothing starts again.
    expect(await downloadAccountCompanies(mine, device)).toEqual([]);
    expect((await arrivals(mine, OWNER)).get(a.id)).toBe('here');
  });

  it('start a download once when asked twice at the same time', async () => {
    const a = await cloudCompany('Al Mail Trading');
    const device = await newDevice();
    const mine = await device.api.myCompanies();
    const [first, second] = await Promise.all([
      downloadAccountCompanies(mine, device),
      downloadAccountCompanies(mine, device),
    ]);
    expect([...first, ...second]).toEqual([a.id]);
  });

  it('stay off a device they were removed from until downloaded by hand', async () => {
    const a = await cloudCompany('Al Mail Trading');
    const device = await newDevice();
    await keepOffDevice(OWNER, a.id);
    const mine = await device.api.myCompanies();
    expect((await arrivals(mine, OWNER)).get(a.id)).toBe('kept_off');
    expect(await downloadAccountCompanies(mine, device)).toEqual([]);
    expect(await db.syncState.get(a.id)).toBeUndefined();

    await allowOnDevice(OWNER, a.id);
    expect(await keptOffDevice(OWNER)).toEqual(new Set());
    expect(await downloadAccountCompanies(mine, device)).toEqual([a.id]);
  });

  it("never replace this device's own copy without asking", async () => {
    const a = await cloudCompany('Al Mail Trading');
    // Kept here as a company of this device only.
    await keepAsLocal(a.id);
    const mine = await ctx.api.myCompanies();
    expect((await arrivals(mine, OWNER)).get(a.id)).toBe('replace');
    expect(await downloadAccountCompanies(mine, ctx)).toEqual([]);
    expect((await db.companies.get(a.id))?.name).toBe('Al Mail Trading');
    expect(await db.syncState.get(a.id)).toBeUndefined();
  });
});
