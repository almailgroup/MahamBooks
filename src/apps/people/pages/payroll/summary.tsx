import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { Company, PayRun } from '@/db/types';
import { useCompany } from '@/app/company';
import { formatPeriod, payrollBreakdown, type PayGroupTotals } from '@/lib/hr/payroll';
import { findDepartment } from '@/lib/hr/departments';
import { currencyPrecision } from '@/lib/money';
import { formatDate } from '@/lib/format';
import {
  Both,
  paperSize,
  PRINT_AR,
  PRINT_EN,
  printMoney,
  PrintHeader,
  PrintToolbar,
} from '@/features/payroll/print';
import { runStatus } from '@/features/payroll/shared';
import { usePeopleSettings } from '@/features/people/hooks';
import { Spinner } from '@/components/ui/misc';
import { msg, t } from '@/i18n';

const L = {
  title: msg('Payroll by department and position'),
  department: msg('Department'),
  position: msg('Position'),
  employees: msg('Employees'),
  gross: msg('Gross pay'),
  deductions: msg('Deductions'),
  net: msg('Net pay'),
  employer: msg('Employer PIFSS'),
  cost: msg('Cost to the company'),
  total: msg('Total'),
  noDepartment: msg('No department'),
  otherDepartments: msg('Other departments'),
  noPosition: msg('No job title'),
  otherPositions: msg('Other positions'),
  status: msg('Status'),
  payDate: msg('Pay date'),
  prepared: msg('Prepared by'),
  approved: msg('Approval of the Super Admin'),
  draft: msg('Draft: not posted yet'),
};

function Amounts({ company, totals }: { company: Company; totals: PayGroupTotals }) {
  const money = (n: number) => printMoney(company, n);
  return (
    <>
      <td className="tabular border border-slate-300 px-2 py-1 text-end" dir="ltr">
        {totals.employees}
      </td>
      {[totals.gross, totals.deductions, totals.net, totals.pifssEmployer, totals.cost].map(
        (amount, i) => (
          <td key={i} className="tabular border border-slate-300 px-2 py-1 text-end" dir="ltr">
            {money(amount)}
          </td>
        ),
      )}
    </>
  );
}

/** A name in English with its Arabic below, or the bilingual label for none / other. */
function Name({ en, ar, fallback }: { en: string | null; ar: string; fallback: string }) {
  if (!en) return <Both text={fallback} />;
  return (
    <span>
      <span className="block">{en}</span>
      {ar && ar !== en ? (
        <span className="block text-slate-500" dir="rtl" lang="ar">
          {ar}
        </span>
      ) : null}
    </span>
  );
}

function Register({ company, run }: { company: Company; run: PayRun }) {
  const people = usePeopleSettings();
  const breakdown = payrollBreakdown(run.lines, currencyPrecision(company.currency));
  const head = [L.employees, L.gross, L.deductions, L.net, L.employer, L.cost];
  const status = run.status === 'draft' ? L.draft : runStatus(run.status).label;
  return (
    <article
      dir="ltr"
      className="paper mx-auto max-w-4xl bg-white p-6 text-xs text-slate-700 shadow-sm ring-1 ring-slate-200 print:max-w-none print:p-0 print:shadow-none print:ring-0"
    >
      <PrintHeader
        company={company}
        title={L.title}
        subtitle={{
          en: formatPeriod(run.period, PRINT_EN),
          ar: formatPeriod(run.period, PRINT_AR),
        }}
      />
      <dl className="mb-4 grid grid-cols-2 gap-x-8">
        <div className="flex justify-between gap-3 border-b border-slate-200 py-1">
          <dt>
            <Both text={L.status} />
          </dt>
          <dd className="text-end font-medium text-slate-900">
            <Both text={status} />
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-b border-slate-200 py-1">
          <dt>
            <Both text={L.payDate} />
          </dt>
          <dd className="text-end font-medium text-slate-900" dir="ltr">
            {formatDate(run.paidOn ?? run.payDate, company.dateFormat, PRINT_EN)}
          </dd>
        </div>
      </dl>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 px-2 py-1 text-start">
              <Both text={L.department} />
            </th>
            <th className="border border-slate-300 px-2 py-1 text-start">
              <Both text={L.position} />
            </th>
            {head.map((label) => (
              <th key={label} className="border border-slate-300 px-2 py-1 text-end">
                <Both text={label} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {breakdown.departments.map((d) => {
            const listed = d.department ? findDepartment(people?.departments, d.department) : null;
            const name = (
              <Name
                en={d.department}
                ar={listed?.nameAr ?? ''}
                fallback={d.department === null ? L.otherDepartments : L.noDepartment}
              />
            );
            return [
              ...d.positions.map((p, i) => (
                <tr key={`${d.department}/${p.jobTitle}`}>
                  {i === 0 ? (
                    <td
                      className="border border-slate-300 px-2 py-1 align-top font-medium text-slate-900"
                      rowSpan={d.positions.length + 1}
                    >
                      {name}
                    </td>
                  ) : null}
                  <td className="border border-slate-300 px-2 py-1">
                    <Name
                      en={p.jobTitle}
                      ar={p.jobTitleAr}
                      fallback={p.jobTitle === null ? L.otherPositions : L.noPosition}
                    />
                  </td>
                  <Amounts company={company} totals={p} />
                </tr>
              )),
              <tr key={`${d.department}/total`} className="bg-slate-50 font-semibold">
                <td className="border border-slate-300 px-2 py-1">
                  <Both text={L.total} />
                </td>
                <Amounts company={company} totals={d} />
              </tr>,
            ];
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold text-slate-900">
            <td className="border border-slate-300 px-2 py-1" colSpan={2}>
              <Both text={L.total} />
            </td>
            <Amounts company={company} totals={breakdown.totals} />
          </tr>
        </tfoot>
      </table>
      <div className="mt-12 grid grid-cols-2 gap-8">
        <div className="border-t border-slate-400 pt-1">
          <Both text={L.prepared} />
        </div>
        <div className="border-t border-slate-400 pt-1">
          <Both text={L.approved} />
        </div>
      </div>
    </article>
  );
}

/**
 * The pay run's register by department and position (كشف الرواتب حسب
 * القسم والوظيفة), in English and Arabic, ready to print: what each
 * department and position costs, without anyone's own pay.
 */
export default function PayrollSummaryPage() {
  const { id = '' } = useParams();
  const company = useCompany();
  const [params, setParams] = useSearchParams();
  const run = useLiveQuery(() => db.payRuns.get(id), [id]);
  const size = paperSize(params.get('size'));

  useEffect(() => {
    if (!run) return;
    const before = document.title;
    document.title = `${t('Payroll by department and position')} – ${run.period}`;
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
      <Register company={company} run={run} />
    </div>
  );
}
