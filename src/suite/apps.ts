import { BOOKS } from '@/apps/books/manifest';
import { PEOPLE } from '@/apps/people/manifest';
import { CRM } from '@/apps/crm/manifest';
import { COMPLIANCE } from '@/apps/compliance/manifest';
import { appLimit, lowerAccess, type MemberPermissions, type MemberRole } from '@/cloud/roles';
import type { CreateAction, CreateGroup } from '@/features/shell/create';
import type { Language } from '@/i18n';
import type { AccessKey, AppAccess, AppId, SuiteApp } from './types';

/** The apps of Maham One, in the order the switcher and the home show them. */
export const APPS: readonly SuiteApp[] = [BOOKS, PEOPLE, CRM, COMPLIANCE];

const BY_ID = new Map<AppId, SuiteApp>(APPS.map((app) => [app.id, app]));

export function appById(id: AppId): SuiteApp {
  return BY_ID.get(id)!;
}

export function isAppId(value: unknown): value is AppId {
  return typeof value === 'string' && BY_ID.has(value as AppId);
}

/** The app's name in a language ("Maham Books", "مهام بوكس"). */
export function appTitle(app: SuiteApp, language: Language): string {
  return language === 'ar' ? app.nameAr : app.name;
}

/** Which app each first path segment belongs to. */
const OWNER = new Map<string, AppId>(APPS.flatMap((app) => app.owns.map((s) => [s, app.id])));

/** The first segment of a path: 'invoices' for '/invoices/x/edit?y=1', '' for '/'. */
export function firstSegment(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(/^\/+/, '').split('/')[0] ?? '';
}

/**
 * The app a page belongs to; null for the suite's own pages (Home, Settings,
 * setup). A page another app shares (CRM lists Books' Customers) stays with
 * that app when it was the last one open.
 */
export function appForPath(pathname: string, last?: AppId | null): AppId | null {
  const segment = firstSegment(pathname);
  if (last && appById(last).shares?.includes(segment)) return last;
  return OWNER.get(segment) ?? null;
}

/** What a role may do in an app, before any limits of the owner. */
export function roleAccess(app: AppId, role: MemberRole | null): AppAccess {
  const key: AccessKey = role ?? 'device';
  return appById(app).access[key];
}

/**
 * What someone may do in an app, from their role in the company (null for a
 * company kept on this device only) and the owner's limits on them, which
 * only take away. Until the role is known nothing of People is shown and the
 * other apps are only looked at. Books is never hidden (the other apps use
 * its customers and items): limited to no access, it is view only. CRM works
 * on Books' customers and quotes, so it is never more open than Books.
 */
export function appAccess(
  app: AppId,
  role: MemberRole | null,
  known = true,
  permissions?: MemberPermissions,
): AppAccess {
  if (!known) return app === 'people' ? 'none' : 'view';
  let access = lowerAccess(roleAccess(app, role), appLimit(role, permissions, app));
  if (app === 'books' && access === 'none') access = 'view';
  if (app === 'crm') {
    const books = appLimit(role, permissions, 'books');
    access = lowerAccess(access, books === 'none' ? 'view' : books);
  }
  return access;
}

export type AccessMap = Record<AppId, AppAccess>;

export function accessMap(
  role: MemberRole | null,
  known = true,
  permissions?: MemberPermissions,
): AccessMap {
  return Object.fromEntries(
    APPS.map((app) => [app.id, appAccess(app.id, role, known, permissions)]),
  ) as AccessMap;
}

export const canOpen = (access: AppAccess) => access !== 'none';
export const canEdit = (access: AppAccess) => access === 'edit' || access === 'manage';

/** The apps someone may open. */
export function visibleApps(access: AccessMap): SuiteApp[] {
  return APPS.filter((app) => canOpen(access[app.id]));
}

/**
 * What the New menus offer: the current app's groups first, then those of
 * the other apps the person works in, each action once and each group (by
 * its name) once. Nothing for an app the person only looks at.
 */
export function createGroups(
  current: AppId,
  access: AccessMap,
): (CreateGroup & { column?: 0 | 1 })[] {
  const order = [appById(current), ...APPS.filter((app) => app.id !== current)];
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
