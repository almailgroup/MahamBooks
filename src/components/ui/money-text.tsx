import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useCompany, useFormat } from '@/app/company';
import { formatMoney } from '@/lib/format';

export type MoneyTone = 'default' | 'strong' | 'muted' | 'positive' | 'negative' | 'warning';

/** Text colours with at least 4.5:1 contrast on white (WCAG AA). */
const TONES: Record<MoneyTone, string> = {
  default: 'text-slate-900',
  strong: 'font-semibold text-slate-900',
  muted: 'text-slate-600',
  positive: 'text-emerald-700',
  negative: 'text-red-700',
  warning: 'text-amber-700',
};

/**
 * An amount with tabular digits, kept in one piece inside Arabic text. A
 * foreign currency shows its code ("USD 1,200.00") so it is never mistaken
 * for dinars.
 */
export function MoneyText({
  amount,
  currency,
  tone = 'default',
  className,
  ...props
}: {
  amount: number;
  currency?: string;
  tone?: MoneyTone;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  const company = useCompany();
  const fmt = useFormat();
  const foreign = Boolean(currency && currency !== company.currency);
  const text = foreign
    ? formatMoney(amount, currency!, fmt.locale, 'code')
    : fmt.money(amount, currency);
  return (
    <span
      dir="ltr"
      className={cn('tabular whitespace-nowrap [unicode-bidi:isolate]', TONES[tone], className)}
      {...props}
    >
      {text}
    </span>
  );
}
