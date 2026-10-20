import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import type { ComplianceDocument, Employee } from '@/db/types';
import { createComplianceDocument } from '@/db/renewals';
import { useCompany, useFormat } from '@/app/company';
import {
  employeeDocuments,
  expiryStatus,
  missingDocuments,
  recordEntry,
  type RegisterEntry,
} from '@/lib/compliance';
import { isCurrent } from '@/lib/hr/employees';
import { today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/misc';
import { DocumentDialog } from '@/features/renewals/document-dialog';
import { RenewDialog } from '@/features/renewals/renew-dialog';
import { entryTitle, ExpiryBadge } from '@/features/renewals/display';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/**
 * The employee's papers: those on their record and those in the register.
 * When the company checks drivers' licences, a driver without one on file
 * gets a "Driving licence missing" row, and Add document starts with it.
 */
export function EmployeeDocuments({
  employee,
  records,
  employees,
  reminderDays,
  drivingLicences = false,
}: {
  employee: Employee;
  records: ComplianceDocument[];
  employees: Employee[];
  reminderDays: number[];
  /** The company checks drivers' licences (PeopleSettings.drivingLicences). */
  drivingLicences?: boolean;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const [renewing, setRenewing] = useState<RegisterEntry | null>(null);
  const [editing, setEditing] = useState<{ doc: ComplianceDocument; isNew: boolean } | null>(null);
  const on = today();
  const current = isCurrent(employee);
  const entries = [
    ...employeeDocuments(employee, reminderDays),
    ...records.filter((d) => !d.archived).map((d) => recordEntry(d, reminderDays)),
  ];
  // An expired licence shows as expired on its own row; one never added has none.
  // Vehicles with a driver count too once #17 assigns them: pass them here.
  const licenceMissing =
    drivingLicences &&
    missingDocuments({ employees: [employee], documents: records, on }).some(
      (m) => m.type === 'driving_licence' && m.reason === 'missing',
    );
  const add = (type: ComplianceDocument['type']) =>
    setEditing({
      doc: createComplianceDocument(company.id, {
        ownerType: 'employee',
        employeeId: employee.id,
        type,
      }),
      isNew: true,
    });

  return (
    <Card>
      <CardHeader
        title={t('Documents')}
        description={
          current
            ? t('Reminders appear in Compliance before each expiry date.')
            : t('Not tracked any more: this employee has left.')
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => add(licenceMissing ? 'driving_licence' : 'health_insurance')}
          >
            <Plus /> {t('Add document')}
          </Button>
        }
      />
      {entries.length === 0 && !licenceMissing ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          {t('No documents yet. Add the Civil ID, passport and residency on the employee’s form.')}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {licenceMissing ? (
            <li className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{t('Driving licence missing')}</p>
                <p className="text-xs text-slate-500">
                  {t('Drives for work, but no driving licence is on file.')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="red">{t('Missing')}</Badge>
                <Button variant="outline" size="xs" onClick={() => add('driving_licence')}>
                  <Plus /> {t('Add licence')}
                </Button>
              </div>
            </li>
          ) : null}
          {entries.map((entry) => {
            const info = expiryStatus(entry.expiryDate, entry.reminderDays, on);
            const record = entry.recordId ? records.find((r) => r.id === entry.recordId) : null;
            return (
              <li
                key={entry.key}
                className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{entryTitle(entry)}</p>
                  <p className="text-xs text-slate-500">
                    {[
                      entry.number,
                      record?.licenceClass
                        ? t('Class {class}', { class: record.licenceClass })
                        : '',
                      entry.expiryDate
                        ? t('Expires {date}', { date: fmt.date(entry.expiryDate) })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('No expiry date')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {current ? <ExpiryBadge info={info} /> : null}
                  {current ? (
                    <Button variant="outline" size="xs" onClick={() => setRenewing(entry)}>
                      <RefreshCw /> {t('Renew')}
                    </Button>
                  ) : null}
                  {record ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('Edit {document}', { document: entryTitle(entry) })}
                      onClick={() => setEditing({ doc: record, isNew: false })}
                    >
                      <Pencil />
                    </Button>
                  ) : (
                    <Link
                      to={`/employees/${employee.id}/edit`}
                      className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      aria-label={t('Edit {document}', { document: entryTitle(entry) })}
                    >
                      <Pencil className="size-4" />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {renewing ? (
        <RenewDialog
          entry={renewing}
          owner={localName(employee)}
          onClose={() => setRenewing(null)}
        />
      ) : null}
      {editing ? (
        <DocumentDialog
          document={editing.doc}
          isNew={editing.isNew}
          employees={employees}
          defaultReminderDays={reminderDays}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
}
