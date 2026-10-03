import type { CounterReset, NumberedEntity, NumberingRule } from '@/db/types';
import { NUMBER_PLACEHOLDERS, previewNumber } from '@/lib/numbering';
import { defaultNumbering } from '@/db/defaults';
import { today } from '@/lib/dates';
import { msg, t } from '@/i18n';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const ENTITIES: { key: NumberedEntity; label: string }[] = [
  { key: 'invoice', label: msg('Invoices') },
  { key: 'quote', label: msg('Quotes') },
  { key: 'credit', label: msg('Credit notes') },
  { key: 'payment', label: msg('Payments received') },
  { key: 'client', label: msg('Clients and vendors') },
  { key: 'bill', label: msg('Bills') },
  { key: 'vendor_credit', label: msg('Vendor credits') },
  { key: 'payment_made', label: msg('Payments made') },
  { key: 'expense', label: msg('Expenses') },
  { key: 'journal', label: msg('Manual journals') },
];

/** What each placeholder stands for (the tokens themselves are never translated). */
const PLACEHOLDER_TEXT: Record<string, string> = {
  '{counter}': msg('Sequential counter, zero padded (required)'),
  '{year}': msg('Year of the document date, e.g. 2026'),
  '{yy}': msg('Two-digit year, e.g. 26'),
  '{month}': msg('Two-digit month, e.g. 09'),
  '{day}': msg('Two-digit day, e.g. 05'),
  '{client}': msg("The client's number"),
};

export default function NumberingSettings() {
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  // Companies created before journals and purchases existed have no rule for them yet.
  const ruleFor = (key: NumberedEntity) => draft.numbering[key] ?? defaultNumbering()[key];
  const setRule = (key: NumberedEntity, patch: Partial<NumberingRule>) =>
    update({ numbering: { ...draft.numbering, [key]: { ...ruleFor(key), ...patch } } });

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Number formats')}
        description={t('How new numbers are built. Numbers already used are skipped.')}
      >
        <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          <p className="mb-2 font-medium text-slate-700">{t('Placeholders')}</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {NUMBER_PLACEHOLDERS.map((p) => (
              <li key={p.token}>
                <code
                  dir="ltr"
                  className="text-primary-700 rounded bg-white px-1.5 py-0.5 text-xs ring-1 ring-slate-200"
                >
                  {p.token}
                </code>{' '}
                {PLACEHOLDER_TEXT[p.token] ? t(PLACEHOLDER_TEXT[p.token]) : p.description}
              </li>
            ))}
          </ul>
        </div>
        <div className="divide-y divide-slate-100">
          {ENTITIES.map(({ key, label }) => {
            const rule = ruleFor(key);
            const missingCounter = !/\{counter\}/i.test(rule.pattern);
            return (
              <div
                key={key}
                className="grid grid-cols-2 gap-4 py-4 first:pt-0 last:pb-0 sm:grid-cols-[140px_minmax(0,1fr)_100px_110px_150px]"
              >
                <div className="col-span-2 sm:col-span-1 sm:pt-7">
                  <p className="font-medium text-slate-800">{t(label)}</p>
                  <p className="tabular mt-0.5 text-xs text-slate-500">
                    {t('Next:')} <span dir="ltr">{previewNumber(rule, today())}</span>
                  </p>
                </div>
                <Field
                  label={t('Pattern')}
                  className="col-span-2 sm:col-span-1"
                  error={missingCounter ? t('{counter} will be added at the end') : undefined}
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={rule.pattern}
                      onChange={(e) => setRule(key, { pattern: e.target.value })}
                      dir="ltr"
                      className="font-mono rtl:text-end"
                    />
                  )}
                </Field>
                <Field label={t('Digits')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={rule.padding}
                      onValueChange={(v) =>
                        setRule(key, { padding: Math.min(10, Math.max(0, Math.round(v))) })
                      }
                      allowNegative={false}
                    />
                  )}
                </Field>
                <Field label={t('Next counter')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={rule.next}
                      onValueChange={(v) => setRule(key, { next: Math.max(1, Math.round(v)) })}
                      allowNegative={false}
                    />
                  )}
                </Field>
                <Field label={t('Restart counter')} className="col-span-2 sm:col-span-1">
                  {(id) => (
                    <Select
                      id={id}
                      value={rule.reset}
                      onChange={(e) =>
                        setRule(key, { reset: e.target.value as CounterReset, period: '' })
                      }
                    >
                      <option value="never">{t('Never')}</option>
                      <option value="yearly">{t('Every year')}</option>
                      <option value="monthly">{t('Every month')}</option>
                    </Select>
                  )}
                </Field>
              </div>
            );
          })}
        </div>
      </SettingsSection>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
