import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useCompany } from '@/app/company';
import { useInventory } from '@/apps/books/features/inventory/use-inventory';
import { ItemDialog } from '@/apps/books/pages/products/item-dialog';

/** The item dialog of a product found in the palette (items have no page of their own). */
export function ItemOpener({ id, onClose }: { id: string; onClose: () => void }) {
  const company = useCompany();
  const product = useLiveQuery(() => db.products.get(id), [id]);
  const taxRates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const inventory = useInventory();
  if (!product || !taxRates || !inventory) return null;
  return (
    <ItemDialog
      key={product.id}
      product={product}
      taxRates={taxRates}
      inventory={inventory}
      onClose={onClose}
    />
  );
}

export default ItemOpener;
