import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createProduct } from './defaults';
import { deleteItem, saveItem } from './inventory';
import {
  addProductImages,
  MAX_PRODUCT_IMAGES,
  mainProductImages,
  ProductImageError,
  removeProductImage,
  replaceProductImage,
  setMainProductImage,
} from './product-images';
import { addAttachment, removeAttachment } from './purchases';
import { setupCompany } from './records';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';
const OTHER = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsM';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function item() {
  const company = await setupCompany({ name: 'Sample Trading' });
  return saveItem(createProduct(company.id, { name: 'Desk lamp', nameAr: 'مصباح مكتب' }));
}

const picture = (name: string, dataUrl = JPEG) => ({ name, dataUrl });

describe('item pictures', () => {
  it('are files of the item, the first one its main picture', async () => {
    const p = await item();
    expect(p.imageIds).toBeUndefined();
    const withOne = await addProductImages(p.id, [picture('IMG_0101.PNG')]);
    const [main] = withOne.imageIds!;
    expect(await db.attachments.get(main)).toMatchObject({
      ownerId: p.id,
      companyId: p.companyId,
      name: 'IMG_0101.jpg',
      type: 'image/jpeg',
      dataUrl: JPEG,
    });

    const withThree = await addProductImages(p.id, [picture('side'), picture('back')]);
    expect(withThree.imageIds).toHaveLength(3);
    expect(withThree.imageIds![0]).toBe(main);
    expect(await db.attachments.where('ownerId').equals(p.id).count()).toBe(3);

    const logged = await db.activities.where('entityId').equals(p.id).toArray();
    expect(logged.map((a) => a.message)).toEqual(
      expect.arrayContaining([
        'Picture added to item Desk lamp',
        '2 pictures added to item Desk lamp',
      ]),
    );
  });

  it('are at most five', async () => {
    const p = await item();
    const five = Array.from({ length: MAX_PRODUCT_IMAGES }, (_, i) => picture(`p${i}`));
    await addProductImages(p.id, five);
    await expect(addProductImages(p.id, [picture('one more')])).rejects.toBeInstanceOf(
      ProductImageError,
    );
    expect(await db.attachments.where('ownerId').equals(p.id).count()).toBe(5);
  });

  it('replaced or rotated, take the place of the old one, whose file goes', async () => {
    const p = await item();
    const { imageIds } = await addProductImages(p.id, [picture('front'), picture('side')]);
    const [front, side] = imageIds!;

    const replaced = await replaceProductImage(p.id, side, picture('new side', OTHER));
    expect(replaced.imageIds![0]).toBe(front);
    const newSide = replaced.imageIds![1];
    expect(newSide).not.toBe(side);
    expect(await db.attachments.get(side)).toBeUndefined();
    expect(await db.attachments.get(newSide)).toMatchObject({
      name: 'new side.jpg',
      dataUrl: OTHER,
    });

    // Turned on the device: a new file with the old one's name, not logged.
    const before = await db.activities.count();
    const rotated = await replaceProductImage(p.id, front, { dataUrl: OTHER }, 'rotated');
    const turned = rotated.imageIds![0];
    expect(await db.attachments.get(front)).toBeUndefined();
    expect((await db.attachments.get(turned))?.name).toBe('front.jpg');
    expect(await db.activities.count()).toBe(before);
    expect(await db.attachments.where('ownerId').equals(p.id).count()).toBe(2);
  });

  it('change their main one, and the next becomes main when it is removed', async () => {
    const p = await item();
    const { imageIds } = await addProductImages(p.id, [picture('a'), picture('b'), picture('c')]);
    const [a, b, c] = imageIds!;
    expect((await setMainProductImage(p.id, c)).imageIds).toEqual([c, a, b]);
    expect((await removeProductImage(p.id, c)).imageIds).toEqual([a, b]);
    expect(await db.attachments.get(c)).toBeUndefined();

    // A picture removed as a file (an older screen) leaves the item too.
    await removeAttachment(a);
    expect((await db.products.get(p.id))?.imageIds).toEqual([b]);

    // With none left the item is as it was before it had pictures.
    const none = await removeProductImage(p.id, b);
    expect('imageIds' in none).toBe(false);
    expect('imageIds' in (await db.products.get(p.id))!).toBe(false);
    await expect(setMainProductImage(p.id, b)).rejects.toBeInstanceOf(ProductImageError);
  });

  it('are kept when the item is saved from a form opened before', async () => {
    const p = await item();
    const stale = { ...p };
    const withPictures = await addProductImages(p.id, [picture('front')]);
    const saved = await saveItem({ ...stale, unitPrice: 12.5 });
    expect(saved.imageIds).toEqual(withPictures.imageIds);
    expect((await db.products.get(p.id))?.imageIds).toEqual(withPictures.imageIds);

    // And a form that has them doesn't bring back one removed since.
    const opened = (await db.products.get(p.id))!;
    await removeProductImage(p.id, withPictures.imageIds![0]);
    expect('imageIds' in (await saveItem({ ...opened, unitPrice: 13 }))).toBe(false);
  });

  it('go with the item', async () => {
    const p = await item();
    await addProductImages(p.id, [picture('front'), picture('side')]);
    await deleteItem(p.id);
    expect(await db.attachments.where('ownerId').equals(p.id).count()).toBe(0);
  });

  it('give documents the main picture this device has', async () => {
    const p = await item();
    const other = await saveItem(createProduct(p.companyId, { name: 'Shelf' }));
    const bare = await saveItem(createProduct(p.companyId, { name: 'Chair' }));
    const { imageIds } = await addProductImages(p.id, [picture('front'), picture('side', OTHER)]);
    const { imageIds: shelf } = await addProductImages(other.id, [picture('shelf')]);
    // The shelf's file is still in the cloud: left out.
    await db.attachments.update(shelf![0], { dataUrl: '' });

    const found = await mainProductImages([p.id, other.id, bare.id, p.id, 'gone']);
    expect([...found.keys()]).toEqual([p.id]);
    expect(found.get(p.id)?.id).toBe(imageIds![0]);
  });

  it('leave other files alone', async () => {
    const p = await item();
    const note = await addAttachment(p.companyId, p.id, {
      name: 'spec.pdf',
      type: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0=',
    });
    await removeAttachment(note.id);
    expect('imageIds' in (await db.products.get(p.id))!).toBe(false);
  });
});
