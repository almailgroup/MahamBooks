import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import { useCompany, useFormat } from '@/app/company';
import { stockLevels } from '@/lib/inventory/costing';
import { today } from '@/lib/dates';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { useInventory } from '@/features/inventory/use-inventory';

/** A stock count sheet to print and fill in by hand. */
export default function StockCountPrintPage() {
  const company = useCompany();
  const fmt = useFormat();
  const [params] = useSearchParams();
  const inventory = useInventory();
  const date = params.get('date') || today();
  const showRecord = params.get('blind') !== '1';
  const levels = useMemo(
    () => (inventory ? stockLevels(inventory.movements, inventory.precision, date) : null),
    [inventory, date],
  );
  if (!inventory || !levels) return <Spinner className="min-h-dvh" label={t('Loading…')} />;

  const warehouse =
    inventory.warehouses.find((w) => w.id === params.get('warehouse')) ??
    inventory.defaultWarehouse;
  const items = inventory.stockItems
    .filter((i) => !i.archived)
    .sort((a, b) => localName(a).localeCompare(localName(b)));

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link
          to="/inventory/count"
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> {t('Stock count')}
        </Link>
        <Button onClick={() => window.print()}>
          <Printer /> {t('Print')}
        </Button>
      </div>
      <article className="paper mx-auto max-w-4xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200 sm:p-8 print:max-w-none print:p-0 print:shadow-none print:ring-0">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500">{localName(company)}</p>
            <h1 className="text-xl font-semibold text-slate-900">{t('Stock count sheet')}</h1>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">{t('Warehouse')}</dt>
            <dd className="font-medium text-slate-900">{localName(warehouse)}</dd>
            <dt className="text-slate-500">{t('Count date')}</dt>
            <dd className="font-medium text-slate-900">{fmt.date(date)}</dd>
          </dl>
        </header>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="w-8 border border-slate-300 px-2 py-1.5 text-start">#</th>
              <th className="border border-slate-300 px-2 py-1.5 text-start">{t('SKU')}</th>
              <th className="border border-slate-300 px-2 py-1.5 text-start">{t('Item')}</th>
              <th className="border border-slate-300 px-2 py-1.5 text-start">{t('Unit')}</th>
              {showRecord ? (
                <th className="border border-slate-300 px-2 py-1.5 text-end">{t('On record')}</th>
              ) : null}
              <th className="w-28 border border-slate-300 px-2 py-1.5 text-end">{t('Counted')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="break-inside-avoid">
                <td className="tabular border border-slate-300 px-2 py-2 text-slate-500">
                  {index + 1}
                </td>
                <td className="border border-slate-300 px-2 py-2" dir="ltr">
                  {item.sku}
                </td>
                <td className="border border-slate-300 px-2 py-2">
                  <span className="block font-medium">{item.name}</span>
                  {item.nameAr ? (
                    <span className="block text-slate-600" dir="rtl" lang="ar">
                      {item.nameAr}
                    </span>
                  ) : null}
                </td>
                <td className="border border-slate-300 px-2 py-2">{item.unit}</td>
                {showRecord ? (
                  <td className="tabular border border-slate-300 px-2 py-2 text-end">
                    {fmt.quantity(levels.get(item.id)?.byWarehouse.get(warehouse?.id ?? '') ?? 0)}
                  </td>
                ) : null}
                <td className="border border-slate-300 px-2 py-2" />
              </tr>
            ))}
          </tbody>
        </table>
        <footer className="mt-10 grid gap-8 text-xs text-slate-600 sm:grid-cols-2">
          <p className="border-t border-slate-400 pt-1">{t('Counted by')}</p>
          <p className="border-t border-slate-400 pt-1">{t('Checked by')}</p>
        </footer>
      </article>
    </div>
  );
}
