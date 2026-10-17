import type { Account, Company, DepreciationRun, FixedAsset, ID, ISODate } from '@/db/types';
import type { CompanyLedger } from '@/db/accounting';
import { accountingSettings } from '@/db/chart-setup';
import { msg, type Vars } from '@/i18n';
import { addDaysISO } from '@/lib/dates';
import { currencyPrecision, fromMinor } from '@/lib/money';
import {
  changesInEquity,
  comparativeDate,
  equityTotal,
  EQUITY_LABELS,
  financialPosition,
  fiscalYearEnd,
  fiscalYearStart,
  previousYearRange,
  profitOrLoss,
  specialAccounts,
  trialBalance,
  type Caption,
  type ChangesInEquity,
  type DateRange,
  type FinancialPosition,
  type FiscalYearEnd,
  type ProfitOrLoss,
  type SpecialAccounts,
} from '@/lib/accounting/statements';
import { cashFlow, type CashFlow, type CashFlowLine } from '@/lib/accounting/cash-flow';
import { assetSchedule, type AssetScheduleFigures } from '@/lib/accounting/asset-schedule';
import { financialYearLabel } from '@/lib/accounting/year-end';
import type { ReportText } from './report-language';

/**
 * Reports as data: rows of captions, accounts and totals with an amount per
 * column. The same model is shown on screen, printed and exported to CSV or
 * the auditor pack, in English, Arabic or both.
 */

export type RowKind = 'heading' | 'section' | 'caption' | 'detail' | 'subtotal' | 'total' | 'grand';

export interface ReportRecord {
  code?: string;
  name: string;
  nameAr?: string;
}

export interface ReportRow {
  key: string;
  kind: RowKind;
  /** English text, translated when shown; unused when `record` is set. */
  label?: string;
  vars?: Vars;
  record?: ReportRecord;
  /** Account behind the row, for links to the general ledger. */
  accountId?: ID;
  /** Minor units per column; null leaves the cell empty. */
  values: (number | null)[];
}

export type ReportColumn =
  | { kind: 'date'; date: ISODate }
  | { kind: 'period'; range: DateRange; year: boolean }
  | { kind: 'label'; label: string };

export type ReportSubtitle =
  { kind: 'asOf'; date: ISODate } | { kind: 'period'; range: DateRange; year: boolean };

export interface ReportModel {
  /** File name without extension, always English. */
  file: string;
  title: string;
  subtitle: ReportSubtitle;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** `statement`: brackets for negatives and a dash for nothing; `ledger`: blank cells. */
  style: 'statement' | 'ledger';
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Whether a range is exactly one financial year. */
export function isFinancialYear(range: DateRange, yearEnd: FiscalYearEnd): boolean {
  return (
    fiscalYearStart(range.from, yearEnd) === range.from &&
    fiscalYearEnd(range.from, yearEnd) === range.to
  );
}

const nonZero = (values: (number | null)[]) => values.some((v) => v !== null && v !== 0);

const record = (account: Account): ReportRecord => ({
  code: account.code,
  name: account.name,
  nameAr: account.nameAr,
});

/** Caption rows for the current and comparative columns, with accounts under them when `detail`. */
function captionRows(
  current: Caption[],
  previous: Caption[] | null,
  detail: boolean,
  keep: string[] = [],
): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const caption of current) {
    const before = previous?.find((c) => c.key === caption.key);
    const values = previous ? [caption.total, before?.total ?? 0] : [caption.total];
    const accounts = new Map<ID, Account>();
    for (const r of [...caption.rows, ...(before?.rows ?? [])])
      accounts.set(r.account.id, r.account);
    const extras = new Map<string, string>();
    for (const e of [...caption.extras, ...(before?.extras ?? [])]) extras.set(e.key, e.label);
    if (!nonZero(values) && accounts.size === 0 && extras.size === 0 && !keep.includes(caption.key))
      continue;
    rows.push({ key: caption.key, kind: 'caption', label: caption.label, values });
    if (!detail) continue;
    const sorted = [...accounts.values()].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
    for (const account of sorted) {
      const amount = (c: Caption | undefined) =>
        c?.rows.find((r) => r.account.id === account.id)?.amount ?? 0;
      rows.push({
        key: `${caption.key}:${account.id}`,
        kind: 'detail',
        record: record(account),
        accountId: account.id,
        values: previous ? [amount(caption), amount(before)] : [amount(caption)],
      });
    }
    for (const [key, label] of extras) {
      const amount = (c: Caption | undefined) => c?.extras.find((e) => e.key === key)?.amount ?? 0;
      rows.push({
        key: `${caption.key}:${key}`,
        kind: 'detail',
        label,
        values: previous ? [amount(caption), amount(before)] : [amount(caption)],
      });
    }
  }
  return rows;
}

