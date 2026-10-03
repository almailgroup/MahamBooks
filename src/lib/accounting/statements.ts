import type { Account, AccountType, ChartTemplateId, ID, ISODate } from '@/db/types';
import { addDaysISO, parseISODate, toISODate } from '@/lib/dates';
import { msg } from '@/i18n';
import { isProfitAndLoss } from './account-types';
import { ACCOUNT_SPECS, findSpecAccount, type AccountSpecKey } from './charts';
import type { LedgerLine } from './ledger';

export interface FiscalYearEnd {
  month: number;
  day: number;
}

/** Last day of the financial year that ends in `year` (Feb 29 clamps to Feb 28). */
function yearEndIn(year: number, end: FiscalYearEnd): ISODate {
  const lastDay = new Date(year, end.month, 0).getDate();
  return toISODate(new Date(year, end.month - 1, Math.min(end.day, lastDay)));
}

/** First day of the financial year containing `date`. */
export function fiscalYearStart(date: ISODate, end: FiscalYearEnd): ISODate {
  const year = parseISODate(date).getFullYear();
  const endThisYear = yearEndIn(year, end);
  return date <= endThisYear ? addDaysISO(yearEndIn(year - 1, end), 1) : addDaysISO(endThisYear, 1);
}

/** Last day of the financial year containing `date`. */
export function fiscalYearEnd(date: ISODate, end: FiscalYearEnd): ISODate {
  const year = parseISODate(date).getFullYear();
  const endThisYear = yearEndIn(year, end);
  return date <= endThisYear ? endThisYear : yearEndIn(year + 1, end);
}

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

/** Sum of line amounts per account, for lines matching `include`. */
function balances(lines: LedgerLine[], include: (l: LedgerLine) => boolean): Map<ID, number> {
  const out = new Map<ID, number>();
  for (const l of lines) {
    if (!include(l)) continue;
    out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.amount);
  }
  return out;
}

export interface AccountAmount {
  account: Account;
  /** Minor units, signed so the section's normal side is positive. */
  amount: number;
}

export interface StatementSection {
  key: string;
  label: string;
  rows: AccountAmount[];
  total: number;
}

