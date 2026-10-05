import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CalendarPlus, HandCoins, Plus, SlidersHorizontal, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import type { Employee } from '@/db/types';
import { setLeaveOpening } from '@/db/people';
import { localName } from '@/i18n/names';
import {
  cancelLeaveRecord,
  cancelStaffLoan,
  companyDayOff,
  loanBalance,
  loanRecoveredMinor,
} from '@/db/payroll';
import { employeeLeaveBalance, LEAVE_TYPES, sickDaysByTier, SICK_TIERS } from '@/lib/hr/leave';
import { formatPeriod } from '@/lib/hr/payroll';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { isCurrent } from '@/lib/hr/employees';
import { useCompany, useFormat } from '@/app/company';
import { useEmployees } from '@/features/people/hooks';
import { EosiCard } from '@/features/people/eosi-card';
import { Badge, Card, CardBody, CardHeader, EmptyState, Spinner } from '@/components/ui/misc';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/overlay';
import { t, tp } from '@/i18n';
import {
  useAccounts,
  useLeaveRecords,
  usePayrollSettings,
  usePayRuns,
  useSettlements,
  useStaffLoans,
} from './hooks';
import { LeaveDialog } from './leave-dialog';
import { LeaveOpeningDialog } from './leave-opening-dialog';
import { LoanDialog } from './loan-dialog';
import { AmountRow } from './shared';

