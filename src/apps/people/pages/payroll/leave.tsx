import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CalendarPlus, ListChecks, Plane, Tags } from 'lucide-react';
import { useCompany, useFormat } from '@/app/company';
import { companyDayOff } from '@/db/payroll';
import {
  accrualOptions,
  annualDaysOn,
  employeeLeaveBalance,
  employeesNeedingLeaveOpening,
  leaveLabel,
  sickDaysByTier,
} from '@/lib/hr/leave';
import { round } from '@/lib/money';
import { isCurrent } from '@/lib/hr/employees';
import { today } from '@/lib/dates';
import { useEmployees } from '@/features/people/hooks';
import { useLeaveRecords, usePayrollSettings } from '@/features/payroll/hooks';
import { LeaveDialog } from '@/features/payroll/leave-dialog';
import { LeaveOpeningsDialog } from '@/features/payroll/leave-openings-dialog';
import { PayrollHeader } from '@/features/payroll/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/misc';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

/** Leave balances of the current staff and who is on leave today. */
export default function PayrollLeavePage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const employees = useEmployees();
  const records = useLeaveRecords();
  const settings = usePayrollSettings();
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState(false);
  const dayOff = useMemo(() => companyDayOff(company), [company]);
  if (!employees || !records || !settings) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const policy = settings.leavePolicy;
  const on = today();
  const year = Number(on.slice(0, 4));
  const current = employees
    .filter(isCurrent)
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  const rows = current.map((e) => {
    const own = records.filter((r) => r.employeeId === e.id);
    const taken = own.filter(
      (r) =>
        r.kind === 'leave' &&
        r.status === 'approved' &&
        r.type === 'annual' &&
        r.start.startsWith(`${year}-`),
    );
    const away = own.find(
      (r) => r.kind === 'leave' && r.status === 'approved' && r.start <= on && r.end >= on,
    );
    return {
      employee: e,
      balance: employeeLeaveBalance(e, own, on, policy, accrualOptions(settings)).balance,
      taken: taken.reduce((s, r) => s + r.days, 0),
      sick: sickDaysByTier(own, year, dayOff).reduce((s, x) => s + x.days, 0),
      away,
    };
  });
  const needing = employeesNeedingLeaveOpening(current, records).filter((e) => !e.leaveOpening);
  // The company's days a year, as a share of each month.
  const footer = {
    date: fmt.date(on),
    days: fmt.quantity(round(annualDaysOn(on, policy) / 12, 2)),
  };
  const record = (
    <div className="flex flex-wrap gap-2">
      <ButtonLink variant="outline" to="/payroll/leave-reasons">
        <Tags /> {t('Leave reasons')}
      </ButtonLink>
      <Button variant="outline" onClick={() => setOpening(true)} disabled={current.length === 0}>
        <ListChecks /> {t('Set opening leave balances')}
      </Button>
      <Button onClick={() => setRecording(true)} disabled={current.length === 0}>
        <CalendarPlus /> {t('Record leave')}
      </Button>
    </div>
  );

  return (
    <div>
      <PayrollHeader actions={record} />
      {current.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Plane />}
            title={t('No current employees')}
            description={t('Leave balances show here once you add employees.')}
          />
        </Card>
      ) : (
        <Card>
          {needing.length > 0 ? (
            <p className="border-b border-amber-100 bg-amber-50/60 px-5 py-3 text-sm text-amber-900">
              {tp(
                needing.length,
                '{count} employee has no opening leave balance: their leave is counted from their hire date.',
                '{count} employees have no opening leave balance: their leave is counted from their hire date.',
              )}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <th className="px-5 py-3 text-start">{t('Employee')}</th>
                  <th className="px-3 py-3 text-end">{t('Annual leave balance')}</th>
                  <th className="hidden px-3 py-3 text-end sm:table-cell">
                    {t('Taken in {year}', { year })}
                  </th>
                  <th className="hidden px-5 py-3 text-end md:table-cell">
                    {t('Sick days in {year}', { year })}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ employee: e, balance, taken, sick, away }) => (
                  <tr
                    key={e.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/employees/${e.id}?tab=leave`)}
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={`/employees/${e.id}?tab=leave`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="hover:text-primary-700 font-medium text-slate-900"
                      >
                        {localName(e)}
                      </Link>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {e.number}
                        {away ? (
                          <Badge tone="blue">
                            {t('{leave} until {date}', {
                              leave: leaveLabel(away, settings.leaveReasons),
                              date: fmt.date(away.end),
                            })}
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="tabular px-3 py-3 text-end font-medium text-slate-900">
                      {fmt.quantity(balance)}
                      {e.leaveOpening && !e.leaveOpening.confirmed ? (
                        <Badge tone="amber" className="ms-2">
                          {t('Not confirmed')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="tabular hidden px-3 py-3 text-end text-slate-600 sm:table-cell">
                      {fmt.quantity(taken)}
                    </td>
                    <td className="tabular hidden px-5 py-3 text-end text-slate-600 md:table-cell">
                      {fmt.quantity(sick)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            {current.some((e) => e.annualLeaveDays)
              ? t(
                  'Balances in days on {date}: {days} days a month, or each employee’s own entitlement, less leave taken.',
                  footer,
                )
              : t('Balances in days on {date}: {days} days a month, less leave taken.', footer)}
          </p>
        </Card>
      )}
      {recording ? (
        <LeaveDialog employees={employees} records={records} onClose={() => setRecording(false)} />
      ) : null}
      {opening ? <LeaveOpeningsDialog onClose={() => setOpening(false)} /> : null}
    </div>
  );
}
