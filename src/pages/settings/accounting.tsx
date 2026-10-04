import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, Info, LockOpen } from 'lucide-react';
import { db } from '@/db/db';
import type { AccountRole, LevyRates, VatSettings } from '@/db/types';
import { accountingSettings, vatSettings } from '@/db/chart-setup';
import { EMIRATES, VAT_FORMATS } from '@/lib/accounting/vat';
import { roleMap } from '@/db/accounting';
import { CHART_TEMPLATES } from '@/lib/accounting/charts';
import { fiscalYearEnd, fiscalYearStart } from '@/lib/accounting/statements';
import { DEFAULT_LEVY_RATES, levyRates } from '@/lib/accounting/year-end';
import { today } from '@/lib/dates';
import { useFormat } from '@/app/company';
import { interfaceLocale, msg, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, NumberInput, Select, Switch } from '@/components/ui/form';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';
import { isolate } from '@/features/reports/report-language';
import { DateField } from '@/components/ui/date-field';

/** Quarter ends for each stagger (the month a quarter starts in). */
const STAGGERS = [
  { startMonth: 1, label: msg('March, June, September and December') },
  { startMonth: 2, label: msg('April, July, October and January') },
  { startMonth: 3, label: msg('May, August, November and February') },
];

const ROLE_LABELS: Partial<Record<AccountRole, string>> = {
  receivable: msg('Money owed by clients'),
  payable: msg('Money owed to vendors'),
  bank: msg('Payments in and out (default)'),
  cash: msg('Cash payments'),
  credit_card: msg('Company card'),
  sales: msg('Sales (unless a product says otherwise)'),
  charges: msg('Delivery and other charges'),
  expense: msg('Purchases (unless a bill line says otherwise)'),
  output_tax: msg('Tax charged on sales'),
  input_tax: msg('Tax paid on purchases'),
  tax_settlement: msg('VAT owed to (or due from) the tax office'),
  fx: msg('Exchange gains and losses'),
  capital: msg('Owner or share capital'),
  retained_earnings: msg('Retained earnings'),
};

const TEMPLATE_NAMES: Record<string, string> = {
  kw: msg('Kuwait'),
  generic: msg('Standard chart'),
  uk: msg('United Kingdom'),
  ae: msg('United Arab Emirates'),
};

const LEVY_FIELDS: { key: keyof LevyRates; label: string; hint: string }[] = [
  {
    key: 'statutoryReserve',
    label: msg('Statutory reserve'),
    hint: msg('Share of the profit moved to the reserve each year (not for sole traders).'),
  },
  {
    key: 'statutoryReserveCap',
    label: msg('Reserve limit (share of capital)'),
    hint: msg('Transfers stop once the reserve reaches this share of the paid-up capital.'),
  },
  { key: 'kfas', label: msg('KFAS'), hint: msg('Shareholding companies.') },
  { key: 'zakat', label: msg('Zakat'), hint: msg('Shareholding companies.') },
  { key: 'nlst', label: msg('NLST'), hint: msg('Listed shareholding companies.') },
  {
    key: 'incomeTax',
    label: msg('Income tax'),
    hint: msg('On the foreign-owned share of the profit.'),
  },
];

