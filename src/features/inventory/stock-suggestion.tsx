import type { Product } from '@/db/types';
import { useFormat } from '@/app/company';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import type { InventoryData } from './use-inventory';

/** "12 in stock" under a stock item in the item suggestions. */
export function StockSuggestion({
  inventory,
  product,
}: {
  inventory: InventoryData;
  product: Product;
}) {
  const fmt = useFormat();
  if (product.kind !== 'stock') return null;
  const quantity = inventory.levels.get(product.id)?.quantity ?? 0;
  return (
    <span className={cn('block text-xs', quantity > 0 ? 'text-emerald-700' : 'text-amber-700')}>
      {t('{quantity} in stock', {
        quantity: `${fmt.quantity(quantity)}${product.unit ? ` ${product.unit}` : ''}`,
      })}
    </span>
  );
}
