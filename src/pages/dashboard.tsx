import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Circle,
  Clock,
  FileText,
  Landmark,
  Plus,
  Receipt,
  TrendingDown,
  Wallet,
  X,
} from 'lucide-react';
import { db } from '@/db/db';
import type { Client, InvoiceDocument } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { displayStatus } from '@/lib/status';
import { addDaysISO, daysBetween, today } from '@/lib/dates';
import { paymentMethodLabel } from '@/db/payments';
import { isCustomer } from '@/db/purchases';
import { vatSettings } from '@/db/chart-setup';
import { vatDueDate, vatPeriodOf } from '@/lib/accounting/vat';
import { ButtonLink } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Spinner,
  Stat,
  StatusBadge,
} from '@/components/ui/misc';
import { ColumnChart } from '@/components/charts/column-chart';

// Validated categorical slots 1 and 2 (dataviz reference palette, light surface).
const SERIES_INVOICED = '#2a78d6';
const SERIES_COLLECTED = '#eb6834';

function monthKeys(count: number, from: string): string[] {
  const [y, m] = from.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function useDismissed(key: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  return [
    dismissed,
    () => {
      setDismissed(true);
      try {
        localStorage.setItem(key, '1');
      } catch {
        // Private mode: the checklist simply reappears next time.
      }
    },
  ];
}

export default function DashboardPage() {
  const company = useCompany();
  const fmt = useFormat();
  const now = today();

  const docs = useLiveQuery(
    () => db.documents.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const payments = useLiveQuery(
    () => db.payments.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const expenses = useLiveQuery(
    () => db.expenses.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const vatFiled = useLiveQuery(
    () => db.vatReturns.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const bankToMatch = useLiveQuery(
    () =>
      db.bankTransactions
        .where('companyId')
        .equals(company.id)
        .filter((t) => !t.match && !t.ignored)
        .toArray(),
    [company.id],
  );
  const taxRateCount = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).count(),
    [company.id],
  );
  const activity = useLiveQuery(
    () =>
      db.activities
        .where('[companyId+at]')
        .between([company.id, ''], [company.id, '￿'])
        .reverse()
        .limit(8)
        .toArray(),
    [company.id],
  );
  const [checklistDismissed, dismissChecklist] = useDismissed(`checklist-dismissed:${company.id}`);

  const data = useMemo(() => {
    if (!docs || !payments || !clients || !expenses || !vatFiled) return null;
    const clientsById = new Map<string, Client>(clients.map((c) => [c.id, c]));
    const base = company.currency;
    const invoices = docs.filter((d) => d.type === 'invoice');
    const open = invoices.filter((d) => d.status === 'sent' || d.status === 'partial');
    const sum = (list: InvoiceDocument[], pick: (d: InvoiceDocument) => number) =>
      list.filter((d) => d.currency === base).reduce((s, d) => s + pick(d), 0);

    const overdue = open
      .filter((d) => displayStatus(d, now) === 'overdue')
      .map((d) => ({ doc: d, days: d.dueDate ? daysBetween(d.dueDate, now) : 0 }))
      .sort((a, b) => b.days - a.days);

    const otherCurrencies = new Map<string, number>();
    for (const d of open) {
      if (d.currency !== base)
        otherCurrencies.set(d.currency, (otherCurrencies.get(d.currency) ?? 0) + d.totals.balance);
    }

    // Void payments (returned or cancelled cheques) don't count.
    const active = payments.filter((p) => !p.voided);
    const received = active.filter((p) => p.direction !== 'out');
    const cash = received.filter((p) => p.method !== 'credit_note' && p.currency === base);
    const month = now.slice(0, 7);

    // Purchases: what is owed to vendors and what went out this month.
    const openBills = docs.filter(
      (d) => d.type === 'bill' && (d.status === 'sent' || d.status === 'partial'),
    );
    const billsOverdue = openBills
      .filter((d) => displayStatus(d, now) === 'overdue')
      .map((d) => ({ doc: d, days: d.dueDate ? daysBetween(d.dueDate, now) : 0 }))
      .sort((a, b) => b.days - a.days);
    const spentThisMonth =
      active
        .filter(
          (p) =>
            p.direction === 'out' &&
            p.method !== 'credit_note' &&
            p.currency === base &&
            p.date.startsWith(month),
        )
        .reduce((s, p) => s + p.amount, 0) +
      expenses
        .filter((e) => e.currency === base && e.date.startsWith(month))
        .reduce((s, e) => s + e.amount, 0);
    const year = now.slice(0, 4);
    const issued = invoices.filter((d) => d.status !== 'draft' && d.status !== 'void');

    const keys = monthKeys(12, now);
    const invoicedByMonth = keys.map((k) =>
      issued
        .filter((d) => d.currency === base && d.issueDate.startsWith(k))
        .reduce((s, d) => s + d.totals.total, 0),
    );
    const collectedByMonth = keys.map((k) =>
      cash.filter((p) => p.date.startsWith(k)).reduce((s, p) => s + p.amount, 0),
    );
    const monthFormat = new Intl.DateTimeFormat(fmt.locale, { month: 'short' });
    const labels = keys.map((k) => {
      const [yy, mm] = k.split('-').map(Number);
      const label = monthFormat.format(new Date(yy, mm - 1, 1));
      return mm === 1 ? `${label} ’${String(yy).slice(2)}` : label;
    });

    const quotesWaiting = docs.filter(
      (d) => d.type === 'quote' && displayStatus(d, now) === 'sent',
    );

    return {
      clientsById,
      outstanding: sum(open, (d) => d.totals.balance),
      openCount: open.filter((d) => d.currency === base).length,
      otherCurrencies: [...otherCurrencies.entries()],
      overdue,
      overdueTotal: overdue
        .filter((o) => o.doc.currency === base)
        .reduce((s, o) => s + o.doc.totals.balance, 0),
      collectedThisMonth: cash
        .filter((p) => p.date.startsWith(month))
        .reduce((s, p) => s + p.amount, 0),
      invoicedThisYear: sum(
        issued.filter((d) => d.issueDate.startsWith(year)),
        (d) => d.totals.total,
      ),
      drafts: invoices.filter((d) => d.status === 'draft').length,
      recentInvoices: [...invoices]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
      recentPayments: [...received]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5),
      quotesWaiting,
      vatDue: (() => {
        // The last ended VAT period, until it is marked as filed.
        const vat = vatSettings(company);
        if (!vat.registered) return null;
        const period = vatPeriodOf(addDaysISO(vatPeriodOf(now, vat).start, -1), vat);
        if (vatFiled.some((r) => r.periodStart === period.start)) return null;
        // Only once there are transactions in or before that period.
        const active =
          docs.some((d) => d.status !== 'draft' && d.issueDate <= period.end) ||
          expenses.some((e) => e.date <= period.end);
        if (!active) return null;
        return { period, due: vatDueDate(period, vat.format) };
      })(),
      billsToPay: sum(openBills, (d) => d.totals.balance),
      openBillCount: openBills.filter((d) => d.currency === base).length,
      billsOverdue,
      spentThisMonth,
      chart: { labels, invoiced: invoicedByMonth, collected: collectedByMonth },
      hasClients: clients.some(isCustomer),
      hasInvoices: invoices.length > 0,
    };
  }, [docs, payments, clients, expenses, vatFiled, company, fmt.locale, now]);

  if (!data) return <Spinner className="py-24" label="Loading…" />;

  const compact = new Intl.NumberFormat(fmt.locale, {
    style: 'currency',
    currency: company.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  const checklist = [
    {
      done: Boolean(company.branding.logo) && Boolean(company.address.line1),
      label: 'Add your logo and address',
      to: '/settings/company',
    },
    {
      done: Boolean(company.payment.bankDetails || company.payment.paymentLink),
      label: 'Add payment details',
      to: '/settings/payments',
    },
    { done: (taxRateCount ?? 0) > 0, label: 'Set up your tax rates', to: '/settings/taxes' },
    { done: data.hasClients, label: 'Add your first client', to: '/clients/new' },
    { done: data.hasInvoices, label: 'Create your first invoice', to: '/invoices/new' },
  ];
  const showChecklist = !checklistDismissed && checklist.some((c) => !c.done);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Overview of ${company.name}`}
        actions={
          <>
            <ButtonLink to="/quotes/new" variant="outline">
              New quote
            </ButtonLink>
            <ButtonLink to="/invoices/new">
              <Plus /> New invoice
            </ButtonLink>
          </>
        }
      />

      {showChecklist ? (
        <Card className="border-primary-100 from-primary-50 relative overflow-hidden bg-gradient-to-br to-white">
          <button
            type="button"
            onClick={dismissChecklist}
            className="absolute end-3 top-3 rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600"
            aria-label="Dismiss checklist"
          >
            <X className="size-4" />
          </button>
          <CardBody>
            <h2 className="font-semibold text-slate-900">Finish setting up</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              A few details make your invoices look complete and professional.
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {checklist.map((item) => (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    className="hover:ring-primary-300 flex h-full items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm shadow-xs ring-1 ring-slate-200"
                  >
                    {item.done ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-slate-300" />
                    )}
                    <span className={item.done ? 'text-slate-400 line-through' : 'text-slate-700'}>
                      {item.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Outstanding"
          value={fmt.money(data.outstanding)}
          hint={
            <>
              {data.openCount} open {data.openCount === 1 ? 'invoice' : 'invoices'}
              {data.otherCurrencies.map(([cur, amount]) => ` · ${fmt.money(amount, cur)}`).join('')}
            </>
          }
          icon={<Wallet />}
        />
        <Stat
          label="Overdue"
          value={fmt.money(data.overdueTotal)}
          tone={data.overdueTotal > 0 ? 'danger' : 'default'}
          hint={`${data.overdue.length} ${data.overdue.length === 1 ? 'invoice' : 'invoices'} past due`}
          icon={<AlertCircle />}
        />
        <Stat
          label="Collected this month"
          value={fmt.money(data.collectedThisMonth)}
          tone={data.collectedThisMonth > 0 ? 'success' : 'default'}
          hint="Payments received"
          icon={<CheckCircle2 />}
        />
        <Stat
          label={`Invoiced in ${now.slice(0, 4)}`}
          value={fmt.money(data.invoicedThisYear)}
          hint={
            data.drafts
              ? `${data.drafts} draft${data.drafts === 1 ? '' : 's'} not yet sent`
              : 'Excludes drafts'
          }
          icon={<FileText />}
        />
        <Stat
          label="Bills to pay"
          value={fmt.money(data.billsToPay)}
          hint={`${data.openBillCount} open ${data.openBillCount === 1 ? 'bill' : 'bills'}${
            data.billsOverdue.length ? ` · ${data.billsOverdue.length} overdue` : ''
          }`}
          icon={<Receipt />}
        />
        <Stat
          label="Spent this month"
          value={fmt.money(data.spentThisMonth)}
          hint="Bills paid and expenses"
          icon={<TrendingDown />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Invoiced vs collected"
            description={`Last 12 months · ${company.currency}`}
          />
          <CardBody>
            <ColumnChart
              title="Invoiced and collected per month"
              labels={data.chart.labels}
              series={[
                {
                  key: 'invoiced',
                  label: 'Invoiced',
                  color: SERIES_INVOICED,
                  values: data.chart.invoiced,
                },
                {
                  key: 'collected',
                  label: 'Collected',
                  color: SERIES_COLLECTED,
                  values: data.chart.collected,
                },
              ]}
              formatValue={(v) => fmt.money(v)}
              formatTick={(v) => compact.format(v)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Needs attention"
            actions={
              data.overdue.length ? (
                <Link
                  to="/invoices?status=overdue"
                  className="text-primary-700 text-sm font-medium hover:underline"
                >
                  View all
                </Link>
              ) : null
            }
          />
          <CardBody className="py-2">
            {data.overdue.length === 0 &&
            data.quotesWaiting.length === 0 &&
            data.billsOverdue.length === 0 &&
            !data.vatDue &&
            !bankToMatch?.length ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle2 className="size-8 text-emerald-500" />
                <p className="mt-2 text-sm font-medium text-slate-700">All caught up</p>
                <p className="text-sm text-slate-500">No overdue invoices or bills.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.overdue.slice(0, 5).map(({ doc, days }) => (
                  <li key={doc.id}>
                    <Link
                      to={`/invoices/${doc.id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {data.clientsById.get(doc.clientId)?.name ?? '—'}
                        </span>
                        <span className="text-xs text-red-600">
                          {doc.number} · {days} {days === 1 ? 'day' : 'days'} overdue
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-slate-900">
                        {fmt.money(doc.totals.balance, doc.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
                {bankToMatch?.length ? (
                  <li>
                    <Link
                      to={
                        new Set(bankToMatch.map((t) => t.accountId)).size === 1
                          ? `/banking/${bankToMatch[0].accountId}`
                          : '/banking'
                      }
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          Bank statement
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Banknote className="size-3" /> {bankToMatch.length}{' '}
                          {bankToMatch.length === 1 ? 'line' : 'lines'} to match
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ) : null}
                {data.vatDue ? (
                  <li>
                    <Link
                      to={`/vat/${data.vatDue.period.start}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          VAT return to file
                        </span>
                        <span
                          className={`flex items-center gap-1 text-xs ${data.vatDue.due < now ? 'text-red-600' : 'text-slate-500'}`}
                        >
                          <Landmark className="size-3" /> {fmt.date(data.vatDue.period.start)} –{' '}
                          {fmt.date(data.vatDue.period.end)} · due {fmt.date(data.vatDue.due)}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ) : null}
                {data.billsOverdue.slice(0, 3).map(({ doc, days }) => (
                  <li key={doc.id}>
                    <Link
                      to={`/bills/${doc.id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {data.clientsById.get(doc.clientId)?.name ?? '—'}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-amber-700">
                          <Receipt className="size-3" /> Bill {doc.number} · {days}{' '}
                          {days === 1 ? 'day' : 'days'} overdue
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-slate-900">
                        {fmt.money(doc.totals.balance, doc.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
                {data.quotesWaiting.slice(0, 3).map((q) => (
                  <li key={q.id}>
                    <Link
                      to={`/quotes/${q.id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {data.clientsById.get(q.clientId)?.name ?? '—'}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="size-3" /> Quote {q.number} awaiting reply
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm text-slate-700">
                        {fmt.money(q.totals.total, q.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="Recent invoices"
            actions={
              <Link
                to="/invoices"
                className="text-primary-700 flex items-center gap-1 text-sm font-medium hover:underline"
              >
                All <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <CardBody className="py-2">
            {data.recentInvoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recentInvoices.map((d) => (
                  <li key={d.id}>
                    <Link
                      to={`/invoices/${d.id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {data.clientsById.get(d.clientId)?.name ?? '—'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {d.number} · {fmt.date(d.issueDate)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="tabular text-sm font-semibold text-slate-900">
                          {fmt.money(d.totals.total, d.currency)}
                        </span>
                        <StatusBadge status={displayStatus(d, now)} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent payments"
            actions={
              <Link
                to="/payments"
                className="text-primary-700 flex items-center gap-1 text-sm font-medium hover:underline"
              >
                All <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <CardBody className="py-2">
            {data.recentPayments.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recentPayments.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/payments/${p.id}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {data.clientsById.get(p.clientId)?.name ?? '—'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {fmt.date(p.date)} · {paymentMethodLabel(p.method)}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-emerald-700">
                        {fmt.money(p.amount, p.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Activity" />
          <CardBody className="py-3">
            {activity && activity.length > 0 ? (
              <ol className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="bg-primary-400 mt-1.5 size-2 shrink-0 rounded-full" />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-700">{a.message}</span>
                      <span className="text-xs text-slate-400">{fmt.dateTime(a.at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">Nothing yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
