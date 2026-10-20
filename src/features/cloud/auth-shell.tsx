import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { LanguageSwitch } from '@/i18n/language-switch';
import { ThemeMenu } from '@/features/theme/menu';
import { Card } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import { SuiteLogo } from '@/suite/logo';

/** The frame of the account screens (sign in, invitations…): brand, language, one card. */
export function AuthShell({
  title,
  description,
  icon,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="from-primary-50 via-surface to-page min-h-dvh bg-gradient-to-b">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link to="/" className="flex rounded-lg">
          <SuiteLogo className="h-9" />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeMenu className="size-9 rounded-lg text-slate-500" />
          <LanguageSwitch className="bg-surface shadow-xs ring-1 ring-slate-200" />
        </div>
      </header>
      <main
        className={cn('mx-auto w-full px-4 pt-4 pb-12 sm:pt-10', wide ? 'max-w-2xl' : 'max-w-md')}
      >
        <Card className="p-5 sm:p-8">
          {icon ? (
            <div className="bg-primary-50 text-primary-600 mb-4 flex size-11 items-center justify-center rounded-full [&_svg]:size-5">
              {icon}
            </div>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900">
            {title}
          </h1>
          {description ? (
            <div className="mt-2 text-sm text-pretty text-slate-600">{description}</div>
          ) : null}
          <div className="mt-6">{children}</div>
        </Card>
        {footer ? <div className="mt-6 text-center text-sm text-slate-600">{footer}</div> : null}
      </main>
    </div>
  );
}

/** A password field with a button to show what was typed. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        dir="ltr"
        className="pe-11 rtl:text-end"
        required
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-lg text-slate-500 hover:text-slate-700 pointer-coarse:w-11"
        aria-label={shown ? t('Hide password') : t('Show password')}
        aria-pressed={shown}
      >
        {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

/** A problem with the form, read out by screen readers. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-600/15"
    >
      {children}
    </p>
  );
}

/** Only routes of this app may follow a sign-in (no other sites). */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
