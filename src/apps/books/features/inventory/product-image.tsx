import { useEffect, useReducer, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Expand, ImagePlus, Package, RefreshCw, RotateCw, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  addProductImages,
  itemImageIds,
  MAX_PRODUCT_IMAGES,
  removeProductImage,
  replaceProductImage,
  setMainProductImage,
  type NewProductImage,
} from '@/db/product-images';
import type { ID, Product } from '@/db/types';
import { imageThumbnail, productImageFromFile, rotateImage } from '@/lib/image';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { openAttachment } from '@/features/purchases/attachments';

const SIZES = {
  /** The line picker. */
  xs: 'size-7 rounded',
  /** Products. */
  sm: 'size-10 rounded-md',
  /** The item dialog. */
  lg: 'size-20 rounded-lg',
} as const;

/** Thumbnails are made at this size (px), twice what lists show, for sharp screens. */
const THUMB_PX = 96;

/**
 * An item's picture, or a box with an icon when it has none (or its file is
 * still in the cloud).
 */
export function ProductThumb({
  src,
  size = 'sm',
  className,
}: {
  /** The picture as a data URL. */
  src?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          'bg-surface shrink-0 object-contain ring-1 ring-slate-900/5',
          SIZES[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-slate-100 text-slate-400',
        SIZES[size],
        className,
      )}
    >
      <Package className={size === 'lg' ? 'size-6' : 'size-4'} />
    </span>
  );
}

/** Small copies of pictures made on this device, by attachment id (a changed picture has a new id). */
const made = new Map<ID, string>();

/** Pictures turned into thumbnails at once: a long list never stalls the page. */
const AT_ONCE = 3;
let making = 0;
const waiting: (() => void)[] = [];

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      making++;
      work()
        .then(resolve, reject)
        .finally(() => {
          making--;
          waiting.shift()?.();
        });
    };
    if (making < AT_ONCE) start();
    else waiting.push(start);
  });
}

/**
 * The main picture of an item in a list, as a small copy. Its file is read
 * only once the row is on screen (or close to it) and only until the copy is
 * made, which then serves every list for as long as the app is open. A
 * picture still in the cloud comes in after the next sync.
 */
