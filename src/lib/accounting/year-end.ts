import type {
  Account,
  ID,
  ISODate,
  KuwaitProfile,
  LegalForm,
  LevyRates,
  YearEndLineKind,
} from '@/db/types';
import { dec, toMinor } from '@/lib/money';
import { addDaysISO } from '@/lib/dates';
import { isShareholding } from '@/lib/kuwait-rules';
import { msg } from '@/i18n';
import type { LedgerLine } from './ledger';
import {
  financialPosition,
  fiscalYearEnd,
  fiscalYearStart,
  profitOrLoss,
  type Caption,
  type FiscalYearEnd,
  type SpecialAccounts,
} from './statements';

/**
 * Year-end close for Kuwaiti companies. From the profit for the year, in
 * this order:
 *
 * 1. Statutory reserve: 10% of the profit before levies, for every company
 *    except sole proprietorships and freelancers, until the reserve reaches
 *    half of the paid-up capital (Companies Law 1/2016).
 * 2. KFAS: 1% of the profit after the statutory reserve and after offsetting
 *    losses brought forward (shareholding companies).
 * 3. Zakat: 1% of the profit (shareholding companies, Law 46/2006).
 * 4. NLST: 2.5% of the profit (listed companies, Law 19/2000).
 * 5. Income tax: 15% of the foreign-owned share of the profit (Law 2/2008).
 *
 * The rates are settings and every amount can be changed before posting:
 * the auditor has the final word.
 */

export const DEFAULT_LEVY_RATES: LevyRates = {
  statutoryReserve: 10,
  statutoryReserveCap: 50,
  kfas: 1,
  zakat: 1,
  nlst: 2.5,
  incomeTax: 15,
};

/** The company's rates, with the legal defaults for anything not set. */
export function levyRates(settings: { levies?: Partial<LevyRates> } | undefined): LevyRates {
  return { ...DEFAULT_LEVY_RATES, ...settings?.levies };
}

export const YEAR_END_LABELS: Record<YearEndLineKind, string> = {
  statutory_reserve: msg('Transfer to statutory reserve'),
  voluntary_reserve: msg('Transfer to voluntary reserve'),
  kfas: msg('KFAS contribution'),
  zakat: msg('Zakat'),
  nlst: msg('National Labour Support Tax'),
  income_tax: msg('Income tax'),
};

/** Sole proprietors and freelancers keep no statutory reserve. */
export function keepsStatutoryReserve(form: LegalForm): boolean {
  return form !== 'sole_proprietorship' && form !== 'freelance';
}

/** Share of the profit (percent) taxed as foreign-owned. A foreign branch is wholly foreign. */
export function foreignShare(form: LegalForm, foreignOwnershipPercent: number): number {
  if (form === 'foreign_branch') return 100;
  return Math.min(100, Math.max(0, foreignOwnershipPercent || 0));
}

export interface YearEndInput {
  /** Profit for the year before KFAS, Zakat, NLST and income tax (minor units). */
  profitBeforeLevies: number;
  legalForm: LegalForm;
  foreignOwnershipPercent: number;
  /** Paid-up capital (minor units); 0 or less when unknown. */
  capital: number;
  /** Statutory reserve at the year end, before this year's transfer (minor units). */
  statutoryReserve: number;
  /** Accumulated losses brought forward from earlier years, as a positive number. */
  lossesBroughtForward: number;
  rates: LevyRates;
}

export interface YearEndProposal {
  kind: YearEndLineKind;
  /** Whether the line applies to this company. */
  applies: boolean;
  /** Amount the rate is applied to (minor units). */
  base: number;
  rate: number;
  /** Proposed amount (minor units). */
  amount: number;
  /** Statutory reserve: what 10% would be before the 50% limit. */
  uncapped?: number;
  /** Statutory reserve: how much more the reserve may take; null when the capital is unknown. */
  room?: number | null;
}

const percentOf = (base: number, rate: number) =>
  base > 0 && rate > 0 ? toMinor(dec(base).times(rate).dividedBy(100), 0) : 0;

/** The proposed levies and transfers for a year, in posting order. */
export function yearEndProposals(input: YearEndInput): YearEndProposal[] {
  const { rates, legalForm } = input;
  const profit = Math.max(0, input.profitBeforeLevies);
  const shareholding = isShareholding(legalForm);

  const reserveApplies = keepsStatutoryReserve(legalForm);
  const uncapped = reserveApplies ? percentOf(profit, rates.statutoryReserve) : 0;
  const room =
    input.capital > 0
      ? Math.max(0, percentOf(input.capital, rates.statutoryReserveCap) - input.statutoryReserve)
      : null;
  const reserve = room === null ? uncapped : Math.min(uncapped, room);

  const kfasBase = Math.max(0, profit - reserve - Math.max(0, input.lossesBroughtForward));
  const foreign = foreignShare(legalForm, input.foreignOwnershipPercent);
  const taxBase = foreign > 0 ? percentOf(profit, foreign) : 0;

  return [
    {
      kind: 'statutory_reserve',
      applies: reserveApplies,
      base: reserveApplies ? profit : 0,
      rate: rates.statutoryReserve,
      amount: reserve,
      uncapped,
      room,
    },
    { kind: 'voluntary_reserve', applies: reserveApplies, base: profit, rate: 0, amount: 0 },
    {
      kind: 'kfas',
      applies: shareholding,
      base: shareholding ? kfasBase : 0,
      rate: rates.kfas,
      amount: shareholding ? percentOf(kfasBase, rates.kfas) : 0,
    },
    {
      kind: 'zakat',
      applies: shareholding,
      base: shareholding ? profit : 0,
      rate: rates.zakat,
      amount: shareholding ? percentOf(profit, rates.zakat) : 0,
    },
    {
      kind: 'nlst',
      applies: legalForm === 'ksc_listed',
      base: legalForm === 'ksc_listed' ? profit : 0,
      rate: rates.nlst,
      amount: legalForm === 'ksc_listed' ? percentOf(profit, rates.nlst) : 0,
    },
    {
      kind: 'income_tax',
      applies: foreign > 0,
      base: taxBase,
      rate: rates.incomeTax,
      amount: percentOf(taxBase, rates.incomeTax),
    },
  ];
}

