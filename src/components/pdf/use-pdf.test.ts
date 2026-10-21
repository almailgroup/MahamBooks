import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createProduct } from '@/db/defaults';
import { saveItem } from '@/db/inventory';
import { addProductImages } from '@/db/product-images';
import { setupCompany } from '@/db/records';
import type { Company, DocumentLayout } from '@/db/types';
import { sampleClient, sampleDocument } from '@/pdf/sample';
import { prepareModel } from './use-pdf';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

beforeEach(async () => {
  await db.delete();
  await db.open();
  // No canvas here: thumbnails are the pictures themselves.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('item pictures on documents', () => {
  async function quote(images: boolean, layout: DocumentLayout) {
    const base = await setupCompany({ name: 'Sample Trading' });
    const company: Company = {
      ...base,
      ...(images ? { items: { images: true } } : {}),
      branding: { ...base.branding, layout },
    };
    const lamp = await saveItem(createProduct(company.id, { name: 'Desk lamp' }));
    const chair = await saveItem(createProduct(company.id, { name: 'Chair' }));
    await addProductImages(lamp.id, [{ name: 'front', dataUrl: JPEG }]);
    const client = sampleClient(company.id);
    const doc = sampleDocument(company, client, 'quote');
    const items = doc.items.map((item, i) =>
      i === 0 ? { ...item, productId: lamp.id } : i === 1 ? { ...item, productId: chair.id } : item,
    );
    return prepareModel({ ...doc, items }, company, client);
  }

  it('print the main picture of items that have one when the design shows them', async () => {
    const model = await quote(true, { showItemImages: true });
    expect(model.columns.images).toBe(true);
    expect(model.items.map((i) => i.image)).toEqual([JPEG, null, null, null, null]);
  });

  it('are left out by designs without them, and while items have no pictures', async () => {
    const off = await quote(true, {});
    expect(off.columns.images).toBe(false);
    await db.delete();
    await db.open();
    const switchedOff = await quote(false, { showItemImages: true });
    expect(switchedOff.columns.images).toBe(false);
    expect(switchedOff.items.every((i) => i.image === null)).toBe(true);
  });
});
