import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download } from 'lucide-react';
import { db } from '@/db/db';
import { paymentMethodLabel } from '@/db/payments';
import { useCompany, useFormat } from '@/app/company';
import { today } from '@/lib/dates';
import { downloadCsv } from '@/lib/csv';
import {
  AGING_BUCKETS,
  agingReport,
  paymentsReport,
  presetRange,
  RANGE_PRESETS,
  salesByClient,
  taxReport,
  type RangePreset,
} from '@/lib/reports';
import { msg, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Card, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { CurrencySelect } from '@/components/fields';
import { isolate } from '@/features/reports/report-language';

export type SalesReportId =
  'aging' | 'tax' | 'sales' | 'payments' | 'payables' | 'purchases' | 'payments-made';

/** Purchase reports are the sales ones seen from the other side. */
const KIND: Record<SalesReportId, 'aging' | 'tax' | 'sales' | 'payments'> = {
  aging: 'aging',
  tax: 'tax',
  sales: 'sales',
  payments: 'payments',
  payables: 'aging',
  purchases: 'sales',
  'payments-made': 'payments',
};

const WORDS = {
  in: {
    party: msg('Client'),
    partyBase: '/clients',
    docs: msg('Invoices'),
    amount: msg('Invoiced'),
    paymentsBase: '/payments',
    agingFile: 'receivables-aging',
    byPartyFile: 'sales-by-client',
    paymentsFile: 'payments-received',
  },
  out: {
    party: msg('Vendor'),
    partyBase: '/vendors',
    docs: msg('Bills'),
    amount: msg('Billed'),
    paymentsBase: '/payments-made',
    agingFile: 'payables-aging',
    byPartyFile: 'purchases-by-vendor',
    paymentsFile: 'payments-made',
  },
};

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium tracking-wide whitespace-nowrap text-slate-500 uppercase ${right ? 'text-end' : 'text-start'}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  strong,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2.5 whitespace-nowrap ${right ? 'tabular text-end' : ''} ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
    >
      {children}
    </td>
  );
}

