import { Plus, Trash2 } from 'lucide-react';
import type { Charge, InvoiceDocument, TaxLine, TaxRate } from '@/db/types';
import type { CalcResult } from '@/lib/calc';
import { isPurchaseType } from '@/lib/document-types';
import { shortId } from '@/lib/ids';
import { currencyPrecision, round } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Input, NumberInput, Switch } from '@/components/ui/form';
import { DiscountInput } from './line-items';
import { TaxSelect } from './tax-select';

function Row({
  label,
  value,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? 'flex items-center justify-between py-1.5 text-base font-semibold text-slate-900'
          : 'flex items-center justify-between py-1 text-sm text-slate-600'
      }
    >
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

export function TotalsPanel({
  doc,
  onChange,
  result,
  taxRates,
  showDocumentTaxes,
  showLineTaxes,
  defaultTaxes,
  currencySymbol,
  money,
  percent,
  taxExempt,
  allowDeposit = doc.type === 'invoice',
}: {
  doc: InvoiceDocument;
  onChange: (patch: Partial<InvoiceDocument>) => void;
  result: CalcResult;
  taxRates: TaxRate[];
  showDocumentTaxes: boolean;
  showLineTaxes: boolean;
  defaultTaxes: TaxLine[];
  currencySymbol: string;
  money: (amount: number) => string;
  percent: (value: number) => string;
  taxExempt: boolean;
  allowDeposit?: boolean;
}) {
  const isCredit = doc.type === 'credit' || doc.type === 'vendor_credit';
  const charged = result.taxes.filter((t) => t.kind !== 'reverse_charge');
  const reverse = result.taxes.filter((t) => t.kind === 'reverse_charge');
  const setCharge = (index: number, patch: Partial<Charge>) =>
    onChange({ charges: doc.charges.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  return (
    <div className="space-y-4">
      <Row label="Subtotal" value={money(result.subtotal)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-600">Discount</span>
        <div className="flex items-center gap-3">
          <div className="w-32">
            <DiscountInput
              ariaLabel="Document discount"
              value={doc.discount}
              type={doc.discountType}
              currencySymbol={currencySymbol}
              onChange={(discount, discountType) => onChange({ discount, discountType })}
            />
          </div>
          <span className="tabular min-w-16 text-end text-sm text-slate-600">
            {result.discount ? money(-result.discount) : '—'}
          </span>
        </div>
      </div>

      {showDocumentTaxes || doc.taxes.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-600">Tax on total</span>
          <div className="w-56">
            <TaxSelect
              value={doc.taxes}
              onChange={(taxes) => onChange({ taxes })}
              rates={taxRates}
              placeholder="None"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {doc.charges.map((charge, index) => (
          <div
            key={charge.id}
            className="grid grid-cols-[1fr_7rem_auto] items-center gap-2 sm:grid-cols-[1fr_7rem_8rem_auto]"
          >
            <Input
              aria-label="Charge label"
              value={charge.label}
              onChange={(e) => setCharge(index, { label: e.target.value })}
              placeholder="e.g. Shipping"
            />
            <NumberInput
              aria-label="Charge amount"
              value={charge.amount}
              onValueChange={(amount) => setCharge(index, { amount })}
            />
            <div className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto">
              <TaxSelect
                value={charge.taxes}
                onChange={(taxes) => setCharge(index, { taxes })}
                rates={taxRates}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove charge"
              onClick={() => onChange({ charges: doc.charges.filter((_, i) => i !== index) })}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              charges: [
                ...doc.charges,
                {
                  id: shortId(),
                  label: 'Shipping',
                  amount: 0,
                  taxes: showLineTaxes ? defaultTaxes : doc.taxes,
                },
              ],
            })
          }
        >
          <Plus /> Add charge (shipping, handling…)
        </Button>
      </div>

      <div className="border-t border-slate-100 pt-3">
        {!doc.pricesIncludeTax
          ? charged.map((t) => (
              <Row key={t.key} label={`${t.name} ${percent(t.rate)}`} value={money(t.amount)} />
            ))
          : null}
        <Row label="Total" value={money(result.total)} strong />
        {doc.pricesIncludeTax
          ? charged.map((t) => (
              <Row
                key={t.key}
                label={`Includes ${t.name} ${percent(t.rate)}`}
                value={money(t.amount)}
              />
            ))
          : null}
        {reverse.map((t) => (
          <Row
            key={t.key}
            label={`Reverse charge ${t.name} ${percent(t.rate)} · ${
              isPurchaseType(doc.type) ? 'you account for it' : 'the client accounts for it'
            }`}
            value={money(t.amount)}
          />
        ))}
        {doc.type !== 'quote' && result.paid !== 0 ? (
          <>
            <Row label={isCredit ? 'Applied' : 'Paid'} value={money(-result.paid)} />
            <Row
              label={isCredit ? 'Remaining credit' : 'Balance due'}
              value={money(result.balance)}
              strong
            />
          </>
        ) : null}
        {taxExempt ? (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {isPurchaseType(doc.type)
              ? 'This vendor is not registered for tax — taxes are not applied.'
              : 'This client is tax exempt — taxes are not applied.'}
          </p>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-3">
        <Switch
          checked={doc.pricesIncludeTax}
          onChange={(pricesIncludeTax) => onChange({ pricesIncludeTax })}
          label="Prices include tax"
          description="Tax is calculated backwards from the entered prices."
        />
        {allowDeposit ? (
          <>
            <Switch
              checked={doc.deposit > 0}
              onChange={(on) =>
                onChange(
                  on
                    ? {
                        deposit: round(result.total * 0.5, currencyPrecision(doc.currency)),
                        depositDueDate: doc.issueDate,
                      }
                    : { deposit: 0, depositDueDate: null },
                )
              }
              label="Request a deposit"
              description="Shows a deposit amount due before the full balance."
            />
            {doc.deposit > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    Deposit amount
                  </span>
                  <NumberInput
                    value={doc.deposit}
                    onValueChange={(deposit) => onChange({ deposit })}
                    allowNegative={false}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Deposit due</span>
                  <Input
                    type="date"
                    value={doc.depositDueDate ?? ''}
                    onChange={(e) => onChange({ depositDueDate: e.target.value || null })}
                  />
                </label>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
