import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Company, PayLine, PayRun } from '@/db/types';
import { useCompany } from '@/app/company';
import { formatPeriod } from '@/lib/hr/payroll';
import { formatDate } from '@/lib/format';
import { formatIban } from '@/lib/kuwait';
import { amountInWords } from '@/lib/words';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import {
  arabicOf,
  Both,
  paperSize,
  PRINT_AR,
  PRINT_EN,
  printMoney,
  PrintHeader,
  PrintRow,
  PrintToolbar,
} from '@/features/payroll/print';
import { leaveDetailPay } from '@/features/payroll/shared';
import { Spinner } from '@/components/ui/misc';
import { msg, t } from '@/i18n';

const L = {
  payslip: msg('Payslip'),
  employee: msg('Employee'),
  number: msg('Employee number'),
  job: msg('Job title'),
  civilId: msg('Civil ID number'),
  card: msg('Review card number'),
  iban: msg('IBAN'),
  days: msg('Days paid'),
  payDate: msg('Pay date'),
  earnings: msg('Earnings'),
  deductions: msg('Deductions'),
  basic: msg('Basic salary'),
  overtime: msg('Overtime'),
  unpaid: msg('Unpaid days'),
  gross: msg('Gross pay'),
  pifss: msg('PIFSS – employee share'),
  owed: msg('Owed by the employee, not covered by this month’s pay'),
  loan: msg('Loan recovery'),
  total: msg('Total deductions'),
  net: msg('Net pay'),
  employer: msg('PIFSS – employer share'),
  leave: msg('Leave this month'),
  leaveDays: msg('Days'),
  leavePay: msg('Pay'),
  leaveAsApproved: msg('Leave as recorded when the pay run was approved.'),
  signature: msg('Employee signature'),
  none: msg('None'),
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 border-b border-slate-200 py-1">
      <dt>
        <Both text={label} />
      </dt>
      <dd className="ms-auto text-end font-medium whitespace-nowrap text-slate-900" dir="ltr">
        {value || '—'}
      </dd>
    </div>
  );
}

