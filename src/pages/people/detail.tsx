import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteEmployee } from '@/db/people';
import { addAttachment, removeAttachment } from '@/db/purchases';
import { useCompany, useFormat } from '@/app/company';
import {
  CATEGORY_LABELS,
  CONTRACT_LABELS,
  LEAVING_REASON_LABELS,
  PAY_BASIS_LABELS,
  RESIDENCY_ARTICLES,
  STATUS_LABELS,
  needsResidency,
} from '@/lib/hr/employees';
import { DOCUMENT_TYPES, normalizeReminderDays } from '@/lib/compliance';
import { bankFromIban, formatIban, KUWAIT_BANKS } from '@/lib/kuwait';
import { countryName } from '@/lib/geo';
import { currencyPrecision, dec, round } from '@/lib/money';
import { serviceYears } from '@/lib/hr/eosi';
import { today } from '@/lib/dates';
import { EmployeeDocuments } from '@/features/people/employee-documents';
import { EosiCard } from '@/features/people/eosi-card';
import { FileList } from '@/features/people/file-list';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { EndOfServiceTab, LeaveTab, LoansTab } from '@/features/payroll/employee-tabs';
import { employeeHasPayroll } from '@/db/payroll';
import { cn } from '@/lib/cn';
import { ButtonLink, Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { msg, t } from '@/i18n';

type Tab = 'overview' | 'leave' | 'loans' | 'eos';
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: msg('Overview') },
  { value: 'leave', label: msg('Leave') },
  { value: 'loans', label: msg('Loans') },
  { value: 'eos', label: msg('End of service') },
];

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-end break-words text-slate-900">{children || '—'}</dd>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const { language } = useLanguage();
  const employee = useLiveQuery(() => db.employees.get(id), [id]);
  const records = useLiveQuery(
    () => db.complianceDocuments.where('employeeId').equals(id).toArray(),
    [id],
  );
  const renewals = useLiveQuery(() => db.renewals.where('employeeId').equals(id).toArray(), [id]);
  const files = useLiveQuery(() => db.attachments.where('ownerId').equals(id).toArray(), [id]);
  const employees = useEmployees();
  const settings = usePeopleSettings();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((x) => x.value === params.get('tab'))?.value ?? 'overview';

  if (employee === undefined || !records || !renewals || !files || !employees || !settings) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!employee || employee.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This employee could not be found.')}</p>
        <Link to="/employees" className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to employees')}
        </Link>
      </Card>
    );
  }

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete {name}?', { name: localName(employee) }),
      description: t(
        'Their personnel file is deleted too. This cannot be undone. Employees with documents or renewals on record can only be marked as left.',
      ),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      if (await employeeHasPayroll(employee)) {
        toast.error(t('This employee has payroll records. Mark them as left instead.'));
        return;
      }
      await deleteEmployee(employee.id);
      toast.success(t('Employee deleted'));
      navigate('/employees');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not delete the employee.'));
    }
  };

  const places = currencyPrecision(company.currency);
  const monthlyPay = round(
    employee.allowances.reduce((s, a) => s.plus(dec(a.amount)), dec(employee.basicSalary)),
    places,
  );
  const job = localName({ name: employee.jobTitle, nameAr: employee.jobTitleAr });
  const bank =
    KUWAIT_BANKS.find((b) => b.code === employee.bank) ?? bankFromIban(employee.iban) ?? null;
  const years = employee.hireDate
    ? serviceYears(employee.hireDate, employee.leavingDate ?? today())
    : null;
  const article = RESIDENCY_ARTICLES.find((a) => a.value === employee.residencyArticle);
  const history = [...renewals].sort((a, b) => b.renewedOn.localeCompare(a.renewedOn));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to="/employees" className="hover:text-slate-700">
              {t('Employees')}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {localName(employee)}
            </h1>
            <Badge
              tone={
                employee.status === 'active'
                  ? 'green'
                  : employee.status === 'on_leave'
                    ? 'blue'
                    : 'slate'
              }
            >
              {t(STATUS_LABELS[employee.status])}
            </Badge>
            <Badge tone="gray">{t(CATEGORY_LABELS[employee.category])}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[employee.number, job, employee.department].filter(Boolean).join(' · ')}
          </p>
          {employee.nameAr?.trim() ? (
            <p className="text-sm text-slate-500">
              <bdi>{language === 'ar' ? employee.name : employee.nameAr}</bdi>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink to={`/employees/${employee.id}/edit`} variant="outline">
            <Pencil /> {t('Edit')}
          </ButtonLink>
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('More actions')}>
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                {t('Delete employee')}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={t('Employee sections')}
        className="-mt-2 flex gap-6 overflow-x-auto border-b border-slate-200"
      >
        {TABS.map((x) => (
          <button
            key={x.value}
            type="button"
            role="tab"
            aria-selected={tab === x.value}
            onClick={() =>
              setParams(x.value === 'overview' ? {} : { tab: x.value }, { replace: true })
            }
            className={cn(
              'border-b-2 px-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              tab === x.value
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            {t(x.label)}
          </button>
        ))}
      </div>

      {tab === 'leave' ? <LeaveTab employee={employee} /> : null}
      {tab === 'loans' ? <LoansTab employee={employee} /> : null}
      {tab === 'eos' ? (
        <EndOfServiceTab employee={employee} divisor={settings.eosDailyDivisor} />
      ) : null}
      {tab !== 'overview' ? null : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <EmployeeDocuments
              employee={employee}
              records={records}
              employees={employees}
              reminderDays={normalizeReminderDays(settings.reminderDays)}
            />
            <EosiCard employee={employee} divisor={settings.eosDailyDivisor} />
            <Card>
              <CardHeader
                title={t('Personnel file')}
                description={t(
                  'Keep copies of the contract, work permit and Civil ID here (Labour Law art. 80).',
                )}
              />
              <CardBody>
                <FileList
                  files={files}
                  onAdd={async (file) => {
                    await addAttachment(company.id, employee.id, file);
                    toast.success(t('File added'));
                  }}
                  onRemove={async (file) => {
                    const ok = await confirm({
                      title: t('Remove {name}?', { name: file.name }),
                      confirmLabel: t('Remove'),
                      danger: true,
                    });
                    if (ok) await removeAttachment(file.id);
                  }}
                  emptyText={t('No files yet.')}
                />
              </CardBody>
            </Card>
            {history.length > 0 ? (
              <Card>
                <CardHeader title={t('Renewals')} />
                <ul className="divide-y divide-slate-100">
                  {history.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {t(DOCUMENT_TYPES[r.type].label)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {t('Renewed on {date}, valid until {expiry}', {
                            date: fmt.date(r.renewedOn),
                            expiry: fmt.date(r.newExpiry),
                          })}
                        </p>
                      </div>
                      {r.fee > 0 ? (
                        r.expenseId ? (
                          <Link
                            to={`/expenses?open=${r.expenseId}`}
                            className="tabular text-primary-700 font-medium hover:underline"
                          >
                            {fmt.money(r.fee)}
                          </Link>
                        ) : (
                          <span className="tabular text-slate-700">{fmt.money(r.fee)}</span>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title={t('Details')} />
              <CardBody className="py-2">
                <dl className="divide-y divide-slate-100">
                  <Row label={t('Nationality')}>
                    {countryName(employee.nationality, fmt.locale)}
                  </Row>
                  <Row label={t('Civil ID number')}>
                    {employee.civilId ? <span dir="ltr">{employee.civilId}</span> : null}
                  </Row>
                  {needsResidency(employee.category) ? (
                    <Row label={t('Residency article')}>{article ? t(article.label) : ''}</Row>
                  ) : null}
                  {employee.pifssNumber ? (
                    <Row label={t('PIFSS number')}>
                      <span dir="ltr">{employee.pifssNumber}</span>
                    </Row>
                  ) : null}
                  <Row label={t('Hire date')}>{fmt.date(employee.hireDate)}</Row>
                  {years !== null ? (
                    <Row label={t('Years of service')}>
                      <span className="tabular">{fmt.quantity(Math.round(years * 100) / 100)}</span>
                    </Row>
                  ) : null}
                  {employee.probationEnd ? (
                    <Row label={t('Probation ends')}>{fmt.date(employee.probationEnd)}</Row>
                  ) : null}
                  <Row label={t('Contract')}>
                    {employee.contractType === 'fixed' && employee.contractEnd
                      ? t('Fixed term until {date}', { date: fmt.date(employee.contractEnd) })
                      : t(CONTRACT_LABELS[employee.contractType])}
                  </Row>
                  {employee.status === 'left' ? (
                    <Row label={t('Left on')}>
                      {[
                        fmt.date(employee.leavingDate),
                        employee.leavingReason
                          ? t(LEAVING_REASON_LABELS[employee.leavingReason])
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Row>
                  ) : null}
                  <Row label={t('Mobile')}>
                    {employee.phone ? (
                      <a href={`tel:${employee.phone.replace(/\s/g, '')}`} dir="ltr">
                        {employee.phone}
                      </a>
                    ) : null}
                  </Row>
                  <Row label={t('Email')}>
                    {employee.email ? (
                      <a href={`mailto:${employee.email}`} className="break-all">
                        {employee.email}
                      </a>
                    ) : null}
                  </Row>
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('Pay')} />
              <CardBody className="py-2">
                <dl className="divide-y divide-slate-100">
                  <Row label={t('Pay basis')}>{t(PAY_BASIS_LABELS[employee.payBasis])}</Row>
                  <Row label={t('Basic salary')}>
                    <span className="tabular">{fmt.money(employee.basicSalary)}</span>
                  </Row>
                  {employee.allowances.map((a) => (
                    <Row key={a.id} label={localName(a)}>
                      <span className="tabular">{fmt.money(a.amount)}</span>
                    </Row>
                  ))}
                  <Row
                    label={<span className="font-medium text-slate-700">{t('Monthly pay')}</span>}
                  >
                    <span className="tabular font-semibold">{fmt.money(monthlyPay)}</span>
                  </Row>
                  {bank || employee.iban ? (
                    <Row label={t('Bank')}>
                      <span className="block">{bank ? bank.name[language] : employee.bank}</span>
                      {employee.iban ? (
                        <span className="block font-mono text-xs text-slate-500" dir="ltr">
                          {formatIban(employee.iban)}
                        </span>
                      ) : null}
                    </Row>
                  ) : null}
                </dl>
              </CardBody>
            </Card>
            {employee.notes ? (
              <Card>
                <CardHeader title={t('Notes')} />
                <CardBody className="text-sm whitespace-pre-wrap text-slate-700">
                  {employee.notes}
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
