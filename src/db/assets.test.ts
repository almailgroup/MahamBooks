import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import { draftDocument, saveDocument } from './documents';
import { saveClient, setupCompany } from './records';
import {
  deleteJournal,
  JournalError,
  loadLedger,
  LockedPeriodError,
  saveJournal,
} from './accounting';
import {
  AssetError,
  billAssetLines,
  createAsset,
  disposeAsset,
  postedDepreciation,
  reverseDepreciationRun,
  runDepreciation,
  saveAsset,
  suggestedPeriod,
  undoDisposal,
  voidAsset,
} from './assets';
import type { Account, Company, FixedAsset } from './types';
import { trialBalance } from '@/lib/accounting/statements';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 11, 15));
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const company = await setupCompany({ name: 'Gulf Trading' });
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const code = (c: string) => accounts.find((a) => a.code === c)!;
  return {
    company,
    accounts,
    bank: code('1000'),
    equipment: code('1520'),
    accumulated: code('1530'),
    depreciation: code('6900'),
    opening: code('3900'),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function laptop(s: Setup, overrides: Partial<FixedAsset> = {}): FixedAsset {
  return createAsset(s.company.id, {
    name: 'Laptops',
    nameAr: 'أجهزة حاسب محمول',
    assetAccountId: s.equipment.id,
    accumulatedAccountId: s.accumulated.id,
    expenseAccountId: s.depreciation.id,
    purchaseDate: '2026-01-01',
    depreciationStart: '2026-01-01',
    cost: 1200,
    usefulLifeMonths: 12,
    source: 'purchase',
    paidFromAccountId: s.bank.id,
    ...overrides,
  });
}

/** Balance of each account (minor units, debit positive) over the whole ledger. */
async function balances(company: Company) {
  const ledger = await loadLedger(company);
  const sum = (account: Account) =>
    ledger.lines.filter((l) => l.accountId === account.id).reduce((s, l) => s + l.amount, 0);
  const tb = trialBalance(ledger.lines, ledger.accounts, '2026-12-31', { month: 12, day: 31 });
  expect(tb.totalDebit).toBe(tb.totalCredit);
  expect(ledger.problems).toEqual([]);
  return { sum, ledger };
}

describe('the register', () => {
  it('posts a purchase paid from the bank and numbers assets', async () => {
    const s = await setup();
    const asset = await saveAsset(laptop(s));
    expect(asset.number).toBe('FA-0001');
    const journal = await db.journals.get(asset.journalId!);
    expect(journal).toMatchObject({
      kind: 'asset_purchase',
      sourceId: asset.id,
      date: '2026-01-01',
    });
    const { sum } = await balances(s.company);
    expect(sum(s.equipment)).toBe(1_200_000);
    expect(sum(s.bank)).toBe(-1_200_000);

    const second = await saveAsset(laptop(s, { name: 'Printer', cost: 300.5 }));
    expect(second.number).toBe('FA-0002');
  });

  it('posts an opening balance with the depreciation already charged', async () => {
    const s = await setup();
    const asset = await saveAsset(
      laptop(s, {
        source: 'opening',
        paidFromAccountId: null,
        purchaseDate: '2024-01-01',
        depreciationStart: '2024-01-01',
        cost: 6000,
        usefulLifeMonths: 60,
        openingDepreciation: 2400,
        openingDepreciationDate: '2025-12-31',
      }),
    );
    const journal = await db.journals.get(asset.journalId!);
    expect(journal).toMatchObject({ kind: 'asset_opening', date: '2025-12-31' });
    const { sum } = await balances(s.company);
    expect(sum(s.equipment)).toBe(6_000_000);
    expect(sum(s.accumulated)).toBe(-2_400_000);
    expect(sum(s.opening)).toBe(-3_600_000);

    // January charges the rest over the remaining 36 months.
    await runDepreciation(s.company.id, '2026-01');
    expect((await balances(s.company)).sum(s.accumulated)).toBe(-2_500_000);
  });

  it('checks the figures', async () => {
    const s = await setup();
    await expect(saveAsset(laptop(s, { name: ' ' }))).rejects.toThrow(AssetError);
    await expect(saveAsset(laptop(s, { salvageValue: 1200 }))).rejects.toThrow(
      'The salvage value must be less than the cost.',
    );
    await expect(saveAsset(laptop(s, { usefulLifeMonths: 0 }))).rejects.toThrow(AssetError);
    await expect(saveAsset(laptop(s, { accumulatedAccountId: s.equipment.id }))).rejects.toThrow(
      AssetError,
    );
    await expect(saveAsset(laptop(s, { paidFromAccountId: s.equipment.id }))).rejects.toThrow(
      AssetError,
    );
  });

  it('makes an asset from a bill line without posting the cost again', async () => {
    const s = await setup();
    const vendor = await saveClient(
      createClient(s.company.id, { name: 'X-cite', isCustomer: false, isVendor: true }),
    );
    const draft = await draftDocument(s.company, 'bill', vendor);
    draft.issueDate = '2026-03-10';
    draft.items[0] = {
      ...draft.items[0],
      name: 'Server',
      quantity: 2,
      unitPrice: 450.25,
      taxes: [],
      accountId: s.equipment.id,
    };
    const bill = await saveDocument({ ...draft, status: 'sent' });
    const lines = billAssetLines(s.company, [bill], s.accounts, []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ accountId: s.equipment.id, cost: 900.5, assetId: null });

    const asset = await saveAsset(
      laptop(s, {
        name: 'Server',
        source: 'bill',
        paidFromAccountId: null,
        billId: bill.id,
        billLineId: bill.items[0].id,
        cost: lines[0].cost,
        purchaseDate: '2026-03-10',
        depreciationStart: '2026-03-10',
      }),
    );
    expect(asset).toMatchObject({ journalId: null, vendorId: vendor.id });
    const { sum } = await balances(s.company);
    expect(sum(s.equipment)).toBe(900_500);
    // The same line can't become a second asset.
    await expect(
      saveAsset(laptop(s, { source: 'bill', billId: bill.id, billLineId: bill.items[0].id })),
    ).rejects.toThrow(AssetError);
    expect(billAssetLines(s.company, [bill], s.accounts, [asset]).map((l) => l.assetId)).toEqual([
      asset.id,
    ]);
  });

  it('voids an asset entered by mistake with a reversing entry', async () => {
    const s = await setup();
    const asset = await saveAsset(laptop(s));
    await voidAsset(asset.id);
    const stored = await db.assets.get(asset.id);
    expect(stored?.status).toBe('void');
    const reversal = await db.journals.get(stored!.voidJournalId!);
    expect(reversal).toMatchObject({ reversalOf: asset.journalId, kind: 'asset_purchase' });
    // Both entries stay in the books and cancel out.
    expect(await db.journals.count()).toBe(2);
    const { sum } = await balances(s.company);
    expect(sum(s.equipment)).toBe(0);
    expect(sum(s.bank)).toBe(0);
  });
});

