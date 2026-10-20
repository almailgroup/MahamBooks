import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Download,
  FilePlus2,
  FileUp,
  FileWarning,
  IdCard,
  ImagePlus,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { useCompany, useFormat } from '@/app/company';
import type { EmployeeCategory } from '@/db/types';
import {
  CATEGORY_LABELS,
  categoryLabel,
  employeeStatusLabel,
  isCurrent,
  workforceSummary,
} from '@/lib/hr/employees';
import { expiryStatus, type ExpiryInfo, type RegisterEntry } from '@/lib/compliance';
import { downloadCsv } from '@/lib/csv';
import { countryName } from '@/lib/geo';
import { currencyPrecision, dec, round } from '@/lib/money';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { useRegister } from '@/features/renewals/hooks';
import { entryTitle, ExpiryBadge } from '@/features/renewals/display';
import { ComplianceSettingsDialog } from '@/features/renewals/settings-dialog';
import { BulkDocumentsDialog } from '@/features/people/bulk-documents-dialog';
import { EmployeeAvatar, useEmployeePhotos } from '@/features/people/employee-photo';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

type View = 'current' | 'left' | 'all';
const CATEGORIES: EmployeeCategory[] = ['kuwaiti', 'gcc', 'expat', 'domestic'];

/** The most urgent document of each employee: expired first, then the soonest to expire. */
function worstDocuments(entries: RegisterEntry[], on: string) {
  const worst = new Map<string, { entry: RegisterEntry; info: ExpiryInfo }>();
  for (const entry of entries) {
    if (!entry.employeeId) continue;
    const info = expiryStatus(entry.expiryDate, entry.reminderDays, on);
    if (info.status === 'valid') continue;
    const before = worst.get(entry.employeeId);
    if (!before || (info.daysLeft ?? 0) < (before.info.daysLeft ?? 0)) {
      worst.set(entry.employeeId, { entry, info });
    }
  }
  return worst;
}

