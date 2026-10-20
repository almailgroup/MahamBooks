import { useEffect, useMemo, useState } from 'react';
import { Building2, Download, Search } from 'lucide-react';
import { useFormat, useOpenInCompany } from '@/app/company';
import {
  CATEGORY_FILTER_LABELS,
  CATEGORY_FILTERS,
  categoryLabel,
  employeeStatusLabel,
  isCurrent,
  type CategoryFilter,
} from '@/lib/hr/employees';
import { downloadCsv } from '@/lib/csv';
import { today } from '@/lib/dates';
import {
  companyTypesOf,
  departmentsOf,
  employeesCsv,
  findEmployees,
  loadFilters,
  saveFilters,
  type EmployeeFilters,
  type EmployeeView,
} from '@/features/people/all-companies';
import { useEmployeesEverywhere, usePeopleCompanies } from '@/features/people/hooks';
import { GroupSearchSwitches } from '@/features/people/group-search';
import { EmployeeAvatar, useEmployeePhotos } from '@/features/people/employee-photo';
import { companyTypeName } from '@/features/company/company-types';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Segmented,
  Spinner,
} from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

/**
 * The employees of every company switched on for the search across
 * companies, on this device: find someone whatever company they work for,
 * then open them in their company. Each company is judged by its own role
 * (see features/people/all-companies.ts). No pay, IBAN or Civil ID shows
 * here or goes into the spreadsheet.
 */
export default function AllCompaniesPage() {
  const fmt = useFormat();
  const { language } = useLanguage();
  const group = usePeopleCompanies();
  const everywhere = useEmployeesEverywhere();
  const openInCompany = useOpenInCompany();
  const [filters, setFilters] = useState<EmployeeFilters>(loadFilters);
  const [query, setQuery] = useState('');
  useEffect(() => saveFilters(filters), [filters]);
  const set = (patch: Partial<EmployeeFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const companies = useMemo(() => everywhere?.companies ?? [], [everywhere]);
  const employees = useMemo(() => everywhere?.employees ?? [], [everywhere]);
  const types = useMemo(() => companyTypesOf(companies, language), [companies, language]);
  const departments = useMemo(() => departmentsOf(employees), [employees]);
  // A remembered company, type or department no longer here counts as all.
  const active: EmployeeFilters = {
    view: filters.view ?? 'current',
    category: filters.category,
    companyId: companies.some((c) => c.id === filters.companyId) ? filters.companyId : undefined,
    typeId: types.some((type) => type.id === filters.typeId) ? filters.typeId : undefined,
    department: departments.includes(filters.department ?? '') ? filters.department : undefined,
    query,
  };
  const shown = findEmployees(employees, companies, active);
  const companyOf = new Map(companies.map((c) => [c.id, c]));
  const photos = useEmployeePhotos(employees);

  if (!group || !everywhere) return <Spinner className="py-24" label={t('Loading…')} />;

  const current = employees.filter(isCurrent).length;
  const exportCsv = () => {
    const { headers, rows } = employeesCsv(shown, companies, fmt.locale);
    downloadCsv(`employees-all-companies-${today()}`, headers, rows);
  };
  const switches = (
    <Card>
      <CardHeader
        title={t('Companies searched')}
        description={t(
          'Switch on the companies whose employees you want to find here and in search.',
        )}
      />
      <CardBody>
        <GroupSearchSwitches group={group} />
      </CardBody>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('All companies')}
        description={
          companies.length
            ? tp(
                companies.length,
                'Employees of {count} company on this device',
                'Employees of {count} companies on this device',
              )
            : t('Employees of the companies on this device')
        }
        actions={
          shown.length > 0 ? (
            <Button variant="outline" onClick={exportCsv}>
              <Download /> {t('Export CSV')}
            </Button>
          ) : null
        }
      />

      {companies.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 />}
            title={t('No company is switched on yet')}
            description={t(
              'Switch on below the companies whose employees you want to find from one place.',
            )}
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
            <Segmented
              value={active.view ?? 'current'}
              onChange={(view: EmployeeView) => set({ view })}
              options={[
                { value: 'current', label: t('Current employees'), count: current },
                { value: 'left', label: t('Left'), count: employees.length - current },
                { value: 'all', label: t('All'), count: employees.length },
              ]}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search employees…')}
                  aria-label={t('Search employees')}
                  className="ps-9"
                />
              </div>
              <Select
                value={active.companyId ?? ''}
                onChange={(e) => set({ companyId: e.target.value || undefined })}
                aria-label={t('Company')}
                className="sm:w-48"
              >
                <option value="">{t('All companies')}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localName(c)}
                  </option>
                ))}
              </Select>
              {types.length > 0 ? (
                <Select
                  value={active.typeId ?? ''}
                  onChange={(e) => set({ typeId: e.target.value || undefined })}
                  aria-label={t('Company type')}
                  className="sm:w-48"
                >
                  <option value="">{t('All types')}</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {companyTypeName(type, language)}
                    </option>
                  ))}
                </Select>
              ) : null}
              {departments.length > 0 ? (
                <Select
                  value={active.department ?? ''}
                  onChange={(e) => set({ department: e.target.value || undefined })}
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
              <Select
                value={active.category ?? ''}
                onChange={(e) =>
                  set({ category: (e.target.value || undefined) as CategoryFilter | undefined })
                }
                aria-label={t('Category')}
                className="sm:w-44"
              >
                <option value="">{t('All categories')}</option>
                {CATEGORY_FILTERS.map((c) => (
                  <option key={c} value={c}>
                    {t(CATEGORY_FILTER_LABELS[c])}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {employees.length ? t('No employees match.') : t('No employees yet')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label={t('Employees')}>
                <thead>
                  <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3 text-start">{t('Employee')}</th>
                    <th className="px-3 py-3 text-start">{t('Company')}</th>
                    <th className="hidden px-3 py-3 text-start md:table-cell">{t('Department')}</th>
                    <th className="hidden px-5 py-3 text-start lg:table-cell">{t('Category')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((e) => {
                    const company = companyOf.get(e.companyId);
                    const job = localName({ name: e.jobTitle, nameAr: e.jobTitleAr });
                    const type = companyTypeName(company?.companyType, language);
                    const open = () => void openInCompany(e.companyId, `/employees/${e.id}`);
                    return (
                      <tr key={e.id} onClick={open} className="cursor-pointer hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <EmployeeAvatar
                              employee={e}
                              photo={e.photoId ? photos.get(e.photoId) : undefined}
                              size="md"
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  open();
                                }}
                                className="hover:text-primary-700 text-start font-medium text-slate-900"
                              >
                                {localName(e)}
                              </button>
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
                        <td className="px-3 py-3 text-slate-600">
                          <bdi className="block">{localName(company)}</bdi>
                          {type ? (
                            <span className="block text-xs text-slate-500">{type}</span>
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-3 text-slate-600 md:table-cell">
                          {e.department || '—'}
                        </td>
                        <td className="hidden px-5 py-3 text-slate-600 lg:table-cell">
                          {t(categoryLabel(e))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {switches}
    </div>
  );
}
