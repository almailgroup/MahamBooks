import { describe, expect, it } from 'vitest';
import type { Account, AccountRole, AccountType, JournalKind } from '@/db/types';
import type { LedgerLine } from './ledger';
import {
  changesInEquity,
  comparativeDate,
  equityTotal,
  financialPosition,
  previousYearRange,
  profitOrLoss,
  specialAccounts,
} from './statements';
import { cashFlow } from './cash-flow';
import { assetSchedule } from './asset-schedule';
import { createAsset } from '@/db/assets';

const account = (
  id: string,
  code: string,
  type: AccountType,
  role: AccountRole | null = null,
  name = id,
): Account => ({
  id,
  companyId: 'co',
  code,
  name,
  type,
  description: '',
  role,
  bank: null,
  archived: false,
  createdAt: '',
  updatedAt: '',
});

// A small Kuwaiti chart (codes as in the Kuwait template).
const ACCOUNTS = [
  account('bank', '1000', 'asset_cash', 'bank'),
  account('ar', '1100', 'asset_receivable', 'receivable'),
  account('stock', '1200', 'asset_current'),
  account('equipment', '1520', 'asset_fixed'),
  account('accdep', '1530', 'asset_fixed'),
  account('ap', '2000', 'liability_payable', 'payable'),
  account('accruals', '2200', 'liability_current'),
  account('kfas-payable', '2500', 'liability_current', null, 'KFAS payable'),
  account('eosi', '2700', 'liability_non_current', null, 'End-of-service indemnity provision'),
  account('loan', '2800', 'liability_non_current'),
  account('capital', '3000', 'equity', 'capital'),
  account('partners', '3100', 'equity', 'drawings'),
  account('reserve', '3200', 'equity', null, 'Statutory reserve'),
  account('retained', '3300', 'equity', 'retained_earnings'),
  account('opening', '3900', 'equity', 'opening_balance'),
  account('sales', '4000', 'income', 'sales'),
  account('other-income', '4500', 'income_other'),
  account('disposal', '4520', 'income_other', null, 'Gain or loss on disposal of assets'),
  account('cogs', '5000', 'expense_direct_cost', 'cost_of_sales'),
  account('salaries', '6010', 'expense'),
  account('eosi-expense', '6040', 'expense'),
  account('depreciation', '6900', 'expense_depreciation'),
  account('finance', '7100', 'expense_other', null, 'Finance costs'),
  account('kfas', '7200', 'expense_other', null, 'KFAS contribution'),
];
const SPECIAL = specialAccounts(ACCOUNTS, 'kw');
const DEC = { month: 12, day: 31 };
const kinds = new Map<string, JournalKind | undefined>();

let seq = 0;
/** One balanced entry: [account, amount in KWD][], debit positive. */
function entry(date: string, parts: [string, number][], kind?: JournalKind): LedgerLine[] {
  seq += 1;
  const id = `e${seq}`;
  kinds.set(id, kind);
  const lines = parts.map(([accountId, amount]) => ({
    date,
    accountId,
    amount: Math.round(amount * 1000),
    source: 'journal' as const,
    sourceId: id,
    number: `JE-${seq}`,
    contactId: null,
    description: '',
  }));
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  return lines;
}

// 2025: the partners put in KD 10,000, a loan, equipment bought, a year of trading.
const Y2025 = [
  ...entry('2025-01-01', [
    ['bank', 10000],
    ['capital', -10000],
  ]),
  ...entry('2025-01-10', [
    ['bank', 5000],
    ['loan', -5000],
  ]),
  ...entry('2025-02-01', [
    ['equipment', 6000],
    ['bank', -6000],
  ]),
  ...entry('2025-06-30', [
    ['ar', 20000],
    ['sales', -20000],
  ]),
  ...entry('2025-07-31', [
    ['bank', 15000],
    ['ar', -15000],
  ]),
  ...entry('2025-08-31', [
    ['cogs', 8000],
    ['ap', -8000],
  ]),
  ...entry('2025-09-30', [
    ['ap', 6000],
    ['bank', -6000],
  ]),
  ...entry('2025-12-31', [
    ['salaries', 3000],
    ['bank', -3000],
  ]),
  ...entry(
    '2025-12-31',
    [
      ['depreciation', 1100],
      ['accdep', -1100],
    ],
    'depreciation',
  ),
  ...entry('2025-12-31', [
    ['eosi-expense', 400],
    ['eosi', -400],
  ]),
  ...entry('2025-12-31', [
    ['finance', 250],
    ['bank', -250],
  ]),
  ...entry(
    '2025-12-31',
    [
      ['kfas', 72.5],
      ['kfas-payable', -72.5],
    ],
    'year_end',
  ),
  ...entry(
    '2025-12-31',
    [
      ['retained', 725],
      ['reserve', -725],
    ],
    'year_end',
  ),
];

