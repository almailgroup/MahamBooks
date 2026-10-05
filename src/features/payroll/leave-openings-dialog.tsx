import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import type { Employee, ISODate } from '@/db/types';
import {
  planLeaveSheet,
  setLeaveOpeningForEveryone,
  setLeaveOpeningsFromSheet,
  type LeaveSheetPlan,
} from '@/db/leave-openings';
import { useCompany, useFormat } from '@/app/company';
import { readImportFile } from '@/features/company/import-columns';
import { useEmployees } from '@/features/people/hooks';
import { employeesNeedingLeaveOpening } from '@/lib/hr/leave';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Field, NumberInput } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { DateField } from '@/components/ui/date-field';
import { Disclosure } from '@/components/ui/disclosure';
import { Badge, Spinner } from '@/components/ui/misc';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { useLeaveRecords } from './hooks';

/** Largest spreadsheet read, as on the import page. */
const MAX_BYTES = 5 * 1024 * 1024;

type Way = 'everyone' | 'sheet';

const byNumber = (a: Employee, b: Employee) =>
  a.number.localeCompare(b.number, undefined, { numeric: true });

/**
 * Opening leave balances for many employees at once: the same days for
 * everyone who has none yet, or each one's own from a spreadsheet. The
 * balances are confirmed.
 */
