import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Heading,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import type { LineItem, Product, TaxLine, TaxRate } from '@/db/types';
import { taxLineOf, type CalcLineResult } from '@/lib/calc';
import { cn } from '@/lib/cn';
import { newHeading, newLineItem } from '@/db/documents';
import { Button } from '@/components/ui/button';
import { Input, NumberInput, Textarea } from '@/components/ui/form';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { ItemNameInput } from './item-name-input';
import { TaxSelect } from './tax-select';

function MiniLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-slate-500 @xl:hidden">{children}</span>
  );
}

export function DiscountInput({
  value,
  type,
  onChange,
  currencySymbol,
  ariaLabel = 'Discount',
}: {
  value: number;
  type: 'percent' | 'amount';
  onChange: (value: number, type: 'percent' | 'amount') => void;
  currencySymbol: string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex">
      <NumberInput
        aria-label={ariaLabel}
        value={value}
        onValueChange={(v) => onChange(v, type)}
        allowNegative={false}
        className="rounded-e-none"
      />
      <button
        type="button"
        onClick={() => onChange(value, type === 'percent' ? 'amount' : 'percent')}
        className="h-9 min-w-9 rounded-e-lg border border-s-0 border-slate-300 bg-slate-50 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
        title={type === 'percent' ? 'Switch to a fixed amount' : 'Switch to a percentage'}
      >
        {type === 'percent' ? '%' : currencySymbol}
      </button>
    </div>
  );
}

