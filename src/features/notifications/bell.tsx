import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import * as Popover from '@radix-ui/react-popover';
import { ArrowRight, Bell, CheckCheck } from 'lucide-react';
import { useCompany } from '@/app/company';
import type { ChangeEvent } from '@/cloud/api';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { ChangeRow, useChangeTime } from './change-row';
import { refreshChangeStatus, useChangeFeedAccess, useChangeFeedStatus } from './hooks';

/** Changes shown in the bell; the rest are on the Updates page. */
const IN_BELL = 8;

/**
 * The bell next to the app switcher (المستجدات, Updates): the latest changes
 * of the team for the owner and approvers who turned them on, with the
 * unread ones counted. Nobody else sees it, and it isn't there for a
 * company kept on this device only.
 */
export function NotificationBell({ className }: { className?: string }) {
  const company = useCompany();
  const access = useChangeFeedAccess(company.id);
  const status = useChangeFeedStatus(access);
  // Open on the screen it was opened on: another screen (a link, the back button) closes it.
  const { pathname } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);
  const [events, setEvents] = useState<ChangeEvent[] | null | undefined>(undefined);
  const [marking, setMarking] = useState(false);
  const when = useChangeTime();

  const unread = status?.unread ?? 0;
  const latest = status?.latest ?? 0;

  useEffect(() => {
    if (!open || !access) return;
    let cancelled = false;
    access.api
      .changeFeed(access.companyId, { limit: IN_BELL })
      .then((rows) => {
        if (!cancelled) setEvents(rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setEvents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, access, latest]);

  // Only for whoever turned the changes on (Settings → Email alerts → Changes by your team).
  if (!access || !status?.enabled) return null;

  const markAll = async () => {
    if (!latest) return;
    setMarking(true);
    try {
      await access.api.markChangesRead(access.companyId, latest);
      setEvents((rows) => rows?.map((row) => ({ ...row, unread: false })));
      await refreshChangeStatus(access);
    } catch {
      // Offline: they stay unread, and the next try marks them.
    } finally {
      setMarking(false);
    }
  };

  const label =
    unread > 0 ? tp(unread, 'Updates: {count} unread', 'Updates: {count} unread') : t('Updates');

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          className={cn('relative', className)}
        >
          <Bell />
          {unread > 0 ? (
            <span
              aria-hidden
              className="bg-red-solid absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem] leading-none font-semibold text-white"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={t('Updates')}
          className="data-[state=open]:animate-fade-in bg-surface z-50 w-[24rem] max-w-[calc(100vw-1.5rem)] rounded-2xl p-2 shadow-xl ring-1 ring-slate-900/5"
        >
          <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-2">
            <p className="text-sm font-semibold text-slate-900">{t('Updates')}</p>
            {unread > 0 ? (
              <Button variant="ghost" size="xs" loading={marking} onClick={() => void markAll()}>
                <CheckCheck /> {t('Mark all as read')}
              </Button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {events === undefined ? (
              <Spinner className="py-8" />
            ) : events === null ? (
              <p className="px-2 py-6 text-center text-sm text-slate-500">
                {t('The changes could not be loaded. Try again when you are online.')}
              </p>
            ) : events.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-slate-500">
                {t('Nothing new from your team yet.')}
              </p>
            ) : (
              <ol>
                {events.map((event) => (
                  <li key={event.id}>
                    <ChangeRow event={event} when={when(event.at)} onOpen={() => setOpen(false)} />
                  </li>
                ))}
              </ol>
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-primary-700 mt-1 flex items-center justify-between rounded-lg px-2 py-2 text-sm font-medium hover:bg-slate-50"
          >
            {t('See all updates')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
