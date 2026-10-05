import { db } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import {
  assertUnlocked,
  createJournal,
  ensureSpecAccount,
  newJournalLine,
  reverseJournal,
  roleMap,
  saveJournal,
} from './accounting';
import { accountingSettings } from './chart-setup';
import type {
  Account,
  Company,
  DepreciationRun,
  FixedAsset,
  ID,
  ISODate,
  InvoiceDocument,
  JournalLine,
  LineItem,
  ManualJournal,
} from './types';
import {
  accumulatedAt,
  periodEnd,
  periodOf,
  type DepreciationTerms,
} from '@/lib/accounting/depreciation';
import { accountGroup, isMoneyAccount } from '@/lib/accounting/account-types';
import { isPosted, rateOf } from '@/lib/accounting/ledger';
import { computeDocument } from '@/lib/document-calc';
import { isReverseCharge } from '@/lib/calc';
import { currencyPrecision, dec, fromMinor, round, toMinor } from '@/lib/money';
import { isISODate, today } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { newId } from '@/lib/ids';
import { interfaceLocale, msg, t } from '@/i18n';

/**
 * The fixed asset register. Assets post through system journals: buying one
 * (unless a bill already did), opening balances, monthly depreciation runs
 * and disposals. Nothing posted is ever deleted: runs, purchases and
 * disposals are undone with reversing entries.
 */

export class AssetError extends Error {}