export function LineItemsEditor({
  items,
  onChange,
  lines,
  products,
  taxRates,
  showTaxes,
  defaultTaxes,
  currencySymbol,
  formatMoney,
  formatPrice,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  lines: CalcLineResult[];
  products: Product[];
  taxRates: TaxRate[];
  showTaxes: boolean;
  defaultTaxes: TaxLine[];
  currencySymbol: string;
  formatMoney: (amount: number) => string;
  formatPrice: (amount: number) => string;
}) {
  const update = (index: number, patch: Partial<LineItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const duplicate = (index: number) => {
    const next = [...items];
    next.splice(index + 1, 0, { ...items[index], id: newLineItem().id });
    onChange(next);
  };
  const insertHeading = (index: number) => {
    const next = [...items];
    next.splice(index, 0, newHeading());
    onChange(next);
  };

  const pickProduct = (index: number, product: Product) => {
    const taxes = product.taxRateIds
      .map((id) => taxRates.find((t) => t.id === id))
      .filter((t): t is TaxRate => Boolean(t))
      .map(taxLineOf);
    update(index, {
      productId: product.id,
      name: product.name,
      description: product.description,
      unitPrice: product.unitPrice,
      unit: product.unit,
      taxes: showTaxes ? (product.taxRateIds.length ? taxes : items[index].taxes) : [],
    });
  };

  // Container queries: the layout follows the editor's width, not the screen's,
  // because the live preview takes part of the screen.
  return (
    <div className="@container">
      <div className="hidden grid-cols-12 gap-3 px-3 pb-2 text-xs font-medium tracking-wide text-slate-500 uppercase @xl:grid">
        <span className="col-span-6 ps-5">Item</span>
        <span className="col-span-2 text-end">Qty</span>
        <span className="col-span-2 text-end">Price</span>
        <span className="col-span-2 pe-9 text-end">Amount</span>
      </div>

      <ol className="space-y-2">
        {items.map((item, index) => {
          const menu = (
            <DropdownMenu>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Line ${index + 1} actions`}>
                  <MoreHorizontal />
                </Button>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem
                  icon={<ArrowUp />}
                  disabled={index === 0}
                  onSelect={() => move(index, -1)}
                >
                  Move up
                </DropdownItem>
                <DropdownItem
                  icon={<ArrowDown />}
                  disabled={index === items.length - 1}
                  onSelect={() => move(index, 1)}
                >
                  Move down
                </DropdownItem>
                <DropdownItem icon={<Copy />} onSelect={() => duplicate(index)}>
                  Duplicate
                </DropdownItem>
                <DropdownItem icon={<Heading />} onSelect={() => insertHeading(index)}>
                  Insert heading above
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem icon={<Trash2 />} danger onSelect={() => remove(index)}>
                  Remove
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          );

          if (item.kind === 'heading') {
            return (
              <li
                key={item.id}
                className="flex items-start gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3"
              >
                <GripVertical
                  className="mt-2.5 hidden size-4 shrink-0 text-slate-300 @xl:block"
                  aria-hidden
                />
                <div className="flex-1 space-y-2">
                  <Input
                    aria-label="Section heading"
                    value={item.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                    placeholder="Section heading, e.g. “Print production”"
                    className="font-semibold"
                  />
                  <Input
                    aria-label="Section note"
                    value={item.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="Optional note"
                    className="h-8 text-xs"
                  />
                </div>
                {menu}
              </li>
            );
          }

          const line = lines[index];
          return (
            <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <div className="col-span-12 flex items-start gap-2 @xl:col-span-6">
                  <GripVertical
                    className="mt-2.5 hidden size-4 shrink-0 text-slate-300 @xl:block"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <ItemNameInput
                      ariaLabel={`Item ${index + 1} name`}
                      value={item.name}
                      onChange={(name) => update(index, { name, productId: null })}
                      products={products}
                      onPick={(p) => pickProduct(index, p)}
                      formatPrice={formatPrice}
                    />
                  </div>
                </div>
                <div className="col-span-4 @xl:col-span-2">
                  <MiniLabel>Qty</MiniLabel>
                  <NumberInput
                    aria-label={`Item ${index + 1} quantity`}
                    value={item.quantity}
                    onValueChange={(quantity) => update(index, { quantity })}
                  />
                </div>
                <div className="col-span-4 @xl:col-span-2">
                  <MiniLabel>Price</MiniLabel>
                  <NumberInput
                    aria-label={`Item ${index + 1} unit price`}
                    value={item.unitPrice}
                    onValueChange={(unitPrice) => update(index, { unitPrice })}
                  />
                </div>
                <div className="col-span-4 flex items-start justify-end gap-1 @xl:col-span-2">
                  <div className="min-w-0 flex-1 text-end">
                    <MiniLabel>Amount</MiniLabel>
                    <p
                      className="tabular truncate pt-2 text-sm font-semibold text-slate-900"
                      aria-label={`Item ${index + 1} amount`}
                    >
                      {formatMoney(line?.net ?? 0)}
                    </p>
                  </div>
                  <div className="hidden @xl:block">{menu}</div>
                </div>

                <div className="col-span-12 @xl:col-span-6 @xl:ps-6">
                  <Textarea
                    aria-label={`Item ${index + 1} description`}
                    value={item.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="Description (optional)"
                    rows={1}
                    className="min-h-9 resize-y py-1.5 text-sm"
                  />
                </div>
                <div className="col-span-4 @xl:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Unit</span>
                  <Input
                    aria-label={`Item ${index + 1} unit`}
                    value={item.unit}
                    onChange={(e) => update(index, { unit: e.target.value })}
                    placeholder="pcs, hrs…"
                    className="text-end"
                  />
                </div>
                <div className="col-span-4 @xl:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Discount</span>
                  <DiscountInput
                    ariaLabel={`Item ${index + 1} discount`}
                    value={item.discount}
                    type={item.discountType}
                    currencySymbol={currencySymbol}
                    onChange={(discount, discountType) => update(index, { discount, discountType })}
                  />
                </div>
                <div className={cn('col-span-4 @xl:col-span-2', !showTaxes && 'invisible')}>
                  <span className="mb-1 block text-xs font-medium text-slate-500">Tax</span>
                  <TaxSelect
                    value={item.taxes}
                    onChange={(taxes) => update(index, { taxes })}
                    rates={taxRates}
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end @xl:hidden">{menu}</div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, newLineItem(showTaxes ? defaultTaxes : [])])}
        >
          <Plus /> Add item
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange([...items, newHeading()])}>
          <Heading /> Add section heading
        </Button>
      </div>
    </div>
  );
}
