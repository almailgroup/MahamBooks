import type { ReactNode } from 'react';
import type { ImportPlan, PlannedRow, RowIssue } from '@/db/import';
import type { EmployeeImportProgress } from '@/db/import-employees';
import { useFormat } from '@/app/company';
import { countryName } from '@/lib/geo';
import { isStateless, STATELESS_LABEL } from '@/lib/hr/employees';
import { maskNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import { Disclosure } from '@/components/ui/disclosure';
import { ListCard, ListCards, ResponsiveList } from '@/components/ui/list-card';

/** Rows shown in the table of the preview. */
const TABLE_ROWS = 50;
/** Rows with notes listed in the preview. */
const NOTE_ROWS = 300;

const ISSUE_TONE: Record<RowIssue['level'], string> = {
  error: 'text-red-700',
  skip: 'text-slate-500',
  warning: 'text-amber-700',
  info: 'text-slate-600',
};

interface RowView {
  line: number;
  number: string;
  name: string;
  nameAr: string;
  nationality: string;
  job: string;
  civilId: string;
  state: 'new' | 'update' | 'skipped';
  issues: RowIssue[];
}

function viewOf(row: PlannedRow, locale: string): RowView {
  const record = row.record?.kind === 'employees' ? row.record.value : null;
  const e = record?.employee;
  const cells = row.cells;
  const fallbackName =
    cells.name || [cells.firstName, cells.middleName, cells.lastName].filter(Boolean).join(' ');
  return {
    line: row.line,
    number: e?.number || cells.number,
    name: e?.name ?? fallbackName,
    nameAr: e?.nameAr ?? cells.nameAr,
    nationality: e
      ? isStateless(e)
        ? t(STATELESS_LABEL)
        : countryName(e.nationality, locale)
      : cells.nationality,
    job: e ? localName({ name: e.jobTitle, nameAr: e.jobTitleAr }) : cells.jobTitle,
    civilId: e?.civilId ?? cells.civilId,
    state: !record ? 'skipped' : record.existing ? 'update' : 'new',
    issues: row.issues,
  };
}

function StateBadge({ state }: { state: RowView['state'] }) {
  if (state === 'skipped') return <Badge tone="gray">{t('Skipped')}</Badge>;
  if (state === 'update') return <Badge tone="blue">{t('Update')}</Badge>;
  return <Badge tone="green">{t('New')}</Badge>;
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/**
 * The check before importing employees: one line saying what will happen,
 * the import button, and the details (what was found in the file, the notes
 * on each row and the first rows) folded away.
 */
export function EmployeeImportPreview({
  plan,
  updateExisting,
  onUpdateExisting,
  busy,
  progress,
  onImport,
  blocked,
  residencyColumn,
}: {
  plan: ImportPlan;
  updateExisting: boolean;
  onUpdateExisting: (value: boolean) => void;
  busy: boolean;
  progress: EmployeeImportProgress | null;
  onImport: () => void;
  /** Why importing isn't possible (the person's role), if it isn't. */
  blocked?: string;
  /** Header of the column read as the residency expiry, when it isn't called that. */
  residencyColumn?: string;
}) {
  const fmt = useFormat();
  const summary = plan.employees;
  if (!summary) return null;
  const total = summary.add + summary.update;
  const views = plan.rows.map((row) => viewOf(row, fmt.locale));
  const withNotes = views.filter((v) => v.issues.length > 0);
  const parts = [
    summary.add || !summary.update
      ? tp(summary.add, '{count} employee will be added', '{count} employees will be added')
      : '',
    summary.update
      ? tp(summary.update, '{count} employee will be updated', '{count} employees will be updated')
      : '',
    summary.existing && !updateExisting
      ? tp(
          summary.existing,
          '{count} already in your employees, skipped',
          '{count} already in your employees, skipped',
        )
      : '',
    summary.empty
      ? tp(
          summary.empty,
          '{count} row without a name or number, skipped',
          '{count} rows without a name or number, skipped',
        )
      : '',
    summary.notes ? tp(summary.notes, '{count} note', '{count} notes') : '',
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-base font-medium text-slate-900">{parts.join(' · ')}</p>
        {!summary.salaries && total > 0 ? (
          <p className="text-sm text-slate-500">
            {t('Salaries are not in the file: add them before running payroll.')}
          </p>
        ) : null}
      </div>

      {summary.existing > 0 ? (
        <Checkbox
          label={t('Update existing employees')}
          description={t(
            'Employees already here (same employee number or Civil ID) get the details in the file.',
          )}
          checked={updateExisting}
          onChange={(e) => onUpdateExisting(e.target.checked)}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {progress ? (
          <div className="flex min-w-0 flex-1 items-center gap-3" aria-live="polite">
            <div
              role="progressbar"
              aria-label={t('Importing employees')}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="bg-primary-solid h-full rounded-full transition-[width]"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <span className="tabular shrink-0 text-sm text-slate-600">
              {t('{done} of {total}', { done: progress.done, total: progress.total })}
            </span>
          </div>
        ) : blocked ? (
          <p className="flex-1 text-sm text-slate-500">{blocked}</p>
        ) : null}
        <Button onClick={onImport} loading={busy} disabled={total === 0 || Boolean(blocked)}>
          {tp(total, 'Import {count} employee', 'Import {count} employees')}
        </Button>
      </div>

      <Disclosure
        label={t('Details')}
        hint={summary.notes ? tp(summary.notes, '{count} note', '{count} notes') : undefined}
      >
        <ul className="space-y-1 text-sm text-slate-700">
          {summary.arabicNamesFromFiles ? (
            <Point>
              {tp(
                summary.arabicNamesFromFiles,
                'Arabic name taken from the document file name for {count} employee.',
                'Arabic names taken from the document file names for {count} employees.',
              )}
            </Point>
          ) : null}
          {summary.arabicJobTitles ? (
            <Point>
              {tp(
                summary.arabicJobTitles,
                'Arabic job title filled in for {count} employee.',
                'Arabic job titles filled in for {count} employees.',
              )}
            </Point>
          ) : null}
          {summary.documentExpiry && summary.documentExpiry.total ? (
            <Point>
              {t(
                '“{column}” is read as the residency expiry, which is normally the Civil ID’s: they are the same for {same} of {total} employees.',
                {
                  column: residencyColumn ?? '',
                  same: summary.documentExpiry.sameAsCivilId,
                  total: summary.documentExpiry.total,
                },
              )}
            </Point>
          ) : null}
          {summary.nationalities.mapped ? (
            <Point>
              {tp(
                summary.nationalities.mapped,
                'Nationality recognised for {count} employee.',
                'Nationalities recognised for {count} employees.',
              )}
            </Point>
          ) : null}
          {summary.nationalities.stateless ? (
            <Point>
              {tp(
                summary.nationalities.stateless,
                '{count} stateless (Bedoon) employee: a review card instead of a residency.',
                '{count} stateless (Bedoon) employees: a review card instead of a residency.',
              )}
            </Point>
          ) : null}
          {summary.phones.kuwaiti + summary.phones.international ? (
            <Point>
              {tp(
                summary.phones.kuwaiti + summary.phones.international,
                '{count} mobile number written the standard way.',
                '{count} mobile numbers written the standard way.',
              )}
            </Point>
          ) : null}
          {summary.accountNumbers ? (
            <Point>
              {tp(
                summary.accountNumbers,
                '{count} salary card or account number.',
                '{count} salary card or account numbers.',
              )}
            </Point>
          ) : null}
          {summary.drivingLicences ? (
            <Point>
              {tp(
                summary.drivingLicences,
                '{count} driving licence will be added to the documents register.',
                '{count} driving licences will be added to the documents register.',
              )}
            </Point>
          ) : null}
          {summary.leaveBalances ? (
            <Point>
              {tp(
                summary.leaveBalances,
                'Leave balance of {count} employee brought forward on the import date, confirmed.',
                'Leave balances of {count} employees brought forward on the import date, confirmed.',
              )}
            </Point>
          ) : !summary.leaveBalanceColumn && summary.add > 0 ? (
            <Point>
              {t(
                'Leave balances are not in the file: new employees start with 0 days on the import date until you set them in Payroll → Leave.',
              )}
            </Point>
          ) : null}
          {summary.expired || summary.expiring ? (
            <Point>
              {t('Documents already expired: {expired}. Expiring within 60 days: {expiring}.', {
                expired: summary.expired,
                expiring: summary.expiring,
              })}
            </Point>
          ) : null}
          {!summary.salaries ? (
            <Point>
              {t(
                'Imported employees are active, with a basic salary of 0 until you add their salaries.',
              )}
            </Point>
          ) : null}
        </ul>

        {withNotes.length ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">{t('Notes')}</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {withNotes.slice(0, NOTE_ROWS).map((v) => (
                <li key={v.line} className="flex gap-3 px-3 py-2.5 sm:px-4">
                  <span className="tabular w-9 shrink-0 pt-0.5 text-xs text-slate-500">
                    {v.line}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {v.number || v.name ? (
                        <>
                          {v.number ? <bdi>{v.number}</bdi> : null}
                          {v.number && v.name ? ' · ' : null}
                          {v.name ? <bdi>{v.name}</bdi> : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </p>
                    <ul className="mt-0.5 space-y-0.5 text-xs">
                      {v.issues.map((issue, i) => (
                        <li key={i} className={ISSUE_TONE[issue.level]}>
                          {issue.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
            {withNotes.length > NOTE_ROWS ? (
              <p className="text-xs text-slate-500">
                {t('Showing the first {shown} of {total} rows.', {
                  shown: NOTE_ROWS,
                  total: withNotes.length,
                })}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">{t('Rows')}</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <ResponsiveList
              table={
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs font-medium text-slate-500">
                        <th className="px-3 py-2 text-start">{t('Row')}</th>
                        <th className="px-3 py-2 text-start">{t('Number')}</th>
                        <th className="px-3 py-2 text-start">{t('Name')}</th>
                        <th className="px-3 py-2 text-start">{t('Nationality')}</th>
                        <th className="px-3 py-2 text-start">{t('Job title')}</th>
                        <th className="px-3 py-2 text-start">{t('Civil ID number')}</th>
                        <th className="px-3 py-2 text-end">{t('Status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {views.slice(0, TABLE_ROWS).map((v) => (
                        <tr key={v.line} className={cn(v.state === 'skipped' && 'text-slate-500')}>
                          <td className="tabular px-3 py-2 text-xs text-slate-500">{v.line}</td>
                          <td className="tabular px-3 py-2 whitespace-nowrap" dir="ltr">
                            {v.number || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="block font-medium text-slate-900">
                              <bdi>{v.name || v.nameAr || '—'}</bdi>
                            </span>
                            {v.nameAr && v.nameAr !== v.name ? (
                              <span className="block text-xs text-slate-500">
                                <bdi>{v.nameAr}</bdi>
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{v.nationality || '—'}</td>
                          <td className="px-3 py-2">{v.job || '—'}</td>
                          <td className="tabular px-3 py-2 whitespace-nowrap" dir="ltr">
                            {maskNumber(v.civilId) || '—'}
                          </td>
                          <td className="px-3 py-2 text-end">
                            <StateBadge state={v.state} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              cards={
                <ListCards>
                  {views.slice(0, TABLE_ROWS).map((v) => (
                    <ListCard
                      key={v.line}
                      title={v.name || v.nameAr || '—'}
                      subtitle={[v.number, v.nameAr && v.name ? v.nameAr : '', v.nationality, v.job]
                        .filter(Boolean)
                        .join(' · ')}
                      amount={
                        v.civilId ? (
                          <span className="tabular text-xs font-normal text-slate-500" dir="ltr">
                            {maskNumber(v.civilId)}
                          </span>
                        ) : undefined
                      }
                      status={<StateBadge state={v.state} />}
                    />
                  ))}
                </ListCards>
              }
            />
          </div>
          {views.length > TABLE_ROWS ? (
            <p className="text-xs text-slate-500">
              {t('Showing the first {shown} of {total} rows.', {
                shown: TABLE_ROWS,
                total: views.length,
              })}
            </p>
          ) : null}
        </section>
      </Disclosure>
    </div>
  );
}
