import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Employee, ID, LeaveRecord, LeaveType } from '@/db/types';
import { companyDayOff, createLeaveRecord, saveLeaveRecord } from '@/db/payroll';
import {
  accrualOptions,
  countLeaveDays,
  DEFAULT_LEAVE_POLICY,
  employeeLeaveBalance,
  FIRST_YEAR_MONTHS,
  leaveCounting,
  leaveReasonPay,
  LEAVE_TYPE_ORDER,
  LEAVE_TYPES,
  leaveWarnings,
  reasonBalance,
  reasonDaysInYear,
  reasonOf,
  reasonsFor,
  type LeaveWarning,
} from '@/lib/hr/leave';
import { isCurrent } from '@/lib/hr/employees';
import { today } from '@/lib/dates';
import { useCompany, useFormat } from '@/app/company';
import { Button } from '@/components/ui/button';
import { Field, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { AlertTriangle } from 'lucide-react';
import { DateField } from '@/components/ui/date-field';
import { usePayrollSettings } from './hooks';

/** When a new employee can take annual leave, after the policy's months of service. */
export function firstLeaveText(date: string, months: number): string {
  return months === FIRST_YEAR_MONTHS
    ? t('Annual leave can be taken from {date}, after nine months of service.', { date })
    : tp(
        months,
        'Annual leave can be taken from {date}, after {count} month of service.',
        'Annual leave can be taken from {date}, after {count} months of service.',
        { date },
      );
}

function useLeaveWarningText(firstYearMonths: number) {
  const fmt = useFormat();
  return (w: LeaveWarning) => {
    switch (w.code) {
      case 'over_balance':
        return t('More than the annual leave balance of {days} days.', {
          days: fmt.quantity(w.balance),
        });
      case 'not_eligible':
        return firstLeaveText(fmt.date(w.date), firstYearMonths);
      case 'over_limit':
        return t('More than the {days} days allowed.', { days: w.limit });
      case 'hajj_taken':
        return t('Hajj leave is given once during the service.');
      case 'overlap':
        return t('Overlaps other leave of this employee.');
      case 'over_year_max':
        return t('More than the {days} days a year this reason allows ({taken} taken this year).', {
          days: fmt.quantity(w.limit),
          taken: fmt.quantity(w.taken),
        });
      case 'over_reason_balance':
        return t('More than the {days} days added for this reason.', {
          days: fmt.quantity(w.balance),
        });
    }
  };
}

/** The value of the "Type of leave" choice: one of the six types, or a company's reason. */
const typeChoice = (type: LeaveType) => `type:${type}`;
const reasonChoice = (id: ID) => `reason:${id}`;

/**
 * Records leave, or sets or adjusts an annual leave balance ("balance" mode).
 * With the company's leave reasons switched on, leave can be recorded with
 * one of them; with `reasonId`, "balance" mode adds days to that reason's own
 * balance (compensatory days).
 */
export function LeaveDialog({
  employees,
  employeeId,
  records,
  mode = 'leave',
  reasonId,
  onClose,
}: {
  employees: Employee[];
  employeeId?: ID;
  records: LeaveRecord[];
  mode?: 'leave' | 'balance';
  /** In "balance" mode, the reason whose own balance changes. */
  reasonId?: ID;
  onClose: () => void;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const settings = usePayrollSettings();
  const policy = settings?.leavePolicy;
  const warningText = useLeaveWarningText((policy ?? DEFAULT_LEAVE_POLICY).firstYearMonths);
  const choices = employees.filter((e) => isCurrent(e) || e.id === employeeId);
  const [who, setWho] = useState<ID>(employeeId ?? choices[0]?.id ?? '');
  const [choice, setChoice] = useState<string>(typeChoice('annual'));
  const [kind, setKind] = useState<'opening' | 'adjustment'>(reasonId ? 'adjustment' : 'opening');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [days, setDays] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dayOff = useMemo(() => companyDayOff(company), [company]);
  const employee = employees.find((e) => e.id === who);
  const own = records.filter((r) => r.employeeId === who);

  // The company's reasons for this employee, once switched on.
  const offered = settings?.leaveReasonsOn ? reasonsFor(settings.leaveReasons, employee) : [];
  const chosen = offered.find((r) => reasonChoice(r.id) === choice) ?? null;
  const type: LeaveType = chosen
    ? chosen.base
    : (LEAVE_TYPE_ORDER.find((x) => typeChoice(x) === choice) ?? 'annual');
  // In "balance" mode, the reason whose own balance changes.
  const balanceReason = reasonId ? reasonOf({ reasonId }, settings?.leaveReasons) : null;

  const counted = mode === 'leave' ? countLeaveDays(type, start, end, dayOff, policy) : 0;
  const balance = employee
    ? employeeLeaveBalance(employee, own, start, policy, accrualOptions(settings))
    : null;
  const warnings =
    mode === 'leave'
      ? leaveWarnings(
          { id: '', type, kind: 'leave', start, end, days: counted },
          own,
          balance,
          chosen,
        )
      : [];
  const noteNeeded = mode === 'leave' && Boolean(chosen?.noteRequired);

  /** What the chosen reason does: its pay, and the balance or days a year it uses. */
  const reasonEffect = () => {
    if (!chosen) return '';
    const parts = [t(leaveReasonPay(chosen).label)];
    if (chosen.pay === 'balance') {
      const left = reasonBalance(own, chosen.id, '9999-12-31').balance;
      parts.push(t('{days} days added and not taken', { days: fmt.quantity(left) }));
    }
    if (chosen.maxDaysPerYear) {
      parts.push(
        t('{taken} of {days} days a year taken', {
          taken: fmt.quantity(reasonDaysInYear(own, chosen.id, Number(start.slice(0, 4)))),
          days: fmt.quantity(chosen.maxDaysPerYear),
        }),
      );
    }
    return parts.join(' · ');
  };

  const save = async () => {
    if (!employee) return;
    if (noteNeeded && !notes.trim()) {
      setError(t('Enter a note: {reason} needs one.', { reason: localName(chosen) }));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveLeaveRecord(
        createLeaveRecord(company.id, employee.id, {
          type: mode === 'leave' ? type : (balanceReason?.base ?? 'annual'),
          kind: mode === 'leave' ? 'leave' : kind,
          start,
          end: mode === 'leave' ? end : start,
          days,
          notes,
          ...(mode === 'leave' && chosen ? { reasonId: chosen.id } : {}),
          ...(mode === 'balance' && balanceReason ? { reasonId: balanceReason.id } : {}),
        }),
      );
      toast.success(
        mode === 'leave'
          ? t('Leave recorded for {name}', { name: localName(employee) })
          : t('Leave balance of {name} updated', { name: localName(employee) }),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save the leave.'));
      setBusy(false);
    }
  };

  // Days are counted as the company's leave policy says.
  if (!settings) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          mode === 'leave'
            ? t('Record leave')
            : balanceReason
              ? t('Add or remove days: {reason}', { reason: localName(balanceReason) })
              : t('Set the leave balance')
        }
        description={
          mode === 'leave'
            ? t('Working days skip Fridays, Saturdays and public holidays.')
            : balanceReason
              ? t(
                  'Days added by hand, such as for work on a rest day. Leave of this reason is taken from them.',
                )
              : t(
                  'Use an opening balance for staff who joined before you started here; it replaces what came before its date.',
                )
        }
      >
        <DialogBody>
          {employeeId ? null : (
            <Field label={t('Employee')}>
              {(id) => (
                <Select id={id} value={who} onChange={(e) => setWho(e.target.value)}>
                  {choices.map((e) => (
                    <option key={e.id} value={e.id}>
                      {localName(e)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {mode === 'leave' ? (
            <>
              <Field label={t('Type of leave')}>
                {(id) => (
                  <Select
                    id={id}
                    value={chosen ? choice : typeChoice(type)}
                    onChange={(e) => setChoice(e.target.value)}
                  >
                    {LEAVE_TYPE_ORDER.map((x) => (
                      <option key={x} value={typeChoice(x)}>
                        {t(LEAVE_TYPES[x].label)}
                      </option>
                    ))}
                    {offered.length > 0 ? (
                      <optgroup label={t('The company’s leave reasons')}>
                        {offered.map((r) => (
                          <option key={r.id} value={reasonChoice(r.id)}>
                            {localName(r)}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </Select>
                )}
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('First day')}>
                  {(id) => (
                    <DateField
                      id={id}
                      value={start}
                      onChange={(iso) => {
                        const value = iso;
                        if (!value) return;
                        setStart(value);
                        if (end < value) setEnd(value);
                      }}
                    />
                  )}
                </Field>
                <Field label={t('Last day')}>
                  {(id) => (
                    <DateField
                      id={id}
                      value={end}
                      min={start}
                      onChange={(iso) => iso && setEnd(iso)}
                    />
                  )}
                </Field>
              </div>
              <p
                className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
                aria-live="polite"
              >
                {leaveCounting(type, policy) === 'calendar'
                  ? tp(counted, '{count} calendar day', '{count} calendar days')
                  : tp(counted, '{count} working day', '{count} working days')}
                {type === 'annual' && balance
                  ? ` · ${t('Balance {days} days', { days: fmt.quantity(balance.balance) })}`
                  : ''}
                {chosen ? ` · ${reasonEffect()}` : ''}
              </p>
              {warnings.length > 0 ? (
                <ul className="space-y-1">
                  {warnings.map((w) => (
                    <li key={w.code} className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-amber-500"
                        aria-hidden
                      />
                      {warningText(w)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
              {balanceReason ? null : (
                <Field label={t('Change')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value === 'adjustment' ? 'adjustment' : 'opening')
                      }
                    >
                      <option value="opening">{t('Opening balance on a date')}</option>
                      <option value="adjustment">{t('Add or remove days')}</option>
                    </Select>
                  )}
                </Field>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('Date')}>
                  {(id) => (
                    <DateField id={id} value={start} onChange={(iso) => iso && setStart(iso)} />
                  )}
                </Field>
                <Field
                  label={t('Days')}
                  hint={kind === 'adjustment' ? t('Use a minus sign to remove days.') : undefined}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={days}
                      onValueChange={setDays}
                      allowNegative={kind === 'adjustment'}
                    />
                  )}
                </Field>
              </div>
            </>
          )}
          <Field
            label={t('Notes')}
            optional={!noteNeeded}
            hint={noteNeeded ? t('This reason needs a note.') : undefined}
          >
            {(id) => (
              <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!employee}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