const pair = (current: number, previous: number | null | undefined, compare: boolean) =>
  compare ? [current, previous ?? 0] : [current];

/* -------------------------------------------------------------------------- */
/* Statement of financial position                                            */
/* -------------------------------------------------------------------------- */

export function financialPositionModel(
  current: FinancialPosition,
  previous: FinancialPosition | null,
  detail: boolean,
): ReportModel {
  const compare = previous !== null;
  const v = (pick: (fp: FinancialPosition) => number) =>
    pair(pick(current), previous ? pick(previous) : null, compare);
  const section = (
    key: string,
    label: string,
    captions: (fp: FinancialPosition) => Caption[],
    total: (fp: FinancialPosition) => number,
    totalLabel: string,
    always = false,
  ): ReportRow[] => {
    const body = captionRows(captions(current), previous ? captions(previous) : null, detail);
    if (body.length === 0 && !always) return [];
    return [
      { key, kind: 'section', label, values: [] },
      ...body,
      { key: `${key}-total`, kind: 'subtotal', label: totalLabel, values: v(total) },
    ];
  };
  return {
    file: 'statement-of-financial-position',
    title: msg('Statement of financial position'),
    subtitle: { kind: 'asOf', date: current.asOf },
    columns: [
      { kind: 'date', date: current.asOf },
      ...(previous ? [{ kind: 'date' as const, date: previous.asOf }] : []),
    ],
    style: 'statement',
    rows: [
      { key: 'assets', kind: 'heading', label: msg('Assets'), values: [] },
      ...section(
        'non-current-assets',
        msg('Non-current assets'),
        (fp) => fp.nonCurrentAssets,
        (fp) => fp.totalNonCurrentAssets,
        msg('Total non-current assets'),
      ),
      ...section(
        'current-assets',
        msg('Current assets'),
        (fp) => fp.currentAssets,
        (fp) => fp.totalCurrentAssets,
        msg('Total current assets'),
        true,
      ),
      {
        key: 'total-assets',
        kind: 'grand',
        label: msg('Total assets'),
        values: v((fp) => fp.totalAssets),
      },
      {
        key: 'equity-and-liabilities',
        kind: 'heading',
        label: msg('Equity and liabilities'),
        values: [],
      },
      ...section(
        'equity',
        msg('Equity'),
        (fp) => fp.equity,
        (fp) => fp.totalEquity,
        msg('Total equity'),
        true,
      ),
      ...section(
        'non-current-liabilities',
        msg('Non-current liabilities'),
        (fp) => fp.nonCurrentLiabilities,
        (fp) => fp.totalNonCurrentLiabilities,
        msg('Total non-current liabilities'),
      ),
      ...section(
        'current-liabilities',
        msg('Current liabilities'),
        (fp) => fp.currentLiabilities,
        (fp) => fp.totalCurrentLiabilities,
        msg('Total current liabilities'),
        true,
      ),
      {
        key: 'total-liabilities',
        kind: 'total',
        label: msg('Total liabilities'),
        values: v((fp) => fp.totalLiabilities),
      },
      {
        key: 'total-equity-and-liabilities',
        kind: 'grand',
        label: msg('Total equity and liabilities'),
        values: v((fp) => fp.totalEquity + fp.totalLiabilities),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Statement of profit or loss                                                */
/* -------------------------------------------------------------------------- */

export function profitOrLossModel(
  current: ProfitOrLoss,
  previous: ProfitOrLoss | null,
  detail: boolean,
  yearEnd: FiscalYearEnd,
): ReportModel {
  const compare = previous !== null;
  const year = isFinancialYear(current.range, yearEnd);
  const v = (pick: (pl: ProfitOrLoss) => number) =>
    pair(pick(current), previous ? pick(previous) : null, compare);
  const captions = (keys: (keyof ProfitOrLoss)[], always: string[] = []) =>
    captionRows(
      keys.map((k) => current[k] as Caption),
      previous ? keys.map((k) => previous[k] as Caption) : null,
      detail,
      always,
    );
  // Each levy has its own line, as in Kuwaiti financial statements.
  const levyAccounts = new Map<ID, Account>();
  for (const r of [...current.levies.rows, ...(previous?.levies.rows ?? [])])
    levyAccounts.set(r.account.id, r.account);
  const levyRows: ReportRow[] = [...levyAccounts.values()]
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((account) => {
      const amount = (pl: ProfitOrLoss | null) =>
        pl?.levies.rows.find((r) => r.account.id === account.id)?.amount ?? 0;
      return {
        key: `levy:${account.id}`,
        kind: 'caption',
        record: { name: account.name, nameAr: account.nameAr },
        accountId: account.id,
        values: pair(amount(current), amount(previous), compare),
      };
    });
  const loss = current.profit < 0;
  return {
    file: 'statement-of-profit-or-loss',
    title: msg('Statement of profit or loss'),
    subtitle: { kind: 'period', range: current.range, year },
    columns: [
      { kind: 'period', range: current.range, year },
      ...(previous ? [{ kind: 'period' as const, range: previous.range, year }] : []),
    ],
    style: 'statement',
    rows: [
      ...captions(['revenue', 'costOfSales'], ['revenue']),
      {
        key: 'gross-profit',
        kind: 'subtotal',
        label: msg('Gross profit'),
        values: v((pl) => pl.grossProfit),
      },
      ...captions(
        ['otherIncome', 'administrative', 'depreciation', 'otherExpenses', 'financeCosts'],
        ['administrative'],
      ),
      {
        key: 'profit-before-levies',
        kind: 'subtotal',
        label: msg('Profit before KFAS, Zakat, NLST and income tax'),
        values: v((pl) => pl.profitBeforeLevies),
      },
      ...levyRows,
      {
        key: 'profit',
        kind: 'grand',
        label: year
          ? loss
            ? msg('Loss for the year')
            : msg('Profit for the year')
          : loss
            ? msg('Loss for the period')
            : msg('Profit for the period'),
        values: v((pl) => pl.profit),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Statement of changes in equity                                             */
/* -------------------------------------------------------------------------- */

export function changesInEquityModel(
  current: ChangesInEquity,
  previous: ChangesInEquity | null,
  yearEnd: FiscalYearEnd,
): ReportModel {
  const components = [...new Set([...(previous?.components ?? []), ...current.components])].sort(
    (a, b) => Object.keys(EQUITY_LABELS).indexOf(a) - Object.keys(EQUITY_LABELS).indexOf(b),
  );
  const values = (vals: ChangesInEquity['opening']) => [
    ...components.map((c) => vals[c]),
    equityTotal(vals),
  ];
  // The comparative year ends where the current one starts, so that balance is shown once.
  const block = (soce: ChangesInEquity, prefix: string, opening: boolean): ReportRow[] => [
    ...(opening
      ? [
          {
            key: `${prefix}-opening`,
            kind: 'subtotal' as const,
            label: msg('Balance at {date}'),
            vars: { date: addDaysISO(soce.range.from, -1) },
            values: values(soce.opening),
          },
        ]
      : []),
    ...soce.movements.map((m): ReportRow => ({
      key: `${prefix}-${m.key}`,
      kind: 'caption',
      label: m.label,
      values: values(m.values),
    })),
    {
      key: `${prefix}-closing`,
      kind: 'total',
      label: msg('Balance at {date}'),
      vars: { date: soce.range.to },
      values: values(soce.closing),
    },
  ];
  return {
    file: 'statement-of-changes-in-equity',
    title: msg('Statement of changes in equity'),
    subtitle: {
      kind: 'period',
      range: current.range,
      year: isFinancialYear(current.range, yearEnd),
    },
    columns: [
      ...components.map((c) => ({ kind: 'label' as const, label: EQUITY_LABELS[c] })),
      { kind: 'label', label: msg('Total') },
    ],
    style: 'statement',
    rows: [
      ...(previous ? block(previous, 'previous', true) : []),
      ...block(current, 'current', !previous),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Statement of cash flows                                                    */
/* -------------------------------------------------------------------------- */

export function cashFlowModel(
  current: CashFlow,
  previous: CashFlow | null,
  yearEnd: FiscalYearEnd,
): ReportModel {
  const compare = previous !== null;
  const year = isFinancialYear(current.range, yearEnd);
  const v = (pick: (cf: CashFlow) => number) =>
    pair(pick(current), previous ? pick(previous) : null, compare);
  const lines = (pick: (cf: CashFlow) => CashFlowLine[], kind: RowKind = 'caption') =>
    pick(current)
      .map((line): ReportRow => ({
        key: line.key,
        kind,
        label: line.label,
        values: pair(
          line.amount,
          previous ? pick(previous).find((l) => l.key === line.key)?.amount : null,
          compare,
        ),
      }))
      .filter((r) => nonZero(r.values));
  const adjustments = lines((cf) => cf.adjustments, 'detail');
  const working = lines((cf) => cf.workingCapital, 'detail');
  return {
    file: 'statement-of-cash-flows',
    title: msg('Statement of cash flows'),
    subtitle: { kind: 'period', range: current.range, year },
    columns: [
      { kind: 'period', range: current.range, year },
      ...(previous ? [{ kind: 'period' as const, range: previous.range, year }] : []),
    ],
    style: 'statement',
    rows: [
      { key: 'operating', kind: 'section', label: msg('Operating activities'), values: [] },
      {
        key: 'profit',
        kind: 'caption',
        label: year ? msg('Profit for the year') : msg('Profit for the period'),
        values: v((cf) => cf.profit),
      },
      ...(adjustments.length
        ? [
            {
              key: 'adjustments',
              kind: 'caption' as const,
              label: msg('Adjustments for:'),
              values: [],
            },
            ...adjustments,
          ]
        : []),
      ...(working.length
        ? [
            {
              key: 'working-capital',
              kind: 'caption' as const,
              label: msg('Changes in working capital:'),
              values: [],
            },
            ...working,
          ]
        : []),
      {
        key: 'operating-total',
        kind: 'subtotal',
        label: msg('Net cash from operating activities'),
        values: v((cf) => cf.operating),
      },
      { key: 'investing', kind: 'section', label: msg('Investing activities'), values: [] },
      ...lines((cf) => cf.investing),
      {
        key: 'investing-total',
        kind: 'subtotal',
        label: msg('Net cash from investing activities'),
        values: v((cf) => cf.investingTotal),
      },
      { key: 'financing', kind: 'section', label: msg('Financing activities'), values: [] },
      ...lines((cf) => cf.financing),
      {
        key: 'financing-total',
        kind: 'subtotal',
        label: msg('Net cash from financing activities'),
        values: v((cf) => cf.financingTotal),
      },
      {
        key: 'net-change',
        kind: 'total',
        label: msg('Net increase (decrease) in cash and bank balances'),
        values: v((cf) => cf.netChange),
      },
      {
        key: 'opening-cash',
        kind: 'caption',
        label: msg('Cash and bank balances at the start of the period'),
        values: v((cf) => cf.opening),
      },
      {
        key: 'closing-cash',
        kind: 'grand',
        label: msg('Cash and bank balances at the end of the period'),
        values: v((cf) => cf.closing),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Trial balance                                                              */
/* -------------------------------------------------------------------------- */

export function trialBalanceModel(
  ledger: Pick<CompanyLedger, 'lines' | 'accounts'>,
  asOf: ISODate,
  yearEnd: FiscalYearEnd,
): ReportModel {
  const tb = trialBalance(ledger.lines, ledger.accounts, asOf, yearEnd);
  return {
    file: 'trial-balance',
    title: msg('Trial balance'),
    subtitle: { kind: 'asOf', date: asOf },
    columns: [
      { kind: 'label', label: msg('Debit') },
      { kind: 'label', label: msg('Credit') },
    ],
    style: 'ledger',
    rows: [
      ...tb.rows.map((r): ReportRow =>
        r.account
          ? {
              key: r.account.id,
              kind: 'caption',
              record: record(r.account),
              accountId: r.account.id,
              values: [r.debit || null, r.credit || null],
            }
          : {
              key: 'earlier',
              kind: 'caption',
              label: msg('Profit of earlier years'),
              values: [r.debit || null, r.credit || null],
            },
      ),
      { key: 'total', kind: 'grand', label: msg('Total'), values: [tb.totalDebit, tb.totalCredit] },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Fixed asset schedule                                                       */
/* -------------------------------------------------------------------------- */

const SCHEDULE_COLUMNS: { key: keyof AssetScheduleFigures; label: string }[] = [
  { key: 'costOpening', label: msg('Cost at start') },
  { key: 'additions', label: msg('Additions') },
  { key: 'disposals', label: msg('Disposals') },
  { key: 'costClosing', label: msg('Cost at end') },
  { key: 'depreciationOpening', label: msg('Depreciation at start') },
  { key: 'charge', label: msg('Charge for the period') },
  { key: 'depreciationOnDisposals', label: msg('On disposals') },
  { key: 'depreciationClosing', label: msg('Depreciation at end') },
  { key: 'bookValueClosing', label: msg('Book value at end') },
];

export function assetScheduleModel(
  assets: FixedAsset[],
  runs: DepreciationRun[],
  accounts: Account[],
  range: DateRange,
  precision: number,
  yearEnd: FiscalYearEnd,
): ReportModel {
  const schedule = assetSchedule(assets, runs, accounts, range, precision);
  // Disposals reduce cost and depreciation, so they show as negative figures.
  const figures = (f: AssetScheduleFigures) =>
    SCHEDULE_COLUMNS.map(({ key }) =>
      key === 'disposals' || key === 'depreciationOnDisposals' ? -f[key] : f[key],
    );
  const rows: ReportRow[] = [];
  for (const group of schedule.groups) {
    rows.push({
      key: group.accountId,
      kind: 'section',
      record: group.account ? record(group.account) : { name: '—' },
      values: [],
    });
    for (const row of group.rows) {
      rows.push({
        key: row.asset.id,
        kind: 'detail',
        record: { code: row.asset.number, name: row.asset.name, nameAr: row.asset.nameAr },
        values: figures(row),
      });
    }
    rows.push({
      key: `${group.accountId}-total`,
      kind: 'subtotal',
      label: msg('Total {name}'),
      vars: { name: group.account?.name ?? '' },
      record: group.account
        ? { name: group.account.name, nameAr: group.account.nameAr }
        : undefined,
      values: figures(group.totals),
    });
  }
  rows.push({ key: 'total', kind: 'grand', label: msg('Total'), values: figures(schedule.totals) });
  return {
    file: 'fixed-asset-schedule',
    title: msg('Fixed asset schedule'),
    subtitle: { kind: 'period', range, year: isFinancialYear(range, yearEnd) },
    columns: SCHEDULE_COLUMNS.map((c) => ({ kind: 'label', label: c.label })),
    style: 'statement',
    rows,
  };
}

/* -------------------------------------------------------------------------- */
/* Building reports from the books                                            */
/* -------------------------------------------------------------------------- */

export type StatementId =
  | 'balance-sheet'
  | 'profit-and-loss'
  | 'changes-in-equity'
  | 'cash-flow'
  | 'trial-balance'
  | 'asset-schedule';

export interface StatementParams {
  /** Period reports. */
  range: DateRange;
  /** Statement of financial position and trial balance. */
  asOf: ISODate;
  compare: boolean;
  detail: boolean;
}

export interface StatementData {
  company: Company;
  ledger: CompanyLedger;
  assets: FixedAsset[];
  runs: DepreciationRun[];
}

export function statementContext(data: StatementData): {
  special: SpecialAccounts;
  yearEnd: FiscalYearEnd;
  kinds: Map<ID, ReturnType<typeof kindOf>>;
  yearEndJournals: Set<ID>;
} {
  const settings = accountingSettings(data.company);
  const kinds = new Map(data.ledger.journals.map((j) => [j.id, kindOf(j)]));
  return {
    special: specialAccounts(data.ledger.accounts, settings.template),
    yearEnd: settings.fiscalYearEnd,
    kinds,
    yearEndJournals: new Set(
      data.ledger.journals.filter((j) => j.kind === 'year_end').map((j) => j.id),
    ),
  };
}

const kindOf = (j: CompanyLedger['journals'][number]) => j.kind;

/** Builds a report from the books. */
export function buildStatement(
  id: StatementId,
  data: StatementData,
  params: StatementParams,
): ReportModel {
  const { ledger } = data;
  const { special, yearEnd, kinds, yearEndJournals } = statementContext(data);
  const previousRange = previousYearRange(params.range);
  switch (id) {
    case 'balance-sheet': {
      const fp = (date: ISODate) =>
        financialPosition(ledger.lines, ledger.accounts, date, yearEnd, special);
      return financialPositionModel(
        fp(params.asOf),
        params.compare ? fp(comparativeDate(params.asOf, yearEnd)) : null,
        params.detail,
      );
    }
    case 'profit-and-loss': {
      const pl = (range: DateRange) => profitOrLoss(ledger.lines, ledger.accounts, range, special);
      return profitOrLossModel(
        pl(params.range),
        params.compare ? pl(previousRange) : null,
        params.detail,
        yearEnd,
      );
    }
    case 'changes-in-equity': {
      const soce = (range: DateRange) =>
        changesInEquity(ledger.lines, ledger.accounts, range, special, yearEndJournals);
      return changesInEquityModel(
        soce(params.range),
        params.compare ? soce(previousRange) : null,
        yearEnd,
      );
    }
    case 'cash-flow': {
      const cf = (range: DateRange) =>
        cashFlow(ledger.lines, ledger.accounts, range, special, kinds);
      return cashFlowModel(cf(params.range), params.compare ? cf(previousRange) : null, yearEnd);
    }
    case 'trial-balance':
      return trialBalanceModel(ledger, params.asOf, yearEnd);
    case 'asset-schedule':
      return assetScheduleModel(
        data.assets,
        data.runs,
        ledger.accounts,
        params.range,
        currencyPrecision(data.company.currency),
        yearEnd,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Words and CSV                                                              */
/* -------------------------------------------------------------------------- */

/** A column heading in a report language. */
export function columnHeading(column: ReportColumn, text: ReportText): string {
  switch (column.kind) {
    case 'date':
      return text.date(column.date);
    case 'period':
      return column.year
        ? financialYearLabel(column.range.from, column.range.to)
        : `${text.date(column.range.from)} – ${text.date(column.range.to)}`;
    case 'label':
      return text.t(column.label);
  }
}

/** The line under a report's title, e.g. "For the year ended 31/12/2026". */
export function subtitleText(subtitle: ReportSubtitle, text: ReportText): string {
  if (subtitle.kind === 'asOf')
    return text.t(msg('As at {date}'), { date: text.date(subtitle.date) });
  return subtitle.year
    ? text.t(msg('For the year ended {date}'), { date: text.date(subtitle.range.to) })
    : text.t(msg('For the period from {from} to {to}'), {
        from: text.date(subtitle.range.from),
        to: text.date(subtitle.range.to),
      });
}

/** A row's words in a report language (code shown separately). */
export function rowLabel(row: ReportRow, text: ReportText): string {
  if (row.record && !row.label) return text.name(row.record);
  if (!row.label) return '';
  const vars: Vars = { ...row.vars };
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
      vars[key] = text.date(value);
  }
  if (row.record && 'name' in vars) vars.name = text.name(row.record);
  return text.t(row.label, vars);
}

/** The report as CSV headers and rows; amounts as plain numbers in major units. */
export function modelToCsv(
  model: ReportModel,
  precision: number,
  primary: ReportText,
  secondary: ReportText | null,
): { headers: string[]; rows: (string | number)[][] } {
  const hasCode = model.rows.some((r) => r.record?.code);
  const headers = [
    ...(hasCode ? [primary.t(msg('Code'))] : []),
    primary.t(msg('Description')),
    ...(secondary ? [secondary.t(msg('Description'))] : []),
    ...model.columns.map((c) => columnHeading(c, primary)),
  ];
  const rows = model.rows.map((row) => [
    ...(hasCode ? [row.record?.code ?? ''] : []),
    rowLabel(row, primary),
    ...(secondary ? [rowLabel(row, secondary)] : []),
    ...model.columns.map((_, i) => {
      const value = row.values[i];
      return value === null || value === undefined ? '' : fromMinor(value, precision);
    }),
  ]);
  return { headers, rows };
}
