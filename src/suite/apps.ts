import { BOOKS, FINANCE } from '@/apps/books/manifest';
import { PEOPLE } from '@/apps/people/manifest';
import { CRM } from '@/apps/crm/manifest';
import { COMPLIANCE } from '@/apps/compliance/manifest';
import { SALES } from '@/apps/sales/manifest';
import { INVENTORY } from '@/apps/inventory/manifest';
import {
  appLimit,
  limitAppOf,
  lowerAccess,
  type MemberPermissions,
  type MemberRole,
} from '@/cloud/roles';
import type { Company } from '@/db/types';
import type { CreateAction, CreateGroup } from '@/features/shell/create';
import type { Language } from '@/i18n';
import type { AccessKey, AppAccess, AppId, AppLayout, CoreAppId, SuiteApp } from './types';

/** The apps of Maham One, in the order the switcher and the home show them. */
export const APPS: readonly SuiteApp[] = [BOOKS, PEOPLE, CRM, COMPLIANCE];

/**
 * The split layout (Company.appLayout): Maham Books in three, Maham Sales,
 * Maham Books (finance) and Maham Inventory, over the same pages at the
 * same addresses; then the other apps as in the classic layout.
 */
export const SPLIT_APPS: readonly SuiteApp[] = [SALES, FINANCE, INVENTORY, PEOPLE, CRM, COMPLIANCE];

/** Every app id this build knows, in either layout. */
const KNOWN_IDS = new Set<string>([...APPS, ...SPLIT_APPS].map((app) => app.id));

/** The layout of a company's apps: 'split' only when it says so (D1). */
export function appLayoutOf(company: Pick<Company, 'appLayout'> | null | undefined): AppLayout {
  return company?.appLayout === 'split' ? 'split' : 'classic';
}

/** The apps of a layout. */
export function layoutApps(layout: AppLayout): readonly SuiteApp[] {
  return layout === 'split' ? SPLIT_APPS : APPS;
}

/** The apps of a company, in its layout: today's four unless it split Books. */
export function appsFor(
  company: Pick<Company, 'appLayout'> | null | undefined,
): readonly SuiteApp[] {
  return layoutApps(appLayoutOf(company));
}

/** What a list of apps is looked up by, worked out once. */
interface Lookup {
  byId: Map<string, SuiteApp>;
  /** Which app each first path segment belongs to. */
  owner: Map<string, AppId>;
}

const LOOKUPS = new WeakMap<readonly SuiteApp[], Lookup>();

function lookupOf(apps: readonly SuiteApp[]): Lookup {
  let found = LOOKUPS.get(apps);
  if (!found) {
    found = {
      byId: new Map(apps.map((app) => [app.id, app])),
      owner: new Map(apps.flatMap((app) => app.owns.map((s) => [s, app.id] as const))),
    };
    LOOKUPS.set(apps, found);
  }
  return found;
}

/**
 * An app of the list. An id the list doesn't have (Sales or Inventory in
 * the classic layout) is the app that holds its pages there: Books.
 */
export function appById(id: AppId, apps: readonly SuiteApp[] = APPS): SuiteApp {
  const { byId } = lookupOf(apps);
  return byId.get(id) ?? byId.get('books')!;
}

/** Whether `value` is the id of an app of the list (by default, of either layout). */
export function isAppId(value: unknown, apps?: readonly SuiteApp[]): value is AppId {
  if (typeof value !== 'string') return false;
  return apps ? lookupOf(apps).byId.has(value) : KNOWN_IDS.has(value);
}

/** The app's name in a language ("Maham Books", "مهام بوكس"). */
export function appTitle(app: SuiteApp, language: Language): string {
  return language === 'ar' ? app.nameAr : app.name;
}

/**
 * The names of the apps of the list that an id of the owner's limits and of
 * company links stands for: in the split layout, Books is Maham Sales, Maham
 * Books and Maham Inventory. Each app its own name otherwise.
 */
export function limitTitle(id: CoreAppId, apps: readonly SuiteApp[], language: Language): string {
  return apps
    .filter((app) => limitAppOf(app.id) === id)
    .map((app) => appTitle(app, language))
    .join(' · ');
}

/** The first segment of a path: 'invoices' for '/invoices/x/edit?y=1', '' for '/'. */
export function firstSegment(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(/^\/+/, '').split('/')[0] ?? '';
}

/**
 * The app a page belongs to, in the layout of `apps`; null for the suite's
 * own pages (Home, Settings, setup). A page another app shares (CRM lists
 * Books' Customers) stays with that app when it was the last one open.
 */
