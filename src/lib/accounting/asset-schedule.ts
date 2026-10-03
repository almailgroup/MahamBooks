import type { Account, DepreciationRun, FixedAsset, ID, ISODate } from '@/db/types';
import { toMinor } from '@/lib/money';
import { addDaysISO } from '@/lib/dates';
import type { DateRange } from './statements';

/**
 * Fixed asset schedule (the property and equipment note): cost and
 * accumulated depreciation at the start of a period, what was added, charged
 * and disposed of, and both at the end, per asset and per asset account.
 * Built from the register and the depreciation actually posted.
 */

export interface AssetScheduleFigures {
  /** Minor units. */
  costOpening: number;
  additions: number;
  disposals: number;
  costClosing: number;
  depreciationOpening: number;
  charge: number;
  depreciationOnDisposals: number;
  depreciationClosing: number;
  bookValueOpening: number;
  bookValueClosing: number;
}

export interface AssetScheduleRow extends AssetScheduleFigures {
  asset: FixedAsset;
}

export interface AssetScheduleGroup {
  /** The asset account (category), when it still exists. */
  account: Account | null;
  accountId: ID;
  rows: AssetScheduleRow[];
  totals: AssetScheduleFigures;
}

const empty = (): AssetScheduleFigures => ({
  costOpening: 0,
  additions: 0,
  disposals: 0,
  costClosing: 0,
  depreciationOpening: 0,
  charge: 0,
  depreciationOnDisposals: 0,
  depreciationClosing: 0,
  bookValueOpening: 0,
  bookValueClosing: 0,
});

function add(into: AssetScheduleFigures, from: AssetScheduleFigures) {
  for (const key of Object.keys(into) as (keyof AssetScheduleFigures)[]) into[key] += from[key];
}

/** Depreciation of an asset in the books at the end of `date` (minor units). */
function depreciationAt(
  asset: FixedAsset,
  runs: DepreciationRun[],
  date: ISODate,
  precision: number,
): number {
  let total = 0;
  const openingDate = asset.openingDepreciationDate ?? asset.purchaseDate;
  if (asset.openingDepreciation > 0 && openingDate <= date) {
    total += toMinor(asset.openingDepreciation, precision);
  }
  for (const run of runs) {
    if (run.reversedAt || run.date > date) continue;
    for (const line of run.lines) {
      if (line.assetId === asset.id) total += toMinor(line.amount, precision);
    }
  }
  if (asset.disposal && asset.disposal.date <= date) {
    total += toMinor(asset.disposal.depreciation, precision);
  }
  return total;
}

export function assetScheduleRow(
  asset: FixedAsset,
  runs: DepreciationRun[],
  range: DateRange,
  precision: number,
): AssetScheduleRow {
  const cost = toMinor(asset.cost, precision);
  const bought = asset.purchaseDate;
  const disposedOn = asset.disposal?.date ?? null;
  const inBooksAt = (date: ISODate) => bought <= date && !(disposedOn && disposedOn <= date);
  // The day before the period starts.
  const startDay = addDaysISO(range.from, -1);
  const costOpening = inBooksAt(startDay) ? cost : 0;
  const additions = bought >= range.from && bought <= range.to ? cost : 0;
  const disposedInPeriod =
    disposedOn !== null && disposedOn >= range.from && disposedOn <= range.to;
  const disposals = disposedInPeriod ? cost : 0;
  const depreciationOpening = inBooksAt(startDay)
    ? depreciationAt(asset, runs, startDay, precision)
    : 0;
  const depreciationOnDisposals = disposedInPeriod
    ? depreciationAt(asset, runs, disposedOn, precision)
    : 0;
  const depreciationClosing = inBooksAt(range.to)
    ? depreciationAt(asset, runs, range.to, precision)
    : 0;
  const charge = depreciationClosing + depreciationOnDisposals - depreciationOpening;
  const costClosing = costOpening + additions - disposals;
  return {
    asset,
    costOpening,
    additions,
    disposals,
    costClosing,
    depreciationOpening,
    charge,
    depreciationOnDisposals,
    depreciationClosing,
    bookValueOpening: costOpening - depreciationOpening,
    bookValueClosing: costClosing - depreciationClosing,
  };
}

/** The schedule for a period, grouped by asset account; void assets are left out. */
export function assetSchedule(
  assets: FixedAsset[],
  runs: DepreciationRun[],
  accounts: Account[],
  range: DateRange,
  precision: number,
): { groups: AssetScheduleGroup[]; totals: AssetScheduleFigures } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<ID, AssetScheduleGroup>();
  const totals = empty();
  for (const asset of assets) {
    if (asset.status === 'void') continue;
    const row = assetScheduleRow(asset, runs, range, precision);
    const touched =
      row.costOpening || row.additions || row.disposals || row.charge || row.depreciationOpening;
    if (!touched) continue;
    const group = groups.get(asset.assetAccountId) ?? {
      account: byId.get(asset.assetAccountId) ?? null,
      accountId: asset.assetAccountId,
      rows: [],
      totals: empty(),
    };
    group.rows.push(row);
    add(group.totals, row);
    add(totals, row);
    groups.set(asset.assetAccountId, group);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    (a.account?.code ?? '').localeCompare(b.account?.code ?? '', undefined, { numeric: true }),
  );
  for (const g of sorted) {
    g.rows.sort((a, b) =>
      a.asset.number.localeCompare(b.asset.number, undefined, { numeric: true }),
    );
  }
  return { groups: sorted, totals };
}
