import { Link } from 'react-router';
import { useFormat } from '@/app/company';
import { describeChange } from '@/alerts/changes';
import type { ChangeEvent } from '@/cloud/api';
import { Badge } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { addDaysISO, toISODate, today } from '@/lib/dates';
import { changeLink } from './links';

/**
 * One change of the team: who, what was done to what, the customer and the
 * amount, when; unread ones marked, important ones tagged. Opens the record.
 */
export function ChangeRow({
  event,
  when,
  onOpen,
  className,
}: {
  event: ChangeEvent;
  /** When it happened, written for the list it is in. */
  when: string;
  onOpen?: () => void;
  className?: string;
}) {
  const fmt = useFormat();
  const line = describeChange(event, { money: fmt.money, date: fmt.date });
  const to = changeLink(event);
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          event.unread ? 'bg-primary-500' : 'bg-transparent',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-700">
          <span dir="auto" className="font-semibold text-slate-900">
            {line.actor}
          </span>{' '}
          <span dir="auto">{line.text}</span>
        </span>
        {line.detail ? (
          <span dir="auto" className="block truncate text-xs text-slate-600">
            {line.detail}
          </span>
        ) : null}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>{when}</span>
          {event.important ? <Badge tone="amber">{t('Important')}</Badge> : null}
          {event.unread ? <span className="sr-only">{t('Unread')}</span> : null}
        </span>
      </span>
    </>
  );
  const style = cn('flex gap-3 rounded-lg px-2 py-2', className);
  return to ? (
    <Link
      to={to}
      onClick={onOpen}
      className={cn(style, 'hover:bg-slate-50 focus-visible:bg-slate-50')}
    >
      {body}
    </Link>
  ) : (
    <div className={style}>{body}</div>
  );
}

/** "Just now", "12 minutes ago", "Today at 9:40", or the date and time. */
export function useChangeTime(): (at: string) => string {
  const fmt = useFormat();
  return (at: string) => {
    const time = new Date(at);
    if (Number.isNaN(time.getTime())) return '';
    const minutes = Math.round((Date.now() - time.getTime()) / 60_000);
    if (minutes < 1) return t('Just now');
    if (minutes < 60) return tp(minutes, '{count} minute ago', '{count} minutes ago');
    const clock = new Intl.DateTimeFormat(fmt.locale, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(time);
    const local = toISODate(time);
    if (local === today()) return t('Today at {time}', { time: clock });
    if (local === addDaysISO(today(), -1)) return t('Yesterday at {time}', { time: clock });
    return fmt.dateTime(at);
  };
}
