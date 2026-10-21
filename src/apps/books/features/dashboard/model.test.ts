import { describe, expect, it } from 'vitest';
import type {
  Account,
  AccountRole,
  AccountType,
  Client,
  Company,
  InvoiceDocument,
  Payment,
} from '@/db/types';
import type { LedgerLine } from '@/lib/accounting/ledger';
import { cashFlow } from '@/lib/accounting/cash-flow';
import { profitAndLoss, specialAccounts } from '@/lib/accounting/statements';
import { agingReport } from '@/lib/reports';
import { fromMinor } from '@/lib/money';
import {
  cashAccounts,
  dashboardFigures,
  dashboardRange,
  incomeExpenseByMonth,
  ledgerFigures,
  monthKeys,
  monthlyCashFlow,
  moneyAccountRows,
  overviewCards,
  payablesSummary,
  agingSummary,
  readDashboardPrefs,
  topExpenses,
  watchlistRows,
  WATCHLIST_SIZE,
} from './model';

const NOW = '2026-10-21';
const DEC = { month: 12, day: 31 };
const P = 3;

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

const company = { id: 'co', currency: 'KWD' } as Company;

const client = (id: string, name: string, vendor = false): Client =>
  ({ id, companyId: 'co', name, isCustomer: !vendor, isVendor: vendor }) as Client;

const CLIENTS = [
  client('c1', 'Client One'),
  client('c2', 'Client Two'),
  client('v1', 'Vendor', true),
];

let seq = 0;
function doc(
  type: InvoiceDocument['type'],
  status: InvoiceDocument['status'],
  issueDate: string,
  dueDate: string | null,
  total: number,
  balance: number,
  clientId = 'c1',
  currency = 'KWD',
): InvoiceDocument {
  seq += 1;
  return {
    id: `d${seq}`,
    companyId: 'co',
    type,
    number: `${type.toUpperCase()}-${seq}`,
    status,
    clientId,
    issueDate,
    dueDate,
    currency,
    totals: { total, balance },
  } as unknown as InvoiceDocument;
}

function payment(date: string, amount: number, extra: Partial<Payment> = {}): Payment {
  seq += 1;
  return {
    id: `p${seq}`,
    companyId: 'co',
    clientId: 'c1',
    number: `PAY-${seq}`,
    date,
    amount,
    currency: 'KWD',
    method: 'bank_transfer',
    reference: '',
    notes: '',
    allocations: [],
    documentIds: [],
    creditId: null,
    ...extra,
  } as Payment;
}

const DOCS = [
  // Owed: one not due yet, one 10 days late, one 75 days late, one in dollars.
  doc('invoice', 'sent', '2026-10-01', '2026-10-31', 500, 500),
  doc('invoice', 'partial', '2026-09-01', '2026-10-11', 800, 300, 'c2'),
  doc('invoice', 'sent', '2026-07-01', '2026-08-07', 1200, 1200),
  doc('invoice', 'sent', '2026-10-05', '2026-11-05', 100, 100, 'c2', 'USD'),
  doc('invoice', 'paid', '2026-03-10', '2026-04-10', 2000, 0),
  doc('invoice', 'draft', '2026-10-15', null, 999, 999),
  // Bills: due in three days, 20 days late, next month.
  doc('bill', 'sent', '2026-10-01', '2026-10-24', 250, 250, 'v1'),
  doc('bill', 'partial', '2026-09-01', '2026-10-01', 400, 150, 'v1'),
  doc('bill', 'sent', '2026-10-20', '2026-11-30', 90, 90, 'v1'),
  doc('quote', 'sent', '2026-10-18', '2026-11-18', 750, 750, 'c2'),
];

const PAYMENTS = [
  payment('2026-09-15', 500),
  payment('2026-03-20', 2000),
  payment('2026-10-02', 250, { direction: 'out', clientId: 'v1' }),
  payment('2026-10-10', 120, {
    method: 'cheque',
    cheque: { number: '1', bank: 'NBOK', date: '2026-10-25', drawer: 'Client One', status: 'held' },
  }),
  payment('2026-10-12', 60, {
    direction: 'out',
    method: 'cheque',
    cheque: { number: '2', bank: 'KFH', date: '2026-10-30', drawer: 'Vendor', status: 'held' },
  }),
  payment('2026-08-01', 999, { voided: true }),
];

