import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type {
  Account,
  AssetSource,
  AssetStatus,
  ChartTemplateId,
  DepreciationMethod,
  DepreciationRun,
  FixedAsset,
  ID,
} from '@/db/types';
import { useCompany } from '@/app/company';
import { findSpecAccount } from '@/lib/accounting/charts';
import { accountGroup } from '@/lib/accounting/account-types';
import { msg, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Badge } from '@/components/ui/misc';
import { UNKNOWN_STATUS, type StatusTone } from '@/lib/status';
import { lookup } from '@/lib/known';

/** The register, the depreciation runs and the chart of accounts, kept up to date. */
export function useAssetData():
  { assets: FixedAsset[]; runs: DepreciationRun[]; accounts: Account[] } | undefined {
  const company = useCompany();
  const assets = useLiveQuery(
    () => db.assets.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const runs = useLiveQuery(
    () => db.depreciationRuns.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const accounts = useLiveQuery(
    () => db.accounts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  return assets && runs && accounts ? { assets, runs, accounts } : undefined;
}

export const byCode = (a: Account, b: Account) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** "1520 Office equipment and computers", with the Arabic name in the Arabic interface. */
export function accountLabel(account: Account | undefined | null): string {
  return account ? `${account.code} ${localName(account)}` : '—';
}

const ACCUMULATED = /accumulated|depreciation|amorti[sz]ation/i;
const isAccumulated = (a: Account) =>
  ACCUMULATED.test(a.name) || Boolean(a.nameAr?.includes('مجمع'));
const isAssetAccount = (a: Account) => a.type === 'asset_fixed' || a.type === 'asset_non_current';

/** Accounts an asset can be kept in: fixed and non-current assets that hold cost. */
export function categoryAccounts(accounts: Account[], keep?: ID | null): Account[] {
  return accounts
    .filter((a) => (isAssetAccount(a) && !isAccumulated(a) && !a.archived) || a.id === keep)
    .sort(byCode);
}

/** Accounts for accumulated depreciation: asset accounts, the usual ones first. */
export function accumulatedAccounts(accounts: Account[], keep?: ID | null): Account[] {
  return accounts
    .filter((a) => (isAssetAccount(a) && !a.archived) || a.id === keep)
    .sort((a, b) => Number(isAccumulated(b)) - Number(isAccumulated(a)) || byCode(a, b));
}

/** Accounts depreciation can be charged to. */
export function expenseAccounts(accounts: Account[], keep?: ID | null): Account[] {
  return accounts
    .filter((a) => (accountGroup(a.type) === 'expense' && !a.archived) || a.id === keep)
    .sort(
      (a, b) =>
        Number(b.type === 'expense_depreciation') - Number(a.type === 'expense_depreciation') ||
        byCode(a, b),
    );
}

/**
 * The accumulated depreciation account that goes with an asset account:
 * the nearest "accumulated depreciation" account coded after it
 * (1520 → 1530 in the Kuwait chart, 0030 → 0031 in the UK one).
 */
export function suggestAccumulated(accounts: Account[], categoryId: ID): Account | undefined {
  const category = accounts.find((a) => a.id === categoryId);
  if (!category) return undefined;
  const candidates = accounts.filter((a) => isAssetAccount(a) && isAccumulated(a) && !a.archived);
  const code = Number(category.code);
  const after = candidates
    .filter((a) => Number.isFinite(code) && Number(a.code) > code)
    .sort((a, b) => Number(a.code) - Number(b.code));
  const near = after.find((a) => Number(a.code) - code <= 20);
  return near ?? candidates.find((a) => a.type === category.type) ?? candidates[0];
}

export function suggestExpense(accounts: Account[], template: ChartTemplateId) {
  return (
    findSpecAccount(accounts, 'depreciation', template) ??
    accounts.find((a) => a.type === 'expense_depreciation' && !a.archived)
  );
}

export const METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: msg('Straight line'),
  declining_balance: msg('Declining balance'),
};

export const SOURCE_LABELS: Record<AssetSource, { label: string; hint: string }> = {
  purchase: {
    label: msg('Paid for now'),
    hint: msg('Records the purchase, paid from a bank, cash or card account.'),
  },
  bill: {
    label: msg('From a bill'),
    hint: msg('The bill already recorded the cost; the asset is linked to its line.'),
  },
  opening: {
    label: msg('Owned before'),
    hint: msg('Bought before you used Maham Books: records its cost and the depreciation so far.'),
  },
  existing: {
    label: msg('Already in the books'),
    hint: msg(
      'The cost is already in the accounts, for example from a journal. Nothing is posted.',
    ),
  },
};

const STATUS: Record<AssetStatus, { label: string; tone: StatusTone }> = {
  active: { label: msg('In use'), tone: 'green' },
  disposed: { label: msg('Disposed of'), tone: 'slate' },
  void: { label: msg('Void'), tone: 'gray' },
};

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const meta = lookup(STATUS, status, UNKNOWN_STATUS);
  return <Badge tone={meta.tone}>{t(meta.label)}</Badge>;
}

/** "5 years", "2 years and 6 months", "18 months". */
export function lifeText(months: number): string {
  if (!(months > 0)) return '—';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return tp(rest, '{count} month', '{count} months');
  if (rest === 0) return tp(years, '{count} year', '{count} years');
  return t('{years} and {months}', {
    years: tp(years, '{count} year', '{count} years'),
    months: tp(rest, '{count} month', '{count} months'),
  });
}
