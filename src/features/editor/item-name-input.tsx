import { useMemo, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Package } from 'lucide-react';
import type { Product } from '@/db/types';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';

/**
 * Text input for an item name that suggests matching products while typing.
 * Picking a product fills the whole line.
 */
export function ItemNameInput({
  value,
  onChange,
  products,
  onPick,
  formatPrice,
  placeholder,
  id,
  ariaLabel,
  priceOf = (p) => p.unitPrice,
  stockOf,
}: {
  value: string;
  onChange: (value: string) => void;
  products: Product[];
  onPick: (product: Product) => void;
  formatPrice: (amount: number) => string;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  /** Price shown next to each suggestion (bills show the cost price). */
  priceOf?: (product: Product) => number;
  /** Stock on hand shown under a stock item's suggestion. */
  stockOf?: (product: Product) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const live = products.filter((p) => !p.archived);
    if (!q) return live.slice(0, 8);
    return live
      .filter((p) =>
        `${p.name} ${p.nameAr ?? ''} ${p.sku} ${p.description}`.toLowerCase().includes(q),
      )
      .filter((p) => p.name.toLowerCase() !== q)
      .slice(0, 8);
  }, [products, value]);

  const show = open && matches.length > 0;

  const pick = (product: Product) => {
    onPick(product);
    setOpen(false);
  };

  return (
    <Popover.Root open={show} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <input
          id={id}
          aria-label={ariaLabel}
          value={value}
          placeholder={placeholder ?? t('Item name or search products…')}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(matches.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(matches[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          className="focus:border-primary-500 focus:ring-primary-500/15 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-xs placeholder:font-normal placeholder:text-slate-400 focus:ring-3"
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-72 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-slate-500">
            {t('Products & services')}
          </p>
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-start',
                i === active ? 'bg-slate-100' : '',
              )}
            >
              <Package className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-900">
                  {p.name}
                  {p.nameAr ? (
                    <span className="ms-2 text-slate-500" dir="rtl" lang="ar">
                      {p.nameAr}
                    </span>
                  ) : null}
                </span>
                {p.description || p.sku ? (
                  <span className="block truncate text-xs text-slate-500">
                    {[p.sku, p.description].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
                {stockOf?.(p) ?? null}
              </span>
              <span className="tabular shrink-0 text-sm text-slate-600">
                {formatPrice(priceOf(p))}
                {p.unit ? <span className="text-slate-500"> / {p.unit}</span> : null}
              </span>
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