export function LeaveOpeningsDialog({ onClose }: { onClose: () => void }) {
  const company = useCompany();
  const fmt = useFormat();
  const employees = useEmployees();
  const records = useLeaveRecords();
  const input = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState<ISODate>(`${today().slice(0, 7)}-01`);
  const [way, setWay] = useState<Way>('everyone');
  const [days, setDays] = useState(0);
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const everyone = useMemo(
    () =>
      employees && records ? employeesNeedingLeaveOpening(employees, records).sort(byNumber) : [],
    [employees, records],
  );
  const plan = useMemo(
    () =>
      file && employees && records
        ? planLeaveSheet(file.rows, employees, records, {
            preferDayFirst: !fmt.locale.endsWith('US'),
          })
        : null,
    [file, employees, records, fmt.locale],
  );
  const ready = plan?.rows.filter((r) => r.status === 'ready') ?? [];
  const count = way === 'everyone' ? everyone.length : ready.length;

  const read = async (chosen: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!chosen) return;
    setError('');
    if (chosen.size > MAX_BYTES) {
      setError(t('Please choose a file smaller than 5 MB.'));
      return;
    }
    setReading(true);
    try {
      const rows = await readImportFile(await chosen.arrayBuffer(), chosen.name);
      if (rows.length < 2) {
        setFile(null);
        setError(t('The file needs a row of column names and at least one row of data.'));
      } else setFile({ name: chosen.name, rows });
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : t('Could not read the file.'));
    } finally {
      setReading(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const set =
        way === 'everyone'
          ? await setLeaveOpeningForEveryone(company.id, { date, days })
          : await setLeaveOpeningsFromSheet(
              company.id,
              ready.map((r) => ({
                employeeId: r.employee!.id,
                date: r.date ?? date,
                days: r.days ?? 0,
              })),
            );
      toast.success(
        tp(
          set,
          'Opening leave balance set for {count} employee',
          'Opening leave balances set for {count} employees',
        ),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  const option = (value: Way, title: string, description: string) => (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
        way === value
          ? 'border-primary-500 bg-primary-50/60'
          : 'border-slate-200 hover:bg-slate-50',
      )}
    >
      <input
        type="radio"
        name="leave-openings-way"
        className="accent-primary-600 mt-0.5 size-4 shrink-0"
        checked={way === value}
        onChange={() => setWay(value)}
      />
      <span className="text-sm">
        <span className="block font-medium text-slate-900">{title}</span>
        <span className="block text-slate-500">{description}</span>
      </span>
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        title={t('Set opening leave balances')}
        description={t(
          'The annual leave each employee had left on a date, from your records before. Leave counts from that date: nothing before it is added.',
        )}
        size="lg"
      >
        <DialogBody>
          {!employees || !records ? (
            <Spinner className="py-8" label={t('Loading…')} />
          ) : (
            <>
              <Field
                label={t('As of')}
                hint={t('The date the balances are from, such as the first day of this month.')}
                className="sm:max-w-xs"
              >
                {(id) => <DateField id={id} value={date} onChange={(iso) => iso && setDate(iso)} />}
              </Field>

              <div className="space-y-2">
                {option(
                  'everyone',
                  tp(
                    days,
                    'Everyone without a balance starts at {count} day',
                    'Everyone without a balance starts at {count} days',
                  ),
                  t(
                    'Current employees with no opening balance yet all get the same number of days.',
                  ),
                )}
                {option(
                  'sheet',
                  t('From a spreadsheet'),
                  t(
                    'Each employee’s own balance: columns Employee number and Days, and As of when the dates differ. Excel (.xlsx) or CSV.',
                  ),
                )}
              </div>

              {way === 'everyone' ? (
                <div className="space-y-3">
                  <Field label={t('Days brought forward')} className="sm:max-w-xs">
                    {(id) => (
                      <NumberInput
                        id={id}
                        value={days}
                        onValueChange={setDays}
                        allowNegative={false}
                      />
                    )}
                  </Field>
                  <p className="text-sm text-slate-700">
                    {everyone.length > 0
                      ? tp(
                          everyone.length,
                          'This applies to {count} current employee without an opening balance.',
                          'This applies to {count} current employees without an opening balance.',
                        )
                      : t('Every current employee has an opening leave balance already.')}
                  </p>
                  {everyone.length > 0 ? (
                    <Disclosure label={t('Who')} hint={fmt.quantity(everyone.length)}>
                      <ul className="scroll-thin -my-2 max-h-60 divide-y divide-slate-100 overflow-y-auto text-sm">
                        {everyone.map((e) => (
                          <li key={e.id} className="flex items-center gap-2 py-2">
                            <span className="tabular w-20 shrink-0 text-slate-500">
                              <bdi>{e.number}</bdi>
                            </span>
                            <span className="min-w-0 flex-1 truncate text-slate-900">
                              <bdi>{localName(e)}</bdi>
                            </span>
                            {e.leaveOpening ? (
                              <Badge tone="amber">{t('Not confirmed')}</Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </Disclosure>
                  ) : null}
                  <p className="text-xs text-slate-500">
                    {t(
                      'Employees with an opening balance keep it, and so do staff added when they joined: all their leave is here.',
                    )}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={input}
                      type="file"
                      accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      className="sr-only"
                      tabIndex={-1}
                      aria-label={t('Spreadsheet')}
                      onChange={(e) => void read(e.target.files?.[0])}
                    />
                    <Button
                      variant="outline"
                      onClick={() => input.current?.click()}
                      loading={reading}
                    >
                      <FileUp /> {file ? t('Choose another file') : t('Choose file')}
                    </Button>
                    <span
                      className="flex min-w-0 items-center gap-2 truncate text-sm text-slate-500"
                      dir="auto"
                    >
                      {file ? (
                        <>
                          <FileSpreadsheet
                            className="text-primary-600 size-4 shrink-0"
                            aria-hidden
                          />
                          {file.name}
                        </>
                      ) : (
                        t('Excel (.xlsx) or CSV')
                      )}
                    </span>
                  </div>
                  {plan ? <SheetPreview plan={plan} date={date} /> : null}
                </div>
              )}
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void apply()} loading={busy} disabled={count === 0}>
            {tp(count, 'Set for {count} employee', 'Set for {count} employees')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What a spreadsheet of balances holds: who it matched, and the rows it can't use. */
function SheetPreview({ plan, date }: { plan: LeaveSheetPlan; date: ISODate }) {
  const fmt = useFormat();
  if (plan.missing.length) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {t('The file needs these columns: {columns}.', {
          columns: new Intl.ListFormat(fmt.locale, { type: 'conjunction' }).format(
            plan.missing.map((label) => t(label)),
          ),
        })}
      </p>
    );
  }
  const ready = plan.rows.filter((r) => r.status === 'ready');
  const problems = plan.rows.filter((r) => r.status !== 'ready');
  const replacing = ready.filter((r) => r.replaces).length;
  const asOf = plan.columns.asOf;
  const summary = [
    tp(plan.matched, '{count} matched', '{count} matched'),
    plan.unmatched ? tp(plan.unmatched, '{count} not found', '{count} not found') : '',
    plan.invalid ? tp(plan.invalid, '{count} can’t be read', '{count} can’t be read') : '',
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-900">{summary.join(' · ')}</p>
        <p className="text-xs text-slate-500">
          {t('Employee numbers from “{number}”, days from “{days}”.', {
            number: plan.headers[plan.columns.number ?? -1] ?? '',
            days: plan.headers[plan.columns.days ?? -1] ?? '',
          })}
        </p>
        <p className="text-xs text-slate-500">
          {asOf == null
            ? t('Every balance is as of {date}: the file has no As of column.', {
                date: fmt.date(date),
              })
            : t('Each balance is as of the date in “{column}”, or {date} where it is empty.', {
                column: plan.headers[asOf] ?? '',
                date: fmt.date(date),
              })}
        </p>
        {replacing > 0 ? (
          <p className="text-sm text-amber-800">
            {tp(
              replacing,
              '{count} of them has an opening balance already: the spreadsheet replaces it.',
              '{count} of them have an opening balance already: the spreadsheet replaces it.',
            )}
          </p>
        ) : null}
      </div>

      {problems.length > 0 ? (
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold text-slate-900">{t('Rows not used')}</h3>
          <ul className="scroll-thin max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
            {problems.map((r) => (
              <li key={r.line} className="flex gap-3 px-3 py-2">
                <span className="tabular w-9 shrink-0 text-xs text-slate-500">{r.line}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">
                    <bdi>{r.number || '—'}</bdi>
                    {r.employee ? (
                      <>
                        {' · '}
                        <bdi>{localName(r.employee)}</bdi>
                      </>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'block text-xs',
                      r.status === 'unmatched' ? 'text-slate-600' : 'text-amber-700',
                    )}
                  >
                    {r.problem}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ready.length > 0 ? (
        <Disclosure label={t('Balances to set')} hint={fmt.quantity(ready.length)}>
          <div className="scroll-thin -my-2 max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <th className="py-2 pe-3 text-start">{t('Employee')}</th>
                  <th className="px-3 py-2 text-end">{t('Days')}</th>
                  <th className="py-2 ps-3 text-end">{t('As of')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ready.map((r) => (
                  <tr key={r.line}>
                    <td className="py-2 pe-3">
                      <span className="block truncate text-slate-900">
                        <bdi>{r.employee ? localName(r.employee) : r.number}</bdi>
                      </span>
                      <span className="text-xs text-slate-500">
                        <bdi>{r.employee?.number ?? r.number}</bdi>
                        {r.replaces ? ` · ${t('replaces the balance it had')}` : ''}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2 text-end text-slate-900">
                      {fmt.quantity(r.days ?? 0)}
                    </td>
                    <td className="tabular py-2 ps-3 text-end text-slate-600">
                      {fmt.date(r.date ?? date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
