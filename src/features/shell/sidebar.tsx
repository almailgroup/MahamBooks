import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  Plug,
  Plus,
} from 'lucide-react';
import type { CompanyLink } from '@/db/types';
import { cn } from '@/lib/cn';
import { linkPlace, linkSections, sidebarLinks } from '@/lib/links';
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
import { registerExtrasOn } from '@/lib/compliance';
import { fileFinderOn } from '@/db/files';
import { approvalsOn, payrollApprovalsShown } from '@/db/approvals';
import { useCostingShown } from '@/features/people/costing-hooks';
import { companyTypeName } from '@/features/company/company-types';
import { AccountMenu } from '@/features/cloud/account-menu';
import { useCurrentApp } from '@/suite/current-app';
import { AppTiles, CurrentApp } from '@/suite/switcher';
import { SuiteLogo } from '@/suite/logo';
import type { AppId } from '@/suite/types';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import {
  activeGroupId,
  activeLink,
  INTEGRATIONS_GROUP,
  isGroupOpen,
  loadGroupState,
  navLinks,
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
        'bg-primary-solid text-on-primary flex size-8 items-center justify-center rounded-lg text-xs font-semibold',
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
  const type = companyTypeName(company.companyType);
  const go = (to: string) => {
    onNavigate?.();
    navigate(to);
  };
  return (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <button
          type="button"
          className="bg-surface flex w-full items-center gap-3 rounded-2xl p-2 text-start shadow-xs ring-1 ring-slate-900/5 transition-shadow hover:shadow-sm pointer-coarse:min-h-12"
          aria-label={t('Switch company')}
        >
          <CompanyLogo name={company.name} logo={company.branding.logo} />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-sm font-semibold text-slate-900">
              {localName(company)}
            </span>
            <span className="block truncate text-xs text-slate-500">
              {type ? (
                <>
                  <bdi>{type}</bdi> ·{' '}
                </>
              ) : null}
              {company.currency}
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
            <span className="min-w-0">
              <span dir="auto" className="block truncate">
                {localName(c)}
              </span>
              {companyTypeName(c.companyType) ? (
                <span dir="auto" className="block truncate text-xs text-slate-500">
                  {companyTypeName(c.companyType)}
                </span>
              ) : null}
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
  'text-slate-700 hover:bg-surface/70 hover:text-slate-900 [&_svg]:text-slate-500 hover:[&_svg]:text-slate-600';
const itemActive =
  'bg-surface text-primary-700 shadow-xs ring-1 ring-slate-900/5 [&_svg]:text-primary-600';

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

/** A company link: it opens in a new tab. In a group, the icon follows the name. */
function ExternalItem({
  link,
  className,
  nested,
  onNavigate,
}: {
  link: CompanyLink;
  className: string;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      className={className}
    >
      {nested ? null : <ExternalLink aria-hidden />}
      <span className="min-w-0 flex-1 truncate">
        {localName({ name: link.label, nameAr: link.labelAr })}
      </span>
      {nested ? <ExternalLink aria-hidden /> : null}
      <span className="sr-only">{t('(opens in a new tab)')}</span>
    </a>
  );
}

/**
 * The company's other tools and its integrations (Settings → Links), those
 * chosen for the open app; they open in a new tab.
 */
function CompanyLinks({
  app,
  open,
  onToggle,
  onNavigate,
}: {
  app: AppId;
  /** Whether the Integrations group shows its links. */
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const { company } = useCompanyContext();
  const panelId = useId();
  const { links, integrations } = linkSections(sidebarLinks(company.links, linkPlace([app])));
  return (
    <>
      {links.length ? (
        <ul className="mt-3 space-y-0.5" aria-label={t('Links')}>
          {links.map((link) => (
            <li key={link.id}>
              <ExternalItem
                link={link}
                onNavigate={onNavigate}
                className={cn(itemBase, itemHeight, itemIdle)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {integrations.length ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className={cn(itemBase, itemHeight, itemIdle)}
          >
            <Plug aria-hidden />
            <span className="flex-1 text-start">{t('Integrations')}</span>
            <ChevronDown
              className={cn(
                'size-4! text-slate-400 transition-transform duration-150',
                !open && '-rotate-90 rtl:rotate-90',
              )}
              aria-hidden
            />
          </button>
          <ul
            id={panelId}
            hidden={!open}
            className="mt-px mb-1 space-y-px"
            aria-label={t('Integrations')}
          >
            {integrations.map((link) => (
              <li key={link.id}>
                <ExternalItem
                  link={link}
                  nested
                  onNavigate={onNavigate}
                  className="hover:bg-surface/70 flex h-[1.875rem] items-center gap-2 rounded-xl ps-[2.625rem] pe-3 text-sm text-slate-600 transition-colors hover:text-slate-900 pointer-coarse:h-11 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-slate-400"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const taxesOn = useTaxesEnabled();
  const { company } = useCompanyContext();
  const { pathname } = useLocation();
  // The open app's sidebar; apps the person may not open never show.
  const app = useCurrentApp();
  const costing = useCostingShown();
  const nav = visibleNav(
    app.nav,
    taxesOn,
    registerExtrasOn(company),
    fileFinderOn(company),
    approvalsOn(company),
    payrollApprovalsShown(company),
    costing.available,
  );
  const current = activeLink(pathname, [...navLinks(nav), ...app.footer]);
  const { state, toggle } = useGroupState(activeGroupId(pathname, nav));
  const list = useRef<HTMLElement>(null);
  const edges = useScrollEdges(list, 'y');

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="space-y-1.5 px-3 pt-3">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex rounded-lg px-2 pt-1 pb-1.5 outline-offset-2"
        >
          <SuiteLogo className="h-8" />
        </Link>
        <CompanySwitcher onNavigate={onNavigate} />
        {onNavigate ? <AppTiles onNavigate={onNavigate} /> : null}
        <CurrentApp onNavigate={onNavigate} />
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
                <Link
                  to={entry.to}
                  onClick={onNavigate}
                  aria-current={entry.to === current ? 'page' : undefined}
                  className={cn(itemBase, itemHeight, entry.to === current ? itemActive : itemIdle)}
                >
                  <entry.icon aria-hidden />
                  {t(entry.label)}
                </Link>
              </li>
            ) : (
              <SidebarGroup
                key={entry.id}
                group={entry}
                open={isGroupOpen(state, entry.id)}
                onToggle={() => toggle(entry.id)}
                current={current}
                onNavigate={onNavigate}
              />
            ),
          )}
        </ul>
        <CompanyLinks
          app={app.id}
          open={isGroupOpen(state, INTEGRATIONS_GROUP)}
          onToggle={() => toggle(INTEGRATIONS_GROUP)}
          onNavigate={onNavigate}
        />
      </nav>
      <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ul className="space-y-0.5">
          {app.footer.map((link) => (
            <li key={link.to}>
              <Link
                to={link.to}
                onClick={onNavigate}
                aria-current={link.to === current ? 'page' : undefined}
                className={cn(itemBase, itemHeight, link.to === current ? itemActive : itemIdle)}
              >
                <link.icon aria-hidden />
                {t(link.label)}
              </Link>
            </li>
          ))}
        </ul>
        <AccountMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function SidebarGroup({
  group,
  open,
  onToggle,
  current,
  onNavigate,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  /** The link of the current page (see activeLink). */
  current: string | null;
  onNavigate?: () => void;
}) {
  const panelId = useId();
  const containsActive = group.children.some((c) => c.to === current);
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
            <Link
              to={child.to}
              onClick={onNavigate}
              aria-current={child.to === current ? 'page' : undefined}
              className={cn(
                'flex h-[1.875rem] items-center rounded-xl ps-[2.625rem] pe-3 text-sm transition-colors pointer-coarse:h-11',
                child.to === current
                  ? 'text-primary-700 bg-surface font-medium shadow-xs ring-1 ring-slate-900/5'
                  : 'hover:bg-surface/70 text-slate-600 hover:text-slate-900',
              )}
            >
              {t(child.label)}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
