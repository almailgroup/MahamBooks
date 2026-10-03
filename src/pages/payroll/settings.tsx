import { useId, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { accountingSettings } from '@/db/chart-setup';
import {
  LAST_DAY,
  PAYROLL_ACCOUNT_LABELS,
  PAYROLL_ACCOUNTS,
  payrollAccount,
  savePayrollSettings,
} from '@/db/payroll';
import type { ContributionRates, GccScheme, PayrollAccountKey, PayrollSettings } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { GCC_COUNTRIES } from '@/lib/hr/employees';
import { PAYROLL_RULES } from '@/lib/hr/payroll';
import { countryName } from '@/lib/geo';
import { today } from '@/lib/dates';
import { moneyAccounts, PayrollHeader, VerifyBadge } from '@/features/payroll/shared';
import { useAccounts, usePayrollSettings } from '@/features/payroll/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { DateField } from '@/components/ui/date-field';

const ACCOUNT_KEYS = Object.keys(PAYROLL_ACCOUNTS) as PayrollAccountKey[];

/** A small label above a field on phones, read by screen readers everywhere. */
function CellLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs text-slate-500 sm:sr-only">
      {children}
    </label>
  );
}

function RatesRow({
  value,
  onChange,
  onRemove,
  first,
}: {
  value: ContributionRates | GccScheme;
  onChange: (patch: Partial<ContributionRates & GccScheme>) => void;
  onRemove: () => void;
  first: ReactNode;
}) {
  const id = useId();
  return (
    <li className="grid grid-cols-2 items-end gap-2 py-2 sm:grid-cols-[11rem_1fr_1fr_1fr_auto]">
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">{first}</div>
      <div className="flex flex-col gap-1">
        <CellLabel htmlFor={`${id}-ee`}>{t('Employee %')}</CellLabel>
        <NumberInput
          id={`${id}-ee`}
          value={value.employee}
          onValueChange={(employee) => onChange({ employee })}
          allowNegative={false}
        />
      </div>
      <div className="flex flex-col gap-1">
        <CellLabel htmlFor={`${id}-er`}>{t('Employer %')}</CellLabel>
        <NumberInput
          id={`${id}-er`}
          value={value.employer}
          onValueChange={(employer) => onChange({ employer })}
          allowNegative={false}
        />
      </div>
      <div className="flex flex-col gap-1">
        <CellLabel htmlFor={`${id}-cap`}>{t('Salary cap')}</CellLabel>
        <NumberInput
          id={`${id}-cap`}
          value={value.cap ?? 0}
          onValueChange={(cap) => onChange({ cap: cap > 0 ? cap : null })}
          allowNegative={false}
          blankZero
          placeholder={t('None')}
        />
      </div>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label={t('Remove')}>
        <Trash2 />
      </Button>
    </li>
  );
}

function RatesHeader({ first }: { first: string }) {
  return (
    <div className="hidden grid-cols-[11rem_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-slate-500 sm:grid">
      <span>{first}</span>
      <span>{t('Employee %')}</span>
      <span>{t('Employer %')}</span>
      <span>{t('Salary cap')}</span>
      <span className="w-9" />
    </div>
  );
}

