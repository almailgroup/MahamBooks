import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  FilePlus2,
  FileText,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { db } from '@/db/db';
import { createComplianceDocument } from '@/db/renewals';
import type { ComplianceDocument, DocumentOwnerType } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  documentTypeInfo,
  expiryStatus,
  OWNER_LABELS,
  ownerLabel,
  recordEntry,
  type ExpiryStatus,
  type RegisterEntry,
} from '@/lib/compliance';
import { today } from '@/lib/dates';
import { useRoleView } from '@/features/cloud/role-gates';
import { useEmployees } from '@/features/people/hooks';
import { useRegister, useRegisterExtras } from '@/features/renewals/hooks';
import { ComplianceHeader } from '@/features/renewals/compliance-header';
import {
  daysText,
  entryOwner,
  entryTitle,
  ExpiryBadge,
  purposeName,
} from '@/features/renewals/display';
import { DocumentDialog } from '@/features/renewals/document-dialog';
import { RenewDialog } from '@/features/renewals/renew-dialog';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { Badge, Card, EmptyState, Segmented, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';

/**
 * "drivers": drivers without a valid licence, when the company checks them;
 * "nofile": documents of the register without a scan (with the register's extras).
 */
type StatusFilter = 'all' | ExpiryStatus | 'archived' | 'drivers' | 'nofile';
const OWNERS: DocumentOwnerType[] = ['company', 'employee', 'vehicle', 'other'];

export default function DocumentsRegisterPage() {
  const company = useCompany();
  const { readOnly } = useReadOnly();
  const fmt = useFormat();
  const register = useRegister();
  const employees = useEmployees();
  const { peopleHidden } = useRoleView();
  const { on: extras } = useRegisterExtras();
  const [params, setParams] = useSearchParams();
  const [chosen, setStatus] = useState<StatusFilter>('all');
  const [owner, setOwner] = useState<DocumentOwnerType | ''>('');
  const [customer, setCustomer] = useState('');
  const [query, setQuery] = useState('');
  const [renewing, setRenewing] = useState<RegisterEntry | null>(null);
  const [editing, setEditing] = useState<{ doc: ComplianceDocument; isNew: boolean } | null>(null);
  const clients = useLiveQuery(
    () => (extras ? db.clients.where('companyId').equals(company.id).toArray() : []),
    [company.id, extras],
  );

  const on = today();
  const byEmployee = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const names = useMemo(
    () => ({
      clients: new Map((clients ?? []).map((c) => [c.id, c])),
      vehicles: new Map((register?.vehicles ?? []).map((v) => [v.id, v])),
    }),
    [clients, register],
  );
  const rows = useMemo(() => {
    if (!register) return [];
    return (
      register.entries
        // Never on a staff or viewer's device; left out should one be there.
        .filter((entry) => !(peopleHidden && entry.confidential))
        .map((entry) => ({
          entry,
          info: expiryStatus(entry.expiryDate, entry.reminderDays, on),
          owner: entryOwner(entry, byEmployee, company, names),
          title: entryTitle(entry),
          purpose: purposeName(company.documentPurposes, entry.purposeId),
          files: entry.recordId ? (register.files.get(entry.recordId) ?? 0) : null,
        }))
        .sort(
          (a, b) =>
            (a.entry.expiryDate ?? '9999').localeCompare(b.entry.expiryDate ?? '9999') ||
            a.title.localeCompare(b.title),
        )
    );
  }, [register, byEmployee, company, names, on, peopleHidden]);

  const archived = useMemo(() => (register?.documents ?? []).filter((d) => d.archived), [register]);

  if (!register || !employees) return <Spinner className="py-24" label={t('Loading…')} />;

  // A link to one document (from search) opens it.
  const linkedId = params.get('doc');
  const linked = linkedId ? register.documents.find((d) => d.id === linkedId) : undefined;
  const open = editing ?? (linked ? { doc: linked, isNew: false } : null);
  const closeEditing = () => {
    setEditing(null);
    if (linkedId) {
      setParams(
        (p) => {
          p.delete('doc');
          return p;
        },
        { replace: true },
      );
    }
  };

  const count = (s: ExpiryStatus) => rows.filter((r) => r.info.status === s).length;
  // Drivers without a valid licence: employees' data, never for staff or viewers.
  const checksDrivers = register.drivingLicences && !peopleHidden;
  const drivers = checksDrivers ? register.missing : [];
  // Stored documents without a scan (an employee's own papers are scanned on their page).
  const withoutFile = rows.filter((r) => r.files === 0).length;
  // Back to every document once drivers are no longer checked, or the extras are off.
  const status =
    (chosen === 'drivers' && !checksDrivers) || (chosen === 'nofile' && !extras) ? 'all' : chosen;
  // Customers who have papers in the register.
  const customers = extras
    ? [...new Set(rows.map((r) => r.entry.clientId).filter((id): id is string => Boolean(id)))]
        .map((id) => ({ id, name: localName(names.clients.get(id)) }))
        .filter((c) => c.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const shownCustomer = customers.some((c) => c.id === customer) ? customer : '';
  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (status === 'all' || (status === 'nofile' ? r.files === 0 : r.info.status === status)) &&
      (!owner || r.entry.ownerType === owner) &&
      (!shownCustomer || r.entry.clientId === shownCustomer) &&
      (!q ||
        [
          r.title,
          t(documentTypeInfo(r.entry.type).label),
          r.owner,
          r.entry.number,
          r.entry.issuer,
          r.purpose,
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  );

  const add = () =>
    setEditing({
      doc: createComplianceDocument(company.id, owner ? { ownerType: owner } : {}),
      isNew: true,
    });
  const addLicence = (employeeId: string) =>
    setEditing({
      doc: createComplianceDocument(company.id, {
        ownerType: 'employee',
        employeeId,
        type: 'driving_licence',
      }),
      isNew: true,
    });
  const edit = (entry: RegisterEntry) => {
    const doc = register.documents.find((d) => d.id === entry.recordId);
    if (doc) setEditing({ doc, isNew: false });
  };

  return (
    <div className="space-y-6">
      <ComplianceHeader
        actions={
          readOnly ? null : (
            <Button onClick={add}>
              <FilePlus2 /> {t('Add document')}
            </Button>
          )
        }
      />

      {rows.length === 0 && archived.length === 0 && drivers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title={t('No documents yet')}
            description={t(
              'Add your commercial licence, lease and vehicle papers. Employees’ Civil IDs, residencies and work permits appear here on their own.',
            )}
            action={
              readOnly ? null : (
                <Button onClick={add}>
                  <FilePlus2 /> {t('Add document')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: t('All'), count: rows.length },
                { value: 'expiring', label: t('Expiring'), count: count('expiring') },
                { value: 'expired', label: t('Expired'), count: count('expired') },
                { value: 'valid', label: t('Valid'), count: count('valid') },
                ...(archived.length
                  ? [
                      {
                        value: 'archived' as const,
                        label: t('Archived'),
                        count: archived.length,
                      },
                    ]
                  : []),
                ...(checksDrivers
                  ? [
                      {
                        value: 'drivers' as const,
                        label: t('Drivers without a valid licence'),
                        count: drivers.length,
                      },
                    ]
                  : []),
                ...(extras
                  ? [{ value: 'nofile' as const, label: t('No file'), count: withoutFile }]
                  : []),
              ]}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {customers.length ? (
                <Select
                  value={shownCustomer}
                  onChange={(e) => setCustomer(e.target.value)}
                  aria-label={t('Customer')}
                  className="sm:w-44"
                >
                  <option value="">{t('Every customer')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Select
                value={owner}
                onChange={(e) => setOwner(e.target.value as DocumentOwnerType | '')}
                aria-label={t('Belongs to')}
                className="sm:w-44"
              >
                <option value="">{t('Everyone')}</option>
                {OWNERS.map((o) => (
                  <option key={o} value={o}>
                    {t(OWNER_LABELS[o])}
                  </option>
                ))}
              </Select>
              <div className="relative sm:w-64">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Search documents…')}
                  aria-label={t('Search documents')}
                  className="ps-9"
                />
              </div>
            </div>
          </div>

          {status === 'drivers' ? (
            drivers.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">
                {t('Every driver holds a valid driving licence.')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {drivers.map((missing) => {
                  const employee = byEmployee.get(missing.employeeId);
                  const entry = missing.document
                    ? recordEntry(missing.document, register.reminderDays)
                    : null;
                  const name = employee ? localName(employee) : '';
                  const job = employee
                    ? localName({ name: employee.jobTitle, nameAr: employee.jobTitleAr })
                    : '';
                  return (
                    <li
                      key={missing.employeeId}
                      className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/employees/${missing.employeeId}`}
                          className="hover:text-primary-700 font-medium text-slate-900"
                        >
                          {name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {[employee?.number, job].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {entry ? (
                          <span className="text-xs text-slate-500">
                            {t('Driving licence expired {date}', {
                              date: fmt.date(entry.expiryDate),
                            })}
                          </span>
                        ) : (
                          <Badge tone="red">{t('Driving licence missing')}</Badge>
                        )}
                        {readOnly ? null : entry ? (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setRenewing(entry)}
                            aria-label={t('Renew {document}', { document: entryTitle(entry) })}
                          >
                            <RefreshCw /> {t('Renew')}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => addLicence(missing.employeeId)}
                            aria-label={t('Add a driving licence for {name}', { name })}
                          >
                            <Plus /> {t('Add licence')}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : status === 'archived' ? (
            <ul className="divide-y divide-slate-100">
              {archived.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                  <Archive className="size-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-700">{entryTitle(doc)}</p>
                    <p className="text-xs text-slate-500">
                      {[
                        entryOwner(
                          {
                            ownerType: doc.ownerType,
                            ownerName: doc.ownerName,
                            employeeId: doc.employeeId,
                          },
                          byEmployee,
                          company,
                        ),
                        doc.number,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ doc, isNew: false })}
                  >
                    <Pencil /> {t('Edit')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {t('No documents match.')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3 text-start">{t('Document')}</th>
                    <th className="hidden px-3 py-3 text-start md:table-cell">{t('Belongs to')}</th>
                    {extras ? (
                      <th className="hidden px-3 py-3 text-start xl:table-cell">{t('Purpose')}</th>
                    ) : null}
                    <th className="px-3 py-3 text-start">{t('Expiry date')}</th>
                    <th className="hidden px-3 py-3 text-end lg:table-cell">{t('Renewal cost')}</th>
                    {extras ? (
                      <th className="hidden px-2 py-3 sm:table-cell">
                        <span className="sr-only">{t('Files')}</span>
                      </th>
                    ) : null}
                    <th className="px-5 py-3 text-end">
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(({ entry, info, owner: ownerName, title, purpose, files }) => (
                    <tr key={entry.key} className="align-top">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">
                          {title}
                          {entry.confidential ? (
                            <Badge tone="violet" className="ms-2 align-middle">
                              <Lock className="size-3" aria-hidden /> {t('Confidential')}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-500">
                          {[entry.title ? t(documentTypeInfo(entry.type).label) : '', entry.number]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <p className="text-xs text-slate-500 md:hidden">
                          {entry.employeeId ? (
                            <Link
                              to={`/employees/${entry.employeeId}`}
                              className="hover:text-primary-700"
                            >
                              {ownerName}
                            </Link>
                          ) : (
                            ownerName
                          )}
                        </p>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-700 md:table-cell">
                        {entry.employeeId ? (
                          <Link
                            to={`/employees/${entry.employeeId}`}
                            className="hover:text-primary-700"
                          >
                            {ownerName}
                          </Link>
                        ) : (
                          ownerName
                        )}
                        <span className="block text-xs text-slate-500">
                          {t(ownerLabel(entry.ownerType))}
                        </span>
                      </td>
                      {extras ? (
                        <td className="hidden px-3 py-3 text-slate-700 xl:table-cell">
                          {purpose || '—'}
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <ExpiryBadge info={info} />
                        {entry.expiryDate ? (
                          <span className="mt-1 block text-xs text-slate-500">
                            {fmt.date(entry.expiryDate)}
                            {info.status === 'expired' ? ` · ${daysText(info.daysLeft ?? 0)}` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular hidden px-3 py-3 text-end text-slate-700 lg:table-cell">
                        {entry.renewalCost ? fmt.money(entry.renewalCost) : '—'}
                      </td>
                      {extras ? (
                        <td className="hidden px-2 py-3 text-slate-500 sm:table-cell">
                          {files ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-xs"
                              title={tp(files, '{count} file', '{count} files')}
                            >
                              <Paperclip className="size-3.5" aria-hidden />
                              <span className="sr-only">
                                {tp(files, '{count} file', '{count} files')}
                              </span>
                              <span aria-hidden>{files}</span>
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {readOnly ? null : (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setRenewing(entry)}
                              aria-label={t('Renew {document}', { document: title })}
                            >
                              <RefreshCw /> <span className="hidden sm:inline">{t('Renew')}</span>
                            </Button>
                          )}
                          {entry.recordId ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => edit(entry)}
                              aria-label={t('Edit {document}', { document: title })}
                            >
                              <Pencil />
                            </Button>
                          ) : (
                            <Link
                              to={`/employees/${entry.employeeId}/edit`}
                              className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              aria-label={t('Edit {document}', { document: title })}
                            >
                              <Pencil className="size-4" />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {renewing ? (
        <RenewDialog
          entry={renewing}
          owner={entryOwner(renewing, byEmployee, company)}
          onClose={() => setRenewing(null)}
        />
      ) : null}
      {open ? (
        <DocumentDialog
          key={open.doc.id}
          document={open.doc}
          isNew={open.isNew}
          employees={employees}
          defaultReminderDays={register.reminderDays}
          onClose={closeEditing}
        />
      ) : null}
    </div>
  );
}
