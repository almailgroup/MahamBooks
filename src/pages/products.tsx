import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  Download,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createProduct } from '@/db/defaults';
import { deleteProduct, saveProduct } from '@/db/records';
import type { Product, TaxRate } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { formatUnitPrice } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';

function ProductDialog({
  product,
  taxRates,
  onClose,
}: {
  product: Product;
  taxRates: TaxRate[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(product);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<Product>) => setDraft((d) => ({ ...d, ...patch }));
  const isNew = !product.name;
  const incomeAccounts = useLiveQuery(
    () =>
      db.accounts
        .where('companyId')
        .equals(product.companyId)
        .filter(
          (a) =>
            (a.type === 'income' || a.type === 'income_other') &&
            (!a.archived || a.id === product.incomeAccountId),
        )
        .sortBy('code'),
    [product.companyId, product.incomeAccountId],
  );

  const save = async () => {
    if (!draft.name.trim()) {
      setError('Please enter a name.');
      return;
    }
    setSaving(true);
    try {
      await saveProduct(draft);
      toast.success(`${draft.name.trim()} saved`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={isNew ? 'New product or service' : `Edit ${product.name}`}>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" className="sm:col-span-2" error={error}>
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
            <Field label="SKU / code" optional>
              {(id) => (
                <Input id={id} value={draft.sku} onChange={(e) => set({ sku: e.target.value })} />
              )}
            </Field>
          </div>
          <Field label="Description" optional hint="Copied onto invoice lines.">
            {(id) => (
              <Textarea
                id={id}
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                rows={2}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit price" hint="Up to 6 decimals, e.g. 0.537 per piece.">
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.unitPrice}
                  onValueChange={(unitPrice) => set({ unitPrice })}
                />
              )}
            </Field>
            <Field label="Unit" optional>
              {(id) => (
                <Input
                  id={id}
                  value={draft.unit}
                  onChange={(e) => set({ unit: e.target.value })}
                  placeholder="pcs, hrs, kg, job…"
                />
              )}
            </Field>
          </div>
          <Field label="Income account" hint="Where sales of this item are recorded in your books.">
            {(id) => (
              <Select
                id={id}
                value={draft.incomeAccountId ?? ''}
                onChange={(e) => set({ incomeAccountId: e.target.value || null })}
              >
                <option value="">
                  {incomeAccounts?.find((a) => a.role === 'sales')?.name ?? 'Sales'} (default)
                </option>
                {(incomeAccounts ?? [])
                  .filter((a) => a.role !== 'sales')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Default taxes</p>
            {taxRates.length === 0 ? (
              <p className="text-sm text-slate-500">
                No tax rates yet — add them in Settings → Taxes.
              </p>
            ) : (
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
                            ? draft.taxRateIds.filter((t) => t !== rate.id)
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
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<Product | null>(() =>
    params.get('new') ? createProduct(company.id) : null,
  );

  const products = useLiveQuery(
    () => db.products.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const taxRates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (view === 'archived' ? p.archived : !p.archived))
      .filter((p) => !q || `${p.name} ${p.sku} ${p.description}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, query, view]);

  if (!products || !taxRates) return <Spinner className="py-24" label="Loading…" />;

  const archivedCount = products.filter((p) => p.archived).length;
  const rateLabel = (p: Product) =>
    p.taxRateIds
      .map((id) => taxRates.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => `${t!.name} ${t!.rate}%`)
      .join(', ');

  const openNew = () =>
    setEditing(createProduct(company.id, { taxRateIds: company.defaults.defaultTaxRateIds }));
  const close = () => {
    setEditing(null);
    if (params.get('new')) setParams({}, { replace: true });
  };

  const remove = async (p: Product) => {
    const ok = await confirm({
      title: `Delete ${p.name}?`,
      description: 'Existing invoices keep their copy of this item.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteProduct(p.id);
    toast.success('Deleted');
  };

  return (
    <div>
      <PageHeader
        title="Products & services"
        description="Save what you sell to add it to invoices in one click."
        actions={
          <>
            {products.length > 0 ? (
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv(
                    `products-${today()}`,
                    ['SKU', 'Name', 'Description', 'Unit price', 'Unit', 'Taxes', 'Archived'],
                    filtered.map((p) => [
                      p.sku,
                      p.name,
                      p.description,
                      p.unitPrice,
                      p.unit,
                      rateLabel(p),
                      p.archived ? 'yes' : 'no',
                    ]),
                  )
                }
              >
                <Download /> Export CSV
              </Button>
            ) : null}
            <Button onClick={openNew}>
              <Plus /> New item
            </Button>
          </>
        }
      />

      {products.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title="No products or services yet"
            description="Add the services you sell, like printing, postage or courier delivery, with their prices."
            action={
              <Button onClick={openNew}>
                <Plus /> New item
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'active', label: 'Active', count: products.length - archivedCount },
                { value: 'archived', label: 'Archived', count: archivedCount },
              ]}
            />
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="ps-9"
                aria-label="Search products"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">Nothing matches.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <li key={p.id} className="flex items-center gap-4 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="min-w-0 flex-1 text-start"
                  >
                    <span className="block truncate font-medium text-slate-900">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[p.sku, p.description, rateLabel(p)].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </button>
                  <span className="tabular shrink-0 text-end text-sm text-slate-900">
                    {formatUnitPrice(p.unitPrice, company.currency, fmt.locale)}
                    {p.unit ? <span className="text-slate-500"> / {p.unit}</span> : null}
                  </span>
                  <DropdownMenu>
                    <DropdownTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownTrigger>
                    <DropdownContent>
                      <DropdownItem icon={<Pencil />} onSelect={() => setEditing(p)}>
                        Edit
                      </DropdownItem>
                      <DropdownItem
                        icon={p.archived ? <ArchiveRestore /> : <Archive />}
                        onSelect={() => void saveProduct({ ...p, archived: !p.archived })}
                      >
                        {p.archived ? 'Restore' : 'Archive'}
                      </DropdownItem>
                      <DropdownSeparator />
                      <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove(p)}>
                        Delete
                      </DropdownItem>
                    </DropdownContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {editing ? (
        <ProductDialog key={editing.id} product={editing} taxRates={taxRates} onClose={close} />
      ) : null}
    </div>
  );
}
