import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useCompany } from '@/app/company';
import { fileFinderOn } from '@/db/files';
import { checksDrivingLicences, registerExtrasOn } from '@/lib/compliance';
import { usePeopleSettings } from '@/features/people/hooks';
import { useRoleView } from '@/features/cloud/role-gates';
import { ComplianceSettingsDialog } from '@/features/renewals/settings-dialog';
import { appAccess, canEdit } from '@/suite/apps';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { SettingsSection } from './shared';

/**
 * Settings → Compliance and files: where the switches of the compliance
 * settings (the document finder, the register's extras, drivers' licences)
 * can be found from Settings and from search. They reach Books too: the
 * finder lists every Books file, and the extras add papers to customers.
 * They are changed in the same dialog as in Compliance, by the roles that
 * change Compliance (staff and viewers only look at it).
 */
export default function ComplianceSettingsPage() {
  const company = useCompany();
  const settings = usePeopleSettings();
  const { readOnly, known, role, peopleHidden } = useRoleView();
  const [open, setOpen] = useState(false);
  // As in Compliance, where staff and viewers can't open its settings.
  const canChange = known && !readOnly.readOnly && canEdit(appAccess('compliance', role, known));
  const state = (on: boolean) => (on ? t('Switched on') : t('Switched off'));
  const rows = [
    { label: t('Find files and papers'), on: fileFinderOn(company) },
    { label: t('Contracts, customers and vehicles'), on: registerExtrasOn(company) },
    // Kept with the People settings, which don't reach those who don't see People.
    ...(peopleHidden
      ? []
      : [{ label: t('Check drivers’ licences'), on: checksDrivingLicences(settings) }]),
  ];

  return (
    <div className="space-y-6">
      <SettingsSection
        id="compliance"
        title={t('Compliance and files')}
        description={t(
          'Reminders and deadlines, drivers’ licences, contracts, customers’ papers and vehicles in the register, and the Files page with files and papers in search, for Books too.',
        )}
        actions={
          canChange ? (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!settings}>
              <Settings2 /> {t('Compliance settings')}
            </Button>
          ) : null
        }
      >
        {readOnly.readOnly ? (
          <p className="text-sm text-slate-500">
            {t('You can view this company but not change it.')}
          </p>
        ) : known && !canChange ? (
          <p className="text-sm text-slate-500">
            {t('Owners, admins and accountants change the compliance settings.')}
          </p>
        ) : null}
        <dl className="divide-y divide-slate-100 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-slate-700">{row.label}</dt>
              <dd className={row.on ? 'font-medium text-emerald-700' : 'text-slate-500'}>
                {state(row.on)}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsSection>
      {open && settings && canChange ? (
        <ComplianceSettingsDialog settings={settings} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