export default function PayrollSettingsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const saved = usePayrollSettings();
  const accounts = useAccounts();
  const [draft, setDraft] = useState<PayrollSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? saved;
  if (!value || !accounts) return <Spinner className="py-24" label={t('Loading…')} />;

  const set = (patch: Partial<PayrollSettings>) => setDraft({ ...value, ...patch });
  const template = accountingSettings(company).template;
  const banks = moneyAccounts(accounts, value.bankAccountId);
  const main = accounts.find((a) => a.role === 'bank');
  const sorted = accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const usedCountries = new Set(value.gcc.map((s) => s.country));

  const save = async () => {
    setBusy(true);
    try {
      await savePayrollSettings(value);
      setDraft(null);
      toast.success(t('Payroll settings saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PayrollHeader />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('Pay')} />
          <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label={t('Pay day')} hint={t('The pay date suggested for each month.')}>
              {(id) => (
                <Select
                  id={id}
                  value={value.payDay}
                  onChange={(e) => set({ payDay: Number(e.target.value) })}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {t('Day {day} of the month', { day: d })}
                    </option>
                  ))}
                  <option value={LAST_DAY}>{t('Last day of the month')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('Salaries paid from')}>
              {(id) => (
                <Select
                  id={id}
                  value={value.bankAccountId ?? ''}
                  onChange={(e) => set({ bankAccountId: e.target.value || null })}
                >
                  <option value="">
                    {main
                      ? t('{account} (default)', { account: localName(main) })
                      : t('Default account')}
                  </option>
                  {banks
                    .filter((a) => a.id !== main?.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {localName(a)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field
              label={t('Working days in a month')}
              hint={t(
                'The daily rate is the monthly wage divided by this; 26 for a six-day week (art. 67).',
              )}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={value.dailyDivisor}
                  onValueChange={(dailyDivisor) => set({ dailyDivisor })}
                  allowNegative={false}
                />
              )}
            </Field>
            <Field
              label={t('Overtime and unpaid days use')}
              hint={t(
                'Overtime is paid at 125%, on rest days 150% and on public holidays 200% of the hourly rate.',
              )}
            >
              {(id) => (
                <Select
                  id={id}
                  value={value.rateBase}
                  onChange={(e) => set({ rateBase: e.target.value === 'basic' ? 'basic' : 'wage' })}
                >
                  <option value="wage">{t('Basic salary and allowances')}</option>
                  <option value="basic">{t('Basic salary only')}</option>
                </Select>
              )}
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  {t('Minimum wage')} <VerifyBadge />
                </span>
              }
              hint={t('Pay runs warn when net pay is below it. Commonly cited as {amount}.', {
                amount: fmt.money(PAYROLL_RULES.minimumWage),
              })}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={value.minimumWage}
                  onValueChange={(minimumWage) => set({ minimumWage })}
                  allowNegative={false}
                />
              )}
            </Field>
            <Field
              label={t('PAM file number')}
              optional
              hint={t(
                'Your company file with the Public Authority for Manpower, for the salary file.',
              )}
            >
              {(id) => (
                <Input
                  id={id}
                  value={value.pamFileNumber}
                  onChange={(e) => set({ pamFileNumber: e.target.value })}
                  dir="ltr"
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                {t('PIFSS rates for Kuwaiti staff')} <VerifyBadge />
              </span>
            }
            description={t(
              'Shares of the insured salary (basic salary and allowances) up to the cap. Rates apply from their date until newer ones.',
            )}
          />
          <CardBody>
            <RatesHeader first={t('From')} />
            <ul className="divide-y divide-slate-100">
              {value.pifss.map((r, i) => (
                <RatesRow
                  key={i}
                  value={r}
                  onChange={(patch) =>
                    set({ pifss: value.pifss.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                  }
                  onRemove={() => set({ pifss: value.pifss.filter((_, j) => j !== i) })}
                  first={
                    <>
                      <CellLabel htmlFor={`pifss-from-${i}`}>{t('From')}</CellLabel>
                      <DateField
                        id={`pifss-from-${i}`}
                        value={r.from}
                        onChange={(iso) =>
                          iso &&
                          set({
                            pifss: value.pifss.map((x, j) => (j === i ? { ...x, from: iso } : x)),
                          })
                        }
                      />
                    </>
                  }
                />
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() =>
                set({
                  pifss: [
                    ...value.pifss,
                    { ...(value.pifss.at(-1) ?? PAYROLL_RULES.pifss), from: today() },
                  ],
                })
              }
            >
              <Plus /> {t('Add new rates')}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('GCC nationals')}
            description={t(
              'GCC nationals contribute to their home scheme through PIFSS. Enter the rates of each country you employ; until then they are paid without contributions.',
            )}
          />
          <CardBody>
            {value.gcc.length > 0 ? <RatesHeader first={t('Country')} /> : null}
            <ul className="divide-y divide-slate-100">
              {value.gcc.map((s, i) => (
                <RatesRow
                  key={s.country}
                  value={s}
                  onChange={(patch) =>
                    set({ gcc: value.gcc.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
                  }
                  onRemove={() => set({ gcc: value.gcc.filter((_, j) => j !== i) })}
                  first={
                    <>
                      <CellLabel htmlFor={`gcc-${i}`}>{t('Country')}</CellLabel>
                      <Select
                        id={`gcc-${i}`}
                        value={s.country}
                        onChange={(e) =>
                          set({
                            gcc: value.gcc.map((x, j) =>
                              j === i ? { ...x, country: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        {GCC_COUNTRIES.filter((c) => c === s.country || !usedCountries.has(c)).map(
                          (c) => (
                            <option key={c} value={c}>
                              {countryName(c, fmt.locale)}
                            </option>
                          ),
                        )}
                      </Select>
                    </>
                  }
                />
              ))}
            </ul>
            {GCC_COUNTRIES.some((c) => !usedCountries.has(c)) ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  set({
                    gcc: [
                      ...value.gcc,
                      {
                        country: GCC_COUNTRIES.find((c) => !usedCountries.has(c))!,
                        employee: 0,
                        employer: 0,
                        cap: null,
                      },
                    ],
                  })
                }
              >
                <Plus /> {t('Add a country')}
              </Button>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('Provisions')} />
          <CardBody className="space-y-4">
            <Switch
              checked={value.provisions}
              onChange={(provisions) => set({ provisions })}
              label={t('Post end-of-service and leave provisions each month')}
              description={t(
                'When a pay run is approved, the end-of-service provision is brought to what everyone would get at the month end, and the leave salary provision to the value of unused leave.',
              )}
            />
            <Switch
              checked={value.eosForInsured}
              onChange={(eosForInsured) => set({ eosForInsured })}
              disabled={!value.provisions}
              label={t('Include staff insured with PIFSS in the end-of-service provision')}
              description={t(
                'For Kuwaiti and GCC staff the employer pays only what PIFSS does not cover. Leave it off unless you owe them an indemnity.',
              )}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('Accounts')}
            description={t(
              'Where the payroll posts. Accounts that are missing are created when first used.',
            )}
          />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ACCOUNT_KEYS.map((key) => {
              const found = payrollAccount(accounts, { accounts: {} }, key, template);
              const spec = PAYROLL_ACCOUNTS[key];
              return (
                <Field key={key} label={t(PAYROLL_ACCOUNT_LABELS[key])}>
                  {(id) => (
                    <Select
                      id={id}
                      value={value.accounts[key] ?? ''}
                      onChange={(e) =>
                        set({ accounts: { ...value.accounts, [key]: e.target.value || undefined } })
                      }
                    >
                      <option value="">
                        {found
                          ? `${found.code} ${localName(found)}`
                          : t('{code} {name} (created when used)', {
                              code: spec.code,
                              name: localName(spec),
                            })}
                      </option>
                      {sorted
                        .filter((a) => a.id !== found?.id)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {localName(a)}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              );
            })}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          {draft ? (
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('Discard changes')}
            </Button>
          ) : null}
          <Button onClick={() => void save()} loading={busy} disabled={!draft}>
            {t('Save settings')}
          </Button>
        </div>
      </div>
    </div>
  );
}
