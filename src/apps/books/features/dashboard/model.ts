import type {
  Account,
  Client,
  Company,
  Expense,
  ID,
  InvoiceDocument,
  ISODate,
  Payment,
  VatReturnRecord,
} from '@/db/types';
import { displayStatus } from '@/lib/status';
import { addDaysISO, daysBetween } from '@/lib/dates';
import { fromMinor, round } from '@/lib/money';
import { agingReport } from '@/lib/reports';
import { chequePayments, isOpenCheque, paymentMinor } from '@/lib/cheques';
import { accountGroup, isDebitNormal, isMoneyAccount } from '@/lib/accounting/account-types';
import { isPosted, type LedgerLine } from '@/lib/accounting/ledger';
import { fiscalYearStart, type FiscalYearEnd } from '@/lib/accounting/statements';
import { vatDueDate, vatPeriodOf } from '@/lib/accounting/vat';
import { isCustomer } from '@/db/purchases';
import { vatSettings } from '@/db/chart-setup';
import { msg } from '@/i18n';

/**
 * The Books dashboard's figures, worked out from what is on the device. The
 * page shows what these return; amounts leave here in major units (dinars),
 * so every conversion from the ledger's minor units (fils) is made here.
 */

/** Days ahead the dashboard looks for cheques, deadlines and documents. */
export const CHEQUE_DAYS = 14;
export const COMPLIANCE_DAYS = 30;

/* -------------------------------------------------------------------------- */
/* Today's figures                                                            */
/* -------------------------------------------------------------------------- */

/** The `count` months up to the one `from` is in, oldest first ("2026-03"). */
export function monthKeys(count: number, from: string): string[] {
  const [y, m] = from.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/** "Mar", with the year on January ("Jan ’26"), for chart axes. */
export function monthLabels(keys: string[], locale: string): string[] {
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short' });
  return keys.map((k) => {
    const [yy, mm] = k.split('-').map(Number);
    const label = monthFormat.format(new Date(yy, mm - 1, 1));
    return mm === 1 ? `${label} ’${String(yy).slice(2)}` : label;
  });
}

export type ChequeRow = Payment & { cheque: NonNullable<Payment['cheque']>; minor: number };

export interface DashboardInput {
  docs: InvoiceDocument[];
  payments: Payment[];
  clients: Client[];
  expenses: Expense[];
  vatFiled: VatReturnRecord[];
  company: Company;
  locale: string;
  now: ISODate;
  taxesOn: boolean;
  precision: number;
}

/**
 * What the key figures and today's cards show: who owes the company, bills
 * due this week, cheques due, invoiced against collected and what needs
 * attention. `months` are the months of the chart (the last 12 by default),
 * whole months or, from a period, cut to its dates.
 */
export function dashboardFigures(
  {
    docs,
    payments,
    clients,
    expenses,
    vatFiled,
    company,
    locale,
    now,
    taxesOn,
    precision,
  }: DashboardInput,
  months: string[] | MonthSpan[] = monthKeys(12, now),
) {
  const spans: MonthSpan[] = months.map((m) =>
    typeof m === 'string' ? { key: m, from: `${m}-01`, to: `${m}-31` } : m,
  );
  const within = (date: ISODate, span: MonthSpan) => date >= span.from && date <= span.to;
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

  // Invoiced against collected, month by month.
  const issued = invoices.filter((d) => d.status !== 'draft' && d.status !== 'void');
  const cash = live.filter(
    (p) => p.direction !== 'out' && p.method !== 'credit_note' && p.currency === base,
  );
  const invoicedByMonth = spans.map((m) =>
    issued
      .filter((d) => d.currency === base && within(d.issueDate, m))
      .reduce((s, d) => s + d.totals.total, 0),
  );
  const collectedByMonth = spans.map((m) =>
    cash.filter((p) => within(p.date, m)).reduce((s, p) => s + p.amount, 0),
  );
  const labels = monthLabels(
    spans.map((m) => m.key),
    locale,
  );

  const quotesWaiting = docs.filter((d) => d.type === 'quote' && displayStatus(d, now) === 'sent');

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
}

export type DashboardFigures = ReturnType<typeof dashboardFigures>;

interface Books {
  lines: LedgerLine[];
  accounts: Account[];
}

/** The "Cash and bank" figure: bank and cash accounts in use, largest first (minor units). */
export function cashAccounts(ledger: Books) {
  const balances = new Map<string, number>();
  for (const line of ledger.lines) {
    balances.set(line.accountId, (balances.get(line.accountId) ?? 0) + line.amount);
  }
  const accounts = ledger.accounts
    .filter((a) => isMoneyAccount(a.type) && a.type === 'asset_cash' && !a.archived)
    .map((a) => ({ account: a, minor: balances.get(a.id) ?? 0 }))
    .sort((a, b) => b.minor - a.minor);
  return { accounts, total: accounts.reduce((s, a) => s + a.minor, 0) };
}

/* -------------------------------------------------------------------------- */
/* Period                                                                     */
/* -------------------------------------------------------------------------- */

export type DashboardPeriod = 'last-12-months' | 'last-6-months' | 'this-year' | 'last-year';

/** Translate where shown: `t(period.label)`. */
export const DASHBOARD_PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 'last-12-months', label: msg('Last 12 months') },
  { value: 'last-6-months', label: msg('Last 6 months') },
  { value: 'this-year', label: msg('This financial year') },
  { value: 'last-year', label: msg('Last financial year') },
];

