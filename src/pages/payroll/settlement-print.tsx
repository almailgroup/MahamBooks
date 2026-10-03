import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { useCompany } from '@/app/company';
import { LEAVING_REASON_LABELS } from '@/lib/hr/employees';
import { formatDate, formatQuantity } from '@/lib/format';
import { amountInWords } from '@/lib/words';
import {
  arabicOf,
  Both,
  paperSize,
  PRINT_EN,
  printMoney,
  PrintHeader,
  PrintRow,
  PrintToolbar,
} from '@/features/payroll/print';
import { Spinner } from '@/components/ui/misc';
import { msg, t } from '@/i18n';

const L = {
  title: msg('Final settlement'),
  employee: msg('Employee'),
  number: msg('Employee number'),
  civilId: msg('Civil ID number'),
  hired: msg('Hire date'),
  left: msg('Leaving date'),
  reason: msg('Reason'),
  years: msg('Years of service'),
  wage: msg('Monthly wage'),
  dues: msg('Amounts due'),
  indemnity: msg('End-of-service indemnity'),
  notice: msg('Notice pay'),
  leave: msg('Unused leave'),
  last: msg('Last salary'),
  deductions: msg('Deductions'),
  pifss: msg('PIFSS – employee share'),
  loan: msg('Loan recovery'),
  other: msg('Other deductions'),
  net: msg('Net amount due'),
  received: msg('Received by the employee'),
  approved: msg('Approved by'),
  days: msg('days'),
  months: msg('months'),
};

/** The settlement sheet given to a leaving employee, in English and Arabic. */
export default function SettlementPrintPage() {
  const { id = '' } = useParams();
  const company = useCompany();
  const [params, setParams] = useSearchParams();
  const settlement = useLiveQuery(() => db.finalSettlements.get(id), [id]);
  const employee = useLiveQuery(
    async () => (settlement ? db.employees.get(settlement.employeeId) : undefined),
    [settlement],
  );
  const size = paperSize(params.get('size'));

  useEffect(() => {
    const before = document.title;
    document.title = t('Final settlement');
    return () => {
      document.title = before;
    };
  }, []);

  if (settlement === undefined || (settlement && employee === undefined)) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }
  if (!settlement || settlement.companyId !== company.id || !employee) {
    return (
      <p className="p-10 text-center text-slate-600">{t('This settlement could not be found.')}</p>
    );
  }
  const money = (n: number) => printMoney(company, n);
  const date = (d: string | null) => formatDate(d, company.dateFormat, PRINT_EN);
  const qty = (n: number) => formatQuantity(Math.round(n * 100) / 100, PRINT_EN);
  const loans = settlement.loans.reduce((s, l) => s + l.amount, 0);
  const last = settlement.lastSalary;
  const reason = LEAVING_REASON_LABELS[settlement.reason];
  const rows: [string, string][] = [
    [L.number, employee.number],
    [L.civilId, employee.civilId],
    [L.hired, date(employee.hireDate)],
    [L.left, date(settlement.leavingDate)],
    [L.years, qty(settlement.years)],
    [L.wage, money(settlement.eosWage)],
  ];

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <PrintToolbar
        back={`/employees/${employee.id}/settlement`}
        backLabel={t('Back to the settlement')}
        size={size}
        onSize={(next) => setParams({ size: next }, { replace: true })}
      />
      <article
        dir="ltr"
        className={`mx-auto max-w-3xl bg-white p-6 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0 ${size === 'A5' ? 'text-[11px]' : ''}`}
      >
        <PrintHeader company={company} title={L.title} />
        <dl className="mb-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2 print:grid-cols-2">
          <div className="flex justify-between gap-3 border-b border-slate-200 py-1 sm:col-span-2 print:col-span-2">
            <dt>
              <Both text={L.employee} />
            </dt>
            <dd className="text-end font-medium text-slate-900">
              <span className="block">{employee.name}</span>
              {employee.nameAr ? (
                <span className="block" dir="rtl" lang="ar">
                  {employee.nameAr}
                </span>
              ) : null}
            </dd>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-slate-200 py-1">
              <dt>
                <Both text={label} />
              </dt>
              <dd className="text-end font-medium text-slate-900" dir="ltr">
                {value || '—'}
              </dd>
            </div>
          ))}
          <div className="flex justify-between gap-3 border-b border-slate-200 py-1 sm:col-span-2 print:col-span-2">
            <dt>
              <Both text={L.reason} />
            </dt>
            <dd className="text-end font-medium text-slate-900">
              <Both text={reason} />
            </dd>
          </div>
        </dl>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-1 text-start" colSpan={2}>
                <Both text={L.dues} />
              </th>
            </tr>
          </thead>
          <tbody>
            <PrintRow label={<Both text={L.indemnity} />} amount={money(settlement.indemnity)} />
            {settlement.noticePay > 0 ? (
              <PrintRow
                label={<Both text={L.notice} />}
                note={`${qty(settlement.noticeMonths)} ${L.months} / ${qty(settlement.noticeMonths)} ${arabicOf(L.months)}`}
                amount={money(settlement.noticePay)}
              />
            ) : null}
            {settlement.leavePay > 0 ? (
              <PrintRow
                label={<Both text={L.leave} />}
                note={`${qty(settlement.leaveDays)} ${L.days} / ${qty(settlement.leaveDays)} ${arabicOf(L.days)}`}
                amount={money(settlement.leavePay)}
              />
            ) : null}
            {last ? (
              <PrintRow
                label={<Both text={L.last} />}
                note={`${last.days} / ${last.daysInMonth} ${L.days} / ${arabicOf(L.days)}`}
                amount={money(last.gross)}
              />
            ) : null}
          </tbody>
          {last?.pifssEmployee || loans > 0 || settlement.otherDeductions > 0 ? (
            <>
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1 text-start" colSpan={2}>
                    <Both text={L.deductions} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {last && last.pifssEmployee > 0 ? (
                  <PrintRow
                    label={<Both text={L.pifss} />}
                    amount={`−${money(last.pifssEmployee)}`}
                  />
                ) : null}
                {loans > 0 ? (
                  <PrintRow label={<Both text={L.loan} />} amount={`−${money(loans)}`} />
                ) : null}
                {settlement.otherDeductions > 0 ? (
                  <PrintRow
                    label={<Both text={L.other} />}
                    note={settlement.deductionNote}
                    amount={`−${money(settlement.otherDeductions)}`}
                  />
                ) : null}
              </tbody>
            </>
          ) : null}
        </table>

        <div className="mt-4 rounded border-2 border-slate-800 px-3 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <Both text={L.net} className="font-semibold text-slate-900" />
            <span className="tabular text-base font-bold text-slate-900" dir="ltr">
              {money(settlement.net)}
            </span>
          </div>
          <p className="mt-1" dir="ltr">
            {amountInWords(settlement.net, company.currency, 'en')}
          </p>
          <p dir="rtl" lang="ar">
            {amountInWords(settlement.net, company.currency, 'ar')}
          </p>
        </div>
        {settlement.notes ? <p className="mt-3 whitespace-pre-wrap">{settlement.notes}</p> : null}

        <div className="mt-12 grid grid-cols-2 gap-8">
          <div className="border-t border-slate-400 pt-1">
            <Both text={L.received} />
          </div>
          <div className="border-t border-slate-400 pt-1">
            <Both text={L.approved} />
          </div>
        </div>
      </article>
    </div>
  );
}
