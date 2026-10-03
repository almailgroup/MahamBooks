import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { voidLandedCost } from '@/db/inventory';
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

/** A landed cost: the charges, the goods they were added to, and how they were shared. */
export default function LandedCostView() {
  const { id = '' } = useParams();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const data = useLiveQuery(async () => {
    const cost = await db.landedCosts.get(id);
    if (!cost || cost.companyId !== company.id) return { cost: null } as const;
    const [costBill, targetBill, movements, products] = await Promise.all([
      db.documents.get(cost.billId),
      db.documents.get(cost.targetBillId),
      db.stockMovements.where('sourceId').equals(id).toArray(),
      db.products.where('companyId').equals(company.id).toArray(),
    ]);
    return { cost, costBill, targetBill, movements, products } as const;
  }, [id, company.id]);

  if (!data) return <Spinner className="py-24" label={t('Loading…')} />;
  if (!data.cost) {
    return (
      <Card>
        <EmptyState
          title={t('Landed cost not found')}
          action={
            <Link to="/inventory?tab=landed-costs" className="text-primary-700 font-medium">
              {t('Back to inventory')}
            </Link>
          }
        />
      </Card>
    );
  }
  const { cost, costBill, targetBill, movements, products } = data;
  const p = currencyPrecision(company.currency);
  const total = movements.reduce((sum, m) => sum + toMinor(m.sourceValue ?? 0, p), 0);
  const kept = movements.reduce((sum, m) => sum + toMinor(m.value, p), 0);
  const charges = costBill
    ? [...costBill.items, ...costBill.charges.map((c) => ({ id: c.id, name: c.label }))].filter(
        (l) => cost.sourceLineIds.includes(l.id),
      )
    : [];

  const voidCost = async () => {
    const ok = await confirm({
      title: t('Void {number}?', { number: cost.number }),
      description: t(
        'The charges go back to their expense accounts and the cost of the goods goes back to what was paid for them.',
      ),
      confirmLabel: t('Void landed cost'),
      danger: true,
    });
    if (!ok) return;
    try {
      await voidLandedCost(cost.id);
      toast.success(t('{number} voided', { number: cost.number }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={
          <Link to="/inventory?tab=landed-costs" className="hover:text-slate-700">
            {t('Inventory')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t('Landed cost')} {cost.number}
            {cost.status === 'void' ? (
              <Badge tone="gray">{t('Void')}</Badge>
            ) : (
              <Badge tone="green">{t('Allocated')}</Badge>
            )}
          </span>
        }
        actions={
          cost.status === 'active' ? (
            <Button variant="outline" onClick={voidCost}>
              <Ban /> {t('Void landed cost')}
            </Button>
          ) : null
        }
      />
      <div className="space-y-6">
        <Card>
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-slate-500">{t('Bill with the charges')}</dt>
                <dd className="font-medium">
                  {costBill ? (
                    <Link to={`/bills/${costBill.id}`} className="text-primary-700 hover:underline">
                      {costBill.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('Bill with the goods')}</dt>
                <dd className="font-medium">
                  {targetBill ? (
                    <Link
                      to={`/bills/${targetBill.id}`}
                      className="text-primary-700 hover:underline"
                    >
                      {targetBill.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('Split')}</dt>
                <dd className="font-medium text-slate-900">
                  {cost.method === 'value' ? t('By value') : t('By quantity')}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('Date')}</dt>
                <dd className="font-medium text-slate-900">
                  {costBill ? fmt.date(costBill.issueDate) : '—'}
                </dd>
              </div>
            </dl>
            {charges.length ? (
              <p className="mt-4 text-sm text-slate-600">
                {t('Charges: {items}', { items: charges.map((c) => c.name).join(', ') })}
              </p>
            ) : null}
            {cost.notes ? <p className="mt-2 text-sm text-slate-600">{cost.notes}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('Allocation')}
            description={
              cost.status === 'void'
                ? t('This landed cost is void; nothing is allocated.')
                : movements.length === 0
                  ? t('Nothing is allocated: one of the bills is no longer issued.')
                  : undefined
            }
          />
          {movements.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{t('Item')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('Quantity')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('Share')}</th>
                    <th className="hidden px-4 py-2.5 text-end font-medium sm:table-cell">
                      {t('Added to stock')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => {
                    const item = products.find((x) => x.id === m.productId);
                    return (
                      <tr key={m.id}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {item ? localName(item) : '—'}
                        </td>
                        <td className="tabular px-3 py-2.5 text-end">
                          {fmt.quantity(m.basisQuantity ?? 0)}
                        </td>
                        <td className="tabular px-3 py-2.5 text-end">
                          {fmt.money(m.sourceValue ?? 0)}
                        </td>
                        <td className="tabular hidden px-4 py-2.5 text-end sm:table-cell">
                          {fmt.money(m.value)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 font-semibold">
                  <tr>
                    <td className="px-4 py-2.5">{t('Total')}</td>
                    <td />
                    <td className="tabular px-3 py-2.5 text-end">
                      {fmt.money(fromMinor(total, p))}
                    </td>
                    <td className="tabular hidden px-4 py-2.5 text-end sm:table-cell">
                      {fmt.money(fromMinor(kept, p))}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {total !== kept ? (
                <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
                  {t(
                    'Part of the goods had been sold by then, so {amount} went to cost of sales.',
                    { amount: fmt.money(fromMinor(total - kept, p)) },
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
