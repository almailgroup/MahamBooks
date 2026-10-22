import { useNavigate } from 'react-router';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, House, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { suiteName } from '@/lib/brand';
import { useLanguage } from '@/i18n/provider';
import { t } from '@/i18n';
import { appTitle, visibleApps } from './apps';
import { useAppAccess, useApps, useCurrentApp, useOpenApp } from './current-app';
import type { AppTone, SuiteApp } from './types';
import { SuiteLogo } from './logo';

/** An app's colours. Literal class names, so Tailwind and the theme check see every one. */
export const APP_TONES: Record<AppTone, string> = {
  indigo: 'bg-indigo-100 text-indigo-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  sky: 'bg-sky-100 text-sky-700',
  amber: 'bg-amber-100 text-amber-800',
  violet: 'bg-violet-100 text-violet-700',
  teal: 'bg-teal-100 text-teal-800',
};

const SIZES = {
  sm: 'size-7 rounded-lg [&_svg]:size-4',
  md: 'size-10 rounded-xl [&_svg]:size-5',
  lg: 'size-12 rounded-2xl [&_svg]:size-6',
} as const;

/** An app's icon on its colour. */
export function AppMark({
  app,
  size = 'md',
  className,
}: {
  app: SuiteApp;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center',
        APP_TONES[app.tone],
        SIZES[size],
        className,
      )}
    >
      <app.icon />
    </span>
  );
}

/** "Beta" next to an app that is a first version. */
export function PreviewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full bg-slate-100 px-1.5 py-px text-[0.6875rem] font-medium text-slate-600',
        className,
      )}
    >
      {t('Beta')}
    </span>
  );
}

/**
 * The Zoho-style grid button in the header: the apps the person may open,
 * and the Maham One home.
 */
export function AppSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const openApp = useOpenApp();
  const { language } = useLanguage();
  const current = useCurrentApp();
  const apps = visibleApps(useAppAccess(), useApps());
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label={t('Switch app')}>
          <LayoutGrid />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="data-[state=open]:animate-fade-in bg-surface z-50 w-[23rem] max-w-[calc(100vw-1.5rem)] rounded-2xl p-2 shadow-xl ring-1 ring-slate-900/5"
        >
          <Menu.Label className="px-2 pt-1 pb-2.5" aria-hidden>
            <SuiteLogo className="h-6" />
          </Menu.Label>
          {/* Six apps in the split layout: two rows of three. */}
          <div className={apps.length > 4 ? 'grid grid-cols-3 gap-1' : 'grid grid-cols-4 gap-1'}>
            {apps.map((app) => {
              const active = app.id === current.id;
              return (
                <Menu.Item
                  key={app.id}
                  onSelect={() => openApp(app)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl px-1.5 pt-3 pb-2 text-center outline-none select-none data-[highlighted]:bg-slate-100',
                    active && 'bg-slate-50 ring-1 ring-slate-900/5',
                  )}
                >
                  {active ? (
                    <Check className="text-primary-600 absolute end-2 top-2 size-3.5" aria-hidden />
                  ) : null}
                  <AppMark app={app} />
                  <span className="line-clamp-2 text-xs leading-tight font-semibold text-slate-900">
                    {appTitle(app, language)}
                  </span>
                  {app.preview ? <PreviewBadge /> : null}
                </Menu.Item>
              );
            })}
          </div>
          <Menu.Separator className="my-2 h-px bg-slate-100" />
          <Menu.Item
            onSelect={() => navigate('/')}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 outline-none select-none data-[highlighted]:bg-slate-100"
          >
            <House className="size-4 text-slate-400" aria-hidden />
            {t('{suite} home', { suite: suiteName() })}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** At the top of the sidebar: the app open, linking to its own home. */
export function CurrentApp({ onNavigate }: { onNavigate?: () => void }) {
  const { language } = useLanguage();
  const app = useCurrentApp();
  return (
    <Link
      to={app.home}
      onClick={onNavigate}
      className="hover:bg-surface/70 flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors"
    >
      <AppMark app={app} size="sm" />
      <span className="truncate text-sm font-semibold text-slate-800">
        {appTitle(app, language)}
      </span>
      {app.preview ? <PreviewBadge /> : null}
    </Link>
  );
}

/** In the phone's menu: every app a tap away. */
export function AppTiles({ onNavigate }: { onNavigate?: () => void }) {
  const openApp = useOpenApp();
  const { language } = useLanguage();
  const current = useCurrentApp();
  const apps = visibleApps(useAppAccess(), useApps());
  return (
    <ul
      aria-label={t('Apps')}
      className={apps.length > 4 ? 'grid grid-cols-3 gap-1' : 'grid grid-cols-4 gap-1'}
    >
      {apps.map((app) => (
        <li key={app.id} className="min-w-0">
          <button
            type="button"
            aria-current={app.id === current.id ? 'true' : undefined}
            onClick={() => {
              onNavigate?.();
              openApp(app);
            }}
            className={cn(
              'flex w-full flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-center text-[0.6875rem] leading-tight font-medium text-slate-700 pointer-coarse:min-h-12',
              app.id === current.id
                ? 'bg-surface shadow-xs ring-1 ring-slate-900/5'
                : 'hover:bg-surface/70',
            )}
          >
            <AppMark app={app} size="sm" />
            <span className="line-clamp-2">{appTitle(app, language)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