/** Aging, totals per contact and payments, for sales or purchases; and the tax summary. */
export function SalesReports({ report }: { report: SalesReportId }) {
  const kind = KIND[report];
  const out = report === 'payables' || report === 'purchases' || report === 'payments-made';
  const words = WORDS[out ? 'out' : 'in'];
  const company = useCompany();
  const fmt = useFormat();
  const [preset, setPreset] = useState<RangePreset | 'custom'>('this-quarter');
  const [custom, setCustom] = useState(() => presetRange('this-quarter', today()));
  const [currency, setCurrency] = useState(company.currency);

  const docs = useLiveQuery(
    () => db.documents.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const range = preset === 'custom' ? custom : presetRange(preset, today());
  const data = useMemo(() => {
    if (!docs || !clients || !payments) return null;
    const docType = out ? 'bill' : 'invoice';
    return {
      aging: agingReport(docs, clients, currency, today(), docType),
      tax: taxReport(docs, clients, currency, range),
      sales: salesByClient(docs, clients, currency, range, docType),
      payments: paymentsReport(payments, currency, range, out ? 'out' : 'in'),
    };
  }, [docs, clients, payments, currency, range, out]);

  if (!data || !clients) return <Spinner className="py-24" label={t('Loading…')} />;
  const money = (n: number) => fmt.money(n, currency);
  const rangeText =
    preset === 'all'
      ? t('at any time')
      : t('from {from} to {to}', {
          from: isolate(fmt.date(range.from)),
          to: isolate(fmt.date(range.to)),
        });
  const stamp = `${range.from}_${range.to}`.replace(/0000-01-01_9999-12-31/, 'all');
  const byId = new Map(clients.map((c) => [c.id, c]));
  const contactName = (id: string, fallback = '—') => localName(byId.get(id)) || fallback;

  const exportCurrent = () => {
    if (kind === 'aging') {
      downloadCsv(
        `${words.agingFile}-${today()}`,
        [t(words.party), ...AGING_BUCKETS.map((b) => t(b)), t('Total')],
        [
          ...data.aging.rows.map((r) => [
            contactName(r.clientId, r.clientName),
            ...r.buckets,
            r.total,
          ]),
          [t('Total'), ...data.aging.totals, data.aging.total],
        ],
      );
    } else if (kind === 'tax') {
      downloadCsv(
        `tax-summary-${stamp}`,
        [t('Tax'), t('Rate %'), t('Taxable amount'), t('Tax amount')],
        [
          ...data.tax.rows.map((r) => [r.name, r.rate, r.base, r.tax]),
          [t('Total'), '', data.tax.net, data.tax.tax],
        ],
      );
    } else if (kind === 'sales') {
      downloadCsv(
        `${words.byPartyFile}-${stamp}`,
        [t(words.party), t(words.docs), t(words.amount), t('Paid'), t('Outstanding')],
        [
          ...data.sales.rows.map((r) => [
            contactName(r.clientId, r.clientName),
            r.invoices,
            r.invoiced,
            r.paid,
            r.outstanding,
          ]),
          [
            t('Total'),
            data.sales.totals.invoices,
            data.sales.totals.invoiced,
            data.sales.totals.paid,
            data.sales.totals.outstanding,
          ],
        ],
      );
    } else {
      downloadCsv(
        `${words.paymentsFile}-${stamp}`,
        [t('Date'), t('Number'), t('Method'), t('Reference'), t('Amount')],
        data.payments.list.map((p) => [
          p.date,
          p.number,
          paymentMethodLabel(p.method),
          p.reference,
          p.amount,
        ]),
      );
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {kind !== 'aging' ? (
            <>
              <div className="w-40">
                <Select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as RangePreset | 'custom')}
                  aria-label={t('Date range')}
                >
                  {RANGE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.label)}
                    </option>
                  ))}
                  <option value="custom">{t('Custom…')}</option>
                </Select>
              </div>
              {preset === 'custom' ? (
                <>
                  <Input
                    type="date"
                    aria-label={t('From')}
                    value={custom.from}
                    onChange={(e) =>
                      e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))
                    }
                    className="w-40"
                  />
                  <Input
                    type="date"
                    aria-label={t('To')}
                    value={custom.to}
                    onChange={(e) =>
                      e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))
                    }
                    className="w-40"
                  />
                </>
              ) : null}
            </>
          ) : null}
          <div className="w-56">
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
        </div>
        <Button variant="outline" onClick={exportCurrent}>
          <Download /> {t('Export CSV')}
        </Button>
      </div>

      {kind === 'aging' ? (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
            {out
              ? t('Unpaid bills by how late they are, as at {date}.', {
                  date: isolate(fmt.date(today())),
                })
              : t('Unpaid invoices by how late they are, as at {date}.', {
                  date: isolate(fmt.date(today())),
                })}
          </div>
          {data.aging.rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {t('Nothing outstanding in {currency}.', { currency })}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100">
                  <tr>
                    <Th>{t(words.party)}</Th>
                    {AGING_BUCKETS.map((b) => (
                      <Th key={b} right>
                        {t(b)}
                      </Th>
                    ))}
                    <Th right>{t('Total')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.aging.rows.map((r) => (
                    <tr key={r.clientId}>
                      <Td>
                        <Link
                          to={`${words.partyBase}/${r.clientId}`}
                          className="hover:text-primary-700 font-medium text-slate-900"
                        >
                          {contactName(r.clientId, r.clientName)}
                        </Link>
                      </Td>
                      {r.buckets.map((v, i) => (
                        <Td key={i} right>
                          <span
                            className={
                              v === 0 ? 'text-slate-300' : i >= 3 ? 'font-medium text-red-600' : ''
                            }
                          >
                            {money(v)}
                          </span>
                        </Td>
                      ))}
                      <Td right strong>
                        {money(r.total)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                  <tr>
                    <Td strong>{t('Total')}</Td>
                    {data.aging.totals.map((v, i) => (
                      <Td key={i} right strong>
                        {money(v)}
                      </Td>
                    ))}
                    <Td right strong>
                      {money(data.aging.total)}
                    </Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {kind === 'tax' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <p className="text-sm text-slate-500">{t('Net sales')}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{money(data.tax.net)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-slate-500">{t('Tax collected')}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{money(data.tax.tax)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-slate-500">{t('Gross')}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{money(data.tax.gross)}</p>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
              {tp(
                data.tax.documents,
                '{count} invoice or credit note issued {range} (drafts and void left out; credit notes deducted).',
                '{count} invoices and credit notes issued {range} (drafts and void left out; credit notes deducted).',
                { range: rangeText },
              )}
            </div>
            {data.tax.rows.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">
                {t('No taxed sales in this period.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100">
                    <tr>
                      <Th>{t('Tax')}</Th>
                      <Th right>{t('Rate')}</Th>
                      <Th right>{t('Taxable amount')}</Th>
                      <Th right>{t('Tax amount')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.tax.rows.map((r) => (
                      <tr key={r.key}>
                        <Td strong>{r.name}</Td>
                        <Td right>{fmt.percent(r.rate)}</Td>
                        <Td right>{money(r.base)}</Td>
                        <Td right strong>
                          {money(r.tax)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {kind === 'sales' ? (
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
            {out
              ? t('Bills received {range}.', { range: rangeText })
              : t('Invoices issued {range}.', { range: rangeText })}
          </div>
          {data.sales.rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {out ? t('No bills in this period.') : t('No invoices in this period.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100">
                  <tr>
                    <Th>{t(words.party)}</Th>
                    <Th right>{t(words.docs)}</Th>
                    <Th right>{t(words.amount)}</Th>
                    <Th right>{t('Paid')}</Th>
                    <Th right>{t('Outstanding')}</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.sales.rows.map((r) => (
                    <tr key={r.clientId}>
                      <Td>
                        <Link
                          to={`${words.partyBase}/${r.clientId}`}
                          className="hover:text-primary-700 font-medium text-slate-900"
                        >
                          {contactName(r.clientId, r.clientName)}
                        </Link>
                      </Td>
                      <Td right>{fmt.quantity(r.invoices)}</Td>
                      <Td right>{money(r.invoiced)}</Td>
                      <Td right>{money(r.paid)}</Td>
                      <Td right strong>
                        {money(r.outstanding)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                  <tr>
                    <Td strong>{t('Total')}</Td>
                    <Td right strong>
                      {fmt.quantity(data.sales.totals.invoices)}
                    </Td>
                    <Td right strong>
                      {money(data.sales.totals.invoiced)}
                    </Td>
                    <Td right strong>
                      {money(data.sales.totals.paid)}
                    </Td>
                    <Td right strong>
                      {money(data.sales.totals.outstanding)}
                    </Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {kind === 'payments' ? (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit p-5">
            <p className="text-sm text-slate-500">
              {out
                ? t('Paid {range}', { range: rangeText })
                : t('Received {range}', { range: rangeText })}
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {money(data.payments.total)}
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {data.payments.byMethod.map(([method, amount]) => (
                <li key={method} className="flex justify-between gap-3">
                  <span className="text-slate-600">{paymentMethodLabel(method as never)}</span>
                  <span className="tabular font-medium text-slate-900">{money(amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="overflow-hidden">
            {data.payments.list.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">
                {t('No payments in this period.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100">
                    <tr>
                      <Th>{t('Date')}</Th>
                      <Th>{t('Payment')}</Th>
                      <Th>{t(words.party)}</Th>
                      <Th>{t('Method')}</Th>
                      <Th right>{t('Amount')}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.payments.list.map((p) => (
                      <tr key={p.id}>
                        <Td>{fmt.date(p.date)}</Td>
                        <Td>
                          <Link
                            to={`${words.paymentsBase}/${p.id}`}
                            className="hover:text-primary-700 font-medium text-slate-900"
                          >
                            {p.number}
                          </Link>
                        </Td>
                        <Td>{contactName(p.clientId)}</Td>
                        <Td>{paymentMethodLabel(p.method)}</Td>
                        <Td right strong>
                          {money(p.amount)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
