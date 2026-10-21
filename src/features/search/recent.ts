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
 * or a payroll or employee page (an employee's papers and files lead to
 * their page). Staff and viewers don't see these, not even among the items
 * opened before their role changed.
 */
export function isPeopleItem(item: Pick<RecentItem, 'kind' | 'to'>): boolean {
  return item.kind === 'employee' || PEOPLE_PATHS.test(item.to.split(/[?#]/)[0]);
}
const storageKey = (companyId: string) => `almailbooks.palette.recent:${companyId}`;

/** Every kind this version knows. */
const KINDS: Record<SearchKind, true> = {
  page: true,
  action: true,
  client: true,
  vendor: true,
  item: true,
  employee: true,
  elsewhere: true,
  document: true,
  paper: true,
  file: true,
  recent: true,
};

/**
 * Kinds added by the document finder are stored as a document, which every
 * version knows (an older one in the same browser shows the list with an
 * icon for each kind it knows); they are told again by their key.
 */
const STORED_AS: Partial<Record<SearchKind, SearchKind>> = { paper: 'document', file: 'document' };
const KEY_KINDS: [prefix: string, kind: SearchKind][] = [
  ['paper:', 'paper'],
  ['file:', 'file'],
];

/** The item's kind: from its key, as stored, or a page for a kind a newer version saved. */
function kindOf(item: RecentItem): SearchKind {
  const byKey = KEY_KINDS.find(([prefix]) => item.key.startsWith(prefix));
  if (byKey) return byKey[1];
  return Object.hasOwn(KINDS, item.kind) ? item.kind : 'page';
}

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
      .slice(0, MAX_RECENT)
      .map((r) => ({ ...r, kind: kindOf(r) }));
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
    localStorage.setItem(
      storageKey(companyId),
      JSON.stringify(next.map((r) => ({ ...r, kind: STORED_AS[r.kind] ?? r.kind }))),
    );
  } catch {
    // Not remembered in a private window; the palette still works.
  }
  return next;
}
