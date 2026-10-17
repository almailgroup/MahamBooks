import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Mail, Phone, Search, UsersRound } from 'lucide-react';
import { useEmployees } from '@/features/people/hooks';
import { useLeaveRecords } from '@/features/payroll/hooks';
import { EmployeeAvatar, useEmployeePhotos } from '@/features/people/employee-photo';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { ButtonLink } from '@/components/ui/button';
import { today } from '@/lib/dates';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { awayOn, departments, directory, findContacts, type Contact } from '../../lib/directory';

/**
 * Who works here and how to reach them: a card per person with their job,
 * department, phone and email. Nothing else of the personnel file shows.
 */
export default function DirectoryPage() {
  const employees = useEmployees();
  const leave = useLeaveRecords();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const department = params.get('department');

  const now = today();
  const contacts = useMemo(
    () => (employees && leave ? directory(employees, awayOn(leave, now)) : undefined),
    [employees, leave, now],
  );
  const groups = useMemo(() => (contacts ? departments(contacts) : []), [contacts]);
  const shown = useMemo(
    () => (contacts ? findContacts(contacts, query, department) : []),
    [contacts, query, department],
  );
  const photos = useEmployeePhotos(employees);

  if (!contacts) return <Spinner className="py-24" label={t('Loading…')} />;

  return (
    <>
      <PageHeader
        title={t('Directory')}
        description={tp(contacts.length, '{count} employee', '{count} employees')}
      />
      {contacts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersRound />}
            title={t('No employees yet')}
            action={<ButtonLink to="/employees/new">{t('Add employee')}</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-72">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Name, job, phone…')}
                aria-label={t('Search the directory')}
                className="ps-9"
              />
            </div>
            {groups.length > 1 ? (
              <div className="sm:w-60">
                <Select
                  aria-label={t('Department')}
                  value={department ?? '*'}
                  onChange={(e) => {
                    const next = new URLSearchParams(params);
                    if (e.target.value === '*') next.delete('department');
                    else next.set('department', e.target.value);
                    setParams(next, { replace: true });
                  }}
                >
                  <option value="*">{t('All departments')}</option>
                  {groups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name || t('No department')} ({g.count})
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <Card>
              <EmptyState icon={<Search />} title={t('No one matches your search')} />
            </Card>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  photo={contact.photoId ? photos.get(contact.photoId) : undefined}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function ContactCard({ contact, photo }: { contact: Contact; photo?: string }) {
  const { language } = useLanguage();
  const job = (language === 'ar' && contact.jobTitleAr?.trim()) || contact.jobTitle;
  return (
    <li className="bg-surface relative flex min-w-0 gap-3 rounded-xl border border-slate-200 p-4 shadow-xs">
      <EmployeeAvatar employee={contact} photo={photo} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <Link
            to={`/employees/${contact.id}`}
            dir="auto"
            className="truncate text-sm font-semibold text-slate-900 hover:underline"
          >
            {localName(contact)}
          </Link>
          {contact.onLeave ? <Badge tone="amber">{t('On leave')}</Badge> : null}
        </p>
        <p dir="auto" className="truncate text-sm text-slate-600">
          {[job, contact.department].filter(Boolean).join(' · ') || '—'}
        </p>
        <div className="mt-2 flex flex-col gap-1 text-sm">
          {contact.phone ? (
            <a
              href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}
              className="text-primary-700 flex min-h-7 items-center gap-1.5 hover:underline pointer-coarse:min-h-11"
            >
              <Phone className="size-3.5 shrink-0" aria-hidden />
              <span dir="ltr" className="truncate">
                {contact.phone}
              </span>
            </a>
          ) : null}
          {contact.email ? (
            <a
              href={`mailto:${contact.email}`}
              className="text-primary-700 flex min-h-7 items-center gap-1.5 hover:underline pointer-coarse:min-h-11"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              <span dir="ltr" className="truncate">
                {contact.email}
              </span>
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}
