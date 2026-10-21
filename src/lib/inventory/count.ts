import type { ID, Product } from '@/db/types';
import { parseCsvRows } from '@/lib/banking/statement';
import { normalizeDigits } from '@/lib/money';

/**
 * Stock count sheets: exported as CSV (SKU, item, unit, quantity on record,
 * counted), filled in on a spreadsheet or on paper, and read back from CSV
 * or Excel. Rows are matched by SKU, else by the English or Arabic name.
 */

export type CountItem = Pick<Product, 'id' | 'sku' | 'name' | 'nameAr' | 'unit'>;

export interface CountImport {
  /** Counted quantity per item. */
  counted: Map<ID, number>;
  /** Rows whose item wasn't found, by the text that named it. */
  unmatched: string[];
  /** Rows with something other than a number in the counted column. */
  invalid: string[];
}

const key = (text: string | undefined) => (text ?? '').trim().toLowerCase();

function parseQuantity(text: string): number | null {
  const cleaned = normalizeDigits(text).replace(/[\s,]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Rows of a count sheet: headings first, the counted column last (blank to fill in). */
export function countSheetRows(
  items: CountItem[],
  quantity: (id: ID) => number,
  counted: (id: ID) => number | null = () => null,
): (string | number)[][] {
  return items.map((i) => [i.sku, i.name, i.unit, quantity(i.id), counted(i.id) ?? '']);
}

/**
 * Reads counted quantities from a sheet. The first cell is the SKU, the
 * second the item's name, the last column the quantity counted; a heading
 * row and rows left blank are skipped, and so are items whose counted cell
 * is blank. Excel leaves out a row's empty cells at the end, so the last
 * column is the sheet's (its heading's), not the row's.
 */
export function parseCountSheet(text: string, items: CountItem[]): CountImport {
  return readCountRows(parseCsvRows(text), items);
}

/** Counted quantities from the rows of a sheet, CSV or Excel (see parseCountSheet). */
export function readCountRows(rows: string[][], items: CountItem[]): CountImport {
  const bySku = new Map(items.filter((i) => i.sku.trim()).map((i) => [key(i.sku), i.id]));
  const byName = new Map<string, ID>();
  for (const i of items) {
    byName.set(key(i.name), i.id);
    if (i.nameAr?.trim()) byName.set(key(i.nameAr), i.id);
  }
  const result: CountImport = { counted: new Map(), unmatched: [], invalid: [] };
  const last = rows.reduce((width, row) => Math.max(width, row.length), 0) - 1;
  rows.forEach((row, index) => {
    const cells = row.map((c) => c.trim());
    if (cells.length < 2 || cells.every((c) => !c)) return;
    const quantity = parseQuantity(cells[last] ?? '');
    const label = cells[1] || cells[0];
    if (quantity === null) return;
    if (Number.isNaN(quantity)) {
      // The heading row.
      if (index > 0) result.invalid.push(label);
      return;
    }
    const id = (cells[0] && bySku.get(key(cells[0]))) || byName.get(key(cells[1]));
    if (!id) {
      result.unmatched.push(label);
      return;
    }
    result.counted.set(id, quantity);
  });
  return result;
}
