import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Field, Input, NumberInput, Select, Switch, Textarea } from '@/components/ui/form';
import { Button, ButtonLink } from '@/components/ui/button';
import { CurrencySelect } from '@/components/fields';
import type {
  Company,
  DocumentDefaults,
  PageSize,
  VoucherSettings,
  VoucherSignatureLine,
} from '@/db/types';
import { MAX_VOUCHER_LINES, voucherLines, type VoucherDirection } from '@/pdf/voucher/model';
import { t } from '@/i18n';
import { useRoleView } from '@/features/cloud/role-gates';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

/**
 * Voucher settings with `patch` applied. A setting set to undefined is left
 * out, and so are the settings when none is left: vouchers print as before.
 */
function withVouchers(company: Company, patch: Partial<VoucherSettings>): Company {
  const next: Record<string, unknown> = { ...company.vouchers, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  const { vouchers: _old, ...rest } = company;
  return Object.keys(next).length ? { ...rest, vouchers: next as VoucherSettings } : rest;
}

const trimLines = (lines: VoucherSignatureLine[]) =>
  lines.map((l) => ({ en: l.en.trim(), ar: l.ar.trim() }));

export default function DocumentSettings() {
  const { draft, setDraft, update, dirty, saving, saveWith, reset } = useCompanyDraft();
  const { role, readOnly } = useRoleView();
  // Part of the company record: staff and viewers only look at the vouchers' settings.
  const locked = readOnly.readOnly || role === 'staff';
  const d = draft.defaults;
  const setDefaults = (patch: Partial<DocumentDefaults>) =>
    update({ defaults: { ...d, ...patch } });
  const vouchers = draft.vouchers ?? {};
  const setVouchers = (patch: Partial<VoucherSettings>) => setDraft((c) => withVouchers(c, patch));
  const lines = { in: voucherLines(draft, 'in'), out: voucherLines(draft, 'out') };
  const setLines = (direction: VoucherDirection, next: VoucherSignatureLine[]) =>
    setVouchers({ lines: { ...lines, [direction]: next } });
  const changeLine = (
    direction: VoucherDirection,
    index: number,
    patch: Partial<VoucherSignatureLine>,
  ) =>
    setLines(
      direction,
      lines[direction].map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );

  const onSave = () =>
    void saveWith((c) =>
      c.vouchers?.lines
        ? withVouchers(c, {
            lines: { in: trimLines(c.vouchers.lines.in), out: trimLines(c.vouchers.lines.out) },
          })
        : c,
    );

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
          <Field
            label={t('Quote introduction')}
            hint={t('Printed above the items of new quotes, e.g. “Further to your request…”.')}
            className="lg:col-span-2"
          >
            {(id) => (
              <Textarea
                id={id}
                value={d.quoteIntro ?? ''}
                onChange={(e) => setDefaults({ quoteIntro: e.target.value })}
                rows={2}
                dir="auto"
              />
            )}
          </Field>
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

      <SettingsSection
        id="vouchers"
        title={t('Receipt and payment vouchers')}
        description={t(
          'Printed and saved as PDFs from payments and expenses, in Arabic and English. They keep the payment and expense numbers.',
        )}
        actions={
          <ButtonLink to="/settings/company?section=branding" variant="ghost" size="sm">
            {t('Branding')}
          </ButtonLink>
        }
      >
        {locked ? (
          <p className="text-sm text-slate-500">
            {t('Owners, admins and accountants set up vouchers. You can look at them.')}
          </p>
        ) : null}
        <Switch
          checked={Boolean(vouchers.images)}
          disabled={locked}
          onChange={(images) => setVouchers({ images: images || undefined })}
          label={t('Print the stamp, signature and address')}
          description={t(
            'The signature prints in blue when its ink is blue in the company profile. Void vouchers never carry them. Anyone in the company can print a voucher.',
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('PDF paper')}>
            {(id) => (
              <Select
                id={id}
                disabled={locked}
                value={vouchers.paper ?? ''}
                onChange={(e) => setVouchers({ paper: e.target.value === 'A5' ? 'A5' : undefined })}
              >
                <option value="">{t('As the documents')}</option>
                <option value="A5">{t('A5, landscape (half an A4 page)')}</option>
              </Select>
            )}
          </Field>
        </div>
        {(['in', 'out'] as const).map((direction) => (
          <fieldset key={direction} className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-slate-800">
              {direction === 'in'
                ? t('Signature lines on receipt vouchers')
                : t('Signature lines on payment vouchers')}
            </legend>
            <ol className="space-y-2">
              {lines[direction].map((line, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    disabled={locked}
                    value={line.en}
                    onChange={(e) => changeLine(direction, index, { en: e.target.value })}
                    aria-label={t('Signature line {number} in English', { number: index + 1 })}
                    placeholder={t('In English')}
                    maxLength={40}
                    dir="ltr"
                  />
                  <Input
                    disabled={locked}
                    value={line.ar}
                    onChange={(e) => changeLine(direction, index, { ar: e.target.value })}
                    aria-label={t('Signature line {number} in Arabic', { number: index + 1 })}
                    placeholder={t('In Arabic')}
                    maxLength={40}
                    dir="rtl"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setLines(
                        direction,
                        lines[direction].filter((_, i) => i !== index),
                      )
                    }
                    disabled={locked || lines[direction].length <= 1}
                    aria-label={t('Remove signature line {number}', { number: index + 1 })}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ol>
            {lines[direction].length < MAX_VOUCHER_LINES ? (
              <Button
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => setLines(direction, [...lines[direction], { en: '', ar: '' }])}
              >
                <Plus /> {t('Add a line')}
              </Button>
            ) : null}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {t(
              'The stamp and signature print over the last line but one; the last line is for the other party.',
            )}
          </p>
          {vouchers.lines ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={locked}
              onClick={() => setVouchers({ lines: undefined })}
            >
              <RotateCcw /> {t('Use the standard lines')}
            </Button>
          ) : null}
        </div>
      </SettingsSection>

      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={reset} />
    </div>
  );
}
