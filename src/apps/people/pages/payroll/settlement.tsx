import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { MoreHorizontal, Printer, Undo2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  paySettlement,
  postSettlement,
  reverseSettlement,
  settlementDefaults,
  settlementInput,
  settlementMissingText,
  settlementSetup,
  type SettlementData,
  type SettlementForm,
} from '@/db/payroll';
import type {
  Account,
  Employee,
  FinalSettlement,
  LeavingReason,
  ManualJournal,
  PayrollSettings,
  SettlementSalary,
} from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { computeSettlement, formatPeriod, periodOf } from '@/lib/hr/payroll';
import { insuredWithPifss, LEAVING_REASON_LABELS } from '@/lib/hr/employees';
import { currencyPrecision } from '@/lib/money';
import { today } from '@/lib/dates';
import { usePeopleSettings } from '@/features/people/hooks';
import {
  useAccounts,
  useLeaveRecords,
  usePayrollSettings,
  usePayRuns,
  useSettlements,
  useStaffLoans,
} from '@/features/payroll/hooks';
import { AmountRow, PayDialog } from '@/features/payroll/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { DateField } from '@/components/ui/date-field';

const REASONS = Object.keys(LEAVING_REASON_LABELS) as LeavingReason[];

interface Figures {
  indemnity: number;
  noticeMonths: number;
  noticePay: number;
  leaveDays: number;
  leavePay: number;
  lastSalary: SettlementSalary | null;
  loanRecovery: number;
  otherDeductions: number;
  net: number;
}

/** What is due and deducted on leaving, and the net amount. */
function Breakdown({ figures }: { figures: Figures }) {
  const fmt = useFormat();
  const last = figures.lastSalary;
  return (
    <dl className="divide-y divide-slate-100">
      <AmountRow label={t('End-of-service indemnity')} value={fmt.money(figures.indemnity)} />
      {figures.noticePay > 0 ? (
        <AmountRow
          label={t('Notice pay ({months} months)', { months: fmt.quantity(figures.noticeMonths) })}
          value={fmt.money(figures.noticePay)}
        />
      ) : null}
      {figures.leavePay > 0 ? (
        <AmountRow
          label={t('Unused leave ({days} days)', { days: fmt.quantity(figures.leaveDays) })}
          value={fmt.money(figures.leavePay)}
        />
      ) : null}
      {last ? (
        <AmountRow
          label={t('Last salary ({days} of {total} days)', {
            days: last.days,
            total: last.daysInMonth,
          })}
          value={fmt.money(last.gross)}
        />
      ) : null}
      {last && last.pifssEmployee > 0 ? (
        <AmountRow
          label={t('PIFSS – employee share')}
          value={`−${fmt.money(last.pifssEmployee)}`}
        />
      ) : null}
      {figures.loanRecovery > 0 ? (
        <AmountRow label={t('Loan recovery')} value={`−${fmt.money(figures.loanRecovery)}`} />
      ) : null}
      {figures.otherDeductions > 0 ? (
        <AmountRow label={t('Other deductions')} value={`−${fmt.money(figures.otherDeductions)}`} />
      ) : null}
      <AmountRow strong label={t('Net amount due')} value={fmt.money(figures.net)} />
    </dl>
  );
}

