import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CircleCheck, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { PayRun, PayrollSettings, SalaryFileColumn, SalaryFileLayout } from '@/db/types';
import { savePayrollSettings } from '@/db/payroll';
import {
  buildSalaryFile,
  formatSalaryPeriod,
  presetLayout,
  SALARY_FILE_COLUMN_ORDER,
  SALARY_FILE_COLUMNS,
  SALARY_FILE_PRESETS,
} from '@/lib/hr/salary-file';
import { downloadCsv } from '@/lib/csv';
import { payRunTotals } from '@/lib/hr/payroll';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { formatIban } from '@/lib/kuwait';
import { useFormat } from '@/app/company';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/**
 * The bank file that pays the run's salaries into employees' accounts. The
 * columns follow a preset or the company's own layout; the file is only
 * offered when every IBAN is valid, and its total must equal the salaries
 * payable posted for the run.
 */
export function SalaryFileDialog({
  run,
  settings,
  onClose,
}: {
  run: PayRun;
  settings: PayrollSettings;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const precision = currencyPrecision(fmt.currency);
  const [layout, setLayout] = useState<SalaryFileLayout>(settings.salaryFile);
  const [remember, setRemember] = useState(false);
  const reference = t('Salaries {period}', { period: run.period });

  const file = useMemo(
    () =>
      buildSalaryFile(
        run.lines.map((l) => ({
          employeeId: l.employeeId,
          employeeNumber: l.number,
          civilId: l.civilId,
          nameEn: l.name,
          nameAr: l.nameAr,
          iban: l.iban,
          accountNumber: l.accountNumber ?? '',
          amount: l.net,
        })),
        {
          layout,
          period: run.period,
          currency: fmt.currency,
          precision,
          pamFileNumber: settings.pamFileNumber,
          reference,
        },
      ),
    [run, layout, fmt.currency, precision, settings.pamFileNumber, reference],
  );
  const payable = toMinor(payRunTotals(run.lines, precision).net, precision);
  const matches = file.totalMinor === payable;
  const ready = file.problems.length === 0 && matches && file.count > 0;

  const move = (index: number, by: number) =>
    setLayout((l) => {
      const columns = [...l.columns];
      const [col] = columns.splice(index, 1);
      columns.splice(index + by, 0, col);
      return { ...l, preset: 'custom', columns };
    });
  const toggle = (column: SalaryFileColumn, on: boolean) =>
    setLayout((l) => ({
      ...l,
      preset: 'custom',
      columns: on ? [...l.columns, column] : l.columns.filter((c) => c !== column),
    }));

  const save = async () => {
    const name = `salaries-${run.period}.csv`;
    if (layout.header) downloadCsv(name, file.headers, file.rows);
    else downloadCsv(name, file.rows[0] ?? [], file.rows.slice(1));
    if (remember) await savePayrollSettings({ ...settings, salaryFile: layout });
    toast.success(t('Salary file downloaded'));
    onClose();
  };

  const unused = SALARY_FILE_COLUMN_ORDER.filter((c) => !layout.columns.includes(c));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Salary transfer file')}
        description={t(
          'Upload it to your bank’s corporate service to pay the salaries. Banks use different layouts: ask yours and set the columns to match.',
        )}
        size="lg"
      >
        <DialogBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Layout')}>
              {(id) => (
                <Select
                  id={id}
                  value={layout.preset}
                  onChange={(e) =>
                    e.target.value !== 'custom' && setLayout(presetLayout(e.target.value))
                  }
                >
                  {SALARY_FILE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(p.label)}
                    </option>
                  ))}
                  <option value="custom">{t('Custom')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('Salary month as')}>
              {(id) => (
                <Select
                  id={id}
                  value={layout.periodFormat}
                  onChange={(e) =>
                    setLayout((l) => ({
                      ...l,
                      preset: 'custom',
                      periodFormat: e.target.value as SalaryFileLayout['periodFormat'],
                    }))
                  }
                >
                  {(['yyyymm', 'yyyy-mm', 'mm/yyyy'] as const).map((f) => (
                    <option key={f} value={f}>
                      {formatSalaryPeriod(run.period, f)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">{t('Columns, in order')}</p>
            <ol className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {layout.columns.map((c, i) => (
                <li key={c} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="tabular w-5 text-slate-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-slate-800">
                    {t(SALARY_FILE_COLUMNS[c].label)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={t('Move up')}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === layout.columns.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t('Move down')}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={layout.columns.length === 1}
                    onClick={() => toggle(c, false)}
                  >
                    {t('Remove')}
                  </Button>
                </li>
              ))}
            </ol>
            {unused.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {unused.map((c) => (
                  <Button key={c} variant="outline" size="xs" onClick={() => toggle(c, true)}>
                    + {t(SALARY_FILE_COLUMNS[c].label)}
                  </Button>
                ))}
              </div>
            ) : null}
            <Checkbox
              className="mt-3"
              label={t('First row has the column names')}
              checked={layout.header}
              onChange={(e) =>
                setLayout((l) => ({ ...l, preset: 'custom', header: e.target.checked }))
              }
            />
          </div>

          {file.problems.length > 0 ? (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">
                {t('Add a valid IBAN or a salary card number for these employees first:')}
              </p>
              <ul className="mt-1 list-disc ps-5">
                {file.problems.map((p) => (
                  <li key={p.employeeId}>
                    {localName({ name: p.nameEn, nameAr: p.nameAr })}
                    {p.iban ? (
                      <span className="ms-1 font-mono text-xs" dir="ltr">
                        {formatIban(p.iban)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <p className="text-slate-700">
              {t('{count} transfers, total {amount}', {
                count: file.count,
                amount: fmt.money(fromMinor(file.totalMinor, precision)),
              })}
            </p>
            {matches ? (
              <p className="mt-1 flex items-center gap-1.5 text-emerald-700">
                <CircleCheck className="size-4" aria-hidden />
                {t('Matches the salaries payable in the books.')}
              </p>
            ) : (
              <p className="mt-1 text-red-700">
                {t('Doesn’t match the salaries payable of {amount}.', {
                  amount: fmt.money(fromMinor(payable, precision)),
                })}
              </p>
            )}
          </div>

          {file.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200" dir="ltr">
              <table className="w-full text-xs">
                {layout.header ? (
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {file.headers.map((h) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 text-start font-medium whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody className="divide-y divide-slate-100 font-mono">
                  {file.rows.slice(0, 3).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-2 py-1.5 whitespace-nowrap text-slate-700">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <Checkbox
            label={t('Use this layout next time')}
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={!ready}>
            <Download /> {t('Download file')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
