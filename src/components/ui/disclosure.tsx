import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A section that opens and closes: a button with a chevron and, when open,
 * its content. Collapsed by default.
 */
export function Disclosure({
  label,
  hint,
  children,
  defaultOpen = false,
  className,
}: {
  label: ReactNode;
  /** Short text after the label, e.g. a count. */
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn('rounded-lg border border-slate-200', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-start text-sm font-medium text-slate-800 hover:bg-slate-50 pointer-coarse:min-h-11"
      >
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-slate-500 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        <span>{label}</span>
        {hint ? <span className="ms-auto text-xs font-normal text-slate-500">{hint}</span> : null}
      </button>
      {open ? (
        <div id={id} className="space-y-4 border-t border-slate-100 px-4 py-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