// 2026: more trading, stock, a partner's drawing, the equipment sold at a gain.
const Y2026 = [
  ...entry('2026-03-31', [
    ['ar', 30000],
    ['sales', -30000],
  ]),
  ...entry('2026-04-30', [
    ['bank', 26000],
    ['ar', -26000],
  ]),
  ...entry('2026-05-01', [
    ['stock', 2500],
    ['ap', -2500],
  ]),
  ...entry('2026-05-31', [
    ['cogs', 12000],
    ['bank', -12000],
  ]),
  ...entry('2026-06-30', [
    ['partners', 1500],
    ['bank', -1500],
  ]),
  ...entry('2026-06-30', [
    ['loan', 1000],
    ['finance', 180],
    ['bank', -1180],
  ]),
  ...entry('2026-07-01', [
    ['other-income', -90],
    ['bank', 90],
  ]),
  ...entry(
    '2026-06-30',
    [
      ['depreciation', 500],
      ['accdep', -500],
    ],
    'depreciation',
  ),
  // Sold for 5,000: cost 6,000 less 1,600 depreciation = 4,400; gain 600.
  ...entry(
    '2026-09-30',
    [
      ['accdep', 1600],
      ['equipment', -6000],
      ['bank', 5000],
      ['disposal', -600],
    ],
    'asset_disposal',
  ),
  ...entry('2026-12-31', [
    ['eosi-expense', 300],
    ['eosi', -300],
  ]),
  ...entry('2026-12-31', [
    ['eosi', 200],
    ['bank', -200],
  ]),
  ...entry('2026-12-31', [
    ['accruals', 0.375],
    ['bank', -0.375],
  ]),
  ...entry('2026-12-31', [
    ['salaries', 4000],
    ['accruals', -4000],
  ]),
];
const LINES = [...Y2025, ...Y2026];
const Y25 = { from: '2025-01-01', to: '2025-12-31' };
const Y26 = { from: '2026-01-01', to: '2026-12-31' };

describe('special accounts', () => {
  it('finds reserves, levies, finance costs and the end-of-service provision', () => {
    expect(SPECIAL.statutoryReserve).toBe('reserve');
    expect([...SPECIAL.levies]).toEqual([['kfas', 'kfas']]);
    expect([...SPECIAL.financeCosts]).toEqual(['finance']);
    expect([...SPECIAL.endOfService]).toEqual(['eosi']);
  });
});

describe('statement of profit or loss', () => {
  it('splits costs by nature and shows levies after the profit before levies', () => {
    const pl = profitOrLoss(LINES, ACCOUNTS, Y25, SPECIAL);
    expect(pl.revenue.total).toBe(20_000_000);
    expect(pl.costOfSales.total).toBe(-8_000_000);
    expect(pl.grossProfit).toBe(12_000_000);
    expect(pl.administrative.total).toBe(-3_400_000);
    expect(pl.depreciation.total).toBe(-1_100_000);
    expect(pl.financeCosts.total).toBe(-250_000);
    expect(pl.otherExpenses.rows).toEqual([]);
    expect(pl.profitBeforeLevies).toBe(7_250_000);
    expect(pl.levies.total).toBe(-72_500);
    expect(pl.profit).toBe(7_177_500);
  });

  it('gives the comparative year', () => {
    expect(previousYearRange(Y26)).toEqual(Y25);
    expect(previousYearRange({ from: '2028-03-01', to: '2029-02-28' })).toEqual({
      from: '2027-03-01',
      to: '2028-02-29',
    });
    const current = profitOrLoss(LINES, ACCOUNTS, Y26, SPECIAL);
    const previous = profitOrLoss(LINES, ACCOUNTS, previousYearRange(Y26), SPECIAL);
    expect(current.profit).toBe(30_000_000 - 12_000_000 - 4_300_000 - 500_000 - 180_000 + 690_000);
    expect(current.otherIncome.total).toBe(690_000);
    expect(previous.profit).toBe(7_177_500);
  });
});

