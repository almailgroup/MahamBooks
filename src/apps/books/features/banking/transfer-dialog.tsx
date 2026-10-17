import { useState } from 'react';
import { toast } from 'sonner';
import { saveTransfer } from '@/db/banking';
import type { Account } from '@/db/types';
import { useCompany } from '@/app/company';
import { today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { DateField } from '@/components/ui/date-field';

/** Moves money between two of the company's bank, cash or card accounts. */
export function TransferDialog({
  accounts,
  initialFrom,
  onClose,
}: {
  accounts: Account[];
  initialFrom?: string;
  onClose: () => void;
}) {
  const company = useCompany();
  const [from, setFrom] = useState(initialFrom ?? accounts[0]?.id ?? '');
  const [to, setTo] = useState(
    accounts.find((a) => a.id !== (initialFrom ?? accounts[0]?.id))?.id ?? '',
  );
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveTransfer({ companyId: company.id, from, to, date, amount, reference });
      toast.success(t('Transfer recorded'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not record the transfer.'));
      setSaving(false);
    }
  };

  const select = (label: string, value: string, onChange: (id: string) => void) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {localName(a)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Transfer money')}
        description={t(
          'Between your own accounts: topping up petty cash, paying off the card, moving savings.',
        )}
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            {select(t('From'), from, setFrom)}
            {select(t('To'), to, setTo)}
            <Field label={t('Date')}>
              {(id) => <DateField id={id} value={date} onChange={(iso) => iso && setDate(iso)} />}
            </Field>
            <Field label={t('Amount ({currency})', { currency: company.currency })}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={amount}
                  onValueChange={setAmount}
                  allowNegative={false}
                  blankZero
                />
              )}
            </Field>
            <Field label={t('Reference')} optional className="sm:col-span-2">
              {(id) => (
                <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} />
              )}
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Record transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
