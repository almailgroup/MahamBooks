import { describe, expect, it } from 'vitest';
import type { CostingPost, Employee } from '@/db/types';
import {
  averageRates,
  costingSettingsOf,
  costingWarningText,
  DEFAULT_COSTING_BASIS,
  marginForMarkup,
  markupForMargin,
  newPost,
  priceCosting,
  pricePost,
  quoteLines,
  sellPriceFor,
  type CostingBasis,
} from './costing';

/**
 * Manpower costing (#3): what a post costs and sells for. Invented posts and
 * people only.
 */

const basis: CostingBasis = { ...DEFAULT_COSTING_BASIS };

const post = (extra: Partial<CostingPost> = {}): CostingPost => ({
  ...newPost(),
  id: 'p1',
  jobTitle: 'Security Guard',
  basic: 120,
  allowances: 30,
  ...extra,
});

/** Three decimals at most, as KWD has. */
const fils = (n: number) => Math.round(n * 1000) / 1000 === n;

describe('a post of expatriate guards, 8 hours a day', () => {
  const priced = pricePost(post(), basis, 10, 15);

  it('costs the wage, the indemnity and leave earned in a month, with no PIFSS and no overtime', () => {
    expect(priced.perPerson).toMatchObject({
      wage: 150,
      overtimeHours: 0,
      overtime: 0,
      restDayPay: 0,
      employerPifss: 0,
      // 15 days' wage a year (art. 51) over 12 months: 150 × 15 ÷ 26 ÷ 12.
      eosi: 7.212,
      // 30 days' leave a year at the daily rate, over 12 months: 150 ÷ 26 × 30 ÷ 12.
      leave: 14.423,
      cost: 171.635,
    });
    expect(priced.warnings).toEqual([]);
  });

  it('adds 10% overhead and sells at a 15% margin of the price, not a 15% markup', () => {
    expect(priced.perPerson).toMatchObject({
      overhead: 17.164,
      fullCost: 188.799,
      // 188.799 ÷ 0.85, not 188.799 × 1.15 (217.119).
      sell: 222.116,
      margin: 33.317,
    });
    expect(priced.post).toMatchObject({
      monthlyCost: 171.635,
      sellPrice: 222.116,
      eosiMonthly: 7.212,
      leaveMonthly: 14.423,
      employerPifss: 0,
      overtimeMonthly: 0,
    });
  });

  it('keeps every amount to three decimals (KWD)', () => {
    const many = pricePost(
      post({ basic: 133.333, allowances: 41.777, otherCosts: 12.3456, hoursPerDay: 11 }),
      basis,
      7.5,
      18,
    );
    for (const value of Object.values(many.perPerson))
      expect(fils(value), String(value)).toBe(true);
    for (const value of Object.values(many.total)) expect(fils(value), String(value)).toBe(true);
    expect(many.post.otherCosts).toBe(12.346);
  });
});

describe('overtime', () => {
  it('prices a 12-hour post as 8 normal hours and 4 overtime hours at 1.25, with a warning', () => {
    const priced = pricePost(post({ hoursPerDay: 12 }), basis, 10, 15);
    // Hourly rate 150 ÷ 26 ÷ 8; 4 hours a day for 26 days at 1.25: 150 ÷ 8 × 4 × 1.25.
    expect(priced.perPerson.overtimeHours).toBe(4);
    expect(priced.perPerson.overtime).toBe(93.75);
    expect(priced.post.overtimeMonthly).toBe(93.75);
    expect(priced.warnings).toEqual([
      { kind: 'overtime_limit', postId: 'p1', jobTitle: 'Security Guard', value: 4 },
    ]);
    expect(costingWarningText(priced.warnings[0])).toContain('Article 66 of Labour Law 6/2010');
  });

  it('allows two hours a day without a warning (art. 66)', () => {
    const priced = pricePost(post({ hoursPerDay: 10 }), basis, 10, 15);
    expect(priced.perPerson.overtime).toBe(46.875);
    expect(priced.warnings).toEqual([]);
  });

  it('works overtime out on the basic salary when the payroll does', () => {
    const priced = pricePost(post({ hoursPerDay: 12 }), { ...basis, rateBase: 'basic' }, 10, 15);
    // 120 ÷ 8 × 4 × 1.25.
    expect(priced.perPerson.overtime).toBe(75);
  });

  it('prices rest days worked at 1.5, with a warning about the day off in lieu', () => {
    const priced = pricePost(post({ daysPerMonth: 30 }), basis, 10, 15);
    // 4 rest days of 8 hours: 150 ÷ 26 ÷ 8 × 8 × 4 × 1.5.
    expect(priced.perPerson.restDays).toBe(4);
    expect(priced.perPerson.restDayPay).toBe(34.615);
    expect(priced.warnings.map((w) => w.kind)).toEqual(['rest_days']);
  });
});

