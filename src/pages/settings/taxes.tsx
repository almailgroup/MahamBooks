import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createTaxRate } from '@/db/defaults';
import { deleteTaxRate, saveTaxRate } from '@/db/records';
import type { TaxKind, TaxRate } from '@/db/types';
import { TAX_KINDS, taxKind } from '@/lib/calc';
import { msg, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { taxesEnabled, withTaxes } from '@/features/company/taxes';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

/** How each kind of rate is reported, in words people can translate. */
const KIND_TEXT: Record<TaxKind, { label: string; hint: string }> = {
  standard: { label: msg('Standard'), hint: msg('The usual rate') },
  reduced: { label: msg('Reduced'), hint: msg('A lower rate, e.g. 5% on energy') },
  zero: { label: msg('Zero-rated'), hint: msg('0%, still reported as a taxable sale') },
  exempt: { label: msg('Exempt'), hint: msg('No tax and reported as exempt') },
  reverse_charge: {
    label: msg('Reverse charge'),
    hint: msg('The buyer accounts for the tax (e.g. services from abroad)'),
  },
  out_of_scope: { label: msg('Outside the scope'), hint: msg('Not reported on tax returns') },
};

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
        aria-label={t('Tax name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== rate.name && void commit({ name })}
      />
      <div className="relative">
        <NumberInput
          aria-label={t('Rate')}
          value={value}
          onValueChange={setValue}
          onBlur={() => value !== rate.rate && void commit({ rate: value })}
          allowNegative={false}
          className="pe-7"
        />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 rtl:start-3 rtl:end-auto">
          %
        </span>
      </div>
      <Select
        aria-label={t('Kind of {name}', { name: rate.name })}
        value={taxKind(rate)}
        onChange={(e) => void commit({ kind: e.target.value as TaxKind })}
        className="col-span-4 row-start-2 sm:col-span-1 sm:row-start-auto"
        title={t(KIND_TEXT[taxKind(rate)].hint)}
      >
        {TAX_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {t(KIND_TEXT[k.value].label)}
          </option>
        ))}
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleDefault}
        title={
          isDefault ? t('Applied to new items by default') : t('Apply to new items by default')
        }
        aria-label={isDefault ? t('Remove as default') : t('Make default')}
        aria-pressed={isDefault}
      >
        <Star className={isDefault ? 'fill-amber-400 text-amber-500' : ''} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('Delete {name}', { name: rate.name })}
        onClick={async () => {
          const ok = await confirm({
            title: t('Delete {name} {rate}%?', { name: rate.name, rate: rate.rate }),
            description: t(
              'Existing documents keep their taxes. It will no longer be offered on new items.',
            ),
            confirmLabel: t('Delete'),
            danger: true,
          });
          if (ok) {
            await deleteTaxRate(rate.id);
            toast.success(t('Tax rate deleted'));
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
  const { draft, update, dirty, saving, save, saveWith, reset } = useCompanyDraft();
  const rates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(draft.id).toArray(),
    [draft.id],
  );
  const enabled = taxesEnabled(draft, rates?.length ?? 0);
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
        title={t('Tax')}
        description={t('Kuwait has no VAT today, so most businesses leave this off.')}
      >
        <Switch
          checked={enabled}
          disabled={rates === undefined || saving}
          onChange={(on) =>
            void saveWith(
              (current) => withTaxes(current, on),
              on ? t('Taxes turned on') : t('Taxes turned off'),
            )
          }
          label={t('This business charges tax')}
          description={
            enabled
              ? t('Invoices and bills can carry tax, and tax returns are available.')
              : t('Invoices and bills have no tax lines, and tax returns are hidden.')
          }
        />
      </SettingsSection>

      {enabled ? (
        <>
          <SettingsSection
            title={t('Tax rates')}
            description={t(
              'Rates you can pick on invoices and bills. Starred rates are applied to new items. The kind decides where each rate goes on your tax return.',
            )}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await saveTaxRate(
                    createTaxRate(draft.id, { name: t('Tax'), rate: 0, kind: 'zero' }),
                  );
                }}
              >
                <Plus /> {t('Add rate')}
              </Button>
            }
          >
            {!rates ? null : rates.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t('No tax rates yet. Add the rates you charge.')}
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

          <SettingsSection title={t('How taxes are applied')}>
            <Switch
              checked={d.lineTaxes}
              onChange={(lineTaxes) => setDefaults({ lineTaxes })}
              label={t('Tax per line item')}
              description={t('Choose taxes for each line, needed when items have different rates.')}
            />
            <Switch
              checked={d.documentTaxes}
              onChange={(documentTaxes) => setDefaults({ documentTaxes })}
              label={t('Tax on the invoice total')}
              description={t('Apply one or more taxes to the whole invoice.')}
            />
            <Switch
              checked={d.pricesIncludeTax}
              onChange={(pricesIncludeTax) => setDefaults({ pricesIncludeTax })}
              label={t('Prices include tax')}
              description={t('Enter prices with tax included; the tax is shown as “includes”.')}
            />
          </SettingsSection>
        </>
      ) : null}
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