export function LeaveTab({ employee }: { employee: Employee }) {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const records = useLeaveRecords(employee.id);
  const employees = useEmployees();
  const [dialog, setDialog] = useState<'leave' | 'balance' | 'opening' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dayOff = useMemo(() => companyDayOff(company), [company]);
  if (!records || !employees) return <Spinner className="py-12" />;
  const brought = employee.leaveOpening ?? null;

  const on = today();
  const year = Number(on.slice(0, 4));
  const balance = employeeLeaveBalance(employee, records, on);
  const sick = sickDaysByTier(records, year, dayOff);
  const list = [...records].sort(
    (a, b) => b.start.localeCompare(a.start) || b.createdAt.localeCompare(a.createdAt),
  );
  const tierLabel = (percent: number) =>
    percent === 100
      ? t('Full pay')
      : percent === 0
        ? t('Without pay')
        : t('{percent} pay', { percent: fmt.percent(percent) });

  const confirmOpening = async () => {
    if (!brought) return;
    setConfirming(true);
    try {
      await setLeaveOpening(employee.id, { date: brought.date, days: brought.days });
      toast.success(t('Leave brought forward for {name} confirmed', { name: localName(employee) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setConfirming(false);
    }
  };

  const cancel = async (id: string) => {
    const ok = await confirm({
      title: t('Cancel this leave?'),
      description: t(
        'It no longer counts against the balance or in pay runs prepared from now on.',
      ),
      confirmLabel: t('Cancel leave'),
      cancelLabel: t('Keep'),
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelLeaveRecord(id);
      toast.success(t('Leave cancelled'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t('Annual leave')}
            description={t('30 days a year, 2.5 days for each month of service (art. 70).')}
          />
          <CardBody className="space-y-3">
            <p className="tabular text-3xl font-semibold tracking-tight text-slate-900">
              {tp(balance.balance, '{count} day', '{count} days')}
            </p>
            <dl className="divide-y divide-slate-100">
              {balance.opening ? (
                <AmountRow
                  label={t('Opening balance on {date}', { date: fmt.date(balance.from) })}
                  value={fmt.quantity(balance.opening)}
                />
              ) : null}
              <AmountRow
                label={
                  balance.from
                    ? t('Earned since {date}', { date: fmt.date(balance.from) })
                    : t('Earned')
                }
                value={fmt.quantity(balance.accrued)}
              />
              {balance.adjusted ? (
                <AmountRow
                  label={t('Balance adjustments')}
                  value={fmt.quantity(balance.adjusted)}
                />
              ) : null}
              <AmountRow label={t('Taken')} value={`−${fmt.quantity(balance.taken)}`} />
            </dl>
            {brought ? (
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{t('Leave brought forward')}</p>
                  {brought.confirmed ? (
                    <Badge tone="green">{t('Confirmed')}</Badge>
                  ) : (
                    <Badge tone="amber">{t('Not confirmed')}</Badge>
                  )}
                </div>
                <p className="mt-1 text-slate-600">
                  {t('{days} days on {date}. Leave counts from this date.', {
                    days: fmt.quantity(brought.days),
                    date: fmt.date(brought.date),
                  })}
                </p>
                {brought.confirmed ? null : (
                  <p className="mt-1 text-xs text-amber-800">
                    {t(
                      'Imported with 0 days. Enter what they had left on that day, from your records before, or confirm it.',
                    )}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDialog('opening')}>
                    {t('Edit')}
                  </Button>
                  {brought.confirmed ? null : (
                    <Button size="sm" loading={confirming} onClick={() => void confirmOpening()}>
                      {t('Confirm')}
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
            {balance.eligibleFrom && on < balance.eligibleFrom ? (
              <p className="text-xs text-slate-500">
                {t('Annual leave can be taken from {date}, after nine months of service.', {
                  date: fmt.date(balance.eligibleFrom),
                })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {isCurrent(employee) ? (
                <Button onClick={() => setDialog('leave')}>
                  <CalendarPlus /> {t('Record leave')}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setDialog('balance')}>
                <SlidersHorizontal /> {t('Set the leave balance')}
              </Button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={t('Sick leave in {year}', { year })}
            description={t('Paid in tiers over the year (art. 69).')}
          />
          <CardBody className="py-2">
            <dl className="divide-y divide-slate-100">
              {SICK_TIERS.map((tier, i) => (
                <AmountRow
                  key={tier.percent}
                  label={tierLabel(tier.percent)}
                  value={t('{used} of {days} days', {
                    used: fmt.quantity(sick[i].days),
                    days: tier.days,
                  })}
                />
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t('Leave records')} />
        {list.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {t('No leave recorded yet.')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {r.kind === 'opening'
                      ? t('Opening balance')
                      : r.kind === 'adjustment'
                        ? t('Balance adjustment')
                        : t(LEAVE_TYPES[r.type].label)}
                    {r.status === 'cancelled' ? (
                      <Badge tone="slate" className="ms-2">
                        {t('Cancelled')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.kind === 'leave'
                      ? r.start === r.end
                        ? fmt.date(r.start)
                        : t('{start} to {end}', { start: fmt.date(r.start), end: fmt.date(r.end) })
                      : fmt.date(r.start)}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span
                    className={
                      r.status === 'cancelled'
                        ? 'tabular text-slate-500 line-through'
                        : 'tabular text-slate-700'
                    }
                  >
                    {tp(r.days, '{count} day', '{count} days')}
                  </span>
                  {r.status === 'approved' ? (
                    <Button variant="ghost" size="xs" onClick={() => void cancel(r.id)}>
                      {t('Cancel')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {dialog === 'opening' ? (
        <LeaveOpeningDialog employee={employee} onClose={() => setDialog(null)} />
      ) : dialog ? (
        <LeaveDialog
          employees={employees}
          employeeId={employee.id}
          records={records}
          mode={dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

export function LoansTab({ employee }: { employee: Employee }) {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const loans = useStaffLoans(employee.id);
  const runs = usePayRuns();
  const settlements = useSettlements();
  const accounts = useAccounts();
  const settings = usePayrollSettings();
  const employees = useEmployees();
  const [adding, setAdding] = useState(false);
  if (!loans || !runs || !settlements || !accounts || !settings || !employees) {
    return <Spinner className="py-12" />;
  }
  const p = currencyPrecision(company.currency);
  const list = [...loans].sort((a, b) => b.date.localeCompare(a.date));

  const cancel = async (id: string) => {
    const ok = await confirm({
      title: t('Cancel this loan?'),
      description: t(
        'Its payment is reversed in the books. Only loans with nothing recovered can be cancelled.',
      ),
      confirmLabel: t('Cancel loan'),
      cancelLabel: t('Keep'),
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelStaffLoan(id);
      toast.success(t('Loan cancelled'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    }
  };

  const add = isCurrent(employee) ? (
    <Button onClick={() => setAdding(true)}>
      <Plus /> {t('New loan')}
    </Button>
  ) : undefined;

  return (
    <div className="space-y-6">
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins />}
            title={t('No loans or advances')}
            description={t(
              'Loans are interest-free and recovered from pay in monthly instalments.',
            )}
            action={add}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title={t('Loans and advances')} actions={add} />
          <ul className="divide-y divide-slate-100">
            {list.map((loan) => {
              const balance = loanBalance(loan, runs, settlements, p);
              const recovered = fromMinor(loanRecoveredMinor(loan.id, runs, settlements, p), p);
              const left = Math.ceil(
                toMinor(balance, p) / Math.max(1, toMinor(loan.instalment, p)),
              );
              return (
                <li key={loan.id} className="space-y-2 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">
                        {t('Loan of {amount} paid on {date}', {
                          amount: fmt.money(loan.amount),
                          date: fmt.date(loan.date),
                        })}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t('{amount} a month from {month}', {
                          amount: fmt.money(loan.instalment),
                          month: formatPeriod(loan.firstPeriod, fmt.locale),
                        })}
                        {loan.notes ? ` · ${loan.notes}` : ''}
                      </p>
                    </div>
                    {loan.status === 'cancelled' ? (
                      <Badge tone="slate">{t('Cancelled')}</Badge>
                    ) : balance === 0 ? (
                      <Badge tone="green">{t('Repaid')}</Badge>
                    ) : (
                      <Badge tone="blue">{t('Active')}</Badge>
                    )}
                  </div>
                  {loan.status === 'active' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-slate-600">
                        {t('Recovered {recovered}, left {balance}', {
                          recovered: fmt.money(recovered),
                          balance: fmt.money(balance),
                        })}
                        {balance > 0
                          ? ` · ${tp(left, '{count} instalment to go', '{count} instalments to go')}`
                          : ''}
                      </p>
                      {recovered === 0 ? (
                        <Button variant="ghost" size="xs" onClick={() => void cancel(loan.id)}>
                          {t('Cancel loan')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {adding ? (
        <LoanDialog
          employees={employees}
          employeeId={employee.id}
          accounts={accounts}
          settings={settings}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

export function EndOfServiceTab({ employee, divisor }: { employee: Employee; divisor: number }) {
  const fmt = useFormat();
  const settlements = useSettlements(employee.id);
  const runs = usePayRuns();
  if (!settlements || !runs) return <Spinner className="py-12" />;
  const live = settlements.find((s) => s.status !== 'reversed');
  const withProvisions = runs.find((r) => r.status !== 'draft' && r.provisions);
  const share = withProvisions?.provisions?.find((x) => x.employeeId === employee.id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t('Final settlement')}
          description={t(
            'Indemnity, notice pay, unused leave and the last salary, less loans, with the settlement sheet and its entry.',
          )}
        />
        <CardBody>
          {live ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="tabular text-2xl font-semibold text-slate-900">
                  {fmt.money(live.net)}
                </p>
                <p className="text-sm text-slate-500">
                  {live.status === 'paid' && live.paidOn
                    ? t('Paid on {date}', { date: fmt.date(live.paidOn) })
                    : t('Posted on {date}, not paid yet', { date: fmt.date(live.leavingDate) })}
                </p>
              </div>
              <ButtonLink to={`/employees/${employee.id}/settlement`} variant="outline">
                {t('Open the settlement')}
              </ButtonLink>
            </div>
          ) : (
            <ButtonLink to={`/employees/${employee.id}/settlement`}>
              <UserMinus /> {t('Start the final settlement')}
            </ButtonLink>
          )}
        </CardBody>
      </Card>
      {withProvisions ? (
        <Card>
          <CardHeader
            title={t('Provisions in the books')}
            description={t('As at {date}, from the {month} pay run.', {
              date: fmt.date(withProvisions.date),
              month: formatPeriod(withProvisions.period, fmt.locale),
            })}
          />
          <CardBody className="py-2">
            <dl className="divide-y divide-slate-100">
              <AmountRow label={t('End-of-service indemnity')} value={fmt.money(share?.eos ?? 0)} />
              <AmountRow
                label={t('Leave salary ({days} days)', {
                  days: fmt.quantity(share?.leaveDays ?? 0),
                })}
                value={fmt.money(share?.leave ?? 0)}
              />
            </dl>
            <p className="pb-2 text-xs text-slate-500">
              <Link
                to={`/payroll/runs/${withProvisions.id}`}
                className="text-primary-700 hover:underline"
              >
                {t('Open the pay run')}
              </Link>
            </p>
          </CardBody>
        </Card>
      ) : null}
      <EosiCard employee={employee} divisor={divisor} />
    </div>
  );
}
