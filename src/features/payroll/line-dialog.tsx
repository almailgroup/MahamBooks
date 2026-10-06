import { useMemo, useState } from 'react';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { LoanRecovery, PayAdjustment, PayLine, PayRun, StaffLoan } from '@/db/types';
import { updatePayLine } from '@/db/payroll';
import {
  calculatePayLine,
  dailyRate,
  formatPeriod,
  lineLeave,
  payLineWarnings,
  rateWage,
} from '@/lib/hr/payroll';
import { currencyPrecision } from '@/lib/money';
import { shortId } from '@/lib/ids';
import { useFormat } from '@/app/company';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { AmountRow, WarningList } from './shared';

/** One employee's pay in a run: what was entered and how it adds up. */
export function PayLineDialog({
  run,
  line,
  loans,
  onClose,
}: {
  run: PayRun;
  line: PayLine;
  loans: StaffLoan[];
  onClose: () => void;
}) {
  const fmt = useFormat();
  const precision = currencyPrecision(fmt.currency);
  const editable = run.status === 'draft';
  const [overtime, setOvertime] = useState(line.overtime);
  const [absentDays, setAbsentDays] = useState(line.absentDays);
  const [adjustments, setAdjustments] = useState<PayAdjustment[]>(line.adjustments);
  const [recoveries, setRecoveries] = useState<LoanRecovery[]>(line.loans);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const result = useMemo(
    () =>
      calculatePayLine(
        { ...line, overtime, absentDays, adjustments, loans: recoveries },
        run.rules,
        precision,
      ),
    [line, overtime, absentDays, adjustments, recoveries, run.rules, precision],
  );
  const warnings = payLineWarnings(result, run.rules, precision);
  const daily = dailyRate(rateWage(line, run.rules), run.rules.dailyDivisor).toNumber();
  const leave = lineLeave(line);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updatePayLine(run.id, line.id, {
        overtime,
        absentDays,
        adjustments,
        loans: recoveries,
      });
      toast.success(t('Pay of {name} updated', { name: localName(line) }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save the changes.'));
      setBusy(false);
    }
  };

  const setAdjustment = (id: string, patch: Partial<PayAdjustment>) =>
    setAdjustments((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const partMonth = line.daysWorked < line.daysInMonth;
  const job = localName({ name: line.jobTitle, nameAr: line.jobTitleAr });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={localName(line)}
        description={[line.number, job].filter(Boolean).join(' · ')}
        size="xl"
      >
        <DialogBody className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-3">
            {partMonth ? (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                {t('Paid for {days} of {total} days this month.', {
                  days: line.daysWorked,
                  total: line.daysInMonth,
                })}
              </p>
            ) : null}
            <fieldset disabled={!editable} className="space-y-5">
              <div>
                <legend className="text-sm font-semibold text-slate-900">
                  {t('Overtime hours')}
                </legend>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t('Hourly rate {rate}: the daily rate over 8 hours.', {
                    rate: fmt.money(daily / 8),
                  })}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                  <Field label={t('Working days (+25%)')}>
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={overtime.normal}
                        onValueChange={(normal) => setOvertime((o) => ({ ...o, normal }))}
                        allowNegative={false}
                        blankZero
                      />
                    )}
                  </Field>
                  <Field label={t('Rest days (+50%)')}>
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={overtime.restDay}
                        onValueChange={(restDay) => setOvertime((o) => ({ ...o, restDay }))}
                        allowNegative={false}
                        blankZero
                      />
                    )}
                  </Field>
                  <Field label={t('Public holidays (double)')}>
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={overtime.holiday}
                        onValueChange={(holiday) => setOvertime((o) => ({ ...o, holiday }))}
                        allowNegative={false}
                        blankZero
                      />
                    )}
                  </Field>
                </div>
              </div>

              <div>
                <Field
                  label={t('Unpaid absence (days)')}
                  hint={t('Deducted at the daily rate of {rate}.', { rate: fmt.money(daily) })}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={absentDays}
                      onValueChange={setAbsentDays}
                      allowNegative={false}
                      blankZero
                      className="sm:max-w-40"
                    />
                  )}
                </Field>
                {leave.unpaidDays > 0 || leave.reducedPay.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {leave.unpaidDays > 0 ? (
                      <li>
                        {leave.calendar
                          ? t('From leave records: {days} calendar days without pay.', {
                              days: fmt.quantity(leave.unpaidDays),
                            })
                          : t('From leave records: {days} working days without pay.', {
                              days: fmt.quantity(leave.unpaidDays),
                            })}
                      </li>
                    ) : null}
                    {leave.reducedPay.map((r) => (
                      <li key={r.percent}>
                        {leave.calendar
                          ? t(
                              'From leave records: {days} calendar days of sick leave at {percent} pay.',
                              { days: fmt.quantity(r.days), percent: fmt.percent(r.percent) },
                            )
                          : t(
                              'From leave records: {days} working days of sick leave at {percent} pay.',
                              { days: fmt.quantity(r.days), percent: fmt.percent(r.percent) },
                            )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {recoveries.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-900">{t('Loan instalments')}</p>
                  {recoveries.map((r) => {
                    const loan = loans.find((l) => l.id === r.loanId);
                    return (
                      <Field
                        key={r.loanId}
                        label={
                          loan?.payRunId
                            ? t('PIFSS share owed from {month}', {
                                month: formatPeriod(loan.date.slice(0, 7), fmt.locale),
                              })
                            : loan
                              ? t('Loan of {amount} from {date}', {
                                  amount: fmt.money(loan.amount),
                                  date: fmt.date(loan.date),
                                })
                              : t('Loan')
                        }
                      >
                        {(id) => (
                          <NumberInput
                            id={id}
                            value={r.amount}
                            onValueChange={(amount) =>
                              setRecoveries((list) =>
                                list.map((x) => (x.loanId === r.loanId ? { ...x, amount } : x)),
                              )
                            }
                            allowNegative={false}
                            className="sm:max-w-40"
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              ) : null}

              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-900">
                  {t('Additions and deductions')}
                </p>
                {adjustments.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {t('Bonuses, commissions, fines or other one-off amounts.')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {adjustments.map((a) => (
                      <li
                        key={a.id}
                        className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[9rem_8rem_1fr_auto]"
                      >
                        <Select
                          value={a.type}
                          onChange={(e) =>
                            setAdjustment(a.id, {
                              type: e.target.value === 'deduction' ? 'deduction' : 'addition',
                            })
                          }
                          aria-label={t('Type')}
                        >
                          <option value="addition">{t('Addition')}</option>
                          <option value="deduction">{t('Deduction')}</option>
                        </Select>
                        <div className="sm:order-none">
                          <NumberInput
                            value={a.amount}
                            onValueChange={(amount) => setAdjustment(a.id, { amount })}
                            allowNegative={false}
                            blankZero
                            aria-label={t('Amount')}
                          />
                        </div>
                        <Input
                          value={a.note}
                          onChange={(e) => setAdjustment(a.id, { note: e.target.value })}
                          placeholder={t('Note')}
                          aria-label={t('Note')}
                          className="col-span-2 sm:col-span-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
                          aria-label={t('Remove')}
                          onClick={() =>
                            setAdjustments((list) => list.filter((x) => x.id !== a.id))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {editable ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAdjustments((list) => [
                        ...list,
                        { id: shortId(), type: 'addition', amount: 0, note: '' },
                      ])
                    }
                  >
                    <Plus /> {t('Add an addition or deduction')}
                  </Button>
                ) : null}
              </div>
            </fieldset>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-4 py-2">
              <AmountRow label={t('Basic salary')} value={fmt.money(result.basic)} />
              {result.allowances.map((a) => (
                <AmountRow key={a.id} label={localName(a)} value={fmt.money(a.amount)} />
              ))}
              {result.overtimePay > 0 ? (
                <AmountRow label={t('Overtime')} value={fmt.money(result.overtimePay)} />
              ) : null}
              {result.additions > 0 ? (
                <AmountRow label={t('Additions')} value={fmt.money(result.additions)} />
              ) : null}
              {result.absenceDeduction > 0 ? (
                <AmountRow
                  label={t('Unpaid days')}
                  value={`−${fmt.money(result.absenceDeduction)}`}
                />
              ) : null}
              <AmountRow strong label={t('Gross pay')} value={fmt.money(result.gross)} />
              {result.pifssEmployee > 0 ? (
                <AmountRow
                  label={t('PIFSS – employee share')}
                  value={`−${fmt.money(result.pifssEmployee)}`}
                />
              ) : null}
              {result.pifssOwed ? (
                <AmountRow
                  label={t('Owed by the employee, not covered by this month’s pay')}
                  value={`+${fmt.money(result.pifssOwed)}`}
                />
              ) : null}
              {result.loanDeduction > 0 ? (
                <AmountRow
                  label={t('Loan recovery')}
                  value={`−${fmt.money(result.loanDeduction)}`}
                />
              ) : null}
              {result.otherDeductions > 0 ? (
                <AmountRow
                  label={t('Other deductions')}
                  value={`−${fmt.money(result.otherDeductions)}`}
                />
              ) : null}
              <AmountRow strong label={t('Net pay')} value={fmt.money(result.net)} />
              {result.pifssEmployer > 0 ? (
                <AmountRow
                  muted
                  label={t('PIFSS – employer share')}
                  value={fmt.money(result.pifssEmployer)}
                />
              ) : null}
            </dl>
            <WarningList warnings={warnings} />
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          {editable ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button onClick={() => void save()} loading={busy}>
                {t('Save')}
              </Button>
            </>
          ) : (
            <>
              <ButtonLink
                variant="outline"
                to={`/payroll/runs/${run.id}/payslips?employee=${line.employeeId}`}
              >
                <Printer /> {t('Payslip')}
              </ButtonLink>
              <Button onClick={onClose}>{t('Close')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