describe('PIFSS', () => {
  it('is paid by the employer for Kuwaiti posts only', () => {
    const kuwaiti = pricePost(
      post({ category: 'kuwaiti', basic: 900, allowances: 100 }),
      basis,
      0,
      0,
    );
    expect(kuwaiti.perPerson.employerPifss).toBe(115);
    const expat = pricePost(post({ category: 'expat', basic: 900, allowances: 100 }), basis, 0, 0);
    expect(expat.perPerson.employerPifss).toBe(0);
    const missing = pricePost(post({ basic: 900, allowances: 100 }), basis, 0, 0);
    expect(missing.perPerson.employerPifss).toBe(0);
  });

  it('stops at the insured salary’s cap', () => {
    const priced = pricePost(
      post({ category: 'kuwaiti', basic: 3000, allowances: 0 }),
      basis,
      0,
      0,
    );
    // 11.5% of 2,750.
    expect(priced.perPerson.employerPifss).toBe(316.25);
  });

  it('uses the home scheme of GCC posts, and says when its rates are missing', () => {
    const gcc = { ...basis, gcc: [{ country: 'SA', employer: 9, employee: 9, cap: null }] };
    const saudi = pricePost(
      post({ category: 'gcc', nationality: 'SA', basic: 900, allowances: 100 }),
      gcc,
      0,
      0,
    );
    expect(saudi.perPerson.employerPifss).toBe(90);
    expect(saudi.post.nationality).toBe('SA');
    const omani = pricePost(
      post({ category: 'gcc', nationality: 'OM', basic: 900, allowances: 100 }),
      gcc,
      0,
      0,
    );
    expect(omani.perPerson.employerPifss).toBe(0);
    expect(omani.warnings.map((w) => w.kind)).toEqual(['gcc_scheme_missing']);
    const none = pricePost(post({ category: 'kuwaiti' }), { ...basis, pifss: null }, 0, 0);
    expect(none.warnings.map((w) => w.kind)).toEqual(['pifss_missing']);
  });
});

describe('the end-of-service indemnity', () => {
  it('accrues 15 days’ wage a year on the indemnity divisor', () => {
    const priced = pricePost(
      post({ basic: 260, allowances: 0 }),
      { ...basis, eosDivisor: 26 },
      0,
      0,
    );
    // 260 × 15 ÷ 26 = 150 a year, 12.5 a month.
    expect(priced.perPerson.eosi).toBe(12.5);
    const thirty = pricePost(
      post({ basic: 260, allowances: 0 }),
      { ...basis, eosDivisor: 30 },
      0,
      0,
    );
    // 260 × 15 ÷ 30 = 130 a year.
    expect(thirty.perPerson.eosi).toBe(10.833);
  });

  it('leaves out Kuwaiti and GCC posts when the payroll leaves insured staff out of it', () => {
    const insured = { ...basis, eosForInsured: false };
    expect(pricePost(post({ category: 'kuwaiti' }), insured, 0, 0).perPerson.eosi).toBe(0);
    expect(pricePost(post({ category: 'expat' }), insured, 0, 0).perPerson.eosi).toBe(7.212);
  });
});

describe('margin and markup', () => {
  it('are not the same: a 15% margin is a 17.647% markup', () => {
    expect(sellPriceFor(100, 15)).toBe(117.647);
    expect(markupForMargin(15)).toBe(17.647);
    expect(marginForMarkup(15)).toBe(13.043);
    expect(marginForMarkup(markupForMargin(15))).toBe(15);
    expect(sellPriceFor(100, 0)).toBe(100);
  });

  it('never divides by nothing: the margin stops at 90%', () => {
    expect(sellPriceFor(100, 100)).toBe(1000);
    expect(sellPriceFor(100, -5)).toBe(100);
  });

  it('come out as asked over a whole costing', () => {
    const priced = priceCosting(
      {
        overheadPercent: 10,
        marginPercent: 15,
        posts: [
          post({ id: 'a', headcount: 6, hoursPerDay: 12 }),
          post({ id: 'b', jobTitle: 'Cleaner', basic: 95, allowances: 15, headcount: 4 }),
        ],
      },
      basis,
    );
    expect(priced.totals.headcount).toBe(10);
    expect(priced.totals.marginPercent).toBe(15);
    expect(priced.totals.markupPercent).toBe(17.65);
    expect(priced.totals.sell).toBe(
      Math.round((priced.posts[0].total.sell + priced.posts[1].total.sell) * 1000) / 1000,
    );
    // Each post's total is its price per person times its people.
    expect(priced.posts[0].total.sell).toBe(
      Math.round(priced.posts[0].perPerson.sell * 6000) / 1000,
    );
    expect(priced.warnings.map((w) => w.postId)).toEqual(['a']);
  });
});

