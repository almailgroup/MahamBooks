import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { Account, Employee, ID, PayrollSettings } from '@/db/types';
import { createStaffLoan, saveStaffLoan } from '@/db/payroll';
import { addPeriods, formatPeriod, PAYROLL_RULES, periodOf } from '@/lib/hr/payroll';
import { isCurrent } from '@/lib/hr/employees';
import { currencyPrecision, dec, round } from '@/lib/money';
import { today } from '@/lib/dates';
import { useCompany, useFormat } from '@/app/company';
import { Button } from '@/components/ui/button';
import { Field, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { moneyAccounts } from './shared';
import { DateField } from '@/components/ui/date-field';

/** Records an interest-free loan or salary advance to an employee. */
export function LoanDialog({
  employees,
  employeeId,
  accounts,
  settings,
  onClose,
}: {
  employees: Employee[];
  employeeId?: ID;
  accounts: Account[];
  settings: PayrollSettings;
  onClose: () => void;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const precision = currencyPrecision(company.currency);
  const choices = employees.filter((e) => isCurrent(e) || e.id === employeeId);
  const banks = moneyAccounts(accounts);
  const main = accounts.find((a) => a.role === 'bank');
  const [who, setWho] = useState<ID>(employeeId ?? choices[0]?.id ?? '');
  const [amount, setAmount] = useState(0);
  const [instalment, setInstalment] = useState(0);
  const [date, setDate] = useState(today());
  const [firstPeriod, setFirstPeriod] = useState(periodOf(today()));
  const [paidFrom, setPaidFrom] = useState<ID>(
    settings.bankAccountId ?? main?.id ?? banks[0]?.id ?? '',
  );
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const employee = employees.find((e) => e.id === who);

  const wage = employee
    ? employee.allowances.reduce((s, a) => s.plus(dec(a.amount)), dec(employee.basicSalary))
    : dec(0);
  const cap = round(wage.times(PAYROLL_RULES.loanCapPercent).dividedBy(100), precision);
  const count = amount > 0 && instalment > 0 ? Math.ceil(round(amount / instalment, 6)) : 0;
  const months = Array.from({ length: 14 }, (_, i) => addPeriods(periodOf(today()), i - 1));

  const save = async () => {
    if (!employee) return;
    setBusy(true);
    setError('');
    try {
      await saveStaffLoan(
        createStaffLoan(company.id, employee.id, {
          amount,
          instalment,
          date,
          firstPeriod,
          paidFromAccountId: paidFrom || null,
          notes,
        }),
      );
      toast.success(t('Loan to {name} recorded', { name: localName(employee) }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save the loan.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('New loan or advance')}
        description={t(
          'Interest-free and recovered from pay in monthly instalments, at most 10% of the wage (art. 59).',
        )}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Amount')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={amount}
                  onValueChange={setAmount}
                  allowNegative={false}
                  blankZero
                />
              )}
            </Field>
            <Field label={t('Monthly instalment')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={instalment}
                  onValueChange={setInstalment}
                  allowNegative={false}
                  blankZero
                />
              )}
            </Field>
            <Field label={t('Paid on')}>
              {(id) => <DateField id={id} value={date} onChange={(iso) => iso && setDate(iso)} />}
            </Field>
            <Field label={t('First instalment in')}>
              {(id) => (
                <Select
                  id={id}
                  value={firstPeriod}
                  onChange={(e) => setFirstPeriod(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {formatPeriod(m, fmt.locale)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('Paid from')} className="sm:col-span-2">
              {(id) => (
                <Select id={id} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>
                  {banks.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {localName(a)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {count > 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {tp(
                count,
                '{count} instalment, the last in {month}',
                '{count} instalments, the last in {month}',
                {
                  month: formatPeriod(addPeriods(firstPeriod, count - 1), fmt.locale),
                },
              )}
            </p>
          ) : null}
          {employee && instalment > 0 && cap > 0 && instalment > cap ? (
            <p className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
              {t('Over 10% of the monthly wage ({limit}), the most the law allows.', {
                limit: fmt.money(cap),
              })}
            </p>
          ) : null}
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
            {t('Pay the loan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
