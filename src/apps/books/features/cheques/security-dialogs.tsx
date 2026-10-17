import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  cashSecurityCheque,
  createSecurityCheque,
  returnSecurityCheque,
  saveSecurityCheque,
} from '@/db/cheques';
import { isCustomer, isVendor } from '@/db/purchases';
import type { Payment, SecurityCheque } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { today } from '@/lib/dates';
import { isValidCivilId } from '@/lib/kuwait';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, NumberInput, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { Segmented } from '@/components/ui/misc';
import { CurrencySelect } from '@/components/fields';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { BankSelect } from '@/apps/books/features/payments/fields';
import { DateField } from '@/components/ui/date-field';

function useContacts(direction: 'in' | 'out') {
  const company = useCompany();
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  return (clients ?? [])
    .filter((c) => !c.archived && (direction === 'out' ? isVendor(c) : isCustomer(c)))
    .sort((a, b) => localName(a).localeCompare(localName(b)))
    .map((c) => ({
      value: c.id,
      label: localName(c),
      detail: c.number,
      keywords: `${c.name} ${c.nameAr ?? ''}`,
      name: c.name,
      civilId: c.civilId,
    }));
}

/** Adds or edits a security (guarantee) cheque. */
export function SecurityChequeDialog({
  cheque,
  onClose,
}: {
  cheque: SecurityCheque | null;
  onClose: () => void;
}) {
  const company = useCompany();
  const [draft, setDraft] = useState<SecurityCheque>(
    () => cheque ?? createSecurityCheque(company.id, { currency: company.currency }),
  );
  const [saving, setSaving] = useState(false);
  const contacts = useContacts(draft.direction);
  const set = (patch: Partial<SecurityCheque>) => setDraft((d) => ({ ...d, ...patch }));
  const civilId = (draft.drawerCivilId ?? '').replace(/\s/g, '');
  const civilError = civilId && !isValidCivilId(civilId);
  const given = draft.direction === 'out';

  const save = async () => {
    setSaving(true);
    try {
      await saveSecurityCheque(draft);
      toast.success(
        cheque
          ? t('Security cheque {number} updated', { number: draft.number.trim() })
          : t('Security cheque {number} recorded', { number: draft.number.trim() }),
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={cheque ? t('Edit security cheque') : t('Add security cheque')}
        description={t('Kept off the books until it is cashed.')}
        size="lg"
      >
        <DialogBody>
          {cheque ? null : (
            <Segmented
              value={draft.direction}
              onChange={(direction) => set({ direction, clientId: null })}
              options={[
                { value: 'in', label: t('Received from someone') },
                { value: 'out', label: t('Given to someone') },
              ]}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={given ? t('Vendor') : t('Client')} optional>
              {(id) => (
                <Combobox
                  id={id}
                  value={draft.clientId}
                  onChange={(value) => {
                    const contact = contacts.find((c) => c.value === value);
                    set({
                      clientId: value || null,
                      drawer: draft.drawer || contact?.name || '',
                      drawerCivilId: draft.drawerCivilId || contact?.civilId || undefined,
                    });
                  }}
                  options={contacts}
                  placeholder={t('Choose a contact…')}
                  searchPlaceholder={given ? t('Search vendors…') : t('Search clients…')}
                />
              )}
            </Field>
            <Field label={given ? t('Held by') : t('Drawer')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.drawer}
                  onChange={(e) => set({ drawer: e.target.value })}
                  placeholder={given ? t('Who holds the cheque') : t('Who signed the cheque')}
                />
              )}
            </Field>
            <Field label={t('Cheque number')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.number}
                  onChange={(e) => set({ number: e.target.value })}
                  inputMode="numeric"
                  dir="ltr"
                  className="rtl:text-end"
                />
              )}
            </Field>
            <Field label={t('Bank')}>
              {(id) => <BankSelect id={id} value={draft.bank} onChange={(bank) => set({ bank })} />}
            </Field>
            <Field label={t('Amount')}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={draft.amount}
                  onValueChange={(amount) => set({ amount })}
                  allowNegative={false}
                />
              )}
            </Field>
            <Field label={t('Currency')}>
              {(id) => (
                <CurrencySelect
                  id={id}
                  value={draft.currency}
                  onChange={(currency) => set({ currency })}
                />
              )}
            </Field>
            <Field
              label={t('Cheque date')}
              optional
              hint={t('Security cheques are often undated.')}
            >
              {(id) => (
                <DateField
                  id={id}
                  value={draft.date ?? ''}
                  onChange={(iso) => set({ date: iso || null })}
                />
              )}
            </Field>
            {given ? null : (
              <Field
                label={t('Drawer’s Civil ID')}
                optional
                error={civilError ? t('Check the Civil ID number: it has 12 digits.') : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={draft.drawerCivilId ?? ''}
                    onChange={(e) => set({ drawerCivilId: e.target.value })}
                    inputMode="numeric"
                    dir="ltr"
                    className="rtl:text-end"
                    aria-invalid={civilError || undefined}
                    maxLength={14}
                  />
                )}
              </Field>
            )}
            <Field label={t('Purpose')} className="sm:col-span-2">
              {(id) => (
                <Input
                  id={id}
                  value={draft.purpose}
                  onChange={(e) => set({ purpose: e.target.value })}
                  placeholder={t('Rent deposit, shop 4')}
                />
              )}
            </Field>
            <Field label={t('Notes')} optional className="sm:col-span-2">
              {(id) => (
                <Textarea
                  id={id}
                  value={draft.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  rows={2}
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
            {t('Save cheque')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Gives a security cheque back (or records that ours came back). */
export function GiveBackDialog({
  cheque,
  onClose,
}: {
  cheque: SecurityCheque;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await returnSecurityCheque(cheque.id, date);
      toast.success(t('Security cheque {number} given back', { number: cheque.number }));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={
          cheque.direction === 'out' ? t('Cheque given back to us') : t('Give the cheque back')
        }
        description={t('Cheque {number} · {amount}', {
          number: cheque.number,
          amount: fmt.money(cheque.amount, cheque.currency),
        })}
        size="sm"
      >
        <DialogBody>
          <Field label={t('Date')}>
            {(id) => <DateField id={id} value={date} onChange={(iso) => setDate(iso || today())} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Give back')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cashes a security cheque: it becomes a payment and joins the register. */
export function CashSecurityDialog({
  cheque,
  onClose,
  onCashed,
}: {
  cheque: SecurityCheque;
  onClose: () => void;
  onCashed?: (payment: Payment) => void;
}) {
  const fmt = useFormat();
  const given = cheque.direction === 'out';
  const contacts = useContacts(cheque.direction);
  const [date, setDate] = useState(today());
  const [clientId, setClientId] = useState<string | null>(cheque.clientId);
  const [apply, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const payment = await cashSecurityCheque(cheque.id, { date, clientId, applyToOpen: apply });
      toast.success(
        t('Security cheque {number} cashed as payment {payment}', {
          number: cheque.number,
          payment: payment.number,
        }),
      );
      onClose();
      onCashed?.(payment);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Cash security cheque')}
        description={t('Cheque {number} · {amount}', {
          number: cheque.number,
          amount: fmt.money(cheque.amount, cheque.currency),
        })}
      >
        <DialogBody>
          <p className="text-sm text-slate-600">
            {given
              ? t('The cheque becomes a payment made and waits in the register until it clears.')
              : t(
                  'The cheque becomes a payment received, deposited on this date, and waits in the register until it clears.',
                )}
          </p>
          <Field label={t('Date')}>
            {(id) => <DateField id={id} value={date} onChange={(iso) => setDate(iso || today())} />}
          </Field>
          {cheque.clientId ? null : (
            <Field label={given ? t('Vendor') : t('Client')}>
              {(id) => (
                <Combobox
                  id={id}
                  value={clientId}
                  onChange={setClientId}
                  options={contacts}
                  placeholder={t('Choose a contact…')}
                  searchPlaceholder={given ? t('Search vendors…') : t('Search clients…')}
                />
              )}
            </Field>
          )}
          <Checkbox
            checked={apply}
            onChange={(e) => setApply(e.target.checked)}
            label={given ? t('Pay open bills, oldest first') : t('Pay open invoices, oldest first')}
            description={t('Anything left over stays as credit.')}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {t('Cash cheque')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
