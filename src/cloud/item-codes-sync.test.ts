import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createProduct, defaultNumbering } from '@/db/defaults';
import { saveCompany, setupCompany } from '@/db/records';
import { assignItemCodes, saveItem } from '@/db/inventory';
import type { Company } from '@/db/types';
import { setCounterReserver } from '@/lib/numbering';
import { today } from '@/lib/dates';
import { FakeCloud } from './testing/fake-cloud';
import { skuProblems } from './problems';
import { cloudCounterReserver } from './reserve';
import { startDownload, startUpload, syncCompany, type SyncContext } from './sync';

/**
 * Item codes (SKUs) in a company kept in the cloud: taken from the
 * company's counter there while online, so two devices never give the same
 * code; given on the device offline, where a code given twice is listed as
 * a problem.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  ctx = { api: server.client(OWNER), userId: OWNER };
});

afterEach(() => setCounterReserver(null));

/** A company in the cloud that gives item codes (switching it on writes the rule). */
async function coding(): Promise<Company> {
  const company = await setupCompany({ name: 'Gulf Trading' });
  const { product: _none, ...numbering } = company.numbering;
  await saveCompany({
    ...company,
    numbering: { ...numbering, product: defaultNumbering().product } as Company['numbering'],
    items: { autoSku: true },
  });
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return (await db.companies.get(company.id))!;
}

describe('item codes in the cloud', () => {
  it('are taken from the cloud’s counter online, so two devices never give the same one', async () => {
    const company = await coding();
    setCounterReserver(cloudCounterReserver(ctx.api, OWNER));
    // Another device gives the next code a moment before this one.
    const theirs = await server.client(OWNER).reserveNumber(company.id, 'product', today(), 1);
    expect(theirs?.counter).toBe(1);
    const mine = await saveItem(createProduct(company.id, { name: 'Gloves' }));
    expect(mine.sku).toBe('SKU-00002');
    const next = await saveItem(createProduct(company.id, { name: 'Helmet' }));
    expect(next.sku).toBe('SKU-00003');
    await syncCompany(company.id, ctx);
    const cloud = server.record(company.id, 'companies', company.id)!
      .numbering as Company['numbering'];
    expect(cloud.product.next).toBe(4);
  });

  it('given to many items at once take a block of the cloud’s counter', async () => {
    const company = await coding();
    await db.products.bulkPut(
      ['Rope', 'Bag', 'Tape'].map((name, i) =>
        createProduct(company.id, { name, createdAt: `2026-0${i + 1}-01T00:00:00Z` }),
      ),
    );
    setCounterReserver(cloudCounterReserver(ctx.api, OWNER));
    const theirs = await server.client(OWNER).reserveNumber(company.id, 'product', today(), 1);
    expect(await assignItemCodes(company.id)).toBe(3);
    const codes = (await db.products.where('companyId').equals(company.id).sortBy('createdAt')).map(
      (p) => p.sku,
    );
    expect(theirs?.counter).toBe(1);
    expect(codes).toEqual(['SKU-00002', 'SKU-00003', 'SKU-00004']);
    // Before this device's counter goes up, another device already gets the next free code.
    expect(
      (await server.client(OWNER).reserveNumber(company.id, 'product', today(), 1))?.counter,
    ).toBe(5);
  });

  it('given to many items at once take the block past a code typed inside it', async () => {
    const company = await coding();
    await db.products.bulkPut([
      ...['Rope', 'Bag', 'Tape'].map((name, i) =>
        createProduct(company.id, { name, createdAt: `2026-0${i + 1}-01T00:00:00Z` }),
      ),
      createProduct(company.id, { name: 'Vest', sku: 'SKU-00002' }),
    ]);
    setCounterReserver(cloudCounterReserver(ctx.api, OWNER));
    expect(await assignItemCodes(company.id)).toBe(3);
    const codes = (await db.products.where('companyId').equals(company.id).sortBy('createdAt'))
      .filter((p) => p.name !== 'Vest')
      .map((p) => p.sku);
    expect(codes).toEqual(['SKU-00001', 'SKU-00003', 'SKU-00004']);
    // Another device that hasn't these items yet gets the next free code.
    expect(
      (await server.client(OWNER).reserveNumber(company.id, 'product', today(), 1))?.counter,
    ).toBe(5);
  });

  it('are given by staff too: their counter goes up to the cloud', async () => {
    const company = await coding();
    server.addMember(company.id, STAFF, 'staff');
    await db.delete();
    await db.open();
    const staff = { api: server.client(STAFF), userId: STAFF };
    await startDownload({ id: company.id, name: company.name, role: 'staff' }, staff);
    await syncCompany(company.id, staff);
    setCounterReserver(cloudCounterReserver(staff.api, STAFF));
    const item = await saveItem(createProduct(company.id, { name: 'Gloves' }));
    expect(item.sku).toBe('SKU-00001');
    const result = await syncCompany(company.id, staff);
    expect(result.parked).toBe(0);
    expect(server.record(company.id, 'products', item.id)).toMatchObject({ sku: 'SKU-00001' });
  });

  it('given offline on two devices, the same code is listed as a problem until one changes', async () => {
    const company = await coding();
    server.offline = true;
    const mine = await saveItem(createProduct(company.id, { name: 'Gloves' }));
    server.offline = false;
    expect(mine.sku).toBe('SKU-00001');
    const theirs = { ...createProduct(company.id, { name: 'Helmet' }), sku: 'SKU-00001' };
    await server
      .client(OWNER)
      .pushRecords(company.id, [{ tbl: 'products', id: theirs.id, data: { ...theirs } }]);
    await syncCompany(company.id, ctx);
    const problems = await skuProblems(company.id);
    expect(problems.map((items) => items.map((p) => p.id).sort())).toEqual([
      [mine.id, theirs.id].sort(),
    ]);
    // Saving either again is never refused; a new code clears the problem.
    await expect(saveItem({ ...mine, unitPrice: 2 })).resolves.toBeDefined();
    await saveItem({ ...(await db.products.get(mine.id))!, sku: 'SKU-00900' });
    expect(await skuProblems(company.id)).toEqual([]);
  });

  it('are no problem when typed by hand, or when only archived items share them', async () => {
    const company = await coding();
    await db.products.bulkPut([
      // Typed long before the company gave codes.
      createProduct(company.id, { name: 'Gloves S', sku: 'GL-01' }),
      createProduct(company.id, { name: 'Gloves M', sku: 'gl-01' }),
      createProduct(company.id, { name: 'Old rope', sku: 'SKU-00007', archived: true }),
      createProduct(company.id, { name: 'Old bag', sku: 'SKU-00007', archived: true }),
    ]);
    expect(await skuProblems(company.id)).toEqual([]);
    const tape = createProduct(company.id, { name: 'Tape', sku: 'sku-00007' });
    await db.products.put(tape);
    expect((await skuProblems(company.id)).map((g) => g.length)).toEqual([3]);
  });

  it('are no problem while the company gives no codes', async () => {
    const company = await setupCompany({ name: 'Gulf Trading' });
    await db.products.bulkPut([
      createProduct(company.id, { name: 'Gloves', sku: 'GL-01' }),
      createProduct(company.id, { name: 'Gloves XL', sku: 'GL-01' }),
    ]);
    expect(await skuProblems(company.id)).toEqual([]);
  });
});
