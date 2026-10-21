import { useId, useState, type ReactNode } from 'react';
import { addMonths, startOfMonth } from 'date-fns';
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
import type {
  AnnualLeaveDays,
  ContributionRates,
  GccScheme,
  LeavePolicy,
  PayrollAccountKey,
  PayrollSettings,
} from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { useCloudLink } from '@/cloud/hooks';
import { GCC_COUNTRIES } from '@/lib/hr/employees';
import {
  ANNUAL_LEAVE_DAYS,
  annualLeaveRecorded,
  DEFAULT_LEAVE_POLICY,
  FIRST_YEAR_MONTHS,
} from '@/lib/hr/leave';
import { PAYROLL_RULES } from '@/lib/hr/payroll';
import { countryName } from '@/lib/geo';
import { parseISODate, today, toISODate } from '@/lib/dates';
import { moneyAccounts, PayrollHeader, VerifyBadge } from '@/features/payroll/shared';
import { useAccounts, useLeaveRecords, usePayrollSettings } from '@/features/payroll/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
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

/** The first day of next month: where a new leave policy, or new days a year, start. */
const nextMonthStart = () => toISODate(startOfMonth(addMonths(parseISODate(today()), 1)));

const newLeavePolicy = (): LeavePolicy => ({
  ...DEFAULT_LEAVE_POLICY,
  annualDays: [{ from: nextMonthStart(), days: ANNUAL_LEAVE_DAYS }],
});

/** Nine months (the law) down to none. */
const FIRST_YEAR_CHOICES = Array.from(
  { length: FIRST_YEAR_MONTHS + 1 },
  (_, i) => FIRST_YEAR_MONTHS - i,
);

/**
 * The company's annual leave policy. The law's applies until the owner sets
 * one (D1): days a year from dates, the months before the first leave, a cap
 * on the days carried forward, and how leave is counted, which stays as it is
 * once annual leave has been recorded.
 */
