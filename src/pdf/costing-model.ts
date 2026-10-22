import type { StaffingCosting } from '@/db/types';
import { currentLanguage, t } from '@/i18n';
import { formatAmount } from '@/lib/format';
import {
  COSTING_CATEGORY_LABELS,
  COSTING_RULES,
  costingWarningText,
  markupForMargin,
  percentOf,
  type PricedCosting,
} from '@/lib/hr/costing';

/**
 * The internal cost sheet of a manpower costing (كشف التكلفة, #3): every
 * post with what a person costs a month (wage, overtime, the employer's
 * PIFSS share, the indemnity and leave earned, other costs), the overhead,
 * the sell price and the margin. It is for the company only: it is printed
 * from the costing, never attached to the quote nor emailed. Written in the
 * interface language, amounts with Western digits.
 */
export interface CostingSheetModel {
  dir: 'ltr' | 'rtl';
  title: string;
  /** "Internal: never sent to the customer." */
  notice: string;
  company: { name: string; logo: string | null };
  meta: { label: string; value: string }[];
  /** Per person a month, in the currency. */
  amountsNote: string;
  columns: string[];
  rows: { title: string; subtitle: string; cells: string[] }[];
  totals: { label: string; cells: string[] };
  summary: { label: string; value: string; strong?: boolean }[];
  warnings: string[];
  footer: string;
}

export interface CostingSheetInput {
  costing: StaffingCosting;
  priced: PricedCosting;
  company: { name: string; nameAr?: string; currency: string; logo: string | null };
  customer: string;
  /** The day it is printed, as the company writes dates. */
  printedOn: string;
}

export function buildCostingSheet(input: CostingSheetInput): CostingSheetModel {
  const { costing, priced, company } = input;
  const rtl = currentLanguage() === 'ar';
  const money = (n: number) => formatAmount(n, company.currency, 'en');
  const percent = (n: number) => `${Math.round(n * 100) / 100}%`;
  const rows = priced.posts.map(({ post, perPerson, total }) => ({
    title: (rtl && post.jobTitleAr) || post.jobTitle,
    subtitle: [
      t(COSTING_CATEGORY_LABELS[post.category ?? 'expat']),
      t('{hours} hours a day, {days} days a month', {
        hours: post.hoursPerDay,
        days: post.daysPerMonth,
      }),
    ].join(' · '),
    cells: [
      String(post.headcount),
      money(perPerson.wage),
      money(perPerson.overtime + perPerson.restDayPay),
      money(perPerson.employerPifss),
      money(perPerson.eosi),
      money(perPerson.leave),
      money(perPerson.otherCosts),
      money(perPerson.cost),
      money(perPerson.overhead),
      money(perPerson.sell),
      money(total.sell),
    ],
  }));
  const totals = priced.totals;
  // As priced: an overhead or margin past the most allowed counts as the most.
  const overhead = percentOf(costing.overheadPercent, COSTING_RULES.maxOverheadPercent);
  const margin = percentOf(costing.marginPercent, COSTING_RULES.maxMarginPercent);
  return {
    dir: rtl ? 'rtl' : 'ltr',
    title: t('Cost sheet'),
    notice: t('Internal: never sent to the customer.'),
    company: {
      name: (rtl && company.nameAr) || company.name,
      logo: company.logo,
    },
    meta: [
      { label: t('Costing'), value: costing.name },
      { label: t('Customer'), value: input.customer || '—' },
      { label: t('Date'), value: input.printedOn },
      { label: t('Overhead'), value: percent(overhead) },
      {
        label: t('Margin'),
        value: t('{margin} of the sell price ({markup} markup on cost)', {
          margin: percent(margin),
          markup: percent(markupForMargin(margin)),
        }),
      },
    ],
    amountsNote: t('Amounts in {currency}, per person a month.', { currency: company.currency }),
    columns: [
      t('Post'),
      t('Headcount'),
      t('Wage'),
      t('Overtime'),
      t('Employer PIFSS'),
      t('Indemnity'),
      t('Leave'),
      t('Other costs'),
      t('Cost'),
      t('Overhead'),
      t('Sell price'),
      t('A month'),
    ],
    rows,
    totals: {
      label: t('Total'),
      cells: [String(totals.headcount), money(totals.sell)],
    },
    summary: [
      { label: t('Cost a month'), value: money(totals.cost) },
      { label: t('Overhead'), value: money(totals.overhead) },
      { label: t('Cost with overhead'), value: money(totals.fullCost) },
      { label: t('Sell price a month'), value: money(totals.sell), strong: true },
      {
        label: t('Margin'),
        value: `${money(totals.margin)} (${percent(totals.marginPercent)})`,
      },
      { label: t('Markup on cost'), value: percent(totals.markupPercent) },
    ],
    warnings: priced.warnings.map(costingWarningText),
    footer: t(
      'An estimate under Labour Law 6/2010 from the company’s payroll settings, not legal advice. The quote shows the sell prices only.',
    ),
  };
}
