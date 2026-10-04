import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { db } from '@/db/db';
import type { Account, ISODate } from '@/db/types';
import { accountingSettings } from '@/db/chart-setup';
import { useCompany } from '@/app/company';
import { useLedger } from '@/features/accounting/use-ledger';
import { sourceLink } from '@/features/accounting/source-link';
import {
  buildStatement,
  modelToCsv,
  type ReportModel,
  type StatementData,
  type StatementId,
} from '@/features/reports/model';
import { ReportDocument, statementFigure } from '@/features/reports/report-document';
import { useReportText } from '@/features/reports/report-language';
import {
  ExportButton,
  PrintButton,
  ReportLanguageToggle,
  usePrint,
} from '@/features/reports/report-toolbar';
import { addDaysISO, parseISODate, toISODate, today } from '@/lib/dates';
import { currencyPrecision, fromMinor } from '@/lib/money';
import { downloadCsv } from '@/lib/csv';
import { presetRange } from '@/lib/reports';
import { lineDescription, problemText, type LedgerLine } from '@/lib/accounting/ledger';
import {
  fiscalYearEnd,
  fiscalYearStart,
  generalLedger,
  type DateRange,
  type FiscalYearEnd,
} from '@/lib/accounting/statements';
import { msg, t } from '@/i18n';
import { Badge, Card, Spinner } from '@/components/ui/misc';
import { Checkbox, Select } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { DateField } from '@/components/ui/date-field';

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
  { value: 'this-year', label: msg('This financial year') },
  { value: 'last-year', label: msg('Last financial year') },
  { value: 'this-quarter', label: msg('This quarter') },
  { value: 'last-quarter', label: msg('Last quarter') },
  { value: 'this-month', label: msg('This month') },
  { value: 'last-month', label: msg('Last month') },
  { value: 'custom', label: msg('Custom dates') },
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

type AsOfPreset = 'today' | 'last-month' | 'last-quarter' | 'last-year' | 'year-end' | 'custom';

const AS_OF: { value: AsOfPreset; label: string }[] = [
  { value: 'today', label: msg('Today') },
  { value: 'last-month', label: msg('End of last month') },
  { value: 'last-quarter', label: msg('End of last quarter') },
  { value: 'year-end', label: msg('End of this financial year') },
  { value: 'last-year', label: msg('End of last financial year') },
  { value: 'custom', label: msg('Custom date') },
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
    case 'year-end':
      return fiscalYearEnd(now, yearEnd);
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
  return { preset, setPreset, custom, setCustom, asOf: asOfDate(preset, yearEnd, custom) };
}

function PeriodPicker({ period }: { period: ReturnType<typeof usePeriod> }) {
  const { preset, setPreset, custom, setCustom } = period;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t('Period')}
        value={preset}
        onChange={(e) => setPreset(e.target.value as PeriodPreset)}
        className="w-auto"
      >
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.label)}
          </option>
        ))}
      </Select>
      {preset === 'custom' ? (
        <>
          <DateField
            aria-label={t('From')}
            value={custom.from}
            onChange={(iso) => setCustom({ ...custom, from: iso || custom.from })}
            className="w-auto"
          />
          <span className="text-slate-500">–</span>
          <DateField
            aria-label={t('To')}
            value={custom.to}
            onChange={(iso) => setCustom({ ...custom, to: iso || custom.to })}
            className="w-auto"
          />
        </>
      ) : null}
    </div>
  );
}

