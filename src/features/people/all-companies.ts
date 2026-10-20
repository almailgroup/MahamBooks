import type {
  Company,
  CompanyType,
  Employee,
  EmployeeCategory,
  ID,
  PeopleSettings,
} from '@/db/types';
import type { CloudLink } from '@/cloud/types';
import { canSeePeople } from '@/cloud/roles';
import { categoryLabel, employeeStatusLabel, isCurrent } from '@/lib/hr/employees';
import { countryName } from '@/lib/geo';
import {
  companyTypeName,
  companyTypeOptions,
  normalizeCompanyType,
} from '@/features/company/company-types';
import { compactSearch, normalizeSearch } from '@/features/search/normalize';
import { currentLanguage, t, type Language } from '@/i18n';
import { localName } from '@/i18n/names';

/**
 * Employees of several companies at once: People → All companies and the
 * search's "Employees in other companies", from what is on this device.
 * Whether a company's employees may be shown is decided by that company's
 * own link to the cloud, never by the role in the company that is open:
 * owners, admins and accountants see them, signed in with the account the
 * company was linked with, and so does anyone for a company kept on this
 * device only. Each company is also switched on first
 * (`PeopleSettings.groupSearch`); until then nothing changes.
 */

type LinkRole = Pick<CloudLink, 'userId' | 'role' | 'status'>;

/** Whether the person sees payroll and people in a company, from its own link (null: on this device only). */
export function seesPeopleIn(
  link: LinkRole | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!link) return true;
  return (
    Boolean(userId) &&
    link.userId === userId &&
    link.status !== 'removed' &&
    canSeePeople(link.role)
  );
}

export interface PeopleCompanies {
  /** Where the person sees employees: the companies that can be switched on. */
  eligible: Company[];
  /** Of those, the ones switched on: their employees are found from every company. */
  included: Company[];
}

/**
 * The companies whose employees the person may see (`links`: every link on
 * this device; a company without one is kept on this device only), and
 * those of them switched on in `settings`.
 */
export function peopleCompanies(
  companies: readonly Company[],
  links: readonly (LinkRole & Pick<CloudLink, 'companyId'>)[],
  userId: string | null | undefined,
  settings: readonly (Pick<PeopleSettings, 'companyId' | 'groupSearch'> | null | undefined)[],
): PeopleCompanies {
  const linkOf = new Map(links.map((link) => [link.companyId, link]));
  const on = new Set(settings.filter((s) => s?.groupSearch === true).map((s) => s!.companyId));
  const eligible = companies.filter((c) => seesPeopleIn(linkOf.get(c.id), userId));
  return { eligible, included: eligible.filter((c) => on.has(c.id)) };
}

export type EmployeeView = 'current' | 'left' | 'all';

const VIEWS: EmployeeView[] = ['current', 'left', 'all'];
const CATEGORIES: EmployeeCategory[] = ['kuwaiti', 'gcc', 'expat', 'domestic'];

export interface EmployeeFilters {
  query?: string;
  companyId?: ID;
  /** A company type's id. */
  typeId?: string;
  department?: string;
  category?: EmployeeCategory;
  /** Current employees unless asked otherwise. */
  view?: EmployeeView;
}

/**
 * Employees of `companies` (never of another company, whatever `employees`
 * holds) matching the filters and every word typed: names in English or
 * Arabic, number, job, department and email, and phone or Civil ID numbers
 * however they are spaced. By name, then company.
 */
export function findEmployees(
  employees: readonly Employee[],
  companies: readonly Company[],
  filters: EmployeeFilters = {},
): Employee[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const words = normalizeSearch(filters.query ?? '')
    .split(' ')
    .filter(Boolean);
  const view = filters.view ?? 'current';
  return employees
    .filter((e) => {
      const company = byId.get(e.companyId);
      if (!company) return false;
      if (filters.companyId && e.companyId !== filters.companyId) return false;
      if (filters.typeId && normalizeCompanyType(company.companyType)?.id !== filters.typeId) {
        return false;
      }
      if (filters.department && e.department.trim() !== filters.department) return false;
      if (filters.category && e.category !== filters.category) return false;
      if (view === 'current' && !isCurrent(e)) return false;
      if (view === 'left' && isCurrent(e)) return false;
      if (!words.length) return true;
      const text = normalizeSearch(
        [e.name, e.nameAr, e.number, e.jobTitle, e.jobTitleAr, e.department, e.email]
          .filter(Boolean)
          .join(' '),
      );
      const numbers = [e.phone, e.civilId].map(compactSearch).filter(Boolean);
      return words.every((w) => {
        if (text.includes(w)) return true;
        const digits = compactSearch(w);
        return digits !== '' && numbers.some((n) => n.includes(digits));
      });
    })
    .sort(
      (a, b) =>
        localName(a).localeCompare(localName(b)) ||
        localName(byId.get(a.companyId)).localeCompare(localName(byId.get(b.companyId))),
    );
}

/** The types the companies have, once each, for a filter. */
export function companyTypesOf(
  companies: readonly Company[],
  language: Language = currentLanguage(),
): CompanyType[] {
  const used = new Set(companies.map((c) => normalizeCompanyType(c.companyType)?.id));
  return companyTypeOptions(companies, language).filter((type) => used.has(type.id));
}

/** The departments the employees are in, once each, by name. */
export function departmentsOf(employees: readonly Employee[]): string[] {
  return [...new Set(employees.map((e) => e.department.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * The list as a spreadsheet: who works where, never their salary, IBAN or
 * Civil ID (the file leaves the app).
 */
export function employeesCsv(
  employees: readonly Employee[],
  companies: readonly Company[],
  locale = 'en',
): { headers: string[]; rows: string[][] } {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const language: Language = locale.startsWith('ar') ? 'ar' : 'en';
  return {
    headers: [
      t('Company'),
      t('Company type'),
      t('Number'),
      t('Name (English)'),
      t('Name (Arabic)'),
      t('Nationality'),
      t('Category'),
      t('Job title'),
      t('Department'),
      t('Hire date'),
      t('Phone'),
      t('Email'),
      t('Status'),
    ],
    rows: employees.map((e) => {
      const company = byId.get(e.companyId);
      return [
        localName(company, language),
        companyTypeName(company?.companyType, language),
        e.number,
        e.name,
        e.nameAr ?? '',
        countryName(e.nationality, locale),
        t(categoryLabel(e.category)),
        localName({ name: e.jobTitle, nameAr: e.jobTitleAr }, language),
        e.department,
        e.hireDate ?? '',
        e.phone,
        e.email,
        t(employeeStatusLabel(e.status)),
      ];
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Filters remembered in this browser                                         */
/* -------------------------------------------------------------------------- */

// Old storage names stay (src/lib/brand.ts).
const FILTERS_KEY = 'almailbooks.people.all-companies';

/** The filters last used on this device (never what was typed). */
export function loadFilters(): EmployeeFilters {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') as unknown;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const s = saved as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    return {
      companyId: text(s.companyId),
      typeId: text(s.typeId),
      department: text(s.department),
      category: CATEGORIES.find((c) => c === s.category),
      view: VIEWS.find((v) => v === s.view),
    };
  } catch {
    return {};
  }
}

export function saveFilters({ companyId, typeId, department, category, view }: EmployeeFilters) {
  try {
    localStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({ companyId, typeId, department, category, view }),
    );
  } catch {
    // Storage blocked (private window): the filters reset on the next visit.
  }
}
