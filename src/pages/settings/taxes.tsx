import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createTaxRate } from '@/db/defaults';
import { deleteTaxRate, saveTaxRate } from '@/db/records';
import type { TaxKind, TaxRate } from '@/db/types';
import { TAX_KINDS, taxKind } from '@/lib/calc';
import { Button } from '@/components/ui/button';
import { Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

function TaxRow({
  rate,
  isDefault,
  onToggleDefault,
}: {
  rate: TaxRate;
  isDefault: boolean;
  onToggleDefault: () => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(rate.name);
  const [value, setValue] = useState(rate.rate);

  const commit = async (patch: Partial<TaxRate>) => {
    await saveTaxRate({ ...rate, ...patch });
  };

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_100px_auto_auto] items-center gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_100px_190px_auto_auto]">
      <Input
        aria-label="Tax name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== rate.name && void commit({ name })}
      />
      <div className="relative">
        <NumberInput
          aria-label="Rate"
          value={value}
          onValueChange={setValue}
          onBlur={() => value !== rate.rate && void commit({ rate: value })}
          allowNegative={false}
          className="pe-7"
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          %
        </span>
      </div>
      <Select
        aria-label={`Kind of ${rate.name}`}
        value={taxKind(rate)}
        onChange={(e) => void commit({ kind: e.target.value as TaxKind })}
        className="col-span-4 row-start-2 sm:col-span-1 sm:row-start-auto"
        title={TAX_KINDS.find((k) => k.value === taxKind(rate))?.hint}
      >
        {TAX_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleDefault}
        title={isDefault ? 'Applied to new items by default' : 'Apply to new items by default'}
        aria-label={isDefault ? 'Remove as default' : 'Make default'}
        aria-pressed={isDefault}
      >
        <Star className={isDefault ? 'fill-amber-400 text-amber-500' : ''} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${rate.name}`}
        onClick={async () => {
          const ok = await confirm({
            title: `Delete ${rate.name} ${rate.rate}%?`,
            description:
              'Existing documents keep their taxes. It will no longer be offered on new items.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) {
            await deleteTaxRate(rate.id);
            toast.success('Tax rate deleted');
          }
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

const KIND_ORDER = TAX_KINDS.map((k) => k.value);

export default function TaxSettings() {
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const rates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(draft.id).toArray(),
    [draft.id],
  );
  const d = draft.defaults;
  const setDefaults = (patch: Partial<typeof d>) => update({ defaults: { ...d, ...patch } });

  const toggleDefault = (id: string) =>
    setDefaults({
      defaultTaxRateIds: d.defaultTaxRateIds.includes(id)
        ? d.defaultTaxRateIds.filter((x) => x !== id)
        : [...d.defaultTaxRateIds, id],
    });

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Tax rates"
        description="Rates you can pick on invoices and bills. Starred rates are applied to new items automatically. The kind decides where each rate goes on your VAT return."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await saveTaxRate(createTaxRate(draft.id, { name: 'Tax', rate: 0, kind: 'zero' }));
            }}
          >
            <Plus /> Add rate
          </Button>
        }
      >
        {!rates ? null : rates.length === 0 ? (
          <p className="text-sm text-slate-500">
            No tax rates. Add one if you charge VAT, GST or sales tax.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rates
              .slice()
              .sort(
                (a, b) =>
                  a.createdAt.localeCompare(b.createdAt) ||
                  KIND_ORDER.indexOf(taxKind(a)) - KIND_ORDER.indexOf(taxKind(b)) ||
                  b.rate - a.rate,
              )
              .map((rate) => (
                <TaxRow
                  key={rate.id}
                  rate={rate}
                  isDefault={d.defaultTaxRateIds.includes(rate.id)}
                  onToggleDefault={() => toggleDefault(rate.id)}
                />
              ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="How taxes are applied">
        <Switch
          checked={d.lineTaxes}
          onChange={(lineTaxes) => setDefaults({ lineTaxes })}
          label="Tax per line item"
          description="Choose taxes for each line — needed when items have different rates (e.g. postage at 0%)."
        />
        <Switch
          checked={d.documentTaxes}
          onChange={(documentTaxes) => setDefaults({ documentTaxes })}
          label="Tax on the invoice total"
          description="Apply one or more taxes to the whole invoice."
        />
        <Switch
          checked={d.pricesIncludeTax}
          onChange={(pricesIncludeTax) => setDefaults({ pricesIncludeTax })}
          label="Prices include tax"
          description="Enter prices with tax included; the tax is shown as “includes”."
        />
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
