import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, EyeOff } from 'lucide-react';
import { t } from '@/i18n';

// Validated categorical slots 1 and 2 (dataviz reference palette); each
// theme sets the step for its surface (src/lib/themes.ts).
export const SERIES_1 = 'var(--color-chart-1)';
export const SERIES_2 = 'var(--color-chart-2)';

// Aging buckets are ordered: one hue in the theme's accent, lighter to darker
// as invoices get older on light themes, brighter on dark ones (validated
// ordinal ramp: monotone lightness, visible steps, nearest end ≥ 2:1).
export const AGING_COLORS = ['bg-aging-1', 'bg-aging-2', 'bg-aging-3', 'bg-aging-4', 'bg-aging-5'];

/** Axis ticks: "12K" (the currency is named in the card's description). */
export function compactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-primary-700 -my-1 flex items-center gap-1 rounded-md py-1 text-sm font-medium hover:underline pointer-coarse:min-h-11"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** Takes a card off this person's dashboard; "Show hidden cards" brings it back. */
export function HideCardButton({ title, onHide }: { title: string; onHide: () => void }) {
  return (
    <button
      type="button"
      onClick={onHide}
      className="-my-1 -me-2 flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 pointer-coarse:size-11"
      aria-label={t('Hide {card}', { card: title })}
      title={t('Hide this card')}
    >
      <EyeOff className="size-4" aria-hidden />
    </button>
  );
}

/** Card actions: its link, then the hide button. */
export function CardActions({
  title,
  onHide,
  children,
}: {
  title: string;
  onHide?: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {children}
      {onHide ? <HideCardButton title={title} onHide={onHide} /> : null}
    </>
  );
}
