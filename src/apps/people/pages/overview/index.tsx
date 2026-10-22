import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CalendarDays,
  FileWarning,
  HandCoins,
  IdCard,
  Plane,
  UserPlus,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { useCompany, useFormat } from '@/app/company';
import { useEmployees, usePeopleSettings } from '@/features/people/hooks';
import { useLeaveRecords, usePayrollSettings } from '@/features/payroll/hooks';
import { useRegister } from '@/features/renewals/hooks';
import { EmployeeAvatar, useEmployeePhotos } from '@/features/people/employee-photo';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Spinner } from '@/components/ui/misc';
import { expiryStatus } from '@/lib/compliance';
import { leaveLabel } from '@/lib/hr/leave';
import { today } from '@/lib/dates';
import { localName } from '@/i18n/names';
import { useLanguage } from '@/i18n/provider';
import { msg, t, tp } from '@/i18n';
import { appTitle } from '@/suite/apps';
import { PEOPLE } from '../../manifest';
import {
  awayOn,
  comingUp,
  departments,
  directory,
  newJoiners,
  type MilestoneKind,
} from '../../lib/directory';

/**
 * Maham People's home: the headcount, who is away today, what comes up in
 * the next month and the departments. No salaries: those stay in Payroll.
 */

const MILESTONES: Record<MilestoneKind, string> = {
  probation: msg('Probation ends'),
  contract: msg('Contract ends'),
  joined: msg('Starts'),
};

