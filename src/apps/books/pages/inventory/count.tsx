import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipboardCheck, Download, Printer, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { recordStockEntry } from '@/db/inventory';
import type { ID } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { stockLevels } from '@/lib/inventory/costing';
import { countSheetRows, parseCountSheet } from '@/lib/inventory/count';
import { downloadCsv } from '@/lib/csv';
import { dec, fromMinor, normalizeDigits, toMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { useInventory } from '@/apps/books/features/inventory/use-inventory';
import { DateField } from '@/components/ui/date-field';

const draftKey = (companyId: ID, warehouseId: ID) => `stock-count:${companyId}:${warehouseId}`;

function loadDraft(key: string): Record<ID, string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<ID, string>) : {};
  } catch {
    return {};
  }
}

function parseCount(text: string): number | null {
  const cleaned = normalizeDigits(text).replace(/[\s,]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A stock count: the quantity on record per item in a warehouse, what was
 * counted, and the differences posted as one adjustment.
 */
export default function StockCountPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const inventory = useInventory();
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState(today());
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<ID, string>>({});
  const [loadedKey, setLoadedKey] = useState('');
  const [posting, setPosting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const warehouse = warehouseId || inventory?.defaultWarehouse?.id || '';
  const key = warehouse ? draftKey(company.id, warehouse) : '';
  // Counts typed so far are kept in this browser until they are posted.
  if (key && key !== loadedKey) {
    setLoadedKey(key);
    setCounts(loadDraft(key));
  }
  useEffect(() => {
    if (!key || key !== loadedKey) return;
    try {
      if (Object.keys(counts).length) localStorage.setItem(key, JSON.stringify(counts));
      else localStorage.removeItem(key);
    } catch {
      // Storage unavailable: the count still works, it just isn't kept.
    }
  }, [counts, key, loadedKey]);

  const levels = useMemo(
    () => (inventory ? stockLevels(inventory.movements, inventory.precision, date) : null),
    [inventory, date],
  );

  if (!inventory || !levels) return <Spinner className="py-24" label={t('Loading…')} />;

  const p = inventory.precision;
  const items = inventory.stockItems
    .filter((i) => !i.archived)
    .sort((a, b) => localName(a).localeCompare(localName(b)));
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      !q || `${i.name} ${i.nameAr ?? ''} ${i.sku} ${i.barcode ?? ''}`.toLowerCase().includes(q),
  );
  const onRecord = (id: ID) => levels.get(id)?.byWarehouse.get(warehouse) ?? 0;
  const unitCost = (id: ID) => {
    const level = levels.get(id);
    return level && level.quantity > 0
      ? level.unitCost
      : (inventory.stockItems.find((i) => i.id === id)?.costPrice ?? 0);
  };
  const differences = items
    .map((i) => {
      const counted = parseCount(counts[i.id] ?? '');
      return counted === null
        ? null
        : {
            productId: i.id,
            quantity: dec(counted)
              .minus(dec(onRecord(i.id)))
              .toNumber(),
          };
    })
    .filter((d): d is { productId: ID; quantity: number } => d !== null);
  const changed = differences.filter((d) => d.quantity !== 0);
  const value = changed.reduce(
    (sum, d) => sum + toMinor(dec(d.quantity).times(dec(unitCost(d.productId))), p),
    0,
  );
  const warehouseName = localName(inventory.warehouses.find((w) => w.id === warehouse));

  const exportSheet = () =>
    downloadCsv(
      `stock-count-${date}`,
      [t('SKU'), t('Item'), t('Unit'), t('On record'), t('Counted')],
      countSheetRows(items, onRecord, (id) => parseCount(counts[id] ?? '')),
    );

  const importSheet = async (file: File) => {
    const result = parseCountSheet(await file.text(), items);
    if (result.counted.size === 0) {
      toast.error(t('No counted quantities were found in this file.'));
      return;
    }
    setCounts((c) => {
      const next = { ...c };
      for (const [id, n] of result.counted) next[id] = String(n);
      return next;
    });
    toast.success(
      tp(
        result.counted.size,
        '{count} count read from the file',
        '{count} counts read from the file',
      ),
    );
    const skipped = [...result.unmatched, ...result.invalid];
    if (skipped.length) {
      toast.warning(
        t('Not found or not a number: {items}', { items: skipped.slice(0, 5).join(', ') }),
      );
    }
  };

  const post = async () => {
    setPosting(true);
    try {
      const entry = await recordStockEntry(company.id, {
        kind: 'adjustment',
        date,
        warehouseId: warehouse,
        reason: 'count',
        reference: t('Stock count'),
        notes: '',
        lines: changed,
      });
      setCounts({});
      toast.success(t('{number} saved', { number: entry.number }));
      navigate(`/inventory/entries/${entry.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
      setPosting(false);
    }
  };

  const printLink = `/inventory/count/print?warehouse=${warehouse}&date=${date}`;

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/inventory" className="hover:text-slate-700">
            {t('Inventory')}
          </Link>
        }
        title={t('Stock count')}
        description={t(
          'Count what is on the shelves, then post the differences as one adjustment.',
        )}
        actions={
          items.length > 0 ? (
            <>
              <ButtonLink to={printLink} variant="outline">
                <Printer /> {t('Print sheet')}
              </ButtonLink>
              <Button variant="outline" onClick={exportSheet}>
                <Download /> {t('Export CSV')}
              </Button>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <Upload /> {t('Import counts')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label={t('Import counts')}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importSheet(file);
                  e.target.value = '';
                }}
              />
            </>
          ) : null
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title={t('No stock items yet')}
            description={t('Stock items you add show here to be counted.')}
            action={<ButtonLink to="/products?new=1&kind=stock">{t('New stock item')}</ButtonLink>}
          />
        </Card>
      ) : (
        <Card>
          <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {t('Warehouse')}
              </span>
              <Select value={warehouse} onChange={(e) => setWarehouseId(e.target.value)}>
                {inventory.warehouses
                  .filter((w) => !w.archived)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {localName(w)}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {t('Count date')}
              </span>
              <DateField value={date} onChange={(iso) => iso && setDate(iso)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('Search')}</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search items…')}
                  className="ps-9"
                />
              </span>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                <tr>
                  <th className="w-full px-4 py-2.5 text-start font-medium">{t('Item')}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t('On record')}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t('Counted')}</th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('Difference')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((item) => {
                  const counted = parseCount(counts[item.id] ?? '');
                  const difference =
                    counted === null
                      ? null
                      : dec(counted)
                          .minus(dec(onRecord(item.id)))
                          .toNumber();
                  return (
                    <tr key={item.id}>
                      <td className="max-w-0 px-4 py-2">
                        <span className="line-clamp-2 font-medium break-words text-slate-900">
                          {localName(item)}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {[item.sku, item.unit].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2 text-end text-slate-600">
                        {fmt.quantity(onRecord(item.id))}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          dir="ltr"
                          inputMode="decimal"
                          value={counts[item.id] ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [item.id]: e.target.value }))}
                          aria-label={t('Counted quantity of {name}', { name: localName(item) })}
                          aria-invalid={(counts[item.id] ?? '').trim() !== '' && counted === null}
                          className="tabular w-20 text-end sm:w-28"
                        />
                      </td>
                      <td
                        className={cn(
                          'tabular px-4 py-2 text-end font-medium whitespace-nowrap',
                          difference === null || difference === 0
                            ? 'text-slate-500'
                            : difference < 0
                              ? 'text-red-600'
                              : 'text-emerald-700',
                        )}
                      >
                        {difference === null
                          ? '—'
                          : `${difference > 0 ? '+' : ''}${fmt.quantity(difference)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              {tp(differences.length, '{count} item counted', '{count} items counted')} ·{' '}
              {tp(changed.length, '{count} difference', '{count} differences')}
              {changed.length ? (
                <>
                  {' '}
                  ·{' '}
                  {t('worth {amount} at average cost', { amount: fmt.money(fromMinor(value, p)) })}
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(counts).length ? (
                <Button variant="ghost" onClick={() => setCounts({})}>
                  {t('Clear counts')}
                </Button>
              ) : null}
              <Button onClick={post} loading={posting} disabled={changed.length === 0}>
                {t('Post adjustment')}
              </Button>
            </div>
          </div>
        </Card>
      )}
      {warehouseName ? (
        <p className="mt-3 text-xs text-slate-500">
          {t('Counts typed here are kept in this browser until you post them.')}
        </p>
      ) : null}
    </div>
  );
}