function Payslip({ company, run, line }: { company: Company; run: PayRun; line: PayLine }) {
  const money = (n: number) => printMoney(company, n);
  const minus = (n: number) => `−${money(n)}`;
  const additions = line.adjustments.filter((a) => a.type === 'addition' && a.amount > 0);
  const deductions = line.adjustments.filter((a) => a.type === 'deduction' && a.amount > 0);
  const owed = line.pifssOwed ?? 0;
  const p = currencyPrecision(company.currency);
  const totalDeductions = fromMinor(
    toMinor(line.pifssEmployee, p) -
      toMinor(owed, p) +
      toMinor(line.loanDeduction, p) +
      toMinor(line.otherDeductions, p),
    p,
  );
  const job = [line.jobTitle, line.jobTitleAr].filter(Boolean).join(' / ');
  return (
    <article
      dir="ltr"
      className="paper mx-auto max-w-3xl break-after-page bg-white p-6 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0"
    >
      <PrintHeader
        company={company}
        title={L.payslip}
        subtitle={{
          en: formatPeriod(run.period, PRINT_EN),
          ar: formatPeriod(run.period, PRINT_AR),
        }}
      />
      <div className="mb-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2 print:grid-cols-2">
        <dl>
          <div className="flex justify-between gap-3 border-b border-slate-200 py-1">
            <dt>
              <Both text={L.employee} />
            </dt>
            <dd className="text-end font-medium text-slate-900">
              <span className="block">{line.name}</span>
              {line.nameAr ? (
                <span className="block" dir="rtl" lang="ar">
                  {line.nameAr}
                </span>
              ) : null}
            </dd>
          </div>
          <Detail label={L.number} value={line.number} />
          <Detail label={L.job} value={job} />
        </dl>
        <dl>
          {/* A stateless employee without a Civil ID: their review card, under its own name. */}
          {!line.civilId && line.centralCardNumber ? (
            <Detail label={L.card} value={line.centralCardNumber} />
          ) : (
            <Detail label={L.civilId} value={line.civilId} />
          )}
          <Detail label={L.iban} value={line.iban ? formatIban(line.iban) : ''} />
          <Detail label={L.days} value={`${line.daysWorked} / ${line.daysInMonth}`} />
          <Detail
            label={L.payDate}
            value={formatDate(run.paidOn ?? run.payDate, company.dateFormat, PRINT_EN)}
          />
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
        <table className="w-full border-collapse self-start">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-1 text-start" colSpan={2}>
                <Both text={L.earnings} />
              </th>
            </tr>
          </thead>
          <tbody>
            <PrintRow label={<Both text={L.basic} />} amount={money(line.basic)} />
            {line.allowances.map((a) => (
              <PrintRow
                key={a.id}
                label={
                  <>
                    <span className="block">{a.name}</span>
                    {a.nameAr ? (
                      <span className="block text-slate-500" dir="rtl" lang="ar">
                        {a.nameAr}
                      </span>
                    ) : null}
                  </>
                }
                amount={money(a.amount)}
              />
            ))}
            {line.overtimePay > 0 ? (
              <PrintRow label={<Both text={L.overtime} />} amount={money(line.overtimePay)} />
            ) : null}
            {additions.map((a) => (
              <PrintRow
                key={a.id}
                label={<Both text={msg('Addition')} />}
                note={a.note}
                amount={money(a.amount)}
              />
            ))}
            {line.absenceDeduction > 0 ? (
              <PrintRow label={<Both text={L.unpaid} />} amount={minus(line.absenceDeduction)} />
            ) : null}
            <PrintRow strong label={<Both text={L.gross} />} amount={money(line.gross)} />
          </tbody>
        </table>
        <table className="w-full border-collapse self-start">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-1 text-start" colSpan={2}>
                <Both text={L.deductions} />
              </th>
            </tr>
          </thead>
          <tbody>
            {line.pifssEmployee > 0 ? (
              <PrintRow label={<Both text={L.pifss} />} amount={money(line.pifssEmployee)} />
            ) : null}
            {owed > 0 ? <PrintRow label={<Both text={L.owed} />} amount={minus(owed)} /> : null}
            {line.loanDeduction > 0 ? (
              <PrintRow label={<Both text={L.loan} />} amount={money(line.loanDeduction)} />
            ) : null}
            {deductions.map((a) => (
              <PrintRow
                key={a.id}
                label={<Both text={msg('Deduction')} />}
                note={a.note}
                amount={money(a.amount)}
              />
            ))}
            {line.pifssEmployee === 0 && line.loanDeduction === 0 && deductions.length === 0 ? (
              <PrintRow label={<Both text={L.none} />} amount={money(0)} />
            ) : null}
            <PrintRow strong label={<Both text={L.total} />} amount={money(totalDeductions)} />
          </tbody>
        </table>
      </div>

      {line.leaveDetail?.length ? (
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-1 text-start">
                <Both text={L.leave} />
              </th>
              <th className="border border-slate-300 px-2 py-1 text-end">
                <Both text={L.leaveDays} />
              </th>
              <th className="border border-slate-300 px-2 py-1 text-start">
                <Both text={L.leavePay} />
              </th>
            </tr>
          </thead>
          <tbody>
            {line.leaveDetail.map((d) => (
              <tr key={`${d.reasonId}:${d.percent}`}>
                <td className="border border-slate-300 px-2 py-1">
                  <span className="block">{d.name}</span>
                  {d.nameAr ? (
                    <span className="block text-slate-500" dir="rtl" lang="ar">
                      {d.nameAr}
                    </span>
                  ) : null}
                </td>
                <td className="tabular border border-slate-300 px-2 py-1 text-end" dir="ltr">
                  {d.days}
                </td>
                <td className="border border-slate-300 px-2 py-1">
                  {d.percent > 0 && d.percent < 100 && d.percent !== 50 ? (
                    <span dir="ltr">{`${d.percent}%`}</span>
                  ) : (
                    <Both text={leaveDetailPay(d)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {run.status !== 'draft' ? (
            <caption className="caption-bottom pt-1 text-start text-slate-500">
              <Both text={L.leaveAsApproved} />
            </caption>
          ) : null}
        </table>
      ) : null}

      <div className="mt-4 rounded border-2 border-slate-800 px-3 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <Both text={L.net} className="font-semibold text-slate-900" />
          <span className="tabular text-base font-bold text-slate-900" dir="ltr">
            {money(line.net)}
          </span>
        </div>
        <p className="mt-1" dir="ltr">
          {amountInWords(line.net, company.currency, 'en')}
        </p>
        <p dir="rtl" lang="ar">
          {amountInWords(line.net, company.currency, 'ar')}
        </p>
      </div>
      {line.pifssEmployer > 0 ? (
        <p className="mt-2 text-slate-500">
          {L.employer}: <span dir="ltr">{money(line.pifssEmployer)}</span> ·{' '}
          <span dir="rtl" lang="ar">
            {arabicOf(L.employer)}
          </span>
        </p>
      ) : null}
      <div className="mt-10 grid grid-cols-2 gap-8">
        <div className="border-t border-slate-400 pt-1">
          <Both text={L.signature} />
        </div>
      </div>
    </article>
  );
}

/** Payslips of a pay run (or one employee's), in English and Arabic, ready to print. */
export default function PayslipsPage() {
  const { id = '' } = useParams();
  const company = useCompany();
  const [params, setParams] = useSearchParams();
  const run = useLiveQuery(() => db.payRuns.get(id), [id]);
  const size = paperSize(params.get('size'));
  const only = params.get('employee');

  useEffect(() => {
    if (!run) return;
    const before = document.title;
    document.title = `${t('Payslips')} – ${run.period}`;
    return () => {
      document.title = before;
    };
  }, [run]);

  if (run === undefined) return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  if (!run || run.companyId !== company.id) {
    return (
      <p className="p-10 text-center text-slate-600">{t('This pay run could not be found.')}</p>
    );
  }
  const lines = run.lines.filter((l) => !only || l.employeeId === only);

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <PrintToolbar
        back={`/payroll/runs/${run.id}`}
        backLabel={t('Back to the pay run')}
        size={size}
        onSize={(next) => {
          const query = new URLSearchParams(params);
          query.set('size', next);
          setParams(query, { replace: true });
        }}
      />
      <div className="space-y-6 print:space-y-0">
        {lines.map((line) => (
          <Payslip key={line.id} company={company} run={run} line={line} />
        ))}
      </div>
    </div>
  );
}
