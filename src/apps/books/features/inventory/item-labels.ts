import { msg } from '@/i18n';

/**
 * Item labels: the item's QR code (of its SKU, which any scanner types into
 * item search), name, SKU and, if wanted, price, on a sheet of A4 labels or
 * on a roll of thermal labels. Sizes are in mm, from the top left corner of
 * the paper (features/print/mm-page.tsx).
 */

export type LabelLayoutId = 'a4-3x8' | 'thermal-50x25';

export interface LabelLayout {
  id: LabelLayoutId;
  /** English key. */
  name: string;
  page: { width: number; height: number };
  columns: number;
  rows: number;
  /** One label. */
  cell: { width: number; height: number };
  /** Top left corner of the first label. */
  origin: { x: number; y: number };
  /** Side of the QR code. */
  qr: number;
}

export const LABEL_LAYOUTS: Record<LabelLayoutId, LabelLayout> = {
  // 24 labels of 70 × 37 mm on A4, edge to edge.
  'a4-3x8': {
    id: 'a4-3x8',
    name: msg('A4 sheet, 3 × 8 labels'),
    page: { width: 210, height: 297 },
    columns: 3,
    rows: 8,
    cell: { width: 70, height: 37 },
    origin: { x: 0, y: 0.5 },
    qr: 26,
  },
  // One label per page, on a label printer.
  'thermal-50x25': {
    id: 'thermal-50x25',
    name: msg('Thermal label, 50 × 25 mm'),
    page: { width: 50, height: 25 },
    columns: 1,
    rows: 1,
    cell: { width: 50, height: 25 },
    origin: { x: 0, y: 0 },
    qr: 20,
  },
};

export function isLabelLayout(value: unknown): value is LabelLayoutId {
  return value === 'a4-3x8' || value === 'thermal-50x25';
}

/** Where a label goes on its page, in mm. */
export function labelBox(layout: LabelLayout, slot: number) {
  const column = slot % layout.columns;
  const row = Math.floor(slot / layout.columns);
  return {
    x: layout.origin.x + column * layout.cell.width,
    y: layout.origin.y + row * layout.cell.height,
    width: layout.cell.width,
    height: layout.cell.height,
  };
}

/**
 * The labels laid out on pages: each item `copies` times, in order. `skip`
 * leaves the first labels of a used sheet empty (null). Never an empty page.
 */
export function labelPages<T>(
  items: T[],
  layout: LabelLayout,
  copies = 1,
  skip = 0,
): (T | null)[][] {
  const perPage = layout.columns * layout.rows;
  const count = Math.max(1, Math.min(100, Math.trunc(copies) || 1));
  const blank = Math.max(0, Math.min(perPage - 1, Math.trunc(skip) || 0));
  const slots: (T | null)[] = [
    ...Array.from({ length: blank }, () => null),
    ...items.flatMap((item) => Array.from({ length: count }, () => item)),
  ];
  if (items.length === 0) return [];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < slots.length; i += perPage) pages.push(slots.slice(i, i + perPage));
  return pages;
}