export default function EmployeeListPage() {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const employees = useEmployees();
  const settings = usePeopleSettings();
  const register = useRegister();
  const [view, setView] = useState<View>('current');
  const [category, setCategory] = useState<EmployeeCategory | ''>('');
  const [department, setDepartment] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulk, setBulk] = useState<'documents' | 'photos' | null>(null);
  const photos = useEmployeePhotos(employees);

  const on = today();
  const worst = useMemo(() => worstDocuments(register?.entries ?? [], on), [register, on]);
  const departments = useMemo(
    () =>
      [...new Set((employees ?? []).map((e) => e.department.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [employees],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (employees ?? [])
      .filter((e) => (view === 'all' ? true : view === 'left' ? !isCurrent(e) : isCurrent(e)))
      .filter((e) => !category || e.category === category)
      .filter((e) => !department || e.department.trim() === department)
      .filter((e) => !expiringOnly || worst.has(e.id))
      .filter(
        (e) =>
          !q ||
          [
            e.name,
            e.nameAr,
            e.number,
            e.civilId,
            e.jobTitle,
            e.jobTitleAr,
            e.department,
            e.phone,
            e.email,
          ]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => localName(a).localeCompare(localName(b)));
  }, [employees, view, category, department, expiringOnly, worst, query]);

  if (!employees || !settings || !register) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }

  const places = currencyPrecision(company.currency);
  const monthlyPay = (e: (typeof employees)[number]) =>
    round(
      e.allowances.reduce((s, a) => s.plus(dec(a.amount)), dec(e.basicSalary)),
      places,
    );
  const summary = workforceSummary(employees);
  const current = employees.filter(isCurrent);
  const target = settings.kuwaitizationTarget;
  const share = summary.kuwaitiShare;
  const belowTarget = target !== null && share !== null && share < target;
  const withExpiring = current.filter((e) => worst.has(e.id)).length;

  const exportCsv = () =>
    downloadCsv(
      `employees-${on}`,
      [
        t('Number'),
        t('Name (English)'),
        t('Name (Arabic)'),
        t('Nationality'),
        t('Category'),
        t('Civil ID number'),
        t('Job title'),
        t('Department'),
        t('Hire date'),
        t('Basic salary'),
        t('Monthly pay'),
        t('IBAN'),
        t('Status'),
      ],
      filtered.map((e) => [
        e.number,
        e.name,
        e.nameAr ?? '',
        countryName(e.nationality, fmt.locale),
        t(categoryLabel(e.category)),
        e.civilId,
        e.jobTitle,
        e.department,
        e.hireDate ?? '',
        e.basicSalary,
        monthlyPay(e),
        e.iban,
        t(employeeStatusLabel(e.status)),
      ]),
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Employees')}
        description={t('Your staff, their papers and end-of-service estimates.')}
        actions={
          <>
            {employees.length > 0 ? (
              <>
                <Button variant="outline" onClick={exportCsv}>
                  <Download /> {t('Export CSV')}
                </Button>
                <ButtonLink to="/settings/import?kind=employees" variant="outline">
                  <FileUp /> {t('Import')}
                </ButtonLink>
                <Button variant="outline" onClick={() => setBulk('documents')}>
                  <FilePlus2 /> {t('Add documents')}
                </Button>
                <Button variant="outline" onClick={() => setBulk('photos')}>
                  <ImagePlus /> {t('Add photos')}
                </Button>
              </>
            ) : null}
            <ButtonLink to="/employees/new">
              <Plus /> {t('New employee')}
            </ButtonLink>
          </>
        }
      />

      {employees.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IdCard />}
            title={t('No employees yet')}
            description={t(
              'Add your staff to track Civil IDs, residencies and work permits, and to estimate end-of-service pay.',
            )}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to="/employees/new">
                  <Plus /> {t('New employee')}
                </ButtonLink>
                <ButtonLink to="/settings/import?kind=employees" variant="outline">
                  <FileUp /> {t('Import from a spreadsheet')}
                </ButtonLink>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="p-5">
              <p className="text-sm font-medium text-slate-500">{t('Headcount')}</p>
              <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {fmt.quantity(summary.headcount)}
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                {CATEGORIES.filter((c) => summary.byCategory[c] > 0).map((c) => (
                  <li key={c}>
                    {t(CATEGORY_LABELS[c])}:{' '}
                    <span className="tabular font-medium text-slate-700">
                      {fmt.quantity(summary.byCategory[c])}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-500">{t('Kuwaiti staff')}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t('Set the Kuwaiti staff target')}
                  title={t('Set the Kuwaiti staff target')}
                >
                  <Settings2 />
                </Button>
              </div>
              <p
                className={cn(
                  'tabular mt-1 text-2xl font-semibold tracking-tight',
                  belowTarget ? 'text-amber-700' : 'text-slate-900',
                )}
              >
                {share === null ? '—' : fmt.percent(share)}
              </p>
              <div
                className="relative mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={
                  target !== null
                    ? t('{share} Kuwaiti against a target of {target}', {
                        share: share === null ? '—' : fmt.percent(share),
                        target: fmt.percent(target),
                      })
                    : t('Kuwaiti share of the staff')
                }
              >
                <div
                  className={cn(
                    'absolute inset-y-0 start-0 rounded-full',
                    belowTarget ? 'bg-amber-500' : 'bg-emerald-500',
                  )}
                  style={{ width: `${Math.min(100, share ?? 0)}%` }}
                />
                {target !== null ? (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-slate-700"
                    style={{ insetInlineStart: `${Math.min(100, target)}%` }}
                  />
                ) : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {target !== null
                  ? belowTarget
                    ? t('Below the {target} target.', { target: fmt.percent(target) })
                    : t('Meets the {target} target.', { target: fmt.percent(target) })
                  : t('Without domestic workers. Set a target to track it.')}
              </p>
            </Card>
            <Card className="p-5 sm:col-span-2 lg:col-span-1">
              <p className="text-sm font-medium text-slate-500">{t('Papers to renew')}</p>
              <p
                className={cn(
                  'tabular mt-2 text-2xl font-semibold tracking-tight',
                  withExpiring ? 'text-amber-700' : 'text-slate-900',
                )}
              >
                {fmt.quantity(withExpiring)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {withExpiring
                  ? t('Employees with a document expiring or expired.')
                  : t('Every employee’s papers are valid.')}{' '}
                <Link
                  to="/compliance/documents"
                  className="text-primary-700 font-medium hover:underline"
                >
                  {t('Open the register')}
                </Link>
              </p>
            </Card>
          </div>

          <Card>
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'current', label: t('Current employees'), count: current.length },
                  { value: 'left', label: t('Left'), count: employees.length - current.length },
                  { value: 'all', label: t('All'), count: employees.length },
                ]}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as EmployeeCategory | '')}
                  aria-label={t('Category')}
                  className="sm:w-44"
                >
                  <option value="">{t('All categories')}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(CATEGORY_LABELS[c])}
                    </option>
                  ))}
                </Select>
                {departments.length > 0 ? (
                  <Select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    aria-label={t('Department')}
                    className="sm:w-44"
                  >
                    <option value="">{t('All departments')}</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <Button
                  variant={expiringOnly ? 'subtle' : 'outline'}
                  aria-pressed={expiringOnly}
                  onClick={() => setExpiringOnly((v) => !v)}
                >
                  <FileWarning /> {t('Documents expiring')}
                </Button>
                <div className="relative sm:w-64">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('Search employees…')}
                    aria-label={t('Search employees')}
                    className="ps-9"
                  />
                </div>
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">
                {t('No employees match.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                      <th className="px-5 py-3 text-start">{t('Employee')}</th>
                      <th className="hidden px-3 py-3 text-start md:table-cell">{t('Category')}</th>
                      <th className="hidden px-3 py-3 text-start lg:table-cell">
                        {t('Department')}
                      </th>
                      <th className="hidden px-3 py-3 text-start lg:table-cell">
                        {t('Hire date')}
                      </th>
                      <th className="hidden px-3 py-3 text-end sm:table-cell">
                        {t('Monthly pay')}
                      </th>
                      <th className="px-5 py-3 text-end">{t('Documents')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((e) => {
                      const doc = worst.get(e.id);
                      const job = localName({ name: e.jobTitle, nameAr: e.jobTitleAr });
                      return (
                        <tr
                          key={e.id}
                          onClick={() => navigate(`/employees/${e.id}`)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <EmployeeAvatar
                                employee={e}
                                photo={e.photoId ? photos.get(e.photoId) : undefined}
                                size="md"
                              />
                              <div className="min-w-0">
                                <Link
                                  to={`/employees/${e.id}`}
                                  onClick={(ev) => ev.stopPropagation()}
                                  className="hover:text-primary-700 font-medium text-slate-900"
                                >
                                  {localName(e)}
                                </Link>
                                <span className="block text-xs text-slate-500">
                                  {[e.number, job].filter(Boolean).join(' · ')}
                                </span>
                                {e.status !== 'active' ? (
                                  <Badge
                                    tone={e.status === 'left' ? 'slate' : 'blue'}
                                    className="mt-1"
                                  >
                                    {t(employeeStatusLabel(e.status))}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-3 py-3 text-slate-600 md:table-cell">
                            <span className="block">{t(categoryLabel(e.category))}</span>
                            <span className="block text-xs text-slate-500">
                              {countryName(e.nationality, fmt.locale)}
                            </span>
                          </td>
                          <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                            {e.department || '—'}
                          </td>
                          <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                            {fmt.date(e.hireDate) || '—'}
                          </td>
                          <td className="tabular hidden px-3 py-3 text-end text-slate-700 sm:table-cell">
                            {fmt.money(monthlyPay(e))}
                          </td>
                          <td className="px-5 py-3 text-end">
                            {doc && isCurrent(e) ? (
                              <span className="inline-flex flex-col items-end gap-0.5">
                                <ExpiryBadge info={doc.info} />
                                <span className="text-xs text-slate-500">
                                  {entryTitle(doc.entry)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {settingsOpen ? (
        <ComplianceSettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} />
      ) : null}
      {bulk ? (
        <BulkDocumentsDialog kind={bulk} employees={employees} onClose={() => setBulk(null)} />
      ) : null}
    </div>
  );
}
