import type { Department, Employee } from '@/db/types';
import type { Language } from '@/i18n';
import { localName } from '@/i18n/names';

/**
 * Departments (D11): the company's own list of names in English and Arabic,
 * kept in its people settings. Employees keep the English name in
 * `department` as before, so links, imports and older versions keep working;
 * the list names, translates and tidies them. Without a list, a department
 * is whatever was typed.
 */

const tidy = (text: unknown) => (typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : '');

/** A department's name as it is compared: without case or extra spaces. */
export function departmentKey(name: string | null | undefined): string {
  return tidy(name).toLowerCase();
}

/** The list as it is saved: names tidied, entries without a name or repeated left out. */
export function normalizeDepartments(list: unknown): Department[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Department[] = [];
  for (const item of list as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { archived, ...rest } = item as Partial<Department>;
    const id = tidy(rest.id);
    const nameAr = tidy(rest.nameAr);
    const name = tidy(rest.name) || nameAr;
    const key = departmentKey(name);
    if (!id || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...rest, id, name, nameAr, ...(archived === true ? { archived: true } : {}) });
  }
  return out;
}

/** Whether the company keeps a list of departments (an empty one is none). */
export function hasDepartmentList(list: readonly Department[] | null | undefined): boolean {
  return (list?.length ?? 0) > 0;
}

/** The entry of the list a name is, by its English name first, then its Arabic one. */
export function findDepartment(
  list: readonly Department[] | null | undefined,
  name: string | null | undefined,
): Department | undefined {
  const key = departmentKey(name);
  if (!key || !list) return undefined;
  return (
    list.find((d) => departmentKey(d.name) === key) ??
    list.find((d) => departmentKey(d.nameAr) === key)
  );
}

/** A department in the interface language: its Arabic name from the list in Arabic, else as kept. */
export function departmentLabel(
  list: readonly Department[] | null | undefined,
  name: string | null | undefined,
  language?: Language,
): string {
  const found = findDepartment(list, name);
  return found ? localName(found, language) : tidy(name);
}

/** The departments offered for a choice: those not archived, by name in the language. */
export function departmentChoices(
  list: readonly Department[] | null | undefined,
  language?: Language,
): Department[] {
  return (list ?? [])
    .filter((d) => !d.archived)
    .sort((a, b) => localName(a, language).localeCompare(localName(b, language), language));
}

/** How many of the employees are in each department of the list (by id), by its English name. */
export function departmentHeadcounts(
  list: readonly Department[] | null | undefined,
  employees: readonly Pick<Employee, 'department'>[],
): Map<string, number> {
  const ids = new Map((list ?? []).map((d) => [departmentKey(d.name), d.id]));
  const counts = new Map<string, number>();
  for (const e of employees) {
    const id = ids.get(departmentKey(e.department));
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The departments employees have that aren't the English name of one in
 * the list (old names, other spellings, typos), with how many have each.
 */
export function unlistedDepartments(
  list: readonly Department[] | null | undefined,
  employees: readonly Pick<Employee, 'department'>[],
): { name: string; count: number }[] {
  const listed = new Set((list ?? []).map((d) => departmentKey(d.name)));
  const found = new Map<string, { name: string; count: number }>();
  for (const e of employees) {
    const key = departmentKey(e.department);
    if (!key || listed.has(key)) continue;
    const before = found.get(key);
    if (before) before.count += 1;
    else found.set(key, { name: tidy(e.department), count: 1 });
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
