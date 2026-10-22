import type {
  ContributionRates,
  CostingCategory,
  CostingPost,
  CostingRate,
  CostingSettings,
  Employee,
  GccScheme,
  LineItem,
  StaffingCosting,
  TaxLine,
} from '@/db/types';
import { shortId } from '@/lib/ids';
import { dec, round, type Decimal, type Numeric } from '@/lib/money';
import { currentLanguage, msg, t } from '@/i18n';
import { calculateEosi } from './eosi';
import { arabicJobTitle } from './job-titles';
import { nationalityKey as titleKey } from './nationalities';
import { contributionRates, contributions, PAYROLL_RULES } from './payroll';

/**
 * Manpower costing (تسعير العمالة, #3): what a post of guards, cleaners or
 * other staff costs the company a month, and the price to the client that
 * leaves the company's margin.
 *
 * A person's month costs their wage (basic salary and allowances),
 * overtime, the employer's PIFSS share (Kuwaiti and GCC posts only), the
 * end-of-service indemnity they earn in the month, a month's share of their
 * annual leave's pay and other costs (uniform, residency, medical cover,
 * transport). Overhead is added on that cost, and the sell price is the cost
 * with overhead divided by (1 − margin): the margin is a share of the sell
 * price, not a markup on the cost.
 *
 * Hours past eight a day are overtime at 1.25 (art. 66 of Labour Law
 * 6/2010), which allows at most two hours of overtime a day unless an
 * exemption applies: a post that needs more is priced and flagged, for the
 * owner to confirm with counsel. Days past the working days of a month are
 * rest days worked, at 1.5 (art. 67, which gives a day off in lieu too).
 *
 * Amounts are rounded to the currency's decimals (3 for KWD) once each, so
 * the cost sheet adds up to the fils. This is an estimate, not legal advice.
 */
export const COSTING_RULES = {
  law: 'Labour Law 6/2010, articles 51, 66, 67 and 70',
  /** The owner's choice: 10% overhead and a 15% margin, until a company sets its own. */
  overheadPercent: 10,
  marginPercent: 15,
  /** A margin of 100% would need an endless price. */
  maxMarginPercent: 90,
  maxOverheadPercent: 200,
  /** Hours of a normal working day; the rest are overtime (art. 64). */
  normalHours: PAYROLL_RULES.hoursPerDay,
  /** Overtime on a working day, and work on a rest day (arts. 66 and 67). */
  overtimeRate: PAYROLL_RULES.overtime.normal,
  restDayRate: PAYROLL_RULES.overtime.restDay,
  /** Most overtime a day without an exemption (art. 66). */
  maxOvertimeHours: 2,
  /** The law's annual leave (art. 70), when the company has no policy of its own. */
  annualLeaveDays: 30,
  defaultHoursPerDay: 8,
  defaultDaysPerMonth: 26,
} as const;

export const COSTING_CATEGORIES: CostingCategory[] = ['expat', 'kuwaiti', 'gcc'];

export const COSTING_CATEGORY_LABELS: Record<CostingCategory, string> = {
  kuwaiti: msg('Kuwaiti'),
  gcc: msg('GCC national'),
  expat: msg('Expatriate'),
};

export const COSTING_STATUS_LABELS: Record<StaffingCosting['status'], string> = {
  draft: msg('Draft'),
  quoted: msg('Quote made'),
  won: msg('Won'),
  lost: msg('Lost'),
};

/** The company's costing settings, with the owner's defaults for what isn't set. */
export function costingSettingsOf(saved: Partial<CostingSettings> | null | undefined) {
  const number = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    on: saved?.on === true,
    overheadPercent: number(saved?.overheadPercent, COSTING_RULES.overheadPercent),
    marginPercent: number(saved?.marginPercent, COSTING_RULES.marginPercent),
    rates: Array.isArray(saved?.rates) ? saved.rates : undefined,
  } satisfies CostingSettings;
}

