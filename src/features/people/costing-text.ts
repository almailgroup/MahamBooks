import type { StaffingCosting } from '@/db/types';
import { markupForMargin, sellPriceFor } from '@/lib/hr/costing';
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

/** A margin and the markup it makes, in words. */
export function marginExplained(margin: number): string {
  return t(
    'A {margin}% margin is a {markup}% markup on cost: a cost of 100.000 sells at {price}. The margin is a share of the sell price; a markup is added to the cost.',
    {
      margin: Math.round(margin * 100) / 100,
      markup: markupForMargin(margin),
      price: sellPriceFor(100, margin).toFixed(3),
    },
  );
}
