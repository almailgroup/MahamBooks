import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useBlockedSave } from './read-only';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-solid text-on-primary shadow-sm hover:bg-primary-solid-hover active:bg-primary-solid-active',
  secondary: 'bg-slate-900 text-surface shadow-sm hover:bg-slate-800',
  outline:
    'border border-slate-300 bg-surface text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-solid text-white shadow-sm hover:bg-red-solid-hover',
  subtle: 'bg-primary-50 text-primary-700 hover:bg-primary-100',
};

// On touch screens every button is at least 44px tall (and wide for icons).
const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs pointer-coarse:min-h-11',
  sm: 'h-8 px-3 text-sm pointer-coarse:min-h-11',
  md: 'h-9 px-4 text-sm pointer-coarse:min-h-11',
  lg: 'h-11 px-5 text-base',
  icon: 'size-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
  'icon-sm': 'size-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  title,
  ...props
}: ButtonProps) {
  // View only (see read-only.tsx): save buttons are off, with the reason.
  const blocked = useBlockedSave(variant);
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading || blocked !== null}
      title={blocked ?? title}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