function AsOfPicker({ picker }: { picker: ReturnType<typeof useAsOf> }) {
  const { preset, setPreset, custom, setCustom } = picker;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label={t('As at')}
        value={preset}
        onChange={(e) => setPreset(e.target.value as AsOfPreset)}
        className="w-auto"
      >
        {AS_OF.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.label)}
          </option>
        ))}
      </Select>
      {preset === 'custom' ? (
        <DateField
          aria-label={t('Date')}
          value={custom}
          onChange={(iso) => setCustom(iso || custom)}
          className="w-auto"
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/** The books, the fixed asset register and depreciation runs, kept up to date. */
export function useStatementData(): StatementData | undefined {
  const company = useCompany();
  const ledger = useLedger();
  const assets = useLiveQuery(
    () => db.assets.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const runs = useLiveQuery(
    () => db.depreciationRuns.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const lines = ledger?.lines;
  const accounts = ledger?.accounts;
  const journals = ledger?.journals;
  const problems = ledger?.problems;
  return useMemo(
    () =>
      lines && accounts && journals && problems && assets && runs
        ? { company, ledger: { lines, accounts, journals, problems }, assets, runs }
        : undefined,
    [company, lines, accounts, journals, problems, assets, runs],
  );
}

export function ledgerLink(accountId: string, range?: DateRange) {
  const params = new URLSearchParams({ account: accountId });
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  return `/reports/general-ledger?${params.toString()}`;
}

function Toolbar({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

function Problems() {
  const ledger = useLedger();
  if (!ledger || ledger.problems.length === 0) return null;
  return (
    <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" /> {t('Some transactions need attention')}
      </p>
      <ul className="mt-1 space-y-0.5">
        {ledger.problems.slice(0, 8).map((p) => (
          <li key={`${p.sourceId}-${p.message}`}>
            <Link to={sourceLink(p)} className="font-medium underline">
              {p.number}
            </Link>
            : {problemText(p)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Figure of the row with `key` in the first column. */
const valueOf = (model: ReportModel, key: string) =>
  model.rows.find((r) => r.key === key)?.values[0] ?? 0;

/* -------------------------------------------------------------------------- */
/* Statements                                                                 */
/* -------------------------------------------------------------------------- */

const AS_OF_REPORTS: StatementId[] = ['balance-sheet', 'trial-balance'];
const COMPARABLE: StatementId[] = [
  'balance-sheet',
  'profit-and-loss',
  'changes-in-equity',
  'cash-flow',
];
const DETAILED: StatementId[] = ['balance-sheet', 'profit-and-loss'];

/**
 * The IFRS statements, the trial balance and the fixed asset schedule: with
 * the comparative period, accounts under each caption, and the report in
 * English, Arabic or both, on screen, printed or exported.
 */
export function StatementReport({ id }: { id: StatementId }) {
  const company = useCompany();
  const data = useStatementData();
  const yearEnd = accountingSettings(company).fiscalYearEnd;
  const period = usePeriod(yearEnd, { preset: 'this-year' });
  const asOf = useAsOf(yearEnd);
  const [compare, setCompare] = useState(true);
  const [detail, setDetail] = useState(false);
  const { primary, secondary, ready } = useReportText();
  const { print, portal } = usePrint();
  const range = period.range;
  const date = asOf.asOf;
  const model = useMemo(
    () =>
      data
        ? buildStatement(id, data, {
            range,
            asOf: date,
            compare: compare && COMPARABLE.includes(id),
            detail: detail || !DETAILED.includes(id),
          })
        : null,
    [data, id, range, date, compare, detail],
  );
  if (!model || !ready) return <Spinner className="py-24" label={t('Loading…')} />;

  const p = currencyPrecision(company.currency);
  const exportCsv = () => {
    const { headers, rows } = modelToCsv(model, p, primary, secondary);
    const stamp = AS_OF_REPORTS.includes(id) ? date : `${range.from}_${range.to}`;
    downloadCsv(`${model.file}-${stamp}`, headers, rows);
  };
  const linkRange = AS_OF_REPORTS.includes(id)
    ? { from: id === 'trial-balance' ? fiscalYearStart(date, yearEnd) : '0000-01-01', to: date }
    : range;

  let status: ReactNode = null;
  if (id === 'balance-sheet') {
    const difference =
      valueOf(model, 'total-assets') - valueOf(model, 'total-equity-and-liabilities');
    status =
      difference === 0 ? (
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> {t('Balanced')}
        </Badge>
      ) : (
        <Badge tone="red">
          {t('Out of balance by {amount}', {
            amount: statementFigure(difference, 'ledger', primary),
          })}
        </Badge>
      );
  } else if (id === 'cash-flow') {
    const difference =
      valueOf(model, 'operating-total') +
      valueOf(model, 'investing-total') +
      valueOf(model, 'financing-total') -
      valueOf(model, 'net-change');
    status =
      difference === 0 ? (
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> {t('Agrees with cash and bank')}
        </Badge>
      ) : (
        <Badge tone="red">{t('Does not agree with cash and bank')}</Badge>
      );
  } else if (id === 'trial-balance') {
    const totals = model.rows.at(-1)?.values ?? [];
    status =
      totals[0] === totals[1] ? (
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> {t('Balanced')}
        </Badge>
      ) : null;
  }

  return (
    <Card>
      <Toolbar
        actions={
          <>
            <ReportLanguageToggle />
            <PrintButton onClick={() => print(<ReportDocument model={model} mode="print" />)} />
            <ExportButton onClick={exportCsv} />
          </>
        }
      >
        {AS_OF_REPORTS.includes(id) ? (
          <AsOfPicker picker={asOf} />
        ) : (
          <PeriodPicker period={period} />
        )}
        {COMPARABLE.includes(id) ? (
          <Checkbox
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            label={t('Compare with last year')}
          />
        ) : null}
        {DETAILED.includes(id) ? (
          <Checkbox
            checked={detail}
            onChange={(e) => setDetail(e.target.checked)}
            label={t('Show accounts')}
          />
        ) : null}
        {status}
      </Toolbar>
      <Problems />
      <ReportDocument model={model} accountLink={(accountId) => ledgerLink(accountId, linkRange)} />
      {id === 'asset-schedule' && model.rows.length <= 1 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">
          {t('No fixed assets in this period.')}{' '}
          <Link to="/assets" className="text-primary-700 font-medium hover:underline">
            {t('Open the fixed asset register')}
          </Link>
        </p>
      ) : null}
      <div className="h-4" />
      {portal}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* General ledger                                                             */
/* -------------------------------------------------------------------------- */

export function GeneralLedgerReport() {
  const ledger = useLedger();
  const company = useCompany();
  const { primary, secondary, ready } = useReportText();
  const [params, setParams] = useSearchParams();
  const accountId = params.get('account') ?? '';
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const period = usePeriod(accountingSettings(company).fiscalYearEnd, {
    preset: fromParam && toParam ? 'custom' : 'this-year',
    custom: fromParam && toParam ? { from: fromParam, to: toParam } : undefined,
  });
  const range = period.range;
  const lines = ledger?.lines;
  const accounts = ledger?.accounts;
  const yearEnd = ledger?.yearEnd;
  const data = useMemo(() => {
    if (!lines || !accounts || !yearEnd) return null;
    // "From the beginning" links use a placeholder start date.
    const shown = range.from === '0000-01-01' ? { ...range, from: firstLineDate(lines) } : range;
    return {
      shown,
      activity: generalLedger(lines, accounts, shown, yearEnd, accountId || undefined),
    };
  }, [lines, accounts, yearEnd, range, accountId]);
  if (!ledger || !data || !ready) return <Spinner className="py-24" label={t('Loading…')} />;
  const { shown: shownRange, activity } = data;
  const p = currencyPrecision(company.currency);
  const major = (minor: number) => fromMinor(minor, p);
  const money = (minor: number) => primary.amount(minor);
  const accountName = (a: Account) =>
    secondary ? `${primary.name(a)} · ${secondary.name(a)}` : primary.name(a);

  const options = [...ledger.accounts]
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({
      value: a.id,
      label: `${a.code} ${primary.name(a)}`,
      keywords: `${a.name} ${a.nameAr ?? ''}`,
    }));
  const setAccount = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('account', id);
    else next.delete('account');
    setParams(next, { replace: true });
  };
  const exportCsv = () =>
    downloadCsv(
      `general-ledger-${shownRange.from}_${shownRange.to}`,
      [
        primary.t(msg('Account')),
        primary.t(msg('Date')),
        primary.t(msg('Number')),
        primary.t(msg('Description')),
        primary.t(msg('Debit')),
        primary.t(msg('Credit')),
        primary.t(msg('Balance')),
      ],
      activity.flatMap((a) => [
        [
          `${a.account.code} ${accountName(a.account)}`,
          shownRange.from,
          '',
          primary.t(msg('Opening balance')),
          '',
          '',
          major(a.opening),
        ],
        ...a.lines.map((l) => [
          '',
          l.date,
          l.number,
          lineDescription(l, primary.t),
          l.amount > 0 ? major(l.amount) : '',
          l.amount < 0 ? major(-l.amount) : '',
          major(l.balance),
        ]),
      ]),
    );

  return (
    <Card>
      <Toolbar
        actions={
          <>
            <ReportLanguageToggle />
            <ExportButton onClick={exportCsv} />
          </>
        }
      >
        <div className="w-full sm:w-64">
          <Combobox
            value={accountId || null}
            onChange={setAccount}
            options={[{ value: '', label: t('All accounts') }, ...options]}
            placeholder={t('All accounts')}
            searchPlaceholder={t('Search accounts…')}
            ariaLabel={t('Account')}
          />
        </div>
        <PeriodPicker period={period} />
      </Toolbar>
      <Problems />
      <div className="px-5 pt-6 pb-2 text-center" dir={primary.dir} lang={primary.language}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          {primary.t(msg('General ledger'))}
        </h2>
        <p className="text-sm text-slate-500">
          {primary.t(msg('For the period from {from} to {to}'), {
            from: primary.date(shownRange.from),
            to: primary.date(shownRange.to),
          })}
        </p>
      </div>
      {activity.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          {t('No transactions in this period.')}
        </p>
      ) : (
        <div className="overflow-x-auto" dir={primary.dir} lang={primary.language}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-y border-slate-100 bg-slate-50/60 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2.5 text-start font-medium">{primary.t(msg('Date'))}</th>
                <th className="px-3 py-2.5 text-start font-medium">{primary.t(msg('Number'))}</th>
                <th className="px-3 py-2.5 text-start font-medium">
                  {primary.t(msg('Description'))}
                </th>
                <th className="px-3 py-2.5 text-end font-medium">{primary.t(msg('Debit'))}</th>
                <th className="px-3 py-2.5 text-end font-medium">{primary.t(msg('Credit'))}</th>
                <th className="px-5 py-2.5 text-end font-medium">{primary.t(msg('Balance'))}</th>
              </tr>
            </thead>
            {activity.map((a) => (
              <tbody key={a.account.id} className="border-b border-slate-200">
                <tr className="bg-slate-50/40">
                  <td colSpan={5} className="px-5 pt-3 pb-1.5 font-semibold text-slate-900">
                    <span className="tabular me-2 text-slate-500">{a.account.code}</span>
                    <bdi>{accountName(a.account)}</bdi>
                  </td>
                  <td className="tabular px-5 pt-3 pb-1.5 text-end text-slate-500">
                    {money(a.opening)}
                  </td>
                </tr>
                {a.lines.map((l, i) => (
                  <tr key={`${l.sourceId}-${i}`} className="hover:bg-slate-50">
                    <td className="px-5 py-1.5 whitespace-nowrap text-slate-600">
                      {primary.date(l.date)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Link
                        to={sourceLink(l)}
                        className="text-primary-700 font-medium hover:underline"
                      >
                        {l.number}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{lineDescription(l, primary.t)}</td>
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
                    {primary.t(msg('Closing balance'))}
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
  // Start of that month keeps the heading tidy.
  const d = parseISODate(lines[0].date);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}