describe('the company’s settings', () => {
  it('are off with 10% overhead and a 15% margin until set', () => {
    expect(costingSettingsOf(undefined)).toEqual({
      on: false,
      overheadPercent: 10,
      marginPercent: 15,
      rates: undefined,
    });
    expect(costingSettingsOf({ on: true, overheadPercent: 12, marginPercent: 20 })).toMatchObject({
      on: true,
      overheadPercent: 12,
      marginPercent: 20,
    });
  });
});

describe('the rate card from current salaries', () => {
  const person = (extra: Partial<Employee>) =>
    ({
      jobTitle: 'Security Guard',
      jobTitleAr: '',
      category: 'expat',
      nationality: 'IN',
      status: 'active',
      payBasis: 'monthly',
      basicSalary: 120,
      allowances: [],
      ...extra,
    }) as Employee;

  it('averages each job title and kind of staff', () => {
    const rates = averageRates([
      person({ basicSalary: 110, allowances: [allowance(20)] }),
      person({
        jobTitle: 'security guard',
        basicSalary: 130,
        allowances: [allowance(25), allowance(5)],
      }),
      person({ jobTitle: 'Security Guard', basicSalary: 125 }),
      person({ jobTitle: 'Cleaner', basicSalary: 95, jobTitleAr: 'منظف' }),
      person({ category: 'kuwaiti', basicSalary: 700, nationality: 'KW' }),
    ]);
    expect(rates).toEqual([
      {
        id: 'security guard|expat',
        jobTitle: 'Security Guard',
        jobTitleAr: 'حارس أمن',
        category: 'expat',
        basic: 121.667,
        allowances: 16.667,
        count: 3,
      },
      {
        id: 'cleaner|expat',
        jobTitle: 'Cleaner',
        jobTitleAr: 'منظف',
        category: 'expat',
        basic: 95,
        allowances: 0,
        count: 1,
      },
      {
        id: 'security guard|kuwaiti',
        jobTitle: 'Security Guard',
        jobTitleAr: 'حارس أمن',
        category: 'kuwaiti',
        basic: 700,
        allowances: 0,
        count: 1,
      },
    ]);
  });

  it('leaves out leavers, domestic workers, staff not paid monthly and untitled staff', () => {
    expect(
      averageRates([
        person({ status: 'left' }),
        person({ category: 'domestic' }),
        person({ payBasis: 'daily' }),
        person({ jobTitle: '  ' }),
      ]),
    ).toEqual([]);
  });

  it('keeps a GCC nationality for its scheme', () => {
    const [rate] = averageRates([person({ category: 'gcc', nationality: 'BH' })]);
    expect(rate).toMatchObject({ category: 'gcc', nationality: 'BH' });
  });
});

describe('the quote’s lines', () => {
  it('carry the sell price per person and nothing of the cost', () => {
    const priced = priceCosting(
      {
        overheadPercent: 10,
        marginPercent: 15,
        posts: [
          post({
            jobTitleAr: 'حارس أمن',
            headcount: 6,
            hoursPerDay: 12,
            basic: 137.25,
            allowances: 41.5,
            otherCosts: 9.875,
            category: 'kuwaiti',
          }),
        ],
      },
      basis,
    );
    const lines = quoteLines(
      priced.posts.map((x) => x.post),
      [],
    );
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({
      kind: 'item',
      name: 'Security Guard',
      nameAr: 'حارس أمن',
      quantity: 6,
      unitPrice: priced.posts[0].perPerson.sell,
      description: '12 hours a day, 26 days a month, per person a month',
    });
    const text = JSON.stringify(line);
    const p = priced.posts[0].perPerson;
    for (const amount of [137.25, 41.5, 9.875, p.cost, p.fullCost, p.overhead, p.margin, p.eosi]) {
      expect(text, String(amount)).not.toContain(String(amount));
    }
    expect(text).not.toMatch(/cost|salar|pifss|eosi|indemnity|margin|overhead|allowance|basic/i);
  });
});

function allowance(amount: number) {
  return { id: `a${amount}`, name: 'Transport', amount, countsForEos: true };
}
