import type { LucideIcon } from 'lucide-react';

/**
 * An app's sidebar: a few top-level destinations, some of them groups that
 * open to show their pages. Labels are English keys (`t()` them). Each app
 * of the suite has its own (see its manifest, src/apps/<app>/manifest.ts).
 */

export interface NavLink {
  to: string;
  label: string;
  /** Words that find the page in the command palette. */
  keywords?: string;
  /** Shown only when taxes are on (VAT returns). */
  taxesOnly?: boolean;
}

export interface NavTopLink extends NavLink {
  kind: 'link';
  icon: LucideIcon;
  /** Only this exact path is active (Home). */
  end?: boolean;
}

export interface NavGroup {
  kind: 'group';
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavLink[];
}

export type NavEntry = NavTopLink | NavGroup;

/**
 * The entries shown for this company: VAT returns only when taxes are on.
 * Which app's entries, and whether the person may open that app, is the
 * suite's business (src/suite/apps.ts).
 */
export function visibleNav(nav: NavEntry[], taxesOn: boolean): NavEntry[] {
  return nav.map((entry) =>
    entry.kind === 'group'
      ? { ...entry, children: entry.children.filter((c) => taxesOn || !c.taxesOnly) }
      : entry,
  );
}

/** Whether a link is the current page or one of its sub-pages. */
export function isActivePath(pathname: string, to: string, end = false): boolean {
  if (to === '/' || end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The link of the current page: the one that matches it most closely, so on
 * /payroll/leave "Leave" is current and "Pay runs" (/payroll) is not.
 */
export function activeLink(
  pathname: string,
  links: readonly { to: string; end?: boolean }[],
): string | null {
  let best: string | null = null;
  for (const link of links) {
    const to = link.to.split(/[?#]/)[0];
    if (!isActivePath(pathname, to, link.end)) continue;
    if (best === null || to.length > best.length) best = to;
  }
  return best;
}

/** Every link of a sidebar, groups opened. */
export function navLinks(nav: NavEntry[]): NavLink[] {
  return nav.flatMap((entry): NavLink[] => (entry.kind === 'group' ? entry.children : [entry]));
}

/** The group holding the current page, if any. */
export function activeGroupId(pathname: string, nav: NavEntry[]): string | null {
  const current = activeLink(pathname, navLinks(nav));
  if (current === null) return null;
  for (const entry of nav) {
    if (entry.kind === 'group' && entry.children.some((c) => c.to.split(/[?#]/)[0] === current)) {
      return entry.id;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Open and closed groups                                                     */
/* -------------------------------------------------------------------------- */

export type GroupState = Record<string, boolean>;

const GROUPS_KEY = 'almailbooks.nav.groups';

/** The sidebar's group of the company's integrations (Settings → Links). */
export const INTEGRATIONS_GROUP = 'integrations';

/** Groups open until someone closes them: the everyday sales pages and the integrations. */
export const DEFAULT_OPEN = new Set(['sales', INTEGRATIONS_GROUP]);

export function loadGroupState(): GroupState {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}') as unknown;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
    );
  } catch {
    return {};
  }
}

export function saveGroupState(state: GroupState): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private window): groups reset on the next visit.
  }
}

/** Whether a group shows its pages: as left by the person, else open by default. */
export function isGroupOpen(state: GroupState, id: string): boolean {
  return state[id] ?? DEFAULT_OPEN.has(id);
}

/** Opens the group of the page being visited, so its link is never hidden. */
export function openActiveGroup(state: GroupState, active: string | null): GroupState {
  if (!active || isGroupOpen(state, active)) return state;
  return { ...state, [active]: true };
}
