import { useState } from 'react';
import { toast } from 'sonner';
import type { Employee } from '@/db/types';
import { setLeaveOpening } from '@/db/people';
import { today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Field, NumberInput } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { DateField } from '@/components/ui/date-field';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/**
 * The annual leave an employee brought forward when their leave history
 * starts in the app (imported staff): the days they had left on a date,
 * from the records kept before. Saving confirms it.
 */
export function LeaveOpeningDialog({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
  const name = localName(employee);
  const [date, setDate] = useState(employee.leaveOpening?.date ?? today());
  const [days, setDays] = useState(employee.leaveOpening?.days ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await setLeaveOpening(employee.id, { date, days });
      toast.success(t('Leave brought forward for {name} confirmed', { name }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        title={t('Leave brought forward')}
        description={t(
          'The annual leave {name} had left on this date, from your records before. Leave counts from this date: nothing before it is added.',
          { name },
        )}
        size="sm"
      >
        <DialogBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Date')}>
              {(id) => <DateField id={id} value={date} onChange={(iso) => iso && setDate(iso)} />}
            </Field>
            <Field label={t('Days brought forward')}>
              {(id) => (
                <NumberInput id={id} value={days} onValueChange={setDays} allowNegative={false} />
              )}
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Save and confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
