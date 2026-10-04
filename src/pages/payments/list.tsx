import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CreditCard, Download, Plus, Search } from 'lucide-react';
import { db } from '@/db/db';
import { paymentMethodLabel, unappliedAmount } from '@/db/payments';
import type { Client, PaymentMethod } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { downloadCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import { currencyPrecision, dec, round } from '@/lib/money';
import { offeredMethods } from '@/lib/payment-methods';
import { chequeStatusMeta } from '@/lib/status';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import {
  PAYMENT_COPY,
  paymentDirection,
  type PaymentDirection,
} from '@/features/payments/direction';
import { PaymentStatusBadge } from '@/features/payments/status-badge';

export default function PaymentListPage({ direction = 'in' }: { direction?: PaymentDirection }) {
  const copy = PAYMENT_COPY[direction];
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');

  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const docs = useLiveQuery(
    () => db.documents.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const rows = useMemo(() => {
    if (!payments || !clients || !docs) return null;
    const byClient = new Map<string, Client>(clients.map((c) => [c.id, c]));
    const numbers = new Map(docs.map((d) => [d.id, d.number]));
    return payments
      .filter((p) => paymentDirection(p) === direction)
      .map((p) => ({
        payment: p,
        client: byClient.get(p.clientId) ?? null,
        invoices: p.documentIds.map((id) => numbers.get(id)).filter(Boolean) as string[],
        unapplied: p.voided ? 0 : unappliedAmount(p),
      }))
      .sort(
        (a, b) =>
          b.payment.date.localeCompare(a.payment.date) ||
          b.payment.number.localeCompare(a.payment.number, undefined, { numeric: true }),
      );
  }, [payments, clients, docs, direction]);

  // Methods to filter by: those offered now and any older ones still in use.
  const methods = useMemo(() => {
    const used = new Set(rows?.map((r) => r.payment.method));
    return [
      ...offeredMethods(direction).map((m) => m.value),
      ...[...used].filter((m) => !offeredMethods(direction).some((o) => o.value === m)),
    ];
  }, [rows, direction]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!method || r.payment.method === method) &&
        (!q ||
          `${r.payment.number} ${r.client?.name ?? ''} ${r.client?.nameAr ?? ''} ${r.payment.reference} ${r.payment.cheque?.number ?? ''} ${r.invoices.join(' ')}`
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, query, method]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      if (r.payment.method === 'credit_note' || r.payment.voided) continue;
      const c = r.payment.currency;
      map.set(c, round(dec(map.get(c) ?? 0).plus(dec(r.payment.amount)), currencyPrecision(c)));
    }
    return [...map.entries()];
  }, [filtered]);

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;

  const exportCsv = () =>
    downloadCsv(
      `${copy.base.slice(1)}-${today()}`,
      [
        t('Number'),
        t('Date'),
        t(copy.party),
        t('Method'),
        t('Reference'),
        t('Cheque number'),
        t('Status'),
        t('Currency'),
        t('Amount'),
        t('Applied to'),
        t('Unapplied'),
      ],
      filtered.map((r) => [
        r.payment.number,
        r.payment.date,
        r.client ? localName(r.client) : '',
        paymentMethodLabel(r.payment.method),
        r.payment.reference,
        r.payment.cheque?.number ?? '',
        r.payment.cheque
          ? t(chequeStatusMeta(r.payment.cheque.status, direction).label)
          : r.payment.voided
            ? t('Voided')
            : '',
        r.payment.currency,
        r.payment.amount,
        r.invoices.join(' '),
        r.unapplied,
      ]),
    );

  return (
    <div>
      <PageHeader
        title={t(copy.title)}
        description={t(copy.description)}
        actions={
          <>
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> {t('Export CSV')}
              </Button>
            ) : null}
            <ButtonLink to={`${copy.base}/new`}>
              <Plus /> {t('Record payment')}
            </ButtonLink>
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CreditCard />}
            title={t('No payments yet')}
            description={t(copy.empty)}
            action={
              <ButtonLink to={`${copy.base}/new`}>
                <Plus /> {t('Record payment')}
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:w-52">
              <Select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
                aria-label={t('Filter by method')}
              >
                <option value="">{t('All methods')}</option>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {paymentMethodLabel(m)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search payments…')}
                className="ps-9"
                aria-label={t('Search payments')}
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {t('No payments match.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3 text-start">{t('Payment')}</th>
                    <th className="px-3 py-3 text-start">{t(copy.party)}</th>
                    <th className="hidden px-3 py-3 text-start md:table-cell">{t('Method')}</th>
                    <th className="hidden px-3 py-3 text-start lg:table-cell">{t('Applied to')}</th>
                    <th className="px-5 py-3 text-end">{t('Amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => (
                    <tr
                      key={r.payment.id}
                      onClick={() => navigate(`${copy.base}/${r.payment.id}`)}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          to={`${copy.base}/${r.payment.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-primary-700 font-medium text-slate-900"
                        >
                          {r.payment.number}
                        </Link>
                        <span className="block text-xs text-slate-500">
                          {fmt.date(r.payment.date)}
                        </span>
                      </td>
                      <td dir="auto" className="max-w-56 truncate px-3 py-3 text-slate-700">
                        {r.client ? localName(r.client) : '—'}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 md:table-cell">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {paymentMethodLabel(r.payment.method)}
                          <PaymentStatusBadge payment={r.payment} />
                        </span>
                        {r.payment.cheque?.number || r.payment.reference ? (
                          <span className="block text-xs text-slate-500">
                            {r.payment.cheque?.number
                              ? t('Cheque {number}', { number: r.payment.cheque.number })
                              : r.payment.reference}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                        {r.invoices.join(', ') || '—'}
                        {r.unapplied > 0 ? (
                          <Badge tone="amber" className="ms-2">
                            {t('{amount} unapplied', {
                              amount: fmt.money(r.unapplied, r.payment.currency),
                            })}
                          </Badge>
                        ) : null}
                      </td>
                      <td
                        className={
                          r.payment.voided
                            ? 'tabular px-5 py-3 text-end text-slate-500 line-through'
                            : 'tabular px-5 py-3 text-end font-medium text-slate-900'
                        }
                      >
                        {fmt.money(r.payment.amount, r.payment.currency)}
                        {r.payment.voided ? (
                          <PaymentStatusBadge payment={r.payment} className="ms-2 md:hidden" />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span>{tp(filtered.length, '{count} payment', '{count} payments')}</span>
            <span className="tabular flex flex-wrap gap-x-4">
              {totals.map(([currency, amount]) => (
                <span key={currency}>
                  {t(copy.total)}{' '}
                  <strong className="text-slate-900">{fmt.money(amount, currency)}</strong>
                </span>
              ))}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