describe('statement of financial position', () => {
  it('balances, with the reserve and the profit in retained earnings', () => {
    const fp = financialPosition(LINES, ACCOUNTS, '2025-12-31', DEC, SPECIAL);
    expect(fp.difference).toBe(0);
    expect(fp.totalNonCurrentAssets).toBe(4_900_000);
    const equity = Object.fromEntries(fp.equity.map((c) => [c.key, c.total]));
    expect(equity).toMatchObject({
      capital: 10_000_000,
      statutory: 725_000,
      retained: 7_177_500 - 725_000,
    });
    expect(fp.nonCurrentLiabilities.map((c) => c.total)).toEqual([400_000, 5_000_000]);
  });

  it('compares with the end of the previous financial year', () => {
    expect(comparativeDate('2026-12-31', DEC)).toBe('2025-12-31');
    expect(comparativeDate('2026-06-30', DEC)).toBe('2025-12-31');
    const now = financialPosition(LINES, ACCOUNTS, '2026-12-31', DEC, SPECIAL);
    expect(now.difference).toBe(0);
    expect(now.totalNonCurrentAssets).toBe(0);
    const retained = now.equity.find((c) => c.key === 'retained')!;
    expect(retained.extras.map((e) => e.key)).toEqual(['earlier', 'current']);
  });
});

describe('statement of changes in equity', () => {
  it('moves from the opening to the closing balance of each component', () => {
    const yearEnd = new Set([...kinds].filter(([, k]) => k === 'year_end').map(([id]) => id));
    const soce = changesInEquity(LINES, ACCOUNTS, Y25, SPECIAL, yearEnd);
    expect(equityTotal(soce.opening)).toBe(0);
    const row = (key: string) => soce.movements.find((m) => m.key === key)!.values;
    expect(row('profit').retained).toBe(7_177_500);
    expect(row('statutory')).toMatchObject({ statutory: 725_000, retained: -725_000 });
    expect(row('capital').capital).toBe(10_000_000);
    expect(soce.closing).toMatchObject({ capital: 10_000_000, statutory: 725_000 });
    expect(soce.components).toEqual(['capital', 'statutory', 'retained']);
    const fp = financialPosition(LINES, ACCOUNTS, '2025-12-31', DEC, SPECIAL);
    expect(equityTotal(soce.closing)).toBe(fp.totalEquity);

    const next = changesInEquity(LINES, ACCOUNTS, Y26, SPECIAL, yearEnd);
    expect(next.opening).toEqual(soce.closing);
    expect(next.movements.find((m) => m.key === 'partners')!.values.partners).toBe(-1_500_000);
  });
});

