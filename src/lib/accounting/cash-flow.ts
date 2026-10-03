import type { Account, AccountType, ID, JournalKind } from '@/db/types';
import { msg } from '@/i18n';
import { isProfitAndLoss } from './account-types';
import type { LedgerLine } from './ledger';
import type { DateRange, SpecialAccounts } from './statements';

/**
 * Statement of cash flows, indirect method (IAS 7). It starts from the
 * profit, adds back what moved no cash (depreciation, gains and losses on
 * disposals, provisions), then the change in working capital; investing is
 * fixed and other non-current assets; financing is capital, partners' accounts
 * and loans. Every balance sheet movement lands in exactly one line, so the
 * total always equals the change in cash and bank balances.
 */

export interface CashFlowLine {
  key: string;
  /** English text, translated where it is shown. */
  label: string;
  /** Minor units: positive is cash in, negative cash out. */
  amount: number;
}

export interface CashFlow {
  range: DateRange;
  profit: number;
  adjustments: CashFlowLine[];
  workingCapital: CashFlowLine[];
  operating: number;
  investing: CashFlowLine[];
  investingTotal: number;
  financing: CashFlowLine[];
  financingTotal: number;
  netChange: number;
  /** Cash and bank balances at the start and the end of the period. */
  opening: number;
  closing: number;
  /** Total of the statement less the change in cash; 0 when it ties. */
  difference: number;
}

type Bucket =
  | 'cash'
  | 'receivables'
  | 'other-current-assets'
  | 'prepayments'
  | 'payables'
  | 'other-current-liabilities'
  | 'end-of-service'
  | 'fixed'
  | 'loans'
  | 'capital'
  | 'partners'
  | 'opening'
  | 'other-equity';

function bucketOf(account: Account, special: SpecialAccounts): Bucket | null {
  const type: AccountType = account.type;
  switch (type) {
    case 'asset_cash':
      return 'cash';
    case 'asset_receivable':
      return 'receivables';
    case 'asset_current':
      return 'other-current-assets';
    case 'asset_prepayments':
      return 'prepayments';
    case 'asset_fixed':
    case 'asset_non_current':
      return 'fixed';
    case 'liability_payable':
      return 'payables';
    case 'liability_current':
    case 'liability_credit_card':
      return 'other-current-liabilities';
    case 'liability_non_current':
      return special.endOfService.has(account.id) ? 'end-of-service' : 'loans';
    case 'equity':
      if (account.role === 'capital') return 'capital';
      if (account.role === 'drawings') return 'partners';
      if (account.role === 'opening_balance') return 'opening';
      return 'other-equity';
    default:
      return null;
  }
}

const LABELS: Record<Exclude<Bucket, 'cash' | 'fixed'>, string> = {
  receivables: msg('(Increase) decrease in trade receivables'),
  'other-current-assets': msg('(Increase) decrease in inventories and other current assets'),
  prepayments: msg('(Increase) decrease in prepayments'),
  payables: msg('Increase (decrease) in trade payables'),
  'other-current-liabilities': msg('Increase (decrease) in accruals and other liabilities'),
  'end-of-service': msg('Provision for end-of-service indemnity, net of payments'),
  loans: msg('Loans and other non-current liabilities'),
  capital: msg('Capital introduced or withdrawn'),
  partners: msg('Partners’ drawings and contributions'),
  opening: msg('Opening balances entered'),
  'other-equity': msg('Dividends and other equity movements'),
};

/**
 * Builds the statement for a period. `kinds` gives the kind of each
 * system journal, to recognise depreciation runs and disposals.
 */
