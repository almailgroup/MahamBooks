import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { Building2, Check, ChevronDown, ChevronsUpDown, DatabaseBackup, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { APP_NAME } from '@/lib/brand';
import { useCompanyContext } from '@/app/company';
import {
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { useScrollEdges } from '@/components/ui/misc';
import { useTaxesEnabled } from '@/features/company/taxes';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import {
  activeGroupId,
  isActivePath,
  isGroupOpen,
  loadGroupState,
  NAV_FOOTER,
  openActiveGroup,
  saveGroupState,
  visibleNav,
  type GroupState,
  type NavGroup,
} from './nav';

export function CompanyLogo({
  name,
  logo,
  className,
}: {
  name: string;
  logo: string | null;
  className?: string;
}) {
  if (logo) {
    return (
      <span
        className={cn(
          'flex size-8 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-900/10',
          className,
        )}
      >
        <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span
      className={cn(
        'bg-primary-600 flex size-8 items-center justify-center rounded-lg text-xs font-semibold text-white',
        className,
      )}
    >
      {initials || <Building2 className="size-4" />}
    </span>
  );
}

function CompanySwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { company, companies, switchCompany } = useCompanyContext();
  const navigate = useNavigate();
  const go = (to: string) => {
    onNavigate?.();
    navigate(to);
  };
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl bg-white p-2 text-start shadow-xs ring-1 ring-slate-900/5 transition-shadow hover:shadow-sm pointer-coarse:min-h-12"
          aria-label={t('Switch company')}
        >
          <CompanyLogo name={company.name} logo={company.branding.logo} />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-sm font-semibold text-slate-900">
              {localName(company)}
            </span>
            <span className="block truncate text-xs text-slate-500">
              {company.currency} · {APP_NAME}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-400" aria-hidden />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64">
        <DropdownLabel>{t('Companies')}</DropdownLabel>
        {companies.map((c) => (
          <DropdownItem
            key={c.id}
            onSelect={() => {
              void switchCompany(c.id);
              go('/');
            }}
            icon={c.id === company.id ? <Check /> : <span className="inline-block size-4" />}
          >
            <span dir="auto" className="truncate">
              {localName(c)}
            </span>
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem icon={<Plus />} onSelect={() => go('/setup')}>
          {t('Add company')}
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

// Rounded rows on the tinted backdrop: the current page is a white pill.
const itemBase =
  'flex w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors [&_svg]:size-[1.125rem] [&_svg]:shrink-0';
const itemHeight = 'h-[2.125rem] pointer-coarse:h-11';
const itemIdle =
  'text-slate-700 hover:bg-white/70 hover:text-slate-900 [&_svg]:text-slate-500 hover:[&_svg]:text-slate-600';
const itemActive =
  'bg-white text-primary-700 shadow-xs ring-1 ring-slate-900/5 [&_svg]:text-primary-600';

/** Open and closed groups, remembered in this browser. */
function useGroupState(active: string | null) {
  const [state, setState] = useState<GroupState>(() => openActiveGroup(loadGroupState(), active));
  // Arriving on a page of a closed group opens it, so the current page stays in view.
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    const next = openActiveGroup(state, active);
    if (next !== state) setState(next);
  }
  useEffect(() => saveGroupState(state), [state]);
  const toggle = (id: string) => setState((s) => ({ ...s, [id]: !isGroupOpen(s, id) }));
  return { state, toggle };
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const taxesOn = useTaxesEnabled();
  const { pathname } = useLocation();
  const nav = visibleNav(taxesOn);
  const { state, toggle } = useGroupState(activeGroupId(pathname, nav));
  const list = useRef<HTMLElement>(null);
  const edges = useScrollEdges(list, 'y');

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="px-3 pt-3">
        <CompanySwitcher onNavigate={onNavigate} />
      </div>
      <nav
        ref={list}
        className={cn(
          'scroll-thin flex-1 overflow-y-auto overscroll-contain px-3 py-1',
          edges.start && 'scroll-fade-top',
          edges.end && 'scroll-fade-bottom',
        )}
        aria-label={t('Main')}
      >
        <ul className="space-y-0.5">
          {nav.map((entry) =>
            entry.kind === 'link' ? (
              <li key={entry.to}>
                <NavLink
                  to={entry.to}
                  end={entry.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(itemBase, itemHeight, isActive ? itemActive : itemIdle)
                  }
                >
                  <entry.icon aria-hidden />
                  {t(entry.label)}
                </NavLink>
              </li>
            ) : (
              <SidebarGroup
                key={entry.id}
                group={entry}
                open={isGroupOpen(state, entry.id)}
                onToggle={() => toggle(entry.id)}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ),
          )}
        </ul>
      </nav>
      <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ul className="space-y-0.5">
          {NAV_FOOTER.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(itemBase, itemHeight, isActive ? itemActive : itemIdle)
                }
              >
                <link.icon aria-hidden />
                {t(link.label)}
              </NavLink>
            </li>
          ))}
        </ul>
        <Link
          to="/settings/data"
          onClick={onNavigate}
          className="group mt-2 flex items-start gap-2.5 rounded-2xl bg-white/60 px-3 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-900/5 transition-colors hover:bg-white"
        >
          <DatabaseBackup className="mt-0.5 size-3.5 shrink-0 text-slate-500" aria-hidden />
          <span>
            {t('Data is stored in this browser.')}{' '}
            <span className="text-primary-700 font-medium group-hover:underline">
              {t('Back up')}
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}

function SidebarGroup({
  group,
  open,
  onToggle,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  pathname: string;
  onNavigate?: () => void;
}) {
  const panelId = useId();
  const containsActive = group.children.some((c) => isActivePath(pathname, c.to));
  if (group.children.length === 0) return null;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          itemBase,
          itemHeight,
          itemIdle,
          containsActive && !open && 'text-primary-700 [&_svg]:text-primary-600',
        )}
      >
        <group.icon aria-hidden />
        <span className="flex-1 text-start">{t(group.label)}</span>
        <ChevronDown
          className={cn(
            'size-4! text-slate-400 transition-transform duration-150',
            !open && '-rotate-90 rtl:rotate-90',
          )}
          aria-hidden
        />
      </button>
      <ul id={panelId} hidden={!open} className="mt-px mb-1 space-y-px">
        {group.children.map((child) => (
          <li key={child.to}>
            <NavLink
              to={child.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex h-[1.875rem] items-center rounded-xl ps-[2.625rem] pe-3 text-sm transition-colors pointer-coarse:h-11',
                  isActive
                    ? 'text-primary-700 bg-white font-medium shadow-xs ring-1 ring-slate-900/5'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                )
              }
            >
              {t(child.label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </li>
  );
}