describe('depreciation runs', () => {
  it('post one journal per month for every asset', async () => {
    const s = await setup();
    const a = await saveAsset(laptop(s));
    const b = await saveAsset(
      laptop(s, { name: 'Car', cost: 9000, usefulLifeMonths: 60, depreciationStart: '2026-01-16' }),
    );
    const { run, created } = await runDepreciation(s.company.id, '2026-01');
    expect(created).toBe(true);
    // Laptops: 100.000; car: 150 × 16/31 = 77.419.
    expect(run!.lines).toEqual([
      { assetId: a.id, amount: 100 },
      { assetId: b.id, amount: 77.419 },
    ]);
    expect(run!.total).toBe(177.419);
    const journal = await db.journals.get(run!.journalId);
    expect(journal).toMatchObject({ kind: 'depreciation', date: '2026-01-31', sourceId: run!.id });
    expect(journal!.lines).toHaveLength(4);
    const { sum } = await balances(s.company);
    expect(sum(s.depreciation)).toBe(177_419);
    expect(sum(s.accumulated)).toBe(-177_419);
  });

  it('are idempotent per month and catch up skipped months', async () => {
    const s = await setup();
    const asset = await saveAsset(laptop(s));
    await runDepreciation(s.company.id, '2026-01');
    const again = await runDepreciation(s.company.id, '2026-01');
    expect(again.created).toBe(false);
    expect(await db.depreciationRuns.count()).toBe(1);
    expect(await db.journals.filter((j) => j.kind === 'depreciation').count()).toBe(1);

    // February is skipped: March charges two months.
    const march = await runDepreciation(s.company.id, '2026-03');
    expect(march.run!.total).toBe(200);
    expect(postedDepreciation(asset, await db.depreciationRuns.toArray(), 3)).toBe(300_000);
    // Months run in order.
    await expect(runDepreciation(s.company.id, '2026-02')).rejects.toThrow(AssetError);
    expect(suggestedPeriod(await db.depreciationRuns.toArray())).toBe('2026-04');
  });

  it('stop at the end of the useful life and charge nothing more', async () => {
    const s = await setup();
    await saveAsset(laptop(s));
    await runDepreciation(s.company.id, '2026-12');
    expect((await runDepreciation(s.company.id, '2027-01').catch(() => null))?.created).toBeFalsy();
    const { sum } = await balances(s.company);
    expect(sum(s.accumulated)).toBe(-1_200_000);
    const nothing = await runDepreciation(s.company.id, '2026-12');
    expect(nothing.created).toBe(false);
  });

  it('respect the lock date', async () => {
    const s = await setup();
    await saveAsset(laptop(s));
    await db.companies.update(s.company.id, {
      accounting: { ...s.company.accounting!, lockDate: '2026-02-28' },
    });
    await expect(runDepreciation(s.company.id, '2026-02')).rejects.toThrow(LockedPeriodError);
    const march = await runDepreciation(s.company.id, '2026-03');
    // Nothing was charged for January and February yet, so March catches up.
    expect(march.run!.total).toBe(300);
  });

  it('are undone with a reversing entry and can run again', async () => {
    const s = await setup();
    await saveAsset(laptop(s));
    const jan = (await runDepreciation(s.company.id, '2026-01')).run!;
    const feb = (await runDepreciation(s.company.id, '2026-02')).run!;
    await expect(reverseDepreciationRun(jan.id)).rejects.toThrow(AssetError);
    await reverseDepreciationRun(feb.id);
    const stored = await db.depreciationRuns.get(feb.id);
    expect(stored?.reversedAt).toBeTruthy();
    const reversal = await db.journals.get(stored!.reversalJournalId!);
    expect(reversal).toMatchObject({ reversalOf: feb.journalId, kind: 'depreciation' });
    expect((await balances(s.company)).sum(s.accumulated)).toBe(-100_000);
    const again = await runDepreciation(s.company.id, '2026-02');
    expect(again).toMatchObject({ created: true, run: { total: 100 } });
    expect((await balances(s.company)).sum(s.accumulated)).toBe(-200_000);
  });

  it('own their journals: they can’t be edited or deleted by hand', async () => {
    const s = await setup();
    await saveAsset(laptop(s));
    const run = (await runDepreciation(s.company.id, '2026-01')).run!;
    const journal = (await db.journals.get(run.journalId))!;
    await expect(saveJournal({ ...journal, reference: 'Changed' })).rejects.toThrow(JournalError);
    await expect(deleteJournal(journal.id)).rejects.toThrow(JournalError);
  });
});

