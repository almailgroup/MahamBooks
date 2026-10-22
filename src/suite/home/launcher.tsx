import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { useCompany } from '@/app/company';
import { Input } from '@/components/ui/form';
import { useRoleView } from '@/features/cloud/role-gates';
import { linkPlace, linkSections, sidebarLinks } from '@/lib/links';
import { cn } from '@/lib/cn';
import { useLanguage } from '@/i18n/provider';
import { t, tp } from '@/i18n';
import { appById, appTitle, visibleApps, type AccessMap } from '../apps';
import { rememberApp, useApps, useCurrentApp } from '../current-app';
import { APP_TONES, AppMark, PreviewBadge } from '../switcher';
import type { AppId } from '../types';
import {
  appTiles,
  createTiles,
  filterTiles,
  linkTiles,
  toolGroups,
  type Tile,
  type TileTone,
} from './tiles';

/**
 * The home's launcher: every app and tool as a round tile, a tap away,
 * and a box to find one by name.
 */

/** Literal class names, so Tailwind and the theme check see every one. */
const TILE_TONES: Record<TileTone, string> = {
  ...APP_TONES,
  neutral: 'bg-slate-100 text-slate-700',
  primary: 'bg-primary-100 text-primary-700',
};

export function Launcher({
  access,
  stats,
}: {
  access: AccessMap;
  /** A line under each app: "4 overdue invoices". */
  stats: Partial<Record<AppId, string>>;
}) {
  const navigate = useNavigate();
  const company = useCompany();
  const { language } = useLanguage();
  const current = useCurrentApp();
  const layout = useApps();
  const { readOnly } = useRoleView().readOnly;
  const [query, setQuery] = useState('');

  const tiles = useMemo(() => {
    const apps = appTiles(access, language, layout);
    const create = createTiles(current.id, access, readOnly, layout);
    const groups = toolGroups(access, language, layout);
    // The links chosen for an app the person may open.
    const sections = linkSections(
      sidebarLinks(company.links, linkPlace(visibleApps(access, layout).map((app) => app.id))),
    );
    const links = linkTiles(sections.links);
    const integrations = linkTiles(sections.integrations);
    return {
      apps,
      create,
      groups,
      links,
      integrations,
      all: [...apps, ...create, ...groups.flatMap((g) => g.tiles), ...links, ...integrations],
    };
    // Labels are translated when built: the language is a dependency.
  }, [access, current.id, readOnly, company.links, language, layout]);

  const found = useMemo(() => filterTiles(tiles.all, query), [tiles, query]);
  const searching = query.trim() !== '';
  const ids = {
    apps: useId(),
    create: useId(),
    tools: useId(),
    links: useId(),
    integrations: useId(),
    found: useId(),
    foundTitle: useId(),
  };

  const open = (tile: Tile | undefined) => {
    if (!tile) return;
    if (tile.href) window.open(tile.href, '_blank', 'noopener,noreferrer');
    else if (tile.to) {
      if (tile.app) rememberApp(tile.app);
      void navigate(tile.to);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter opens the first tile found.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) open(found[0]);
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder={t('Find an app or tool…')}
          aria-label={t('Find an app or tool')}
          aria-controls={searching ? ids.found : undefined}
          className="h-11 rounded-full ps-9"
        />
        {/* Read out as the tiles narrow down: "3 results", "No results". */}
        <p role="status" className="sr-only">
          {searching ? tp(found.length, '{count} result', '{count} results') : ''}
        </p>
      </div>

      {searching ? (
        <section id={ids.found} aria-labelledby={ids.foundTitle}>
          <h2 id={ids.foundTitle} className="sr-only">
            {t('Search results')}
          </h2>
          {found.length ? (
            <TileGrid>
              {found.map((tile) => (
                <RoundTile key={tile.key} tile={tile} />
              ))}
            </TileGrid>
          ) : (
            <p className="py-6 text-sm text-slate-500">
              {t('No app or tool matches your search.')}
            </p>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby={ids.apps}>
            <SectionTitle id={ids.apps}>{t('Your apps')}</SectionTitle>
            <ul className="grid grid-cols-4 gap-x-1 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:gap-x-2">
              {tiles.apps.map((tile) => {
                const app = tile.app ? appById(tile.app, layout) : undefined;
                return (
                  <RoundTile
                    key={tile.key}
                    tile={tile}
                    size="lg"
                    sub={app ? stats[app.id] : undefined}
                    badge={
                      app && (app.preview || access[app.id] === 'view') ? (
                        <AppBadges preview={!!app.preview} viewOnly={access[app.id] === 'view'} />
                      ) : null
                    }
                  />
                );
              })}
            </ul>
          </section>

          {tiles.create.length ? (
            <section aria-labelledby={ids.create}>
              <SectionTitle id={ids.create}>{t('Create')}</SectionTitle>
              <TileGrid>
                {tiles.create.map((tile) => (
                  <RoundTile key={tile.key} tile={tile} />
                ))}
              </TileGrid>
            </section>
          ) : null}

          <section aria-labelledby={ids.tools}>
            <SectionTitle id={ids.tools}>{t('Tools')}</SectionTitle>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {tiles.groups.map(({ app, tiles: list }) => (
                <div
                  key={app.id}
                  className={cn(
                    'bg-surface rounded-2xl border border-slate-200 p-3 shadow-xs sm:p-4',
                    // The biggest app gets the whole row.
                    list.length > 6 && 'lg:col-span-2',
                  )}
                >
                  <h3 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-slate-800">
                    <AppMark app={app} size="sm" />
                    {appTitle(app, language)}
                  </h3>
                  <TileGrid>
                    {list.map((tile) => (
                      <RoundTile key={tile.key} tile={tile} />
                    ))}
                  </TileGrid>
                </div>
              ))}
            </div>
          </section>

          {tiles.links.length ? (
            <section aria-labelledby={ids.links}>
              <SectionTitle id={ids.links}>{t('Company tools')}</SectionTitle>
              <TileGrid>
                {tiles.links.map((tile) => (
                  <RoundTile key={tile.key} tile={tile} />
                ))}
              </TileGrid>
            </section>
          ) : null}

          {tiles.integrations.length ? (
            <section aria-labelledby={ids.integrations}>
              <SectionTitle id={ids.integrations}>{t('Integrations')}</SectionTitle>
              <TileGrid>
                {tiles.integrations.map((tile) => (
                  <RoundTile key={tile.key} tile={tile} />
                ))}
              </TileGrid>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** "Beta" and "View only" under an app, both when both apply. */
function AppBadges({ preview, viewOnly }: { preview: boolean; viewOnly: boolean }) {
  return (
    <span className="flex flex-wrap justify-center gap-1">
      {preview ? <PreviewBadge /> : null}
      {viewOnly ? (
        <span className="rounded-full bg-slate-100 px-1.5 py-px text-[0.6875rem] font-medium text-slate-600">
          {t('View only')}
        </span>
      ) : null}
    </span>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-sm font-semibold text-slate-500">
      {children}
    </h2>
  );
}

function TileGrid({ children }: { children: ReactNode }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-x-1 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))]">
      {children}
    </ul>
  );
}

/** A tool as a round tile: its icon on the app's colour, its name below. */
function RoundTile({
  tile,
  size = 'md',
  sub,
  badge,
}: {
  tile: Tile;
  size?: 'md' | 'lg';
  /** A line under the name. */
  sub?: string;
  /** Over the circle's corner: "Beta", "View only". */
  badge?: ReactNode;
}) {
  const badgeId = useId();
  const subId = useId();
  const Icon = tile.icon;
  // The link is named by its label; the line under it and the badge describe it.
  const describedBy = [sub ? subId : '', badge ? badgeId : ''].filter(Boolean).join(' ');
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'relative flex shrink-0 items-center justify-center rounded-full shadow-xs ring-1 ring-slate-900/5 transition duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-active:scale-95 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0',
          TILE_TONES[tile.tone],
          size === 'lg'
            ? 'size-16 sm:size-20 [&>svg]:size-7 sm:[&>svg]:size-9'
            : 'size-14 [&>svg]:size-6',
        )}
      >
        {Icon ? <Icon /> : <span className="text-base font-semibold">{tile.initials}</span>}
        {tile.plus ? (
          <span className="bg-primary-solid text-on-primary absolute -end-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-[var(--color-surface)]">
            <Plus className="size-3" strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'line-clamp-2 leading-tight font-medium text-slate-800',
          size === 'lg' ? 'text-sm sm:text-base' : 'text-xs sm:text-sm',
        )}
      >
        {tile.label}
      </span>
      {sub ? (
        <span
          id={subId}
          className="line-clamp-2 text-[0.6875rem] leading-tight text-slate-500 sm:text-xs"
        >
          {sub}
        </span>
      ) : null}
      {badge ? <span id={badgeId}>{badge}</span> : null}
    </>
  );
  const className =
    // The page's focus outline shows on it, in high-contrast mode too.
    'group flex h-full flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center hover:bg-slate-50';
  return (
    <li className="min-w-0">
      {tile.href ? (
        <a
          href={tile.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          title={tile.label}
        >
          {body}
          <span className="sr-only">{t('(opens in a new tab)')}</span>
        </a>
      ) : (
        <Link
          to={tile.to ?? '/'}
          // An app, or in the split layout one of its tools (toolGroups),
          // opens with that app's sidebar, even on a page the last app
          // shares (src/suite/current-app.ts).
          onClick={tile.app ? () => rememberApp(tile.app!) : undefined}
          className={className}
          aria-label={tile.name ?? (describedBy ? tile.label : undefined)}
          aria-describedby={describedBy || undefined}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