/** As people are used to: the chart of today's dashboard covers 12 months. */
export const DEFAULT_PERIOD: DashboardPeriod = 'last-12-months';

export function isDashboardPeriod(value: unknown): value is DashboardPeriod {
  return DASHBOARD_PERIODS.some((p) => p.value === value);
}

/** One month of a period; the first and last can be part of a month. */
export interface MonthSpan {
  /** "2026-03" */
  key: string;
  from: ISODate;
  to: ISODate;
}

export interface DashboardRange {
  period: DashboardPeriod;
  from: ISODate;
  to: ISODate;
  months: MonthSpan[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** First day of the month `offset` months after the one `date` is in. */
function monthStart(date: ISODate, offset = 0): ISODate {
  const [y, m] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + offset;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

/** The months from `from` to `to`, each cut to the period. */
export function monthSpans(from: ISODate, to: ISODate): MonthSpan[] {
  const spans: MonthSpan[] = [];
  for (let start = monthStart(from); start <= to; start = monthStart(start, 1)) {
    const end = addDaysISO(monthStart(start, 1), -1);
    spans.push({
      key: start.slice(0, 7),
      from: start < from ? from : start,
      to: end > to ? to : end,
    });
  }
  return spans;
}

/**
 * The dates a period covers. Periods that are still running end today, so
 * the last month's closing cash is what the bank accounts hold now.
 */
export function dashboardRange(
  period: DashboardPeriod,
  now: ISODate,
  yearEnd: FiscalYearEnd,
): DashboardRange {
  let from: ISODate;
  let to: ISODate = now;
  switch (period) {
    case 'last-6-months':
      from = monthStart(now, -5);
      break;
    case 'this-year':
      from = fiscalYearStart(now, yearEnd);
      break;
    case 'last-year':
      to = addDaysISO(fiscalYearStart(now, yearEnd), -1);
      from = fiscalYearStart(to, yearEnd);
      break;
    default:
      from = monthStart(now, -11);
  }
  return { period, from, to, months: monthSpans(from, to) };
}

/* -------------------------------------------------------------------------- */
/* Receivables and payables                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Unpaid invoices (receivables) or bills (payables) in the company currency
 * by age, in the 30-day buckets of the aging report, with what is not due
 * yet and what is overdue; documents in other currencies are totalled apart.
 */
export function agingSummary(
  docs: InvoiceDocument[],
  clients: Client[],
  currency: string,
  now: ISODate,
  type: 'invoice' | 'bill',
  precision: number,
) {
  const aging = agingReport(docs, clients, currency, now, type);
  const others = new Map<string, number>();
  for (const d of docs) {
    if (d.type !== type || d.currency === currency) continue;
    if (d.status !== 'sent' && d.status !== 'partial') continue;
    if (d.totals.balance <= 0) continue;
    others.set(d.currency, (others.get(d.currency) ?? 0) + d.totals.balance);
  }
  return {
    aging,
    current: aging.totals[0],
    overdue: round(aging.total - aging.totals[0], precision),
    otherCurrencies: [...others.entries()],
  };
}

export type AgingSummary = ReturnType<typeof agingSummary>;

/** What the company owes vendors on bills, by age. */
export function payablesSummary(
  docs: InvoiceDocument[],
  clients: Client[],
  currency: string,
  now: ISODate,
  precision: number,
): AgingSummary {
  return agingSummary(docs, clients, currency, now, 'bill', precision);
}

/* -------------------------------------------------------------------------- */
/* From the ledger                                                            */
/* -------------------------------------------------------------------------- */

export interface CashFlowMonth {
  key: string;
  opening: number;
  incoming: number;
  outgoing: number;
  closing: number;
}

/**
 * Money into and out of the bank and cash accounts in use, month by month
 * (those of the Cash and bank figure, so the last closing of a period that
 * runs to today is what they hold, entries dated later aside). A transfer
 * between two of them is neither: what goes in and out is the net of each
 * entry on a day.
 */
export function monthlyCashFlow(ledger: Books, range: DashboardRange, precision: number) {
  // The accounts of the Cash and bank figure (cashAccounts): those in use.
  const cash = new Set(
    ledger.accounts
      .filter((a) => isMoneyAccount(a.type) && a.type === 'asset_cash' && !a.archived)
      .map((a) => a.id),
  );
  let opening = 0;
  const entries = new Map<string, { date: ISODate; amount: number }>();
  for (const l of ledger.lines) {
    if (!cash.has(l.accountId) || l.date > range.to) continue;
    if (l.date < range.from) {
      opening += l.amount;
      continue;
    }
    const key = `${l.sourceId}|${l.date}`;
    const entry = entries.get(key) ?? { date: l.date, amount: 0 };
    entry.amount += l.amount;
    entries.set(key, entry);
  }
  const index = new Map(range.months.map((m, i) => [m.key, i]));
  const incoming = range.months.map(() => 0);
  const outgoing = range.months.map(() => 0);
  for (const { date, amount } of entries.values()) {
    const i = index.get(date.slice(0, 7));
    if (i === undefined) continue;
    if (amount > 0) incoming[i] += amount;
    else outgoing[i] -= amount;
  }
  const major = (minor: number) => fromMinor(minor, precision);
  let running = opening;
  const months: CashFlowMonth[] = range.months.map((m, i) => {
    const start = running;
    running += incoming[i] - outgoing[i];
    return {
      key: m.key,
      opening: major(start),
      incoming: major(incoming[i]),
      outgoing: major(outgoing[i]),
      closing: major(running),
    };
  });
  const totalIn = incoming.reduce((s, v) => s + v, 0);
  const totalOut = outgoing.reduce((s, v) => s + v, 0);
  return {
    months,
    opening: major(opening),
    incoming: major(totalIn),
    outgoing: major(totalOut),
    closing: major(running),
  };
}

export type CashFlowFigures = ReturnType<typeof monthlyCashFlow>;

export interface IncomeExpenseMonth {
  key: string;
  income: number;
  expense: number;
  profit: number;
}

/**
 * Income and expenses month by month as the profit and loss counts them
 * (accrual basis: when invoiced or billed, not when paid).
 */
export function incomeExpenseByMonth(ledger: Books, range: DashboardRange, precision: number) {
  const groups = new Map(ledger.accounts.map((a) => [a.id, accountGroup(a.type)]));
  const index = new Map(range.months.map((m, i) => [m.key, i]));
  const income = range.months.map(() => 0);
  const expense = range.months.map(() => 0);
  for (const l of ledger.lines) {
    if (l.date < range.from || l.date > range.to) continue;
    const group = groups.get(l.accountId);
    if (group !== 'income' && group !== 'expense') continue;
    const i = index.get(l.date.slice(0, 7));
    if (i === undefined) continue;
    if (group === 'income') income[i] -= l.amount;
    else expense[i] += l.amount;
  }
  const major = (minor: number) => fromMinor(minor, precision);
  const months: IncomeExpenseMonth[] = range.months.map((m, i) => ({
    key: m.key,
    income: major(income[i]),
    expense: major(expense[i]),
    profit: major(income[i] - expense[i]),
  }));
  const totalIncome = income.reduce((s, v) => s + v, 0);
  const totalExpense = expense.reduce((s, v) => s + v, 0);
  return {
    months,
    income: major(totalIncome),
    expense: major(totalExpense),
    profit: major(totalIncome - totalExpense),
  };
}

export type IncomeExpenseFigures = ReturnType<typeof incomeExpenseByMonth>;

/** How many expense accounts the top expenses list. */
export const TOP_EXPENSES = 5;

/** The expense accounts with the most spent in the period; the rest add up to `other`. */
export function topExpenses(
  ledger: Books,
  range: DashboardRange,
  precision: number,
  limit = TOP_EXPENSES,
) {
  const amounts = new Map<ID, number>();
  for (const l of ledger.lines) {
    if (l.date < range.from || l.date > range.to) continue;
    amounts.set(l.accountId, (amounts.get(l.accountId) ?? 0) + l.amount);
  }
  const rows = ledger.accounts
    .filter((a) => accountGroup(a.type) === 'expense')
    .map((account) => ({ account, minor: amounts.get(account.id) ?? 0 }))
    .filter((r) => r.minor > 0)
    .sort(
      (a, b) =>
        b.minor - a.minor ||
        a.account.code.localeCompare(b.account.code, undefined, { numeric: true }),
    );
  const major = (minor: number) => fromMinor(minor, precision);
  const total = rows.reduce((s, r) => s + r.minor, 0);
  const top = rows.slice(0, limit);
  return {
    rows: top.map((r) => ({ account: r.account, amount: major(r.minor) })),
    other: major(total - top.reduce((s, r) => s + r.minor, 0)),
    otherCount: rows.length - top.length,
    total: major(total),
  };
}

export type TopExpenseFigures = ReturnType<typeof topExpenses>;

export interface MoneyAccountRow {
  account: Account;
  kind: 'bank' | 'card';
  /** What a bank or cash account holds; for a card, what is owed on it. */
  balance: number;
}

/**
 * Bank, cash and card accounts in use with their balances today. A card's
 * balance is what is owed on it, so spending on the card makes it larger.
 */
export function moneyAccountRows(ledger: Books, precision: number) {
  const balances = new Map<ID, number>();
  for (const l of ledger.lines) {
    balances.set(l.accountId, (balances.get(l.accountId) ?? 0) + l.amount);
  }
  const byCode = (a: Account, b: Account) =>
    a.code.localeCompare(b.code, undefined, { numeric: true });
  const money = ledger.accounts.filter((a) => isMoneyAccount(a.type) && !a.archived).sort(byCode);
  const rows: MoneyAccountRow[] = [
    ...money.filter((a) => a.type === 'asset_cash'),
    ...money.filter((a) => a.type === 'liability_credit_card'),
  ].map((account) => {
    const minor = balances.get(account.id) ?? 0;
    return account.type === 'liability_credit_card'
      ? { account, kind: 'card', balance: fromMinor(-minor, precision) }
      : { account, kind: 'bank', balance: fromMinor(minor, precision) };
  });
  const total = (kind: MoneyAccountRow['kind']) =>
    round(
      rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.balance, 0),
      precision,
    );
  return { rows, cash: total('bank'), owed: total('card') };
}

export type MoneyAccountFigures = ReturnType<typeof moneyAccountRows>;

/** The most accounts a watchlist holds. */
export const WATCHLIST_SIZE = 8;

export interface WatchRow {
  account: Account;
  /** Income and expense accounts: the period's total; others: the balance at its end. */
  kind: 'period' | 'balance';
  /** On the account's normal side: positive is a debit balance for assets and expenses. */
  amount: number;
}

/** The accounts someone watches, in their order; accounts no longer there are skipped. */
export function watchlistRows(
  ledger: Books,
  ids: readonly ID[],
  range: DashboardRange,
  precision: number,
): WatchRow[] {
  const byId = new Map(ledger.accounts.map((a) => [a.id, a]));
  const watched = ids.slice(0, WATCHLIST_SIZE).flatMap((id) => byId.get(id) ?? []);
  const wanted = new Set(watched.map((a) => a.id));
  const kinds = new Map(watched.map((a) => [a.id, profitAndLossAccount(a)]));
  const sums = new Map<ID, number>();
  for (const l of ledger.lines) {
    if (!wanted.has(l.accountId) || l.date > range.to) continue;
    if (kinds.get(l.accountId) && l.date < range.from) continue;
    sums.set(l.accountId, (sums.get(l.accountId) ?? 0) + l.amount);
  }
  return watched.map((account) => {
    const minor = sums.get(account.id) ?? 0;
    return {
      account,
      kind: kinds.get(account.id) ? 'period' : 'balance',
      amount: fromMinor(isDebitNormal(account.type) ? minor : -minor, precision),
    };
  });
}

const profitAndLossAccount = (a: Account) => {
  const group = accountGroup(a.type);
  return group === 'income' || group === 'expense';
};

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export type OverviewCard =
  | 'receivables'
  | 'payables'
  | 'cash-flow'
  | 'income-expense'
  | 'top-expenses'
  | 'bank-accounts'
  | 'watchlist';

/** In the order of the page. */
export const OVERVIEW_CARDS: OverviewCard[] = [
  'receivables',
  'payables',
  'cash-flow',
  'income-expense',
  'top-expenses',
  'bank-accounts',
  'watchlist',
];

/**
 * Cards that could show what salaries cost when they are entered as bills
 * or journals (D16): only owners, admins and accountants see them.
 */
const PEOPLE_CARDS = new Set<OverviewCard>(['income-expense', 'top-expenses', 'watchlist']);

/** The cards someone sees: none of the people cards for staff and viewers, none they hid. */
export function overviewCards(
  peopleHidden: boolean,
  hidden: readonly string[] = [],
): OverviewCard[] {
  return OVERVIEW_CARDS.filter(
    (card) => !hidden.includes(card) && !(peopleHidden && PEOPLE_CARDS.has(card)),
  );
}

export function isOverviewCard(value: unknown): value is OverviewCard {
  return OVERVIEW_CARDS.includes(value as OverviewCard);
}

/**
 * The figures of the cards from the ledger, for the cards shown only, so a
 * card that is hidden from someone is never worked out for them.
 */
export function ledgerFigures(
  ledger: Books,
  range: DashboardRange,
  cards: readonly OverviewCard[],
  watchlist: readonly ID[],
  precision: number,
) {
  const shows = (card: OverviewCard) => cards.includes(card);
  return {
    cashFlow: shows('cash-flow') ? monthlyCashFlow(ledger, range, precision) : null,
    incomeExpense: shows('income-expense') ? incomeExpenseByMonth(ledger, range, precision) : null,
    topExpenses: shows('top-expenses') ? topExpenses(ledger, range, precision) : null,
    bankAccounts: shows('bank-accounts') ? moneyAccountRows(ledger, precision) : null,
    watchlist: shows('watchlist') ? watchlistRows(ledger, watchlist, range, precision) : null,
  };
}

export type LedgerFigures = ReturnType<typeof ledgerFigures>;

/* -------------------------------------------------------------------------- */
/* What each person chose                                                     */
/* -------------------------------------------------------------------------- */

/** Kept in localStorage on this device; never synced or backed up (D3). */
export interface DashboardPrefs {
  period: DashboardPeriod;
  watchlist: ID[];
  hidden: OverviewCard[];
}

export const prefsKey = (companyId: ID) => `dashboard:${companyId}`;

/** What was saved, with anything unreadable (an older or newer shape) left at its default. */
export function readDashboardPrefs(raw: string | null | undefined): DashboardPrefs {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      saved = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: start again from the defaults.
  }
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    period: isDashboardPeriod(saved.period) ? saved.period : DEFAULT_PERIOD,
    watchlist: [
      ...new Set(list(saved.watchlist).filter((id): id is string => typeof id === 'string')),
    ].slice(0, WATCHLIST_SIZE),
    hidden: [...new Set(list(saved.hidden).filter(isOverviewCard))],
  };
}
