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
