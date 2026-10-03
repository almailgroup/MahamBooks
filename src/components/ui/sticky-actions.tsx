import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { registerStickyActions } from '@/features/shell/store';

/**
 * The main buttons of an editor or form (Cancel, Save…). On phones they sit
 * in a bar at the bottom of the screen, always in reach on long pages, and
 * the tab bar makes way; on desktop they stay where they are placed, at the
 * top right of the page. Render it once: it is the same buttons on both.
 */
export function StickyActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => registerStickyActions(), []);
  return (
    <div
      data-sticky-actions=""
      className={cn(
        // Phones: a floating rounded bar where the tab bar was.
        'fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center justify-end gap-2 rounded-2xl bg-white/95 p-2.5 shadow-[0_10px_30px_-8px_rgb(15_23_42/0.3)] ring-1 ring-slate-900/5 backdrop-blur-md',
        'lg:static lg:z-auto lg:flex-wrap lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0 lg:backdrop-blur-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
