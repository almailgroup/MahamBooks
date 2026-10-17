import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { HandCoins, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createPayRun } from '@/db/payroll';
import type { PayRun } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { addPeriods, formatPeriod, payDateFor, payRunTotals, periodOf } from '@/lib/hr/payroll';
import { isCurrent } from '@/lib/hr/employees';
import { currencyPrecision } from '@/lib/money';
import { today } from '@/lib/dates';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { usePayRuns } from '@/features/payroll/hooks';
import { PayrollHeader, RunStatusBadge } from '@/features/payroll/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, EmptyState, Spinner, Stat } from '@/components/ui/misc';
import { Field, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t, tp } from '@/i18n';

/** Months a pay run can be prepared for: a year back to next month, without a run yet. */
function openMonths(runs: PayRun[]): string[] {
  const now = periodOf(today());
  const taken = new Set(runs.map((r) => r.period));
  const out: string[] = [];
  for (let i = 1; i >= -12; i--) {
    const period = addPeriods(now, i);
    if (!taken.has(period)) out.push(period);
  }
  return out;
}

function NewRunDialog({ runs, onClose }: { runs: PayRun[]; onClose: () => void }) {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const months = openMonths(runs);
  const latest = runs[0]?.period;
  const suggested = latest ? addPeriods(latest, 1) : periodOf(today());
  const [period, setPeriod] = useState(
    months.includes(suggested) ? suggested : (months.find((m) => m <= periodOf(today())) ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const run = await createPayRun(company.id, period);
      toast.success(t('Payroll for {month} prepared', { month: formatPeriod(period, fmt.locale) }));
      navigate(`/payroll/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not prepare the pay run.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('New pay run')}
        description={t(
          'Every employee on the payroll that month is added with their salary, allowances, leave and loan instalments.',
        )}
        size="sm"
      >
        <DialogBody>
          <Field label={t('Month')}>
            {(id) => (
              <Select id={id} value={period} onChange={(e) => setPeriod(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {formatPeriod(m, fmt.locale)}
                  </option>
                ))}
              </Select>
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
          <Button onClick={() => void create()} loading={busy} disabled={!period}>
            {t('Prepare pay run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PayrollPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const runs = usePayRuns();
  const employees = useEmployees();
  const people = usePeopleSettings();
  const [creating, setCreating] = useState(false);
  const precision = currencyPrecision(company.currency);
  const totals = useMemo(
    () => new Map((runs ?? []).map((r) => [r.id, payRunTotals(r.lines, precision)])),
    [runs, precision],
  );

  if (!runs || !employees || !people) return <Spinner className="py-24" label={t('Loading…')} />;

  const current = employees.filter(isCurrent);
  const newRun = (
    <Button onClick={() => setCreating(true)}>
      <Plus /> {t('New pay run')}
    </Button>
  );
  const latest = runs[0];
  const latestTotals = latest ? totals.get(latest.id) : undefined;
  const posted = runs.find((r) => r.status !== 'draft');
  const postedTotals = posted ? totals.get(posted.id) : undefined;

  return (
    <div>
      <PayrollHeader actions={employees.length > 0 ? newRun : undefined} />
      {employees.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UserPlus />}
            title={t('Add your employees first')}
            description={t(
              'Pay runs are prepared from the employee records: salary, allowances, IBAN and whether they are insured with PIFSS.',
            )}
            action={
              <ButtonLink to="/employees/new">
                <Plus /> {t('New employee')}
              </ButtonLink>
            }
          />
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins />}
            title={t('No pay runs yet')}
            description={t(
              'Prepare a month’s payroll: pay and overtime, PIFSS, loan instalments, payslips and the bank salary file.',
            )}
            action={newRun}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {latest && latestTotals ? (
              <Stat
                label={t('Net pay, {month}', { month: formatPeriod(latest.period, fmt.locale) })}
                value={
                  <span className="tabular text-xl sm:text-2xl">{fmt.money(latestTotals.net)}</span>
                }
                hint={tp(latest.lines.length, '{count} employee', '{count} employees')}
              />
            ) : null}
            <Stat
              label={t('Current employees')}
              value={<span className="tabular">{fmt.quantity(current.length)}</span>}
              hint={
                <Link to="/employees" className="text-primary-700 hover:underline">
                  {t('Open the register')}
                </Link>
              }
            />
            {posted && postedTotals ? (
              <Stat
                label={t('PIFSS, {month}', { month: formatPeriod(posted.period, fmt.locale) })}
                value={
                  <span className="tabular text-xl sm:text-2xl">
                    {fmt.money(postedTotals.pifssEmployee + postedTotals.pifssEmployer)}
                  </span>
                }
                hint={t('Pay by {date}.', {
                  date: fmt.date(payDateFor(addPeriods(posted.period, 1), people.pifssDueDay)),
                })}
              />
            ) : null}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3 text-start">{t('Month')}</th>
                    <th className="hidden px-3 py-3 text-end sm:table-cell">{t('Employees')}</th>
                    <th className="hidden px-3 py-3 text-end md:table-cell">{t('Gross pay')}</th>
                    <th className="px-3 py-3 text-end">{t('Net pay')}</th>
                    <th className="px-5 py-3 text-end">{t('Status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.map((run) => {
                    const sums = totals.get(run.id)!;
                    return (
                      <tr
                        key={run.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => navigate(`/payroll/runs/${run.id}`)}
                      >
                        <td className="px-5 py-3">
                          <Link
                            to={`/payroll/runs/${run.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary-700 font-medium text-slate-900"
                          >
                            {formatPeriod(run.period, fmt.locale)}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {run.paidOn
                              ? t('Paid on {date}', { date: fmt.date(run.paidOn) })
                              : t('Pay date {date}', { date: fmt.date(run.payDate) })}
                          </span>
                        </td>
                        <td className="tabular hidden px-3 py-3 text-end text-slate-600 sm:table-cell">
                          {fmt.quantity(run.lines.length)}
                        </td>
                        <td className="tabular hidden px-3 py-3 text-end text-slate-700 md:table-cell">
                          {fmt.money(sums.gross)}
                        </td>
                        <td className="tabular px-3 py-3 text-end font-medium text-slate-900">
                          {fmt.money(sums.net)}
                        </td>
                        <td className="px-5 py-3 text-end">
                          <RunStatusBadge status={run.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
      {creating ? <NewRunDialog runs={runs} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
