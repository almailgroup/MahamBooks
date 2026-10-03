import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { ButtonLink } from '@/components/ui/button';
import { CurrencySelect } from '@/components/fields';
import type { DocumentDefaults, PageSize } from '@/db/types';
import { t } from '@/i18n';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

export default function DocumentSettings() {
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const d = draft.defaults;
  const setDefaults = (patch: Partial<DocumentDefaults>) =>
    update({ defaults: { ...d, ...patch } });

  const textArea = (key: keyof DocumentDefaults, label: string) => (
    <Field label={label}>
      {(id) => (
        <Textarea
          id={id}
          value={String(d[key] ?? '')}
          onChange={(e) => setDefaults({ [key]: e.target.value })}
          rows={3}
          dir="auto"
        />
      )}
    </Field>
  );

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Currency and paper')}
        description={t('Date and number formats are in the company profile.')}
        actions={
          <ButtonLink to="/settings/company?section=regional" variant="ghost" size="sm">
            {t('Regional settings')}
          </ButtonLink>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('Default currency')}
            hint={t('Clients can have their own. Change it only before you record transactions.')}
          >
            {(id) => (
              <CurrencySelect
                id={id}
                value={draft.currency}
                onChange={(currency) => update({ currency })}
              />
            )}
          </Field>
          <Field label={t('Paper size')}>
            {(id) => (
              <Select
                id={id}
                value={d.pageSize}
                onChange={(e) => setDefaults({ pageSize: e.target.value as PageSize })}
              >
                <option value="A4">{t('A4 (210 × 297 mm)')}</option>
                <option value="LETTER">{t('US Letter (8.5 × 11 in)')}</option>
              </Select>
            )}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={t('Due dates')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('Invoice payment terms (days)')}
            hint={t('Due date is the issue date plus this many days. 0 means due on receipt.')}
          >
            {(id) => (
              <NumberInput
                id={id}
                value={d.paymentTermsDays}
                onValueChange={(v) => setDefaults({ paymentTermsDays: Math.max(0, Math.round(v)) })}
                allowNegative={false}
              />
            )}
          </Field>
          <Field label={t('Quotes valid for (days)')}>
            {(id) => (
              <NumberInput
                id={id}
                value={d.quoteValidDays}
                onValueChange={(v) => setDefaults({ quoteValidDays: Math.max(0, Math.round(v)) })}
                allowNegative={false}
              />
            )}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('Default text')}
        description={t('Filled in on new documents; you can still change it on each one.')}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {textArea('invoiceNotes', t('Invoice notes'))}
          {textArea('invoiceTerms', t('Invoice terms'))}
          {textArea('quoteNotes', t('Quote notes'))}
          {textArea('quoteTerms', t('Quote terms'))}
          {textArea('creditNotes', t('Credit note notes'))}
          {textArea('creditTerms', t('Credit note terms'))}
        </div>
        <Field
          label={t('Footer')}
          hint={t('Small print at the bottom of every page, e.g. your registered office.')}
        >
          {(id) => (
            <Input
              id={id}
              value={d.footer}
              onChange={(e) => setDefaults({ footer: e.target.value })}
              dir="auto"
            />
          )}
        </Field>
      </SettingsSection>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
