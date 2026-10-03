import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Archive, FilePlus2, FileText, Pencil, RefreshCw, Search } from 'lucide-react';
import { createComplianceDocument } from '@/db/renewals';
import type { ComplianceDocument, DocumentOwnerType } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  DOCUMENT_TYPES,
  expiryStatus,
  OWNER_LABELS,
  type ExpiryStatus,
  type RegisterEntry,
} from '@/lib/compliance';
import { today } from '@/lib/dates';
import { useEmployees } from '@/features/people/hooks';
import { useRegister } from '@/features/renewals/hooks';
import { ComplianceHeader } from '@/features/renewals/compliance-header';
import { daysText, entryOwner, entryTitle, ExpiryBadge } from '@/features/renewals/display';
import { DocumentDialog } from '@/features/renewals/document-dialog';
import { RenewDialog } from '@/features/renewals/renew-dialog';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Segmented, Spinner } from '@/components/ui/misc';
import { Input, Select } from '@/components/ui/form';
import { t } from '@/i18n';

type StatusFilter = 'all' | ExpiryStatus | 'archived';
const OWNERS: DocumentOwnerType[] = ['company', 'employee', 'vehicle', 'other'];

export default function DocumentsRegisterPage() {
  const company = useCompany();
  const fmt = useFormat();
  const register = useRegister();
  const employees = useEmployees();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [owner, setOwner] = useState<DocumentOwnerType | ''>('');
  const [query, setQuery] = useState('');
  const [renewing, setRenewing] = useState<RegisterEntry | null>(null);
  const [editing, setEditing] = useState<{ doc: ComplianceDocument; isNew: boolean } | null>(null);

  const on = today();
  const byEmployee = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e])), [employees]);
  const rows = useMemo(() => {
    if (!register) return [];
    return register.entries
      .map((entry) => ({
        entry,
        info: expiryStatus(entry.expiryDate, entry.reminderDays, on),
        owner: entryOwner(entry, byEmployee, company),
        title: entryTitle(entry),
      }))
      .sort(
        (a, b) =>
          (a.entry.expiryDate ?? '9999').localeCompare(b.entry.expiryDate ?? '9999') ||
          a.title.localeCompare(b.title),
      );
  }, [register, byEmployee, company, on]);

  const archived = useMemo(() => (register?.documents ?? []).filter((d) => d.archived), [register]);

  if (!register || !employees) return <Spinner className="py-24" label={t('Loading…')} />;

  const count = (s: ExpiryStatus) => rows.filter((r) => r.info.status === s).length;
  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (status === 'all' || r.info.status === status) &&
      (!owner || r.entry.ownerType === owner) &&
      (!q ||
        [r.title, t(DOCUMENT_TYPES[r.entry.type].label), r.owner, r.entry.number, r.entry.issuer]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  );

  const add = () =>
    setEditing({
      doc: createComplianceDocument(company.id, owner ? { ownerType: owner } : {}),
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
          <Button onClick={add}>
            <FilePlus2 /> {t('Add document')}
          </Button>
        }
      />

      {rows.length === 0 && archived.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title={t('No documents yet')}
            description={t(
              'Add your commercial licence, lease and vehicle papers. Employees’ Civil IDs, residencies and work permits appear here on their own.',
            )}
            action={
              <Button onClick={add}>
                <FilePlus2 /> {t('Add document')}
              </Button>
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
              ]}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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

          {status === 'archived' ? (
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
                    <Pencil /> {t('Open')}
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
                    <th className="px-3 py-3 text-start">{t('Expiry date')}</th>
                    <th className="hidden px-3 py-3 text-end lg:table-cell">{t('Renewal cost')}</th>
                    <th className="px-5 py-3 text-end">
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(({ entry, info, owner: ownerName, title }) => (
                    <tr key={entry.key} className="align-top">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{title}</p>
                        <p className="text-xs text-slate-500">
                          {[entry.title ? t(DOCUMENT_TYPES[entry.type].label) : '', entry.number]
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
                          {t(OWNER_LABELS[entry.ownerType])}
                        </span>
                      </td>
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
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setRenewing(entry)}
                            aria-label={t('Renew {document}', { document: title })}
                          >
                            <RefreshCw /> <span className="hidden sm:inline">{t('Renew')}</span>
                          </Button>
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
      {editing ? (
        <DocumentDialog
          document={editing.doc}
          isNew={editing.isNew}
          employees={employees}
          defaultReminderDays={register.reminderDays}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
