import { useState } from 'react';
import { toast } from 'sonner';
import type { InvoiceDocument } from '@/db/types';
import { markDelivered } from '@/db/orders';
import { isValidCivilId } from '@/lib/kuwait';
import { today } from '@/lib/dates';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { DateField } from '@/components/ui/date-field';

/** Records that the goods were handed over: when, and who signed for them. */
export function DeliverDialog({
  open,
  onOpenChange,
  doc,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: InvoiceDocument;
}) {
  const [date, setDate] = useState(doc.deliveryDate || today());
  const [name, setName] = useState(doc.receiverName ?? '');
  const [civilId, setCivilId] = useState(doc.receiverCivilId ?? '');
  const [errors, setErrors] = useState<{ name?: string; civilId?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (!name.trim()) found.name = t('Enter the name of the person who received the goods.');
    if (civilId.trim() && !isValidCivilId(civilId)) {
      found.civilId = t('Check the Civil ID number: it has 12 digits.');
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await markDelivered(doc.id, { date, receiverName: name, receiverCivilId: civilId });
      toast.success(t('{number} marked as delivered', { number: doc.number }));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('Mark as delivered')}
        description={t('Who signed for the goods, as written on the signed copy.')}
      >
        <form onSubmit={(e) => void submit(e)}>
          <DialogBody>
            <Field label={t('Delivery date')}>
              {(id) => (
                <DateField id={id} required value={date} onChange={(iso) => setDate(iso || date)} />
              )}
            </Field>
            <Field label={t('Received by')} error={errors.name}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  autoComplete="off"
                  onChange={(e) => {
                    setName(e.target.value);
                    setErrors((x) => ({ ...x, name: undefined }));
                  }}
                  aria-invalid={Boolean(errors.name)}
                />
              )}
            </Field>
            <Field label={t('Civil ID number')} optional error={errors.civilId}>
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  inputMode="numeric"
                  value={civilId}
                  onChange={(e) => {
                    setCivilId(e.target.value);
                    setErrors((x) => ({ ...x, civilId: undefined }));
                  }}
                  aria-invalid={Boolean(errors.civilId)}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" loading={busy} disabled={busy}>
              {t('Mark as delivered')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