export function ItemPicture({
  imageId,
  size = 'sm',
}: {
  /** The item's main picture (`imageIds[0]`). */
  imageId: ID | undefined;
  size?: keyof typeof SIZES;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [, update] = useReducer((n: number) => n + 1, 0);
  const src = imageId ? made.get(imageId) : undefined;

  useEffect(() => {
    if (near || !imageId || made.has(imageId)) return;
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, imageId]);

  // The full file, only while its copy is still to be made (then let go).
  const file = useLiveQuery(
    async () =>
      near && imageId && !src ? ((await db.attachments.get(imageId))?.dataUrl ?? '') : '',
    [near, imageId, src],
  );

  useEffect(() => {
    if (!imageId || !file) return;
    let live = true;
    void inTurn(() => imageThumbnail(imageId, file, THUMB_PX)).then((thumb) => {
      made.set(imageId, thumb);
      if (live) update();
    });
    return () => {
      live = false;
    };
  }, [imageId, file]);

  return (
    <span ref={box} className="inline-flex shrink-0">
      <ProductThumb src={src} size={size} />
    </span>
  );
}

/** A picture in the editor: stored on the item, or waiting for a new item to be saved. */
interface Slot {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
}

/**
 * The pictures of an item in its dialog: add up to five, look at one full
 * size, make one the main picture, turn, replace or remove one. A stored
 * item's pictures are saved at once (and kept whatever the rest of the form
 * does); a new item's wait in `pending` until it is saved. Without crop: a
 * picture is kept whole.
 */
export function ProductImageEditor({
  product,
  saved,
  pending,
  onPending,
  onBusy,
  readOnly = false,
}: {
  product: Product;
  /** The item is stored: its pictures change at once. */
  saved: boolean;
  /** A new item's pictures, saved with it. */
  pending: NewProductImage[];
  onPending: (images: NewProductImage[]) => void;
  /** While pictures are being read or saved: a new item waits for them. */
  onBusy?: (busy: boolean) => void;
  readOnly?: boolean;
}) {
  const confirm = useConfirm();
  const add = useRef<HTMLInputElement>(null);
  const replace = useRef<HTMLInputElement>(null);
  const replacing = useRef<number>(-1);
  const [busy, setBusy] = useState(false);

  const stored = useLiveQuery(async () => {
    if (!saved) return null;
    const item = await db.products.get(product.id);
    const ids = item ? await itemImageIds(item) : [];
    const files = await db.attachments.bulkGet(ids);
    return ids.map((id, i): Slot => ({
      id,
      name: files[i]?.name ?? '',
      type: files[i]?.type ?? 'image/jpeg',
      dataUrl: files[i]?.dataUrl ?? '',
    }));
  }, [saved, product.id]);
  const slots: Slot[] = saved
    ? (stored ?? [])
    : pending.map((p, i) => ({
        id: String(i),
        name: p.name,
        type: 'image/jpeg',
        dataUrl: p.dataUrl,
      }));
  const room = MAX_PRODUCT_IMAGES - slots.length;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    onBusy?.(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the picture.'));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  const addFiles = (files: File[]) =>
    run(async () => {
      if (files.length === 0) return;
      if (files.length > room) {
        throw new Error(
          t('An item can have up to {count} pictures.', { count: MAX_PRODUCT_IMAGES }),
        );
      }
      const images: NewProductImage[] = [];
      for (const file of files) {
        images.push({ name: file.name, dataUrl: await productImageFromFile(file) });
      }
      if (saved) {
        await addProductImages(product.id, images);
        toast.success(tp(images.length, '{count} picture added', '{count} pictures added'));
      } else {
        onPending([...pending, ...images]);
      }
    });

  const replaceAt = (index: number, file: File) =>
    run(async () => {
      const dataUrl = await productImageFromFile(file);
      if (saved) {
        await replaceProductImage(product.id, slots[index].id, { name: file.name, dataUrl });
        toast.success(t('Picture replaced'));
      } else {
        onPending(pending.map((p, i) => (i === index ? { name: file.name, dataUrl } : p)));
      }
    });

  const rotate = (index: number) =>
    run(async () => {
      const slot = slots[index];
      if (!slot.dataUrl) return;
      const dataUrl = await rotateImage(slot.dataUrl);
      if (saved) await replaceProductImage(product.id, slot.id, { dataUrl }, 'rotated');
      else onPending(pending.map((p, i) => (i === index ? { ...p, dataUrl } : p)));
    });

  const makeMain = (index: number) =>
    run(async () => {
      if (saved) {
        await setMainProductImage(product.id, slots[index].id);
        toast.success(t('Main picture changed'));
      } else {
        onPending([pending[index], ...pending.filter((_, i) => i !== index)]);
      }
    });

  const remove = async (index: number) => {
    if (saved) {
      const ok = await confirm({
        title: t('Remove this picture?'),
        description:
          index === 0 && slots.length > 1 ? t('The next picture becomes the main one.') : undefined,
        confirmLabel: t('Remove'),
        danger: true,
      });
      if (!ok) return;
    }
    await run(async () => {
      if (saved) {
        await removeProductImage(product.id, slots[index].id);
        toast.success(t('Picture removed'));
      } else {
        onPending(pending.filter((_, i) => i !== index));
      }
    });
  };

  const view = (slot: Slot) =>
    openAttachment({ id: saved ? slot.id : undefined, dataUrl: slot.dataUrl, type: slot.type });

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700">{t('Pictures')}</p>
      <ul className="flex flex-wrap gap-3">
        {slots.map((slot, index) => (
          <li key={slot.id} className="relative">
            <DropdownMenu>
              <DropdownTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={
                    index === 0 ? t('Main picture') : t('Picture {number}', { number: index + 1 })
                  }
                  className="focus-visible:ring-primary-500 block rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait"
                >
                  <ProductThumb
                    src={slot.dataUrl}
                    size="lg"
                    className={busy ? 'opacity-60' : undefined}
                  />
                </button>
              </DropdownTrigger>
              <DropdownContent align="start">
                <DropdownItem icon={<Expand />} onSelect={() => view(slot)}>
                  {t('View full size')}
                </DropdownItem>
                {readOnly ? null : (
                  <>
                    {index > 0 ? (
                      <DropdownItem icon={<Star />} onSelect={() => void makeMain(index)}>
                        {t('Make main picture')}
                      </DropdownItem>
                    ) : null}
                    {slot.dataUrl ? (
                      <DropdownItem icon={<RotateCw />} onSelect={() => void rotate(index)}>
                        {t('Rotate')}
                      </DropdownItem>
                    ) : null}
                    <DropdownItem
                      icon={<RefreshCw />}
                      onSelect={() => {
                        replacing.current = index;
                        replace.current?.click();
                      }}
                    >
                      {t('Replace')}
                    </DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove(index)}>
                      {t('Remove')}
                    </DropdownItem>
                  </>
                )}
              </DropdownContent>
            </DropdownMenu>
            {index === 0 && slots.length > 1 ? (
              <span className="bg-primary-solid text-on-primary pointer-events-none absolute start-1 top-1 rounded px-1 text-[10px] font-medium">
                {t('Main')}
              </span>
            ) : null}
          </li>
        ))}
        {!readOnly && room > 0 ? (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => add.current?.click()}
              className="hover:border-primary-400 hover:text-primary-700 focus-visible:ring-primary-500 flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-wait"
            >
              <ImagePlus className="size-5" aria-hidden />
              {t('Add picture')}
            </button>
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        {slots.length === 0 && readOnly
          ? t('No pictures yet.')
          : t(
              'Up to {count} pictures, kept whole. The first is the main one: shown in lists and printed on documents whose design shows item pictures.',
              { count: MAX_PRODUCT_IMAGES },
            )}
      </p>
      <input
        ref={add}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label={t('Choose pictures')}
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <input
        ref={replace}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('Choose a picture')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && replacing.current >= 0) void replaceAt(replacing.current, file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
