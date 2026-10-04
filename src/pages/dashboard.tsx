import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  CalendarClock,
  CircleCheck,
  Clock,
  FileText,
  HandCoins,
  Landmark,
  PackageX,
  Plus,
  Receipt,
  WalletCards,
  X,
} from 'lucide-react';
import { db } from '@/db/db';
import { activityText } from '@/db/activity';
import type { Activity, Client, InvoiceDocument, Payment } from '@/db/types';
import { DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { displayStatus } from '@/lib/status';
import { addDaysISO, daysBetween, toISODate, today } from '@/lib/dates';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { agingReport, AGING_BUCKETS } from '@/lib/reports';
import { bankName, chequePayments, isOpenCheque, paymentMinor } from '@/lib/cheques';
import { stockLevels } from '@/lib/inventory/costing';
import { isStockItem } from '@/lib/inventory/sources';
import { isMoneyAccount } from '@/lib/accounting/account-types';
import { isPosted } from '@/lib/accounting/ledger';
import { vatDueDate, vatPeriodOf } from '@/lib/accounting/vat';
import { formatPeriod, payDateFor, payRunTotals, periodOf } from '@/lib/hr/payroll';
import { isCurrent } from '@/lib/hr/employees';
import { ITEM_STATUS_LABELS, type ComplianceItem } from '@/lib/compliance';
import { isCustomer } from '@/db/purchases';
import { vatSettings } from '@/db/chart-setup';
import { useLedger } from '@/features/accounting/use-ledger';
import { useComplianceCalendar } from '@/features/renewals/hooks';
import { daysText, entryTitle } from '@/features/renewals/display';
import { usePayRuns, usePayrollSettings } from '@/features/payroll/hooks';
import { useEmployees } from '@/features/people/hooks';
import { useTaxesEnabled } from '@/features/company/taxes';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { ColumnChart } from '@/components/charts/column-chart';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { currentLanguage, t, tp } from '@/i18n';

// Validated categorical slots 1 and 2 (dataviz reference palette, light surface).
const SERIES_INVOICED = '#2a78d6';
const SERIES_COLLECTED = '#eb6834';

// Aging buckets are ordered: one hue, lighter to darker as invoices get older
// (validated ordinal ramp: monotone lightness, visible steps, light end ≥ 2:1).
const AGING_COLORS = [
  'bg-indigo-400',
  'bg-indigo-500',
  'bg-indigo-700',
  'bg-indigo-900',
  'bg-indigo-950',
];

/** Days ahead the dashboard looks for cheques, deadlines and documents. */
const CHEQUE_DAYS = 14;
const COMPLIANCE_DAYS = 30;

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

type ChequeRow = Payment & { cheque: NonNullable<Payment['cheque']>; minor: number };

export default function DashboardPage() {
  const company = useCompany();
  const fmt = useFormat();
  const now = today();
  const taxesOn = useTaxesEnabled();
  const ledger = useLedger();
  const compliance = useComplianceCalendar(COMPLIANCE_DAYS);
  const runs = usePayRuns();
  const payrollSettings = usePayrollSettings();
  const employees = useEmployees();
  const precision = currencyPrecision(company.currency);

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
        .filter((tx) => !tx.match && !tx.ignored)
        .toArray(),
    [company.id],
  );
  const lowStock = useLiveQuery(async () => {
    const [products, movements] = await Promise.all([
      db.products.where('companyId').equals(company.id).toArray(),
      db.stockMovements.where('companyId').equals(company.id).toArray(),
    ]);
    const items = products.filter((p) => isStockItem(p) && !p.archived);
    const levels = stockLevels(movements, precision);
    return {
      tracked: items.length,
      low: items
        .filter((p) => p.reorderLevel !== null && p.reorderLevel !== undefined)
        .map((p) => ({ product: p, onHand: levels.get(p.id)?.quantity ?? 0 }))
        .filter((r) => r.onHand <= (r.product.reorderLevel ?? 0))
        .sort((a, b) => a.onHand - b.onHand),
    };
  }, [company.id, precision]);
  const activity = useLiveQuery(
    () =>
      db.activities
        .where('[companyId+at]')
        .between([company.id, ''], [company.id, '￿'])
        .reverse()
        .limit(6)
        .toArray(),
    [company.id],
  );
  const imported = useLiveQuery(
    () =>
      db.activities
        .where('[companyId+at]')
        .between([company.id, ''], [company.id, '￿'])
        .filter((a) => / imported$/.test(a.messageKey ?? a.message))
        .count(),
    [company.id],
  );
  const [checklistDismissed, dismissChecklist] = useDismissed(`checklist-dismissed:${company.id}`);

  const data = useMemo(() => {
    if (!docs || !payments || !clients || !expenses || !vatFiled) return null;
    const clientsById = new Map<string, Client>(clients.map((c) => [c.id, c]));
    const base = company.currency;
    const invoices = docs.filter((d) => d.type === 'invoice');
    const isOpen = (d: InvoiceDocument) =>
      (d.status === 'sent' || d.status === 'partial') && d.totals.balance > 0;
    const open = invoices.filter(isOpen);

    // Who owes you: unpaid invoices in dinars by age; other currencies apart.
    const aging = agingReport(docs, clients, base, now);
    const otherCurrencies = new Map<string, number>();
    for (const d of open) {
      if (d.currency !== base)
        otherCurrencies.set(d.currency, (otherCurrencies.get(d.currency) ?? 0) + d.totals.balance);
    }
    const overdue = open
      .filter((d) => displayStatus(d, now) === 'overdue')
      .map((d) => ({ doc: d, days: d.dueDate ? daysBetween(d.dueDate, now) : 0 }))
      .sort((a, b) => b.days - a.days);

    // What you owe this week: bills due in the next seven days or already late.
    const weekEnd = addDaysISO(now, 6);
    const openBills = docs.filter((d) => d.type === 'bill' && isOpen(d));
    const billsDue = openBills.filter((d) => (d.dueDate ?? d.issueDate) <= weekEnd);
    const billsOverdue = openBills
      .filter((d) => displayStatus(d, now) === 'overdue')
      .map((d) => ({ doc: d, days: d.dueDate ? daysBetween(d.dueDate, now) : 0 }))
      .sort((a, b) => b.days - a.days);
    const sumBase = (list: InvoiceDocument[]) =>
      list.filter((d) => d.currency === base).reduce((s, d) => s + d.totals.balance, 0);

    // Cheques: open ones dated in the next 14 days, or late.
    const horizon = addDaysISO(now, CHEQUE_DAYS - 1);
    const live = payments.filter((p) => !p.voided);
    const dueCheques = (direction: 'in' | 'out'): ChequeRow[] =>
      chequePayments(live, direction)
        .filter((p) => isOpenCheque(p.cheque.status) && p.cheque.date <= horizon)
        .filter((p) => p.cheque.status === 'held' || p.cheque.date >= now)
        .map((p) => ({ ...p, minor: paymentMinor(p, base, precision) }))
        .sort((a, b) => a.cheque.date.localeCompare(b.cheque.date));
    const chequesIn = dueCheques('in');
    const chequesOut = dueCheques('out');

    // Invoiced against collected, last 12 months.
    const issued = invoices.filter((d) => d.status !== 'draft' && d.status !== 'void');
    const cash = live.filter(
      (p) => p.direction !== 'out' && p.method !== 'credit_note' && p.currency === base,
    );
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

    const vatDue = (() => {
      if (!taxesOn) return null;
      // The last ended VAT period, until it is marked as filed.
      const vat = vatSettings(company);
      if (!vat.registered) return null;
      const period = vatPeriodOf(addDaysISO(vatPeriodOf(now, vat).start, -1), vat);
      if (vatFiled.some((r) => r.periodStart === period.start)) return null;
      const active =
        docs.some((d) => isPosted(d) && d.issueDate <= period.end) ||
        expenses.some((e) => e.date <= period.end);
      if (!active) return null;
      return { period, due: vatDueDate(period, vat.format) };
    })();

    return {
      clientsById,
      docTypes: new Map(docs.map((d) => [d.id, d.type])),
      aging,
      otherCurrencies: [...otherCurrencies.entries()],
      overdue,
      overdueTotal: overdue
        .filter((o) => o.doc.currency === base)
        .reduce((s, o) => s + o.doc.totals.balance, 0),
      billsDue,
      billsDueTotal: sumBase(billsDue),
      billsOverdue,
      billsOverdueTotal: sumBase(billsOverdue.map((b) => b.doc)),
      chequesIn,
      chequesOut,
      chart: {
        labels,
        invoiced: invoicedByMonth,
        collected: collectedByMonth,
        empty: invoicedByMonth.every((v) => v === 0) && collectedByMonth.every((v) => v === 0),
      },
      quotesWaiting,
      vatDue,
      hasClients: clients.some(isCustomer),
      hasInvoices: invoices.length > 0,
    };
  }, [docs, payments, clients, expenses, vatFiled, company, fmt.locale, now, taxesOn, precision]);

  const cash = useMemo(() => {
    if (!ledger) return null;
    const balances = new Map<string, number>();
    for (const line of ledger.lines) {
      balances.set(line.accountId, (balances.get(line.accountId) ?? 0) + line.amount);
    }
    const accounts = ledger.accounts
      .filter((a) => isMoneyAccount(a.type) && a.type === 'asset_cash' && !a.archived)
      .map((a) => ({ account: a, minor: balances.get(a.id) ?? 0 }))
      .sort((a, b) => b.minor - a.minor);
    return { accounts, total: accounts.reduce((s, a) => s + a.minor, 0) };
  }, [ledger]);

  if (!data || !cash) return <Spinner className="py-24" label={t('Loading…')} />;

  const major = (minor: number) => fromMinor(minor, precision);
  const currentStaff = employees?.filter(isCurrent).length ?? 0;
  const chequesInTotal = data.chequesIn.reduce((s, c) => s + c.minor, 0);
  const chequesOutTotal = data.chequesOut.reduce((s, c) => s + c.minor, 0);

  const checklist = [
    {
      done: Boolean(company.branding.logo) && Boolean(company.branding.stamp),
      label: t('Add your logo and stamp'),
      to: '/settings/company',
    },
    {
      done: Boolean(company.payment.bankDetails.trim()),
      label: t('Add your bank and IBAN'),
      to: '/settings/payments',
    },
    { done: data.hasClients, label: t('Add your first client'), to: '/clients/new' },
    { done: data.hasInvoices, label: t('Create your first invoice'), to: '/invoices/new' },
    {
      done: (imported ?? 0) > 0 || data.hasInvoices,
      label: t('Import your data'),
      to: '/settings/import',
    },
  ];
  const remaining = checklist.filter((c) => !c.done);
  const showChecklist = !checklistDismissed && remaining.length > 0;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{t('Dashboard')}</h1>
          <p className="mt-1 truncate text-sm text-slate-500">
            <span dir="auto">{localName(company)}</span> · {fmt.date(now)}
          </p>
        </div>
        {/* Phones create from the tab bar's + button. */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <ButtonLink to="/quotes/new" variant="outline">
            {t('New quote')}
          </ButtonLink>
          <ButtonLink to="/invoices/new">
            <Plus /> {t('New invoice')}
          </ButtonLink>
        </div>
      </header>

      {showChecklist ? (
        <section
          aria-label={t('Finish setting up')}
          className="border-primary-100 bg-primary-50/60 order-2 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center lg:order-none"
        >
          <div className="flex items-center gap-3">
            <ProgressRing done={checklist.length - remaining.length} total={checklist.length} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{t('Finish setting up')}</p>
              <p className="text-xs text-slate-600">
                {tp(remaining.length, '{count} step left', '{count} steps left')}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissChecklist}
              className="ms-auto -me-1 flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-slate-700 sm:order-last pointer-coarse:size-11"
              aria-label={t('Hide the setup steps')}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <ul className="flex flex-wrap gap-2 sm:flex-1 sm:justify-end">
            {remaining.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="hover:border-primary-300 hover:text-primary-800 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-xs pointer-coarse:min-h-11"
                >
                  {item.label}
                  <ArrowRight className="size-3.5 text-slate-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        aria-label={t('Key figures')}
        className="order-1 grid grid-cols-2 gap-3 lg:order-none lg:grid-cols-4 lg:gap-4"
      >
        <Kpi
          to="/banking"
          icon={Landmark}
          label={t('Cash and bank')}
          amount={major(cash.total)}
          hint={
            cash.accounts.length === 0
              ? t('No bank accounts yet')
              : tp(cash.accounts.length, 'In {count} account', 'In {count} accounts')
          }
        />
        <Kpi
          to="/reports/aging"
          icon={HandCoins}
          label={t('Owed to you')}
          amount={data.aging.total}
          hint={
            data.overdueTotal > 0 ? (
              <span className="text-red-700">
                {t('{amount} overdue', { amount: fmt.money(data.overdueTotal) })}
              </span>
            ) : data.aging.total > 0 ? (
              t('Nothing overdue')
            ) : (
              t('No unpaid invoices')
            )
          }
        />
        <Kpi
          to="/bills?status=unpaid"
          icon={Receipt}
          label={t('You owe this week')}
          amount={data.billsDueTotal}
          hint={
            data.billsDue.length === 0 ? (
              t('No bills due')
            ) : data.billsOverdueTotal > 0 ? (
              <span className="text-red-700">
                {t('{amount} overdue', { amount: fmt.money(data.billsOverdueTotal) })}
              </span>
            ) : (
              tp(data.billsDue.length, '{count} bill due', '{count} bills due')
            )
          }
        />
        <Kpi
          to="/cheques"
          icon={WalletCards}
          label={t('Cheques due')}
          amount={major(chequesInTotal)}
          hint={
            data.chequesIn.length + data.chequesOut.length === 0
              ? tp(CHEQUE_DAYS, 'None in the next {count} day', 'None in the next {count} days')
              : t('{amount} to pay out', { amount: fmt.money(major(chequesOutTotal)) })
          }
        />
      </section>

      <div className="order-3 grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-3">
        <ReceivablesCard
          aging={data.aging}
          otherCurrencies={data.otherCurrencies}
          clientsById={data.clientsById}
        />
        <Card className="xl:order-none">
          <CardHeader
            title={t('Needs attention')}
            actions={
              data.overdue.length ? (
                <CardLink to="/invoices?status=overdue">{t('Overdue invoices')}</CardLink>
              ) : null
            }
          />
          <AttentionList
            data={data}
            bankLines={bankToMatch?.length ?? 0}
            bankTo={bankLink(bankToMatch)}
          />
        </Card>
      </div>

      <div
        className={cn(
          'order-3 grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-6',
          // A third column only for payroll and stock, when the company has them.
          (currentStaff > 0 || (lowStock?.tracked ?? 0) > 0) && 'xl:grid-cols-3',
        )}
      >
        <ChequesCard incoming={data.chequesIn} outgoing={data.chequesOut} />
        <ComplianceCard items={compliance} />
        {currentStaff > 0 || (lowStock?.tracked ?? 0) > 0 ? (
          <div className="flex min-w-0 flex-col gap-5 md:col-span-2 lg:gap-6 xl:col-span-1">
            <PayrollCard runs={runs} payDay={payrollSettings?.payDay} employees={currentStaff} />
            <LowStockCard data={lowStock} />
          </div>
        ) : null}
      </div>

      <div className="order-3 grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader
            title={t('Invoiced vs collected')}
            description={tp(
              12,
              'Last {count} month · {currency}',
              'Last {count} months · {currency}',
              {
                currency: company.currency,
              },
            )}
          />
          <CardBody>
            {data.chart.empty ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <span className="bg-primary-50 text-primary-600 flex size-11 items-center justify-center rounded-full">
                  <FileText className="size-5" aria-hidden />
                </span>
                <p className="mt-3 text-sm font-medium text-slate-900">
                  {tp(
                    12,
                    'No invoices in the last {count} month',
                    'No invoices in the last {count} months',
                  )}
                </p>
                <p className="mt-1 max-w-xs text-sm text-slate-500">
                  {t('Your monthly sales and the payments you collect will show here.')}
                </p>
                <ButtonLink to="/invoices/new" size="sm" variant="outline" className="mt-4">
                  <Plus /> {t('New invoice')}
                </ButtonLink>
              </div>
            ) : (
              <ColumnChart
                title={t('Invoiced and collected per month')}
                labels={data.chart.labels}
                series={[
                  {
                    key: 'invoiced',
                    label: t('Invoiced'),
                    color: SERIES_INVOICED,
                    values: data.chart.invoiced,
                  },
                  {
                    key: 'collected',
                    label: t('Collected'),
                    color: SERIES_COLLECTED,
                    values: data.chart.collected,
                  },
                ]}
                formatValue={(v) => fmt.money(v)}
                formatTick={(v) => compactNumber(v, fmt.locale)}
              />
            )}
          </CardBody>
        </Card>
        <ActivityCard activity={activity} docTypes={data.docTypes} />
      </div>
    </div>
  );
}

/** Axis ticks: "12K" (the currency is named in the card's description). */
function compactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function bankLink(lines: { accountId: string }[] | undefined): string {
  if (!lines?.length) return '/banking';
  return new Set(lines.map((l) => l.accountId)).size === 1
    ? `/banking/${lines[0].accountId}`
    : '/banking';
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-primary-700 -my-1 flex items-center gap-1 rounded-md py-1 text-sm font-medium hover:underline pointer-coarse:min-h-11"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3.5"
          className="stroke-primary-100"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${(done / total) * c} ${c}`}
          className="stroke-primary-600"
        />
      </svg>
      <span className="text-primary-800 absolute text-xs font-semibold">
        {done}/{total}
      </span>
    </span>
  );
}

function Kpi({
  to,
  icon: Icon,
  label,
  amount,
  hint,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  amount: number;
  hint: ReactNode;
}) {
  const fmt = useFormat();
  const long = fmt.money(amount).replace(/[\u200e\u200f\u2066-\u2069]/g, '').length > 13;
  return (
    <Link
      to={to}
      className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition-colors hover:border-slate-300 sm:p-5"
    >
      <span className="flex items-center gap-2 text-slate-500">
        <Icon className="size-4 shrink-0 text-slate-400" aria-hidden />
        <span className="truncate text-xs font-medium sm:text-sm">{label}</span>
      </span>
      <MoneyText
        amount={amount}
        tone={amount === 0 ? 'muted' : 'default'}
        className={cn(
          'mt-2 block font-semibold tracking-tight [font-variant-numeric:normal]',
          long ? 'text-base sm:text-xl xl:text-2xl' : 'text-lg sm:text-2xl',
        )}
      />
      <span className="mt-1 truncate text-xs text-slate-500">{hint}</span>
    </Link>
  );
}

function ReceivablesCard({
  aging,
  otherCurrencies,
  clientsById,
}: {
  aging: ReturnType<typeof agingReport>;
  otherCurrencies: [string, number][];
  clientsById: Map<string, Client>;
}) {
  const fmt = useFormat();
  const { total, totals, rows } = aging;
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title={t('Who owes you')}
        description={t('Unpaid invoices by how late they are')}
        actions={<CardLink to="/reports/aging">{t('Aging report')}</CardLink>}
      />
      <CardBody>
        {total === 0 && otherCurrencies.length === 0 ? (
          <div className="flex items-center gap-3 py-2 text-sm text-slate-600">
            <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
            {t('No unpaid invoices. Everything you invoiced has been paid.')}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
            <div className="min-w-0">
              <div
                className="flex h-3 gap-0.5 overflow-hidden rounded bg-slate-100"
                role="img"
                aria-label={t('Unpaid invoices by age')}
              >
                {totals.map((amount, i) =>
                  amount > 0 ? (
                    <span
                      key={i}
                      title={`${t(AGING_BUCKETS[i])}: ${fmt.money(amount)}`}
                      className={cn('h-full first:rounded-s last:rounded-e', AGING_COLORS[i])}
                      style={{ width: `${(amount / total) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <dl className="mt-4 divide-y divide-slate-100">
                {totals.map((amount, i) => (
                  <div
                    key={i}
                    // Phones list only the ages with something owed.
                    className={cn(
                      'items-center justify-between gap-3 py-1.5 text-sm',
                      amount === 0 ? 'hidden sm:flex' : 'flex',
                    )}
                  >
                    <dt className="flex items-center gap-2 text-slate-600">
                      <span className={cn('size-2.5 shrink-0 rounded-sm', AGING_COLORS[i])} />
                      {t(AGING_BUCKETS[i])}
                    </dt>
                    <dd>
                      <MoneyText amount={amount} tone={amount === 0 ? 'muted' : 'default'} />
                    </dd>
                  </div>
                ))}
                {otherCurrencies.map(([currency, amount]) => (
                  <div
                    key={currency}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                  >
                    <dt className="text-slate-600">{t('In {currency}', { currency })}</dt>
                    <dd>
                      <MoneyText amount={amount} currency={currency} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-slate-500">{t('Largest balances')}</p>
              {rows.length === 0 ? (
                <p className="py-3 text-sm text-slate-500">
                  {t('Only invoices in other currencies.')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {rows.slice(0, 5).map((row, i) => {
                    const late = row.buckets.slice(1).reduce((s, v) => s + v, 0);
                    return (
                      // Three on a phone, five on larger screens.
                      <li key={row.clientId} className={i >= 3 ? 'hidden sm:block' : undefined}>
                        <Link
                          to={`/clients/${row.clientId}`}
                          className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
                        >
                          <span className="min-w-0">
                            <span
                              dir="auto"
                              className="block truncate text-sm font-medium text-slate-800"
                            >
                              {localName(clientsById.get(row.clientId)) || row.clientName}
                            </span>
                            {late > 0 ? (
                              <span className="text-xs text-red-700">
                                {t('{amount} overdue', { amount: fmt.money(late) })}
                              </span>
                            ) : null}
                          </span>
                          <MoneyText
                            amount={row.total}
                            className="shrink-0 text-sm font-semibold"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AttentionRow({
  to,
  title,
  detail,
  detailTone = 'muted',
  icon: Icon,
  amount,
}: {
  to: string;
  title: ReactNode;
  detail: ReactNode;
  detailTone?: 'muted' | 'danger' | 'warning';
  icon: LucideIcon;
  amount?: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <Icon
            className={cn(
              'mt-0.5 size-4 shrink-0',
              detailTone === 'danger'
                ? 'text-red-600'
                : detailTone === 'warning'
                  ? 'text-amber-600'
                  : 'text-slate-400',
            )}
            aria-hidden
          />
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-sm font-medium text-slate-800">
              {title}
            </span>
            <span
              className={cn(
                'block text-xs',
                detailTone === 'danger'
                  ? 'text-red-700'
                  : detailTone === 'warning'
                    ? 'text-amber-700'
                    : 'text-slate-500',
              )}
            >
              {detail}
            </span>
          </span>
        </span>
        {amount ?? <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />}
      </Link>
    </li>
  );
}

function AttentionList({
  data,
  bankLines,
  bankTo,
}: {
  data: {
    overdue: { doc: InvoiceDocument; days: number }[];
    billsOverdue: { doc: InvoiceDocument; days: number }[];
    quotesWaiting: InvoiceDocument[];
    vatDue: { period: { start: string; end: string }; due: string } | null;
    clientsById: Map<string, Client>;
  };
  bankLines: number;
  bankTo: string;
}) {
  const fmt = useFormat();
  const now = today();
  const name = (id: string) => localName(data.clientsById.get(id)) || '—';
  const nothing =
    data.overdue.length === 0 &&
    data.billsOverdue.length === 0 &&
    data.quotesWaiting.length === 0 &&
    !data.vatDue &&
    bankLines === 0;
  if (nothing) {
    return (
      <CardBody className="flex flex-col items-center py-10 text-center">
        <CircleCheck className="size-8 text-emerald-600" aria-hidden />
        <p className="mt-2 text-sm font-medium text-slate-800">{t('All caught up')}</p>
        <p className="text-sm text-slate-500">{t('No overdue invoices or bills.')}</p>
      </CardBody>
    );
  }
  return (
    <CardBody className="py-2">
      <ul className="divide-y divide-slate-100">
        {data.overdue.slice(0, 3).map(({ doc, days }) => (
          <AttentionRow
            key={doc.id}
            to={`/invoices/${doc.id}`}
            icon={AlertCircle}
            title={name(doc.clientId)}
            detailTone="danger"
            detail={tp(days, '{number} · {count} day overdue', '{number} · {count} days overdue', {
              number: doc.number,
            })}
            amount={
              <MoneyText
                amount={doc.totals.balance}
                currency={doc.currency}
                className="shrink-0 text-sm font-semibold"
              />
            }
          />
        ))}
        {data.billsOverdue.slice(0, 2).map(({ doc, days }) => (
          <AttentionRow
            key={doc.id}
            to={`/bills/${doc.id}`}
            icon={Receipt}
            title={name(doc.clientId)}
            detailTone="warning"
            detail={tp(
              days,
              'Bill {number} · {count} day overdue',
              'Bill {number} · {count} days overdue',
              { number: doc.number },
            )}
            amount={
              <MoneyText
                amount={doc.totals.balance}
                currency={doc.currency}
                className="shrink-0 text-sm font-semibold"
              />
            }
          />
        ))}
        {bankLines > 0 ? (
          <AttentionRow
            to={bankTo}
            icon={Banknote}
            title={t('Bank statement')}
            detail={tp(bankLines, '{count} line to match', '{count} lines to match')}
          />
        ) : null}
        {data.vatDue ? (
          <AttentionRow
            to={`/vat/${data.vatDue.period.start}`}
            icon={Landmark}
            title={t('VAT return to file')}
            detailTone={data.vatDue.due < now ? 'danger' : 'muted'}
            detail={t('{start} – {end} · due {date}', {
              start: fmt.date(data.vatDue.period.start),
              end: fmt.date(data.vatDue.period.end),
              date: fmt.date(data.vatDue.due),
            })}
          />
        ) : null}
        {data.quotesWaiting.slice(0, 2).map((q) => (
          <AttentionRow
            key={q.id}
            to={`/quotes/${q.id}`}
            icon={Clock}
            title={name(q.clientId)}
            detail={t('Quote {number} awaiting reply', { number: q.number })}
            amount={
              <MoneyText
                amount={q.totals.total}
                currency={q.currency}
                tone="muted"
                className="shrink-0 text-sm"
              />
            }
          />
        ))}
      </ul>
    </CardBody>
  );
}

function ChequesCard({ incoming, outgoing }: { incoming: ChequeRow[]; outgoing: ChequeRow[] }) {
  const fmt = useFormat();
  const now = today();
  const rows = [
    ...incoming.map((c) => ({ c, out: false })),
    ...outgoing.map((c) => ({ c, out: true })),
  ].sort((a, b) => a.c.cheque.date.localeCompare(b.c.cheque.date));
  return (
    <Card>
      <CardHeader
        title={t('Cheques due')}
        description={tp(
          CHEQUE_DAYS,
          'Received and issued, next {count} day',
          'Received and issued, next {count} days',
        )}
        actions={<CardLink to="/cheques">{t('Register')}</CardLink>}
      />
      <CardBody className="py-2">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 sm:py-6">
            {tp(
              CHEQUE_DAYS,
              'No cheques fall due in the next {count} day.',
              'No cheques fall due in the next {count} days.',
            )}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.slice(0, 5).map(({ c, out }) => {
              const days = daysBetween(now, c.cheque.date);
              const late = days < 0;
              return (
                <li key={c.id}>
                  <Link
                    to={`/${out ? 'payments-made' : 'payments'}/${c.id}`}
                    className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span
                        dir="auto"
                        className="block truncate text-sm font-medium text-slate-800"
                      >
                        {c.cheque.drawer || bankName(c.cheque.bank, currentLanguage())}
                      </span>
                      <span
                        className={cn(
                          'block truncate text-xs',
                          late ? 'text-red-700' : 'text-slate-500',
                        )}
                      >
                        {[
                          out ? t('Issued') : t('Received'),
                          fmt.date(c.cheque.date),
                          daysText(days),
                        ].join(' · ')}
                      </span>
                    </span>
                    <MoneyText
                      amount={fromMinor(c.minor, currencyPrecision(fmt.currency))}
                      tone={out ? 'negative' : 'positive'}
                      className="shrink-0 text-sm font-semibold"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 5 ? (
          <p className="pt-2 pb-1 text-xs text-slate-500">
            {tp(rows.length - 5, '{count} more in the register', '{count} more in the register')}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ComplianceCard({ items }: { items: ComplianceItem[] | undefined }) {
  const fmt = useFormat();
  const open = (items ?? []).filter((i) => i.status !== 'done').slice(0, 5);
  return (
    <Card>
      <CardHeader
        title={t('Deadlines and renewals')}
        description={tp(
          COMPLIANCE_DAYS,
          'Next {count} day and anything late',
          'Next {count} days and anything late',
        )}
        actions={<CardLink to="/compliance">{t('Calendar')}</CardLink>}
      />
      <CardBody className="py-2">
        {!items ? (
          <Spinner className="py-6" />
        ) : open.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 sm:py-6">
            {tp(
              COMPLIANCE_DAYS,
              'Nothing due in the next {count} day.',
              'Nothing due in the next {count} days.',
            )}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {open.map((item) => {
              const title = item.deadline
                ? t(item.deadline.title, item.deadline.vars)
                : item.entry
                  ? entryTitle(item.entry)
                  : '';
              const late = item.status === 'overdue';
              return (
                <li key={item.key}>
                  <Link
                    to={item.kind === 'document' ? '/compliance/documents' : '/compliance'}
                    className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-start gap-2.5">
                      <CalendarClock
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          late ? 'text-red-600' : 'text-slate-400',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span
                          dir="auto"
                          className="block truncate text-sm font-medium text-slate-800"
                        >
                          {title}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {fmt.date(item.dueDate)} · {daysText(item.daysLeft)}
                        </span>
                      </span>
                    </span>
                    <Badge tone={late ? 'red' : item.status === 'due_soon' ? 'amber' : 'gray'}>
                      {t(ITEM_STATUS_LABELS[item.status])}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function PayrollCard({
  runs,
  payDay,
  employees,
}: {
  runs: ReturnType<typeof usePayRuns>;
  payDay: number | undefined;
  employees: number;
}) {
  const fmt = useFormat();
  if (!runs || payDay === undefined || employees === 0) return null;
  const now = today();
  const month = periodOf(now);
  const unpaid = [...runs]
    .filter((r) => r.status !== 'paid')
    .sort((a, b) => a.period.localeCompare(b.period))[0];
  const thisMonth = runs.find((r) => r.period === month);
  const precision = currencyPrecision(fmt.currency);

  let body: ReactNode;
  if (unpaid) {
    const late = unpaid.payDate < now;
    body = (
      <Link
        to={`/payroll/runs/${unpaid.id}`}
        className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800">
            {formatPeriod(unpaid.period, fmt.locale)}
          </span>
          <span className={cn('block truncate text-xs', late ? 'text-red-700' : 'text-slate-500')}>
            {unpaid.status === 'draft' ? t('Draft, not approved') : t('Approved, not paid')} ·{' '}
            {t('pay by {date}', { date: fmt.date(unpaid.payDate) })}
          </span>
        </span>
        <MoneyText
          amount={payRunTotals(unpaid.lines, precision).net}
          className="shrink-0 text-sm font-semibold"
        />
      </Link>
    );
  } else if (!thisMonth) {
    body = (
      <Link
        to="/payroll"
        className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800">
            {formatPeriod(month, fmt.locale)}
          </span>
          <span className="block truncate text-xs text-slate-500">
            {t('Not prepared yet')} ·{' '}
            {t('pay day {date}', { date: fmt.date(payDateFor(month, payDay)) })}
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />
      </Link>
    );
  } else {
    body = (
      <p className="flex items-center gap-2 py-2 text-sm text-slate-600">
        <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden />
        {t('{month} is paid.', { month: formatPeriod(month, fmt.locale) })}
      </p>
    );
  }
  return (
    <Card>
      <CardHeader
        title={t('Payroll')}
        description={tp(employees, '{count} employee', '{count} employees')}
        actions={<CardLink to="/payroll">{t('Pay runs')}</CardLink>}
      />
      <CardBody className="py-2">{body}</CardBody>
    </Card>
  );
}

function LowStockCard({
  data,
}: {
  data:
    | {
        tracked: number;
        low: {
          product: { id: string; name: string; nameAr?: string; unit: string };
          onHand: number;
        }[];
      }
    | undefined;
}) {
  const fmt = useFormat();
  if (!data || data.tracked === 0) return null;
  return (
    <Card>
      <CardHeader
        title={t('Low stock')}
        description={
          data.low.length
            ? tp(data.low.length, '{count} item to reorder', '{count} items to reorder')
            : t('Every item is above its reorder level.')
        }
        actions={
          data.low.length ? <CardLink to="/products?filter=low">{t('View')}</CardLink> : null
        }
      />
      {data.low.length ? (
        <CardBody className="py-2">
          <ul className="divide-y divide-slate-100">
            {data.low.slice(0, 3).map(({ product, onHand }) => (
              <li
                key={product.id}
                className="flex min-h-11 items-center justify-between gap-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <PackageX className="size-4 shrink-0 text-amber-600" aria-hidden />
                  <span dir="auto" className="truncate text-sm font-medium text-slate-800">
                    {localName(product)}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm text-slate-600">
                  {fmt.quantity(onHand)} {product.unit}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}
    </Card>
  );
}

function activityLink(a: Activity, docTypes: Map<string, InvoiceDocument['type']>): string | null {
  if (a.documentId) {
    const type = docTypes.get(a.documentId);
    if (type) return `${DOCUMENT_ROUTES[type]}/${a.documentId}`;
  }
  if (a.entity === 'client' && a.entityId) return `/clients/${a.entityId}`;
  return null;
}

function ActivityCard({
  activity,
  docTypes,
}: {
  activity: Activity[] | undefined;
  docTypes: Map<string, InvoiceDocument['type']>;
}) {
  const fmt = useFormat();
  return (
    <Card>
      <CardHeader title={t('Recent activity')} />
      <CardBody className="py-3">
        {activity && activity.length > 0 ? (
          <ol className="space-y-1">
            {activity.map((a) => {
              const to = activityLink(a, docTypes);
              const body = (
                <>
                  <span
                    className="bg-primary-400 mt-1.5 size-2 shrink-0 rounded-full"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-700">{activityText(a, fmt)}</span>
                    <span className="text-xs text-slate-500">{when(a.at, fmt)}</span>
                  </span>
                </>
              );
              return (
                <li key={a.id}>
                  {to ? (
                    <Link
                      to={to}
                      className="-mx-2 flex gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex gap-3 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-4 text-center text-sm text-slate-500 sm:py-6">
            {t('What you and your team do will show here.')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** "Just now", "5 minutes ago", "Today at 10:42", "Yesterday" or the date. */
function when(at: string, fmt: ReturnType<typeof useFormat>): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return '';
  const minutes = Math.round((Date.now() - time.getTime()) / 60_000);
  if (minutes < 1) return t('Just now');
  if (minutes < 60) return tp(minutes, '{count} minute ago', '{count} minutes ago');
  const local = toISODate(time);
  const clock = new Intl.DateTimeFormat(fmt.locale, { hour: 'numeric', minute: '2-digit' }).format(
    time,
  );
  if (local === today()) return t('Today at {time}', { time: clock });
  if (local === addDaysISO(today(), -1)) return t('Yesterday at {time}', { time: clock });
  return fmt.date(local);
}