/** "2026", or "2025–2026" for a financial year that doesn't follow the calendar. */
export function financialYearLabel(start: string, end: string): string {
  const a = start.slice(0, 4);
  const b = end.slice(0, 4);
  return a === b ? b : `${a}–${b}`;
}

/* -------------------------------------------------------------------------- */
/* Figures from the books                                                     */
/* -------------------------------------------------------------------------- */

export interface YearEndFigures {
  yearStart: ISODate;
  yearEnd: ISODate;
  /** Profit for the year as booked (minor units). */
  profit: number;
  profitBeforeLevies: number;
  capital: number;
  /** Where the capital comes from: the company profile, the capital account, or nowhere. */
  capitalSource: 'profile' | 'books' | 'none';
  /** Statutory reserve at the year end before this year's transfer. */
  statutoryReserve: number;
  lossesBroughtForward: number;
  proposals: YearEndProposal[];
}

/**
 * Works out a year's profit, the reserve and capital, and the proposed
 * levies and transfers. Entries of an earlier close of the same year
 * (`exclude`) are left out, so a closed year shows what it was closed with.
 */
export function yearEndFigures(input: {
  lines: LedgerLine[];
  accounts: Account[];
  special: SpecialAccounts;
  fiscalYearEnd: FiscalYearEnd;
  /** Any date in the year. */
  date: ISODate;
  profile: Pick<KuwaitProfile, 'legalForm' | 'foreignOwnershipPercent' | 'capital'>;
  precision: number;
  rates: LevyRates;
  exclude?: Set<ID>;
}): YearEndFigures {
  const yearStart = fiscalYearStart(input.date, input.fiscalYearEnd);
  const yearEnd = fiscalYearEnd(input.date, input.fiscalYearEnd);
  const lines = input.exclude?.size
    ? input.lines.filter((l) => !(l.source === 'journal' && input.exclude!.has(l.sourceId)))
    : input.lines;
  const pl = profitOrLoss(lines, input.accounts, { from: yearStart, to: yearEnd }, input.special);
  const position = financialPosition(
    lines,
    input.accounts,
    yearEnd,
    input.fiscalYearEnd,
    input.special,
  );
  const before = financialPosition(
    lines,
    input.accounts,
    addDaysISO(yearStart, -1),
    input.fiscalYearEnd,
    input.special,
  );
  const captionTotal = (list: Caption[], key: string) =>
    list.find((c) => c.key === key)?.total ?? 0;
  const profileCapital = toMinor(input.profile.capital || 0, input.precision);
  const booksCapital = captionTotal(position.equity, 'capital');
  const capital = profileCapital > 0 ? profileCapital : Math.max(0, booksCapital);
  const statutoryReserve = captionTotal(position.equity, 'statutory');
  const retainedBefore = captionTotal(before.equity, 'retained');
  const lossesBroughtForward = Math.max(0, -retainedBefore);
  return {
    yearStart,
    yearEnd,
    profit: pl.profit,
    profitBeforeLevies: pl.profitBeforeLevies,
    capital,
    capitalSource: profileCapital > 0 ? 'profile' : booksCapital > 0 ? 'books' : 'none',
    statutoryReserve,
    lossesBroughtForward,
    proposals: yearEndProposals({
      profitBeforeLevies: pl.profitBeforeLevies,
      legalForm: input.profile.legalForm,
      foreignOwnershipPercent: input.profile.foreignOwnershipPercent,
      capital,
      statutoryReserve,
      lossesBroughtForward,
      rates: input.rates,
    }),
  };
}

/** Financial years from the one holding `first` to the one holding `now`, latest first. */
export function financialYears(
  first: ISODate | undefined,
  yearEnd: FiscalYearEnd,
  now: ISODate,
): { from: ISODate; to: ISODate }[] {
  const years: { from: ISODate; to: ISODate }[] = [];
  let end = fiscalYearEnd(now, yearEnd);
  const stop = first && first < now ? first : now;
  for (let i = 0; i < 50; i++) {
    const from = fiscalYearStart(end, yearEnd);
    years.push({ from, to: end });
    if (from <= stop) break;
    end = addDaysISO(from, -1);
  }
  return years;
}
