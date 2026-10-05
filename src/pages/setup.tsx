import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  MapPin,
  Sparkles,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { setMeta } from '@/db/db';
import { setupCompany } from '@/db/records';
import { BackupError, importBackup, LAST_BACKUP_KEY, parseBackup } from '@/db/backup';
import { countryName, currencyName, emptyAddress } from '@/lib/geo';
import { normalizeImage } from '@/lib/image';
import { isValidEmail } from '@/lib/email';
import { normalizeKuwaitPhone } from '@/lib/kuwait';
import { normalizeDigits } from '@/lib/money';
import { appName } from '@/lib/brand';
import { regionDefaults } from '@/lib/regions';
import { requestPersistentStorage } from '@/lib/storage';
import { cn } from '@/lib/cn';
import type { Address, BusinessActivity, LegalForm } from '@/db/types';
import { currentLanguage, msg, t } from '@/i18n';
import { LanguageSwitch } from '@/i18n/language-switch';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { Field, Input, NumberInput, Switch } from '@/components/ui/form';
import {
  AddressFields,
  ColorField,
  CountrySelect,
  CurrencySelect,
  LogoUpload,
} from '@/components/fields';
import { ActivitySelect, EmailField, LegalFormSelect, PhoneField } from '@/features/company/fields';
import { CloudWelcomeCard } from '@/features/cloud/welcome-card';
import { useCloud } from '@/cloud/store';
import { startUpload } from '@/cloud/sync';
import { cloudErrorMessage } from '@/cloud/api';

interface SetupDraft {
  name: string;
  nameAr: string;
  legalForm: LegalForm;
  activity: BusinessActivity;
  registrationNumber: string;
  licenceNumber: string;
  email: string;
  phone: string;
  address: Address;
  currency: string;
  chargesTax: boolean;
  taxName: string;
  taxRate: number;
  logo: string | null;
  accent: string;
  showMore: boolean;
  showRegion: boolean;
}

function initialDraft(): SetupDraft {
  const kw = regionDefaults('KW');
  return {
    name: '',
    nameAr: '',
    legalForm: 'wll',
    activity: 'general',
    registrationNumber: '',
    licenceNumber: '',
    email: '',
    phone: '',
    address: emptyAddress('KW'),
    currency: kw.currency,
    chargesTax: false,
    taxName: 'VAT',
    taxRate: 0,
    logo: null,
    accent: '#4f46e5',
    showMore: false,
    showRegion: false,
  };
}

// Switching the interface language remounts the page; what was typed survives.
let remembered: SetupDraft | null = null;
const remember = (draft: SetupDraft | null) => {
  remembered = draft;
};

const FEATURES = [
  msg('Kuwaiti dinar with fils'),
  msg('No VAT'),
  msg('Kuwait chart of accounts'),
  msg('Arabic and English'),
];

