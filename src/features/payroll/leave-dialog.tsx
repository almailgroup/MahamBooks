import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Employee, ID, LeaveRecord, LeaveType } from '@/db/types';
import { companyDayOff, createLeaveRecord, saveLeaveRecord } from '@/db/payroll';
import {
  annualLeaveBalance,
  countLeaveDays,
  LEAVE_TYPE_ORDER,
  LEAVE_TYPES,
  leaveWarnings,
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

function useLeaveWarningText() {
  const fmt = useFormat();
  return (w: LeaveWarning) => {
    switch (w.code) {
      case 'over_balance':
        return t('More than the annual leave balance of {days} days.', {
          days: fmt.quantity(w.balance),
        });
      case 'not_eligible':
        return t('Annual leave can be taken from {date}, after nine months of service.', {
          date: fmt.date(w.date),
        });
      case 'over_limit':
        return t('More than the {days} days allowed.', { days: w.limit });
      case 'hajj_taken':
        return t('Hajj leave is given once during the service.');
      case 'overlap':
        return t('Overlaps other leave of this employee.');
    }
  };
}

/** Records leave, or sets or adjusts an annual leave balance ("balance" mode). */
export function LeaveDialog({
  employees,
  employeeId,
  records,
  mode = 'leave',
  onClose,
}: {
  employees: Employee[];
  employeeId?: ID;
  records: LeaveRecord[];
  mode?: 'leave' | 'balance';
  onClose: () => void;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const warningText = useLeaveWarningText();
  const choices = employees.filter((e) => isCurrent(e) || e.id === employeeId);
  const [who, setWho] = useState<ID>(employeeId ?? choices[0]?.id ?? '');
  const [type, setType] = useState<LeaveType>('annual');
  const [kind, setKind] = useState<'opening' | 'adjustment'>('opening');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [days, setDays] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dayOff = useMemo(() => companyDayOff(company), [company]);
  const employee = employees.find((e) => e.id === who);
  const own = records.filter((r) => r.employeeId === who);

  const counted = mode === 'leave' ? countLeaveDays(type, start, end, dayOff) : 0;
  const balance = employee ? annualLeaveBalance(own, employee.hireDate, start) : null;
  const warnings =
    mode === 'leave'
      ? leaveWarnings({ id: '', type, kind: 'leave', start, end, days: counted }, own, balance)
      : [];

  const save = async () => {
    if (!employee) return;
    setBusy(true);
    setError('');
    try {
      await saveLeaveRecord(
        createLeaveRecord(company.id, employee.id, {
          type: mode === 'leave' ? type : 'annual',
          kind: mode === 'leave' ? 'leave' : kind,
          start,
          end: mode === 'leave' ? end : start,
          days,
          notes,
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={mode === 'leave' ? t('Record leave') : t('Set the leave balance')}
        description={
          mode === 'leave'
            ? t('Working days skip Fridays, Saturdays and public holidays.')
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
                    value={type}
                    onChange={(e) => setType(e.target.value as LeaveType)}
                  >
                    {LEAVE_TYPE_ORDER.map((x) => (
                      <option key={x} value={x}>
                        {t(LEAVE_TYPES[x].label)}
                      </option>
                    ))}
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
                {LEAVE_TYPES[type].counting === 'calendar'
                  ? tp(counted, '{count} calendar day', '{count} calendar days')
                  : tp(counted, '{count} working day', '{count} working days')}
                {type === 'annual' && balance
                  ? ` · ${t('Balance {days} days', { days: fmt.quantity(balance.balance) })}`
                  : ''}
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
          <Field label={t('Notes')} optional>
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
