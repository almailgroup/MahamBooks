import { useState } from 'react';
import { Archive, ArchiveRestore, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { savePeopleSettings } from '@/db/people';
import { saveDocumentPurposes, setRegisterExtras } from '@/db/renewals';
import type { DocumentPurpose, PeopleSettings } from '@/db/types';
import { useCompany } from '@/app/company';
import { checksDrivingLicences, normalizeReminderDays, registerExtrasOn } from '@/lib/compliance';
import { newId } from '@/lib/ids';
import { normalizeDigits } from '@/lib/money';
import { useRoleView } from '@/features/cloud/role-gates';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Switch } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t } from '@/i18n';

/**
 * Reminders, statutory deadlines and end-of-service settings of the company,
 * whether drivers' licences are checked, and the register's extras
 * (contracts, customers' papers, vehicles and confidential documents) with
 * the company's purposes of documents.
 */
export function ComplianceSettingsDialog({
  settings,
  onClose,
}: {
  settings: PeopleSettings;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [days, setDays] = useState(settings.reminderDays.join(', '));
  const [saving, setSaving] = useState(false);
  const { peopleHidden } = useRoleView();
  const company = useCompany();
  const [extras, setExtras] = useState(registerExtrasOn(company));
  const [purposes, setPurposes] = useState<DocumentPurpose[]>(company.documentPurposes ?? []);
  const set = (patch: Partial<PeopleSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const setPurpose = (id: string, patch: Partial<DocumentPurpose>) =>
    setPurposes((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const save = async () => {
    setSaving(true);
    try {
      const reminderDays = normalizeReminderDays(
        normalizeDigits(days)
          .split(/[^\d]+/)
          .map(Number)
          .filter((n) => n > 0),
      );
      // The company's list first: a name given twice stops everything.
      if (extras) await saveDocumentPurposes(company.id, purposes);
      await setRegisterExtras(company.id, extras);
      await savePeopleSettings({ ...draft, reminderDays });
      toast.success(t('Settings saved'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the settings.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Compliance settings')}
        description={t('Reminders and the deadlines worked out for your company.')}
      >
        <DialogBody>
          <Field
            label={t('Remind me (days before expiry)')}
            hint={t('For example 60, 30, 7. Documents can have their own.')}
          >
            {(id) => (
              <Input
                id={id}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="numeric"
                dir="ltr"
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('Audited statements due')}
              hint={t('Months after the year end. Check with your auditor.')}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.auditFilingMonths}
                  onValueChange={(auditFilingMonths) => set({ auditFilingMonths })}
                  allowNegative={false}
                />
              )}
            </Field>
            <Field
              label={t('PIFSS payment day')}
              hint={t('Day of the following month. Check with PIFSS.')}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.pifssDueDay}
                  onValueChange={(pifssDueDay) => set({ pifssDueDay })}
                  allowNegative={false}
                />
              )}
            </Field>
            <Field
              label={t('Working days in a month')}
              hint={t('Turns a monthly wage into a daily wage for end of service (usually 26).')}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.eosDailyDivisor}
                  onValueChange={(eosDailyDivisor) => set({ eosDailyDivisor })}
                  allowNegative={false}
                />
              )}
            </Field>
            <Field
              label={t('Kuwaiti staff target (%)')}
              optional
              hint={t('The Kuwaitization share set for your sector.')}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.kuwaitizationTarget ?? 0}
                  onValueChange={(target) => set({ kuwaitizationTarget: target || null })}
                  allowNegative={false}
                  blankZero
                />
              )}
            </Field>
          </div>
          {peopleHidden ? null : (
            <Switch
              checked={checksDrivingLicences(draft)}
              onChange={(drivingLicences) => set({ drivingLicences })}
              label={t('Check drivers’ licences')}
              description={t(
                'Employees who drive for work, by their job title or as set on their page, are flagged when they hold no valid driving licence.',
              )}
            />
          )}
          <Switch
            checked={extras}
            onChange={setExtras}
            label={t('Contracts, customers and vehicles')}
            description={t(
              'Company and customer contracts, cost sheets, what each document is for, the company’s vehicles with their papers, and confidential documents only owners, admins and accountants see.',
            )}
          />
          {extras ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">{t('Purposes of documents')}</p>
              {purposes.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {t('What documents are for, such as a tender, a site or a bank facility.')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {purposes.map((purpose) => (
                    <li key={purpose.id} className="flex items-center gap-2">
                      <Input
                        value={purpose.name}
                        onChange={(e) => setPurpose(purpose.id, { name: e.target.value })}
                        aria-label={t('Name (English)')}
                        disabled={purpose.archived}
                        dir="auto"
                      />
                      <Input
                        value={purpose.nameAr}
                        onChange={(e) => setPurpose(purpose.id, { nameAr: e.target.value })}
                        aria-label={t('Name (Arabic)')}
                        disabled={purpose.archived}
                        dir="rtl"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setPurpose(purpose.id, { archived: !purpose.archived })}
                        aria-label={
                          purpose.archived
                            ? t('Restore {name}', { name: purpose.name })
                            : t('Archive {name}', { name: purpose.name })
                        }
                      >
                        {purpose.archived ? <ArchiveRestore /> : <Archive />}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPurposes((list) => [...list, { id: newId(), name: '', nameAr: '' }])
                }
              >
                <Plus /> {t('Add purpose')}
              </Button>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
