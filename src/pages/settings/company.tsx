import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import type { Company, CompanyBankAccount, KuwaitProfile } from '@/db/types';
import { useCompanyContext, useFormat } from '@/app/company';
import { accountingSettings } from '@/db/chart-setup';
import { cashLimit, kuwaitProfile } from '@/lib/kuwait-rules';
import { formatMoney } from '@/lib/format';
import { currencyName } from '@/lib/geo';
import { currentLanguage, interfaceLocale, msg, t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { ButtonLink } from '@/components/ui/button';
import { Field, Input, NumberInput } from '@/components/ui/form';
import { Segmented } from '@/components/ui/misc';
import {
  AddressFields,
  ColorField,
  DateFormatSelect,
  LocaleSelect,
  LogoUpload,
} from '@/components/fields';
import {
  ActivitySelect,
  CompanyTypeField,
  EmailField,
  ImageField,
  LegalFormOtherField,
  LegalFormSelect,
  PhoneField,
} from '@/features/company/fields';
import { companyTypeOptions, withTidyProfile } from '@/features/company/company-types';
import { BankAccountFields, ibanProblem } from '@/features/company/bank-fields';
import { bankAccountOf, withBankAccount } from '@/features/company/bank';
import { HolidaysEditor } from '@/features/company/holidays-editor';
import { useTaxesEnabled } from '@/features/company/taxes';
import { printedBankDetails } from '@/pdf/model';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const SECTIONS = [
  { id: 'business', label: msg('Business') },
  { id: 'registration', label: msg('Registration') },
  { id: 'contact', label: msg('Contact details') },
  { id: 'address', label: msg('Address') },
  { id: 'payment', label: msg('Payment details') },
  { id: 'branding', label: msg('Branding') },
  { id: 'regional', label: msg('Regional settings') },
];

/** A field for an identifier: left to right, aligned with the other fields. */
function IdField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} optional hint={hint}>
      {(id) => (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir="ltr"
          className="rtl:text-end"
        />
      )}
    </Field>
  );
}

