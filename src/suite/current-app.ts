import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { useRoleView } from '@/features/cloud/role-gates';
import { accessMap, appById, appForPath, canOpen, isAppId, type AccessMap } from './apps';
import type { AppId, SuiteApp } from './types';

/**
 * The app open in the shell. Pages belong to an app by their URL
 * (src/suite/apps.ts); the suite's own pages (Home, Settings) keep the
 * sidebar of the last app used, remembered in this browser.
 */

// Old storage names stay (src/lib/brand.ts).
const LAST_APP_KEY = 'almailbooks.suite.app';

function readLast(): AppId | null {
  try {
    const saved = localStorage.getItem(LAST_APP_KEY);
    return isAppId(saved) ? saved : null;
  } catch {
    return null;
  }
}

let last: AppId | null = readLast();
const listeners = new Set<() => void>();

export function rememberApp(id: AppId): void {
  if (id === last) return;
  last = id;
  try {
    localStorage.setItem(LAST_APP_KEY, id);
  } catch {
    // Not saved; the choice still applies to this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests: forget the last app. */
export function resetLastApp(): void {
  last = null;
  listeners.forEach((listener) => listener());
}

function useLastApp(): AppId | null {
  return useSyncExternalStore(subscribe, () => last);
}

/** What the person may do in each app of the current company. */
export function useAppAccess(): AccessMap {
  const { role, known, permissions } = useRoleView();
  return useMemo(() => accessMap(role, known, permissions), [role, known, permissions]);
}

/**
 * The app the shell shows: the one the page belongs to, or the last one on
 * the suite's own pages. An app the person may not open is never shown:
 * staff on a People page see Books around the lock card.
 */
export function useCurrentApp(): SuiteApp {
  const { pathname } = useLocation();
  const access = useAppAccess();
  const remembered = useLastApp();
  const fromPath = appForPath(pathname, remembered);
  const id = [fromPath, remembered].find(
    (candidate): candidate is AppId => candidate != null && canOpen(access[candidate]),
  );
  return appById(id ?? 'books');
}

/** Remembers the app of the page being visited, for the suite's own pages. */
export function useRememberApp(): void {
  const { pathname } = useLocation();
  const access = useAppAccess();
  const remembered = useLastApp();
  const fromPath = appForPath(pathname, remembered);
  const allowed = fromPath !== null && canOpen(access[fromPath]);
  useEffect(() => {
    if (fromPath && allowed) rememberApp(fromPath);
  }, [fromPath, allowed]);
}
