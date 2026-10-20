import { useId, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { addYears } from 'date-fns';
import type {
  ContractType,
  Department,
  Employee,
  EmployeeAllowance,
  EmployeeStatus,
  Gender,
  LeavingReason,
  PayBasis,
} from '@/db/types';
import { newAllowance } from '@/db/people';
import { useFormat } from '@/app/company';
import {
  CATEGORY_FILTER_LABELS,
  categoryForNationality,
  CONTRACT_LABELS,
  GENDER_LABELS,
  insuredWithPifss,
  isStateless,
  LEAVING_REASON_LABELS,
  needsResidency,
  needsWorkPermit,
  PAY_BASIS_LABELS,
  probationLimit,
  RESIDENCY_ARTICLES,
  STATUS_LABELS,
  type CategoryFilter,
} from '@/lib/hr/employees';
import { hasDepartmentList } from '@/lib/hr/departments';
import { eosWage } from '@/lib/hr/eosi';
import {
  bankFromIban,
  formatIban,
  isValidCivilId,
  isValidIban,
  KUWAIT_BANKS,
  normalizeKuwaitPhone,
} from '@/lib/kuwait';
import { parseISODate, today, toISODate } from '@/lib/dates';
import { currencyPrecision, dec, round } from '@/lib/money';
import { msg, t } from '@/i18n';
import { useLanguage } from '@/i18n/provider';
import { CountrySelect } from '@/components/fields';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader, Segmented } from '@/components/ui/misc';
import type { AttachedFile } from '@/features/purchases/attachments';
import { DepartmentSelect } from './department-select';
import { FileList } from './file-list';
import { DateField } from '@/components/ui/date-field';

export type EmployeeErrors = Partial<
  Record<'name' | 'iban' | 'contractEnd' | 'leavingDate' | 'leavingReason' | 'number', string>
>;

/** Blocking problems; soft warnings (Civil ID, probation) are shown on the fields. */
export function validateEmployee(employee: Employee): EmployeeErrors {
  const errors: EmployeeErrors = {};
  if (!employee.name.trim()) errors.name = t('Enter the employee’s name.');
  if (employee.iban.trim() && !isValidIban(employee.iban)) {
    errors.iban = t('This IBAN is not valid. Check the number.');
  }
  if (employee.contractType === 'fixed') {
    if (!employee.contractEnd) errors.contractEnd = t('Enter the date the contract ends.');
    else if (employee.hireDate && employee.contractEnd < employee.hireDate) {
      errors.contractEnd = t('The contract ends before the hire date.');
    }
  }
  if (
    employee.status === 'left' &&
    employee.leavingDate &&
    employee.hireDate &&
    employee.leavingDate < employee.hireDate
  ) {
    errors.leavingDate = t('The leaving date is before the hire date.');
  }
  // Never a reason nobody chose: it decides the end-of-service indemnity.
  if (employee.status === 'left' && !employee.leavingReason) {
    errors.leavingReason = t('Choose the reason for leaving.');
  }
  return errors;
}

/** Common allowances with their Arabic names. */
const ALLOWANCE_SUGGESTIONS: { en: string; ar: string }[] = [
  { en: msg('Housing allowance'), ar: 'بدل سكن' },
  { en: msg('Transport allowance'), ar: 'بدل مواصلات' },
  { en: msg('Phone allowance'), ar: 'بدل هاتف' },
  { en: msg('Food allowance'), ar: 'بدل طعام' },
  { en: msg('Social allowance'), ar: 'علاوة اجتماعية' },
];

const CATEGORY_HINTS: Record<CategoryFilter, string> = {
  kuwaiti: msg('Insured with PIFSS. No residency needed.'),
  gcc: msg('Insured with PIFSS under the GCC scheme. No residency needed.'),
  expat: msg('Needs an Article 18 residency and a work permit.'),
  stateless: msg(
    'Not insured with PIFSS. No residency needed: they hold a Central Agency review card. A work permit is optional.',
  ),
  domestic: msg('Covered by the domestic workers law (68/2015), not the Labour Law.'),
};

