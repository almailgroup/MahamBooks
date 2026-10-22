import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  LayoutList,
  ListChecks,
  MoreHorizontal,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  approvePayRun,
  deletePayRun,
  payPayRun,
  refreshPayRun,
  reopenPayRun,
  undoPayRunPayment,
  payrollAccount,
  updatePayRun,
} from '@/db/payroll';
import { accountingSettings } from '@/db/chart-setup';
import type { ManualJournal, PayLine } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  addPeriods,
  calculatePayLine,
  formatPeriod,
  payDateFor,
  payLineWarnings,
  payRunTotals,
} from '@/lib/hr/payroll';
import { employeesNeedingLeaveOpening } from '@/lib/hr/leave';
import { departmentLabel } from '@/lib/hr/departments';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { cn } from '@/lib/cn';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import {
  useAccounts,
  useLeaveRecords,
  usePayrollSettings,
  useStaffLoans,
} from '@/features/payroll/hooks';
import { LeaveOpeningsDialog } from '@/features/payroll/leave-openings-dialog';
import { PayLineDialog } from '@/features/payroll/line-dialog';
import { SalaryFileDialog } from '@/features/payroll/salary-file-dialog';
import { AmountRow, PayDialog, RunStatusBadge, useWarningText } from '@/features/payroll/shared';
import { PayrollApprovalStrip, usePayrollApproval } from '@/features/payroll/approval-panel';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner, Stat } from '@/components/ui/misc';
import { Field, Select } from '@/components/ui/form';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { DateField } from '@/components/ui/date-field';

function EntryLink({ journal, label }: { journal: ManualJournal | undefined; label: string }) {
  const fmt = useFormat();
  if (!journal) return null;
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <Link
        to={`/journals/${journal.id}`}
        className="text-primary-700 font-medium whitespace-nowrap hover:underline"
      >
        {journal.number} · {fmt.date(journal.date)}
      </Link>
    </li>
  );
}

