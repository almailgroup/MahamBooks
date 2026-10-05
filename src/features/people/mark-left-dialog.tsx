import { useState } from 'react';
import { toast } from 'sonner';
import type { Employee, LeavingReason } from '@/db/types';
import { saveEmployee } from '@/db/people';
import { LEAVING_REASON_LABELS } from '@/lib/hr/employees';
import { today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { DateField } from '@/components/ui/date-field';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

const REASONS = Object.keys(LEAVING_REASON_LABELS) as LeavingReason[];

/**
 * Marks an employee with payroll records as left (they can't be deleted),
 * asking for the leaving date and the reason: the reason decides the
 * end-of-service indemnity, so it is never chosen for the user.
 */
export function MarkLeftDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const name = localName(employee);
  const [leavingDate, setLeavingDate] = useState(employee.leavingDate ?? today());
  const [reason, setReason] = useState<LeavingReason | ''>(employee.leavingReason ?? '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reasonError = tried && !reason ? t('Choose the reason for leaving.') : undefined;

  const save = async () => {
    setTried(true);
    setError('');
    if (!reason) return;
    if (employee.hireDate && leavingDate < employee.hireDate) {
      setError(t('The leaving date is before the hire date.'));
      return;
    }
    setBusy(true);
    try {
      await saveEmployee(
        { ...employee, status: 'left', leavingDate, leavingReason: reason },
        { expectedUpdatedAt: employee.updatedAt },
      );
      toast.success(t('{name} is marked as left.', { name }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        title={t('Mark {name} as left?', { name })}
        description={t(
          '{name} has payroll records (pay runs, leave, loans or a final settlement). Payroll is part of the accounts, so the employee can’t be deleted. Marked as left, they stay in past payroll and reports.',
          { name },
        )}
        size="sm"
      >
        <DialogBody>
          <Field label={t('Leaving date')}>
            {(id) => (
              <DateField
                id={id}
                value={leavingDate}
                onChange={(iso) => iso && setLeavingDate(iso)}
              />
            )}
          </Field>
          <Field label={t('Reason for leaving')} error={reasonError}>
            {(id) => (
              <Select
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value as LeavingReason | '')}
                aria-invalid={Boolean(reasonError)}
                required
              >
                <option value="">{t('Choose a reason')}</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(LEAVING_REASON_LABELS[r])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
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
            {t('Mark as left')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