const isCategory = (value: unknown): value is CostingCategory =>
  value === 'kuwaiti' || value === 'gcc' || value === 'expat';

/** An amount as kept: 0 or more, to the currency's decimals. */
const amountOf = (value: unknown, precision: number) =>
  typeof value === 'number' && Number.isFinite(value) ? round(Math.max(0, value), precision) : 0;

/** A rate of the rate card as it is kept: a job title, its kind of staff and its pay. */
export function normalizeRate(input: Partial<CostingRate>, precision = 3): CostingRate {
  const category = isCategory(input.category) ? input.category : 'expat';
  const nationality =
    category === 'gcc' && typeof input.nationality === 'string'
      ? input.nationality.trim().toUpperCase()
      : '';
  const jobTitleAr = typeof input.jobTitleAr === 'string' ? input.jobTitleAr.trim() : '';
  const other = amountOf(input.otherCosts, precision);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : shortId(),
    jobTitle: typeof input.jobTitle === 'string' ? input.jobTitle.trim() : '',
    ...(jobTitleAr ? { jobTitleAr } : {}),
    category,
    ...(nationality ? { nationality } : {}),
    basic: amountOf(input.basic, precision),
    allowances: amountOf(input.allowances, precision),
    ...(other ? { otherCosts: other } : {}),
    ...(typeof input.count === 'number' && input.count > 0
      ? { count: Math.round(input.count) }
      : {}),
  };
}

/** The costing settings as they are kept on the People settings record. */
export function normalizeCostingSettings(
  input: Partial<CostingSettings>,
  precision = 3,
): CostingSettings {
  const settings = costingSettingsOf(input);
  return {
    on: settings.on,
    overheadPercent: percentOf(settings.overheadPercent, COSTING_RULES.maxOverheadPercent),
    marginPercent: percentOf(settings.marginPercent, COSTING_RULES.maxMarginPercent),
    ...(settings.rates
      ? {
          rates: settings.rates
            .map((rate) => normalizeRate(rate, precision))
            .filter((rate) => rate.jobTitle !== ''),
        }
      : {}),
  };
}

/** What a post is priced with: the company's payroll and People settings. */
export interface CostingBasis {
  /** Decimals of the currency (3 for KWD). */
  precision: number;
  /** Working days in a month for the daily rate (payroll settings, 26). */
  dailyDivisor: number;
  /** Overtime is worked out on the basic salary or the whole wage (payroll settings). */
  rateBase: 'basic' | 'wage';
  /** PIFSS rates in force today; null when none are set. */
  pifss: ContributionRates | null;
  gcc: GccScheme[];
  minimumWage: number;
  /** Working days in a month for the indemnity's daily wage (People settings, 26). */
  eosDivisor: number;
  /** Staff insured with PIFSS earn an indemnity provision too (payroll settings). */
  eosForInsured: boolean;
  /** Days of annual leave a year (the company's policy, 30 by law). */
  annualLeaveDays: number;
}

export const DEFAULT_COSTING_BASIS: CostingBasis = {
  precision: 3,
  dailyDivisor: PAYROLL_RULES.dailyDivisor,
  rateBase: 'wage',
  pifss: {
    from: PAYROLL_RULES.pifss.from,
    employer: PAYROLL_RULES.pifss.employer,
    employee: PAYROLL_RULES.pifss.employee,
    cap: PAYROLL_RULES.pifss.cap,
  },
  gcc: [],
  minimumWage: PAYROLL_RULES.minimumWage,
  eosDivisor: 26,
  eosForInsured: true,
  annualLeaveDays: COSTING_RULES.annualLeaveDays,
};

export type CostingWarningKind =
  'overtime_limit' | 'rest_days' | 'below_minimum_wage' | 'pifss_missing' | 'gcc_scheme_missing';