const figures = (months?: string[]) =>
  dashboardFigures(
    {
      docs: DOCS,
      payments: PAYMENTS,
      clients: CLIENTS,
      expenses: [],
      vatFiled: [],
      company,
      locale: 'en-KW',
      now: NOW,
      taxesOn: false,
      precision: P,
    },
    months,
  );

describe("today's figures", () => {
  it('stay what the dashboard showed before the overview', () => {
    const data = figures();
    expect(data.aging.total).toBe(2000);
    expect(data.aging.totals).toEqual([500, 300, 0, 1200, 0]);
    expect(data.otherCurrencies).toEqual([['USD', 100]]);
    expect(data.overdue.map((o) => [o.doc.number, o.days])).toEqual([
      [DOCS[2].number, 75],
      [DOCS[1].number, 10],
    ]);
    expect(data.overdueTotal).toBe(1500);
    expect(data.billsDue.map((d) => d.number)).toEqual([DOCS[6].number, DOCS[7].number]);
    expect(data.billsDueTotal).toBe(400);
    expect(data.billsOverdueTotal).toBe(150);
    expect(data.chequesIn.map((c) => c.minor)).toEqual([120_000]);
    expect(data.chequesOut.map((c) => c.minor)).toEqual([60_000]);
    expect(data.quotesWaiting).toHaveLength(1);
    expect(data.vatDue).toBeNull();
    expect(data.hasClients).toBe(true);
    expect(data.hasInvoices).toBe(true);
  });

  it('chart the last 12 months of invoices and money collected', () => {
    const { chart } = figures();
    expect(chart.labels).toHaveLength(12);
    expect(chart.labels[0]).toBe('Nov');
    expect(chart.labels[2]).toBe('Jan ’26');
    // Nov 2025 … Oct 2026; drafts, voided payments and money paid out don't count.
    expect(chart.invoiced).toEqual([0, 0, 0, 0, 2000, 0, 0, 0, 1200, 0, 800, 500]);
    expect(chart.collected).toEqual([0, 0, 0, 0, 2000, 0, 0, 0, 0, 0, 500, 120]);
    expect(chart.empty).toBe(false);
  });

  it('chart the months of the overview’s period when given', () => {
    const { chart } = figures(monthKeys(3, NOW));
    expect(chart.invoiced).toEqual([0, 800, 500]);
  });
});

/* -------------------------------------------------------------------------- */
/* Ledger                                                                     */
/* -------------------------------------------------------------------------- */

const account = (
  id: string,
  code: string,
  type: AccountType,
  role: AccountRole | null = null,
  archived = false,
): Account => ({
  id,
  companyId: 'co',
  code,
  name: id,
  type,
  description: '',
  role,
  bank: null,
  archived,
  createdAt: '',
  updatedAt: '',
});

const ACCOUNTS = [
  account('bank', '1000', 'asset_cash', 'bank'),
  account('petty', '1010', 'asset_cash', 'cash'),
  account('ar', '1100', 'asset_receivable', 'receivable'),
  account('ap', '2000', 'liability_payable', 'payable'),
  account('card', '2050', 'liability_credit_card', 'credit_card'),
  account('capital', '3000', 'equity', 'capital'),
  account('sales', '4000', 'income', 'sales'),
  account('interest', '4500', 'income_other'),
  account('cogs', '5000', 'expense_direct_cost', 'cost_of_sales'),
  account('salaries', '6010', 'expense'),
  account('rent', '6100', 'expense'),
  account('fuel', '6200', 'expense'),
  account('phone', '6300', 'expense'),
  account('fees', '6400', 'expense'),
  account('travel', '6500', 'expense'),
  account('depreciation', '6900', 'expense_depreciation'),
];

let entrySeq = 0;
/** One balanced entry: [account, amount in dinars][]. */
function entry(date: string, parts: [string, number][]): LedgerLine[] {
  entrySeq += 1;
  return parts.map(([accountId, amount]) => ({
    date,
    accountId,
    amount: Math.round(amount * 1000),
    source: 'journal' as const,
    sourceId: `e${entrySeq}`,
    number: `E${entrySeq}`,
    contactId: null,
    description: '',
  }));
}