export default function PeopleOverview() {
  const company = useCompany();
  const fmt = useFormat();
  const { language } = useLanguage();
  const employees = useEmployees();
  const leave = useLeaveRecords();
  const register = useRegister();
  const settings = usePeopleSettings();
  const payroll = usePayrollSettings();
  const list = settings?.departments;
  const photos = useEmployeePhotos(employees);
  const now = today();

  const data = useMemo(() => {
    if (!employees || !leave) return null;
    const away = awayOn(leave, now);
    const contacts = directory(employees, away, list);
    const byId = new Map(employees.map((e) => [e.id, e]));
    return {
      contacts,
      byId,
      away: [...away.values()]
        .filter((r) => byId.has(r.employeeId))
        .sort((a, b) => a.end.localeCompare(b.end)),
      groups: departments(contacts),
      upcoming: comingUp(employees, now),
      joiners: newJoiners(employees, now).length,
    };
  }, [employees, leave, now, list]);

  const papers = useMemo(
    () =>
      register?.entries.filter(
        (e) =>
          e.employeeId &&
          data?.byId.has(e.employeeId) &&
          expiryStatus(e.expiryDate, e.reminderDays, now).status !== 'valid',
      ).length ?? 0,
    [register, data, now],
  );

  if (!data) return <Spinner className="py-24" label={t('Loading…')} />;
  const biggest = data.groups[0]?.count ?? 0;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title={t('Overview')}
        description={
          <>
            {appTitle(PEOPLE, language)} · <span dir="auto">{localName(company)}</span>
          </>
        }
        actions={
          <>
            <ButtonLink to="/people/directory" variant="outline">
              <IdCard /> {t('Directory')}
            </ButtonLink>
            <ButtonLink to="/employees/new">
              <UserPlus /> {t('Add employee')}
            </ButtonLink>
          </>
        }
      />

      <section
        aria-label={t('Key figures')}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
      >
        <Figure
          to="/employees"
          icon={UsersRound}
          label={t('Employees')}
          value={fmt.quantity(data.contacts.length)}
        />
        <Figure
          to="/payroll/leave"
          icon={Plane}
          label={t('Away today')}
          value={fmt.quantity(data.away.length)}
        />
        <Figure
          to="/employees"
          icon={UserPlus}
          label={t('Joined in the last 30 days')}
          value={fmt.quantity(data.joiners)}
        />
        <Figure
          to="/compliance/documents"
          icon={FileWarning}
          label={t('Papers to renew')}
          value={fmt.quantity(papers)}
          warn={papers > 0}
        />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader title={t('Away today')} />
          {data.away.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">{t('Everyone is in today.')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 px-5 py-1">
              {data.away.map((r) => {
                const e = data.byId.get(r.employeeId)!;
                return (
                  <PersonRow
                    key={r.id}
                    to={`/employees/${e.id}`}
                    name={localName(e)}
                    avatar={
                      <EmployeeAvatar
                        employee={e}
                        photo={e.photoId ? photos.get(e.photoId) : undefined}
                      />
                    }
                    detail={`${leaveLabel(r, payroll?.leaveReasons)} · ${t('Until {date}', {
                      date: fmt.date(r.end),
                    })}`}
                  />
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title={t('Coming up')}
            description={tp(30, 'In the next {count} day', 'In the next {count} days')}
          />
          {data.upcoming.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">{t('Nothing in the next month.')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 px-5 py-1">
              {data.upcoming.slice(0, 8).map((m) => {
                const e = data.byId.get(m.employeeId)!;
                return (
                  <PersonRow
                    key={`${m.employeeId}:${m.kind}`}
                    to={`/employees/${e.id}`}
                    name={localName(e)}
                    avatar={
                      <EmployeeAvatar
                        employee={e}
                        photo={e.photoId ? photos.get(e.photoId) : undefined}
                      />
                    }
                    detail={`${t(MILESTONES[m.kind])} · ${fmt.date(m.date)}`}
                  />
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="min-w-0">
          <CardHeader title={t('Departments')} />
          {data.groups.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">{t('No employees yet')}</p>
          ) : (
            <ul className="space-y-2.5 px-5 py-4">
              {data.groups.slice(0, 8).map((g) => (
                <li key={g.name}>
                  <Link
                    to={`/people/directory?department=${encodeURIComponent(g.name)}`}
                    className="block rounded-md hover:bg-slate-50"
                  >
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span dir="auto" className="truncate text-slate-700">
                        {localName(g) || t('No department')}
                      </span>
                      <span className="tabular text-slate-500">{fmt.quantity(g.count)}</span>
                    </span>
                    <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                      <span
                        className="block h-1.5 rounded-full bg-emerald-500"
                        style={{ width: `${Math.max(4, (g.count / biggest) * 100)}%` }}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section aria-label={t('Payroll')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Shortcut to="/payroll" icon={Wallet} label={t('Pay runs')} />
        <Shortcut to="/payroll/leave" icon={CalendarDays} label={t('Leave')} />
        <Shortcut to="/payroll/loans" icon={HandCoins} label={t('Staff loans')} />
      </section>
    </div>
  );
}

function Figure({
  to,
  icon: Icon,
  label,
  value,
  warn = false,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <Link
      to={to}
      className="bg-surface flex min-w-0 flex-col rounded-xl border border-slate-200 p-3.5 shadow-xs transition-colors hover:border-slate-300 sm:p-5"
    >
      <span className="flex items-center gap-2 text-slate-500">
        <Icon className="size-4 shrink-0 text-slate-400" aria-hidden />
        <span className="truncate text-xs font-medium sm:text-sm">{label}</span>
      </span>
      <span
        className={
          warn
            ? 'mt-2 text-2xl font-semibold tracking-tight text-amber-700'
            : 'mt-2 text-2xl font-semibold tracking-tight text-slate-900'
        }
      >
        {value}
      </span>
    </Link>
  );
}

function PersonRow({
  to,
  name,
  avatar,
  detail,
}: {
  to: string;
  name: string;
  avatar: ReactNode;
  detail: string;
}) {
  return (
    <li>
      <Link
        to={to}
        className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-medium text-slate-800">
            {name}
          </span>
          <span className="block truncate text-xs text-slate-500">{detail}</span>
        </span>
      </Link>
    </li>
  );
}

function Shortcut({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      to={to}
      className="bg-surface flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 shadow-xs hover:border-slate-300"
    >
      <Icon className="size-4 text-emerald-700" aria-hidden />
      <span className="flex-1">{label}</span>
      <ArrowRight className="size-4 text-slate-400" aria-hidden />
    </Link>
  );
}