export default function PayRunPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  // A link with ?company= (the approval emails) is opened by CompanyOfLink, above the gate.
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const { language } = useLanguage();
  const warningText = useWarningText();
  const run = useLiveQuery(() => db.payRuns.get(id), [id]);
  const settings = usePayrollSettings();
  const people = usePeopleSettings();
  const employees = useEmployees();
  const accounts = useAccounts();
  const loans = useStaffLoans();
  const leaveRecords = useLeaveRecords();
  const journals = useLiveQuery(async () => {
    if (!run) return [];
    const ids = [run.journalId, run.provisionJournalId, run.paymentJournalId].filter(
      (x): x is string => Boolean(x),
    );
    return (await db.journals.bulkGet(ids)).filter((j): j is ManualJournal => Boolean(j));
  }, [run]);
  // Salary approval by the Super Admin (#10), once the owner turned it on.
  const approval = usePayrollApproval(run);
  const [lineId, setLineId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'pay' | 'file' | 'openings' | null>(null);
  const [busy, setBusy] = useState(false);

  if (
    run === undefined ||
    !settings ||
    !people ||
    !employees ||
    !accounts ||
    !loans ||
    !leaveRecords ||
    !journals
  ) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!run || run.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This pay run could not be found.')}</p>
        <Link to="/payroll" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to payroll')}
        </Link>
      </Card>
    );
  }

  const precision = currencyPrecision(company.currency);
  const month = formatPeriod(run.period, fmt.locale);
  const totals = payRunTotals(run.lines, precision);
  const warnings = run.lines
    .map((line) => ({ line, list: payLineWarnings(line, run.rules, precision) }))
    .filter((x) => x.list.length > 0);
  const line = run.lines.find((l) => l.id === lineId) ?? null;
  const earned = fromMinor(
    run.lines.reduce(
      (sum, l) => sum + toMinor(l.basic, precision) + toMinor(l.allowanceTotal, precision),
      0,
    ),
    precision,
  );
  const pifssDue = payDateFor(addPeriods(run.period, 1), people.pifssDueDay);
  const pifssTotal = totals.pifssEmployee + totals.pifssEmployer;
  const deductionDefault = payrollAccount(
    accounts,
    settings,
    'otherDeductions',
    accountingSettings(company).template,
  );
  const byId = (journalId: string | null) => journals.find((j) => j.id === journalId);
  // Staff whose leave before they were added here isn't known: those without
  // an opening balance, and imported staff whose balance nobody has checked yet.
  const inRun = new Set(run.lines.map((l) => l.employeeId));
  const needing = employeesNeedingLeaveOpening(
    employees.filter((e) => inRun.has(e.id)),
    leaveRecords,
  ).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const noOpening = needing.filter((e) => !e.leaveOpening);
  const unconfirmed = needing.filter((e) => e.leaveOpening && !e.leaveOpening.confirmed);
  const noOpeningText = tp(
    noOpening.length,
    '{count} employee has no opening leave balance: their leave is counted from their hire date.',
    '{count} employees have no opening leave balance: their leave is counted from their hire date.',
  );
  const unconfirmedText = tp(
    unconfirmed.length,
    '{count} employee in this pay run has leave brought forward that isn’t confirmed: their leave provision counts from the import date, with 0 days before it.',
    '{count} employees in this pay run have leave brought forward that isn’t confirmed: their leave provision counts from the import date, with 0 days before it.',
  );

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    const posted = t(
      'Salaries, PIFSS and deductions are posted to the books on {date}. You can reopen the pay run until it is paid.',
      { date: fmt.date(run.date) },
    );
    // PIFSS shares the month's pay doesn't cover: owed by the employees.
    const owed = run.lines
      .map((l) => calculatePayLine(l, run.rules, precision))
      .flatMap((l) => payLineWarnings(l, run.rules, precision))
      .filter((w) => w.code === 'pifss_owed');
    const ok = await confirm({
      title: t('Approve the payroll for {month}?', { month }),
      description:
        needing.length > 0 || owed.length > 0 ? (
          <div className="space-y-2">
            <p>{posted}</p>
            {owed.map((w, i) => (
              <p key={i} className="text-amber-800">
                {warningText(w)}
              </p>
            ))}
            {noOpening.length > 0 ? <p className="text-amber-800">{noOpeningText}</p> : null}
            {unconfirmed.length > 0 ? <p className="text-amber-800">{unconfirmedText}</p> : null}
          </div>
        ) : (
          posted
        ),
      confirmLabel: t('Approve'),
    });
    if (ok) await act(() => approvePayRun(run.id), t('Payroll for {month} approved', { month }));
  };
  const reopen = async () => {
    const ok = await confirm({
      title: t('Reopen the payroll for {month}?', { month }),
      description: t('Its entries are reversed so you can change it and approve it again.'),
      confirmLabel: t('Reopen'),
    });
    if (ok) await act(() => reopenPayRun(run.id), t('Pay run reopened'));
  };
  const undoPayment = async () => {
    const ok = await confirm({
      title: t('Undo the payment?'),
      description: t('The payment entry is reversed and the pay run goes back to approved.'),
      confirmLabel: t('Undo payment'),
      danger: true,
    });
    if (ok) await act(() => undoPayRunPayment(run.id), t('Payment undone'));
  };
  const remove = async () => {
    const ok = await confirm({
      title: t('Delete this draft?'),
      description: t('Nothing was posted for it. You can prepare the month again later.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePayRun(run.id);
      toast.success(t('Draft deleted'));
      navigate('/payroll');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('Something went wrong.'));
    }
  };

  const menu = (
    <DropdownMenu>
      <DropdownTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('More actions')}>
          <MoreHorizontal />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        {run.status === 'draft' ? (
          <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
            {t('Delete draft')}
          </DropdownItem>
        ) : null}
        {run.status === 'approved' ? (
          <DropdownItem icon={<RotateCcw />} onSelect={() => void reopen()}>
            {t('Reopen')}
          </DropdownItem>
        ) : null}
        {run.status === 'paid' ? (
          <DropdownItem icon={<Undo2 />} danger onSelect={() => void undoPayment()}>
            {t('Undo payment')}
          </DropdownItem>
        ) : null}
      </DropdownContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/payroll" className="hover:text-slate-700">
              {t('Payroll')}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t('Payroll for {month}', { month })}
            </h1>
            <RunStatusBadge status={run.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {tp(run.lines.length, '{count} employee', '{count} employees')} ·{' '}
            {run.status === 'paid' && run.paidOn
              ? t('Paid on {date}', { date: fmt.date(run.paidOn) })
              : t('Pay date {date}', { date: fmt.date(run.payDate) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.status === 'draft' ? (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  void act(() => refreshPayRun(run.id), t('Pay run updated from the records'))
                }
                disabled={busy}
              >
                <RefreshCw /> {t('Update from records')}
              </Button>
              <ButtonLink to={`/payroll/runs/${run.id}/summary`} variant="outline">
                <LayoutList /> {t('Register by department')}
              </ButtonLink>
              <Button
                onClick={() => void approve()}
                loading={busy}
                // With salary approval on, once the Super Admin approved it (the strip says why).
                disabled={!approval.postable}
              >
                <CheckCircle2 /> {t('Approve')}
              </Button>
            </>
          ) : (
            <>
              <ButtonLink to={`/payroll/runs/${run.id}/payslips`} variant="outline">
                <Printer /> {t('Payslips')}
              </ButtonLink>
              <ButtonLink to={`/payroll/runs/${run.id}/summary`} variant="outline">
                <LayoutList /> {t('Register by department')}
              </ButtonLink>
              <Button variant="outline" onClick={() => setDialog('file')}>
                <FileSpreadsheet /> {t('Salary file')}
              </Button>
              {run.status === 'approved' ? (
                <Button onClick={() => setDialog('pay')}>
                  <Wallet /> {t('Record payment')}
                </Button>
              ) : null}
            </>
          )}
          {menu}
        </div>
      </div>

      <PayrollApprovalStrip run={run} view={approval} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label={t('Gross pay')}
          value={<span className="tabular text-xl sm:text-2xl">{fmt.money(totals.gross)}</span>}
        />
        <Stat
          label={t('Deductions')}
          value={
            <span className="tabular text-xl sm:text-2xl">{fmt.money(totals.deductions)}</span>
          }
        />
        <Stat
          label={t('Net pay')}
          value={<span className="tabular text-xl sm:text-2xl">{fmt.money(totals.net)}</span>}
          tone="success"
        />
        <Stat
          label={t('Cost to the company')}
          value={<span className="tabular text-xl sm:text-2xl">{fmt.money(totals.cost)}</span>}
          hint={t('With the employer’s PIFSS share')}
        />
      </div>

      {run.status === 'draft' && needing.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" aria-hidden />
                {t('Opening leave balances')}
              </span>
            }
            description={
              <span className="space-y-1">
                {noOpening.length > 0 ? <span className="block">{noOpeningText}</span> : null}
                {unconfirmed.length > 0 ? <span className="block">{unconfirmedText}</span> : null}
              </span>
            }
            actions={
              <Button variant="outline" size="sm" onClick={() => setDialog('openings')}>
                <ListChecks /> {t('Set opening leave balances')}
              </Button>
            }
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 text-sm">
            {needing.slice(0, 12).map((e) => (
              <li key={e.id}>
                <Link
                  to={`/employees/${e.id}?tab=leave`}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {localName(e)}
                </Link>
              </li>
            ))}
            {needing.length > 12 ? (
              <li className="text-slate-500">
                {tp(needing.length - 12, 'and {count} more', 'and {count} more')}
              </li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {warnings.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-500" aria-hidden />
                {t('Check before paying')}
              </span>
            }
          />
          <ul className="divide-y divide-amber-100">
            {warnings.map(({ line: l, list }) => (
              <li key={l.id} className="px-5 py-3 text-sm">
                <button
                  type="button"
                  className="font-medium text-slate-900 hover:underline"
                  onClick={() => setLineId(l.id)}
                >
                  {localName(l)}
                </button>
                <ul className="mt-1 space-y-0.5 text-amber-800">
                  {list.map((w, i) => (
                    <li key={i}>{warningText(w)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('Employees')}
            description={
              run.status === 'draft'
                ? t('Select an employee to add overtime, absence, additions or deductions.')
                : undefined
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <th className="px-5 py-3 text-start">{t('Employee')}</th>
                  <th className="hidden px-3 py-3 text-start lg:table-cell">{t('Department')}</th>
                  <th className="hidden px-3 py-3 text-end md:table-cell">{t('Earnings')}</th>
                  <th className="hidden px-3 py-3 text-end sm:table-cell">{t('Gross pay')}</th>
                  <th className="hidden px-3 py-3 text-end md:table-cell">{t('Deductions')}</th>
                  <th className="px-5 py-3 text-end">{t('Net pay')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {run.lines.map((l: PayLine) => {
                  const flagged = warnings.some((w) => w.line.id === l.id);
                  const deductions = fromMinor(
                    toMinor(l.pifssEmployee, precision) -
                      toMinor(l.pifssOwed ?? 0, precision) +
                      toMinor(l.loanDeduction, precision) +
                      toMinor(l.otherDeductions, precision),
                    precision,
                  );
                  return (
                    <tr
                      key={l.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setLineId(l.id)}
                    >
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          className="hover:text-primary-700 text-start font-medium text-slate-900"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLineId(l.id);
                          }}
                        >
                          {localName(l)}
                        </button>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span>{l.number}</span>
                          {l.daysWorked < l.daysInMonth ? (
                            <span>
                              {t('{days} of {total} days', {
                                days: l.daysWorked,
                                total: l.daysInMonth,
                              })}
                            </span>
                          ) : null}
                          {flagged ? (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle className="size-3" aria-hidden />
                              {t('Check')}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell" dir="auto">
                        {departmentLabel(people?.departments, l.department, language) || '—'}
                      </td>
                      <td className="tabular hidden px-3 py-3 text-end text-slate-700 md:table-cell">
                        {fmt.money(l.basic + l.allowanceTotal)}
                        {l.overtimePay + l.additions > 0 ? (
                          <span className="block text-xs text-slate-500">
                            +{fmt.money(l.overtimePay + l.additions)}
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular hidden px-3 py-3 text-end text-slate-700 sm:table-cell">
                        {fmt.money(l.gross)}
                      </td>
                      <td className="tabular hidden px-3 py-3 text-end text-slate-700 md:table-cell">
                        {deductions > 0 ? `−${fmt.money(deductions)}` : '—'}
                      </td>
                      <td
                        className={cn(
                          'tabular px-5 py-3 text-end font-medium',
                          l.net < 0 ? 'text-red-600' : 'text-slate-900',
                        )}
                      >
                        {fmt.money(l.net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/60 font-semibold text-slate-900">
                  <td className="px-5 py-3">{t('Total')}</td>
                  <td className="hidden lg:table-cell" />
                  <td className="tabular hidden px-3 py-3 text-end md:table-cell">
                    {fmt.money(earned)}
                  </td>
                  <td className="tabular hidden px-3 py-3 text-end sm:table-cell">
                    {fmt.money(totals.gross)}
                  </td>
                  <td className="tabular hidden px-3 py-3 text-end md:table-cell">
                    {fmt.money(totals.deductions)}
                  </td>
                  <td className="tabular px-5 py-3 text-end">{fmt.money(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          {run.status !== 'paid' ? (
            <Card>
              <CardBody>
                <Field
                  label={t('Pay date')}
                  hint={t('Wages are due within 7 days of the end of the month (art. 56).')}
                >
                  {(fieldId) => (
                    <DateField
                      id={fieldId}
                      value={run.payDate}
                      onChange={(iso) =>
                        iso &&
                        void updatePayRun(run.id, { payDate: iso }).catch((err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                        )
                      }
                    />
                  )}
                </Field>
              </CardBody>
            </Card>
          ) : null}

          {run.status === 'draft' && totals.otherDeductions > 0 ? (
            <Card>
              <CardBody>
                <Field
                  label={t('Other deductions go to')}
                  hint={t('Fines and recoveries of {amount} this month.', {
                    amount: fmt.money(totals.otherDeductions),
                  })}
                >
                  {(fieldId) => (
                    <Select
                      id={fieldId}
                      value={run.deductionAccountId ?? ''}
                      onChange={(e) =>
                        void updatePayRun(run.id, {
                          deductionAccountId: e.target.value || null,
                        }).catch((err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                        )
                      }
                    >
                      <option value="">
                        {deductionDefault
                          ? `${deductionDefault.code} ${localName(deductionDefault)}`
                          : t('Default account')}
                      </option>
                      {accounts
                        .filter((a) => !a.archived && a.id !== deductionDefault?.id)
                        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {localName(a)}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title={t('PIFSS')}
              description={t('Pay by {date}.', { date: fmt.date(pifssDue) })}
            />
            <CardBody className="py-2">
              <dl className="divide-y divide-slate-100">
                <AmountRow label={t('Employee share')} value={fmt.money(totals.pifssEmployee)} />
                <AmountRow label={t('Employer share')} value={fmt.money(totals.pifssEmployer)} />
                <AmountRow strong label={t('Total due')} value={fmt.money(pifssTotal)} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('In the books')} />
            <CardBody className="py-2">
              {run.status === 'draft' ? (
                <p className="py-2 text-sm text-slate-500">
                  {t('Nothing is posted until the pay run is approved.')}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  <EntryLink journal={byId(run.journalId)} label={t('Salaries')} />
                  <EntryLink journal={byId(run.provisionJournalId)} label={t('Provisions')} />
                  <EntryLink journal={byId(run.paymentJournalId)} label={t('Payment')} />
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {line ? (
        <PayLineDialog run={run} line={line} loans={loans} onClose={() => setLineId(null)} />
      ) : null}
      {dialog === 'pay' ? (
        <PayDialog
          title={t('Pay the salaries for {month}', { month })}
          description={t('Records the transfer from the bank: Dr salaries payable, Cr bank.')}
          amount={totals.net}
          defaultDate={run.payDate}
          defaultAccountId={settings.bankAccountId}
          accounts={accounts}
          onPay={async (input) => {
            await payPayRun(run.id, input);
            toast.success(t('Salaries for {month} paid', { month }));
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'file' ? (
        <SalaryFileDialog run={run} settings={settings} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'openings' ? <LeaveOpeningsDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
