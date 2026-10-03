import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import {
  closeYear,
  createJournal,
  loadLedger,
  LockedPeriodError,
  newJournalLine,
  reopenYear,
  saveJournal,
  YearEndError,
} from './accounting';
import type { Company } from './types';
import { specialAccounts, trialBalance } from '@/lib/accounting/statements';
import { levyRates, yearEndFigures } from '@/lib/accounting/year-end';
import { accountingSettings } from './chart-setup';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function setup() {
  const company = await setupCompany({
    name: 'Kuwait Holding',
    kuwait: {
      legalForm: 'kscc',
      licenceNumber: '',
      activity: 'general',
      foreignOwnershipPercent: 0,
      capital: 10000,
      pamFileNumber: '',
      pifssEmployerNumber: '',
      mofTaxCardNumber: '',
      kcciNumber: '',
      digitalCommerceNumber: '',
      wamdPhone: '',
    },
  });
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const code = (c: string) => accounts.find((a) => a.code === c)!;
  // Capital paid in, a reserve of 4,800 from earlier years, 3,000 profit this year.
  await saveJournal(
    createJournal(company.id, {
      date: '2025-01-01',
      status: 'posted',
      lines: [
        newJournalLine({ accountId: code('1000').id, debit: 14800 }),
        newJournalLine({ accountId: code('3000').id, credit: 10000 }),
        newJournalLine({ accountId: code('3200').id, credit: 4800 }),
      ],
    }),
  );
  await saveJournal(
    createJournal(company.id, {
      date: '2026-06-30',
      status: 'posted',
      lines: [
        newJournalLine({ accountId: code('1000').id, debit: 3000 }),
        newJournalLine({ accountId: code('4100').id, credit: 3000 }),
      ],
    }),
  );
  return { company, code };
}

async function figures(company: Company) {
  const ledger = await loadLedger(company);
  return yearEndFigures({
    lines: ledger.lines,
    accounts: ledger.accounts,
    special: specialAccounts(ledger.accounts, 'kw'),
    fiscalYearEnd: { month: 12, day: 31 },
    date: '2026-12-31',
    profile: company.kuwait!,
    precision: 3,
    rates: levyRates(company.accounting),
  });
}

describe('year-end close', () => {
  it('proposes the reserve up to half of the capital, then KFAS and Zakat', async () => {
    const { company } = await setup();
    const f = await figures(company);
    expect(f).toMatchObject({
      yearStart: '2026-01-01',
      profitBeforeLevies: 3_000_000,
      capital: 10_000_000,
      capitalSource: 'profile',
      statutoryReserve: 4_800_000,
    });
    const amount = (kind: string) => f.proposals.find((p) => p.kind === kind)!.amount;
    expect(amount('statutory_reserve')).toBe(200_000);
    expect(amount('kfas')).toBe(28_000); // 1% of 3,000 − 200
    expect(amount('zakat')).toBe(30_000);
    expect(amount('nlst')).toBe(0);
  });

  it('posts dated entries, locks the year and can be reopened', async () => {
    const { company, code } = await setup();
    const f = await figures(company);
    const close = await closeYear(company.id, {
      yearStart: f.yearStart,
      yearEnd: f.yearEnd,
      profitBeforeLevies: 3000,
      lines: f.proposals
        .filter((p) => p.applies)
        .map((p) => ({ kind: p.kind, base: p.base / 1000, rate: p.rate, amount: p.amount / 1000 })),
      lock: true,
    });
    expect(close.journalIds).toHaveLength(2);
    const journals = await db.journals.bulkGet(close.journalIds);
    expect(journals.every((j) => j?.kind === 'year_end' && j.date === '2026-12-31')).toBe(true);

    const fresh = (await db.companies.get(company.id))!;
    expect(accountingSettings(fresh).lockDate).toBe('2026-12-31');
    const ledger = await loadLedger(fresh);
    const sum = (c: string) =>
      ledger.lines.filter((l) => l.accountId === code(c).id).reduce((s, l) => s + l.amount, 0);
    expect(sum('3200')).toBe(-5_000_000);
    expect(sum('3300')).toBe(200_000);
    expect(sum('7200')).toBe(28_000);
    expect(sum('2500')).toBe(-28_000);
    expect(sum('7210')).toBe(30_000);
    expect(sum('2510')).toBe(-30_000);
    const tb = trialBalance(ledger.lines, ledger.accounts, '2026-12-31', { month: 12, day: 31 });
    expect(tb.totalDebit).toBe(tb.totalCredit);

    // A closed year shows what it was closed with.
    const after = yearEndFigures({
      lines: ledger.lines,
      accounts: ledger.accounts,
      special: specialAccounts(ledger.accounts, 'kw'),
      fiscalYearEnd: { month: 12, day: 31 },
      date: '2026-12-31',
      profile: company.kuwait!,
      precision: 3,
      rates: levyRates(company.accounting),
      exclude: new Set(close.journalIds),
    });
    expect(after.proposals.find((p) => p.kind === 'statutory_reserve')!.amount).toBe(200_000);

    await expect(closeYear(company.id, { ...close, lines: [], lock: false })).rejects.toThrow(
      YearEndError,
    );
    await expect(reopenYear(close.id)).rejects.toThrow(LockedPeriodError);
    await db.companies.update(company.id, {
      accounting: { ...accountingSettings(fresh), lockDate: null },
    });
    await reopenYear(close.id);
    expect((await db.yearEnds.get(close.id))?.status).toBe('reopened');
    const reopened = await loadLedger((await db.companies.get(company.id))!);
    expect(
      reopened.lines
        .filter((l) => l.accountId === code('3200').id)
        .reduce((s, l) => s + l.amount, 0),
    ).toBe(-4_800_000);
    expect(await db.journals.filter((j) => j.kind === 'year_end').count()).toBe(4);
  });
});