function SettlementView({
  employee,
  settlement,
  accounts,
  settings,
}: {
  employee: Employee;
  settlement: FinalSettlement;
  accounts: Account[];
  settings: PayrollSettings;
}) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const [paying, setPaying] = useState(false);
  const journals = useLiveQuery(
    async () =>
      (
        await db.journals.bulkGet(
          [settlement.journalId, settlement.paymentJournalId].filter((x): x is string =>
            Boolean(x),
          ),
        )
      ).filter((j): j is ManualJournal => Boolean(j)),
    [settlement.journalId, settlement.paymentJournalId],
  );
  const name = localName(employee);

  const undo = async () => {
    const paid = settlement.status === 'paid';
    const ok = await confirm({
      title: paid ? t('Undo the payment?') : t('Reverse the settlement?'),
      description: paid
        ? t('The payment entry is reversed and the settlement goes back to unpaid.')
        : t(
            'Its entry is reversed on the leaving date. The employee stays marked as left; you can prepare a new settlement.',
          ),
      confirmLabel: paid ? t('Undo payment') : t('Reverse'),
      danger: true,
    });
    if (!ok) return;
    try {
      await reverseSettlement(settlement.id);
      toast.success(paid ? t('Payment undone') : t('Settlement reversed'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to={`/employees/${employee.id}?tab=eos`} className="hover:text-slate-700">
              {name}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t('Final settlement')}
            </h1>
            <Badge tone={settlement.status === 'paid' ? 'green' : 'blue'}>
              {settlement.status === 'paid' ? t('Paid') : t('Not paid yet')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {t('Left on {date}', { date: fmt.date(settlement.leavingDate) })} ·{' '}
            {t(LEAVING_REASON_LABELS[settlement.reason])}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink to={`/payroll/settlements/${settlement.id}/print`} variant="outline">
            <Printer /> {t('Settlement sheet')}
          </ButtonLink>
          {settlement.status === 'posted' ? (
            <Button onClick={() => setPaying(true)}>
              <Wallet /> {t('Record payment')}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('More actions')}>
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem icon={<Undo2 />} danger onSelect={() => void undo()}>
                {settlement.status === 'paid' ? t('Undo payment') : t('Reverse the settlement')}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('Amounts')}
            description={t('{years} years of service; indemnity on a monthly wage of {wage}.', {
              years: fmt.quantity(Math.round(settlement.years * 100) / 100),
              wage: fmt.money(settlement.eosWage),
            })}
          />
          <CardBody className="py-2">
            <Breakdown
              figures={{
                ...settlement,
                loanRecovery: settlement.loans.reduce((s, l) => s + l.amount, 0),
              }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('In the books')} />
          <CardBody className="py-2">
            <ul className="divide-y divide-slate-100 text-sm">
              {(journals ?? []).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-600">
                    {j.id === settlement.paymentJournalId ? t('Payment') : t('Settlement')}
                  </span>
                  <Link
                    to={`/journals/${j.id}`}
                    className="text-primary-700 font-medium whitespace-nowrap hover:underline"
                  >
                    {j.number} · {fmt.date(j.date)}
                  </Link>
                </li>
              ))}
            </ul>
            {settlement.eosProvision > 0 || settlement.leaveProvision > 0 ? (
              <p className="py-2 text-xs text-slate-500">
                {t('Released from the provisions: {eos} end of service and {leave} leave salary.', {
                  eos: fmt.money(settlement.eosProvision),
                  leave: fmt.money(settlement.leaveProvision),
                })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
      {paying ? (
        <PayDialog
          title={t('Pay the final settlement')}
          description={name}
          amount={settlement.net}
          defaultAccountId={settings.bankAccountId}
          accounts={accounts}
          onPay={async (input) => {
            await paySettlement(settlement.id, input);
            toast.success(t('Final settlement paid'));
          }}
          onClose={() => setPaying(false)}
        />
      ) : null}
    </div>
  );
}

/** A settlement form whose reason for leaving may still have to be chosen. */
type Draft = Omit<SettlementForm, 'reason'> & { reason: LeavingReason | null };

/** The reason a settlement starts from: one someone chose; "Other" or none is asked for. */
function knownReason(employee: Employee): LeavingReason | null {
  return employee.leavingReason && employee.leavingReason !== 'other'
    ? employee.leavingReason
    : null;
}

function SettlementFormView({ employee, data }: { employee: Employee; data: SettlementData }) {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const p = currencyPrecision(company.currency);
  const start = (date: string, reason: LeavingReason | null, keep?: Draft): Draft => {
    const kept = keep
      ? {
          pifssOffset: keep.pifssOffset,
          indemnityOverride: keep.indemnityOverride,
          otherDeductions: keep.otherDeductions,
          deductionNote: keep.deductionNote,
          notes: keep.notes,
        }
      : {};
    if (!reason) {
      // Nothing is worked out until the reason is chosen: it decides the indemnity.
      return {
        employeeId: employee.id,
        leavingDate: date,
        reason: null,
        pifssOffset: 0,
        indemnityOverride: null,
        noticeMonths: 0,
        leaveDays: 0,
        lastSalaryDays: 0,
        loans: [],
        otherDeductions: 0,
        deductionNote: '',
        notes: '',
        ...kept,
      };
    }
    const defaults = settlementDefaults(
      employee,
      date,
      reason,
      settlementSetup(employee, date, data, p),
      p,
    );
    return { ...defaults, ...kept };
  };
  const [draft, setForm] = useState<Draft>(() =>
    start(employee.leavingDate ?? today(), knownReason(employee)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setup = useMemo(
    () => settlementSetup(employee, draft.leavingDate, data, p),
    [employee, draft.leavingDate, data, p],
  );
  const set = (patch: Partial<SettlementForm>) => setForm((f) => ({ ...f, ...patch }));
  const missing = settlementMissingText(employee);

  const leaving = (
    <Card>
      <CardHeader title={t('Leaving')} />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('Leaving date')}>
          {(id) => (
            <DateField
              id={id}
              value={draft.leavingDate}
              onChange={(iso) => iso && setForm((f) => start(iso, f.reason, f))}
            />
          )}
        </Field>
        <Field
          label={t('Reason')}
          error={draft.reason ? undefined : t('Choose the reason for leaving.')}
        >
          {(id) => (
            <Select
              id={id}
              value={draft.reason ?? ''}
              onChange={(e) =>
                setForm((f) =>
                  start(f.leavingDate, (e.target.value || null) as LeavingReason | null, f),
                )
              }
              aria-invalid={!draft.reason}
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
      </CardBody>
    </Card>
  );
  const header = (
    <div>
      <p className="mb-1 text-sm text-slate-500">
        <Link to={`/employees/${employee.id}?tab=eos`} className="hover:text-slate-700">
          {localName(employee)}
        </Link>
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {t('Final settlement')}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {t(
          'Everything due on leaving, worked out from the records. Check each amount before posting.',
        )}
      </p>
    </div>
  );

  if (missing) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="p-6">
          <p role="alert" className="text-sm text-red-700">
            {missing}
          </p>
          <ButtonLink to={`/employees/${employee.id}/edit`} variant="outline" className="mt-4">
            {t('Edit the employee')}
          </ButtonLink>
        </Card>
      </div>
    );
  }
  if (!draft.reason) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {leaving}
            <Card className="p-6">
              <p className="text-sm text-slate-600">
                {t(
                  'Choose the reason for leaving first: it decides the end-of-service indemnity and the notice pay.',
                )}
              </p>
            </Card>
          </div>
        </div>
      </div>
    );
  }
  const form: SettlementForm = { ...draft, reason: draft.reason };
  const amounts = computeSettlement(settlementInput(employee, form, setup, p));
  const month = formatPeriod(periodOf(form.leavingDate), fmt.locale);
  const share = amounts.eosi?.share;
  const shareText = !share
    ? ''
    : share.numerator === share.denominator
      ? t('In full')
      : share.numerator === 0
        ? t('Nothing')
        : share.numerator * 2 === share.denominator
          ? t('Half')
          : t('Two thirds');

  const post = async () => {
    const ok = await confirm({
      title: t('Post the final settlement?'),
      description: t(
        '{name} is marked as left on {date} and the settlement is posted to the books. You can reverse it while it is unpaid.',
        { name: localName(employee), date: fmt.date(form.leavingDate) },
      ),
      confirmLabel: t('Post settlement'),
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await postSettlement(form);
      toast.success(t('Final settlement posted'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {leaving}

          <Card>
            <CardHeader
              title={t('End-of-service indemnity')}
              description={
                amounts.eosi
                  ? t('Labour Law 6/2010, articles 51 and 53. An estimate, not legal advice.')
                  : t('Domestic workers: one month’s wage for each year of service (Law 68/2015).')
              }
            />
            <CardBody className="space-y-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">{t('Years of service')}</dt>
                  <dd className="tabular font-medium text-slate-900">
                    {fmt.quantity(Math.round(amounts.years * 100) / 100)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('Monthly wage')}</dt>
                  <dd className="tabular font-medium text-slate-900">
                    {fmt.money(amounts.eosWage)}
                  </dd>
                </div>
                {shareText ? (
                  <div>
                    <dt className="text-slate-500">{t('Share paid')}</dt>
                    <dd className="font-medium text-slate-900">{shareText}</dd>
                  </div>
                ) : null}
              </dl>
              {insuredWithPifss(employee.category) ? (
                <Field
                  label={t('Covered by PIFSS contributions')}
                  hint={t(
                    'For staff insured with PIFSS, the employer pays only the difference over what its contributions already cover. Enter that amount to deduct it.',
                  )}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={form.pifssOffset}
                      onValueChange={(pifssOffset) => set({ pifssOffset })}
                      allowNegative={false}
                      blankZero
                      className="sm:max-w-48"
                    />
                  )}
                </Field>
              ) : null}
              <Checkbox
                label={t('Enter the indemnity myself')}
                checked={form.indemnityOverride !== null}
                onChange={(e) =>
                  set({ indemnityOverride: e.target.checked ? amounts.indemnity : null })
                }
              />
              {form.indemnityOverride !== null ? (
                <Field label={t('Indemnity')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={form.indemnityOverride ?? 0}
                      onValueChange={(indemnityOverride) => set({ indemnityOverride })}
                      allowNegative={false}
                      className="sm:max-w-48"
                    />
                  )}
                </Field>
              ) : null}
              <p className="tabular text-lg font-semibold text-slate-900">
                {fmt.money(amounts.indemnity)}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Notice, leave and last salary')} />
            <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Field
                label={t('Notice pay (months)')}
                hint={t(
                  'When the employer ends an unlimited contract without notice: 3 months for monthly-paid staff, 1 for others (art. 44).',
                )}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={form.noticeMonths}
                    onValueChange={(noticeMonths) => set({ noticeMonths })}
                    allowNegative={false}
                  />
                )}
              </Field>
              <Field
                label={t('Unused leave (days)')}
                hint={t(
                  'Balance on the leaving date: {days} days. Paid out on leaving (art. 73).',
                  {
                    days: fmt.quantity(setup.leave.balance),
                  },
                )}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={form.leaveDays}
                    onValueChange={(leaveDays) => set({ leaveDays })}
                    allowNegative={false}
                  />
                )}
              </Field>
              <Field
                label={t('Last salary (days)')}
                hint={
                  setup.paidInRun
                    ? t('The {month} pay run already pays this month.', { month })
                    : t('Days worked in {month}.', { month })
                }
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={form.lastSalaryDays}
                    onValueChange={(lastSalaryDays) => set({ lastSalaryDays })}
                    allowNegative={false}
                    disabled={Boolean(setup.paidInRun)}
                  />
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Deductions')} />
            <CardBody className="space-y-4">
              {setup.loans.map(({ loan, balance }) => {
                const recovery = form.loans.find((l) => l.loanId === loan.id);
                return (
                  <Field
                    key={loan.id}
                    label={t('Loan of {amount} from {date}', {
                      amount: fmt.money(loan.amount),
                      date: fmt.date(loan.date),
                    })}
                    hint={t('Left on the loan: {amount}.', { amount: fmt.money(balance) })}
                  >
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={recovery?.amount ?? 0}
                        onValueChange={(amount) =>
                          set({
                            loans: [
                              ...form.loans.filter((l) => l.loanId !== loan.id),
                              { loanId: loan.id, amount },
                            ],
                          })
                        }
                        allowNegative={false}
                        className="sm:max-w-48"
                      />
                    )}
                  </Field>
                );
              })}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[12rem_1fr]">
                <Field label={t('Other deductions')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={form.otherDeductions}
                      onValueChange={(otherDeductions) => set({ otherDeductions })}
                      allowNegative={false}
                      blankZero
                    />
                  )}
                </Field>
                <Field label={t('Reason for the deduction')} optional>
                  {(id) => (
                    <Input
                      id={id}
                      value={form.deductionNote}
                      onChange={(e) => set({ deductionNote: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Field label={t('Notes')} optional>
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={form.notes}
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                )}
              </Field>
            </CardBody>
          </Card>
        </div>

        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader title={t('Settlement')} />
            <CardBody className="space-y-4 py-2">
              <Breakdown
                figures={{
                  ...amounts,
                  noticeMonths: form.noticeMonths,
                  leaveDays: form.leaveDays,
                }}
              />
              {setup.provisions.eos > 0 || setup.provisions.leave > 0 ? (
                <p className="text-xs text-slate-500">
                  {t(
                    'Releases {eos} of the end-of-service provision and {leave} of the leave provision; the difference is expensed.',
                    {
                      eos: fmt.money(setup.provisions.eos),
                      leave: fmt.money(setup.provisions.leave),
                    },
                  )}
                </p>
              ) : null}
              {amounts.net < 0 ? (
                <p role="alert" className="text-sm text-red-600">
                  {t(
                    'The deductions are more than what is due. Lower the loan recovery or other deductions.',
                  )}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              ) : null}
              <Button
                className="mb-3 w-full"
                onClick={() => void post()}
                loading={busy}
                disabled={amounts.net < 0}
              >
                {t('Post settlement')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The final settlement of an employee: the form, or the posted settlement. */
export default function SettlementPage() {
  const { id = '' } = useParams();
  const company = useCompany();
  const employee = useLiveQuery(() => db.employees.get(id), [id]);
  const settings = usePayrollSettings();
  const people = usePeopleSettings();
  const leave = useLeaveRecords(id);
  const loans = useStaffLoans(id);
  const runs = usePayRuns();
  const settlements = useSettlements();
  const accounts = useAccounts();
  const data = useMemo<SettlementData | null>(
    () =>
      settings && people && leave && loans && runs && settlements
        ? { settings, people, leave, loans, runs, settlements }
        : null,
    [settings, people, leave, loans, runs, settlements],
  );

  if (employee === undefined || !data || !accounts || !settings) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!employee || employee.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This employee could not be found.')}</p>
        <Link to="/employees" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to employees')}
        </Link>
      </Card>
    );
  }
  const live = data.settlements.find(
    (s) => s.employeeId === employee.id && s.status !== 'reversed',
  );
  return live ? (
    <SettlementView employee={employee} settlement={live} accounts={accounts} settings={settings} />
  ) : (
    <SettlementFormView key={employee.id} employee={employee} data={data} />
  );
}
