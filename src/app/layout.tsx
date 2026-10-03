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

const ItemOpener = lazy(() => import('@/features/search/item-opener'));

// Recurring invoices are generated client-side, once per company per visit.
const recurringChecked = new Set<string>();

function useRecurringGeneration() {
  const { company } = useCompanyContext();
  const navigate = useNavigate();
  useEffect(() => {
    if (recurringChecked.has(company.id)) return;
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
  }, [company.id, navigate]);
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
  useRecurringGeneration();
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
          <DialogPrimitive.Overlay className="data-[state=open]:animate-fade-in fixed inset-0 z-40 bg-slate-900/40 lg:hidden" />
          <DialogPrimitive.Content className="data-[state=open]:animate-drawer-in bg-shell fixed inset-y-0 start-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col rounded-e-3xl shadow-2xl outline-none lg:hidden">
            <DialogPrimitive.Title className="sr-only">{t('Navigation')}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {t('Main navigation')}
            </DialogPrimitive.Description>
            <div className="flex items-center justify-between gap-2 ps-5 pe-3 pt-[max(0.25rem,env(safe-area-inset-top))]">
              <span className="text-sm font-semibold text-slate-500">{t('Menu')}</span>
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

      <div className="lg:fixed lg:inset-y-2.5 lg:start-64 lg:end-2.5 print:static">
        <div
          ref={panel}
          className="scroll-thin min-h-dvh bg-slate-50 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:rounded-3xl lg:bg-white lg:shadow-[0_1px_3px_rgb(15_23_42/0.05),0_12px_40px_-16px_rgb(15_23_42/0.18)] lg:ring-1 lg:ring-slate-900/[0.04] print:h-auto print:overflow-visible print:rounded-none print:bg-white print:shadow-none print:ring-0"
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
            <Suspense fallback={<Spinner className="py-24" label={t('Loading…')} />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <BottomBar onMore={() => setDrawerOpen(true)} onNew={() => setNewOpen(true)} />
      <NewSheet open={newOpen} onOpenChange={setNewOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onOpenItem={setItemId} />
      {itemId ? (
        <Suspense fallback={null}>
          <ItemOpener id={itemId} onClose={() => setItemId(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}

export { CompanyLogo };
