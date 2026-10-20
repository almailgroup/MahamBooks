import type {
  ContractType,
  Employee,
  EmployeeCategory,
  EmployeeStatus,
  Gender,
  ISODate,
  LeavingReason,
  PayBasis,
} from '@/db/types';
import { addDaysISO, parseISODate } from '@/lib/dates';
import { KUWAIT_WEEKEND, kuwaitHolidays } from '@/lib/kuwait';
import { isKnown, lookup } from '@/lib/known';
import { msg } from '@/i18n';
import type { EosiReason } from './eosi';

/** GCC countries other than Kuwait; their nationals need no residency in Kuwait. */
export const GCC_COUNTRIES = ['SA', 'AE', 'BH', 'QA', 'OM'];

/** The category that usually goes with a nationality (domestic workers are chosen by hand). */
export function categoryForNationality(nationality: string): Exclude<EmployeeCategory, 'domestic'> {
  const code = nationality.toUpperCase();
  if (code === 'KW') return 'kuwaiti';
  if (GCC_COUNTRIES.includes(code)) return 'gcc';
  return 'expat';
}

/** A category, or an employee, whose stateless flag counts too. */
export type CategoryOf = EmployeeCategory | Pick<Employee, 'category' | 'stateless'>;

const categoryOf = (who: CategoryOf): EmployeeCategory =>
  typeof who === 'string' ? who : who.category;

/**
 * Stateless (Bedoon): the flag on an expatriate. An older version that
 * changed the category leaves the flag behind; the category wins.
 */
export function isStateless(employee: Partial<Pick<Employee, 'category' | 'stateless'>>): boolean {
  return employee.stateless === true && employee.category === 'expat';
}

/**
 * Expatriates and domestic workers hold a residency (Article 18 or 20);
 * stateless staff never need one (they hold a Central Agency review card).
 */
export function needsResidency(who: CategoryOf): boolean {
  if (typeof who !== 'string' && isStateless(who)) return false;
  const category = categoryOf(who);
  return category === 'expat' || category === 'domestic';
}

/**
 * Expatriates in the private sector work under a PAM work permit. Stateless
 * staff may have one too: like everyone's, its fields are optional, and it
 * is tracked only once entered.
 */
export function needsWorkPermit(who: CategoryOf): boolean {
  return categoryOf(who) === 'expat';
}

/** Kuwaiti and GCC staff are insured with PIFSS. */
export function insuredWithPifss(category: EmployeeCategory): boolean {
  return category === 'kuwaiti' || category === 'gcc';
}

/** Domestic workers are covered by Law 68/2015, not by the private sector Labour Law. */
export function underLabourLaw(category: EmployeeCategory): boolean {
  return category !== 'domestic';
}

/** Still on the books (active or on leave). */
export function isCurrent(employee: Pick<Employee, 'status'>): boolean {
  return employee.status !== 'left';
}

export const CATEGORY_LABELS: Record<EmployeeCategory, string> = {
  kuwaiti: msg('Kuwaiti'),
  gcc: msg('GCC national'),
  expat: msg('Expatriate'),
  domestic: msg('Domestic worker'),
};

/** Stateless (Bedoon) staff, in words: shown instead of "Expatriate". */
export const STATELESS_LABEL = msg('Stateless (Bedoon)');

/**
 * An employee's category in words (English key), also for one a newer
 * version saved. Given the employee, stateless staff are named so.
 */
export function categoryLabel(who: string | Pick<Employee, 'category' | 'stateless'>): string {
  if (typeof who !== 'string' && isStateless(who)) return STATELESS_LABEL;
  return lookup(CATEGORY_LABELS, typeof who === 'string' ? who : who.category, msg('Other'));
}

/** What lists filter staff by: a category, or the stateless among the expatriates. */
export type CategoryFilter = EmployeeCategory | 'stateless';

export const CATEGORY_FILTERS: CategoryFilter[] = [
  'kuwaiti',
  'gcc',
  'expat',
  'stateless',
  'domestic',
];

export const CATEGORY_FILTER_LABELS: Record<CategoryFilter, string> = {
  ...CATEGORY_LABELS,
  stateless: STATELESS_LABEL,
};

/** Whether an employee is in a filter's group ("Expatriate" leaves the stateless out). */
export function inCategory(
  employee: Pick<Employee, 'category' | 'stateless'>,
  filter: CategoryFilter,
): boolean {
  if (filter === 'stateless') return isStateless(employee);
  if (filter === 'expat') return employee.category === 'expat' && !isStateless(employee);
  return employee.category === filter;
}

export const GENDER_LABELS: Record<Gender, string> = {
  male: msg('Male'),
  female: msg('Female'),
};

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: msg('Active'),
  on_leave: msg('On leave'),
  left: msg('Left'),
};

