import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import type { Account, ISODate } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { useLedger } from '@/features/accounting/use-ledger';
import { sourceLink } from '@/features/accounting/source-link';
import { addDaysISO, parseISODate, toISODate, today } from '@/lib/dates';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { downloadCsv } from '@/lib/csv';
import { presetRange } from '@/lib/reports';
import type { LedgerLine } from '@/lib/accounting/ledger';
import {
  balanceSheet,
  fiscalYearEnd,
  fiscalYearStart,
  generalLedger,
  profitAndLoss,
  trialBalance,
  type DateRange,
  type FiscalYearEnd,
  type StatementSection,
} from '@/lib/accounting/statements';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Badge, Card, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';

/* -------------------------------------------------------------------------- */
/* Periods                                                                    */
/* -------------------------------------------------------------------------- */

type PeriodPreset =
  | 'this-year'
  | 'last-year'
  | 'this-quarter'
  | 'last-quarter'
  | 'this-month'
  | 'last-month'
  | 'custom';

const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: 'this-year', label: 'This financial year' },
  { value: 'last-year', label: 'Last financial year' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'last-quarter', label: 'Last quarter' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'custom', label: 'Custom dates' },
];

function periodRange(preset: PeriodPreset, yearEnd: FiscalYearEnd, custom: DateRange): DateRange {
  const now = today();
  switch (preset) {
    case 'this-year':
      return { from: fiscalYearStart(now, yearEnd), to: fiscalYearEnd(now, yearEnd) };
    case 'last-year': {
      const lastEnd = addDaysISO(fiscalYearStart(now, yearEnd), -1);
      return { from: fiscalYearStart(lastEnd, yearEnd), to: lastEnd };
    }
    case 'custom':
      return custom;
    default:
      return presetRange(preset, now);
  }
}

type AsOfPreset = 'today' | 'last-month' | 'last-quarter' | 'last-year' | 'custom';

const AS_OF: { value: AsOfPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last-month', label: 'End of last month' },
  { value: 'last-quarter', label: 'End of last quarter' },
  { value: 'last-year', label: 'End of last financial year' },
  { value: 'custom', label: 'Custom date' },
];

function asOfDate(preset: AsOfPreset, yearEnd: FiscalYearEnd, custom: ISODate): ISODate {
  const now = today();
  switch (preset) {
    case 'today':
      return now;
    case 'last-month':
      return presetRange('last-month', now).to;
    case 'last-quarter':
      return presetRange('last-quarter', now).to;
    case 'last-year':
      return addDaysISO(fiscalYearStart(now, yearEnd), -1);
    case 'custom':
      return custom;
  }
}

function usePeriod(yearEnd: FiscalYearEnd, initial: { preset: PeriodPreset; custom?: DateRange }) {
  const [preset, setPreset] = useState<PeriodPreset>(initial.preset);
  const [custom, setCustom] = useState<DateRange>(
    () => initial.custom ?? presetRange('this-quarter', today()),
  );
  const { month, day } = yearEnd;
  const range = useMemo(
    () => periodRange(preset, { month, day }, custom),
    [preset, month, day, custom],
  );
  return { preset, setPreset, custom, setCustom, range };
}

function useAsOf(yearEnd: FiscalYearEnd) {
  const [preset, setPreset] = useState<AsOfPreset>('today');
  const [custom, setCustom] = useState(today());
  const asOf = asOfDate(preset, yearEnd, custom);
  return { preset, setPreset, custom, setCustom, asOf };
}

const CALENDAR_YEAR: FiscalYearEnd = { month: 12, day: 31 };