const LINES = [
  // Before the period: capital in.
  ...entry('2025-06-01', [
    ['bank', 10000],
    ['capital', -10000],
  ]),
  // Inside the last 12 months (Nov 2025 … 21 Oct 2026).
  ...entry('2025-11-03', [
    ['ar', 3000],
    ['sales', -3000],
  ]),
  ...entry('2025-12-20', [
    ['bank', 3000],
    ['ar', -3000],
  ]),
  ...entry('2026-01-31', [
    ['salaries', 1800],
    ['bank', -1800],
  ]),
  ...entry('2026-02-10', [
    ['rent', 600],
    ['ap', -600],
  ]),
  ...entry('2026-03-01', [
    ['ap', 600],
    ['bank', -600],
  ]),
  // A transfer from the bank to petty cash: neither in nor out.
  ...entry('2026-04-04', [
    ['petty', 200],
    ['bank', -200],
  ]),
  // Fuel on the company card.
  ...entry('2026-05-05', [
    ['fuel', 75.5],
    ['card', -75.5],
  ]),
  ...entry('2026-06-30', [
    ['cogs', 400],
    ['bank', -400],
  ]),
  ...entry('2026-07-15', [
    ['phone', 30],
    ['fees', 12.25],
    ['travel', 250],
    ['petty', -42.25],
    ['bank', -250],
  ]),
  ...entry('2026-08-31', [
    ['depreciation', 50],
    ['capital', -50],
  ]),
  ...entry('2026-09-30', [
    ['bank', 1.75],
    ['interest', -1.75],
  ]),
  ...entry('2026-10-10', [
    ['bank', 5000],
    ['sales', -5000],
  ]),
];

const LEDGER = { lines: LINES, accounts: ACCOUNTS };
const minor = (major: number) => Math.round(major * 1000);