describe('statement of cash flows', () => {
  it('ties to the movement in cash and bank balances', () => {
    for (const range of [Y25, Y26]) {
      const cf = cashFlow(LINES, ACCOUNTS, range, SPECIAL, kinds);
      expect(cf.difference).toBe(0);
      expect(cf.operating + cf.investingTotal + cf.financingTotal).toBe(cf.closing - cf.opening);
    }
  });

  it('adds back depreciation and provisions and shows purchases and financing', () => {
    const cf = cashFlow(LINES, ACCOUNTS, Y25, SPECIAL, kinds);
    const value = (list: { key: string; amount: number }[], key: string) =>
      list.find((l) => l.key === key)!.amount;
    expect(cf.profit).toBe(7_177_500);
    expect(value(cf.adjustments, 'depreciation')).toBe(1_100_000);
    expect(value(cf.adjustments, 'end-of-service')).toBe(400_000);
    expect(value(cf.workingCapital, 'receivables')).toBe(-5_000_000);
    expect(value(cf.workingCapital, 'payables')).toBe(2_000_000);
    expect(value(cf.workingCapital, 'other-current-liabilities')).toBe(72_500);
    expect(value(cf.investing, 'purchases')).toBe(-6_000_000);
    expect(value(cf.investing, 'proceeds')).toBe(0);
    expect(value(cf.financing, 'capital')).toBe(10_000_000);
    expect(value(cf.financing, 'loans')).toBe(5_000_000);
    expect(cf.opening).toBe(0);
    expect(cf.closing).toBe(14_750_000);
  });

  it('takes the gain on a sale out of operating and shows the money received', () => {
    const cf = cashFlow(LINES, ACCOUNTS, Y26, SPECIAL, kinds);
    const value = (list: { key: string; amount: number }[], key: string) =>
      list.find((l) => l.key === key)!.amount;
    expect(value(cf.adjustments, 'disposals')).toBe(-600_000);
    expect(value(cf.adjustments, 'end-of-service')).toBe(100_000);
    expect(value(cf.investing, 'proceeds')).toBe(5_000_000);
    expect(value(cf.investing, 'purchases')).toBe(0);
    expect(value(cf.financing, 'partners')).toBe(-1_500_000);
    expect(value(cf.financing, 'loans')).toBe(-1_000_000);
  });

  it('leaves out opening balances that moved no cash', () => {
    const opening = entry(
      '2026-01-01',
      [
        ['equipment', 3000],
        ['accdep', -1000],
        ['opening', -2000],
      ],
      'asset_opening',
    );
    const cf = cashFlow([...LINES, ...opening], ACCOUNTS, Y26, SPECIAL, kinds);
    expect(cf.difference).toBe(0);
    expect(cf.investing.find((l) => l.key === 'purchases')!.amount).toBe(0);
    expect(cf.financing.find((l) => l.key === 'opening')!.amount).toBe(0);
  });
});

describe('fixed asset schedule', () => {
  it('rolls cost and depreciation forward per account', () => {
    const asset = createAsset('co', {
      id: 'a1',
      number: 'FA-0001',
      name: 'Van',
      assetAccountId: 'equipment',
      accumulatedAccountId: 'accdep',
      expenseAccountId: 'depreciation',
      purchaseDate: '2025-02-01',
      cost: 6000,
      status: 'disposed',
      disposal: {
        date: '2026-09-30',
        proceeds: 5000,
        depositAccountId: 'bank',
        depreciation: 0,
        gain: 600,
        journalId: 'x',
        notes: '',
      },
    });
    const runs = [
      { date: '2025-12-31', amount: 1100 },
      { date: '2026-06-30', amount: 500 },
    ].map((r, i) => ({
      id: `r${i}`,
      companyId: 'co',
      period: r.date.slice(0, 7),
      date: r.date,
      journalId: `j${i}`,
      lines: [{ assetId: 'a1', amount: r.amount }],
      total: r.amount,
      reversalJournalId: null,
      reversedAt: null,
      createdAt: '',
      updatedAt: '',
    }));
    const y25 = assetSchedule([asset], runs, ACCOUNTS, Y25, 3);
    expect(y25.totals).toMatchObject({
      costOpening: 0,
      additions: 6_000_000,
      costClosing: 6_000_000,
      charge: 1_100_000,
      depreciationClosing: 1_100_000,
      bookValueClosing: 4_900_000,
    });
    const y26 = assetSchedule([asset], runs, ACCOUNTS, Y26, 3);
    expect(y26.groups[0].account?.id).toBe('equipment');
    expect(y26.totals).toMatchObject({
      costOpening: 6_000_000,
      disposals: 6_000_000,
      costClosing: 0,
      depreciationOpening: 1_100_000,
      charge: 500_000,
      depreciationOnDisposals: 1_600_000,
      depreciationClosing: 0,
      bookValueClosing: 0,
    });
    // The register agrees with the books at each year end.
    const fp = financialPosition(LINES, ACCOUNTS, '2025-12-31', DEC, SPECIAL);
    expect(fp.nonCurrentAssets[0].total).toBe(y25.totals.bookValueClosing);
  });
});
