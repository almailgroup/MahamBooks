import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';

/**
 * Lists on phones. Tables with more than three columns don't fit 390px:
 * show the table from `md` up and a stack of `ListCard`s below it.
 *
 *   <ResponsiveList
 *     table={<table>…</table>}
 *     cards={<ListCards>{rows.map((r) => <ListCard key={r.id} … />)}</ListCards>}
 *   />
 *
 * Put the most important text in `title` and `amount`, the rest in
 * `subtitle` (one line, truncated) and a status badge in `status`.
 */
export function ResponsiveList({
  table,
  cards,
  breakpoint = 'md',
}: {
  table: ReactNode;
  cards: ReactNode;
  breakpoint?: 'sm' | 'md' | 'lg';
}) {
  const show = { sm: 'sm:block', md: 'md:block', lg: 'lg:block' }[breakpoint];
  const hide = { sm: 'sm:hidden', md: 'md:hidden', lg: 'lg:hidden' }[breakpoint];
  return (
    <>
      {/* The table comes first, so text searches find its visible copy on desktop. */}
      <div className={cn('hidden', show)}>{table}</div>
      <div className={hide}>{cards}</div>
    </>
  );
}

export function ListCards({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('divide-y divide-slate-100', className)}>{children}</ul>;
}

/** One row of a list on a phone: a single tap target of at least 56px. */
export function ListCard({
  to,
  onClick,
  title,
  subtitle,
  amount,
  status,
  leading,
  className,
}: {
  to?: string;
  onClick?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Usually a `MoneyText`. */
  amount?: ReactNode;
  /** Usually a `Badge` or `StatusBadge`. */
  status?: ReactNode;
  /** An icon or avatar before the text. */
  leading?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span dir="auto" className="truncate text-start text-sm font-medium text-slate-900">
            {title}
          </span>
          {amount ? <span className="shrink-0 text-sm font-semibold">{amount}</span> : null}
        </span>
        {subtitle || status ? (
          <span className="mt-1 flex items-center justify-between gap-3">
            <span className="truncate text-xs text-slate-500">{subtitle}</span>
            {status ? <span className="shrink-0">{status}</span> : null}
          </span>
        ) : null}
      </span>
    </>
  );
  const classes = cn(
    'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start hover:bg-slate-50 active:bg-slate-100',
    className,
  );
  return (
    <li>
      {to ? (
        <Link to={to} className={classes}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={classes}>
          {body}
        </button>
      ) : (
        <div className={classes}>{body}</div>
      )}
    </li>
  );
}
