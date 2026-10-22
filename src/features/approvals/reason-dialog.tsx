import { useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

/**
 * Asks why, before a change is sent for approval, voided or decided. The
 * reason is kept with the request or the document.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = t('Reason'),
  confirmLabel,
  required = true,
  missing,
  danger = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  label?: string;
  confirmLabel: string;
  required?: boolean;
  /** What is said when a required reason is left empty (for the approver, unless given). */
  missing?: string;
  danger?: boolean;
  /** Done when it resolves; an error keeps the dialog open (the caller says why). */
  onConfirm: (reason: string) => Promise<void>;
  /** More to read before confirming (what happens to payments…). */
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    if (required && !reason.trim()) {
      setError(missing ?? t('Say why, for the approver.'));
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onOpenChange(false);
    } catch {
      // The caller showed the problem; the reason stays to try again.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <DialogBody>
          {children}
          <Field label={label} error={error} optional={!required}>
            {(id) => (
              <Textarea
                id={id}
                dir="auto"
                rows={3}
                value={reason}
                maxLength={1000}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError('');
                }}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
