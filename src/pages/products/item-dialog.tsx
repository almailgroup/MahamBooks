import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Package, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { saveItem, type OpeningStockInput } from '@/db/inventory';
import { isVendor } from '@/db/purchases';
import type { Product, ProductKind, TaxRate } from '@/db/types';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { KIND_LABELS, PRODUCT_KINDS } from '@/features/inventory/labels';
import type { InventoryData } from '@/features/inventory/use-inventory';

const KIND_ICONS: Record<ProductKind, typeof Package> = {
  service: Wrench,
  non_stock: Package,
  stock: Boxes,
};

/** Creates or edits an item: a service, a non-stock item or a stock item. */
export function ItemDialog({
  product,
  taxRates,
  inventory,
  onClose,
}: {
  product: Product;
  taxRates: TaxRate[];
  inventory: InventoryData;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(product);
  const [opening, setOpening] = useState<OpeningStockInput>({
    warehouseId: inventory.defaultWarehouse?.id ?? '',
    quantity: 0,
    unitCost: product.costPrice ?? 0,
    date: today(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Product>) => setDraft((d) => ({ ...d, ...patch }));
  const isNew = !product.name;
  const kind = draft.kind ?? 'service';
  const wasKind = product.kind ?? 'service';
  // A stock item with movements stays one (see saveItem).
  const locked =
    !isNew && wasKind === 'stock' && inventory.movements.some((m) => m.productId === product.id);
  const startsTracking = !isNew && wasKind !== 'stock' && kind === 'stock';
  const warehouses = inventory.warehouses.filter((w) => !w.archived);

  const data = useLiveQuery(async () => {
    const [accounts, contacts] = await Promise.all([
      db.accounts.where('companyId').equals(product.companyId).sortBy('code'),
      db.clients.where('companyId').equals(product.companyId).toArray(),
    ]);
    return {
      incomeAccounts: accounts.filter(
        (a) =>
          (a.type === 'income' || a.type === 'income_other') &&
          (!a.archived || a.id === product.incomeAccountId),
      ),
      vendors: contacts
        .filter((c) => (isVendor(c) && !c.archived) || c.id === product.preferredVendorId)
        .sort((a, b) => localName(a).localeCompare(localName(b))),
    };
  }, [product.companyId, product.incomeAccountId, product.preferredVendorId]);

  const save = async () => {
    if (!draft.name.trim()) {
      setError(t('Enter a name for the item.'));
      return;
    }
    setSaving(true);
    try {
      const openingStock =
        isNew && kind === 'stock' && opening.quantity > 0
          ? { ...opening, unitCost: draft.costPrice ?? 0 }
          : null;
      await saveItem({ ...draft, kind }, { opening: openingStock });
      toast.success(t('{name} saved', { name: draft.name.trim() }));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
      setSaving(false);
    }
  };

  const salesAccount = data?.incomeAccounts.find((a) => a.role === 'sales');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={isNew ? t('New item') : t('Edit {name}', { name: product.name })}
        size="lg"
      >
        <DialogBody>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">{t('Type')}</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              {PRODUCT_KINDS.map((k) => {
                const Icon = KIND_ICONS[k];
                const on = kind === k;
                const disabled = locked && k !== 'stock';
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => set({ kind: k })}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      on
                        ? 'border-primary-500 bg-primary-50/60 ring-primary-500/20 ring-2'
                        : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        on ? 'text-primary-600' : 'text-slate-400',
                      )}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">
                        {t(KIND_LABELS[k].label)}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {t(KIND_LABELS[k].hint)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {locked ? (
              <p className="mt-2 text-xs text-slate-500">
                {t('This item has stock history, so it stays a stock item.')}
              </p>
            ) : null}
            {startsTracking ? (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t(
                  'Bills and invoices already issued with this item will move stock from their dates.',
                )}
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('Name')} className="sm:col-span-2" error={error}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(e) => {
                    set({ name: e.target.value });
                    setError('');
                  }}
                  autoFocus
                  aria-invalid={Boolean(error)}
                />
              )}
            </Field>
            <Field label={t('SKU / code')} optional>
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  value={draft.sku}
                  onChange={(e) => set({ sku: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            label={t('Arabic name')}
            optional
            hint={t('Printed on Arabic and bilingual documents.')}
          >
            {(id) => (
              <Input
                id={id}
                dir="rtl"
                lang="ar"
                value={draft.nameAr ?? ''}
                onChange={(e) => set({ nameAr: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Description')} optional hint={t('Copied onto invoice lines.')}>
              {(id) => (
                <Textarea
                  id={id}
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={2}
                />
              )}
            </Field>
            <Field
              label={t('Arabic description')}
              optional
              hint={t('Used instead of the description on Arabic documents.')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  dir="rtl"
                  lang="ar"
                  value={draft.descriptionAr ?? ''}
                  onChange={(e) => set({ descriptionAr: e.target.value })}
                  rows={2}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('Selling price')} hint={t('Up to 6 decimals, e.g. 0.537 per piece.')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.unitPrice}
                  onValueChange={(unitPrice) => set({ unitPrice })}
                />
              )}
            </Field>
            {kind !== 'service' ? (
              <Field
                label={t('Cost price')}
                hint={
                  kind === 'stock'
                    ? t('Rate on new bills and the cost of the opening stock.')
                    : t('Rate on new bills.')
                }
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={draft.costPrice ?? 0}
                    allowNegative={false}
                    onValueChange={(costPrice) => set({ costPrice })}
                  />
                )}
              </Field>
            ) : null}
            <Field label={t('Unit')} optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.unit}
                  onChange={(e) => set({ unit: e.target.value })}
                  placeholder={t('pcs, box, kg, hrs…')}
                />
              )}
            </Field>
          </div>

          {kind === 'stock' ? (
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('Reorder level')}
                  optional
                  hint={t('Shown as low stock at or below this quantity.')}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={draft.reorderLevel ?? 0}
                      blankZero
                      allowNegative={false}
                      onValueChange={(v) => set({ reorderLevel: v > 0 ? v : null })}
                    />
                  )}
                </Field>
                <Field label={t('Preferred vendor')} optional>
                  {(id) => (
                    <Combobox
                      id={id}
                      value={draft.preferredVendorId ?? null}
                      onChange={(v) => set({ preferredVendorId: v || null })}
                      options={[
                        { value: '', label: t('None') },
                        ...(data?.vendors ?? []).map((v) => ({
                          value: v.id,
                          label: localName(v),
                        })),
                      ]}
                      placeholder={t('Choose a vendor…')}
                      searchPlaceholder={t('Search vendors…')}
                    />
                  )}
                </Field>
                <Field label={t('Barcode')} optional>
                  {(id) => (
                    <Input
                      id={id}
                      dir="ltr"
                      inputMode="numeric"
                      value={draft.barcode ?? ''}
                      onChange={(e) => set({ barcode: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('HS code')} optional hint={t('Customs tariff code.')}>
                  {(id) => (
                    <Input
                      id={id}
                      dir="ltr"
                      value={draft.hsCode ?? ''}
                      onChange={(e) => set({ hsCode: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              {isNew ? (
                <div>
                  <p className="text-sm font-medium text-slate-700">{t('Opening stock')}</p>
                  <p className="mb-3 text-xs text-slate-500">
                    {t('What you have now, valued at the cost price. You can add it later.')}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t('Quantity')}>
                      {(id) => (
                        <NumberInput
                          id={id}
                          value={opening.quantity}
                          blankZero
                          allowNegative={false}
                          onValueChange={(quantity) => setOpening((o) => ({ ...o, quantity }))}
                        />
                      )}
                    </Field>
                    <Field label={t('As of')}>
                      {(id) => (
                        <Input
                          id={id}
                          type="date"
                          value={opening.date}
                          onChange={(e) =>
                            e.target.value && setOpening((o) => ({ ...o, date: e.target.value }))
                          }
                        />
                      )}
                    </Field>
                    {warehouses.length > 1 ? (
                      <Field label={t('Warehouse')}>
                        {(id) => (
                          <Select
                            id={id}
                            value={opening.warehouseId}
                            onChange={(e) =>
                              setOpening((o) => ({ ...o, warehouseId: e.target.value }))
                            }
                          >
                            {warehouses.map((w) => (
                              <option key={w.id} value={w.id}>
                                {localName(w)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <Field
            label={t('Income account')}
            hint={t('Where sales of this item are recorded in your books.')}
          >
            {(id) => (
              <Select
                id={id}
                value={draft.incomeAccountId ?? ''}
                onChange={(e) => set({ incomeAccountId: e.target.value || null })}
              >
                <option value="">
                  {t('{account} (default)', {
                    account: salesAccount ? localName(salesAccount) : t('Sales'),
                  })}
                </option>
                {(data?.incomeAccounts ?? [])
                  .filter((a) => a.role !== 'sales')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {localName(a)}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {taxRates.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">{t('Default taxes')}</p>
              <div className="flex flex-wrap gap-2">
                {taxRates.map((rate) => {
                  const on = draft.taxRateIds.includes(rate.id);
                  return (
                    <button
                      key={rate.id}
                      type="button"
                      onClick={() =>
                        set({
                          taxRateIds: on
                            ? draft.taxRateIds.filter((id) => id !== rate.id)
                            : [...draft.taxRateIds, rate.id],
                        })
                      }
                      className={cn(
                        'rounded-full px-3 py-1 text-sm ring-1 transition-colors',
                        on
                          ? 'bg-primary-600 ring-primary-600 text-white'
                          : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400',
                      )}
                      aria-pressed={on}
                    >
                      {rate.name} {rate.rate}%
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
