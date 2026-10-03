import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { LockOpen } from 'lucide-react';
import { db } from '@/db/db';
import type { AccountRole, VatSettings } from '@/db/types';
import { accountingSettings, vatSettings } from '@/db/chart-setup';
import { EMIRATES, VAT_FORMATS } from '@/lib/accounting/vat';
import { roleMap } from '@/db/accounting';
import { CHART_TEMPLATES } from '@/lib/accounting/charts';
import { fiscalYearEnd, fiscalYearStart } from '@/lib/accounting/statements';
import { today } from '@/lib/dates';
import { useFormat } from '@/app/company';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { SaveBar, SettingsSection, useCompanyDraft } from './shared';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2024, i, 1).toLocaleString('en', { month: 'long' }),
);

/** Quarter ends for each stagger (the month a quarter starts in). */
const STAGGERS = [
  { startMonth: 1, label: 'March, June, September and December' },
  { startMonth: 2, label: 'April, July, October and January' },
  { startMonth: 3, label: 'May, August, November and February' },
];

const ROLE_LABELS: Partial<Record<AccountRole, string>> = {
  receivable: 'Money owed by clients',
  payable: 'Money owed to vendors',
  bank: 'Payments in and out (default)',
  cash: 'Cash payments',
  credit_card: 'Company card',
  sales: 'Sales (unless a product says otherwise)',
  charges: 'Delivery and other charges',
  expense: 'Purchases (unless a bill line says otherwise)',
  output_tax: 'Tax charged on sales',
  input_tax: 'Tax paid on purchases',
  tax_settlement: 'VAT owed to (or due from) the tax office',
  fx: 'Exchange gains and losses',
  capital: 'Owner or share capital',
  retained_earnings: 'Retained earnings',
};

export default function AccountingSettings() {
  const fmt = useFormat();
  const { draft, update, dirty, saving, save, reset } = useCompanyDraft();
  const settings = accountingSettings(draft);
  const setSettings = (patch: Partial<typeof settings>) =>
    update({ accounting: { ...settings, ...patch } });
  const vat = vatSettings(draft);
  const setVat = (patch: Partial<VatSettings>) => setSettings({ vat: { ...vat, ...patch } });
  const accounts = useLiveQuery(
    () => db.accounts.where('companyId').equals(draft.id).toArray(),
    [draft.id],
  );
  const roles = accounts ? roleMap(accounts) : {};
  const { month, day } = settings.fiscalYearEnd;
  const daysInMonth = new Date(2023, month, 0).getDate();
  const now = today();

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Financial year"
        description="Reports use it for “this year”, and income and expenses start again at zero each year."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Year ends on (month)">
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
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Day">
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
                    {d}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-sm text-slate-500">
          Current financial year: {fmt.date(fiscalYearStart(now, settings.fiscalYearEnd))} –{' '}
          {fmt.date(fiscalYearEnd(now, settings.fiscalYearEnd))}
        </p>
      </SettingsSection>

      <SettingsSection
        title="Lock date"
        description="Once a period is reported or filed, lock it so nothing dated on or before the lock date can be added, changed or deleted."
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Lock transactions up to and including">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={settings.lockDate ?? ''}
                onChange={(e) => setSettings({ lockDate: e.target.value || null })}
                className="w-52"
              />
            )}
          </Field>
          {settings.lockDate ? (
            <Button variant="outline" onClick={() => setSettings({ lockDate: null })}>
              <LockOpen /> Remove lock
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-slate-500">
          Drafts and quotes stay editable. Issued invoices, bills, credit notes, payments, expenses
          and journals in the locked period are protected.
        </p>
      </SettingsSection>

      <SettingsSection
        title="VAT returns"
        description="AlmailBooks works out each return from your books. You then submit the figures to the tax office."
        actions={
          vat.registered ? (
            <Link to="/vat" className="text-primary-700 text-sm font-medium hover:underline">
              Open VAT returns
            </Link>
          ) : null
        }
      >
        <Switch
          checked={vat.registered}
          onChange={(registered) => setVat({ registered })}
          label="Registered for VAT"
          description="Shows VAT returns for this company."
        />
        {vat.registered ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Return">
              {(id) => (
                <Select
                  id={id}
                  value={vat.format}
                  onChange={(e) => setVat({ format: e.target.value as VatSettings['format'] })}
                >
                  {VAT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="You file">
              {(id) => (
                <Select
                  id={id}
                  value={vat.frequency}
                  onChange={(e) =>
                    setVat({ frequency: e.target.value as VatSettings['frequency'] })
                  }
                >
                  <option value="quarterly">Every quarter</option>
                  <option value="monthly">Every month</option>
                </Select>
              )}
            </Field>
            {vat.frequency === 'quarterly' ? (
              <Field label="Your quarters end in" hint="As shown on your VAT registration.">
                {(id) => (
                  <Select
                    id={id}
                    value={((vat.startMonth - 1) % 3) + 1}
                    onChange={(e) => setVat({ startMonth: Number(e.target.value) })}
                  >
                    {STAGGERS.map((s) => (
                      <option key={s.startMonth} value={s.startMonth}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {vat.format === 'ae' ? (
              <Field label="Emirate" hint="Where the business is established.">
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
        title="Chart of accounts"
        description={`Started from the ${CHART_TEMPLATES[settings.template].name} chart. Rename accounts or add new ones in the chart of accounts.`}
        actions={
          <Link to="/accounts" className="text-primary-700 text-sm font-medium hover:underline">
            Open chart of accounts
          </Link>
        }
      >
        <div className="divide-y divide-slate-100 text-sm">
          {(Object.keys(ROLE_LABELS) as AccountRole[]).map((role) => {
            const account = accounts?.find((a) => a.id === roles[role]);
            return (
              <div key={role} className="flex items-center justify-between gap-4 py-2">
                <span className="text-slate-600">{ROLE_LABELS[role]}</span>
                <span className="font-medium text-slate-900">
                  {account ? (
                    <>
                      <span className="tabular me-2 text-slate-400">{account.code}</span>
                      {account.name}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
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
