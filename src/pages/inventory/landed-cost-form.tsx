import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { saveLandedCost } from '@/db/inventory';
import type { ID, InvoiceDocument, LandedCostMethod } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { documentLineParts } from '@/lib/accounting/ledger';
import {
  allocateLandedCost,
  isStockItem,
  landedCostLinks,
  movesStock,
  stockLines,
  type StockSetup,
} from '@/lib/inventory/sources';
import { currencyPrecision, dec, fromMinor } from '@/lib/money';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { useUnitAmount } from '@/features/inventory/use-inventory';

/**
 * Allocates charges on a bill (customs duty, freight, clearing, insurance)
 * to the stock received on that bill or an earlier one.
 */
export default function LandedCostForm() {
  const company = useCompany();
  const fmt = useFormat();
  const unitAmount = useUnitAmount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [billId, setBillId] = useState(params.get('bill') ?? '');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [sourceIds, setSourceIds] = useState<ID[] | null>(null);
  const [targetIds, setTargetIds] = useState<ID[] | null>(null);
  const [method, setMethod] = useState<LandedCostMethod>('value');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const data = useLiveQuery(async () => {
    const [bills, products, clients, costs] = await Promise.all([
      db.documents.where('[companyId+type]').equals([company.id, 'bill']).toArray(),
      db.products.where('companyId').equals(company.id).toArray(),
      db.clients.where('companyId').equals(company.id).toArray(),
      db.landedCosts.where('companyId').equals(company.id).toArray(),
    ]);
    return {
      bills: bills
        .filter(movesStock)
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)),
      products,
      clients,
      costs: costs.filter((c) => c.status === 'active'),
    };
  }, [company.id]);

  const setup = useMemo<StockSetup | null>(() => {
    if (!data) return null;
    const exempt = new Set(data.clients.filter((c) => c.taxExempt).map((c) => c.id));
    return {
      companyCurrency: company.currency,
      precision: currencyPrecision(company.currency),
      products: new Set(data.products.filter(isStockItem).map((p) => p.id)),
      defaultWarehouseId: '',
      warehouses: new Set(),
      taxExempt: (id) => exempt.has(id),
    };
  }, [data, company.currency]);

  if (!data || !setup) return <Spinner className="py-24" label={t('Loading…')} />;

  const p = setup.precision;
  const costBill = data.bills.find((b) => b.id === billId);
  const vendorName = (doc: InvoiceDocument) =>
    localName(data.clients.find((c) => c.id === doc.clientId)) || '—';
  const billOption = (doc: InvoiceDocument) => ({
    value: doc.id,
    label: doc.number,
    detail: `${vendorName(doc)} · ${fmt.date(doc.issueDate)}`,
    keywords: `${vendorName(doc)} ${doc.vendorReference ?? ''}`,
  });

  // Charges: lines and charges of the bill that are not stock items.
  const parts = costBill ? documentLineParts(costBill, setup) : new Map<ID, number>();
  const taken = new Set(
    data.costs.filter((c) => c.billId === billId).flatMap((c) => c.sourceLineIds),
  );
  const stockOnCost = new Set(
    costBill ? stockLines(costBill, setup.products).map((l) => l.id) : [],
  );
  const charges = costBill
    ? [
        ...costBill.items
          .filter((i) => i.kind === 'item' && !stockOnCost.has(i.id))
          .map((i) => ({ id: i.id, label: i.name })),
        ...costBill.charges.map((c) => ({ id: c.id, label: c.label })),
      ]
    : [];
  const chosenSources = sourceIds ?? charges.filter((c) => !taken.has(c.id)).map((c) => c.id);

  // Goods: bills with stock items, dated on or before the bill with the charges.
  const goodsBills = costBill
    ? data.bills.filter(
        (b) => b.issueDate <= costBill.issueDate && stockLines(b, setup.products).length > 0,
      )
    : [];
  const target =
    goodsBills.find((b) => b.id === targetId) ??
    (targetId === null ? goodsBills.find((b) => b.id === billId) : undefined);
  const goodsLines = target ? stockLines(target, setup.products).filter((l) => l.quantity > 0) : [];
  const chosenTargets = targetIds ?? goodsLines.map((l) => l.id);
  const draft = {
    id: '',
    companyId: company.id,
    number: '',
    billId,
    sourceLineIds: chosenSources,
    targetBillId: target?.id ?? '',
    targetLineIds: chosenTargets,
    method,
    notes,
    status: 'active' as const,
    createdAt: '',
    updatedAt: '',
  };
  const links =
    costBill && target ? landedCostLinks(draft, costBill, target, setup.products) : null;
  const allocation =
    links && costBill && target ? allocateLandedCost(draft, costBill, target, links, setup) : null;
  const product = (id: ID) => data.products.find((x) => x.id === id);

  const toggle = (list: ID[], id: ID, on: boolean) =>
    on ? [...new Set([...list, id])] : list.filter((x) => x !== id);

  const save = async () => {
    if (!costBill || !target) return;
    setSaving(true);
    try {
      const cost = await saveLandedCost(company.id, {
        billId: costBill.id,
        sourceLineIds: chosenSources,
        targetBillId: target.id,
        targetLineIds: chosenTargets.length === goodsLines.length ? [] : chosenTargets,
        method,
        notes,
      });
      toast.success(t('{number} saved', { number: cost.number }));
      navigate(`/inventory/landed-costs/${cost.id}`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Could not save.'));
      setSaving(false);
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
        title={t('Allocate landed costs')}
        description={t(
          'Add customs duty, freight, clearing and insurance to the cost of the goods they brought in. The charges move from expenses to inventory.',
        )}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title={t('Charges')}
            description={t('The bill from the customs broker, the shipper or the insurer.')}
          />
          <CardBody className="space-y-4">
            <Field label={t('Bill with the charges')}>
              {(id) => (
                <Combobox
                  id={id}
                  value={billId || null}
                  onChange={(v) => {
                    setBillId(v);
                    setSourceIds(null);
                    setTargetId(null);
                    setTargetIds(null);
                  }}
                  options={data.bills.map(billOption)}
                  placeholder={t('Choose a bill…')}
                  searchPlaceholder={t('Search bills…')}
                />
              )}
            </Field>
            {costBill ? (
              charges.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t('This bill has only stock items. Choose the bill with the charges.')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {charges.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <Checkbox
                        checked={chosenSources.includes(c.id)}
                        disabled={taken.has(c.id)}
                        onChange={(e) =>
                          setSourceIds(toggle(chosenSources, c.id, e.target.checked))
                        }
                        label={c.label || t('Line')}
                        description={taken.has(c.id) ? t('Already allocated') : undefined}
                      />
                      <span className="tabular shrink-0 text-sm text-slate-700">
                        {fmt.money(fromMinor(parts.get(c.id) ?? 0, p))}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </CardBody>
        </Card>

        {costBill ? (
          <Card>
            <CardHeader
              title={t('Goods')}
              description={t('The bill the stock was received on, dated on or before the charges.')}
            />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('Bill with the goods')}>
                  {(id) => (
                    <Combobox
                      id={id}
                      value={target?.id ?? null}
                      onChange={(v) => {
                        setTargetId(v);
                        setTargetIds(null);
                      }}
                      options={goodsBills.map(billOption)}
                      placeholder={t('Choose a bill…')}
                      searchPlaceholder={t('Search bills…')}
                      emptyText={t('No bills with stock items on or before this date.')}
                    />
                  )}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate-700">{t('Split')}</span>
                  <Segmented
                    value={method}
                    onChange={setMethod}
                    options={[
                      { value: 'value', label: t('By value') },
                      { value: 'quantity', label: t('By quantity') },
                    ]}
                  />
                </div>
              </div>
              {target ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50/60 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">{t('Item')}</th>
                        <th className="px-3 py-2 text-end font-medium">{t('Quantity')}</th>
                        <th className="hidden px-3 py-2 text-end font-medium sm:table-cell">
                          {t('Value')}
                        </th>
                        <th className="px-3 py-2 text-end font-medium">{t('Share')}</th>
                        <th className="hidden px-3 py-2 text-end font-medium md:table-cell">
                          {t('New unit cost')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {goodsLines.map((line) => {
                        const share = allocation?.shares.find((s) => s.lineId === line.id);
                        const item = product(line.productId);
                        return (
                          <tr key={line.id}>
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={chosenTargets.includes(line.id)}
                                onChange={(e) =>
                                  setTargetIds(toggle(chosenTargets, line.id, e.target.checked))
                                }
                                label={item ? localName(item) : line.name}
                              />
                            </td>
                            <td className="tabular px-3 py-2 text-end">
                              {fmt.quantity(line.quantity)}
                            </td>
                            <td className="tabular hidden px-3 py-2 text-end text-slate-600 sm:table-cell">
                              {share ? fmt.money(fromMinor(share.lineValue, p)) : '—'}
                            </td>
                            <td className="tabular px-3 py-2 text-end font-medium">
                              {share ? fmt.money(fromMinor(share.share, p)) : '—'}
                            </td>
                            <td className="tabular hidden px-3 py-2 text-end text-slate-700 md:table-cell">
                              {share
                                ? unitAmount(
                                    dec(share.lineValue + share.share)
                                      .dividedBy(dec(line.quantity))
                                      .dividedBy(10 ** p)
                                      .toDecimalPlaces(6)
                                      .toNumber(),
                                  )
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {allocation ? (
                <p className="text-sm text-slate-600">
                  {t('{amount} added to the cost of the goods on {date}.', {
                    amount: fmt.money(fromMinor(allocation.total, p)),
                    date: fmt.date(costBill.issueDate),
                  })}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardBody>
            <Field label={t('Notes')} optional>
              {(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </CardBody>
        </Card>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving} disabled={!allocation}>
            {t('Allocate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
