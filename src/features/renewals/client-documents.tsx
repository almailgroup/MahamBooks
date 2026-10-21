import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Lock, Paperclip, Pencil, Plus } from 'lucide-react';
import { db } from '@/db/db';
import { getPeopleSettings } from '@/db/people';
import { createComplianceDocument } from '@/db/renewals';
import type { Client, ComplianceDocument } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  documentTypeInfo,
  expiryStatus,
  normalizeReminderDays,
  recordEntry,
} from '@/lib/compliance';
import { today } from '@/lib/dates';
import { appAccess, canEdit } from '@/suite/apps';
import { useRoleView } from '@/features/cloud/role-gates';
import { useEmployees } from '@/features/people/hooks';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/misc';
import { t, tp } from '@/i18n';
import { DocumentDialog } from './document-dialog';
import { ExpiryBadge, entryTitle } from './display';
import { useRegisterExtras } from './hooks';

/**
 * A customer's contracts and papers in the register (their clientId), on
 * the customer's page, with the register's extras. Those who work in
 * Compliance add and edit them here; everyone else opens the register.
 */
export function ClientDocuments({ client }: { client: Client }) {
  const company = useCompany();
  const fmt = useFormat();
  const view = useRoleView();
  const { on: extras } = useRegisterExtras();
  const employees = useEmployees();
  const docs = useLiveQuery(
    () => db.complianceDocuments.where('clientId').equals(client.id).toArray(),
    [client.id],
  );
  const files = useLiveQuery(async () => {
    const ids = (docs ?? []).map((d) => d.id);
    const owners = ids.length
      ? ((await db.attachments.where('ownerId').anyOf(ids).keys()) as string[])
      : [];
    const counts = new Map<string, number>();
    for (const owner of owners) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    return counts;
  }, [docs]);
  const reminderDays = useLiveQuery(
    async () => normalizeReminderDays((await getPeopleSettings(company.id)).reminderDays),
    [company.id],
  );
  const [editing, setEditing] = useState<{ doc: ComplianceDocument; isNew: boolean } | null>(null);

  if (!extras || !docs || !reminderDays) return null;
  const canChange =
    !view.readOnly.readOnly && canEdit(appAccess('compliance', view.role, view.known));
  const on = today();
  const listed = docs
    .filter(
      (d) => d.companyId === company.id && !d.archived && !(view.peopleHidden && d.confidential),
    )
    .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));

  const add = () =>
    setEditing({
      doc: createComplianceDocument(company.id, {
        ownerType: 'other',
        clientId: client.id,
        ownerName: client.name,
        type: 'client_contract',
      }),
      isNew: true,
    });

  return (
    <Card role="region" aria-label={t('Contracts and papers')}>
      <CardHeader
        title={t('Contracts and papers')}
        description={t('Kept in Compliance, with reminders before each expires.')}
        actions={
          canChange ? (
            <Button variant="ghost" size="sm" onClick={add}>
              <Plus /> {t('Add document')}
            </Button>
          ) : null
        }
      />
      {listed.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          {t('No contracts or papers for this customer yet.')}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {listed.map((doc) => {
            const entry = recordEntry(doc, reminderDays);
            const info = expiryStatus(entry.expiryDate, entry.reminderDays, on);
            const title = entryTitle(entry);
            const count = files?.get(doc.id) ?? 0;
            return (
              <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {title}
                    {doc.confidential ? (
                      <Badge tone="violet" className="ms-2 align-middle">
                        <Lock className="size-3" aria-hidden /> {t('Confidential')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      doc.title ? t(documentTypeInfo(doc.type).label) : '',
                      doc.number,
                      entry.expiryDate ? fmt.date(entry.expiryDate) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {count ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-xs text-slate-500"
                    title={tp(count, '{count} file', '{count} files')}
                  >
                    <Paperclip className="size-3.5" aria-hidden />
                    <span className="sr-only">{tp(count, '{count} file', '{count} files')}</span>
                    <span aria-hidden>{count}</span>
                  </span>
                ) : null}
                <ExpiryBadge info={info} />
                {canChange ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEditing({ doc, isNew: false })}
                    aria-label={t('Edit {document}', { document: title })}
                  >
                    <Pencil />
                  </Button>
                ) : (
                  <Link
                    to={`/compliance/documents?doc=${doc.id}`}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    aria-label={t('Open {document}', { document: title })}
                  >
                    <Pencil className="size-4" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? (
        <DocumentDialog
          document={editing.doc}
          isNew={editing.isNew}
          employees={employees ?? []}
          defaultReminderDays={reminderDays}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}
