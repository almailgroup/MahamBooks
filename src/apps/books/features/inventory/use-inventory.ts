import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { prepareInventory } from '@/db/inventory';
import type { ID, Product, StockMovement, Warehouse } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { formatUnitPrice } from '@/lib/format';
import { stockLevels, type StockLevel } from '@/lib/inventory/costing';
import { isStockItem } from '@/lib/inventory/sources';
import { currencyPrecision } from '@/lib/money';
import { localName } from '@/i18n/names';

export interface InventoryData {
  products: Product[];
  /** Stock items, archived ones included. */
  stockItems: Product[];
  /** Every warehouse, archived ones included; the default one first. */
  warehouses: Warehouse[];
  defaultWarehouse: Warehouse | undefined;
  movements: StockMovement[];
  /** On hand and value of each stock item after everything recorded. */
  levels: Map<ID, StockLevel>;
  precision: number;
}

/** Stock items, warehouses and movements of the current company, kept up to date. */
export function useInventory(): InventoryData | undefined {
  const company = useCompany();
  useEffect(() => {
    void prepareInventory(company.id);
  }, [company.id]);
  return useLiveQuery(async () => {
    const [products, warehouses, movements] = await Promise.all([
      db.products.where('companyId').equals(company.id).toArray(),
      db.warehouses.where('companyId').equals(company.id).toArray(),
      db.stockMovements.where('companyId').equals(company.id).toArray(),
    ]);
    const precision = currencyPrecision(company.currency);
    const sorted = [...warehouses].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(a.archived) - Number(b.archived) ||
        localName(a).localeCompare(localName(b)),
    );
    return {
      products,
      stockItems: products.filter(isStockItem),
      warehouses: sorted,
      defaultWarehouse: sorted.find((w) => w.isDefault && !w.archived),
      movements,
      levels: stockLevels(movements, precision),
      precision,
    };
  }, [company.id, company.currency]);
}

/** Stock items at or below their reorder level. */
export function isLowStock(item: Product, level: StockLevel | undefined): boolean {
  if (item.reorderLevel === null || item.reorderLevel === undefined) return false;
  return (level?.quantity ?? 0) <= item.reorderLevel;
}

/** Quantity of an item in one warehouse (or all of them). */
export function onHand(level: StockLevel | undefined, warehouseId?: ID | null): number {
  if (!level) return 0;
  return warehouseId ? (level.byWarehouse.get(warehouseId) ?? 0) : level.quantity;
}

/** Formats a unit price or unit cost, keeping up to 6 decimals (e.g. KD 0.333333). */
export function useUnitAmount(): (amount: number) => string {
  const company = useCompany();
  const fmt = useFormat();
  return (amount) =>
    formatUnitPrice(amount, company.currency, fmt.locale, company.currencyDisplay ?? 'local');
}