export function createAsset(companyId: ID, overrides: Partial<FixedAsset> = {}): FixedAsset {
  const stamp = nowStamp();
  const date = today();
  return {
    id: newId(),
    companyId,
    number: '',
    name: '',
    description: '',
    assetAccountId: '',
    accumulatedAccountId: '',
    expenseAccountId: '',
    purchaseDate: date,
    depreciationStart: date,
    cost: 0,
    salvageValue: 0,
    usefulLifeMonths: 60,
    method: 'straight_line',
    decliningRate: null,
    openingDepreciation: 0,
    openingDepreciationDate: null,
    source: 'purchase',
    billId: null,
    billLineId: null,
    vendorId: null,
    paidFromAccountId: null,
    journalId: null,
    location: '',
    custodian: '',
    serialNumber: '',
    notes: '',
    status: 'active',
    disposal: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

/** The figures depreciation is worked out from. */
export function assetTerms(asset: FixedAsset): DepreciationTerms {
  return {
    cost: asset.cost,
    salvageValue: asset.salvageValue,
    usefulLifeMonths: asset.usefulLifeMonths,
    method: asset.method,
    decliningRate: asset.decliningRate,
    depreciationStart: asset.depreciationStart,
    openingDepreciation: asset.openingDepreciation,
    openingDepreciationDate: asset.openingDepreciationDate,
  };
}

/** Runs that were not undone. */
export const activeRuns = (runs: DepreciationRun[]) => runs.filter((r) => !r.reversedAt);

/**
 * Depreciation of an asset already in the books (minor units): what was
 * charged before it was entered, every run that wasn't undone, and the
 * depreciation up to its disposal.
 */
export function postedDepreciation(
  asset: FixedAsset,
  runs: DepreciationRun[],
  precision: number,
  upTo?: ISODate,
): number {
  let total = toMinor(asset.openingDepreciation, precision);
  for (const run of activeRuns(runs)) {
    if (upTo && run.date > upTo) continue;
    for (const line of run.lines) {
      if (line.assetId === asset.id) total += toMinor(line.amount, precision);
    }
  }
  if (asset.disposal && (!upTo || asset.disposal.date <= upTo)) {
    total += toMinor(asset.disposal.depreciation, precision);
  }
  return total;
}

/** Date of the last run that charged depreciation to the asset. */
export function lastDepreciationDate(asset: FixedAsset, runs: DepreciationRun[]): ISODate | null {
  let last: ISODate | null = null;
  for (const run of activeRuns(runs)) {
    if (run.lines.some((l) => l.assetId === asset.id && l.amount !== 0)) {
      if (!last || run.date > last) last = run.date;
    }
  }
  return last;
}

/** Book value (minor units) of an asset: cost less the depreciation in the books. */
export function bookValue(asset: FixedAsset, runs: DepreciationRun[], precision: number): number {
  if (asset.status === 'void') return 0;
  if (asset.status === 'disposed') return 0;
  return toMinor(asset.cost, precision) - postedDepreciation(asset, runs, precision);
}

/** Depreciation each asset still needs up to `date` (minor units), largest first by number. */
export function depreciationDue(
  assets: FixedAsset[],
  runs: DepreciationRun[],
  date: ISODate,
  precision: number,
): { asset: FixedAsset; amount: number }[] {
  return assets
    .filter((a) => a.status === 'active' && a.depreciationStart <= date)
    .map((asset) => ({
      asset,
      amount:
        accumulatedAt(assetTerms(asset), date, precision) -
        postedDepreciation(asset, runs, precision),
    }))
    .filter((l) => l.amount > 0)
    .sort((a, b) => a.asset.number.localeCompare(b.asset.number, undefined, { numeric: true }));
}

/** "March 2026" in the interface language. */
export function monthLabel(period: string, locale?: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat(interfaceLocale(locale), {
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, 1));
}

const assetLabel = (asset: Pick<FixedAsset, 'number' | 'name'>) =>
  `${asset.number} ${asset.name}`.trim();

async function companyOf(id: ID): Promise<Company> {
  const company = await db.companies.get(id);
  if (!company) throw new AssetError(t('Company not found'));
  return company;
}

/* -------------------------------------------------------------------------- */
/* Bills                                                                      */
/* -------------------------------------------------------------------------- */

export interface BillAssetLine {
  bill: InvoiceDocument;
  line: LineItem;
  /** Account the line was booked to (a fixed or non-current asset account). */
  accountId: ID;
  /** Line value without tax, after the bill's discount, in the company currency. */
  cost: number;
  /** Asset already made from this line. */
  assetId: ID | null;
}

/**
 * Lines of posted bills booked to fixed asset accounts: the purchases an
 * asset can be made from. The cost leaves out tax and shares the bill's
 * discount, like the books do.
 */
export function billAssetLines(
  company: Company,
  bills: InvoiceDocument[],
  accounts: Account[],
  assets: FixedAsset[],
): BillAssetLine[] {
  const p = currencyPrecision(company.currency);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const fallback = roleMap(accounts).expense ?? null;
  const linked = new Map(
    assets.filter((a) => a.status !== 'void' && a.billLineId).map((a) => [a.billLineId, a.id]),
  );
  const out: BillAssetLine[] = [];
  for (const bill of bills) {
    if (bill.type !== 'bill' || !isPosted(bill)) continue;
    const result = computeDocument(bill);
    const ratio =
      result.subtotal === 0
        ? dec(1)
        : dec(result.subtotal).minus(dec(result.discount)).dividedBy(dec(result.subtotal));
    const rate = rateOf(bill, { companyCurrency: company.currency });
    bill.items.forEach((line, i) => {
      if (line.kind === 'heading') return;
      const accountId = line.accountId && byId.has(line.accountId) ? line.accountId : fallback;
      const account = accountId ? byId.get(accountId) : undefined;
      if (!account || (account.type !== 'asset_fixed' && account.type !== 'asset_non_current')) {
        return;
      }
      let net = dec(result.lines[i]?.net ?? 0).times(ratio);
      const charged = [...line.taxes, ...bill.taxes].filter((tx) => !isReverseCharge(tx));
      if (bill.pricesIncludeTax && charged.length) {
        net = net.dividedBy(
          charged
            .reduce((acc, tx) => acc.plus(dec(tx.rate)), dec(0))
            .dividedBy(100)
            .plus(1),
        );
      }
      out.push({
        bill,
        line,
        accountId: account.id,
        cost: round(net.times(rate), p),
        assetId: linked.get(line.id) ?? null,
      });
    });
  }
  return out.sort((a, b) => b.bill.issueDate.localeCompare(a.bill.issueDate));
}

/* -------------------------------------------------------------------------- */
/* Saving                                                                     */
/* -------------------------------------------------------------------------- */

const FINANCIAL_FIELDS: (keyof FixedAsset)[] = [
  'assetAccountId',
  'accumulatedAccountId',
  'expenseAccountId',
  'purchaseDate',
  'depreciationStart',
  'cost',
  'salvageValue',
  'usefulLifeMonths',
  'method',
  'decliningRate',
  'openingDepreciation',
  'openingDepreciationDate',
  'source',
  'billId',
  'billLineId',
  'paidFromAccountId',
];

function financialChange(before: FixedAsset, after: FixedAsset): boolean {
  return FINANCIAL_FIELDS.some(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null),
  );
}

function validate(asset: FixedAsset, accounts: Map<ID, Account>, precision: number) {
  if (!asset.name.trim()) throw new AssetError(t('Enter a name for the asset.'));
  const category = accounts.get(asset.assetAccountId);
  if (!category || (category.type !== 'asset_fixed' && category.type !== 'asset_non_current')) {
    throw new AssetError(t('Choose the fixed asset account the asset is kept in.'));
  }
  const accumulated = accounts.get(asset.accumulatedAccountId);
  if (!accumulated || accountGroup(accumulated.type) !== 'asset') {
    throw new AssetError(t('Choose the accumulated depreciation account.'));
  }
  if (accumulated.id === category.id) {
    throw new AssetError(t('Use a separate account for accumulated depreciation.'));
  }
  const expense = accounts.get(asset.expenseAccountId);
  if (!expense || accountGroup(expense.type) !== 'expense') {
    throw new AssetError(t('Choose the depreciation expense account.'));
  }
  if (!isISODate(asset.purchaseDate) || !isISODate(asset.depreciationStart)) {
    throw new AssetError(t('Enter the purchase date and when depreciation starts.'));
  }
  if (asset.depreciationStart < asset.purchaseDate) {
    throw new AssetError(t('Depreciation can’t start before the asset was bought.'));
  }
  const cost = toMinor(asset.cost, precision);
  if (!(cost > 0)) throw new AssetError(t('Enter the cost of the asset.'));
  const salvage = toMinor(asset.salvageValue, precision);
  if (salvage < 0 || salvage >= cost) {
    throw new AssetError(t('The salvage value must be less than the cost.'));
  }
  if (!Number.isInteger(asset.usefulLifeMonths) || asset.usefulLifeMonths < 1) {
    throw new AssetError(t('Enter the useful life in whole months.'));
  }
  if (asset.method === 'declining_balance' && asset.decliningRate != null) {
    if (asset.decliningRate < 0 || asset.decliningRate > 100) {
      throw new AssetError(t('The yearly rate must be between 0% and 100%.'));
    }
  }
  const opening = toMinor(asset.openingDepreciation, precision);
  if (opening < 0 || opening > cost - salvage) {
    throw new AssetError(
      t('Depreciation already charged can’t be more than the cost less the salvage value.'),
    );
  }
  if (opening > 0) {
    if (asset.source === 'purchase') {
      throw new AssetError(t('A new purchase has no depreciation charged yet.'));
    }
    if (!asset.openingDepreciationDate || !isISODate(asset.openingDepreciationDate)) {
      throw new AssetError(t('Enter the date the depreciation already charged runs to.'));
    }
    if (asset.openingDepreciationDate < asset.depreciationStart) {
      throw new AssetError(
        t('The depreciation already charged must end after depreciation starts.'),
      );
    }
  }
  if (asset.source === 'purchase') {
    const from = asset.paidFromAccountId ? accounts.get(asset.paidFromAccountId) : undefined;
    if (!from || !isMoneyAccount(from.type)) {
      throw new AssetError(t('Choose the bank, cash or card account the asset was paid from.'));
    }
  }
}

/** The entry recording the cost (purchase) or the opening balance of an asset. */
async function acquisitionLines(
  company: Company,
  asset: FixedAsset,
  accounts: Account[],
): Promise<{
  kind: 'asset_purchase' | 'asset_opening';
  date: ISODate;
  lines: JournalLine[];
} | null> {
  const p = currencyPrecision(company.currency);
  const label = assetLabel(asset);
  if (asset.source === 'purchase') {
    return {
      kind: 'asset_purchase',
      date: asset.purchaseDate,
      lines: [
        newJournalLine({ accountId: asset.assetAccountId, debit: asset.cost, description: label }),
        newJournalLine({
          accountId: asset.paidFromAccountId ?? '',
          credit: asset.cost,
          description: label,
        }),
      ],
    };
  }
  if (asset.source === 'opening') {
    const equity = roleMap(accounts).opening_balance;
    if (!equity) throw new AssetError(t('The chart of accounts has no opening balance account.'));
    const opening = round(asset.openingDepreciation, p);
    const net = fromMinor(toMinor(asset.cost, p) - toMinor(opening, p), p);
    return {
      kind: 'asset_opening',
      date:
        opening > 0 && asset.openingDepreciationDate
          ? asset.openingDepreciationDate
          : asset.purchaseDate,
      lines: [
        newJournalLine({ accountId: asset.assetAccountId, debit: asset.cost, description: label }),
        newJournalLine({
          accountId: asset.accumulatedAccountId,
          credit: opening,
          description: label,
        }),
        newJournalLine({ accountId: equity, credit: net, description: label }),
      ].filter((l) => l.debit !== 0 || l.credit !== 0),
    };
  }
  return null;
}

/**
 * Whether a journal already posts what an asset's acquisition entry should:
 * same kind, date, accounts and amounts (its wording may differ).
 */
function sameEntry(
  journal: Pick<ManualJournal, 'kind' | 'date' | 'lines'>,
  wanted: Pick<ManualJournal, 'kind' | 'date' | 'lines'>,
  precision: number,
): boolean {
  const key = (lines: JournalLine[]) =>
    lines
      .map((l) => [l.accountId, toMinor(l.debit, precision), toMinor(l.credit, precision)])
      .filter(([, debit, credit]) => debit !== 0 || credit !== 0)
      .map((x) => x.join('|'))
      .sort()
      .join('\n');
  return (
    journal.kind === wanted.kind &&
    journal.date === wanted.date &&
    key(journal.lines) === key(wanted.lines)
  );
}

/** Next free asset number, e.g. "FA-0007". */
function nextNumber(assets: FixedAsset[]): string {
  const max = assets.reduce((m, a) => {
    const n = Number(/(\d+)\s*$/.exec(a.number)?.[1] ?? 0);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `FA-${String(max + 1).padStart(4, '0')}`;
}

const TABLES = [
  db.assets,
  db.depreciationRuns,
  db.journals,
  db.companies,
  db.accounts,
  db.activities,
  db.documents,
];

/**
 * Adds or updates an asset. The cost and depreciation figures can only change
 * while nothing has been depreciated; the purchase or opening entry follows
 * the asset.
 */
export async function saveAsset(input: FixedAsset): Promise<FixedAsset> {
  return db.transaction('rw', TABLES, async () => {
    const company = await companyOf(input.companyId);
    const p = currencyPrecision(company.currency);
    const nameAr = input.nameAr?.trim();
    const { nameAr: _drop, ...rest } = input;
    let asset: FixedAsset = {
      ...rest,
      ...(nameAr ? { nameAr } : {}),
      name: input.name.trim(),
      number: input.number.trim(),
      cost: round(input.cost, p),
      salvageValue: round(input.salvageValue, p),
      openingDepreciation: round(input.openingDepreciation, p),
      openingDepreciationDate: input.openingDepreciation > 0 ? input.openingDepreciationDate : null,
      decliningRate: input.method === 'declining_balance' ? (input.decliningRate ?? null) : null,
      paidFromAccountId: input.source === 'purchase' ? input.paidFromAccountId : null,
      billId: input.source === 'bill' ? input.billId : null,
      billLineId: input.source === 'bill' ? input.billLineId : null,
    };
    const [accounts, assets, runs, existing] = await Promise.all([
      db.accounts.where('companyId').equals(company.id).toArray(),
      db.assets.where('companyId').equals(company.id).toArray(),
      db.depreciationRuns.where('companyId').equals(company.id).toArray(),
      db.assets.get(asset.id),
    ]);
    validate(asset, new Map(accounts.map((a) => [a.id, a])), p);

    if (asset.source === 'bill') {
      const bill = asset.billId ? await db.documents.get(asset.billId) : undefined;
      if (!bill || bill.companyId !== company.id || bill.type !== 'bill' || !isPosted(bill)) {
        throw new AssetError(t('Choose a bill that has been entered (not a draft or void).'));
      }
      const line = billAssetLines(company, [bill], accounts, []).find(
        (l) => l.line.id === asset.billLineId,
      );
      if (!line) throw new AssetError(t('Choose the bill line the asset was bought on.'));
      if (line.accountId !== asset.assetAccountId) {
        throw new AssetError(
          t('The bill booked this line to another account. Use the same fixed asset account.'),
        );
      }
      const other = assets.find(
        (a) => a.id !== asset.id && a.status !== 'void' && a.billLineId === asset.billLineId,
      );
      if (other) {
        throw new AssetError(
          t('Asset {number} was already made from this bill line.', { number: other.number }),
        );
      }
      asset.vendorId = bill.clientId || null;
    }

    if (existing) {
      if (existing.status === 'void') throw new AssetError(t('This asset is void.'));
      if (financialChange(existing, asset)) {
        if (existing.status === 'disposed') {
          throw new AssetError(t('Undo the disposal before changing the figures of this asset.'));
        }
        if (lastDepreciationDate(existing, runs)) {
          throw new AssetError(
            t(
              'Depreciation has been posted for this asset, so its figures can’t change. Undo the depreciation runs first.',
            ),
          );
        }
      }
      // Status and disposal are only changed by disposing or voiding.
      asset = { ...asset, status: existing.status, disposal: existing.disposal };
    } else {
      asset = { ...asset, status: 'active', disposal: null };
    }
    if (!asset.number) asset.number = nextNumber(assets);
    else if (assets.some((a) => a.id !== asset.id && a.number === asset.number)) {
      throw new AssetError(t('Asset number {number} is already used.', { number: asset.number }));
    }

    // Keep the purchase or opening entry in step with the asset. In a locked
    // period an entry whose date, accounts and amounts stay the same is left
    // as it is: only the asset's details changed (name, location, notes…).
    const wanted = await acquisitionLines(company, asset, accounts);
    const current = asset.journalId ? await db.journals.get(asset.journalId) : undefined;
    const lock = accountingSettings(company).lockDate;
    const kept = Boolean(
      wanted && current && lock && current.date <= lock && sameEntry(current, wanted, p),
    );
    if (kept) {
      // The entry already posts what the asset needs.
    } else if (wanted) {
      const journal = await saveJournal(
        {
          ...(current && current.kind === wanted.kind
            ? current
            : createJournal(company.id, { status: 'posted' })),
          date: wanted.date,
          kind: wanted.kind,
          sourceId: asset.id,
          reference:
            wanted.kind === 'asset_purchase'
              ? t('Purchase of {asset}', { asset: assetLabel(asset) })
              : t('Opening balance of {asset}', { asset: assetLabel(asset) }),
          status: 'posted',
          lines: wanted.lines,
        },
        { system: true },
      );
      if (current && current.id !== journal.id) await reverseJournal(current);
      asset.journalId = journal.id;
    } else if (current) {
      await reverseJournal(current);
      asset.journalId = null;
    }

    asset.updatedAt = nowStamp();
    if (!existing) asset.createdAt = asset.updatedAt;
    await db.assets.put(asset);
    await logActivity(
      company.id,
      'asset',
      asset.id,
      existing ? 'updated' : 'created',
      existing
        ? { text: msg('Asset {number} updated'), vars: { number: asset.number } }
        : { text: msg('Asset {number} added'), vars: { number: asset.number } },
    );
    return asset;
  });
}

/**
 * Voids an asset entered by mistake: its purchase or opening entry is
 * reversed and it leaves the register. Only possible before any depreciation.
 */
export async function voidAsset(id: ID): Promise<void> {
  await db.transaction('rw', TABLES, async () => {
    const asset = await db.assets.get(id);
    if (!asset || asset.status === 'void') return;
    if (asset.status === 'disposed') {
      throw new AssetError(t('Undo the disposal before voiding the asset.'));
    }
    const runs = await db.depreciationRuns.where('companyId').equals(asset.companyId).toArray();
    if (lastDepreciationDate(asset, runs)) {
      throw new AssetError(
        t('Depreciation has been posted for this asset. Undo those runs first, or dispose of it.'),
      );
    }
    let voidJournalId: ID | null = null;
    const journal = asset.journalId ? await db.journals.get(asset.journalId) : undefined;
    if (journal) voidJournalId = (await reverseJournal(journal)).id;
    await db.assets.put({ ...asset, status: 'void', voidJournalId, updatedAt: nowStamp() });
    await logActivity(asset.companyId, 'asset', asset.id, 'voided', {
      text: msg('Asset {number} voided'),
      vars: { number: asset.number },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Disposal                                                                   */
/* -------------------------------------------------------------------------- */

export interface DisposalInput {
  date: ISODate;
  /** Sale price; 0 when scrapped. */
  proceeds: number;
  depositAccountId: ID | null;
  notes?: string;
}

export interface DisposalPreview {
  /** Depreciation still to charge up to the disposal date (minor units). */
  depreciation: number;
  /** Accumulated depreciation removed with the asset. */
  accumulated: number;
  cost: number;
  bookValue: number;
  proceeds: number;
  /** Positive gain or negative loss. */
  gain: number;
}

/** What disposing of an asset on a date would post (minor units). */
export function disposalPreview(
  asset: FixedAsset,
  runs: DepreciationRun[],
  input: Pick<DisposalInput, 'date' | 'proceeds'>,
  precision: number,
): DisposalPreview {
  const posted = postedDepreciation(asset, runs, precision);
  const target = accumulatedAt(assetTerms(asset), input.date, precision);
  const depreciation = Math.max(0, target - posted);
  const accumulated = posted + depreciation;
  const cost = toMinor(asset.cost, precision);
  const proceeds = toMinor(input.proceeds, precision);
  return {
    depreciation,
    accumulated,
    cost,
    bookValue: cost - accumulated,
    proceeds,
    gain: proceeds - (cost - accumulated),
  };
}

/**
 * Sells or scraps an asset: depreciation up to the date, the cost and
 * accumulated depreciation taken out, the money received, and the gain or
 * loss, in one entry.
 */
export async function disposeAsset(id: ID, input: DisposalInput): Promise<FixedAsset> {
  return db.transaction('rw', TABLES, async () => {
    const asset = await db.assets.get(id);
    if (!asset) throw new AssetError(t('Asset not found'));
    if (asset.status !== 'active')
      throw new AssetError(t('Only assets in use can be disposed of.'));
    const company = await companyOf(asset.companyId);
    const p = currencyPrecision(company.currency);
    if (!isISODate(input.date)) throw new AssetError(t('Enter the date of the disposal.'));
    if (input.date < asset.purchaseDate) {
      throw new AssetError(t('The asset can’t be disposed of before it was bought.'));
    }
    assertUnlocked(company, input.date);
    const runs = await db.depreciationRuns.where('companyId').equals(company.id).toArray();
    const last = lastDepreciationDate(asset, runs);
    if (last && input.date < last) {
      throw new AssetError(
        t(
          'Depreciation has been posted up to {date}. Choose a later date or undo those runs first.',
          { date: formatDate(last, company.dateFormat, interfaceLocale(company.locale)) },
        ),
      );
    }
    if (input.proceeds < 0) throw new AssetError(t('The sale price can’t be negative.'));
    const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
    const deposit = input.depositAccountId
      ? accounts.find((a) => a.id === input.depositAccountId)
      : undefined;
    if (toMinor(input.proceeds, p) > 0 && (!deposit || accountGroup(deposit.type) !== 'asset')) {
      throw new AssetError(t('Choose the account the money from the sale went into.'));
    }

    const preview = disposalPreview(asset, runs, input, p);
    const disposal = await ensureSpecAccount(company, 'disposal');
    const label = assetLabel(asset);
    const major = (minor: number) => fromMinor(minor, p);
    const lines: JournalLine[] = [
      newJournalLine({
        accountId: asset.expenseAccountId,
        debit: major(preview.depreciation),
        description: t('Depreciation to {date}', { date: input.date }),
      }),
      newJournalLine({
        accountId: asset.accumulatedAccountId,
        credit: major(preview.depreciation),
        description: t('Depreciation to {date}', { date: input.date }),
      }),
      newJournalLine({
        accountId: asset.accumulatedAccountId,
        debit: major(preview.accumulated),
        description: label,
      }),
      newJournalLine({
        accountId: asset.assetAccountId,
        credit: major(preview.cost),
        description: label,
      }),
      newJournalLine({
        accountId: deposit?.id ?? '',
        debit: major(preview.proceeds),
        description: label,
      }),
      newJournalLine({
        accountId: disposal.id,
        debit: preview.gain < 0 ? major(-preview.gain) : 0,
        credit: preview.gain > 0 ? major(preview.gain) : 0,
        description: preview.gain >= 0 ? t('Gain on disposal') : t('Loss on disposal'),
      }),
    ].filter((l) => l.accountId && (l.debit !== 0 || l.credit !== 0));

    const journal = await saveJournal(
      createJournal(company.id, {
        date: input.date,
        kind: 'asset_disposal',
        sourceId: asset.id,
        reference: t('Disposal of {asset}', { asset: label }),
        notes: input.notes?.trim() ?? '',
        status: 'posted',
        lines,
      }),
      { system: true },
    );
    const updated: FixedAsset = {
      ...asset,
      status: 'disposed',
      disposal: {
        date: input.date,
        proceeds: major(preview.proceeds),
        depositAccountId: deposit?.id ?? null,
        depreciation: major(preview.depreciation),
        gain: major(preview.gain),
        journalId: journal.id,
        notes: input.notes?.trim() ?? '',
      },
      updatedAt: nowStamp(),
    };
    await db.assets.put(updated);
    await logActivity(company.id, 'asset', asset.id, 'disposed', {
      text: msg('Asset {number} disposed of'),
      vars: { number: asset.number },
    });
    return updated;
  });
}

/** Undoes a disposal with a reversing entry; the asset is in use again. */
export async function undoDisposal(id: ID): Promise<void> {
  await db.transaction('rw', TABLES, async () => {
    const asset = await db.assets.get(id);
    if (!asset?.disposal) return;
    const journal = await db.journals.get(asset.disposal.journalId);
    if (journal) await reverseJournal(journal);
    await db.assets.put({ ...asset, status: 'active', disposal: null, updatedAt: nowStamp() });
    await logActivity(asset.companyId, 'asset', asset.id, 'updated', {
      text: msg('Disposal of asset {number} undone'),
      vars: { number: asset.number },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Depreciation runs                                                          */
/* -------------------------------------------------------------------------- */

export interface RunResult {
  run: DepreciationRun | null;
  /** False when the month had already been run or there was nothing to charge. */
  created: boolean;
}

/** The month after the last run, or the month before the current one when nothing ran yet. */
export function suggestedPeriod(runs: DepreciationRun[], now: ISODate = today()): string {
  const done = activeRuns(runs).map((r) => r.period);
  const current = periodOf(now);
  if (done.length === 0) {
    const [y, m] = current.split('-').map(Number);
    const previous = new Date(y, m - 2, 1);
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
  }
  const last = done.sort().at(-1)!;
  const [y, m] = last.split('-').map(Number);
  const next = new Date(y, m, 1);
  const period = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return period > current ? current : period;
}

/**
 * Charges depreciation for every asset up to the end of a month in one
 * journal. Running a month again changes nothing; months skipped before are
 * caught up. Months must be run in order.
 */
export async function runDepreciation(companyId: ID, period: string): Promise<RunResult> {
  return db.transaction('rw', TABLES, async () => {
    const company = await companyOf(companyId);
    const p = currencyPrecision(company.currency);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new AssetError(t('Choose a month.'));
    const date = periodEnd(period);
    if (period > periodOf(today())) {
      throw new AssetError(t('Depreciation can only be run for months that have started.'));
    }
    const runs = await db.depreciationRuns.where('companyId').equals(company.id).toArray();
    const active = activeRuns(runs);
    const same = active.find((r) => r.period === period);
    if (same) return { run: same, created: false };
    const later = active
      .filter((r) => r.period > period)
      .sort((a, b) => b.period.localeCompare(a.period));
    if (later.length) {
      throw new AssetError(
        t('Depreciation has already been run for {month}. Undo that run first.', {
          month: monthLabel(later[0].period, company.locale),
        }),
      );
    }
    assertUnlocked(company, date);
    const assets = await db.assets.where('companyId').equals(company.id).toArray();
    const due = depreciationDue(assets, runs, date, p);
    if (due.length === 0) return { run: null, created: false };

    const id = newId();
    const month = monthLabel(period, company.locale);
    const lines = due.flatMap(({ asset, amount }) => [
      newJournalLine({
        accountId: asset.expenseAccountId,
        debit: fromMinor(amount, p),
        description: assetLabel(asset),
      }),
      newJournalLine({
        accountId: asset.accumulatedAccountId,
        credit: fromMinor(amount, p),
        description: assetLabel(asset),
      }),
    ]);
    const journal = await saveJournal(
      createJournal(company.id, {
        date,
        kind: 'depreciation',
        sourceId: id,
        reference: t('Depreciation for {month}', { month }),
        status: 'posted',
        lines,
      }),
      { system: true },
    );
    const stamp = nowStamp();
    const run: DepreciationRun = {
      id,
      companyId: company.id,
      period,
      date,
      journalId: journal.id,
      lines: due.map(({ asset, amount }) => ({ assetId: asset.id, amount: fromMinor(amount, p) })),
      total: fromMinor(
        due.reduce((s, l) => s + l.amount, 0),
        p,
      ),
      reversalJournalId: null,
      reversedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.depreciationRuns.add(run);
    await logActivity(company.id, 'asset', id, 'depreciation', {
      text: msg('Depreciation for {month} posted'),
      vars: { month },
    });
    return { run, created: true };
  });
}

/** Undoes the latest depreciation run with a reversing entry, so it can be run again. */
export async function reverseDepreciationRun(id: ID): Promise<void> {
  await db.transaction('rw', TABLES, async () => {
    const run = await db.depreciationRuns.get(id);
    if (!run || run.reversedAt) return;
    const company = await companyOf(run.companyId);
    const runs = activeRuns(
      await db.depreciationRuns.where('companyId').equals(company.id).toArray(),
    );
    if (runs.some((r) => r.period > run.period)) {
      throw new AssetError(t('Undo the later depreciation runs first.'));
    }
    const assets = await db.assets.bulkGet(run.lines.map((l) => l.assetId));
    const disposed = assets.find((a) => a && a.status === 'disposed');
    if (disposed) {
      throw new AssetError(
        t('Asset {number} has been disposed of since. Undo the disposal first.', {
          number: disposed.number,
        }),
      );
    }
    assertUnlocked(company, run.date);
    const journal = await db.journals.get(run.journalId);
    const month = monthLabel(run.period, company.locale);
    const reversal = journal
      ? await reverseJournal(journal, {
          reference: t('Reversal of depreciation for {month}', { month }),
        })
      : null;
    await db.depreciationRuns.put({
      ...run,
      reversalJournalId: reversal?.id ?? null,
      reversedAt: nowStamp(),
      updatedAt: nowStamp(),
    });
    await logActivity(company.id, 'asset', run.id, 'depreciation_reversed', {
      text: msg('Depreciation for {month} undone'),
      vars: { month },
    });
  });
}