describe('the period', () => {
  it('is the last 12 months by default, to today', () => {
    const range = dashboardRange('last-12-months', NOW, DEC);
    expect([range.from, range.to]).toEqual(['2025-11-01', NOW]);
    expect(range.months.map((m) => m.key)).toEqual(monthKeys(12, NOW));
    expect(range.months.at(-1)).toEqual({ key: '2026-10', from: '2026-10-01', to: NOW });
  });

  it('follows a financial year that does not end in December', () => {
    const march = { month: 3, day: 31 };
    const now = dashboardRange('this-year', NOW, march);
    expect([now.from, now.to]).toEqual(['2026-04-01', NOW]);
    expect(now.months).toHaveLength(7);
    const last = dashboardRange('last-year', NOW, march);
    expect([last.from, last.to]).toEqual(['2025-04-01', '2026-03-31']);
    expect(last.months.map((m) => m.key)).toEqual([
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    // A year ending mid-month cuts its first and last months.
    const mid = dashboardRange('last-year', NOW, { month: 6, day: 15 });
    expect([mid.from, mid.to]).toEqual(['2025-06-16', '2026-06-15']);
    expect(mid.months[0]).toEqual({ key: '2025-06', from: '2025-06-16', to: '2025-06-30' });
    expect(mid.months.at(-1)).toEqual({ key: '2026-06', from: '2026-06-01', to: '2026-06-15' });
    expect(mid.months).toHaveLength(13);
  });

  it('covers six months', () => {
    const range = dashboardRange('last-6-months', '2026-02-10', DEC);
    expect(range.from).toBe('2025-09-01');
    expect(range.months.map((m) => m.key)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('cash flow by month', () => {
  const special = specialAccounts(ACCOUNTS, 'kw');

  it('closes each month at the next month’s opening and ends at the cash in the bank', () => {
    const range = dashboardRange('last-12-months', NOW, DEC);
    const flow = monthlyCashFlow(LEDGER, range, P);
    for (let i = 1; i < flow.months.length; i++) {
      expect(flow.months[i].opening).toBe(flow.months[i - 1].closing);
    }
    expect(flow.months[0].opening).toBe(flow.opening);
    expect(flow.months.at(-1)!.closing).toBe(flow.closing);
    // The cash tile and the statement of cash flows agree with it.
    expect(minor(flow.closing)).toBe(cashAccounts(LEDGER).total);
    const statement = cashFlow(LINES, ACCOUNTS, range, special, new Map());
    expect(flow.opening).toBe(fromMinor(statement.opening, P));
    expect(flow.closing).toBe(fromMinor(statement.closing, P));
    expect(minor(flow.incoming - flow.outgoing)).toBe(statement.netChange);
    expect(flow.closing).toBe(14_909.5);
  });

  it('counts a transfer between bank and cash as neither in nor out', () => {
    const range = dashboardRange('last-12-months', NOW, DEC);
    const april = monthlyCashFlow(LEDGER, range, P).months.find((m) => m.key === '2026-04')!;
    expect(april).toMatchObject({ incoming: 0, outgoing: 0 });
    const july = monthlyCashFlow(LEDGER, range, P).months.find((m) => m.key === '2026-07')!;
    expect(july).toMatchObject({ incoming: 0, outgoing: 292.25 });
  });

  it('ties for a year ending in March too', () => {
    const range = dashboardRange('last-year', NOW, { month: 3, day: 31 });
    const flow = monthlyCashFlow(LEDGER, range, P);
    const statement = cashFlow(LINES, ACCOUNTS, range, special, new Map());
    expect(flow.opening).toBe(fromMinor(statement.opening, P));
    expect(flow.closing).toBe(fromMinor(statement.closing, P));
    // The capital came in during that year.
    expect(flow.opening).toBe(0);
    expect(flow.closing).toBe(10_600);
  });
});

describe('income and expense by month', () => {
  it('match the profit and loss of each month and of the period', () => {
    for (const range of [
      dashboardRange('last-12-months', NOW, DEC),
      dashboardRange('last-year', NOW, { month: 3, day: 31 }),
      dashboardRange('last-year', NOW, { month: 6, day: 15 }),
    ]) {
      const result = incomeExpenseByMonth(LEDGER, range, P);
      range.months.forEach((span, i) => {
        const pl = profitAndLoss(LINES, ACCOUNTS, span);
        const income = pl.income.total + pl.otherIncome.total;
        const expense =
          pl.costOfSales.total + pl.expenses.total + pl.depreciation.total + pl.otherExpenses.total;
        expect(minor(result.months[i].income)).toBe(income);
        expect(minor(result.months[i].expense)).toBe(expense);
        expect(minor(result.months[i].profit)).toBe(pl.netProfit);
      });
      expect(minor(result.profit)).toBe(profitAndLoss(LINES, ACCOUNTS, range).netProfit);
    }
  });

  it('are on the accrual basis: a sale counts when invoiced, not when paid', () => {
    const range = dashboardRange('last-12-months', NOW, DEC);
    const months = incomeExpenseByMonth(LEDGER, range, P).months;
    expect(months.find((m) => m.key === '2025-11')!.income).toBe(3000);
    expect(months.find((m) => m.key === '2025-12')!.income).toBe(0);
  });
});

describe('top expenses', () => {
  const range = dashboardRange('last-12-months', NOW, DEC);

  it('list the accounts with the most spent, and the rest together', () => {
    const top = topExpenses(LEDGER, range, P);
    expect(top.rows.map((r) => [r.account.id, r.amount])).toEqual([
      ['salaries', 1800],
      ['rent', 600],
      ['cogs', 400],
      ['travel', 250],
      ['fuel', 75.5],
    ]);
    expect(top.other).toBe(92.25);
    expect(top.otherCount).toBe(3);
    expect(top.total).toBe(3217.75);
  });

  it('leave out what is outside the period', () => {
    const top = topExpenses(LEDGER, dashboardRange('last-6-months', NOW, DEC), P, 2);
    expect(top.rows.map((r) => r.account.id)).toEqual(['cogs', 'travel']);
  });
});

describe('bank and card accounts', () => {
  it('show what each holds, and what is owed on the card', () => {
    const { rows, cash, owed } = moneyAccountRows(LEDGER, P);
    expect(rows.map((r) => [r.account.id, r.kind, r.balance])).toEqual([
      ['bank', 'bank', 14_751.75],
      ['petty', 'bank', 157.75],
      ['card', 'card', 75.5],
    ]);
    // Spending on the card is a credit on the liability: it shows as owed, positive.
    expect(owed).toBe(75.5);
    expect(minor(cash)).toBe(cashAccounts(LEDGER).total);
  });

  it('leave out archived accounts', () => {
    const accounts = ACCOUNTS.map((a) => (a.id === 'petty' ? { ...a, archived: true } : a));
    const { rows } = moneyAccountRows({ lines: LINES, accounts }, P);
    expect(rows.map((r) => r.account.id)).toEqual(['bank', 'card']);
  });
});

describe('the watchlist', () => {
  const range = dashboardRange('last-6-months', NOW, DEC);

  it('shows balances at the end of the period and totals of income and expense accounts', () => {
    const rows = watchlistRows(LEDGER, ['card', 'missing', 'sales', 'capital', 'travel'], range, P);
    expect(rows.map((r) => [r.account.id, r.kind, r.amount])).toEqual([
      ['card', 'balance', 75.5],
      ['sales', 'period', 5000],
      ['capital', 'balance', 10_050],
      ['travel', 'period', 250],
    ]);
  });

  it(`holds up to ${WATCHLIST_SIZE} accounts`, () => {
    const ids = ACCOUNTS.map((a) => a.id);
    expect(watchlistRows(LEDGER, ids, range, P)).toHaveLength(WATCHLIST_SIZE);
  });
});

describe('payables', () => {
  it('match the aging report of bills, with what is current and overdue', () => {
    const summary = payablesSummary(DOCS, CLIENTS, 'KWD', NOW, P);
    const report = agingReport(DOCS, CLIENTS, 'KWD', NOW, 'bill');
    expect(summary.aging).toEqual(report);
    expect(summary.aging.total).toBe(490);
    expect(summary.current).toBe(340);
    expect(summary.overdue).toBe(150);
    expect(summary.otherCurrencies).toEqual([]);
  });

  it('receivables split the same way, other currencies apart', () => {
    const summary = agingSummary(DOCS, CLIENTS, 'KWD', NOW, 'invoice', P);
    expect(summary.aging).toEqual(agingReport(DOCS, CLIENTS, 'KWD', NOW));
    expect([summary.current, summary.overdue]).toEqual([500, 1500]);
    expect(summary.otherCurrencies).toEqual([['USD', 100]]);
  });
});

describe('who sees which card', () => {
  it('shows staff and viewers no card that could show salaries', () => {
    expect(overviewCards(true)).toEqual(['receivables', 'payables', 'cash-flow', 'bank-accounts']);
    expect(overviewCards(false)).toHaveLength(7);
    expect(overviewCards(false, ['watchlist', 'payables'])).not.toContain('watchlist');
  });

  it('never works out salary accounts for staff and viewers', () => {
    const range = dashboardRange('last-12-months', NOW, DEC);
    const cards = overviewCards(true);
    const seen = ledgerFigures(LEDGER, range, cards, ['salaries', 'rent'], P);
    expect(seen.incomeExpense).toBeNull();
    expect(seen.topExpenses).toBeNull();
    expect(seen.watchlist).toBeNull();
    expect(JSON.stringify(seen)).not.toContain('salaries');
    // Owners, admins and accountants do see it.
    const all = ledgerFigures(LEDGER, range, overviewCards(false), ['salaries'], P);
    expect(JSON.stringify(all)).toContain('salaries');
  });
});

describe('what each person chose', () => {
  it('starts at the defaults', () => {
    for (const raw of [null, '', 'not json', '[]', '{"period":"next-century"}']) {
      expect(readDashboardPrefs(raw)).toEqual({
        period: 'last-12-months',
        watchlist: [],
        hidden: [],
      });
    }
  });

  it('keeps what it can read', () => {
    const raw = JSON.stringify({
      period: 'last-year',
      watchlist: ['a', 'a', 3, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      hidden: ['payables', 'a-newer-card', 'payables'],
    });
    expect(readDashboardPrefs(raw)).toEqual({
      period: 'last-year',
      watchlist: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      hidden: ['payables'],
    });
  });
});