export function appForPath(
  pathname: string,
  last?: AppId | null,
  apps: readonly SuiteApp[] = APPS,
): AppId | null {
  const segment = firstSegment(pathname);
  const { byId, owner } = lookupOf(apps);
  if (last && byId.get(last)?.shares?.includes(segment)) return last;
  return owner.get(segment) ?? null;
}

/** Every manifest by id: Books' access per role is the same in both layouts. */
const BY_ROLE = new Map<string, SuiteApp>([...SPLIT_APPS, ...APPS].map((app) => [app.id, app]));

/** What a role may do in an app, before any limits of the owner. */
export function roleAccess(app: AppId, role: MemberRole | null): AppAccess {
  const key: AccessKey = role ?? 'device';
  return BY_ROLE.get(app)!.access[key];
}

/**
 * What someone may do in an app, from their role in the company (null for a
 * company kept on this device only) and the owner's limits on them, which
 * only take away. Until the role is known nothing of People is shown and the
 * other apps are only looked at. Books is never hidden (the other apps use
 * its customers and items): limited to no access, it is view only. CRM works
 * on Books' customers and quotes, so it is never more open than Books. Sales
 * and Inventory (the split layout) are Books' pages: the same as Books.
 */
export function appAccess(
  app: AppId,
  role: MemberRole | null,
  known = true,
  permissions?: MemberPermissions,
): AppAccess {
  if (!known) return app === 'people' ? 'none' : 'view';
  let access = lowerAccess(roleAccess(app, role), appLimit(role, permissions, app));
  if (limitAppOf(app) === 'books' && access === 'none') access = 'view';
  if (app === 'crm') {
    const books = appLimit(role, permissions, 'books');
    access = lowerAccess(access, books === 'none' ? 'view' : books);
  }
  return access;
}

/**
 * What someone may do in each app of a layout: the classic four always,
 * Sales and Inventory in the split layout only.
 */
export type AccessMap = Record<CoreAppId, AppAccess> & Partial<Record<AppId, AppAccess>>;

export function accessMap(
  role: MemberRole | null,
  known = true,
  permissions?: MemberPermissions,
  apps: readonly SuiteApp[] = APPS,
): AccessMap {
  return Object.fromEntries(
    apps.map((app) => [app.id, appAccess(app.id, role, known, permissions)]),
  ) as AccessMap;
}

/** Whether an app opens; one that isn't in the layout doesn't. */
export const canOpen = (access: AppAccess | undefined) => access !== undefined && access !== 'none';
export const canEdit = (access: AppAccess | undefined) => access === 'edit' || access === 'manage';

/** The apps of the list someone may open. */
export function visibleApps(access: AccessMap, apps: readonly SuiteApp[] = APPS): SuiteApp[] {
  return apps.filter((app) => canOpen(access[app.id]));
}

/**
 * What the New menus offer: the current app's groups first, then those of
 * the other apps the person works in, each action once and each group (by
 * its name) once. Nothing for an app the person only looks at.
 */
export function createGroups(
  current: AppId,
  access: AccessMap,
  apps: readonly SuiteApp[] = APPS,
): (CreateGroup & { column?: 0 | 1 })[] {
  const first = appById(current, apps);
  const order = [first, ...apps.filter((app) => app.id !== first.id)];
  const seen = new Set<string>();
  const groups: (CreateGroup & { column?: 0 | 1 })[] = [];
  for (const app of order) {
    if (!canEdit(access[app.id])) continue;
    for (const group of app.create) {
      const actions = group.actions.filter((a: CreateAction) => !seen.has(a.id));
      actions.forEach((a) => seen.add(a.id));
      if (!actions.length) continue;
      // One "Sales" group, whichever apps add to it.
      const same = groups.find((g) => g.label === group.label);
      if (same) same.actions = [...same.actions, ...actions];
      else groups.push({ ...group, actions });
    }
  }
  return groups;
}

/**
 * The New menu's two columns: groups that ask for a column get it, the others
 * go where there are fewer actions so far.
 */
export function createColumns(
  groups: (CreateGroup & { column?: 0 | 1 })[],
): [CreateGroup[], CreateGroup[]] {
  const columns: [CreateGroup[], CreateGroup[]] = [[], []];
  const size = [0, 0];
  for (const group of groups) {
    const column = group.column ?? (size[0] <= size[1] ? 0 : 1);
    columns[column].push(group);
    size[column] += group.actions.length + 1;
  }
  return columns;
}