/** The choices of category: stateless staff are expatriates with the flag (see isStateless). */
const CATEGORIES: CategoryFilter[] = ['kuwaiti', 'gcc', 'expat', 'stateless', 'domestic'];

const GENDERS: Gender[] = ['male', 'female'];
const STATUSES: EmployeeStatus[] = ['active', 'on_leave', 'left'];
const PAY_BASES: PayBasis[] = ['monthly', 'daily', 'hourly', 'piece'];
const CONTRACTS: ContractType[] = ['unlimited', 'fixed'];
const REASONS = Object.keys(LEAVING_REASON_LABELS) as LeavingReason[];

function Section({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</CardBody>
    </Card>
  );
}

/** Text shown in amber under a field: worth checking, but saving is allowed. */
function Warning({ children }: { children: ReactNode }) {
  return <span className="text-amber-700">{children}</span>;
}

export function EmployeeForm({
  value,
  onChange,
  errors,
  currency,
  departments,
  departmentList,
  files,
}: {
  value: Employee;
  onChange: (employee: Employee) => void;
  errors: EmployeeErrors;
  currency: string;
  /** Departments the company's employees have, suggested when there is no list. */
  departments: string[];
  /** The company's list of departments (people settings); without one, a name is typed. */
  departmentList?: Department[];
  files: {
    files: AttachedFile[];
    add: (file: AttachedFile) => void;
    remove: (id: string) => void;
  };
}) {
  const fmt = useFormat();
  const { language } = useLanguage();
  const suggestions = useId();
  const allowanceList = useId();
  const statusLabel = useId();
  const set = (patch: Partial<Employee>) => onChange({ ...value, ...patch });
  const setAllowance = (index: number, patch: Partial<EmployeeAllowance>) =>
    set({
      allowances: value.allowances.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    });

  const places = currencyPrecision(currency);
  const totalPay = round(
    value.allowances.reduce((s, a) => s.plus(dec(a.amount)), dec(value.basicSalary)),
    places,
  );
  const wage = eosWage(value.basicSalary, value.allowances, places);
  const limit = value.hireDate ? probationLimit(value.hireDate) : null;
  const civilIdOk = !value.civilId.trim() || isValidCivilId(value.civilId);
  const bank = bankFromIban(value.iban);
  const longContract =
    value.contractType === 'fixed' &&
    value.hireDate &&
    value.contractEnd &&
    value.contractEnd > toISODate(addYears(parseISODate(value.hireDate), 5));

  const stateless = isStateless(value);
  const category: CategoryFilter = stateless ? 'stateless' : value.category;
  // Stateless staff are expatriates with the flag, and no country.
  const setCategory = (next: CategoryFilter) =>
    next === 'stateless'
      ? set({ category: 'expat', stateless: true, nationality: '' })
      : set({ category: next, ...(value.stateless ? { stateless: false } : {}) });
  const setNationality = (nationality: string) =>
    set({
      nationality,
      category: value.category === 'domestic' ? 'domestic' : categoryForNationality(nationality),
      // A country chosen: no longer stateless.
      ...(nationality && value.stateless ? { stateless: false } : {}),
    });

  const workPermitFields = (
    <>
      <Field label={t('Work permit number')} optional>
        {(id) => (
          <Input
            id={id}
            value={value.workPermitNumber}
            onChange={(e) => set({ workPermitNumber: e.target.value })}
            dir="ltr"
          />
        )}
      </Field>
      <Field label={t('Work permit expiry')} optional>
        {(id) => (
          <DateField
            id={id}
            value={value.workPermitExpiry ?? ''}
            onChange={(iso) => set({ workPermitExpiry: iso || null })}
          />
        )}
      </Field>
      <Field label={t('Job title on the work permit')} optional hint={t('As registered with PAM.')}>
        {(id) => (
          <Input
            id={id}
            value={value.pamJobTitle}
            onChange={(e) => set({ pamJobTitle: e.target.value })}
            dir="auto"
          />
        )}
      </Field>
      <Field
        label={t('Salary on the work permit')}
        optional
        hint={
          value.permitSalary > 0 && totalPay < value.permitSalary ? (
            <Warning>{t('The monthly pay is lower than the salary on the work permit.')}</Warning>
          ) : undefined
        }
      >
        {(id) => (
          <NumberInput
            id={id}
            value={value.permitSalary}
            onValueChange={(permitSalary) => set({ permitSalary })}
            allowNegative={false}
            blankZero
          />
        )}
      </Field>
    </>
  );

  return (
    <div className="space-y-6">
      <Section title={t('Personal details')}>
        <Field label={t('Name (English)')} error={errors.name}>
          {(id) => (
            <Input
              id={id}
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              aria-invalid={Boolean(errors.name)}
              autoComplete="off"
              dir="ltr"
            />
          )}
        </Field>
        <Field label={t('Name (Arabic)')} optional>
          {(id) => (
            <Input
              id={id}
              value={value.nameAr ?? ''}
              onChange={(e) => set({ nameAr: e.target.value })}
              autoComplete="off"
              dir="rtl"
            />
          )}
        </Field>
        <Field
          label={t('Employee number')}
          optional
          error={errors.number}
          hint={t('Left empty, the next number is given.')}
        >
          {(id) => (
            <Input
              id={id}
              value={value.number}
              onChange={(e) => set({ number: e.target.value })}
              placeholder={t('Automatic')}
              dir="ltr"
            />
          )}
        </Field>
        <Field label={t('Nationality')}>
          {(id) => <CountrySelect id={id} value={value.nationality} onChange={setNationality} />}
        </Field>
        <Field label={t('Category')} hint={t(CATEGORY_HINTS[category] ?? '')}>
          {(id) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_FILTER_LABELS[c])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Gender')} optional>
          {(id) => (
            <Select
              id={id}
              value={value.gender ?? ''}
              onChange={(e) => set({ gender: (e.target.value || null) as Gender | null })}
            >
              <option value="">{t('Not set')}</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t(GENDER_LABELS[g])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('Date of birth')} optional>
          {(id) => (
            <DateField
              id={id}
              value={value.birthDate ?? ''}
              max={today()}
              onChange={(iso) => set({ birthDate: iso || null })}
            />
          )}
        </Field>
        <Field
          label={t('Mobile')}
          optional
          hint={
            value.phone.trim() && !normalizeKuwaitPhone(value.phone) ? (
              <Warning>{t('Not a Kuwaiti number. Check it if it should be one.')}</Warning>
            ) : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              type="tel"
              value={value.phone}
              onChange={(e) => set({ phone: e.target.value })}
              onBlur={() => {
                const normalized = normalizeKuwaitPhone(value.phone);
                if (normalized && normalized !== value.phone) set({ phone: normalized });
              }}
              placeholder="+965 5000 0000"
              dir="ltr"
            />
          )}
        </Field>
        <Field label={t('Email')} optional className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              type="email"
              value={value.email}
              onChange={(e) => set({ email: e.target.value })}
              dir="ltr"
            />
          )}
        </Field>
      </Section>

      <Section
        title={t('Civil ID and passport')}
        description={t('Expiry dates appear in Compliance with reminders.')}
      >
        <Field
          label={t('Civil ID number')}
          optional
          hint={
            civilIdOk ? undefined : (
              <Warning>
                {t('This does not look like a valid Civil ID. Check the 12 digits.')}
              </Warning>
            )
          }
        >
          {(id) => (
            <Input
              id={id}
              value={value.civilId}
              onChange={(e) => set({ civilId: e.target.value })}
              inputMode="numeric"
              maxLength={14}
              dir="ltr"
            />
          )}
        </Field>
        <Field label={t('Civil ID expiry')} optional>
          {(id) => (
            <DateField
              id={id}
              value={value.civilIdExpiry ?? ''}
              onChange={(iso) => set({ civilIdExpiry: iso || null })}
            />
          )}
        </Field>
        <Field label={t('Passport number')} optional>
          {(id) => (
            <Input
              id={id}
              value={value.passportNumber}
              onChange={(e) => set({ passportNumber: e.target.value })}
              dir="ltr"
            />
          )}
        </Field>
        <Field label={t('Passport expiry')} optional>
          {(id) => (
            <DateField
              id={id}
              value={value.passportExpiry ?? ''}
              onChange={(iso) => set({ passportExpiry: iso || null })}
            />
          )}
        </Field>
        {insuredWithPifss(value.category) ? (
          <Field
            label={t('PIFSS number')}
            optional
            hint={t('Social security registration with PIFSS.')}
          >
            {(id) => (
              <Input
                id={id}
                value={value.pifssNumber}
                onChange={(e) => set({ pifssNumber: e.target.value })}
                dir="ltr"
              />
            )}
          </Field>
        ) : null}
      </Section>

      {stateless ? (
        <Section
          title={t('Central Agency review card')}
          description={t(
            'Stateless staff hold a review card instead of a residency. The work permit is optional.',
          )}
        >
          <Field label={t('Review card number')} optional>
            {(id) => (
              <Input
                id={id}
                value={value.centralCardNumber ?? ''}
                onChange={(e) => set({ centralCardNumber: e.target.value })}
                dir="ltr"
              />
            )}
          </Field>
          <Field label={t('Review card expiry')} optional>
            {(id) => (
              <DateField
                id={id}
                value={value.centralCardExpiry ?? ''}
                onChange={(iso) => set({ centralCardExpiry: iso || null })}
              />
            )}
          </Field>
          {workPermitFields}
        </Section>
      ) : needsResidency(value) ? (
        <Section title={needsWorkPermit(value) ? t('Residency and work permit') : t('Residency')}>
          <Field label={t('Residency article')}>
            {(id) => (
              <Select
                id={id}
                value={value.residencyArticle}
                onChange={(e) => set({ residencyArticle: e.target.value })}
              >
                {RESIDENCY_ARTICLES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {t(a.label)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('Residency number')} optional>
            {(id) => (
              <Input
                id={id}
                value={value.residencyNumber}
                onChange={(e) => set({ residencyNumber: e.target.value })}
                dir="ltr"
              />
            )}
          </Field>
          <Field label={t('Residency expiry')}>
            {(id) => (
              <DateField
                id={id}
                value={value.residencyExpiry ?? ''}
                onChange={(iso) => set({ residencyExpiry: iso || null })}
              />
            )}
          </Field>
          {needsWorkPermit(value) ? workPermitFields : null}
        </Section>
      ) : null}

      <Section title={t('Job and contract')}>
        <Field label={t('Job title (English)')} optional>
          {(id) => (
            <Input
              id={id}
              value={value.jobTitle}
              onChange={(e) => set({ jobTitle: e.target.value })}
              dir="ltr"
            />
          )}
        </Field>
        <Field label={t('Job title (Arabic)')} optional>
          {(id) => (
            <Input
              id={id}
              value={value.jobTitleAr ?? ''}
              onChange={(e) => set({ jobTitleAr: e.target.value })}
              dir="rtl"
            />
          )}
        </Field>
        <Field label={t('Department')} optional>
          {(id) =>
            departmentList && hasDepartmentList(departmentList) ? (
              <DepartmentSelect
                id={id}
                value={value.department}
                list={departmentList}
                onChange={(department) => set({ department })}
              />
            ) : (
              <>
                <Input
                  id={id}
                  value={value.department}
                  onChange={(e) => set({ department: e.target.value })}
                  list={suggestions}
                  dir="auto"
                />
                <datalist id={suggestions}>
                  {departments.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </>
            )
          }
        </Field>
        <Field label={t('Hire date')}>
          {(id) => (
            <DateField
              id={id}
              value={value.hireDate ?? ''}
              onChange={(iso) => set({ hireDate: iso || null })}
            />
          )}
        </Field>
        <Field
          label={t('Probation ends')}
          optional
          hint={
            limit && value.probationEnd && value.probationEnd > limit ? (
              <Warning>
                {t('Longer than 100 working days (Labour Law art. 32). The latest is {date}.', {
                  date: fmt.date(limit),
                })}
              </Warning>
            ) : limit ? (
              t('At most 100 working days: {date} at the latest.', { date: fmt.date(limit) })
            ) : undefined
          }
        >
          {(id) => (
            <DateField
              id={id}
              value={value.probationEnd ?? ''}
              min={value.hireDate ?? undefined}
              onChange={(iso) => set({ probationEnd: iso || null })}
            />
          )}
        </Field>
        <Field label={t('Contract')}>
          {(id) => (
            <Select
              id={id}
              value={value.contractType}
              onChange={(e) => set({ contractType: e.target.value as ContractType })}
            >
              {CONTRACTS.map((c) => (
                <option key={c} value={c}>
                  {t(CONTRACT_LABELS[c])}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {value.contractType === 'fixed' ? (
          <Field
            label={t('Contract ends')}
            error={errors.contractEnd}
            hint={
              longContract ? (
                <Warning>
                  {t('A fixed-term contract can run for at most 5 years (art. 30).')}
                </Warning>
              ) : undefined
            }
          >
            {(id) => (
              <DateField
                id={id}
                value={value.contractEnd ?? ''}
                onChange={(iso) => set({ contractEnd: iso || null })}
                aria-invalid={Boolean(errors.contractEnd)}
              />
            )}
          </Field>
        ) : null}
      </Section>

      <Card>
        <CardHeader
          title={t('Pay')}
          description={t('Amounts per month in {currency}.', { currency })}
        />
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('Pay basis')}
              hint={
                value.payBasis === 'monthly'
                  ? t('End of service: 15 days a year for 5 years, then a month a year.')
                  : t('End of service: 10 days a year for 5 years, then 15 days a year.')
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={value.payBasis}
                  onChange={(e) => set({ payBasis: e.target.value as PayBasis })}
                >
                  {PAY_BASES.map((p) => (
                    <option key={p} value={p}>
                      {t(PAY_BASIS_LABELS[p])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t('Basic salary')}
              hint={value.payBasis === 'monthly' ? undefined : t('The average monthly wage.')}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={value.basicSalary}
                  onValueChange={(basicSalary) => set({ basicSalary })}
                  allowNegative={false}
                  blankZero
                />
              )}
            </Field>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">{t('Allowances')}</h3>
            <datalist id={allowanceList}>
              {ALLOWANCE_SUGGESTIONS.map((s) => (
                <option key={s.en} value={language === 'ar' ? s.ar : t(s.en)} />
              ))}
            </datalist>
            {value.allowances.map((a, index) => (
              <div
                key={a.id}
                className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_9rem_auto]"
              >
                <Field label={t('Allowance (English)')}>
                  {(id) => (
                    <Input
                      id={id}
                      value={a.name}
                      list={language === 'en' ? allowanceList : undefined}
                      onChange={(e) => {
                        const name = e.target.value;
                        const known = ALLOWANCE_SUGGESTIONS.find((s) => s.en === name);
                        setAllowance(index, {
                          name,
                          ...(known && !a.nameAr ? { nameAr: known.ar } : {}),
                        });
                      }}
                      dir="ltr"
                    />
                  )}
                </Field>
                <Field label={t('Allowance (Arabic)')}>
                  {(id) => (
                    <Input
                      id={id}
                      value={a.nameAr ?? ''}
                      list={language === 'ar' ? allowanceList : undefined}
                      onChange={(e) => {
                        const nameAr = e.target.value;
                        const known = ALLOWANCE_SUGGESTIONS.find((s) => s.ar === nameAr);
                        setAllowance(index, {
                          nameAr,
                          ...(known && !a.name ? { name: known.en } : {}),
                        });
                      }}
                      dir="rtl"
                    />
                  )}
                </Field>
                <Field label={t('Amount')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={a.amount}
                      onValueChange={(amount) => setAllowance(index, { amount })}
                      allowNegative={false}
                      blankZero
                    />
                  )}
                </Field>
                <div className="flex items-end justify-between gap-2 pb-1 sm:justify-end">
                  <Checkbox
                    label={t('End of service')}
                    checked={a.countsForEos}
                    onChange={(e) => setAllowance(index, { countsForEos: e.target.checked })}
                    title={t('Counts toward the end-of-service wage')}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('Remove allowance')}
                    onClick={() =>
                      set({ allowances: value.allowances.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set({ allowances: [...value.allowances, newAllowance()] })}
            >
              <Plus /> {t('Add allowance')}
            </Button>
          </div>

          <dl className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-600">{t('Monthly pay')}</dt>
              <dd className="tabular font-semibold text-slate-900">{fmt.money(totalPay)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-600">{t('Wage for end of service')}</dt>
              <dd className="tabular font-semibold text-slate-900">{fmt.money(wage)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Section title={t('Bank account')} description={t('Where the salary is paid.')}>
        <Field
          label={t('IBAN')}
          optional
          className="sm:col-span-2"
          error={errors.iban}
          hint={bank ? t('{bank} account', { bank: bank.name[language] }) : undefined}
        >
          {(id) => (
            <Input
              id={id}
              value={value.iban}
              onChange={(e) => {
                const iban = e.target.value.toUpperCase();
                const found = bankFromIban(iban);
                set({ iban, ...(found ? { bank: found.code } : {}) });
              }}
              onBlur={() => {
                if (isValidIban(value.iban)) set({ iban: formatIban(value.iban) });
              }}
              aria-invalid={Boolean(errors.iban)}
              placeholder="KW00 XXXX 0000 0000 0000 0000 0000 00"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="font-mono"
            />
          )}
        </Field>
        <Field
          label={t('Account or salary card number')}
          optional
          hint={
            value.accountNumber?.trim() && value.iban.trim()
              ? t('The IBAN is used for salaries while there is one.')
              : t('For salaries paid to a salary card or an account without an IBAN.')
          }
        >
          {(id) => (
            <Input
              id={id}
              value={value.accountNumber ?? ''}
              onChange={(e) => set({ accountNumber: e.target.value })}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="font-mono"
            />
          )}
        </Field>
        <Field label={t('Bank')} optional>
          {(id) => (
            <Select id={id} value={value.bank} onChange={(e) => set({ bank: e.target.value })}>
              <option value="">{t('Choose a bank…')}</option>
              {value.bank && !KUWAIT_BANKS.some((b) => b.code === value.bank) ? (
                <option value={value.bank}>{value.bank}</option>
              ) : null}
              {KUWAIT_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name[language]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Section>

      <Card>
        <CardHeader title={t('Status')} />
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <p id={statusLabel} className="text-sm font-medium text-slate-700">
              {t('Employment status')}
            </p>
            <div role="group" aria-labelledby={statusLabel}>
              <Segmented
                value={value.status}
                onChange={(status) => set({ status })}
                options={STATUSES.map((s) => ({ value: s, label: t(STATUS_LABELS[s]) }))}
              />
            </div>
          </div>
          {value.status === 'left' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t('Leaving date')} error={errors.leavingDate}>
                {(id) => (
                  <DateField
                    id={id}
                    value={value.leavingDate ?? ''}
                    onChange={(iso) => set({ leavingDate: iso || null })}
                    aria-invalid={Boolean(errors.leavingDate)}
                  />
                )}
              </Field>
              <Field label={t('Reason for leaving')} error={errors.leavingReason}>
                {(id) => (
                  <Select
                    id={id}
                    value={value.leavingReason ?? ''}
                    onChange={(e) =>
                      set({ leavingReason: (e.target.value || null) as LeavingReason | null })
                    }
                    aria-invalid={Boolean(errors.leavingReason)}
                    required
                  >
                    <option value="">{t('Choose a reason')}</option>
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {t(LEAVING_REASON_LABELS[r])}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          ) : null}
          <Field label={t('Notes')} optional hint={t('Internal, never printed.')}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={value.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('Personnel file')}
          description={t(
            'Keep copies of the contract, work permit and Civil ID here (Labour Law art. 80).',
          )}
        />
        <CardBody>
          <FileList
            files={files.files}
            onAdd={files.add}
            onRemove={(f) => files.remove(f.id)}
            emptyText={t('No files yet.')}
          />
        </CardBody>
      </Card>
    </div>
  );
}
