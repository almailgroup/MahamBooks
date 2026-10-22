import type { StaffingCosting } from '@/db/types';
import { COSTING_RULES, markupForMargin, percentOf, sellPriceFor } from '@/lib/hr/costing';
import { dec, round } from '@/lib/money';
import type { StatusTone } from '@/lib/status';
import { t } from '@/i18n';

/** How each status of a manpower costing shows. */
export const COSTING_STATUS_TONES: Record<StaffingCosting['status'], StatusTone> = {
  draft: 'gray',
  quoted: 'blue',
  won: 'green',
  lost: 'red',
};

/** The sell price of a costing a month, as last saved. */
export function costingMonthly(costing: Pick<StaffingCosting, 'posts'>): number {
  return round(
    costing.posts.reduce((s, p) => s.plus(dec(p.sellPrice).times(p.headcount)), dec(0)),
    3,
  );
}

/** A margin and the markup it makes, in words: as priced, at most COSTING_RULES.maxMarginPercent. */
export function marginExplained(typed: number): string {
  const margin = percentOf(typed, COSTING_RULES.maxMarginPercent);
  return t(
    'A {margin}% margin is a {markup}% markup on cost: a cost of 100.000 sells at {price}. The margin is a share of the sell price; a markup is added to the cost.',
    {
      margin,
      markup: markupForMargin(margin),
      price: sellPriceFor(100, margin).toFixed(3),
    },
  );
}
