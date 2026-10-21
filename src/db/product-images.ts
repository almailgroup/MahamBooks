import { db } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import type { Attachment, ID, Product } from './types';
import { newId } from '@/lib/ids';
import { msg, t } from '@/i18n';

/**
 * Pictures of items: attachments owned by the item, listed in
 * `Product.imageIds` with the main one first, so they sync, stay in backups
 * and reach staff like the item. Only these functions change the list (and
 * `removeAttachment`): an item form opened before a picture was added never
 * takes it away (see saveItem). A changed picture (replaced, rotated) is a
 * new file, so devices and thumbnails never keep the old one.
 */

/** Pictures an item can have: a main one and four more. */
export const MAX_PRODUCT_IMAGES = 5;

export class ProductImageError extends Error {}

/** A picture to store, as made by productImageFromFile. */
export interface NewProductImage {
  name: string;
  dataUrl: string;
}

/** The ids of an item's pictures, the main one first. */
export function productImageIds(product: Pick<Product, 'imageIds'> | null | undefined): ID[] {
  return product?.imageIds ?? [];
}

/**
 * An item's pictures, the main one first, and after them its picture files
 * that dropped out of its list (another device, or an older build, saved the
 * item over it), oldest first: the person sees them again and can keep or
 * remove them. Each change of the pictures puts them back on the list.
 */
export async function itemImageIds(product: Product): Promise<ID[]> {
  const listed = productImageIds(product);
  const strays = (await db.attachments.where('ownerId').equals(product.id).toArray())
    .filter((file) => !listed.includes(file.id) && file.type.startsWith('image/'))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    .map((file) => file.id);
  return [...listed, ...strays];
}

/** The item with these pictures; with none, the field is left out, as on items that never had one. */
function withImages(product: Product, all: ID[]): Product {
  // Past the limit (files that came back), the rest stay as files of the item.
  const ids = all.slice(0, MAX_PRODUCT_IMAGES);
  const { imageIds: _old, ...rest } = product;
  return { ...rest, ...(ids.length ? { imageIds: ids } : {}), updatedAt: nowStamp() };
}

/** The item without one of its pictures (the file itself is removed by the caller). */
export function withoutImage(product: Product, imageId: ID): Product {
  return withImages(
    product,
    productImageIds(product).filter((id) => id !== imageId),
  );
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function imageFile(product: Product, image: NewProductImage): Attachment {
  const type = /^data:([^;,]+)/.exec(image.dataUrl)?.[1] ?? 'image/jpeg';
  const base = image.name.trim().replace(/\.[a-z0-9]{1,5}$/i, '') || 'picture';
  return {
    id: newId(),
    companyId: product.companyId,
    ownerId: product.id,
    name: base + (EXTENSIONS[type] ?? ''),
    type,
    size: Math.round((image.dataUrl.length * 3) / 4),
    dataUrl: image.dataUrl,
    createdAt: nowStamp(),
  };
}

const TABLES = () => [db.products, db.attachments, db.activities];

async function itemOf(productId: ID): Promise<Product> {
  const product = await db.products.get(productId);
  if (!product) throw new ProductImageError(t('This item could not be found.'));
  return product;
}

function position(ids: ID[], imageId: ID): number {
  const at = ids.indexOf(imageId);
  if (at < 0) throw new ProductImageError(t('This picture is no longer on the item.'));
  return at;
}

const log = (product: Product, action: string, text: string, vars: Record<string, number> = {}) =>
  logActivity(product.companyId, 'product', product.id, action, {
    text,
    vars: { name: product.name, ...vars },
    arabic: { name: product.nameAr },
  });

/** Adds pictures after the item's own; the first picture of an item is its main one. */
export async function addProductImages(productId: ID, images: NewProductImage[]): Promise<Product> {
  return db.transaction('rw', TABLES(), async () => {
    const product = await itemOf(productId);
    if (images.length === 0) return product;
    const ids = await itemImageIds(product);
    if (ids.length + images.length > MAX_PRODUCT_IMAGES) {
      throw new ProductImageError(
        t('An item can have up to {count} pictures.', { count: MAX_PRODUCT_IMAGES }),
      );
    }
    const files = images.map((image) => imageFile(product, image));
    await db.attachments.bulkAdd(files);
    const updated = withImages(product, [...ids, ...files.map((f) => f.id)]);
    await db.products.put(updated);
    await log(
      product,
      'image_added',
      files.length === 1
        ? msg('Picture added to item {name}')
        : msg('{count} pictures added to item {name}'),
      { count: files.length },
    );
    return updated;
  });
}

/**
 * Puts another picture in the place of one, and removes the old file. A
 * picture rotated on the device is stored this way too, keeping its name.
 */
export async function replaceProductImage(
  productId: ID,
  imageId: ID,
  image: { name?: string; dataUrl: string },
  how: 'replaced' | 'rotated' = 'replaced',
): Promise<Product> {
  return db.transaction('rw', TABLES(), async () => {
    const product = await itemOf(productId);
    const ids = await itemImageIds(product);
    const at = position(ids, imageId);
    const old = await db.attachments.get(imageId);
    const file = imageFile(product, {
      name: image.name ?? old?.name ?? '',
      dataUrl: image.dataUrl,
    });
    await db.attachments.add(file);
    await db.attachments.delete(imageId);
    ids[at] = file.id;
    const updated = withImages(product, ids);
    await db.products.put(updated);
    if (how === 'replaced') {
      await log(product, 'image_replaced', msg('Picture of item {name} replaced'));
    }
    return updated;
  });
}

/** Removes a picture and its file; the next one becomes the main one. */
export async function removeProductImage(productId: ID, imageId: ID): Promise<Product> {
  return db.transaction('rw', TABLES(), async () => {
    const product = await itemOf(productId);
    const file = await db.attachments.get(imageId);
    if (file?.ownerId === product.id) await db.attachments.delete(imageId);
    const ids = await itemImageIds(product);
    if (!ids.includes(imageId)) return product;
    const updated = withImages(
      product,
      ids.filter((id) => id !== imageId),
    );
    await db.products.put(updated);
    await log(product, 'image_removed', msg('Picture removed from item {name}'));
    return updated;
  });
}

/** Makes a picture the item's main one: shown in lists and printed on documents. */
export async function setMainProductImage(productId: ID, imageId: ID): Promise<Product> {
  return db.transaction('rw', TABLES(), async () => {
    const product = await itemOf(productId);
    const ids = await itemImageIds(product);
    const at = position(ids, imageId);
    if (at === 0) return product;
    const updated = withImages(product, [imageId, ...ids.filter((id) => id !== imageId)]);
    await db.products.put(updated);
    await log(product, 'image_main', msg('Main picture of item {name} changed'));
    return updated;
  });
}

/**
 * The main pictures of these items that this device has, by item id. A
 * picture still in the cloud (larger files come when opened) is left out,
 * so it never holds up a PDF.
 */
export async function mainProductImages(productIds: ID[]): Promise<Map<ID, Attachment>> {
  const ids = [...new Set(productIds)];
  const products = await db.products.bulkGet(ids);
  const mains = products.flatMap((p) => (p?.imageIds?.[0] ? [[p.id, p.imageIds[0]] as const] : []));
  const files = await db.attachments.bulkGet(mains.map(([, imageId]) => imageId));
  const found = new Map<ID, Attachment>();
  mains.forEach(([productId], i) => {
    const file = files[i];
    if (file?.dataUrl) found.set(productId, file);
  });
  return found;
}