export default function SetupPage({ firstRun = false }: { firstRun?: boolean }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<SetupDraft>(() => remembered ?? initialDraft());
  const [busy, setBusy] = useState<'create' | 'demo' | 'restore' | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const { configured, user, api } = useCloud();
  // Signed in: a new company goes to the cloud unless the person says no.
  const [toCloud, setToCloud] = useState(true);
  const backupInput = useRef<HTMLInputElement>(null);
  const moreId = useId();
  const regionId = useId();
  const language = currentLanguage();

  useEffect(() => remember(draft), [draft]);

  const set = (patch: Partial<SetupDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const country = (draft.address.country || 'KW').toUpperCase();
  const inKuwait = country === 'KW';
  const nameMissing = submitted && !draft.name.trim();
  const emailInvalid = draft.email.trim() !== '' && !isValidEmail(draft.email);

  const applyCountry = (code: string) => {
    const r = regionDefaults(code);
    setDraft((d) => ({
      ...d,
      address: { ...d.address, country: code },
      currency: r.currency,
      chargesTax: Boolean(r.tax),
      taxName: r.tax?.name ?? 'VAT',
      taxRate: r.tax?.rate ?? 0,
    }));
  };

  const create = async () => {
    setSubmitted(true);
    if (!draft.name.trim()) {
      toast.error(t('Enter the name of your business.'));
      return;
    }
    if (emailInvalid) {
      set({ showMore: true });
      toast.error(t('Check the email address.'));
      return;
    }
    setBusy('create');
    try {
      const region = regionDefaults(country);
      const phone = inKuwait
        ? (normalizeKuwaitPhone(normalizeDigits(draft.phone)) ?? draft.phone.trim())
        : draft.phone.trim();
      const company = await setupCompany(
        {
          name: draft.name.trim(),
          nameAr: draft.nameAr.trim(),
          email: draft.email.trim(),
          phone,
          address: draft.address,
          currency: draft.currency,
          locale: region.locale,
          dateFormat: region.dateFormat,
          language: region.language,
          taxIdLabel: region.taxIdLabel,
          registrationNumber: draft.registrationNumber.trim(),
          kuwait: {
            legalForm: draft.legalForm,
            activity: draft.activity,
            licenceNumber: draft.licenceNumber.trim(),
          },
          branding: { logo: draft.logo, accentColor: draft.accent },
          defaults: { pageSize: region.pageSize },
          taxesEnabled: draft.chargesTax,
        },
        draft.chargesTax ? [{ name: draft.taxName, rate: draft.taxRate }] : [],
      );
      remember(null);
      void requestPersistentStorage();
      toast.success(t('{name} is ready.', { name: localName(company) }));
      navigate('/');
      if (user && api && toCloud) {
        void startUpload(company.id, { api, userId: user.id }).catch((error) =>
          toast.error(cloudErrorMessage(error)),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not create the company.'));
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    setBusy('demo');
    try {
      // The demo (with its sample logo and stamp) is only downloaded when asked for.
      const { seedDemoCompany } = await import('@/db/demo');
      await seedDemoCompany();
      remember(null);
      void requestPersistentStorage();
      toast.success(t('Demo company created. You can delete it later in Settings.'));
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not create demo data.'));
    } finally {
      setBusy(null);
    }
  };

  // Moving to a new device: load a backup instead of setting up from scratch.
  const restore = async (file: File | undefined) => {
    if (!file) return;
    setBusy('restore');
    try {
      const backup = parseBackup(await file.text());
      if (backup.data.companies.length === 0)
        throw new BackupError(t('This backup does not contain a company.'));
      await importBackup(backup, 'merge', (logo) => normalizeImage(logo));
      await setMeta(LAST_BACKUP_KEY, backup.exportedAt);
      remember(null);
      void requestPersistentStorage();
      toast.success(t('Backup restored. Welcome back.'));
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not restore the backup.'));
    } finally {
      setBusy(null);
    }
  };

  const form = (
    <Card className="overflow-hidden">
      <section className="space-y-5 p-5 sm:p-6">
        <div className="flex items-center gap-2.5">
          <span className="bg-primary-50 text-primary-600 flex size-8 items-center justify-center rounded-lg">
            <Building2 className="size-4.5" aria-hidden />
          </span>
          <h2 className="font-semibold text-slate-900">{t('Your business')}</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('Company name')}
            hint={t('As on your commercial licence, in English.')}
            error={nameMissing ? t('Required') : undefined}
          >
            {(id) => (
              <Input
                id={id}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder={t('e.g. Al Mail Trading Co.')}
                dir="auto"
                autoFocus
                autoComplete="organization"
                aria-invalid={nameMissing}
                aria-required
              />
            )}
          </Field>
          <Field label={t('Arabic name')} optional hint={t('Printed on Arabic invoices.')}>
            {(id) => (
              <Input
                id={id}
                value={draft.nameAr}
                onChange={(e) => set({ nameAr: e.target.value })}
                placeholder="شركة الميل للتجارة"
                dir="rtl"
                lang="ar"
              />
            )}
          </Field>
          <Field label={t('Legal form')}>
            {(id) => (
              <LegalFormSelect
                id={id}
                value={draft.legalForm}
                onChange={(legalForm) => set({ legalForm })}
              />
            )}
          </Field>
          <Field
            label={t('Business activity')}
            hint={t('Some activities have limits on cash payments.')}
          >
            {(id) => (
              <ActivitySelect
                id={id}
                value={draft.activity}
                onChange={(activity) => set({ activity })}
              />
            )}
          </Field>
        </div>

        <div className="rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
              <MapPin className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span>
                <span className="font-medium text-slate-900">{countryName(country, language)}</span>
                {' · '}
                {currencyName(draft.currency, language)} ({draft.currency})
                {draft.chargesTax ? null : <> · {t('No tax')}</>}
              </span>
            </p>
            <button
              type="button"
              className="text-primary-700 inline-flex items-center gap-1 text-sm font-medium hover:underline"
              aria-expanded={draft.showRegion}
              aria-controls={regionId}
              onClick={() => set({ showRegion: !draft.showRegion })}
            >
              <Globe2 className="size-4" aria-hidden />
              {t('Other country or currency')}
            </button>
          </div>
          {draft.showRegion ? (
            <div id={regionId} className="mt-4 space-y-4 border-t border-slate-200 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('Country')} hint={t('Sets currency, date format and tax.')}>
                  {(id) => <CountrySelect id={id} value={country} onChange={applyCountry} />}
                </Field>
                <Field label={t('Currency')}>
                  {(id) => (
                    <CurrencySelect
                      id={id}
                      value={draft.currency}
                      onChange={(currency) => set({ currency })}
                    />
                  )}
                </Field>
              </div>
              <Switch
                checked={draft.chargesTax}
                onChange={(chargesTax) => set({ chargesTax })}
                label={t('This business charges tax')}
                description={t('Kuwait has no VAT. Turn this on only if you charge a sales tax.')}
              />
              {draft.chargesTax ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('Tax name')}>
                    {(id) => (
                      <Input
                        id={id}
                        value={draft.taxName}
                        onChange={(e) => set({ taxName: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={t('Rate (%)')}>
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={draft.taxRate}
                        onValueChange={(taxRate) => set({ taxRate })}
                        allowNegative={false}
                      />
                    )}
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-t border-slate-100">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start hover:bg-slate-50 sm:px-6"
          aria-expanded={draft.showMore}
          aria-controls={moreId}
          onClick={() => set({ showMore: !draft.showMore })}
        >
          <span>
            <span className="block font-semibold text-slate-900">{t('More details')}</span>
            <span className="block text-sm text-slate-500">
              {t('CR number, contact details, address and logo. You can add them later.')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'size-5 shrink-0 text-slate-400 transition-transform',
              draft.showMore && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
        {draft.showMore ? (
          <div id={moreId} className="space-y-6 px-5 pb-6 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('CR No.')} optional hint={t('Commercial registration number')}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.registrationNumber}
                    onChange={(e) => set({ registrationNumber: e.target.value })}
                    dir="ltr"
                    inputMode="numeric"
                    className="rtl:text-end"
                  />
                )}
              </Field>
              <Field label={t('Commercial licence no.')} optional>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.licenceNumber}
                    onChange={(e) => set({ licenceNumber: e.target.value })}
                    dir="ltr"
                    className="rtl:text-end"
                  />
                )}
              </Field>
              <PhoneField
                label={t('Phone')}
                optional
                kuwait={inKuwait}
                value={draft.phone}
                onChange={(phone) => set({ phone })}
              />
              <EmailField
                label={t('Email')}
                optional
                value={draft.email}
                onChange={(email) => set({ email })}
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">{t('Address')}</h3>
              <AddressFields
                value={draft.address}
                onChange={(a) =>
                  a.country !== draft.address.country
                    ? applyCountry(a.country)
                    : set({ address: a })
                }
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">{t('Logo')}</h3>
              <LogoUpload value={draft.logo} onChange={(logo) => set({ logo })} />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">{t('Brand colour')}</h3>
              <ColorField value={draft.accent} onChange={(accent) => set({ accent })} />
            </div>
          </div>
        ) : null}
      </section>

      {user ? (
        <section className="border-t border-slate-100 px-5 py-4 sm:px-6">
          <Switch
            checked={toCloud}
            onChange={setToCloud}
            label={t('Keep this company in the cloud')}
            description={t('Safe online, on all your devices and ready for your team.')}
          />
        </section>
      ) : null}

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {firstRun ? (
          <p className="text-xs text-slate-500">{t('Only the company name is needed to start.')}</p>
        ) : (
          <Button variant="ghost" onClick={() => navigate(-1)}>
            {t('Cancel')}
          </Button>
        )}
        <Button
          size="lg"
          onClick={create}
          loading={busy === 'create'}
          disabled={busy !== null}
          className="w-full sm:w-auto"
        >
          {t('Create company')}
        </Button>
      </div>
    </Card>
  );

  if (!firstRun) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {t('Add a company')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('Each company has its own clients, documents, numbering and branding.')}
          </p>
        </div>
        {form}
      </div>
    );
  }

  return (
    <div className="from-primary-50 via-surface to-page min-h-dvh bg-gradient-to-b">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="bg-primary-solid text-on-primary flex size-8 items-center justify-center rounded-lg">
            <FileText className="size-4.5" aria-hidden />
          </span>
          {appName()}
        </span>
        <LanguageSwitch className="bg-surface shadow-xs ring-1 ring-slate-200" />
      </header>

      <main className="mx-auto max-w-2xl px-4 pt-6 pb-12 sm:pt-10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-slate-900 sm:text-4xl">
            {t('Welcome to {app}', { app: appName() })}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-pretty text-slate-600">
            {configured
              ? t(
                  'Invoices, payments and accounts for your business in Kuwait. Set up takes a minute, and nothing leaves this browser unless you choose the cloud.',
                )
              : t(
                  'Invoices, payments and accounts for your business in Kuwait. Set up takes a minute, and your data stays private in this browser.',
                )}
          </p>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {FEATURES.map((f) => (
              <li
                key={f}
                className="bg-surface inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-slate-700 shadow-xs ring-1 ring-slate-200"
              >
                <Check className="size-3.5 text-emerald-600" aria-hidden />
                {t(f)}
              </li>
            ))}
          </ul>
        </div>

        <CloudWelcomeCard />

        <div className="mt-8 mb-4">
          <h2 className="font-semibold text-slate-900">
            {user ? t('Set up a new company') : t('Or use on this device only')}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {user
              ? t('It is kept in the cloud and on this device.')
              : t('No account needed. Everything stays in this browser.')}
          </p>
        </div>

        {form}

        <div className="mt-8">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-slate-200" />
            {t('Not ready to set up yet?')}
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={demo}
              loading={busy === 'demo'}
              disabled={busy !== null}
              className="h-auto justify-start py-3 text-start whitespace-normal"
            >
              <Sparkles className="text-primary-600" />
              <span>
                <span className="block">{t('Explore with demo data')}</span>
                <span className="block text-xs font-normal text-slate-500">
                  {t('A Kuwaiti trading company with a year of invoices, cheques and payroll.')}
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              onClick={() => backupInput.current?.click()}
              loading={busy === 'restore'}
              disabled={busy !== null}
              className="h-auto justify-start py-3 text-start whitespace-normal"
            >
              <Upload className="text-primary-600" />
              <span>
                <span className="block">{t('Restore a backup')}</span>
                <span className="block text-xs font-normal text-slate-500">
                  {t('Moving from another device? Load your backup file.')}
                </span>
              </span>
            </Button>
            <input
              ref={backupInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-slate-500">
          {user
            ? t(
                'Companies you keep on this device only are not sent anywhere. Back them up from Settings.',
              )
            : t('Your data never leaves this device. Back it up regularly from Settings.')}
        </p>
      </main>
    </div>
  );
}
