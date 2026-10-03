import { useNavigate } from 'react-router';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Menu as MenuIcon, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { LanguageSwitch } from '@/i18n/language-switch';
import { useCompany } from '@/app/company';
import { localName } from '@/i18n/names';
import { shortcutLabel } from '@/features/search/command-palette';
import { t } from '@/i18n';
import { CREATE_GROUPS, type CreateGroup } from './create';
import { CompanyLogo } from './sidebar';

export function AppHeader({
  onMenu,
  onSearch,
  scrolled,
}: {
  onMenu: () => void;
  onSearch: () => void;
  /** Content runs under the header: it gets a soft shadow instead of a line. */
  scrolled: boolean;
}) {
  const company = useCompany();
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-14 items-center gap-2 bg-white/85 px-3 backdrop-blur-md transition-shadow duration-200 sm:px-6 lg:h-16 lg:px-8 print:hidden',
        scrolled && 'shadow-[0_10px_24px_-18px_rgb(15_23_42/0.35)]',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="-ms-1 lg:hidden"
        onClick={onMenu}
        aria-label={t('Open menu')}
      >
        <MenuIcon />
      </Button>
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <CompanyLogo name={company.name} logo={company.branding.logo} className="size-7" />
        <span dir="auto" className="truncate text-sm font-semibold text-slate-900">
          {localName(company)}
        </span>
      </div>

      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts="Control+K Meta+K /"
        className="group hidden h-10 w-full max-w-sm items-center gap-2.5 rounded-xl bg-slate-100/80 ps-3.5 pe-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 lg:flex"
      >
        <Search className="size-4 text-slate-400 group-hover:text-slate-500" aria-hidden />
        <span className="flex-1 text-start">{t('Search')}</span>
        <kbd
          dir="ltr"
          className="rounded-md bg-white px-1.5 py-0.5 font-sans text-xs text-slate-500 shadow-xs ring-1 ring-slate-900/5"
        >
          {shortcutLabel()}
        </kbd>
      </button>

      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onSearch}
        aria-label={t('Search')}
      >
        <Search />
      </Button>
      <LanguageSwitch />
      <NewMenu />
    </header>
  );
}

function NewMenu() {
  const navigate = useNavigate();
  // Two columns: sales and accounting, purchases and contacts.
  const [sales, purchases, contacts, accounting] = CREATE_GROUPS;
  const column = (groups: CreateGroup[]) => (
    <div className="min-w-0">
      {groups.map((group, i) => (
        <Menu.Group key={group.label} className={i > 0 ? 'mt-2' : ''}>
          <Menu.Label className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-slate-500">
            {t(group.label)}
          </Menu.Label>
          {group.actions.map((action) => (
            <Menu.Item
              key={action.id}
              onSelect={() => navigate(action.to)}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 outline-none select-none data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900 pointer-coarse:min-h-11"
            >
              <action.icon className="size-4 shrink-0 text-slate-400" aria-hidden />
              {t(action.label)}
            </Menu.Item>
          ))}
        </Menu.Group>
      ))}
    </div>
  );
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" className="hidden lg:inline-flex">
          <Plus /> {t('New')}
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="data-[state=open]:animate-fade-in z-50 grid w-[30rem] max-w-[calc(100vw-1.5rem)] grid-cols-2 gap-x-1 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5"
        >
          {column([sales, accounting])}
          {column([purchases, contacts])}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
