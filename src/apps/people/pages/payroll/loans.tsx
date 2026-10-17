import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { HandCoins, Plus } from 'lucide-react';
import { useCompany, useFormat } from '@/app/company';
import { loanBalance } from '@/db/payroll';
import { formatPeriod } from '@/lib/hr/payroll';
import { isCurrent } from '@/lib/hr/employees';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { useEmployees } from '@/features/people/hooks';
import {
  useAccounts,
  usePayrollSettings,
  usePayRuns,
  useSettlements,
  useStaffLoans,
} from '@/features/payroll/hooks';
import { LoanDialog } from '@/features/payroll/loan-dialog';
import { PayrollHeader } from '@/features/payroll/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Spinner, Stat } from '@/components/ui/misc';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/** Every staff loan and advance with what is left to recover. */
export default function PayrollLoansPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const employees = useEmployees();
  const loans = useStaffLoans();
  const runs = usePayRuns();
  const settlements = useSettlements();
  const accounts = useAccounts();
  const settings = usePayrollSettings();
  const [adding, setAdding] = useState(false);
  if (!employees || !loans || !runs || !settlements || !accounts || !settings) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  const p = currencyPrecision(company.currency);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const rows = loans
    .map((loan) => ({ loan, balance: loanBalance(loan, runs, settlements, p) }))
    .sort(
      (a, b) =>
        Number(b.balance > 0) - Number(a.balance > 0) || b.loan.date.localeCompare(a.loan.date),
    );
  const outstanding = fromMinor(
    rows.reduce((s, r) => s + toMinor(r.balance, p), 0),
    p,
  );
  const add = (
    <Button onClick={() => setAdding(true)} disabled={!employees.some(isCurrent)}>
      <Plus /> {t('New loan')}
    </Button>
  );

  return (
    <div>
      <PayrollHeader actions={add} />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HandCoins />}
            title={t('No loans or advances')}
            description={t(
              'Record an interest-free loan or salary advance; its instalments are deducted in each pay run.',
            )}
            action={employees.some(isCurrent) ? add : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Stat
              label={t('Still to recover')}
              value={<span className="tabular text-xl sm:text-2xl">{fmt.money(outstanding)}</span>}
            />
            <Stat
              label={t('Active loans')}
              value={
                <span className="tabular">
                  {fmt.quantity(rows.filter((r) => r.balance > 0).length)}
                </span>
              }
            />
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3 text-start">{t('Employee')}</th>
                    <th className="hidden px-3 py-3 text-end sm:table-cell">{t('Amount')}</th>
                    <th className="hidden px-3 py-3 text-end md:table-cell">{t('Instalment')}</th>
                    <th className="px-3 py-3 text-end">{t('Balance')}</th>
                    <th className="px-5 py-3 text-end">{t('Status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ loan, balance }) => {
                    const employee = byId.get(loan.employeeId);
                    return (
                      <tr
                        key={loan.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => navigate(`/employees/${loan.employeeId}?tab=loans`)}
                      >
                        <td className="px-5 py-3">
                          <Link
                            to={`/employees/${loan.employeeId}?tab=loans`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary-700 font-medium text-slate-900"
                          >
                            {employee ? localName(employee) : '—'}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {loan.payRunId
                              ? t('PIFSS share owed from {month}', {
                                  month: formatPeriod(loan.date.slice(0, 7), fmt.locale),
                                })
                              : t('Paid on {date}, from {month}', {
                                  date: fmt.date(loan.date),
                                  month: formatPeriod(loan.firstPeriod, fmt.locale),
                                })}
                          </span>
                        </td>
                        <td className="tabular hidden px-3 py-3 text-end text-slate-700 sm:table-cell">
                          {fmt.money(loan.amount)}
                        </td>
                        <td className="tabular hidden px-3 py-3 text-end text-slate-700 md:table-cell">
                          {fmt.money(loan.instalment)}
                        </td>
                        <td className="tabular px-3 py-3 text-end font-medium text-slate-900">
                          {fmt.money(balance)}
                        </td>
                        <td className="px-5 py-3 text-end">
                          {loan.status === 'cancelled' ? (
                            <Badge tone="slate">{t('Cancelled')}</Badge>
                          ) : balance === 0 ? (
                            <Badge tone="green">{t('Repaid')}</Badge>
                          ) : (
                            <Badge tone="blue">{t('Active')}</Badge>
                          )}
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
      {adding ? (
        <LoanDialog
          employees={employees}
          accounts={accounts}
          settings={settings}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