export function cashFlow(
  lines: LedgerLine[],
  accounts: Account[],
  range: DateRange,
  special: SpecialAccounts,
  kinds: Map<ID, JournalKind | undefined>,
): CashFlow {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const kindOf = (l: LedgerLine) => (l.source === 'journal' ? kinds.get(l.sourceId) : undefined);
  const inRange = lines.filter((l) => l.date >= range.from && l.date <= range.to);

  // Opening balances that move no cash (an asset bought earlier, what clients
  // owed when the books started) are left out entirely; they net to zero.
  const entries = new Map<string, { opening: boolean; cash: boolean; profit: boolean }>();
  for (const l of inRange) {
    const account = byId.get(l.accountId);
    const entry = entries.get(l.sourceId) ?? { opening: false, cash: false, profit: false };
    if (kindOf(l) === 'asset_opening' || account?.role === 'opening_balance') entry.opening = true;
    if (account?.type === 'asset_cash') entry.cash = true;
    if (account && isProfitAndLoss(account.type)) entry.profit = true;
    entries.set(l.sourceId, entry);
  }
  const nonCash = new Set(
    [...entries].filter(([, e]) => e.opening && !e.cash && !e.profit).map(([id]) => id),
  );

  const moves = new Map<Bucket, number>();
  let profit = 0;
  let depreciation = 0;
  let disposals = 0;
  let purchases = 0;
  let netChange = 0;
  for (const l of inRange) {
    if (nonCash.has(l.sourceId)) continue;
    const account = byId.get(l.accountId);
    if (!account) continue;
    if (isProfitAndLoss(account.type)) {
      profit -= l.amount;
      if (account.type === 'expense_depreciation') depreciation += l.amount;
      else if (kindOf(l) === 'asset_disposal') disposals += l.amount;
      continue;
    }
    const bucket = bucketOf(account, special);
    if (!bucket) continue;
    if (bucket === 'cash') {
      netChange += l.amount;
      continue;
    }
    // A balance going up on the debit side uses cash.
    moves.set(bucket, (moves.get(bucket) ?? 0) - l.amount);
    if (bucket === 'fixed') {
      const kind = kindOf(l);
      if (kind !== 'depreciation' && kind !== 'asset_disposal') purchases -= l.amount;
    }
  }
  const move = (bucket: Bucket) => moves.get(bucket) ?? 0;
  const line = (key: Exclude<Bucket, 'cash' | 'fixed'>): CashFlowLine => ({
    key,
    label: LABELS[key],
    amount: move(key),
  });

  const adjustments: CashFlowLine[] = [
    { key: 'depreciation', label: msg('Depreciation and amortisation'), amount: depreciation },
    {
      key: 'disposals',
      label: msg('(Gain) loss on disposal of property and equipment'),
      amount: disposals,
    },
    line('end-of-service'),
  ];
  const workingCapital = (
    [
      'receivables',
      'other-current-assets',
      'prepayments',
      'payables',
      'other-current-liabilities',
    ] as const
  ).map(line);
  const operating =
    profit +
    adjustments.reduce((s, x) => s + x.amount, 0) +
    workingCapital.reduce((s, x) => s + x.amount, 0);

  // Everything that moved the fixed asset accounts, less what was depreciation or
  // the gain or loss on a sale: purchases, and what sales brought in.
  const investingTotal = move('fixed') - depreciation - disposals;
  const investing: CashFlowLine[] = [
    { key: 'purchases', label: msg('Purchase of property and equipment'), amount: purchases },
    {
      key: 'proceeds',
      label: msg('Proceeds from disposal of property and equipment'),
      amount: investingTotal - purchases,
    },
  ];
  const financing = (['capital', 'partners', 'loans', 'opening', 'other-equity'] as const).map(
    line,
  );
  const financingTotal = financing.reduce((s, x) => s + x.amount, 0);

  const cash = (include: (date: string) => boolean) =>
    lines.reduce((s, l) => {
      const account = byId.get(l.accountId);
      return account?.type === 'asset_cash' && include(l.date) ? s + l.amount : s;
    }, 0);
  const opening = cash((d) => d < range.from);
  const closing = cash((d) => d <= range.to);
  return {
    range,
    profit,
    adjustments,
    workingCapital,
    operating,
    investing,
    investingTotal,
    financing,
    financingTotal,
    netChange: closing - opening,
    opening,
    closing,
    difference: operating + investingTotal + financingTotal - netChange,
  };
}
