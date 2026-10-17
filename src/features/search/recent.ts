import type { SearchKind } from './rank';

/** Something opened from the palette, shown first the next time it opens. */
export interface RecentItem {
  key: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  to: string;
}

const MAX_RECENT = 6;

/** Pages of payroll and people data. */
const PEOPLE_PATHS = /^\/(employees|payroll|people)(\/|$)/;

/**
 * Whether something in the palette is payroll or people data: an employee,
 * or a payroll or employee page. Staff and viewers don't see these, not even
 * among the items opened before their role changed.
 */
export function isPeopleItem(item: Pick<RecentItem, 'kind' | 'to'>): boolean {
  return item.kind === 'employee' || PEOPLE_PATHS.test(item.to.split(/[?#]/)[0]);
}
const storageKey = (companyId: string) => `almailbooks.palette.recent:${companyId}`;

export function loadRecent(companyId: string): RecentItem[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(companyId)) ?? '[]') as unknown;
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(
        (r): r is RecentItem =>
          Boolean(r) &&
          typeof r === 'object' &&
          typeof (r as RecentItem).key === 'string' &&
          typeof (r as RecentItem).title === 'string' &&
          typeof (r as RecentItem).to === 'string',
      )
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Puts an item at the top of the recent list (once). */
export function rememberRecent(companyId: string, item: RecentItem): RecentItem[] {
  const next = [item, ...loadRecent(companyId).filter((r) => r.key !== item.key)].slice(
    0,
    MAX_RECENT,
  );
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(next));
  } catch {
    // Not remembered in a private window; the palette still works.
  }
  return next;
}
