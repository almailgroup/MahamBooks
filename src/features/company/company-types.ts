import type { Company, CompanyType } from '@/db/types';
import type { Language } from '@/i18n';
import { localName } from '@/i18n/names';
import { stableId } from '@/lib/ids';
import { normalizeSearch } from '@/features/search/normalize';

/**
 * Company types: the line of business, a label next to the company's name.
 * Taxes, the statutory reserve and deadlines follow the legal form, never the
 * type. There is no stored list: the picker offers the built-in types (fixed
 * ids) and the types other companies on this device use, so the same type
 * keeps the same id on every device and companies can be grouped by it.
 */

/** Offered on every device, in this order. */
export const COMPANY_TYPES: readonly CompanyType[] = [
  { id: 'security', name: 'Security services', nameAr: 'الخدمات الأمنية' },
  { id: 'manpower', name: 'Manpower supply', nameAr: 'توريد العمالة' },
  { id: 'cleaning', name: 'Cleaning services', nameAr: 'خدمات التنظيف' },
  { id: 'trading', name: 'General trading', nameAr: 'التجارة العامة' },
  { id: 'contracting', name: 'Contracting', nameAr: 'المقاولات' },
];

const builtIn = (id: string) => COMPANY_TYPES.find((type) => type.id === id);

const tidy = (text: unknown) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '');

/** A new type with these names. Its id follows from the name: typed the same on two devices, it is one type. */
export function newCompanyType(name: string, nameAr = ''): CompanyType {
  const key = normalizeSearch(name.trim() || nameAr.trim());
  return { id: stableId(`company-type:${key}`), name, nameAr };
}

/** The type as it is saved: names trimmed, or undefined when it has no name (empty means missing). */
export function normalizeCompanyType(
  type: CompanyType | null | undefined,
): CompanyType | undefined {
  if (!type || typeof type !== 'object') return undefined;
  const nameAr = tidy(type.nameAr);
  const name = tidy(type.name) || nameAr;
  if (!name) return undefined;
  const id = tidy(type.id) || newCompanyType(name).id;
  return nameAr ? { id, name, nameAr } : { id, name };
}

/** The type's name in a language; built-in types always use their own names. */
export function companyTypeName(type: CompanyType | null | undefined, language?: Language): string {
  const known = normalizeCompanyType(type);
  if (!known) return '';
  return localName(builtIn(known.id) ?? known, language);
}

/**
 * The types to choose from: the built-in ones, then those the given
 * companies use, once each (by id) and by name. A type named in Arabic on one
 * company and not on another keeps its Arabic name.
 */
export function companyTypeOptions(
  companies: readonly Pick<Company, 'companyType'>[],
  language: Language = 'en',
): CompanyType[] {
  const used = new Map<string, CompanyType>();
  for (const company of companies) {
    const type = normalizeCompanyType(company.companyType);
    if (!type || builtIn(type.id)) continue;
    const before = used.get(type.id);
    if (!before || (!before.nameAr && type.nameAr)) used.set(type.id, type);
  }
  const others = [...used.values()].sort((a, b) =>
    companyTypeName(a, language).localeCompare(companyTypeName(b, language), language),
  );
  return [...COMPANY_TYPES.map((type) => ({ ...type })), ...others];
}

/**
 * The type to save, given the types already known (`companyTypeOptions`):
 * a built-in type with its own names, a known type as it is, and a new type
 * named like a known one as that known type, so the same line of business
 * isn't spelt two ways. Only when every name typed is the known type's (the
 * other language left empty): a type that shares one name but not the other
 * is another type. Typed with a known type's English name and another
 * Arabic name, it is that type with its Arabic name corrected (a built-in
 * type keeps its own).
 */
export function resolveCompanyType(
  type: CompanyType | null | undefined,
  known: readonly CompanyType[],
): CompanyType | undefined {
  const tidied = normalizeCompanyType(type);
  if (!tidied) return undefined;
  const fixed = builtIn(tidied.id);
  if (fixed) return { ...fixed };
  if (known.some((k) => k.id === tidied.id)) return tidied;
  const names = (t: Partial<CompanyType>) =>
    [tidy(t.name), tidy(t.nameAr)].map((n) => normalizeSearch(n)).filter(Boolean);
  const typed = names(type ?? {});
  const same = known.find((k) => typed.every((n) => names(k).includes(n)));
  if (same) return normalizeCompanyType(same) ?? tidied;
  const english = normalizeSearch(tidy(type?.name));
  const nameAr = tidy(type?.nameAr);
  const renamed =
    english && nameAr ? known.find((k) => normalizeSearch(tidy(k.name)) === english) : undefined;
  if (renamed) {
    const own = builtIn(renamed.id);
    return own ? { ...own } : { id: renamed.id, name: tidy(renamed.name), nameAr };
  }
  return tidied;
}

/**
 * The company as the forms save it: its type resolved (and removed when
 * empty), and the description of the legal form kept only, trimmed, while
 * the legal form is Other.
 */
export function withTidyProfile(company: Company, known: readonly CompanyType[]): Company {
  const next: Company = { ...company };
  const type = resolveCompanyType(company.companyType, known);
  if (type) next.companyType = type;
  else delete next.companyType;
  if (next.kuwait) {
    const { legalFormOther, ...kuwait } = next.kuwait;
    const described = next.kuwait.legalForm === 'other' ? tidy(legalFormOther) : '';
    next.kuwait = described ? { ...kuwait, legalFormOther: described } : kuwait;
  }
  return next;
}