export interface CostingWarning {
  kind: CostingWarningKind;
  postId: string;
  jobTitle: string;
  jobTitleAr?: string;
  /** Overtime hours a day (overtime_limit), rest days a month (rest_days). */
  value?: number;
}

/** What one person of a post costs and sells for a month. */
export interface PostPrice {
  /** Basic salary and allowances. */
  wage: number;
  /** Overtime hours a working day. */
  overtimeHours: number;
  /** Rest days worked a month. */
  restDays: number;
  /** Overtime on working days, at 1.25. */
  overtime: number;
  /** Rest days worked, at 1.5. */
  restDayPay: number;
  employerPifss: number;
  eosi: number;
  leave: number;
  otherCosts: number;
  /** Everything above: what the person costs, before overhead. */
  cost: number;
  overhead: number;
  /** Cost and overhead. */
  fullCost: number;
  sell: number;
  /** Sell price less cost and overhead. */
  margin: number;
}

export interface PricedPost {
  post: CostingPost;
  perPerson: PostPrice;
  /** For the post's headcount. */
  total: { cost: number; overhead: number; fullCost: number; sell: number; margin: number };
  warnings: CostingWarning[];
}

export interface PricedCosting {
  posts: PricedPost[];
  totals: {
    headcount: number;
    cost: number;
    overhead: number;
    fullCost: number;
    sell: number;
    margin: number;
    /** The margin as a share of the sell price, as it came out. */
    marginPercent: number;
    /** The same margin as a markup on cost and overhead. */
    markupPercent: number;
  };
  warnings: CostingWarning[];
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** A percentage as used in prices: 0 or more, to two decimals. */
export function percentOf(value: number, max: number): number {
  return round(clamp(value, 0, max), 2);
}

/**
 * The sell price that leaves `marginPercent` of it as margin: cost ÷ (1 −
 * margin). A 15% margin on a cost of 100 sells at 117.647, which is a
 * markup of 17.647% on the cost; a 15% markup would sell at 115, a margin
 * of only 13.043%.
 */
export function sellPriceFor(cost: Numeric, marginPercent: number, precision = 3): number {
  const margin = percentOf(marginPercent, COSTING_RULES.maxMarginPercent);
  return round(dec(cost).dividedBy(dec(100).minus(margin)).times(100), precision);
}

/** The markup on cost that gives a margin: m ÷ (1 − m). 15% → 17.647%. */
export function markupForMargin(marginPercent: number): number {
  const margin = percentOf(marginPercent, COSTING_RULES.maxMarginPercent);
  return round(dec(margin).times(100).dividedBy(dec(100).minus(margin)), 3);
}

/** The margin a markup on cost gives: k ÷ (1 + k). 15% → 13.043%. */
export function marginForMarkup(markupPercent: number): number {
  const markup = Math.max(0, Number.isFinite(markupPercent) ? markupPercent : 0);
  return round(dec(markup).times(100).dividedBy(dec(100).plus(markup)), 3);
}

const categoryOf = (post: Pick<CostingPost, 'category'>): CostingCategory =>
  post.category === 'kuwaiti' || post.category === 'gcc' ? post.category : 'expat';

/** Whole people, at least one. */
const headcountOf = (n: number) => Math.max(1, Math.round(Number.isFinite(n) ? n : 1));

/**
 * Prices one post: what a person costs and sells for a month, and the
 * post's totals for its headcount, with what needs a second look.
 */
export function pricePost(
  input: CostingPost,
  basis: CostingBasis,
  overheadPercent: number,
  marginPercent: number,
): PricedPost {
  const p = basis.precision;
  const post: CostingPost = {
    ...input,
    headcount: headcountOf(input.headcount),
    hoursPerDay: round(clamp(input.hoursPerDay, 1, 24), 2),
    daysPerMonth: round(clamp(input.daysPerMonth, 1, 31), 2),
    basic: round(Math.max(0, input.basic || 0), p),
    allowances: round(Math.max(0, input.allowances || 0), p),
    otherCosts: round(Math.max(0, input.otherCosts || 0), p),
  };
  const category = categoryOf(post);
  const warnings: CostingWarning[] = [];
  const warn = (kind: CostingWarningKind, value?: number) =>
    warnings.push({
      kind,
      postId: post.id,
      jobTitle: post.jobTitle,
      ...(post.jobTitleAr ? { jobTitleAr: post.jobTitleAr } : {}),
      ...(value !== undefined ? { value } : {}),
    });

  const divisor = basis.dailyDivisor > 0 ? basis.dailyDivisor : PAYROLL_RULES.dailyDivisor;
  const wage = dec(post.basic).plus(post.allowances);
  const rateWage = basis.rateBase === 'basic' ? dec(post.basic) : wage;
  // Not rounded: each amount below is rounded once.
  const hourly: Decimal = rateWage.dividedBy(divisor).dividedBy(COSTING_RULES.normalHours);

  const overtimeHours = round(Math.max(0, post.hoursPerDay - COSTING_RULES.normalHours), 2);
  const workingDays = Math.min(post.daysPerMonth, divisor);
  const restDays = round(Math.max(0, post.daysPerMonth - divisor), 2);
  const overtime = round(
    hourly.times(overtimeHours).times(workingDays).times(COSTING_RULES.overtimeRate),
    p,
  );
  const restDayPay = round(
    hourly.times(post.hoursPerDay).times(restDays).times(COSTING_RULES.restDayRate),
    p,
  );
  if (overtimeHours > COSTING_RULES.maxOvertimeHours) warn('overtime_limit', overtimeHours);
  if (restDays > 0) warn('rest_days', restDays);
  if (post.basic < basis.minimumWage) warn('below_minimum_wage');

  // The employer's PIFSS share, on the insured salary up to its cap.
  let employerPifss = 0;
  const insured = category === 'kuwaiti' || category === 'gcc';
  if (insured) {
    const { rates } = contributionRates(
      { category, nationality: post.nationality ?? '' },
      { pifss: basis.pifss, gcc: basis.gcc },
    );
    if (rates) employerPifss = contributions(wage, 1, rates, p).employer;
    else warn(category === 'gcc' ? 'gcc_scheme_missing' : 'pifss_missing');
  }

  // The indemnity a month of service earns, at the rate of the first five
  // years (15 days' wage a year, art. 51): a post staffed afresh. Staff
  // insured with PIFSS earn none when the payroll leaves them out of it.
  const eosi =
    insured && !basis.eosForInsured
      ? 0
      : round(
          dec(
            calculateEosi({
              payBasis: 'monthly',
              monthlyWage: wage.toNumber(),
              years: 1,
              reason: 'termination',
              dailyDivisor: basis.eosDivisor,
              precision: 9,
            }).payable,
          ).dividedBy(12),
          p,
        );

  // A month's share of the annual leave's pay: the cover while they are away.
  const leaveDays = basis.annualLeaveDays > 0 ? basis.annualLeaveDays : 30;
  const leave = round(wage.dividedBy(divisor).times(leaveDays).dividedBy(12), p);

  const cost = round(
    dec(post.basic)
      .plus(post.allowances)
      .plus(overtime)
      .plus(restDayPay)
      .plus(employerPifss)
      .plus(eosi)
      .plus(leave)
      .plus(post.otherCosts),
    p,
  );
  const overheadShare = percentOf(overheadPercent, COSTING_RULES.maxOverheadPercent);
  const overhead = round(dec(cost).times(overheadShare).dividedBy(100), p);
  const fullCost = round(dec(cost).plus(overhead), p);
  const sell = sellPriceFor(fullCost, marginPercent, p);
  const margin = round(dec(sell).minus(fullCost), p);

  const times = (n: number) => round(dec(n).times(post.headcount), p);
  const priced: CostingPost = {
    ...post,
    category,
    overtimeMonthly: round(dec(overtime).plus(restDayPay), p),
    employerPifss,
    eosiMonthly: eosi,
    leaveMonthly: leave,
    monthlyCost: cost,
    sellPrice: sell,
  };
  if (category !== 'gcc') delete priced.nationality;
  return {
    post: priced,
    perPerson: {
      wage: round(wage, p),
      overtimeHours,
      restDays,
      overtime,
      restDayPay,
      employerPifss,
      eosi,
      leave,
      otherCosts: post.otherCosts,
      cost,
      overhead,
      fullCost,
      sell,
      margin,
    },
    total: {
      cost: times(cost),
      overhead: times(overhead),
      fullCost: times(fullCost),
      sell: times(sell),
      margin: times(margin),
    },
    warnings,
  };
}

/** Prices every post of a costing, with its totals. */
export function priceCosting(
  costing: Pick<StaffingCosting, 'posts' | 'overheadPercent' | 'marginPercent'>,
  basis: CostingBasis,
): PricedCosting {
  const p = basis.precision;
  const posts = costing.posts.map((post) =>
    pricePost(post, basis, costing.overheadPercent, costing.marginPercent),
  );
  const add = (pick: (x: PricedPost) => number) =>
    round(
      posts.reduce((s, x) => s.plus(pick(x)), dec(0)),
      p,
    );
  const fullCost = add((x) => x.total.fullCost);
  const sell = add((x) => x.total.sell);
  const margin = add((x) => x.total.margin);
  return {
    posts,
    totals: {
      headcount: posts.reduce((s, x) => s + x.post.headcount, 0),
      cost: add((x) => x.total.cost),
      overhead: add((x) => x.total.overhead),
      fullCost,
      sell,
      margin,
      marginPercent: sell > 0 ? round(dec(margin).times(100).dividedBy(sell), 2) : 0,
      markupPercent: fullCost > 0 ? round(dec(margin).times(100).dividedBy(fullCost), 2) : 0,
    },
    warnings: posts.flatMap((x) => x.warnings),
  };
}

/** A warning in words, in the interface language. */
export function costingWarningText(warning: CostingWarning): string {
  const title = (currentLanguage() === 'ar' && warning.jobTitleAr) || warning.jobTitle;
  const vars = { title: title || t('A post'), value: warning.value ?? 0 };
  switch (warning.kind) {
    case 'overtime_limit':
      return t(
        '{title}: {value} hours of overtime a day. Article 66 of Labour Law 6/2010 allows at most 2 a day unless an exemption applies. Confirm with counsel before quoting, or add people to the post.',
        vars,
      );
    case 'rest_days':
      return t(
        '{title}: {value} rest days worked a month, priced at 1.5. Article 67 also gives a day off in lieu for each; relief staff may cost less.',
        vars,
      );
    case 'below_minimum_wage':
      return t('{title}: the basic salary is below the minimum wage in Payroll settings.', vars);
    case 'pifss_missing':
      return t(
        '{title}: no PIFSS rates are set in Payroll settings, so the employer’s share is left out.',
        vars,
      );
    case 'gcc_scheme_missing':
      return t(
        '{title}: no rates are set for this GCC nationality in Payroll settings, so the employer’s share is left out.',
        vars,
      );
    default:
      return vars.title;
  }
}

/** A new post: one person, 8 hours a day, 26 days a month, from a rate when given. */
export function newPost(rate?: Partial<CostingRate>): CostingPost {
  return {
    id: shortId(),
    jobTitle: rate?.jobTitle ?? '',
    ...(rate?.jobTitleAr ? { jobTitleAr: rate.jobTitleAr } : {}),
    category: rate?.category ?? 'expat',
    ...(rate?.category === 'gcc' && rate.nationality ? { nationality: rate.nationality } : {}),
    headcount: 1,
    hoursPerDay: COSTING_RULES.defaultHoursPerDay,
    daysPerMonth: COSTING_RULES.defaultDaysPerMonth,
    basic: rate?.basic ?? 0,
    allowances: rate?.allowances ?? 0,
    employerPifss: 0,
    eosiMonthly: 0,
    leaveMonthly: 0,
    otherCosts: rate?.otherCosts ?? 0,
    monthlyCost: 0,
    sellPrice: 0,
  };
}

type PayOf = Pick<
  Employee,
  | 'jobTitle'
  | 'jobTitleAr'
  | 'category'
  | 'nationality'
  | 'status'
  | 'payBasis'
  | 'basicSalary'
  | 'allowances'
>;

/** The value most of them have (the first of the most common), or ''. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '';
  let most = 0;
  for (const [value, n] of counts) {
    if (n > most) {
      best = value;
      most = n;
    }
  }
  return best;
}

/**
 * The rate card as the current salaries have it: for each job title and
 * kind of staff (expatriate, Kuwaiti, GCC), the average basic salary and
 * allowances of the employees still on the books. Worked out on this
 * device, from the salaries of people the person may see: only for owners,
 * admins and accountants. Domestic workers (Law 68/2015), staff paid by the
 * day, the hour or the piece and employees without a job title are left
 * out. An average of one person is that person's salary.
 */
export function averageRates(employees: readonly PayOf[], precision = 3): CostingRate[] {
  const groups = new Map<string, PayOf[]>();
  for (const e of employees) {
    if (e.status === 'left' || e.category === 'domestic' || e.payBasis !== 'monthly') continue;
    const title = titleKey(e.jobTitle ?? '');
    if (!title) continue;
    const category: CostingCategory =
      e.category === 'kuwaiti' || e.category === 'gcc' ? e.category : 'expat';
    const key = `${title}|${category}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const rates: CostingRate[] = [];
  for (const [key, list] of groups) {
    const category = key.split('|')[1] as CostingCategory;
    const jobTitle = mostCommon(list.map((e) => e.jobTitle.trim()));
    const jobTitleAr =
      mostCommon(list.map((e) => (e.jobTitleAr ?? '').trim())) || arabicJobTitle(jobTitle);
    const average = (pick: (e: PayOf) => Decimal) =>
      round(list.reduce((s, e) => s.plus(pick(e)), dec(0)).dividedBy(list.length), precision);
    const nationality = category === 'gcc' ? mostCommon(list.map((e) => e.nationality)) : '';
    rates.push({
      id: key,
      jobTitle,
      ...(jobTitleAr ? { jobTitleAr } : {}),
      category,
      ...(nationality ? { nationality } : {}),
      basic: average((e) => dec(e.basicSalary)),
      allowances: average((e) => e.allowances.reduce((s, a) => s.plus(a.amount), dec(0))),
      count: list.length,
    });
  }
  return rates.sort(
    (a, b) => (b.count ?? 0) - (a.count ?? 0) || a.jobTitle.localeCompare(b.jobTitle),
  );
}

/**
 * The quote's lines for a costing: one a post, with its job title, the
 * hours and days it covers, the headcount and the sell price per person a
 * month. Never anything else of the costing: no salary, allowance, PIFSS,
 * indemnity, leave, overhead, cost or margin (staff and viewers see quotes,
 * and clients get them).
 */
export function quoteLines(posts: readonly CostingPost[], taxes: TaxLine[]): LineItem[] {
  return posts.map((post) => ({
    id: shortId(),
    kind: 'item' as const,
    productId: null,
    name: post.jobTitle,
    ...(post.jobTitleAr ? { nameAr: post.jobTitleAr } : {}),
    description: t('{hours} hours a day, {days} days a month, per person a month', {
      hours: post.hoursPerDay,
      days: post.daysPerMonth,
    }),
    quantity: post.headcount,
    unit: '',
    unitPrice: post.sellPrice,
    discount: 0,
    discountType: 'percent' as const,
    taxes: taxes.map((tax) => ({ ...tax })),
  }));
}