describe('disposal', () => {
  it('charges depreciation to the day and books a gain on sale', async () => {
    const s = await setup();
    const asset = await saveAsset(laptop(s));
    await runDepreciation(s.company.id, '2026-01');
    await runDepreciation(s.company.id, '2026-02');
    // Before the last run: refused.
    await expect(
      disposeAsset(asset.id, { date: '2026-02-10', proceeds: 0, depositAccountId: null }),
    ).rejects.toThrow(AssetError);
    // 15 March: 100 × 15/31 = 48.387 more; book value 1,200 − 248.387 = 951.613.
    const sold = await disposeAsset(asset.id, {
      date: '2026-03-15',
      proceeds: 1000,
      depositAccountId: s.bank.id,
    });
    expect(sold.status).toBe('disposed');
    expect(sold.disposal).toMatchObject({ depreciation: 48.387, gain: 48.387, proceeds: 1000 });
    const journal = (await db.journals.get(sold.disposal!.journalId))!;
    expect(journal.kind).toBe('asset_disposal');
    const disposalAccount = (await db.accounts.filter((a) => a.code === '4520').first())!;
    const { sum } = await balances(s.company);
    expect(sum(s.equipment)).toBe(0);
    expect(sum(s.accumulated)).toBe(0);
    expect(sum(s.depreciation)).toBe(248_387);
    expect(sum(disposalAccount)).toBe(-48_387);
    expect(sum(s.bank)).toBe(-1_200_000 + 1_000_000);

    // Disposed assets are left out of later runs.
    expect((await runDepreciation(s.company.id, '2026-03')).created).toBe(false);
    // Runs that include the asset can't be undone while it is disposed of.
    const feb = (await db.depreciationRuns.filter((r) => r.period === '2026-02').first())!;
    await expect(reverseDepreciationRun(feb.id)).rejects.toThrow(AssetError);
  });

  it('books a loss when the asset is scrapped, and can be undone', async () => {
    const s = await setup();
    const asset = await saveAsset(laptop(s));
    await runDepreciation(s.company.id, '2026-06');
    const scrapped = await disposeAsset(asset.id, {
      date: '2026-06-30',
      proceeds: 0,
      depositAccountId: null,
    });
    // Six months charged: book value 600 is lost.
    expect(scrapped.disposal).toMatchObject({ depreciation: 0, gain: -600 });
    const disposalAccount = (await db.accounts.filter((a) => a.code === '4520').first())!;
    expect((await balances(s.company)).sum(disposalAccount)).toBe(600_000);

    await undoDisposal(asset.id);
    expect((await db.assets.get(asset.id))?.status).toBe('active');
    const after = await balances(s.company);
    expect(after.sum(disposalAccount)).toBe(0);
    expect(after.sum(s.equipment)).toBe(1_200_000);
    expect(after.sum(s.accumulated)).toBe(-600_000);
  });

  it('keeps the figures of a depreciated asset fixed', async () => {
    const s = await setup();
    const asset = await saveAsset(laptop(s));
    await runDepreciation(s.company.id, '2026-01');
    await expect(saveAsset({ ...asset, cost: 1500 })).rejects.toThrow(AssetError);
    // Descriptive details can still change.
    await expect(saveAsset({ ...asset, location: 'Head office' })).resolves.toMatchObject({
      location: 'Head office',
    });
    await expect(voidAsset(asset.id)).rejects.toThrow(AssetError);
  });
});
