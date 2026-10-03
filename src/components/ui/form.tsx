import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { normalizeDigits } from '@/lib/money';
import { t } from '@/i18n';

const control =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 aria-invalid:border-red-400 aria-invalid:ring-red-500/15';

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(control, 'h-9', className)} {...props} />;
}

export function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(control, 'min-h-20 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(control, 'h-9 appearance-none pe-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
    </div>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-slate-700', className)} {...props} />;
}

/** Label + control + hint/error. The child receives the generated id. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
  optional,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  optional?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={id}>
          {label}
          {optional ? (
            <span className="ms-1 font-normal text-slate-400">({t('optional')})</span>
          ) : null}
        </Label>
      ) : null}
      {children(id)}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input
        id={id}
        type="checkbox"
        className="accent-primary-600 mt-0.5 size-4 shrink-0 rounded border-slate-300"
        {...props}
      />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        {description ? <span className="block text-slate-500">{description}</span> : null}
      </label>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        {description ? <span className="mt-0.5 block text-slate-500">{description}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-white shadow transition-transform',
            checked
              ? 'translate-x-5.5 rtl:-translate-x-5.5'
              : 'translate-x-0.5 rtl:-translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/**
 * Numeric input that keeps what the user types (e.g. "0.", "-", "1,5") and
 * reports a number. Commas are accepted as decimal separators when unambiguous.
 */
export function NumberInput({
  value,
  onValueChange,
  className,
  allowNegative = true,
  blankZero = false,
  onBlur,
  onFocus,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
  allowNegative?: boolean;
  /** Show an empty field instead of "0" (e.g. debit/credit columns). */
  blankZero?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const display =
    text ?? (blankZero && value === 0 ? '' : Number.isFinite(value) ? String(value) : '');

  const parse = (raw: string): number | null => {
    let s = normalizeDigits(raw).trim().replace(/\s/g, '');
    if (s === '' || s === '-' || s === '.' || s === ',') return 0;
    // "1.234,56" -> "1234.56"; "1,5" -> "1.5"; "1,234.5" -> "1234.5"
    if (s.includes(',') && s.includes('.')) {
      s =
        s.lastIndexOf(',') > s.lastIndexOf('.')
          ? s.replace(/\./g, '').replace(',', '.')
          : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const parts = s.split(',');
      // "1,5" and "0,250" use a decimal comma; "12,500" is twelve thousand five hundred.
      const decimalComma = parts.length === 2 && (parts[1].length !== 3 || /^-?0?$/.test(parts[0]));
      s = decimalComma ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return allowNegative ? n : Math.abs(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      // Numbers read left to right in Arabic too ("-12.500", not "12.500-");
      // in the Arabic layout they line up on the left like amount columns.
      dir="ltr"
      className={cn(control, 'tabular h-9 text-end rtl:text-left', className)}
      value={display}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n !== null) onValueChange(n);
      }}
      onBlur={(e) => {
        setText(null);
        onBlur?.(e);
      }}
      onFocus={(e) => {
        e.target.select();
        onFocus?.(e);
      }}
      {...props}
    />
  );
}