function LeavePolicyCard({
  policy,
  saved,
  countingLocked,
  inCloud,
  onChange,
}: {
  policy: LeavePolicy | undefined;
  saved: LeavePolicy | undefined;
  countingLocked: boolean;
  /** The company is kept in the cloud: other devices may still run an older version. */
  inCloud: boolean;
  onChange: (policy: LeavePolicy) => void;
}) {
  const id = useId();
  // Older versions count leave as the law does, whatever the policy says.
  const olderVersions = inCloud ? (
    <p className="text-sm text-amber-700">
      {t(
        'Update the app on every device that records leave or approves pay runs first: older versions count annual leave as the law does.',
      )}
    </p>
  ) : null;
  if (!policy) {
    return (
      <Card>
        <CardHeader
          title={t('Annual leave')}
          description={t(
            'The law’s leave applies: 30 working days a year, 2.5 days for each month of service, usable after nine months (art. 70). Unused days carry forward and are paid when the employee leaves (art. 73).',
          )}
        />
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            {t(
              'Set a policy for more days a year, contract entitlements, a cap on the days carried forward, or leave counted in calendar days. Balances before the date it applies from don’t change.',
            )}
          </p>
          {olderVersions}
          <Button variant="outline" onClick={() => onChange(newLeavePolicy())}>
            <Plus /> {t('Set the company’s leave policy')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  const set = (patch: Partial<LeavePolicy>) => onChange({ ...policy, ...patch });
  const setRow = (index: number, patch: Partial<AnnualLeaveDays>) =>
    set({ annualDays: policy.annualDays.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  // A date already saved has changed the balances from it once: no need to say so again.
  const unsaved = (r: AnnualLeaveDays) =>
    !saved?.annualDays.some((x) => x.from === r.from && x.days === r.days);
  const on = today();
  // A saved date that has passed, removed or moved: balances from it change too.
  const pastRemoved = (saved?.annualDays ?? []).some(
    (x) => x.from <= on && !policy.annualDays.some((r) => r.from === x.from),
  );
  return (
    <Card>
      <CardHeader
        title={t('Annual leave')}
        description={t(
          'Days a year are earned from their date on; balances before the first date are the law’s and don’t change.',
        )}
      />
      <CardBody className="space-y-5">
        {olderVersions}
        <div>
          <div className="hidden grid-cols-[11rem_1fr_auto] gap-2 text-xs font-medium text-slate-500 sm:grid">
            <span>{t('From')}</span>
            <span>{t('Days a year')}</span>
            <span className="w-9" />
          </div>
          <ul className="divide-y divide-slate-100">
            {policy.annualDays.map((r, i) => (
              <li key={i} className="py-2">
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[11rem_1fr_auto]">
                  <div className="flex flex-col gap-1">
                    <CellLabel htmlFor={`${id}-from-${i}`}>{t('From')}</CellLabel>
                    <DateField
                      id={`${id}-from-${i}`}
                      value={r.from}
                      onChange={(iso) => iso && setRow(i, { from: iso })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <CellLabel htmlFor={`${id}-days-${i}`}>{t('Days a year')}</CellLabel>
                    <NumberInput
                      id={`${id}-days-${i}`}
                      value={r.days}
                      onValueChange={(days) => setRow(i, { days })}
                      allowNegative={false}
                      aria-invalid={r.days < ANNUAL_LEAVE_DAYS}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => set({ annualDays: policy.annualDays.filter((_, j) => j !== i) })}
                    disabled={policy.annualDays.length === 1}
                    aria-label={t('Remove')}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {r.days < ANNUAL_LEAVE_DAYS ? (
                  <p className="mt-1 text-xs text-red-600">
                    {t('At least 30 days a year (art. 70).')}
                  </p>
                ) : unsaved(r) && r.from <= on ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {t(
                      'This date has passed: balances from it change, and the next approved pay run’s leave provision takes in the difference.',
                    )}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {pastRemoved ? (
            <p className="mt-1 text-xs text-amber-700">
              {t(
                'A date that has passed was removed or moved: balances from it change, and the next approved pay run’s leave provision takes in the difference.',
              )}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() =>
              set({
                annualDays: [
                  ...policy.annualDays,
                  {
                    from: nextMonthStart(),
                    days: policy.annualDays.at(-1)?.days ?? ANNUAL_LEAVE_DAYS,
                  },
                ],
              })
            }
          >
            <Plus /> {t('Change the days from a date')}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label={t('Months before the first leave')}
            hint={t('Nine under the Labour Law (art. 70); fewer lets new staff take leave sooner.')}
          >
            {(field) => (
              <Select
                id={field}
                value={policy.firstYearMonths}
                onChange={(e) => set({ firstYearMonths: Number(e.target.value) })}
              >
                {FIRST_YEAR_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {tp(n, '{count} month', '{count} months')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('Most days carried into a new year')}
            optional
            hint={t(
              'Unused days above it are lost when a new year starts. Leave it empty to carry every day forward: unused days are paid when the employee leaves (art. 73).',
            )}
          >
            {(field) => (
              <NumberInput
                id={field}
                value={policy.carryForwardMax ?? 0}
                onValueChange={(n) => set({ carryForwardMax: n > 0 ? n : null })}
                allowNegative={false}
                blankZero
                placeholder={t('No cap')}
              />
            )}
          </Field>
          <Field
            label={t('Leave is counted in')}
            hint={
              countingLocked
                ? t('Annual leave has been recorded, so the way it is counted stays as it is.')
                : t('Working days skip Fridays, Saturdays and public holidays.')
            }
          >
            {(field) => (
              <Select
                id={field}
                value={policy.counting}
                disabled={countingLocked}
                onChange={(e) =>
                  set({ counting: e.target.value === 'calendar' ? 'calendar' : 'working' })
                }
              >
                <option value="working">{t('Working days')}</option>
                <option value="calendar">{t('Calendar days')}</option>
              </Select>
            )}
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}

export default function PayrollSettingsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const saved = usePayrollSettings();
  const accounts = useAccounts();
  const leave = useLeaveRecords();
  const link = useCloudLink(company.id);
  const [draft, setDraft] = useState<PayrollSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? saved;
  if (!value || !saved || !accounts || !leave) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

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
              label={t('Overtime and unpaid absence use')}
              hint={t(
                'Overtime is paid at 125%, on rest days 150% and on public holidays 200% of the hourly rate. Unpaid leave costs a share of the month’s pay.',
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

        <LeavePolicyCard
          policy={value.leavePolicy}
          saved={saved.leavePolicy}
          countingLocked={annualLeaveRecorded(leave)}
          inCloud={Boolean(link)}
          onChange={(leavePolicy) => set({ leavePolicy })}
        />

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
