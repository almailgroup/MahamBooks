import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { voidStockEntry } from '@/db/inventory';
import { useCompany, useFormat } from '@/app/company';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { ENTRY_LABELS, REASON_LABELS } from '@/apps/books/features/inventory/labels';
import { useUnitAmount } from '@/apps/books/features/inventory/use-inventory';

/** An opening stock entry, adjustment or transfer, with what it moved and posted. */
export default function StockEntryView() {
  const { id = '' } = useParams();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const unitAmount = useUnitAmount();
  const data = useLiveQuery(async () => {
    const entry = await db.stockEntries.get(id);
    if (!entry || entry.companyId !== company.id) return { entry: null } as const;
    const [movements, products, warehouses] = await Promise.all([
      db.stockMovements.where('sourceId').equals(id).toArray(),
      db.products.bulkGet(entry.lines.map((l) => l.productId)),
      db.warehouses.where('companyId').equals(company.id).toArray(),
    ]);
    return { entry, movements, products, warehouses } as const;
  }, [id, company.id]);

  if (!data) return <Spinner className="py-24" label={t('Loading…')} />;
  if (!data.entry) {
    return (
      <Card>
        <EmptyState
          title={t('Stock entry not found')}
          action={
            <Link to="/inventory?tab=history" className="text-primary-700 font-medium">
              {t('Back to inventory')}
            </Link>
          }
        />
      </Card>
    );
  }

  const { entry, movements, products, warehouses } = data;
  const p = currencyPrecision(company.currency);
  const warehouseName = (wid: string | null | undefined) =>
    localName(warehouses.find((w) => w.id === wid)) || '—';
  const productOf = (pid: string) => products.find((x) => x?.id === pid);
  // A transfer moves each line out of one warehouse and into another: count it once.
  const counted = movements.filter((m) => entry.kind !== 'transfer' || m.quantity > 0);
  const lineValue = (lineId: string) =>
    counted.filter((m) => m.lineId === lineId).reduce((sum, m) => sum + toMinor(m.value, p), 0);
  const total = counted.reduce((sum, m) => sum + toMinor(m.value, p), 0);

  const voidEntry = async () => {
    const ok = await confirm({
      title: t('Void {number}?', { number: entry.number }),
      description: t('The entry stays on record, and its stock movements leave the books.'),
      confirmLabel: t('Void entry'),
      danger: true,
    });
    if (!ok) return;
    try {
      await voidStockEntry(entry.id);
      toast.success(t('{number} voided', { number: entry.number }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  const posting =
    entry.kind === 'transfer'
      ? t('Transfers stay in the inventory account, so nothing is posted.')
      : entry.kind === 'opening'
        ? t('Inventory against opening balance equity: {amount}', {
            amount: fmt.money(fromMinor(total, p)),
          })
        : total < 0
          ? t('Inventory adjustments against inventory: {amount}', {
              amount: fmt.money(fromMinor(-total, p)),
            })
          : t('Inventory against inventory adjustments: {amount}', {
              amount: fmt.money(fromMinor(total, p)),
            });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={
          <Link to="/inventory?tab=history" className="hover:text-slate-700">
            {t('Inventory')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t(ENTRY_LABELS[entry.kind])} {entry.number}
            {entry.status === 'void' ? (
              <Badge tone="gray">{t('Void')}</Badge>
            ) : (
              <Badge tone="green">{t('Posted')}</Badge>
            )}
          </span>
        }
        actions={
          <>
            {entry.status === 'posted' ? (
              <Button variant="outline" onClick={voidEntry}>
                <Ban /> {t('Void entry')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-slate-500">{t('Date')}</dt>
                <dd className="font-medium text-slate-900">{fmt.date(entry.date)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">
                  {entry.kind === 'transfer' ? t('From warehouse') : t('Warehouse')}
                </dt>
                <dd className="font-medium text-slate-900">{warehouseName(entry.warehouseId)}</dd>
              </div>
              {entry.kind === 'transfer' ? (
                <div>
                  <dt className="text-slate-500">{t('To warehouse')}</dt>
                  <dd className="font-medium text-slate-900">
                    {warehouseName(entry.toWarehouseId)}
                  </dd>
                </div>
              ) : null}
              {entry.reason ? (
                <div>
                  <dt className="text-slate-500">{t('Reason')}</dt>
                  <dd className="font-medium text-slate-900">{t(REASON_LABELS[entry.reason])}</dd>
                </div>
              ) : null}
              {entry.reference ? (
                <div>
                  <dt className="text-slate-500">{t('Reference')}</dt>
                  <dd className="font-medium text-slate-900">{entry.reference}</dd>
                </div>
              ) : null}
              {entry.voidedAt ? (
                <div>
                  <dt className="text-slate-500">{t('Voided on')}</dt>
                  <dd className="font-medium text-slate-900">{fmt.dateTime(entry.voidedAt)}</dd>
                </div>
              ) : null}
            </dl>
            {entry.notes ? <p className="mt-4 text-sm text-slate-600">{entry.notes}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('Stock items')} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('Item')}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{t('Quantity')}</th>
                  <th className="hidden px-3 py-2.5 text-end font-medium sm:table-cell">
                    {t('Unit cost')}
                  </th>
                  <th className="px-4 py-2.5 text-end font-medium">{t('Value')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entry.lines.map((line) => {
                  const product = productOf(line.productId);
                  const value = lineValue(line.id);
                  const unit =
                    line.quantity !== 0 ? Math.abs(fromMinor(value, p) / line.quantity) : 0;
                  return (
                    <tr key={line.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {product ? localName(product) : '—'}
                      </td>
                      <td className="tabular px-3 py-2.5 text-end whitespace-nowrap">
                        {line.quantity > 0 && entry.kind === 'adjustment' ? '+' : ''}
                        {fmt.quantity(line.quantity)}
                        {product?.unit ? (
                          <span className="text-slate-500"> {product.unit}</span>
                        ) : null}
                      </td>
                      <td className="tabular hidden px-3 py-2.5 text-end text-slate-600 sm:table-cell">
                        {entry.status === 'void' ? '—' : unitAmount(unit)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-end font-medium">
                        {entry.status === 'void' ? '—' : fmt.money(fromMinor(value, p))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {entry.status === 'posted' ? (
            <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{posting}</p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