/** An employee's status in words (English key), also for one a newer version saved. */
export function employeeStatusLabel(status: string): string {
  return lookup(STATUS_LABELS, status, msg('Other'));
}

export const CONTRACT_LABELS: Record<ContractType, string> = {
  unlimited: msg('Unlimited'),
  fixed: msg('Fixed term'),
};

export const PAY_BASIS_LABELS: Record<PayBasis, string> = {
  monthly: msg('Monthly'),
  daily: msg('Daily'),
  hourly: msg('Hourly'),
  piece: msg('Piece rate'),
};

export const LEAVING_REASON_LABELS: Record<LeavingReason, string> = {
  resignation: msg('Resignation'),
  termination: msg('Ended by the employer'),
  contract_end: msg('End of fixed-term contract'),
  retirement: msg('Retirement'),
  dismissal: msg('Dismissal for a serious fault (art. 41)'),
  death: msg('Death'),
  other: msg('Other'),
};

/**
 * The end-of-service rule that applies to a leaving reason. Only a reason
 * someone chose: a missing one is asked for, never taken as a termination.
 */
export function eosiReasonFor(reason: LeavingReason): EosiReason {
  if (reason === 'resignation') return 'resignation';
  if (reason === 'dismissal') return 'dismissal';
  return 'termination';
}

/** Residency articles of the Aliens Residence Law that employers deal with. */
export const RESIDENCY_ARTICLES: { value: string; label: string }[] = [
  { value: '18', label: msg('Article 18 – private sector work') },
  { value: '17', label: msg('Article 17 – government work') },
  { value: '19', label: msg('Article 19 – partner or investor') },
  { value: '20', label: msg('Article 20 – domestic worker') },
  { value: '22', label: msg('Article 22 – family') },
  { value: '24', label: msg('Article 24 – self-sponsored') },
  { value: 'other', label: msg('Other') },
];

/** Longest probation allowed by Labour Law 6/2010 art. 32, in working days. */
export const MAX_PROBATION_WORKING_DAYS = 100;

const holidayCache = new Map<number, Set<ISODate>>();

function isHoliday(date: ISODate): boolean {
  const year = Number(date.slice(0, 4));
  let days = holidayCache.get(year);
  if (!days) {
    days = new Set(kuwaitHolidays(year).map((h) => h.date));
    holidayCache.set(year, days);
  }
  return days.has(date);
}

/** A working day in Kuwait: not Friday or Saturday and not a public holiday. */
export function isWorkingDay(date: ISODate): boolean {
  return !KUWAIT_WEEKEND.includes(parseISODate(date).getDay()) && !isHoliday(date);
}

/** The last day a probation starting on `hireDate` may run to (its 100th working day). */
export function probationLimit(
  hireDate: ISODate,
  workingDays = MAX_PROBATION_WORKING_DAYS,
): ISODate {
  let date = hireDate;
  let counted = isWorkingDay(date) ? 1 : 0;
  while (counted < workingDays) {
    date = addDaysISO(date, 1);
    if (isWorkingDay(date)) counted += 1;
  }
  return date;
}

export interface WorkforceSummary {
  /** Active and on-leave staff. */
  headcount: number;
  /**
   * Staff in each known category (one a newer version saved counts in none);
   * expatriates without the stateless, who are counted on their own.
   */
  byCategory: Record<EmployeeCategory, number>;
  /** Stateless (Bedoon) staff. */
  stateless: number;
  /** Staff covered by the Labour Law (everyone except domestic workers). */
  labourLawHeadcount: number;
  /** Kuwaitis as a share of the Labour Law headcount, 0–100, or null with no staff. */
  kuwaitiShare: number | null;
}

/** Headcount and the Kuwaiti share ("Kuwaitization") of the current staff. */
export function workforceSummary(
  employees: (Pick<Employee, 'status' | 'category'> & Partial<Pick<Employee, 'stateless'>>)[],
): WorkforceSummary {
  const byCategory: Record<EmployeeCategory, number> = {
    kuwaiti: 0,
    gcc: 0,
    expat: 0,
    domestic: 0,
  };
  let stateless = 0;
  const current = employees.filter(isCurrent);
  for (const e of current) {
    if (isStateless(e)) stateless += 1;
    else if (isKnown(byCategory, e.category)) byCategory[e.category] += 1;
  }
  const labourLawHeadcount = current.length - byCategory.domestic;
  return {
    headcount: current.length,
    byCategory,
    stateless,
    labourLawHeadcount,
    kuwaitiShare:
      labourLawHeadcount > 0
        ? Math.round((byCategory.kuwaiti / labourLawHeadcount) * 1000) / 10
        : null,
  };
}
