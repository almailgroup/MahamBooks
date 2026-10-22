import type { LucideIcon } from 'lucide-react';
import type { CompanyLink } from '@/db/types';
import { CREATE_ACTIONS, type CreateAction } from '@/features/shell/create';
import { normalizeSearch } from '@/features/search/normalize';
import { currentLanguage, t, type Language } from '@/i18n';
import { localName } from '@/i18n/names';
import { APPS, appTitle, canEdit, canOpen, createGroups, type AccessMap } from '../apps';
import type { AppId, AppTone, SuiteApp } from '../types';

/**
 * The round tiles of the home: the apps, what can be created, each app's
 * main tools and the company's own links. Built from the apps' manifests
 * and the person's access, in the interface language.
 */

export type TileTone = AppTone | 'neutral' | 'primary';

export interface Tile {
  key: string;
  /** Shown under the circle. */
  label: string;
  /** The link's name when it says more than the label ("New invoice"). */
  name?: string;
  /** Null for a company link: its initials are shown instead. */
  icon: LucideIcon | null;
  initials?: string;
  tone: TileTone;
  /** A page of the app, or a web address for a company link. */
  to?: string;
  href?: string;
  /** Marks a tile that creates something. */
  plus?: boolean;
  /** The app an app tile opens, or whose tool a tool tile is (its sidebar opens with it). */
  app?: AppId;
  /** What the filter matches, normalised. */
  terms: string;
}

export interface ToolGroup {
  app: SuiteApp;
  tiles: Tile[];
}

const terms = (...parts: (string | undefined)[]) =>
  normalizeSearch(parts.filter(Boolean).join(' '));

/** The apps someone may open, of the layout's `apps`, as tiles. */
export function appTiles(
  access: AccessMap,
  language: Language = currentLanguage(),
  apps: readonly SuiteApp[] = APPS,
): Tile[] {
  return apps
    .filter((app) => canOpen(access[app.id]))
    .map((app) => ({
      key: `app:${app.id}`,
      app: app.id,
      label: appTitle(app, language),
      icon: app.icon,
      tone: app.tone,
      to: app.home,
      terms: terms(app.name, app.nameAr, t(app.description)),
    }));
}

/** Each app's main tools, for the apps of the layout's `apps` someone may open. */
export function toolGroups(
  access: AccessMap,
  language: Language = currentLanguage(),
  apps: readonly SuiteApp[] = APPS,
): ToolGroup[] {
  return apps
    .filter((app) => canOpen(access[app.id]))
    .map((app) => ({
      app,
      tiles: app.tools.map((tool) => ({
        key: `tool:${app.id}:${tool.to}`,
        app: app.id,
        label: t(tool.label),
        icon: tool.icon,
        tone: app.tone,
        to: tool.to,
        terms: terms(t(tool.label), tool.label, tool.keywords, appTitle(app, language)),
      })),
    }));
}

/** What the home offers to create, the most used first. */
const QUICK_CREATE = [
  'invoice',
  'quote',
  'expense',
  'payment_in',
  'bill',
  'client',
  'employee',
] as const satisfies readonly (keyof typeof CREATE_ACTIONS)[];

/** At most this many "New …" tiles. */
export const MAX_CREATE = 6;

/**
 * "New invoice", "New employee"… for the apps someone works in, the most used
 * first, and at least one for each of those apps (an HR owner gets "New
 * employee" even though Books fills the row); none for those who can't save
 * (viewers, or a company no longer shared).
 */
export function createTiles(
  current: AppId,
  access: AccessMap,
  readOnly: boolean,
  apps: readonly SuiteApp[] = APPS,
): Tile[] {
  if (readOnly) return [];
  const allowed = new Set(
    createGroups(current, access, apps).flatMap((group) =>
      group.actions.map((action) => action.id),
    ),
  );
  const offered = QUICK_CREATE.filter((id) => allowed.has(id));
  // Each app's first, then the rest in order of use, never more than MAX_CREATE.
  const chosen = new Set<string>();
  for (const app of apps) {
    if (!canEdit(access[app.id])) continue;
    const own = new Set(app.create.flatMap((group) => group.actions.map((action) => action.id)));
    const first = offered.find((id) => own.has(id));
    if (first && chosen.size < MAX_CREATE) chosen.add(first);
  }
  for (const id of offered) {
    if (chosen.size >= MAX_CREATE) break;
    chosen.add(id);
  }
  return offered
    .filter((id) => chosen.has(id))
    .map((id) => {
      const action: CreateAction = CREATE_ACTIONS[id];
      return {
        key: `action:${id}`,
        label: t(action.label),
        name: t(action.command),
        icon: action.icon,
        tone: 'primary' as const,
        to: action.to,
        plus: true,
        terms: terms(t(action.command), action.command, t(action.label), action.keywords),
      };
    });
}

/** First letters of a link's name, for its circle. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((w) => (w ? ([...w][0]?.toUpperCase() ?? '') : ''))
    .filter(Boolean);
  // A non-joiner keeps Arabic letters apart, as initials.
  const joiner = letters.some((l) => /[؀-ۿ]/.test(l)) ? '‌' : '';
  return letters.join(joiner) || '?';
}

/**
 * The company's own links and integrations (Settings → Links); they open in
 * a new tab. An integration is also found by typing "integrations".
 */
export function linkTiles(links: readonly CompanyLink[]): Tile[] {
  return links.map((link) => {
    const label = localName({ name: link.label, nameAr: link.labelAr });
    const section = link.section === 'integrations' ? [t('Integrations'), 'integrations'] : [];
    return {
      key: `link:${link.id}`,
      label,
      icon: null,
      initials: initialsOf(label),
      tone: 'neutral' as const,
      href: link.url,
      terms: terms(link.label, link.labelAr, link.url, ...section),
    };
  });
}

/**
 * The tiles matching every word typed, each place once (a page two apps list
 * shows up a single time).
 */
export function filterTiles(tiles: readonly Tile[], query: string): Tile[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const seen = new Set<string>();
  return tiles.filter((tile) => {
    if (!words.every((w) => tile.terms.includes(w))) return false;
    const where = tile.to ?? tile.href ?? tile.key;
    if (seen.has(where)) return false;
    seen.add(where);
    return true;
  });
}