export default function CompanySettings() {
  const { draft, setDraft, update, dirty, saving, saveWith, reset } = useCompanyDraft();
  const { companies } = useCompanyContext();
  const fmt = useFormat();
  const taxesOn = useTaxesEnabled();
  const [params] = useSearchParams();
  const section = params.get('section');
  const language = currentLanguage();
  const profile = kuwaitProfile(draft);
  const inKuwait = (draft.address.country || 'KW').toUpperCase() === 'KW';
  const account = bankAccountOf(draft);
  const limit = cashLimit(profile.activity);
  const yearEnd = accountingSettings(draft).fiscalYearEnd;

  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section]);

  const setProfile = (patch: Partial<KuwaitProfile>) =>
    setDraft((d) => ({ ...d, kuwait: { ...kuwaitProfile(d), ...patch } }));
  const setAccount = (patch: Partial<CompanyBankAccount>) =>
    setDraft((d) => withBankAccount(d, { ...bankAccountOf(d), ...patch }));
  const setWamd = (wamdPhone: string) =>
    setDraft((d) =>
      withBankAccount({ ...d, kuwait: { ...kuwaitProfile(d), wamdPhone } }, bankAccountOf(d)),
    );
  const setBranding = (patch: Partial<Company['branding']>) =>
    setDraft((d) => ({ ...d, branding: { ...d.branding, ...patch } }));

  const onSave = () => {
    if (!draft.name.trim()) {
      toast.error(t('Enter the name of your business.'));
      return;
    }
    if (ibanProblem(account.iban)) {
      toast.error(t('Check the IBAN before saving.'));
      return;
    }
    // A new type named like a known one becomes that one; an empty one, no type.
    void saveWith((d) => withTidyProfile(d, companyTypeOptions(companies)));
  };

  // "KD 1,234.500" or "KWD 1,234.500", as it will look in the current language.
  const sample = (display: 'local' | 'code') =>
    formatMoney(1234.5, draft.currency, interfaceLocale(draft.locale), display);
  // Day and month only; a leap year so 29 February reads correctly.
  const yearEndText = new Intl.DateTimeFormat(fmt.locale, { day: 'numeric', month: 'long' }).format(
    new Date(2028, yearEnd.month - 1, yearEnd.day),
  );

  return (
    <div className="space-y-6">
      <nav
        aria-label={t('On this page')}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() =>
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="bg-surface shrink-0 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap text-slate-600 shadow-xs ring-1 ring-slate-200 hover:text-slate-900 hover:ring-slate-300"
          >
            {t(s.label)}
          </button>
        ))}
      </nav>
      <SettingsSection
        id="business"
        title={t('Business')}
        description={t('Your names are printed at the top of every document.')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('Company name')}
            hint={t('In English, as on your commercial licence.')}
            error={!draft.name.trim() ? t('Required') : undefined}
          >
            {(id) => (
              <Input
                id={id}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                dir="auto"
                aria-invalid={!draft.name.trim()}
              />
            )}
          </Field>
          <Field label={t('Arabic name')} optional hint={t('Printed on Arabic invoices.')}>
            {(id) => (
              <Input
                id={id}
                value={draft.nameAr ?? ''}
                onChange={(e) => update({ nameAr: e.target.value })}
                dir="rtl"
                lang="ar"
              />
            )}
          </Field>
          <Field
            label={t('Legal name')}
            optional
            className="sm:col-span-2"
            hint={t('Printed on documents when set, e.g. “Al Mail Trading Co. W.L.L.”.')}
          >
            {(id) => (
              <Input
                id={id}
                value={draft.legalName}
                onChange={(e) => update({ legalName: e.target.value })}
                dir="auto"
              />
            )}
          </Field>
          <Field label={t('Legal form')}>
            {(id) => (
              <LegalFormSelect
                id={id}
                value={profile.legalForm}
                onChange={(legalForm) => setProfile({ legalForm })}
              />
            )}
          </Field>
          <CompanyTypeField
            value={draft.companyType}
            onChange={(companyType) => update({ companyType })}
            companies={companies}
          />
          {profile.legalForm === 'other' ? (
            <LegalFormOtherField
              className="sm:col-span-2"
              value={profile.legalFormOther ?? ''}
              onChange={(legalFormOther) => setProfile({ legalFormOther })}
            />
          ) : null}
          <Field
            label={t('Business activity')}
            className="sm:col-span-2"
            hint={
              limit === 0
                ? t('This activity may not take payments in cash.')
                : limit !== null
                  ? t('Cash payments are limited to {amount} each for this activity.', {
                      amount: fmt.money(limit, 'KWD'),
                    })
                  : t('Some activities have limits on cash payments.')
            }
          >
            {(id) => (
              <ActivitySelect
                id={id}
                value={profile.activity}
                onChange={(activity) => setProfile({ activity })}
              />
            )}
          </Field>
          <Field
            label={t('Paid-up capital ({currency})', { currency: draft.currency })}
            optional
            hint={t('The statutory reserve stops at half of it.')}
          >
            {(id) => (
              <NumberInput
                id={id}
                value={profile.capital}
                onValueChange={(capital) => setProfile({ capital })}
                allowNegative={false}
              />
            )}
          </Field>
          <Field
            label={t('Foreign ownership (%)')}
            optional
            hint={t('Share owned by shareholders from outside the GCC.')}
          >
            {(id) => (
              <NumberInput
                id={id}
                value={profile.foreignOwnershipPercent}
                onValueChange={(v) =>
                  setProfile({ foreignOwnershipPercent: Math.min(100, Math.max(0, v)) })
                }
                allowNegative={false}
              />
            )}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        id="registration"
        title={t('Registration')}
        description={t(
          'Your CR number is printed on documents. The others are kept for your records.',
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {inKuwait ? (
            <>
              <IdField
                label={t('CR No.')}
                hint={t('Commercial registration number')}
                value={draft.registrationNumber}
                onChange={(registrationNumber) => update({ registrationNumber })}
              />
              <IdField
                label={t('Commercial licence no.')}
                value={profile.licenceNumber}
                onChange={(licenceNumber) => setProfile({ licenceNumber })}
              />
              <IdField
                label={t('MOF tax card no.')}
                value={profile.mofTaxCardNumber}
                onChange={(mofTaxCardNumber) => setProfile({ mofTaxCardNumber })}
              />
              <IdField
                label={t('PAM file no.')}
                hint={t('Public Authority for Manpower')}
                value={profile.pamFileNumber}
                onChange={(pamFileNumber) => setProfile({ pamFileNumber })}
              />
              <IdField
                label={t('PIFSS employer no.')}
                hint={t('Social security registration')}
                value={profile.pifssEmployerNumber}
                onChange={(pifssEmployerNumber) => setProfile({ pifssEmployerNumber })}
              />
              <IdField
                label={t('KCCI membership no.')}
                hint={t('Kuwait Chamber of Commerce and Industry')}
                value={profile.kcciNumber}
                onChange={(kcciNumber) => setProfile({ kcciNumber })}
              />
              <IdField
                label={t('Digital commerce registration no.')}
                hint={t('For businesses that sell online')}
                value={profile.digitalCommerceNumber}
                onChange={(digitalCommerceNumber) => setProfile({ digitalCommerceNumber })}
              />
            </>
          ) : (
            <>
              <Field
                label={t('Registration label')}
                hint={t('e.g. Company No., CR, Trade licence')}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={draft.registrationLabel}
                    onChange={(e) => update({ registrationLabel: e.target.value })}
                  />
                )}
              </Field>
              <IdField
                label={t('Registration number')}
                value={draft.registrationNumber}
                onChange={(registrationNumber) => update({ registrationNumber })}
              />
            </>
          )}
          {taxesOn || !inKuwait ? (
            <>
              <Field label={t('Tax number label')} hint={t('e.g. VAT No., TRN, Tax ID')}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.taxIdLabel}
                    onChange={(e) => update({ taxIdLabel: e.target.value })}
                  />
                )}
              </Field>
              <IdField
                label={t('Tax number')}
                value={draft.taxId}
                onChange={(taxId) => update({ taxId })}
              />
            </>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection id="contact" title={t('Contact details')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <PhoneField
            label={t('Phone')}
            kuwait={inKuwait}
            value={draft.phone}
            onChange={(phone) => update({ phone })}
          />
          <EmailField
            label={t('Email')}
            value={draft.email}
            onChange={(email) => update({ email })}
          />
          <Field label={t('Website')} optional className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={draft.website}
                onChange={(e) => update({ website: e.target.value })}
                placeholder="https://"
                dir="ltr"
                inputMode="url"
                className="rtl:text-end"
              />
            )}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection id="address" title={t('Address')}>
        <AddressFields value={draft.address} onChange={(address) => update({ address })} />
      </SettingsSection>

      <SettingsSection
        id="payment"
        title={t('Payment details for documents')}
        description={t('Printed on invoices while a balance is due, so customers know how to pay.')}
      >
        <BankAccountFields
          account={account}
          onChange={setAccount}
          wamdPhone={profile.wamdPhone}
          onWamdChange={setWamd}
          accountNamePlaceholder={draft.legalName || draft.name}
        />
        {draft.payment.bankDetails ? (
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200/70">
            <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('Printed on documents')}
            </p>
            <p dir="auto" className="text-sm whitespace-pre-line text-slate-700">
              {printedBankDetails(draft)}
            </p>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="branding"
        title={t('Branding')}
        description={t(
          'Your logo and colour on documents, and the stamp and signature that make them official.',
        )}
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">{t('Logo')}</p>
            <LogoUpload value={draft.branding.logo} onChange={(logo) => setBranding({ logo })} />
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">{t('Brand colour')}</p>
            <ColorField
              value={draft.branding.accentColor}
              onChange={(accentColor) => setBranding({ accentColor })}
            />
          </div>
          <ImageField
            label={t('Company stamp')}
            uploadLabel={t('Upload stamp')}
            description={t('A PNG with a transparent background looks best.')}
            value={draft.branding.stamp}
            onChange={(stamp) => setBranding({ stamp })}
          />
          <ImageField
            label={t('Authorised signature')}
            uploadLabel={t('Upload signature')}
            description={t('Sign on white paper, take a photo, or use a transparent PNG.')}
            value={draft.branding.signature}
            onChange={(signature) => setBranding({ signature })}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="regional"
        title={t('Regional settings')}
        description={t('How amounts and dates are written, your working week and public holidays.')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-slate-700">{t('Currency')}</p>
            <p className="flex h-9 items-center text-sm text-slate-900">
              {currencyName(draft.currency, language)} ({draft.currency})
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <p id="amount-style" className="text-sm font-medium text-slate-700">
              {t('Show amounts as')}
            </p>
            <Segmented
              value={draft.currencyDisplay ?? 'local'}
              onChange={(currencyDisplay) => update({ currencyDisplay })}
              className="self-start"
              options={[
                { value: 'local', label: <span dir="auto">{sample('local')}</span> },
                { value: 'code', label: <span dir="auto">{sample('code')}</span> },
              ]}
            />
          </div>
          <Field label={t('Date format')}>
            {(id) => (
              <DateFormatSelect
                id={id}
                value={draft.dateFormat}
                onChange={(dateFormat) => update({ dateFormat })}
              />
            )}
          </Field>
          <Field
            label={t('Number format')}
            hint={t('Used in English. The Arabic interface keeps Western digits.')}
          >
            {(id) => (
              <LocaleSelect
                id={id}
                value={draft.locale}
                onChange={(locale) => update({ locale })}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200/70">
            <p className="text-sm font-medium text-slate-900">{t('Financial year')}</p>
            <p className="mt-1 text-sm text-slate-600">
              {tr('Ends on {date} each year.', { date: <strong>{yearEndText}</strong> })}
            </p>
            <ButtonLink
              to="/settings/accounting"
              variant="ghost"
              size="xs"
              className="text-primary-700 -ms-2 mt-1"
            >
              {t('Change in accounting settings')}
            </ButtonLink>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200/70">
            <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <CalendarClock className="size-4 text-slate-400" aria-hidden />
              {t('Weekend')}
            </p>
            <p className="mt-1 text-sm text-slate-600">{t('Friday and Saturday, as in Kuwait.')}</p>
          </div>
        </div>
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t('Public holidays')}</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {t(
                'Used for due dates, leave and payroll. Change them when the official dates are announced.',
              )}
            </p>
          </div>
          <HolidaysEditor holidays={draft.holidays} onChange={(holidays) => update({ holidays })} />
        </div>
      </SettingsSection>

      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={reset} />
    </div>
  );
}