function section(
  key: string,
  label: string,
  accounts: Account[],
  types: AccountType[],
  amounts: Map<ID, number>,
  sign: 1 | -1,
): StatementSection {
  const rows = accounts
    .filter((a) => types.includes(a.type))
    .map((account) => ({ account, amount: sign * (amounts.get(account.id) ?? 0) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.account.code.localeCompare(b.account.code, undefined, { numeric: true }));
  return { key, label, rows, total: rows.reduce((acc, r) => acc + r.amount, 0) };
}

/* -------------------------------------------------------------------------- */
/* Profit and loss                                                            */
/* -------------------------------------------------------------------------- */

export interface ProfitAndLoss {
  income: StatementSection;
  costOfSales: StatementSection;
  grossProfit: number;
  otherIncome: StatementSection;
  expenses: StatementSection;
  depreciation: StatementSection;
  otherExpenses: StatementSection;
  netProfit: number;
}

export function profitAndLoss(
  lines: LedgerLine[],
  accounts: Account[],
  range: DateRange,
): ProfitAndLoss {
  const amounts = balances(lines, (l) => l.date >= range.from && l.date <= range.to);
  const income = section('income', 'Income', accounts, ['income'], amounts, -1);
  const costOfSales = section(
    'cost',
    'Cost of sales',
    accounts,
    ['expense_direct_cost'],
    amounts,
    1,
  );
  const otherIncome = section(
    'other-income',
    'Other income',
    accounts,
    ['income_other'],
    amounts,
    -1,
  );
  const expenses = section('expenses', 'Expenses', accounts, ['expense'], amounts, 1);
  const depreciation = section(
    'depreciation',
    'Depreciation',
    accounts,
    ['expense_depreciation'],
    amounts,
    1,
  );
  const otherExpenses = section(
    'other-expenses',
    'Other expenses',
    accounts,
    ['expense_other'],
    amounts,
    1,
  );
  const grossProfit = income.total - costOfSales.total;
  return {
    income,
    costOfSales,
    grossProfit,
    otherIncome,
    expenses,
    depreciation,
    otherExpenses,
    netProfit:
      grossProfit + otherIncome.total - expenses.total - depreciation.total - otherExpenses.total,
  };
}

/** Net profit (minor units) of the lines in a date range. */
function profitBetween(
  lines: LedgerLine[],
  types: Map<ID, AccountType>,
  from: ISODate | null,
  to: ISODate,
): number {
  let sum = 0;
  for (const l of lines) {
    const type = types.get(l.accountId);
    if (!type || !isProfitAndLoss(type)) continue;
    if ((from === null || l.date >= from) && l.date <= to) sum += l.amount;
  }
  return -sum;
}

/* -------------------------------------------------------------------------- */
/* Balance sheet                                                              */
/* -------------------------------------------------------------------------- */

export interface BalanceSheet {
  asOf: ISODate;
  assets: StatementSection[];
  totalAssets: number;
  liabilities: StatementSection[];
  totalLiabilities: number;
  equity: StatementSection;
  /** Profit of the current financial year up to `asOf`. */
  currentYearEarnings: number;
  /** Profit of earlier years not moved to retained earnings by a journal. */
  previousYearsEarnings: number;
  totalEquity: number;
  /** Assets minus liabilities and equity; 0 when the books balance. */
  difference: number;
}

export function balanceSheet(
  lines: LedgerLine[],
  accounts: Account[],
  asOf: ISODate,
  yearEnd: FiscalYearEnd,
): BalanceSheet {
  const amounts = balances(lines, (l) => l.date <= asOf);
  const types = new Map(accounts.map((a) => [a.id, a.type]));
  const fyStart = fiscalYearStart(asOf, yearEnd);

  const assets = [
    section('cash', 'Bank and cash', accounts, ['asset_cash'], amounts, 1),
    section('receivable', 'Accounts receivable', accounts, ['asset_receivable'], amounts, 1),
    section(
      'current',
      'Other current assets',
      accounts,
      ['asset_current', 'asset_prepayments'],
      amounts,
      1,
    ),
    section('fixed', 'Fixed assets', accounts, ['asset_fixed'], amounts, 1),
    section('non-current', 'Non-current assets', accounts, ['asset_non_current'], amounts, 1),
  ];
  const liabilities = [
    section('payable', 'Accounts payable', accounts, ['liability_payable'], amounts, -1),
    section(
      'current-liabilities',
      'Current liabilities',
      accounts,
      ['liability_credit_card', 'liability_current'],
      amounts,
      -1,
    ),
    section(
      'non-current-liabilities',
      'Non-current liabilities',
      accounts,
      ['liability_non_current'],
      amounts,
      -1,
    ),
  ];
  const equity = section('equity', 'Equity', accounts, ['equity'], amounts, -1);
  const currentYearEarnings = profitBetween(lines, types, fyStart, asOf);
  const previousYearsEarnings = profitBetween(lines, types, null, addDaysISO(fyStart, -1));

  const totalAssets = assets.reduce((acc, s) => acc + s.total, 0);
  const totalLiabilities = liabilities.reduce((acc, s) => acc + s.total, 0);
  const totalEquity = equity.total + currentYearEarnings + previousYearsEarnings;
  return {
    asOf,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    currentYearEarnings,
    previousYearsEarnings,
    totalEquity,
    difference: totalAssets - totalLiabilities - totalEquity,
  };
}

/* -------------------------------------------------------------------------- */
/* Trial balance                                                              */
/* -------------------------------------------------------------------------- */

export interface TrialBalanceRow {
  account: Account | null;
  /** Shown instead of an account for the synthetic earlier-years line. */
  label: string;
  debit: number;
  credit: number;
}

/**
 * Balances as of a date: balance-sheet accounts from the beginning, income
 * and expenses from the start of the financial year. Earlier years' profit is
 * shown on its own line so debits equal credits.
 */
export function trialBalance(
  lines: LedgerLine[],
  accounts: Account[],
  asOf: ISODate,
  yearEnd: FiscalYearEnd,
): { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number } {
  const fyStart = fiscalYearStart(asOf, yearEnd);
  const types = new Map(accounts.map((a) => [a.id, a.type]));
  const amounts = balances(lines, (l) => {
    if (l.date > asOf) return false;
    const type = types.get(l.accountId);
    return type && isProfitAndLoss(type) ? l.date >= fyStart : true;
  });
  const rows: TrialBalanceRow[] = accounts
    .map((account) => {
      const amount = amounts.get(account.id) ?? 0;
      return {
        account,
        label: account.name,
        debit: Math.max(amount, 0),
        credit: Math.max(-amount, 0),
      };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.account!.code.localeCompare(b.account!.code, undefined, { numeric: true }));
  const earlier = profitBetween(lines, types, null, addDaysISO(fyStart, -1));
  if (earlier !== 0) {
    rows.push({
      account: null,
      label: "Previous years' earnings",
      debit: Math.max(-earlier, 0),
      credit: Math.max(earlier, 0),
    });
  }
  return {
    rows,
    totalDebit: rows.reduce((acc, r) => acc + r.debit, 0),
    totalCredit: rows.reduce((acc, r) => acc + r.credit, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* General ledger                                                             */
/* -------------------------------------------------------------------------- */

export interface LedgerAccountActivity {
  account: Account;
  opening: number;
  lines: (LedgerLine & { balance: number })[];
  debit: number;
  credit: number;
  closing: number;
}

/** Every account's movements in a range, with opening and running balances. */
export function generalLedger(
  lines: LedgerLine[],
  accounts: Account[],
  range: DateRange,
  yearEnd: FiscalYearEnd,
  accountId?: ID,
): LedgerAccountActivity[] {
  const fyStart = fiscalYearStart(range.from, yearEnd);
  return accounts
    .filter((a) => !accountId || a.id === accountId)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((account) => {
      const pl = isProfitAndLoss(account.type);
      const own = lines.filter((l) => l.accountId === account.id);
      const opening = own
        .filter((l) => l.date < range.from && (!pl || l.date >= fyStart))
        .reduce((acc, l) => acc + l.amount, 0);
      let running = opening;
      let debit = 0;
      let credit = 0;
      const inRange = own
        .filter((l) => l.date >= range.from && l.date <= range.to)
        .map((l) => {
          running += l.amount;
          if (l.amount > 0) debit += l.amount;
          else credit -= l.amount;
          return { ...l, balance: running };
        });
      return { account, opening, lines: inRange, debit, credit, closing: running };
    })
    .filter((a) => a.opening !== 0 || a.lines.length > 0);
}

/* -------------------------------------------------------------------------- */
/* IFRS statements                                                            */
/* -------------------------------------------------------------------------- */

/** Levies charged on the profit of Kuwaiti companies. */
export type LevyKind = 'kfas' | 'zakat' | 'nlst' | 'income_tax';

/** Accounts the IFRS statements present on their own lines. */
export interface SpecialAccounts {
  levies: Map<ID, LevyKind>;
  financeCosts: Set<ID>;
  statutoryReserve: ID | null;
  voluntaryReserve: ID | null;
  endOfService: Set<ID>;
}

/** Finds the reserve, levy, finance cost and end-of-service accounts of a chart. */
export function specialAccounts(accounts: Account[], template: ChartTemplateId): SpecialAccounts {
  const find = (key: AccountSpecKey) => findSpecAccount(accounts, key, template);
  const levies = new Map<ID, LevyKind>();
  for (const [key, kind] of [
    ['kfas', 'kfas'],
    ['zakat', 'zakat'],
    ['nlst', 'nlst'],
    ['incomeTax', 'income_tax'],
  ] as const) {
    const account = find(key);
    if (account) levies.set(account.id, kind);
  }
  const finance = new Set<ID>();
  const financeSpec = ACCOUNT_SPECS.financeCosts;
  const financeAccount = find('financeCosts');
  if (financeAccount) finance.add(financeAccount.id);
  for (const a of accounts) {
    if (
      a.type === 'expense_other' &&
      !a.role &&
      !levies.has(a.id) &&
      financeSpec.match.test(a.name)
    )
      finance.add(a.id);
  }
  const endOfService = new Set<ID>();
  const eosSpec = ACCOUNT_SPECS.endOfService;
  for (const a of accounts) {
    if (a.type === eosSpec.type && (eosSpec.match.test(a.name) || a.nameAr === eosSpec.nameAr))
      endOfService.add(a.id);
  }
  const eos = find('endOfService');
  if (eos) endOfService.add(eos.id);
  return {
    levies,
    financeCosts: finance,
    statutoryReserve: find('statutoryReserve')?.id ?? null,
    voluntaryReserve: find('voluntaryReserve')?.id ?? null,
    endOfService,
  };
}

/** A line of a statement: accounts behind it and the amount shown (signed as presented). */
export interface Caption {
  key: string;
  /** English text, translated where it is shown. */
  label: string;
  rows: AccountAmount[];
  /** Amounts not tied to one account, e.g. profit not yet moved to retained earnings. */
  extras: { key: string; label: string; amount: number }[];
  total: number;
}

function caption(
  key: string,
  label: string,
  accounts: Account[],
  include: (a: Account) => boolean,
  amounts: Map<ID, number>,
  sign: 1 | -1,
  extras: Caption['extras'] = [],
): Caption {
  const rows = accounts
    .filter(include)
    .map((account) => ({ account, amount: sign * (amounts.get(account.id) ?? 0) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.account.code.localeCompare(b.account.code, undefined, { numeric: true }));
  const total =
    rows.reduce((acc, r) => acc + r.amount, 0) + extras.reduce((acc, e) => acc + e.amount, 0);
  return { key, label, rows, extras: extras.filter((e) => e.amount !== 0), total };
}

const sumOf = (captions: Caption[]) => captions.reduce((acc, c) => acc + c.total, 0);

export interface ProfitOrLoss {
  range: DateRange;
  revenue: Caption;
  /** Shown negative, like every cost below. */
  costOfSales: Caption;
  grossProfit: number;
  otherIncome: Caption;
  administrative: Caption;
  depreciation: Caption;
  otherExpenses: Caption;
  financeCosts: Caption;
  profitBeforeLevies: number;
  /** KFAS, Zakat, NLST and income tax. */
  levies: Caption;
  profit: number;
}

/**
 * Statement of profit or loss (IAS 1, expenses by nature and function as
 * kept in the chart). Income is positive and costs negative, so every
 * subtotal is a plain sum.
 */
export function profitOrLoss(
  lines: LedgerLine[],
  accounts: Account[],
  range: DateRange,
  special: SpecialAccounts,
): ProfitOrLoss {
  const amounts = balances(lines, (l) => l.date >= range.from && l.date <= range.to);
  const of = (type: AccountType) => (a: Account) => a.type === type;
  const revenue = caption('revenue', msg('Revenue'), accounts, of('income'), amounts, -1);
  const costOfSales = caption(
    'cost-of-sales',
    msg('Cost of sales'),
    accounts,
    of('expense_direct_cost'),
    amounts,
    -1,
  );
  const otherIncome = caption(
    'other-income',
    msg('Other income'),
    accounts,
    of('income_other'),
    amounts,
    -1,
  );
  const administrative = caption(
    'administrative',
    msg('General and administrative expenses'),
    accounts,
    of('expense'),
    amounts,
    -1,
  );
  const depreciation = caption(
    'depreciation',
    msg('Depreciation and amortisation'),
    accounts,
    of('expense_depreciation'),
    amounts,
    -1,
  );
  const otherExpenses = caption(
    'other-expenses',
    msg('Other expenses'),
    accounts,
    (a) =>
      a.type === 'expense_other' && !special.levies.has(a.id) && !special.financeCosts.has(a.id),
    amounts,
    -1,
  );
  const financeCosts = caption(
    'finance-costs',
    msg('Finance costs'),
    accounts,
    (a) => a.type === 'expense_other' && special.financeCosts.has(a.id),
    amounts,
    -1,
  );
  const levies = caption(
    'levies',
    msg('KFAS, Zakat, NLST and income tax'),
    accounts,
    (a) => isProfitAndLoss(a.type) && special.levies.has(a.id),
    amounts,
    -1,
  );
  const grossProfit = revenue.total + costOfSales.total;
  const profitBeforeLevies =
    grossProfit + sumOf([otherIncome, administrative, depreciation, otherExpenses, financeCosts]);
  return {
    range,
    revenue,
    costOfSales,
    grossProfit,
    otherIncome,
    administrative,
    depreciation,
    otherExpenses,
    financeCosts,
    profitBeforeLevies,
    levies,
    profit: profitBeforeLevies + levies.total,
  };
}

export interface FinancialPosition {
  asOf: ISODate;
  nonCurrentAssets: Caption[];
  totalNonCurrentAssets: number;
  currentAssets: Caption[];
  totalCurrentAssets: number;
  totalAssets: number;
  equity: Caption[];
  totalEquity: number;
  nonCurrentLiabilities: Caption[];
  totalNonCurrentLiabilities: number;
  currentLiabilities: Caption[];
  totalCurrentLiabilities: number;
  totalLiabilities: number;
  /** Assets less equity and liabilities; 0 when the books balance. */
  difference: number;
}

/** The equity column (statement of changes in equity) an equity account belongs to. */
export type EquityComponent =
  'capital' | 'statutory' | 'voluntary' | 'partners' | 'other' | 'retained';

export function equityComponent(account: Account, special: SpecialAccounts): EquityComponent {
  if (account.role === 'capital') return 'capital';
  if (account.role === 'retained_earnings') return 'retained';
  if (account.role === 'drawings') return 'partners';
  if (account.id === special.statutoryReserve) return 'statutory';
  if (account.id === special.voluntaryReserve) return 'voluntary';
  return 'other';
}

export const EQUITY_LABELS: Record<EquityComponent, string> = {
  capital: msg('Share capital'),
  statutory: msg('Statutory reserve'),
  voluntary: msg('Voluntary reserve'),
  partners: msg('Partners’ current accounts'),
  other: msg('Other equity'),
  retained: msg('Retained earnings'),
};

/**
 * Statement of financial position (IAS 1): non-current then current assets,
 * equity with the statutory and voluntary reserves, then non-current and
 * current liabilities. Profit not moved to retained earnings by an entry is
 * shown in retained earnings.
 */
export function financialPosition(
  lines: LedgerLine[],
  accounts: Account[],
  asOf: ISODate,
  yearEnd: FiscalYearEnd,
  special: SpecialAccounts,
): FinancialPosition {
  const amounts = balances(lines, (l) => l.date <= asOf);
  const types = new Map(accounts.map((a) => [a.id, a.type]));
  const fyStart = fiscalYearStart(asOf, yearEnd);
  const of = (type: AccountType) => (a: Account) => a.type === type;

  const nonCurrentAssets = [
    caption('ppe', msg('Property and equipment'), accounts, of('asset_fixed'), amounts, 1),
    caption(
      'other-non-current-assets',
      msg('Intangible and other non-current assets'),
      accounts,
      of('asset_non_current'),
      amounts,
      1,
    ),
  ];
  const currentAssets = [
    caption(
      'other-current-assets',
      msg('Inventories and other current assets'),
      accounts,
      of('asset_current'),
      amounts,
      1,
    ),
    caption('prepayments', msg('Prepayments'), accounts, of('asset_prepayments'), amounts, 1),
    caption('receivables', msg('Trade receivables'), accounts, of('asset_receivable'), amounts, 1),
    caption('cash', msg('Cash and bank balances'), accounts, of('asset_cash'), amounts, 1),
  ];
  const component = (key: EquityComponent) => (a: Account) =>
    a.type === 'equity' && equityComponent(a, special) === key;
  const currentYear = profitBetween(lines, types, fyStart, asOf);
  const earlier = profitBetween(lines, types, null, addDaysISO(fyStart, -1));
  const equity = [
    caption('capital', EQUITY_LABELS.capital, accounts, component('capital'), amounts, -1),
    caption('statutory', EQUITY_LABELS.statutory, accounts, component('statutory'), amounts, -1),
    caption('voluntary', EQUITY_LABELS.voluntary, accounts, component('voluntary'), amounts, -1),
    caption('partners', EQUITY_LABELS.partners, accounts, component('partners'), amounts, -1),
    caption('other', EQUITY_LABELS.other, accounts, component('other'), amounts, -1),
    caption('retained', EQUITY_LABELS.retained, accounts, component('retained'), amounts, -1, [
      { key: 'earlier', label: msg('Profit of earlier years'), amount: earlier },
      { key: 'current', label: msg('Profit for the current year'), amount: currentYear },
    ]),
  ];
  const nonCurrentLiabilities = [
    caption(
      'end-of-service',
      msg('Provision for end-of-service indemnity'),
      accounts,
      (a) => a.type === 'liability_non_current' && special.endOfService.has(a.id),
      amounts,
      -1,
    ),
    caption(
      'loans',
      msg('Loans and other non-current liabilities'),
      accounts,
      (a) => a.type === 'liability_non_current' && !special.endOfService.has(a.id),
      amounts,
      -1,
    ),
  ];
  const currentLiabilities = [
    caption('payables', msg('Trade payables'), accounts, of('liability_payable'), amounts, -1),
    caption(
      'other-current-liabilities',
      msg('Accruals and other current liabilities'),
      accounts,
      (a) => a.type === 'liability_current' || a.type === 'liability_credit_card',
      amounts,
      -1,
    ),
  ];
  const totalNonCurrentAssets = sumOf(nonCurrentAssets);
  const totalCurrentAssets = sumOf(currentAssets);
  const totalEquity = sumOf(equity);
  const totalNonCurrentLiabilities = sumOf(nonCurrentLiabilities);
  const totalCurrentLiabilities = sumOf(currentLiabilities);
  const totalAssets = totalNonCurrentAssets + totalCurrentAssets;
  const totalLiabilities = totalNonCurrentLiabilities + totalCurrentLiabilities;
  return {
    asOf,
    nonCurrentAssets,
    totalNonCurrentAssets,
    currentAssets,
    totalCurrentAssets,
    totalAssets,
    equity,
    totalEquity,
    nonCurrentLiabilities,
    totalNonCurrentLiabilities,
    currentLiabilities,
    totalCurrentLiabilities,
    totalLiabilities,
    difference: totalAssets - totalEquity - totalLiabilities,
  };
}

/* -------------------------------------------------------------------------- */
/* Statement of changes in equity                                             */
/* -------------------------------------------------------------------------- */

export type EquityValues = Record<EquityComponent, number>;

export interface EquityMovement {
  key: string;
  label: string;
  values: EquityValues;
}

export interface ChangesInEquity {
  range: DateRange;
  /** Components with a balance or a movement, in presentation order. */
  components: EquityComponent[];
  opening: EquityValues;
  movements: EquityMovement[];
  closing: EquityValues;
}

const EQUITY_ORDER: EquityComponent[] = [
  'capital',
  'statutory',
  'voluntary',
  'partners',
  'other',
  'retained',
];

const zeroValues = (): EquityValues => ({
  capital: 0,
  statutory: 0,
  voluntary: 0,
  partners: 0,
  other: 0,
  retained: 0,
});

/**
 * Statement of changes in equity for a period: each component at the start,
 * the profit, transfers to reserves made at the year end, capital and
 * partners' movements, other movements, and each component at the end.
 * `kinds` tells which journals are year-end entries.
 */
export function changesInEquity(
  lines: LedgerLine[],
  accounts: Account[],
  range: DateRange,
  special: SpecialAccounts,
  yearEndJournals: Set<ID>,
): ChangesInEquity {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const balanceAt = (inclusive: (date: ISODate) => boolean) => {
    const values = zeroValues();
    for (const l of lines) {
      if (!inclusive(l.date)) continue;
      const account = byId.get(l.accountId);
      if (!account) continue;
      if (account.type === 'equity') values[equityComponent(account, special)] -= l.amount;
      else if (isProfitAndLoss(account.type)) values.retained -= l.amount;
    }
    return values;
  };
  const opening = balanceAt((d) => d < range.from);
  const closing = balanceAt((d) => d <= range.to);

  const profit = zeroValues();
  const capital = zeroValues();
  const partners = zeroValues();
  const statutory = zeroValues();
  const voluntary = zeroValues();
  for (const l of lines) {
    if (l.date < range.from || l.date > range.to) continue;
    const account = byId.get(l.accountId);
    if (!account) continue;
    if (isProfitAndLoss(account.type)) {
      profit.retained -= l.amount;
      continue;
    }
    if (account.type !== 'equity') continue;
    const component = equityComponent(account, special);
    const yearEnd = l.source === 'journal' && yearEndJournals.has(l.sourceId);
    if (yearEnd && component === 'statutory') {
      statutory.statutory -= l.amount;
      statutory.retained += l.amount;
    } else if (yearEnd && component === 'voluntary') {
      voluntary.voluntary -= l.amount;
      voluntary.retained += l.amount;
    } else if (component === 'capital') capital.capital -= l.amount;
    else if (component === 'partners') partners.partners -= l.amount;
  }
  const other = zeroValues();
  for (const key of EQUITY_ORDER) {
    other[key] =
      closing[key] -
      opening[key] -
      profit[key] -
      capital[key] -
      partners[key] -
      statutory[key] -
      voluntary[key];
  }
  const movements: EquityMovement[] = [
    { key: 'profit', label: msg('Profit for the period'), values: profit },
    { key: 'statutory', label: msg('Transfer to statutory reserve'), values: statutory },
    { key: 'voluntary', label: msg('Transfer to voluntary reserve'), values: voluntary },
    { key: 'capital', label: msg('Capital introduced or withdrawn'), values: capital },
    { key: 'partners', label: msg('Partners’ drawings and contributions'), values: partners },
    { key: 'other', label: msg('Other movements'), values: other },
  ].filter((m) => m.key === 'profit' || EQUITY_ORDER.some((k) => m.values[k] !== 0));
  const components = EQUITY_ORDER.filter(
    (k) =>
      k === 'capital' ||
      k === 'retained' ||
      opening[k] !== 0 ||
      closing[k] !== 0 ||
      movements.some((m) => m.values[k] !== 0),
  );
  return { range, components, opening, movements, closing };
}

/** Sum of the components shown. */
export function equityTotal(values: EquityValues): number {
  return EQUITY_ORDER.reduce((acc, k) => acc + values[k], 0);
}

/* -------------------------------------------------------------------------- */
/* Comparative periods                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The same period one year earlier. Month ends stay month ends, so a year to
 * 28 February 2029 compares with the year to 29 February 2028.
 */
export function previousYearRange(range: DateRange): DateRange {
  const shift = (date: ISODate) => {
    const d = parseISODate(date);
    const lastDay = (year: number) => new Date(year, d.getMonth() + 1, 0).getDate();
    const year = d.getFullYear() - 1;
    const day =
      d.getDate() === lastDay(d.getFullYear())
        ? lastDay(year)
        : Math.min(d.getDate(), lastDay(year));
    return toISODate(new Date(year, d.getMonth(), day));
  };
  return { from: shift(range.from), to: shift(range.to) };
}

/**
 * The date of the comparative statement of financial position: the end of
 * the previous financial year (IAS 1 and IAS 34).
 */
export function comparativeDate(asOf: ISODate, yearEnd: FiscalYearEnd): ISODate {
  return addDaysISO(fiscalYearStart(asOf, yearEnd), -1);
}
