import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Employee } from '@/db/types';
import { useFormat } from '@/app/company';
import { calculateEosi, eosWage, serviceYears, type EosiResult } from '@/lib/hr/eosi';
import { eosiReasonFor, insuredWithPifss, underLabourLaw } from '@/lib/hr/employees';
import { currencyPrecision } from '@/lib/money';
import { today } from '@/lib/dates';
import { Card, CardBody, CardHeader } from '@/components/ui/misc';
import { Field, NumberInput } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';

function shareText(result: EosiResult): string {
  const { numerator, denominator } = result.share;
  if (numerator === denominator) return t('In full');
  if (numerator === 0) return t('Nothing');
  if (numerator * 2 === denominator) return t('Half');
  return t('Two thirds');
}

function Breakdown({ result }: { result: EosiResult }) {
  const fmt = useFormat();
  const years = (n: number) => fmt.quantity(Math.round(n * 100) / 100);
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-3">
        <dt className="text-slate-600">
          {t('First {years} years × {days} days', {
            years: years(result.first.years),
            days: result.first.daysPerYear ?? 0,
          })}
        </dt>
        <dd className="tabular text-slate-900">{fmt.money(result.first.amount)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-slate-600">
          {result.later.monthsPerYear
            ? t('Later {years} years × one month', { years: years(result.later.years) })
            : t('Later {years} years × {days} days', {
                years: years(result.later.years),
                days: result.later.daysPerYear ?? 0,
              })}
        </dt>
        <dd className="tabular text-slate-900">{fmt.money(result.later.amount)}</dd>
      </div>
      {result.capApplied ? (
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">{t('Limited to the cap')}</dt>
          <dd className="tabular text-slate-900">{fmt.money(result.cap)}</dd>
        </div>
      ) : null}
      {result.share.numerator !== result.share.denominator ? (
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">
            {t('Share on resignation: {share}', { share: shareText(result) })}
          </dt>
          <dd className="tabular text-slate-900">{fmt.money(result.afterShare)}</dd>
        </div>
      ) : null}
      {result.pifssOffset > 0 ? (
        <div className="flex justify-between gap-3">
          <dt className="text-slate-600">{t('Less PIFSS contributions')}</dt>
          <dd className="tabular text-slate-900">−{fmt.money(result.pifssOffset)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * "End-of-service estimate today": what the employee would get if the
 * employer ended the contract and if they resigned (Labour Law 6/2010
 * art. 51 and 53). For someone who left, the amount at their leaving date.
 */
export function EosiCard({ employee, divisor }: { employee: Employee; divisor: number }) {
  const fmt = useFormat();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const panel = useId();
  const left = employee.status === 'left';
  const until = left && employee.leavingDate ? employee.leavingDate : today();
  const title = left ? t('End of service at leaving') : t('End-of-service estimate today');

  if (!underLabourLaw(employee.category)) {
    return (
      <Card>
        <CardHeader title={title} />
        <CardBody className="text-sm text-slate-600">
          {t(
            'Domestic workers are covered by Law 68/2015, which gives one month’s wage for each year of service. Check with your lawyer.',
          )}
        </CardBody>
      </Card>
    );
  }
  if (!employee.hireDate || employee.basicSalary <= 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <CardBody className="text-sm text-slate-500">
          {t('Add the hire date and the basic salary to see an estimate.')}
        </CardBody>
      </Card>
    );
  }

  const precision = currencyPrecision(fmt.currency);
  const years = serviceYears(employee.hireDate, until);
  const wage = eosWage(employee.basicSalary, employee.allowances, precision);
  const base = {
    payBasis: employee.payBasis,
    monthlyWage: wage,
    years,
    dailyDivisor: divisor,
    pifssOffset: offset,
    precision,
  };
  const results = left
    ? [
        {
          label: null,
          result: calculateEosi({ ...base, reason: eosiReasonFor(employee.leavingReason) }),
        },
      ]
    : [
        {
          label: t('If you end the contract'),
          result: calculateEosi({ ...base, reason: 'termination' }),
        },
        {
          label: t('If they resign'),
          result: calculateEosi({ ...base, reason: 'resignation' }),
        },
      ];
  const main = results[0].result;

  return (
    <Card>
      <CardHeader
        title={title}
        description={t('Labour Law 6/2010, articles 51 and 53. An estimate, not legal advice.')}
      />
      <CardBody className="space-y-4">
        <div className={cn('grid grid-cols-1 gap-3', results.length > 1 && 'sm:grid-cols-2')}>
          {results.map(({ label, result }, i) => (
            <div key={i} className="rounded-lg bg-slate-50 p-4">
              {label ? <p className="text-sm text-slate-600">{label}</p> : null}
              <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                {fmt.money(result.payable)}
              </p>
              {result.share.numerator !== result.share.denominator ? (
                <p className="mt-1 text-xs text-slate-500">
                  {result.share.numerator === 0
                    ? t('Nothing before 3 years of service.')
                    : t('{share} of the full amount.', { share: shareText(result) })}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">{t('Years of service')}</dt>
            <dd className="tabular font-medium text-slate-900">
              {fmt.quantity(Math.round(years * 100) / 100)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('Monthly wage')}</dt>
            <dd className="tabular font-medium text-slate-900">{fmt.money(wage)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">
              {t('Daily wage (÷ {days})', { days: main.dailyDivisor })}
            </dt>
            <dd className="tabular font-medium text-slate-900">{fmt.money(main.dailyWage)}</dd>
          </div>
        </dl>

        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen((o) => !o)}
          >
            {t('How it is worked out')}
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open ? (
            <div id={panel} className="mt-3 space-y-4">
              <Breakdown result={main} />
              <p className="text-xs text-slate-500">
                {employee.payBasis === 'monthly'
                  ? t(
                      '15 days’ wage for each of the first 5 years, then a month’s wage for each year, at most 18 months’ wage. Part years count pro rata.',
                    )
                  : t(
                      '10 days’ wage for each of the first 5 years, then 15 days for each year, at most 12 months’ wage. Part years count pro rata.',
                    )}{' '}
                {t(
                  'The daily wage is the monthly wage divided by the working days in a month; amounts are rounded to the fils at the end.',
                )}
              </p>
              {insuredWithPifss(employee.category) ? (
                <Field
                  label={t('Covered by PIFSS contributions')}
                  hint={t(
                    'For staff insured with PIFSS, the employer pays only the difference over what its contributions already cover. Enter that amount to deduct it.',
                  )}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={offset}
                      onValueChange={setOffset}
                      allowNegative={false}
                      blankZero
                      className="sm:max-w-48"
                    />
                  )}
                </Field>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