export default function AccountingSettings() {
  const fmt = useFormat();
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const settings = accountingSettings(draft);
  const setSettings = (patch: Partial<typeof settings>) =>
    update({ accounting: { ...settings, ...patch } });
  const vat = vatSettings(draft);
  const setVat = (patch: Partial<VatSettings>) => setSettings({ vat: { ...vat, ...patch } });
  const rates = levyRates(settings);
  const setRate = (key: keyof LevyRates, value: number) =>
    setSettings({ levies: { ...rates, [key]: value } });
  const accounts = useLiveQuery(
    () => db.accounts.where('companyId').equals(draft.id).toArray(),
    [draft.id],
  );
  const roles = accounts ? roleMap(accounts) : {};
  const { month, day } = settings.fiscalYearEnd;
  const daysInMonth = new Date(2023, month, 0).getDate();
  const now = today();
  const months = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(interfaceLocale(draft.locale), { month: 'long' }).format(
      new Date(2024, i, 1),
    ),
  );
  const customRates = JSON.stringify(rates) !== JSON.stringify(DEFAULT_LEVY_RATES);

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Financial year')}
        description={t(
          'Reports use it for “this year”, and income and expenses start again at zero each year.',
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Year ends on (month)')}>
            {(id) => (
              <Select
                id={id}
                value={month}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setSettings({
                    fiscalYearEnd: { month: m, day: Math.min(day, new Date(2023, m, 0).getDate()) },
                  });
                }}
              >
                {months.map((name, i) => (
                  <option key={i} value={i + 1}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('Day')}>
            {(id) => (
              <Select
                id={id}
                value={day}
                onChange={(e) =>
                  setSettings({ fiscalYearEnd: { month, day: Number(e.target.value) } })
                }
              >
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {fmt.quantity(d)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-sm text-slate-500">
          {t('Current financial year: {from} – {to}', {
            from: isolate(fmt.date(fiscalYearStart(now, settings.fiscalYearEnd))),
            to: isolate(fmt.date(fiscalYearEnd(now, settings.fiscalYearEnd))),
          })}
        </p>
      </SettingsSection>

      <SettingsSection
        title={t('Lock date')}
        description={t(
          'Once a period is reported or filed, lock it so nothing dated on or before the lock date can be added, changed or deleted.',
        )}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('Lock transactions up to and including')}>
            {(id) => (
              <DateField
                id={id}
                value={settings.lockDate ?? ''}
                onChange={(iso) => setSettings({ lockDate: iso || null })}
                className="w-52"
              />
            )}
          </Field>
          {settings.lockDate ? (
            <Button variant="outline" onClick={() => setSettings({ lockDate: null })}>
              <LockOpen /> {t('Remove lock')}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-slate-500">
          {t(
            'Drafts and quotes stay editable. Issued invoices, bills, credit notes, payments, expenses and journals in the locked period are protected.',
          )}
        </p>
      </SettingsSection>

      <SettingsSection
        title={t('Year-end close')}
        description={t(
          'At the end of each financial year: the statutory reserve, KFAS, Zakat, NLST and income tax on foreign-owned profits.',
        )}
        actions={
          <ButtonLink to="/year-end" variant="outline" size="sm">
            <CalendarCheck /> {t('Close a year')}
          </ButtonLink>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LEVY_FIELDS.map((field) => (
            <Field key={field.key} label={`${t(field.label)} (%)`} hint={t(field.hint)}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={rates[field.key]}
                  allowNegative={false}
                  onValueChange={(value) => setRate(field.key, value)}
                />
              )}
            </Field>
          ))}
        </div>
        <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />
            {t(
              'The rates follow Kuwaiti law as of 2026. Check them with your auditor; change them only if the law or your auditor says so.',
            )}
          </p>
          {customRates ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettings({ levies: { ...DEFAULT_LEVY_RATES } })}
            >
              {t('Use the legal rates')}
            </Button>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('VAT returns')}
        description={t(
          'AlmailBooks works out each return from your books. You then submit the figures to the tax office.',
        )}
        actions={
          vat.registered ? (
            <Link to="/vat" className="text-primary-700 text-sm font-medium hover:underline">
              {t('Open VAT returns')}
            </Link>
          ) : null
        }
      >
        <Switch
          checked={vat.registered}
          onChange={(registered) => setVat({ registered })}
          label={t('Registered for VAT')}
          description={t('Shows VAT returns for this company. Kuwait has no VAT.')}
        />
        {vat.registered ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Return')}>
              {(id) => (
                <Select
                  id={id}
                  value={vat.format}
                  onChange={(e) => setVat({ format: e.target.value as VatSettings['format'] })}
                >
                  {VAT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {t(f.label)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('You file')}>
              {(id) => (
                <Select
                  id={id}
                  value={vat.frequency}
                  onChange={(e) =>
                    setVat({ frequency: e.target.value as VatSettings['frequency'] })
                  }
                >
                  <option value="quarterly">{t('Every quarter')}</option>
                  <option value="monthly">{t('Every month')}</option>
                </Select>
              )}
            </Field>
            {vat.frequency === 'quarterly' ? (
              <Field
                label={t('Your quarters end in')}
                hint={t('As shown on your VAT registration.')}
              >
                {(id) => (
                  <Select
                    id={id}
                    value={((vat.startMonth - 1) % 3) + 1}
                    onChange={(e) => setVat({ startMonth: Number(e.target.value) })}
                  >
                    {STAGGERS.map((s) => (
                      <option key={s.startMonth} value={s.startMonth}>
                        {t(s.label)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {vat.format === 'ae' ? (
              <Field label={t('Emirate')} hint={t('Where the business is established.')}>
                {(id) => (
                  <Select
                    id={id}
                    value={vat.emirate ?? 'DU'}
                    onChange={(e) => setVat({ emirate: e.target.value })}
                  >
                    {EMIRATES.map((e) => (
                      <option key={e.code} value={e.code}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t('Chart of accounts')}
        description={t(
          'Started from the {chart} chart. Rename accounts or add new ones in the chart of accounts.',
          {
            chart: t(TEMPLATE_NAMES[settings.template] ?? CHART_TEMPLATES[settings.template].name),
          },
        )}
        actions={
          <Link to="/accounts" className="text-primary-700 text-sm font-medium hover:underline">
            {t('Open chart of accounts')}
          </Link>
        }
      >
        <div className="divide-y divide-slate-100 text-sm">
          {(Object.keys(ROLE_LABELS) as AccountRole[]).map((role) => {
            const account = accounts?.find((a) => a.id === roles[role]);
            return (
              <div key={role} className="flex items-center justify-between gap-4 py-2">
                <span className="text-slate-600">{t(ROLE_LABELS[role]!)}</span>
                <span className="text-end font-medium text-slate-900">
                  {account ? (
                    <>
                      <span className="tabular me-2 text-slate-500">{account.code}</span>
                      <bdi>{localName(account)}</bdi>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
    </div>
  );
}
