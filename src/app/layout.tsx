import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { useCompanyContext } from './company';
import { Spinner } from '@/components/ui/misc';
import { generateDueInvoices } from '@/db/recurring';
import { t, tp } from '@/i18n';
import { CompanyLogo, SidebarContent } from '@/features/shell/sidebar';
import { AppHeader } from '@/features/shell/header';
import { BottomBar, NewSheet } from '@/features/shell/bottom-bar';
import { isTypingTarget } from '@/features/shell/store';
import { watchScrolling } from '@/features/shell/scrolling';
import { CommandPalette } from '@/features/search/command-palette';
import { AiAssistant } from '@/features/ai/assistant';
import { useAssistantOpen } from '@/features/ai/store';
import { ThemeMenu } from '@/features/theme/menu';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { useRoleView, ViewOnlyBanner } from '@/features/cloud/role-gates';
import { useCloudLink } from '@/cloud/hooks';
import { useRuntimeStatus } from '@/cloud/status';
import { useRememberApp } from '@/suite/current-app';

const ItemOpener = lazy(() => import('@/apps/books/pages/products/item-opener'));

// Recurring invoices are generated client-side, once per company per visit.
const recurringChecked = new Set<string>();

function useRecurringGeneration() {
  const { company } = useCompanyContext();
  const navigate = useNavigate();
  const link = useCloudLink(company.id);
  const runtime = useRuntimeStatus(company.id);
  // A company kept in the cloud first catches up with the team, so two
  // devices don't both create the same recurring invoice.
  const ready =
    link === null || (link !== undefined && link.status === 'ready' && runtime.syncedOnce === true);
  useEffect(() => {
    if (!ready || recurringChecked.has(company.id)) return;
    recurringChecked.add(company.id);
    void generateDueInvoices(company.id)
      .then((created) => {
        if (created.length === 0) return;
        toast.success(
          tp(
            created.length,
            '{count} recurring invoice created',
            '{count} recurring invoices created',
          ),
          { action: { label: t('View'), onClick: () => navigate('/invoices') } },
        );
      })
      .catch(() => {
        recurringChecked.delete(company.id);
      });
  }, [company.id, navigate, ready]);
}

/** Ctrl+K or ⌘K anywhere, and "/" when not typing, open the command palette. */
function usePaletteShortcut(open: () => void, toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e.target) &&
        !document.querySelector('[role="dialog"], [role="menu"]')
      ) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle]);
}

const openPalette = (set: (open: boolean | ((o: boolean) => boolean)) => void) => ({
  open: () => set(true),
  toggle: () => set((o) => !o),
});

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [palette] = useState(() => openPalette(setPaletteOpen));
  const roles = useRoleView();
  // On wide screens the page makes room for the AI assistant's panel, so
  // the buttons its answers name stay in sight beside it.
  const besideAssistant = useAssistantOpen();
  // Recurring invoices (Books) are made whichever app is open.
  useRecurringGeneration();
  useRememberApp();
  usePaletteShortcut(palette.open, palette.toggle);
  const location = useLocation();
  const panel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => watchScrolling(), []);
  useEffect(() => {
    // The page panel scrolls on desktop, the window on phones.
    const el = panel.current;
    const onScroll = () => setScrolled((el?.scrollTop ?? 0) > 2 || window.scrollY > 2);
    el?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el?.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  // A new page starts at the top.
  useEffect(() => {
    panel.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  // Full-width pages (the document editor) manage their own layout.
  const wide =
    /\/(new|edit)$/.test(location.pathname) ||
    /^\/(invoices|quotes|credits|proformas|sales-orders|delivery-notes)\/[^/]+$/.test(
      location.pathname,
    );

  return (
    <div className="bg-shell min-h-dvh">
      {/* Desktop: the menu sits on the tinted backdrop, the page in a rounded white panel. */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 lg:block print:hidden">
        <SidebarContent />
      </aside>

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="data-[state=open]:animate-fade-in bg-overlay/40 fixed inset-0 z-40 lg:hidden" />
          <DialogPrimitive.Content className="data-[state=open]:animate-drawer-in bg-shell fixed inset-y-0 start-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col rounded-e-3xl shadow-2xl outline-none lg:hidden">
            <DialogPrimitive.Title className="sr-only">{t('Navigation')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {t('Main navigation')}
            </DialogPrimitive.Description>
            <div className="flex items-center justify-between gap-2 ps-5 pe-3 pt-[max(0.25rem,env(safe-area-inset-top))]">
              <span className="text-sm font-semibold text-slate-600">{t('Menu')}</span>
              <ThemeMenu
                className="ms-auto size-11 rounded-full text-slate-500 sm:hidden"
                onNavigate={() => setDrawerOpen(false)}
              />
              <DialogPrimitive.Close className="flex size-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                <X className="size-5" aria-hidden />
                <span className="sr-only">{t('Close menu')}</span>
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1">
              <SidebarContent onNavigate={() => setDrawerOpen(false)} />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div
        className={cn(
          'lg:fixed lg:inset-y-2.5 lg:start-64 lg:end-2.5 print:static',
          // From 1360px wide, the panel's width (26rem) and the gaps on each
          // side of it; narrower, the page would be too cramped and the panel covers it.
          besideAssistant && 'min-[85rem]:end-[27.25rem]',
        )}
      >
        <div
          ref={panel}
          className="scroll-thin bg-page lg:bg-surface min-h-dvh lg:h-full lg:min-h-0 lg:overflow-y-auto lg:rounded-3xl lg:shadow-[0_1px_3px_rgb(15_23_42/0.05),0_12px_40px_-16px_rgb(15_23_42/0.18)] lg:ring-1 lg:ring-slate-900/[0.04] print:h-auto print:overflow-visible print:rounded-none print:bg-white print:shadow-none print:ring-0"
        >
          <AppHeader
            onMenu={() => setDrawerOpen(true)}
            onSearch={palette.open}
            scrolled={scrolled}
          />
          <main
            className={cn(
              'mx-auto px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-6 lg:pb-10',
              wide ? 'max-w-[1600px]' : 'max-w-7xl',
            )}
          >
            <ReadOnlyContext.Provider value={roles.readOnly}>
              <ViewOnlyBanner />
              <Suspense fallback={<Spinner className="py-24" label={t('Loading…')} />}>
                <Outlet />
              </Suspense>
            </ReadOnlyContext.Provider>
          </main>
        </div>
      </div>

      <BottomBar
        onMore={() => setDrawerOpen(true)}
        onNew={() => setNewOpen(true)}
        onSearch={palette.open}
      />
      <NewSheet open={newOpen} onOpenChange={setNewOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenItem={setItemId} />
      {/* Ask AI, once the company has the AI assistant switched on (Settings → AI assistant). */}
      <AiAssistant />
      {itemId ? (
        <Suspense fallback={null}>
          <ItemOpener id={itemId} onClose={() => setItemId(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}

export { CompanyLogo };
