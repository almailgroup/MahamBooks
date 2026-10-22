import { NavLink, useNavigate } from 'react-router';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, Plus, Search, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { useRoleView } from '@/features/cloud/role-gates';
import { createGroups } from '@/suite/apps';
import { useAppAccess, useApps, useCurrentApp } from '@/suite/current-app';
import { useHasStickyActions, useTyping } from './store';

/**
 * The phone's tab bar: the pages used every day, the New sheet in the middle
 * and More for the full menu. It makes way for the keyboard and for an
 * editor's own action bar.
 */
export function BottomBar({
  onMore,
  onNew,
  onSearch,
}: {
  onMore: () => void;
  onNew: () => void;
  onSearch: () => void;
}) {
  const typing = useTyping();
  const editor = useHasStickyActions();
  const app = useCurrentApp();
  const canCreate = useCreateGroups().length > 0;
  if (editor) return null;
  const [first, second, third] = app.tabs;
  return (
    <nav
      aria-label={t('Shortcuts')}
      className={cn(
        // A floating rounded bar, clear of the home indicator.
        'bg-surface/95 fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-2xl shadow-[0_10px_30px_-8px_rgb(15_23_42/0.3)] ring-1 ring-slate-900/5 backdrop-blur-md lg:hidden print:hidden',
        typing && 'hidden',
      )}
    >
      <ul className="mx-auto grid h-16 max-w-lg grid-cols-5 items-stretch px-1.5">
        <Tab to={first.to} end={first.end} icon={first.icon} label={t(first.label)} />
        <Tab to={second.to} end={second.end} icon={second.icon} label={t(second.label)} />
        <li className="flex items-center justify-center">
          {canCreate ? (
            <button
              type="button"
              onClick={onNew}
              aria-label={t('Create new')}
              className="bg-primary-solid hover:bg-primary-solid-hover active:bg-primary-solid-active text-on-primary shadow-primary-solid/30 flex size-12 items-center justify-center rounded-2xl shadow-lg"
            >
              <Plus className="size-6" aria-hidden />
            </button>
          ) : (
            // Nothing to create (view only): search takes its place.
            <button
              type="button"
              onClick={onSearch}
              aria-label={t('Search')}
              className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600"
            >
              <Search className="size-5" aria-hidden />
            </button>
          )}
        </li>
        <Tab to={third.to} end={third.end} icon={third.icon} label={t(third.label)} />
        <li>
          <button
            type="button"
            onClick={onMore}
            className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs font-medium text-slate-600"
          >
            <Menu className="size-5" aria-hidden />
            {t('More')}
          </button>
        </li>
      </ul>
    </nav>
  );
}

function Tab({
  to,
  icon: Icon,
  label,
  end,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          cn(
            'flex h-full flex-col items-center justify-center gap-1 text-xs font-medium',
            isActive ? 'text-primary-700' : 'text-slate-600',
          )
        }
      >
        <Icon className="size-5" aria-hidden />
        {label}
      </NavLink>
    </li>
  );
}

/**
 * What the person may create from here: the open app's things first, then
 * the other apps' they work in. Nothing for viewers.
 */
export function useCreateGroups() {
  const app = useCurrentApp();
  const apps = useApps();
  const access = useAppAccess();
  // The header and tab bar sit outside the page's read-only context.
  const { readOnly } = useRoleView().readOnly;
  return readOnly ? [] : createGroups(app.id, access, apps);
}

/** Everything that can be created, as a sheet from the bottom of the screen. */
export function NewSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const groups = useCreateGroups();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-fade-in bg-overlay/40 fixed inset-0 z-50" />
        <DialogPrimitive.Content
          className="data-[state=open]:animate-sheet-up bg-surface fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl shadow-2xl outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <DialogPrimitive.Title className="text-base font-semibold text-slate-900">
              {t('Create new')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="-me-2 flex size-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
              <X className="size-5" aria-hidden />
              <span className="sr-only">{t('Close')}</span>
            </DialogPrimitive.Close>
          </div>
          <div className="scroll-thin overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {groups.map((group) => (
              <section key={group.label} className="py-2">
                <h3 className="px-2 pb-1.5 text-xs font-semibold text-slate-500">
                  {t(group.label)}
                </h3>
                <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {group.actions.map((action) => (
                    <li key={action.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(action.to);
                        }}
                        className="flex h-full min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2.5 text-center text-xs leading-tight font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100"
                      >
                        <span className="bg-primary-50 text-primary-700 flex size-10 items-center justify-center rounded-full [&_svg]:size-5">
                          <action.icon aria-hidden />
                        </span>
                        {t(action.label)}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
