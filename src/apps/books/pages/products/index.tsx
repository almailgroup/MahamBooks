import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  Boxes,
  Download,
  History,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createProduct } from '@/db/defaults';
import { deleteItem, productKind, saveItem } from '@/db/inventory';
import type { Product, ProductKind } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { downloadCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import { fromMinor, toMinor } from '@/lib/money';
import { unitText } from '@/lib/units';
import { currentLanguage, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Spinner,
  Stat,
} from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { KIND_LABELS, PRODUCT_KINDS } from '@/apps/books/features/inventory/labels';
import {
  isLowStock,
  useInventory,
  useUnitAmount,
} from '@/apps/books/features/inventory/use-inventory';
import { usePrint } from '@/apps/books/features/reports/report-toolbar';
import { ProductThumb, useProductThumbs } from '@/apps/books/features/inventory/product-image';
import { ItemDialog } from './item-dialog';
import { ItemListPrint, type ItemListKind } from './item-list-print';

type KindFilter = 'all' | ProductKind | 'low';

const KIND_TONE = { service: 'gray', non_stock: 'blue', stock: 'violet' } as const;

export default function ProductsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const unitAmount = useUnitAmount();
  const [params, setParams] = useSearchParams();
  // Settings → Cloud links an SKU that two items share here.
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [kindFilter, setKindFilter] = useState<KindFilter>(() =>
    params.get('filter') === 'low' ? 'low' : 'all',
  );
  const [editing, setEditing] = useState<Product | null>(() => {
    if (!params.get('new')) return null;
    const kind = params.get('kind');
    return createProduct(company.id, {
      taxRateIds: company.defaults.defaultTaxRateIds,
      kind: kind === 'stock' || kind === 'non_stock' ? kind : 'service',
    });
  });

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const { print, portal } = usePrint();
  const inventory = useInventory();
  const taxRates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const products = inventory?.products;

  const filtered = useMemo(() => {
    if (!products || !inventory) return [];
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (view === 'archived' ? p.archived : !p.archived))
      .filter((p) =>
        kindFilter === 'all'
          ? true
          : kindFilter === 'low'
            ? productKind(p) === 'stock' && isLowStock(p, inventory.levels.get(p.id))
            : productKind(p) === kindFilter,
      )
      .filter(
        (p) =>
          !q ||
          `${p.name} ${p.nameAr ?? ''} ${p.sku} ${p.barcode ?? ''} ${p.description}`
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => localName(a).localeCompare(localName(b)));
  }, [products, inventory, query, view, kindFilter]);

  // Items sharing an SKU (another device gave the same code offline): shown
  // once codes are given, so one of them can be changed.
  const sameSku = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of products ?? []) {
      const key = p.sku.trim().toLowerCase();
      if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return (p: Product) =>
      Boolean(company.items?.autoSku) && (seen.get(p.sku.trim().toLowerCase()) ?? 0) > 1;
  }, [products, company.items?.autoSku]);

  // Items have pictures once the owner turns them on (Settings → Items and units).
  const pictures = Boolean(company.items?.images);
  const thumbs = useProductThumbs(filtered, pictures);

  if (!products || !inventory || !taxRates) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const live = products.filter((p) => !p.archived);
  const archivedCount = products.length - live.length;
  const stockItems = live.filter((p) => productKind(p) === 'stock');
  const stockValue = stockItems.reduce(
    (sum, p) => sum + toMinor(inventory.levels.get(p.id)?.value ?? 0, inventory.precision),
    0,
  );
  const low = stockItems.filter((p) => isLowStock(p, inventory.levels.get(p.id)));
  const counts: Record<ProductKind, number> = { service: 0, non_stock: 0, stock: 0 };
  for (const p of live) counts[productKind(p)] += 1;

  const rateLabel = (p: Product) =>
    p.taxRateIds
      .map((id) => taxRates.find((r) => r.id === id))
      .filter(Boolean)
      .map((r) => `${r!.name} ${r!.rate}%`)
      .join(', ');

  const openNew = (kind: ProductKind = 'service') =>
    setEditing(createProduct(company.id, { taxRateIds: company.defaults.defaultTaxRateIds, kind }));
  const close = () => {
    setEditing(null);
    if (params.get('new')) setParams({}, { replace: true });
  };

  const remove = async (p: Product) => {
    const ok = await confirm({
      title: t('Delete {name}?', { name: p.name }),
      description: t('Existing invoices keep their copy of this item.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteItem(p.id);
      toast.success(t('{name} deleted', { name: p.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not delete.'));
    }
  };

  const toggleArchive = async (p: Product) => {
    try {
      await saveItem({ ...p, archived: !p.archived });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  const language = currentLanguage();
  const unitOf = (p: Product) => unitText(company, p, language);
  const shown = new Set(filtered.map((p) => p.id));
  const picked = [...selected].filter((id) => shown.has(id));
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const labelsFor = (ids: string[]) =>
    navigate(ids.length ? `/products/labels?ids=${ids.join(',')}` : '/products/labels');
  const printList = (kind: ItemListKind) =>
    print(
      <ItemListPrint
        company={company}
        kind={kind}
        products={filtered}
        onHand={(p) =>
          productKind(p) === 'stock' ? (inventory.levels.get(p.id)?.quantity ?? 0) : null
        }
        formatPrice={unitAmount}
        formatDate={fmt.date}
        formatQuantity={fmt.quantity}
      />,
    );

  const exportCsv = () =>
    downloadCsv(
      `products-${today()}`,
      [
        t('SKU'),
        t('Name'),
        t('Arabic name'),
        t('Type'),
        t('Description'),
        t('Selling price'),
        t('Cost price'),
        t('Unit'),
        t('On hand'),
        t('Stock value'),
        t('Reorder level'),
        t('Barcode'),
        t('HS code'),
        t('Taxes'),
        t('Archived'),
      ],
      filtered.map((p) => {
        const stock = productKind(p) === 'stock';
        const level = inventory.levels.get(p.id);
        return [
          p.sku,
          p.name,
          p.nameAr ?? '',
          t(KIND_LABELS[productKind(p)].label),
          p.description,
          p.unitPrice,
          p.costPrice ?? '',
          p.unit,
          stock ? (level?.quantity ?? 0) : '',
          stock ? (level?.value ?? 0) : '',
          p.reorderLevel ?? '',
          p.barcode ?? '',
          p.hsCode ?? '',
          rateLabel(p),
          p.archived ? t('Yes') : t('No'),
        ];
      }),
    );

  return (
    <div>
      <PageHeader
        title={t('Products & services')}
        description={t('What you sell and buy, with prices, and stock for the goods you keep.')}
        actions={
          <>
            {products.length > 0 ? (
              <DropdownMenu>
                <DropdownTrigger asChild>
                  <Button variant="outline">
                    <Printer /> {t('Print')}
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownItem icon={<Printer />} onSelect={() => printList('items')}>
                    {t('Product list')}
                  </DropdownItem>
                  <DropdownItem icon={<Printer />} onSelect={() => printList('prices')}>
                    {t('Price list')}
                  </DropdownItem>
                  <DropdownItem icon={<QrCode />} onSelect={() => labelsFor([])}>
                    {t('Print labels')}
                  </DropdownItem>
                </DropdownContent>
              </DropdownMenu>
            ) : null}
            {products.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> {t('Export CSV')}
              </Button>
            ) : null}
            <Button onClick={() => openNew()}>
              <Plus /> {t('New item')}
            </Button>
          </>
        }
      />

      {stockItems.length > 0 ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat
            label={t('Stock value')}
            value={fmt.money(fromMinor(stockValue, inventory.precision))}
            hint={t('At weighted average cost')}
          />
          <Stat label={t('Stock items')} value={fmt.quantity(stockItems.length)} />
          <Stat
            label={t('Low stock')}
            value={fmt.quantity(low.length)}
            tone={low.length ? 'danger' : 'default'}
            hint={
              low.length ? (
                <Link to="/reports/low-stock" className="text-primary-700 hover:underline">
                  {t('See what to reorder')}
                </Link>
              ) : (
                t('Nothing to reorder')
              )
            }
          />
        </div>
      ) : null}

      {products.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Package />}
            title={t('No products or services yet')}
            description={t(
              'Add what you sell, such as delivery or printing, and the goods you keep in stock, with their prices.',
            )}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => openNew()}>
                  <Plus /> {t('New item')}
                </Button>
                <Button variant="outline" onClick={() => openNew('stock')}>
                  <Boxes /> {t('New stock item')}
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center md:justify-between">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'active', label: t('Active'), count: live.length },
                { value: 'archived', label: t('Archived'), count: archivedCount },
              ]}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                aria-label={t('Show')}
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as KindFilter)}
                className="sm:w-48"
              >
                <option value="all">{t('All types')}</option>
                {PRODUCT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(KIND_LABELS[k].plural)} ({fmt.quantity(counts[k])})
                  </option>
                ))}
                <option value="low">
                  {t('Low stock')} ({fmt.quantity(low.length)})
                </option>
              </Select>
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search…')}
                  className="ps-9"
                  aria-label={t('Search products')}
                />
              </div>
            </div>
          </div>
          {picked.length > 0 ? (
            <div
              role="region"
              aria-label={t('Selected items')}
              className="bg-primary-50/60 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2"
            >
              <p className="text-sm font-medium text-slate-700">
                {tp(picked.length, '{count} selected', '{count} selected')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => labelsFor(picked)}>
                  <QrCode /> {t('Print labels')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  <X /> {t('Clear selection')}
                </Button>
              </div>
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">{t('Nothing matches.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                  <tr>
                    <th className="w-10 py-2.5 ps-4">
                      <input
                        type="checkbox"
                        aria-label={t('Select all')}
                        className="accent-primary-600 size-4 align-middle"
                        checked={picked.length === filtered.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(shown) : new Set())}
                      />
                    </th>
                    <th className="w-full px-4 py-2.5 text-start font-medium">{t('Item')}</th>
                    <th className="hidden px-3 py-2.5 text-start font-medium md:table-cell">
                      {t('Type')}
                    </th>
                    <th className="hidden px-3 py-2.5 text-end font-medium sm:table-cell">
                      {t('Price')}
                    </th>
                    <th className="hidden px-3 py-2.5 text-end font-medium sm:table-cell">
                      {t('On hand')}
                    </th>
                    <th className="hidden px-3 py-2.5 text-end font-medium lg:table-cell">
                      {t('Stock value')}
                    </th>
                    <th className="w-12 px-2 py-2.5">
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((p) => {
                    const kind = productKind(p);
                    const level = inventory.levels.get(p.id);
                    const isLow = kind === 'stock' && isLowStock(p, level);
                    const quantity =
                      kind === 'stock'
                        ? `${fmt.quantity(level?.quantity ?? 0)}${unitOf(p) ? ` ${unitOf(p)}` : ''}`
                        : null;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-2.5 ps-4 align-top">
                          <input
                            type="checkbox"
                            aria-label={t('Select {name}', { name: localName(p) })}
                            className="accent-primary-600 mt-0.5 size-4"
                            checked={selected.has(p.id)}
                            onChange={(e) => toggle(p.id, e.target.checked)}
                          />
                        </td>
                        <td className="max-w-0 px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setEditing(p)}
                            className="flex w-full min-w-0 items-center gap-3 text-start"
                          >
                            {pictures ? <ProductThumb src={thumbs.get(p.id)} /> : null}
                            <span className="block min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium text-slate-900">
                                  {localName(p)}
                                </span>
                                {sameSku(p) ? (
                                  <Badge tone="amber">{t('Same SKU as another item')}</Badge>
                                ) : null}
                              </span>
                              <span className="block truncate text-xs text-slate-500">
                                {[
                                  p.sku,
                                  localName(p) === p.name ? p.nameAr : p.name,
                                  p.description,
                                  rateLabel(p),
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || t(KIND_LABELS[kind].label)}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 sm:hidden">
                                <span className="tabular">
                                  {unitAmount(p.unitPrice)}
                                  {unitOf(p) ? ` / ${unitOf(p)}` : ''}
                                </span>
                                {quantity ? (
                                  <span>{t('{quantity} on hand', { quantity })}</span>
                                ) : null}
                                {isLow ? <Badge tone="red">{t('Low stock')}</Badge> : null}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          <Badge tone={KIND_TONE[kind]}>{t(KIND_LABELS[kind].label)}</Badge>
                        </td>
                        <td className="tabular hidden px-3 py-2.5 text-end whitespace-nowrap text-slate-900 sm:table-cell">
                          {unitAmount(p.unitPrice)}
                          {unitOf(p) ? (
                            <span className="text-slate-500"> / {unitOf(p)}</span>
                          ) : null}
                        </td>
                        <td className="tabular hidden px-3 py-2.5 text-end whitespace-nowrap sm:table-cell">
                          {quantity ? (
                            <span className="inline-flex items-center gap-1.5">
                              {isLow ? <Badge tone="red">{t('Low stock')}</Badge> : null}
                              <span
                                className={
                                  (level?.quantity ?? 0) < 0 ? 'text-red-600' : 'text-slate-900'
                                }
                              >
                                {quantity}
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="tabular hidden px-3 py-2.5 text-end whitespace-nowrap text-slate-700 lg:table-cell">
                          {kind === 'stock' ? (
                            fmt.money(level?.value ?? 0)
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-end">
                          <DropdownMenu>
                            <DropdownTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('Actions for {name}', { name: localName(p) })}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownTrigger>
                            <DropdownContent>
                              <DropdownItem icon={<Pencil />} onSelect={() => setEditing(p)}>
                                {t('Edit')}
                              </DropdownItem>
                              {p.sku.trim() ? (
                                <DropdownItem icon={<QrCode />} onSelect={() => labelsFor([p.id])}>
                                  {t('Print label')}
                                </DropdownItem>
                              ) : null}
                              {kind === 'stock' && !p.archived ? (
                                <>
                                  <DropdownItem
                                    icon={<SlidersHorizontal />}
                                    onSelect={() =>
                                      navigate(`/inventory/adjustments/new?item=${p.id}`)
                                    }
                                  >
                                    {t('Adjust stock')}
                                  </DropdownItem>
                                  <DropdownItem
                                    icon={<History />}
                                    onSelect={() =>
                                      navigate(`/reports/stock-movements?item=${p.id}`)
                                    }
                                  >
                                    {t('Stock movements')}
                                  </DropdownItem>
                                </>
                              ) : null}
                              <DropdownItem
                                icon={p.archived ? <ArchiveRestore /> : <Archive />}
                                onSelect={() => void toggleArchive(p)}
                              >
                                {p.archived ? t('Restore') : t('Archive')}
                              </DropdownItem>
                              <DropdownSeparator />
                              <DropdownItem
                                icon={<Trash2 />}
                                danger
                                onSelect={() => void remove(p)}
                              >
                                {t('Delete')}
                              </DropdownItem>
                            </DropdownContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {portal}
      {editing ? (
        <ItemDialog
          key={editing.id}
          product={editing}
          taxRates={taxRates}
          inventory={inventory}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