function PeriodPicker({
  preset,
  onPreset,
  custom,
  onCustom,
}: {
  preset: PeriodPreset;
  onPreset: (p: PeriodPreset) => void;
  custom: DateRange;
  onCustom: (r: DateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Period"
        value={preset}
        onChange={(e) => onPreset(e.target.value as PeriodPreset)}
        className="w-auto"
      >
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {preset === 'custom' ? (
        <>
          <Input
            type="date"
            aria-label="From"
            value={custom.from}
            onChange={(e) => onCustom({ ...custom, from: e.target.value || custom.from })}
            className="w-auto"
          />
          <span className="text-slate-400">–</span>
          <Input
            type="date"
            aria-label="To"
            value={custom.to}
            onChange={(e) => onCustom({ ...custom, to: e.target.value || custom.to })}
            className="w-auto"
          />
        </>
      ) : null}
    </div>
  );
}

function AsOfPicker({
  preset,
  onPreset,
  custom,
  onCustom,
}: {
  preset: AsOfPreset;
  onPreset: (p: AsOfPreset) => void;
  custom: ISODate;
  onCustom: (d: ISODate) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="As of"
        value={preset}
        onChange={(e) => onPreset(e.target.value as AsOfPreset)}
        className="w-auto"
      >
        {AS_OF.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {preset === 'custom' ? (
        <Input
          type="date"
          aria-label="Date"
          value={custom}
          onChange={(e) => onCustom(e.target.value || custom)}
          className="w-auto"
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

function useMinorMoney() {
  const company = useCompany();
  const fmt = useFormat();
  const p = currencyPrecision(company.currency);
  return {
    money: (minor: number) => fmt.money(fromMinor(minor, p), company.currency),
    major: (minor: number) => fromMinor(minor, p),
  };
}

function ledgerLink(account: Account, range?: DateRange) {
  const params = new URLSearchParams({ account: account.id });
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  return `/reports/general-ledger?${params.toString()}`;
}

function Toolbar({ children, onExport }: { children: ReactNode; onExport?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {onExport ? (
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download /> Export CSV
        </Button>
      ) : null}
    </div>
  );
}

function ReportTitle({ title, subtitle }: { title: string; subtitle: string }) {
  const company = useCompany();
  return (
    <div className="px-5 pt-6 pb-2 text-center">
      <p className="text-sm text-slate-500">{company.name}</p>
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Problems() {
  const ledger = useLedger();
  if (!ledger || ledger.problems.length === 0) return null;
  return (
    <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" /> Some transactions need attention
      </p>
      <ul className="mt-1 space-y-0.5">
        {ledger.problems.slice(0, 8).map((p) => (
          <li key={`${p.sourceId}-${p.message}`}>
            <Link to={sourceLink(p)} className="font-medium underline">
              {p.number}
            </Link>
            : {p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionRows({
  section,
  range,
  totalLabel,
  hideTitle,
}: {
  section: StatementSection;
  range?: DateRange;
  totalLabel?: string;
  hideTitle?: boolean;
}) {
  const { money } = useMinorMoney();
  return (
    <>
      {!hideTitle ? (
        <tr>
          <td colSpan={2} className="px-5 pt-4 pb-1 text-sm font-semibold text-slate-900">
            {section.label}
          </td>
        </tr>
      ) : null}
      {section.rows.length === 0 ? (
        <tr>
          <td colSpan={2} className="px-5 py-1.5 ps-8 text-sm text-slate-400">
            No transactions
          </td>
        </tr>
      ) : (
        section.rows.map((r) => (
          <tr key={r.account.id} className="hover:bg-slate-50">
            <td className="py-1.5 ps-8 pe-4 text-sm">
              <Link
                to={ledgerLink(r.account, range)}
                className="hover:text-primary-700 text-slate-700"
              >
                <span className="tabular me-2 text-slate-400">{r.account.code}</span>
                {r.account.name}
              </Link>
            </td>
            <td className="tabular px-5 py-1.5 text-end text-sm text-slate-700">
              {money(r.amount)}
            </td>
          </tr>
        ))
      )}
      <TotalRow
        label={totalLabel ?? `Total ${section.label.toLowerCase()}`}
        amount={section.total}
      />
    </>
  );
}

function TotalRow({
  label,
  amount,
  strong,
  tone,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  tone?: 'profit';
}) {
  const { money } = useMinorMoney();
  return (
    <tr
      className={cn(
        strong ? 'border-y-2 border-slate-200 bg-slate-50' : 'border-t border-slate-100',
      )}
    >
      <td
        className={cn(
          'px-5 py-2 text-sm',
          strong ? 'font-semibold text-slate-900' : 'font-medium text-slate-700',
        )}
      >
        {label}
      </td>
      <td
        className={cn(
          'tabular px-5 py-2 text-end text-sm',
          strong ? 'font-semibold' : 'font-medium',
          tone === 'profit' ? (amount < 0 ? 'text-red-600' : 'text-emerald-700') : 'text-slate-900',
        )}
      >
        {money(amount)}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Profit and loss                                                            */
/* -------------------------------------------------------------------------- */

export function ProfitAndLossReport() {
  const ledger = useLedger();
  const fmt = useFormat();
  const { major } = useMinorMoney();
  const period = usePeriod(ledger?.yearEnd ?? CALENDAR_YEAR, { preset: 'this-year' });
  const range = period.range;
  const pl = useMemo(
    () => (ledger ? profitAndLoss(ledger.lines, ledger.accounts, range) : null),
    [ledger, range],
  );
  if (!ledger || !pl) return <Spinner className="py-24" label="Loading…" />;

  const sections = [
    pl.income,
    pl.costOfSales,
    pl.otherIncome,
    pl.expenses,
    pl.depreciation,
    pl.otherExpenses,
  ];
  const exportCsv = () =>
    downloadCsv(
      `profit-and-loss-${range.from}_${range.to}`,
      ['Section', 'Code', 'Account', 'Amount'],
      [
        ...sections.flatMap((s) =>
          s.rows.map((r) => [s.label, r.account.code, r.account.name, major(r.amount)]),
        ),
        ['Gross profit', '', '', major(pl.grossProfit)],
        ['Net profit', '', '', major(pl.netProfit)],
      ],
    );

  return (
    <Card>
      <Toolbar onExport={exportCsv}>
        <PeriodPicker
          preset={period.preset}
          onPreset={period.setPreset}
          custom={period.custom}
          onCustom={period.setCustom}
        />
      </Toolbar>
      <Problems />
      <ReportTitle
        title="Profit and loss"
        subtitle={`${fmt.date(range.from)} – ${fmt.date(range.to)}`}
      />
      <table className="w-full">
        <tbody>
          <SectionRows section={pl.income} range={range} />
          {pl.costOfSales.rows.length ? (
            <SectionRows section={pl.costOfSales} range={range} />
          ) : null}
          <TotalRow label="Gross profit" amount={pl.grossProfit} strong />
          {pl.otherIncome.rows.length ? (
            <SectionRows section={pl.otherIncome} range={range} />
          ) : null}
          <SectionRows section={pl.expenses} range={range} />
          {pl.depreciation.rows.length ? (
            <SectionRows section={pl.depreciation} range={range} />
          ) : null}
          {pl.otherExpenses.rows.length ? (
            <SectionRows section={pl.otherExpenses} range={range} />
          ) : null}
          <TotalRow
            label={pl.netProfit < 0 ? 'Net loss' : 'Net profit'}
            amount={pl.netProfit}
            strong
            tone="profit"
          />
        </tbody>
      </table>
      <div className="h-4" />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Balance sheet                                                              */
/* -------------------------------------------------------------------------- */

export function BalanceSheetReport() {
  const ledger = useLedger();
  const fmt = useFormat();
  const { major, money } = useMinorMoney();
  const picker = useAsOf(ledger?.yearEnd ?? CALENDAR_YEAR);
  const asOf = picker.asOf;
  const bs = useMemo(
    () => (ledger ? balanceSheet(ledger.lines, ledger.accounts, asOf, ledger.yearEnd) : null),
    [ledger, asOf],
  );
  if (!ledger || !bs) return <Spinner className="py-24" label="Loading…" />;

  const range = { from: '0000-01-01', to: asOf };
  const exportCsv = () =>
    downloadCsv(
      `balance-sheet-${asOf}`,
      ['Section', 'Code', 'Account', 'Amount'],
      [
        ...[...bs.assets, ...bs.liabilities, bs.equity].flatMap((s) =>
          s.rows.map((r) => [s.label, r.account.code, r.account.name, major(r.amount)]),
        ),
        ['Equity', '', 'Current year earnings', major(bs.currentYearEarnings)],
        ['Equity', '', "Previous years' earnings", major(bs.previousYearsEarnings)],
        ['Total assets', '', '', major(bs.totalAssets)],
        ['Total liabilities and equity', '', '', major(bs.totalLiabilities + bs.totalEquity)],
      ],
    );

  return (
    <Card>
      <Toolbar onExport={exportCsv}>
        <AsOfPicker
          preset={picker.preset}
          onPreset={picker.setPreset}
          custom={picker.custom}
          onCustom={picker.setCustom}
        />
        {bs.difference === 0 ? (
          <Badge tone="green">
            <CheckCircle2 className="size-3" /> Balanced
          </Badge>
        ) : (
          <Badge tone="red">Out of balance by {money(bs.difference)}</Badge>
        )}
      </Toolbar>
      <Problems />
      <ReportTitle title="Balance sheet" subtitle={`As of ${fmt.date(asOf)}`} />
      <table className="w-full">
        <tbody>
          <tr>
            <td
              colSpan={2}
              className="px-5 pt-3 text-xs font-semibold tracking-wide text-slate-500 uppercase"
            >
              Assets
            </td>
          </tr>
          {bs.assets
            .filter((s) => s.rows.length > 0 || s.key === 'cash' || s.key === 'receivable')
            .map((s) => (
              <SectionRows key={s.key} section={s} range={range} />
            ))}
          <TotalRow label="Total assets" amount={bs.totalAssets} strong />
          <tr>
            <td
              colSpan={2}
              className="px-5 pt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase"
            >
              Liabilities
            </td>
          </tr>
          {bs.liabilities
            .filter((s) => s.rows.length > 0 || s.key === 'current-liabilities')
            .map((s) => (
              <SectionRows key={s.key} section={s} range={range} />
            ))}
          <TotalRow label="Total liabilities" amount={bs.totalLiabilities} strong />
          <tr>
            <td
              colSpan={2}
              className="px-5 pt-6 text-xs font-semibold tracking-wide text-slate-500 uppercase"
            >
              Equity
            </td>
          </tr>
          <SectionRows
            section={bs.equity}
            range={range}
            hideTitle
            totalLabel="Capital and reserves"
          />
          <tr className="hover:bg-slate-50">
            <td className="py-1.5 ps-8 pe-4 text-sm text-slate-700">Current year earnings</td>
            <td className="tabular px-5 py-1.5 text-end text-sm text-slate-700">
              {money(bs.currentYearEarnings)}
            </td>
          </tr>
          {bs.previousYearsEarnings !== 0 ? (
            <tr className="hover:bg-slate-50">
              <td className="py-1.5 ps-8 pe-4 text-sm text-slate-700">
                Previous years&apos; earnings
              </td>
              <td className="tabular px-5 py-1.5 text-end text-sm text-slate-700">
                {money(bs.previousYearsEarnings)}
              </td>
            </tr>
          ) : null}
          <TotalRow label="Total equity" amount={bs.totalEquity} />
          <TotalRow
            label="Total liabilities and equity"
            amount={bs.totalLiabilities + bs.totalEquity}
            strong
          />
        </tbody>
      </table>
      <div className="h-4" />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Trial balance                                                              */
/* -------------------------------------------------------------------------- */

export function TrialBalanceReport() {
  const ledger = useLedger();
  const fmt = useFormat();
  const { money, major } = useMinorMoney();
  const yearEnd = ledger?.yearEnd ?? CALENDAR_YEAR;
  const picker = useAsOf(yearEnd);
  const asOf = picker.asOf;
  const tb = useMemo(
    () => (ledger ? trialBalance(ledger.lines, ledger.accounts, asOf, ledger.yearEnd) : null),
    [ledger, asOf],
  );
  if (!ledger || !tb) return <Spinner className="py-24" label="Loading…" />;

  const exportCsv = () =>
    downloadCsv(
      `trial-balance-${asOf}`,
      ['Code', 'Account', 'Debit', 'Credit'],
      [
        ...tb.rows.map((r) => [r.account?.code ?? '', r.label, major(r.debit), major(r.credit)]),
        ['', 'Total', major(tb.totalDebit), major(tb.totalCredit)],
      ],
    );
  const range = { from: fiscalYearStart(asOf, yearEnd), to: asOf };

  return (
    <Card>
      <Toolbar onExport={exportCsv}>
        <AsOfPicker
          preset={picker.preset}
          onPreset={picker.setPreset}
          custom={picker.custom}
          onCustom={picker.setCustom}
        />
      </Toolbar>
      <Problems />
      <ReportTitle title="Trial balance" subtitle={`As of ${fmt.date(asOf)}`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-5 py-2.5 text-start font-medium">Account</th>
              <th className="px-5 py-2.5 text-end font-medium">Debit</th>
              <th className="px-5 py-2.5 text-end font-medium">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tb.rows.map((r) => (
              <tr key={r.account?.id ?? r.label} className="hover:bg-slate-50">
                <td className="px-5 py-2">
                  {r.account ? (
                    <Link
                      to={ledgerLink(r.account, range)}
                      className="hover:text-primary-700 text-slate-700"
                    >
                      <span className="tabular me-2 text-slate-400">{r.account.code}</span>
                      {r.account.name}
                    </Link>
                  ) : (
                    <span className="text-slate-700">{r.label}</span>
                  )}
                </td>
                <td className="tabular px-5 py-2 text-end">{r.debit ? money(r.debit) : ''}</td>
                <td className="tabular px-5 py-2 text-end">{r.credit ? money(r.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-y-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
              <td className="px-5 py-2.5">Total</td>
              <td className="tabular px-5 py-2.5 text-end">{money(tb.totalDebit)}</td>
              <td className="tabular px-5 py-2.5 text-end">{money(tb.totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="h-4" />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* General ledger                                                             */
/* -------------------------------------------------------------------------- */

export function GeneralLedgerReport() {
  const ledger = useLedger();
  const fmt = useFormat();
  const { money, major } = useMinorMoney();
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account') ?? '';
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const period = usePeriod(ledger?.yearEnd ?? CALENDAR_YEAR, {
    preset: fromParam && toParam ? 'custom' : 'this-year',
    custom: fromParam && toParam ? { from: fromParam, to: toParam } : undefined,
  });
  const range = period.range;
  const data = useMemo(() => {
    if (!ledger) return null;
    // "From the beginning" links use a placeholder start date.
    const shown =
      range.from === '0000-01-01' ? { ...range, from: firstLineDate(ledger.lines) } : range;
    return {
      shown,
      activity: generalLedger(
        ledger.lines,
        ledger.accounts,
        shown,
        ledger.yearEnd,
        accountId || undefined,
      ),
    };
  }, [ledger, range, accountId]);
  if (!ledger || !data) return <Spinner className="py-24" label="Loading…" />;
  const { shown: shownRange, activity } = data;

  const options = [...ledger.accounts]
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const setAccount = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('account', id);
    else next.delete('account');
    setParams(next, { replace: true });
  };
  const exportCsv = () =>
    downloadCsv(
      `general-ledger-${shownRange.from}_${shownRange.to}`,
      ['Account', 'Date', 'Number', 'Description', 'Debit', 'Credit', 'Balance'],
      activity.flatMap((a) => [
        [
          `${a.account.code} ${a.account.name}`,
          shownRange.from,
          '',
          'Opening balance',
          '',
          '',
          major(a.opening),
        ],
        ...a.lines.map((l) => [
          '',
          l.date,
          l.number,
          l.description,
          l.amount > 0 ? major(l.amount) : '',
          l.amount < 0 ? major(-l.amount) : '',
          major(l.balance),
        ]),
      ]),
    );

  return (
    <Card>
      <Toolbar onExport={exportCsv}>
        <div className="w-64">
          <Combobox
            value={accountId || null}
            onChange={setAccount}
            options={[{ value: '', label: 'All accounts' }, ...options]}
            placeholder="All accounts"
            searchPlaceholder="Search accounts…"
          />
        </div>
        <PeriodPicker
          preset={period.preset}
          onPreset={period.setPreset}
          custom={period.custom}
          onCustom={period.setCustom}
        />
      </Toolbar>
      <Problems />
      <ReportTitle
        title="General ledger"
        subtitle={`${fmt.date(shownRange.from)} – ${fmt.date(shownRange.to)}`}
      />
      {activity.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          No transactions in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-2.5 text-start font-medium">Date</th>
                <th className="px-3 py-2.5 text-start font-medium">Number</th>
                <th className="px-3 py-2.5 text-start font-medium">Description</th>
                <th className="px-3 py-2.5 text-end font-medium">Debit</th>
                <th className="px-3 py-2.5 text-end font-medium">Credit</th>
                <th className="px-5 py-2.5 text-end font-medium">Balance</th>
              </tr>
            </thead>
            {activity.map((a) => (
              <tbody key={a.account.id} className="border-b border-slate-200">
                <tr className="bg-slate-50/40">
                  <td colSpan={5} className="px-5 pt-3 pb-1.5 font-semibold text-slate-900">
                    <span className="tabular me-2 text-slate-400">{a.account.code}</span>
                    {a.account.name}
                  </td>
                  <td className="tabular px-5 pt-3 pb-1.5 text-end text-slate-500">
                    {money(a.opening)}
                  </td>
                </tr>
                {a.lines.map((l, i) => (
                  <tr key={`${l.sourceId}-${i}`} className="hover:bg-slate-50">
                    <td className="px-5 py-1.5 whitespace-nowrap text-slate-600">
                      {fmt.date(l.date)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Link
                        to={sourceLink(l)}
                        className="text-primary-700 font-medium hover:underline"
                      >
                        {l.number}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                    <td className="tabular px-3 py-1.5 text-end">
                      {l.amount > 0 ? money(l.amount) : ''}
                    </td>
                    <td className="tabular px-3 py-1.5 text-end">
                      {l.amount < 0 ? money(-l.amount) : ''}
                    </td>
                    <td className="tabular px-5 py-1.5 text-end text-slate-700">
                      {money(l.balance)}
                    </td>
                  </tr>
                ))}
                <tr className="text-slate-900">
                  <td colSpan={3} className="px-5 py-2 font-medium">
                    Closing balance
                  </td>
                  <td className="tabular px-3 py-2 text-end font-medium">{money(a.debit)}</td>
                  <td className="tabular px-3 py-2 text-end font-medium">{money(a.credit)}</td>
                  <td className="tabular px-5 py-2 text-end font-semibold">{money(a.closing)}</td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
      <div className="h-4" />
    </Card>
  );
}

function firstLineDate(lines: LedgerLine[] | undefined): ISODate {
  if (!lines || lines.length === 0) return today();
  const first = lines[0].date;
  // Start of that month keeps the heading tidy.
  const d = parseISODate(first);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}
