import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Building2, FileText, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { db, setMeta } from '@/db/db';
import { setupCompany } from '@/db/records';
import { seedDemoCompany } from '@/db/demo';
import { BackupError, importBackup, LAST_BACKUP_KEY, parseBackup } from '@/db/backup';
import { emptyAddress } from '@/lib/geo';
import { normalizeImage } from '@/lib/image';
import { APP_NAME } from '@/lib/brand';
import { regionDefaults } from '@/lib/regions';
import { requestPersistentStorage } from '@/lib/storage';
import type { Address, DateFormat } from '@/db/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { Field, Input, NumberInput, Switch } from '@/components/ui/form';
import {
  AddressFields,
  ColorField,
  CountrySelect,
  CurrencySelect,
  DateFormatSelect,
  LogoUpload,
} from '@/components/fields';

export default function SetupPage({ firstRun = false }: { firstRun?: boolean }) {
  const navigate = useNavigate();
  const initial = regionDefaults('KW');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState<Address>(emptyAddress('KW'));
  const [currency, setCurrency] = useState(initial.currency);
  const [locale, setLocale] = useState(initial.locale);
  const [dateFormat, setDateFormat] = useState<DateFormat>(initial.dateFormat);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [language, setLanguage] = useState(initial.language);
  const [taxIdLabel, setTaxIdLabel] = useState(initial.taxIdLabel);
  const [taxId, setTaxId] = useState('');
  const [chargesTax, setChargesTax] = useState(false);
  const [taxName, setTaxName] = useState('Tax');
  const [taxRate, setTaxRate] = useState(0);
  const [logo, setLogo] = useState<string | null>(null);
  const [accent, setAccent] = useState('#4f46e5');
  const [busy, setBusy] = useState<'create' | 'demo' | 'restore' | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  const applyCountry = (country: string) => {
    setAddress((a) => ({ ...a, country }));
    const r = regionDefaults(country);
    setCurrency(r.currency);
    setLocale(r.locale);
    setDateFormat(r.dateFormat);
    setPageSize(r.pageSize);
    setLanguage(r.language);
    setTaxIdLabel(r.taxIdLabel);
    setChargesTax(Boolean(r.tax));
    setTaxName(r.tax?.name ?? 'Tax');
    setTaxRate(r.tax?.rate ?? 0);
  };

  const create = async () => {
    setSubmitted(true);
    if (!name.trim()) {
      toast.error('Please enter your company name.');
      return;
    }
    setBusy('create');
    try {
      // One transaction, so the app appears only once the company is complete.
      const company = await db.transaction(
        'rw',
        [db.companies, db.taxRates, db.accounts, db.meta, db.activities],
        async () => {
          const created = await setupCompany(
            {
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim(),
              address,
              currency,
              locale,
              dateFormat,
              language,
              taxIdLabel,
              taxId: taxId.trim(),
            },
            chargesTax ? [{ name: taxName, rate: taxRate }] : [],
          );
          await db.companies.update(created.id, {
            branding: { ...created.branding, logo, accentColor: accent },
            defaults: { ...created.defaults, pageSize },
          });
          return created;
        },
      );
      void requestPersistentStorage();
      toast.success(`${company.name} is ready. Create your first invoice!`);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the company.');
    } finally {
      setBusy(null);
    }
  };

  const demo = async () => {
    setBusy('demo');
    try {
      await seedDemoCompany();
      void requestPersistentStorage();
      toast.success('Demo company created. Explore freely — you can delete it later in Settings.');
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create demo data.');
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
        throw new BackupError('This backup does not contain a company.');
      await importBackup(backup, 'merge', (logo) => normalizeImage(logo));
      await setMeta(LAST_BACKUP_KEY, backup.exportedAt);
      void requestPersistentStorage();
      toast.success('Backup restored. Welcome back!');
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not restore the backup.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={
        firstRun
          ? 'from-primary-50 min-h-dvh bg-gradient-to-b via-slate-50 to-slate-50 px-4 py-10 sm:py-16'
          : ''
      }
    >
      <div className="mx-auto max-w-3xl">
        {firstRun ? (
          <div className="mb-8 text-center">
            <div className="bg-primary-600 shadow-primary-600/25 mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl text-white shadow-lg">
              <FileText className="size-6" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Welcome to {APP_NAME}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-slate-600">
              Create professional invoices, quotes and credit notes with modern templates.
              Everything is stored privately in this browser — no account needed.
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Add a company</h1>
            <p className="mt-1 text-sm text-slate-500">
              Each company has its own clients, documents, numbering and branding.
            </p>
          </div>
        )}

        <Card className="divide-y divide-slate-100">
          <section className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Building2 className="text-primary-600 size-5" />
              <h2 className="font-semibold text-slate-900">Your business</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Company name"
                className="sm:col-span-2"
                error={submitted && !name.trim() ? 'Required' : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. AL Mail Group"
                    autoFocus
                    autoComplete="organization"
                    aria-invalid={submitted && !name.trim()}
                  />
                )}
              </Field>
              <Field label="Country" hint="Sets currency, date format and tax defaults.">
                {(id) => <CountrySelect id={id} value={address.country} onChange={applyCountry} />}
              </Field>
              <Field label="Currency">
                {(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}
              </Field>
              <Field label="Email" optional>
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                )}
              </Field>
              <Field label="Phone" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                )}
              </Field>
              <Field label="Date format">
                {(id) => <DateFormatSelect id={id} value={dateFormat} onChange={setDateFormat} />}
              </Field>
              <Field label={taxIdLabel || 'Tax ID'} optional>
                {(id) => <Input id={id} value={taxId} onChange={(e) => setTaxId(e.target.value)} />}
              </Field>
            </div>
          </section>

          <section className="space-y-4 p-6">
            <h2 className="font-semibold text-slate-900">Address</h2>
            <AddressFields
              value={address}
              onChange={(a) =>
                a.country !== address.country ? applyCountry(a.country) : setAddress(a)
              }
            />
          </section>

          <section className="space-y-4 p-6">
            <Switch
              checked={chargesTax}
              onChange={setChargesTax}
              label="I charge VAT / sales tax"
              description="Adds a default tax rate to new invoices. You can add more rates later."
            />
            {chargesTax ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tax name">
                  {(id) => (
                    <Input id={id} value={taxName} onChange={(e) => setTaxName(e.target.value)} />
                  )}
                </Field>
                <Field label="Rate (%)">
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={taxRate}
                      onValueChange={setTaxRate}
                      allowNegative={false}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </section>

          <section className="grid gap-6 p-6 sm:grid-cols-2">
            <div className="space-y-3">
              <h2 className="font-semibold text-slate-900">Logo</h2>
              <LogoUpload value={logo} onChange={setLogo} />
            </div>
            <div className="space-y-3">
              <h2 className="font-semibold text-slate-900">Brand colour</h2>
              <ColorField value={accent} onChange={setAccent} />
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            {firstRun ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="ghost"
                  onClick={demo}
                  loading={busy === 'demo'}
                  disabled={busy !== null}
                >
                  <Sparkles /> Explore with demo data
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => backupInput.current?.click()}
                  loading={busy === 'restore'}
                  disabled={busy !== null}
                >
                  <Upload /> Restore a backup
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
            ) : (
              <Button variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            )}
            <Button size="lg" onClick={create} loading={busy === 'create'} disabled={busy !== null}>
              Create company
            </Button>
          </div>
        </Card>
        <p className="mt-6 text-center text-xs text-slate-500">
          Your data never leaves this device. Back it up regularly from Settings → Data.
        </p>
      </div>
    </div>
  );
}
