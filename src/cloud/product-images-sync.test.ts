import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createProduct } from '@/db/defaults';
import { saveCompany, setupCompany } from '@/db/records';
import { deleteItem, saveItem } from '@/db/inventory';
import {
  addProductImages,
  mainProductImages,
  removeProductImage,
  setMainProductImage,
} from '@/db/product-images';
import { FakeCloud } from './testing/fake-cloud';
import { EAGER_DOWNLOAD_BYTES } from './files';
import { CloudPermissionError } from './outbox';
import type { MemberRole } from './roles';
import {
  downloadMissingFiles,
  startDownload,
  startUpload,
  syncCompany,
  type SyncContext,
} from './sync';

/**
 * Pictures of items in a company kept in the cloud: files owned by the item,
 * which staff may add like the item itself, and everyone who sees the item
 * receives.
 */

const OWNER = 'user-owner';
const STAFF = 'user-staff';
const VIEWER = 'user-viewer';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

let server: FakeCloud;
let ctx: SyncContext;

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = new FakeCloud();
  ctx = { api: server.client(OWNER), userId: OWNER };
});

/** A company in the cloud whose items have pictures, with one item. */
async function shared() {
  const company = await setupCompany({ name: 'Sample Trading' });
  await saveCompany({ ...company, items: { images: true } });
  const lamp = await saveItem(createProduct(company.id, { name: 'Desk lamp' }));
  await startUpload(company.id, ctx);
  await syncCompany(company.id, ctx);
  return { company: (await db.companies.get(company.id))!, lamp };
}

/** Another member opening the company on a device of their own. */
async function member(
  company: { id: string; name: string },
  userId: string,
  role: MemberRole,
): Promise<SyncContext> {
  server.addMember(company.id, userId, role);
  await db.delete();
  await db.open();
  const device = { api: server.client(userId), userId };
  await startDownload({ id: company.id, name: company.name, role }, device);
  await syncCompany(company.id, device);
  await downloadMissingFiles(company.id, device, EAGER_DOWNLOAD_BYTES);
  return device;
}

describe('item pictures in the cloud', () => {
  it('are added by staff, and reach viewers, who can’t change them', async () => {
    const { company, lamp } = await shared();

    const staff = await member(company, STAFF, 'staff');
    const { imageIds } = await addProductImages(lamp.id, [{ name: 'front', dataUrl: JPEG }]);
    const [front] = imageIds!;
    const pushed = await syncCompany(company.id, staff);
    expect(pushed.parked).toBe(0);
    const path = `${company.id}/${front}`;
    expect(server.files.get(path)?.owner).toBe(STAFF);
    expect(server.record(company.id, 'products', lamp.id)).toMatchObject({ imageIds: [front] });
    expect(server.record(company.id, 'attachments', front)).toMatchObject({
      ownerId: lamp.id,
      storagePath: path,
    });

    // A viewer receives the item with its picture.
    await member(company, VIEWER, 'viewer');
    expect((await db.products.get(lamp.id))?.imageIds).toEqual([front]);
    expect((await mainProductImages([lamp.id])).get(lamp.id)?.dataUrl).toBe(JPEG);
    await expect(
      addProductImages(lamp.id, [{ name: 'side', dataUrl: JPEG }]),
    ).rejects.toBeInstanceOf(CloudPermissionError);
    await expect(removeProductImage(lamp.id, front)).rejects.toBeInstanceOf(CloudPermissionError);
    expect(await db.attachments.get(front)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('change and go with the item for everyone', async () => {
    const { company, lamp } = await shared();
    const { imageIds } = await addProductImages(lamp.id, [
      { name: 'front', dataUrl: JPEG },
      { name: 'side', dataUrl: JPEG },
    ]);
    const [front, side] = imageIds!;
    await setMainProductImage(lamp.id, side);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'products', lamp.id)).toMatchObject({
      imageIds: [side, front],
    });

    await removeProductImage(lamp.id, front);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'attachments', front)).toBeUndefined();
    expect(server.files.has(`${company.id}/${front}`)).toBe(false);

    await deleteItem(lamp.id);
    await syncCompany(company.id, ctx);
    expect(server.record(company.id, 'products', lamp.id)).toBeUndefined();
    expect(server.record(company.id, 'attachments', side)).toBeUndefined();
    expect(server.files.has(`${company.id}/${side}`)).toBe(false);
  });
});
