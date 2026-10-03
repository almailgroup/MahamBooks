import { useState } from 'react';
import { toast } from 'sonner';
import { savePeopleSettings } from '@/db/people';
import type { PeopleSettings } from '@/db/types';
import { normalizeReminderDays } from '@/lib/compliance';
import { normalizeDigits } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t } from '@/i18n';

/** Reminders, statutory deadlines and end-of-service settings of the company. */
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
  const set = (patch: Partial<PeopleSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const reminderDays = normalizeReminderDays(
        normalizeDigits(days)
          .split(/[^\d]+/)
          .map(Number)
          .filter((n) => n > 0),
      );
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
