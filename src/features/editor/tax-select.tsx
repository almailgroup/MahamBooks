import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import type { TaxLine, TaxRate } from '@/db/types';
import { taxKey, taxLineOf } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';

function label(tax: TaxLine) {
  const base = `${tax.name} ${Number(tax.rate.toFixed(4))}%`;
  return tax.kind === 'reverse_charge' ? `${base} (${t('Reverse charge')})` : base;
}

/** Multi-select of tax rates. Values are snapshots ({name, rate}). */
export function TaxSelect({
  value,
  onChange,
  rates,
  className,
  placeholder: placeholderText,
  id,
}: {
  value: TaxLine[];
  onChange: (value: TaxLine[]) => void;
  rates: TaxRate[];
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  const placeholder = placeholderText ?? t('No tax');
  const selected = new Set(value.map(taxKey));
  const options: TaxLine[] = [...rates.filter((r) => !r.archived).map(taxLineOf)];
  // Keep taxes that are no longer configured but are still on this document.
  for (const t of value) {
    if (!options.some((o) => taxKey(o) === taxKey(t))) options.push(t);
  }

  const toggle = (t: TaxLine) => {
    const key = taxKey(t);
    onChange(selected.has(key) ? value.filter((v) => taxKey(v) !== key) : [...value, t]);
  };

  // Rates only, so the control stays readable when narrow; names are in the tooltip.
  const summary =
    value.length === 0
      ? placeholder
      : value
          .map((t) => `${Number(t.rate.toFixed(4))}%${t.kind === 'reverse_charge' ? ' RC' : ''}`)
          .join(' + ');

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          title={value.map(label).join(' + ') || placeholder}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-start text-sm shadow-xs hover:border-slate-400',
            value.length === 0 && 'text-slate-400',
            className,
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="data-[state=open]:animate-fade-in z-50 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500">
              {t('No tax rates yet. Add them in Settings → Taxes.')}
            </p>
          ) : (
            options.map((t) => {
              const on = selected.has(taxKey(t));
              return (
                <button
                  key={taxKey(t)}
                  type="button"
                  onClick={() => toggle(t)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm hover:bg-slate-100"
                >
                  <span
                    className={cn(
                      'flex size-4 items-center justify-center rounded border',
                      on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300',
                    )}
                  >
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  {label(t)}
                </button>
              );
            })
          )}
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md border-t border-slate-100 px-2.5 py-2 text-start text-sm text-slate-500 hover:bg-slate-50"
            >
              {t('Clear')}
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
