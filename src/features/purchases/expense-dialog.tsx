import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteExpense, isVendor, saveExpense } from '@/db/purchases';
import type { Expense, TaxLine } from '@/db/types';
import { isReverseCharge } from '@/lib/calc';
import { useCompany, useFormat } from '@/app/company';
import { currencyPrecision, dec } from '@/lib/money';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { CurrencySelect } from '@/components/fields';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { TaxSelect } from '@/apps/books/features/editor/tax-select';
import { ClientDialog } from '@/features/clients/client-dialog';
import {
  categoryOptions,
  MoneyAccountSelect,
  useAccounts,
} from '@/apps/books/features/accounting/account-pickers';
import { AttachmentList, useDraftAttachments } from './attachments';
import { DateField } from '@/components/ui/date-field';

/** Tax included in an amount paid: amount − amount / (1 + Σ rates). Reverse charge is never included. */
export function includedTax(amount: number, taxes: TaxLine[], currency: string): number {
  const sum = taxes.filter((t) => !isReverseCharge(t)).reduce((acc, t) => acc + t.rate, 0);
  if (!sum) return 0;
  const net = dec(amount).dividedBy(dec(sum).dividedBy(100).plus(1));
  return dec(amount).minus(net).toDecimalPlaces(currencyPrecision(currency)).toNumber();
}

/** Reverse charge VAT on what was paid (without any charged tax). */
export function reverseChargeTax(amount: number, taxes: TaxLine[], currency: string): number {
  const net = dec(amount).minus(dec(includedTax(amount, taxes, currency)));
  return taxes
    .filter(isReverseCharge)
    .reduce((acc, t) => acc.plus(net.times(dec(t.rate)).dividedBy(100)), dec(0))
    .toDecimalPlaces(currencyPrecision(currency))
    .toNumber();
}

/** Records or edits an expense paid straight away, with its receipt. */
export function ExpenseDialog({
  expense,
  isNew,
  onClose,
}: {
  expense: Expense;
  isNew: boolean;
  onClose: () => void;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(expense);
  const [saving, setSaving] = useState(false);
  const [vendorDialog, setVendorDialog] = useState<{ open: boolean; name: string }>({
    open: false,
    name: '',
  });
  const attachments = useDraftAttachments(draft.id);
  const accounts = useAccounts();
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const taxRates = useLiveQuery(
    () => db.taxRates.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  // On phones a new expense starts with the receipt, amount and category; the rest folds away.
  const [more, setMore] = useState(!isNew);
  const detailsId = useId();
  const set = (patch: Partial<Expense>) => setDraft((d) => ({ ...d, ...patch }));
  const changed = JSON.stringify(draft) !== JSON.stringify(expense);
  const currency = draft.currency || company.currency;
  const tax = includedTax(draft.amount, draft.taxes, currency);
  const reverse = reverseChargeTax(draft.amount, draft.taxes, currency);
  const vendorOptions = (clients ?? [])
    .filter((c) => (isVendor(c) && !c.archived) || c.id === draft.vendorId)
    .sort((a, b) => localName(a).localeCompare(localName(b)))
    .map((c) => ({ value: c.id, label: localName(c), detail: c.number }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveExpense(draft);
      await attachments.commit(company.id);
      toast.success(
        isNew
          ? t('Expense {number} recorded', { number: saved.number })
          : t('Expense {number} saved', { number: saved.number }),
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the expense.'));
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete expense {number}?', { number: draft.number }),
      description: t('Its receipt is deleted too. This cannot be undone.'),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteExpense(draft.id);
      toast.success(t('Expense deleted'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not delete the expense.'));
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          title={isNew ? t('Record expense') : t('Expense {number}', { number: draft.number })}
          description={t('Something paid straight away, without a bill to pay later.')}
          size="lg"
        >
          <DialogBody>
            <section aria-label={t('Receipt')}>
              <p className="mb-2 text-sm font-medium text-slate-700">{t('Receipt')}</p>
              <AttachmentList
                files={attachments.files}
                onAdd={attachments.add}
                onRemove={attachments.remove}
                camera
              />
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('Amount paid')}
                hint={
                  reverse
                    ? t('Reverse charge: {amount} VAT due and reclaimed on your return', {
                        amount: fmt.money(reverse, currency),
                      })
                    : tax
                      ? t('Includes {amount} tax', { amount: fmt.money(tax, currency) })
                      : t('The total on the receipt, tax included.')
                }
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={draft.amount}
                    onValueChange={(amount) => set({ amount })}
                    allowNegative={false}
                    blankZero
                    inputMode="decimal"
                    className="max-sm:h-12 max-sm:text-xl max-sm:font-semibold"
                  />
                )}
              </Field>
              <Field label={t('Category')}>
                {(id) => (
                  <Combobox
                    id={id}
                    value={draft.accountId || null}
                    onChange={(accountId) => set({ accountId })}
                    options={categoryOptions(accounts ?? [], [draft.accountId])}
                    placeholder={t('Choose a category…')}
                    searchPlaceholder={t('Search accounts…')}
                  />
                )}
              </Field>
            </div>
            <button
              type="button"
              className="text-primary-700 flex items-center gap-1 text-sm font-medium sm:hidden"
              aria-expanded={more}
              aria-controls={detailsId}
              onClick={() => setMore((open) => !open)}
            >
              <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} />
              {more ? t('Fewer details') : t('More details')}
            </button>
            <div
              id={detailsId}
              className={cn('grid gap-4 sm:grid-cols-2', !more && 'max-sm:hidden')}
            >
              <Field label={t('Date')}>
                {(id) => (
                  <DateField
                    id={id}
                    value={draft.date}
                    onChange={(iso) => iso && set({ date: iso })}
                  />
                )}
              </Field>
              <Field label={t('Tax included')}>
                {(id) => (
                  <TaxSelect
                    id={id}
                    value={draft.taxes}
                    onChange={(taxes) => set({ taxes })}
                    rates={taxRates ?? []}
                  />
                )}
              </Field>
              <Field label={t('Currency')}>
                {(id) => (
                  <CurrencySelect
                    id={id}
                    value={currency}
                    onChange={(value) => set({ currency: value })}
                  />
                )}
              </Field>
              <Field label={t('Paid from')}>
                {(id) => (
                  <MoneyAccountSelect
                    id={id}
                    value={draft.paidFromAccountId}
                    onChange={(paidFromAccountId) => set({ paidFromAccountId })}
                    accounts={accounts ?? []}
                    use="expense"
                  />
                )}
              </Field>
              {currency !== company.currency ? (
                <Field
                  label={t('Exchange rate')}
                  hint={`1 ${currency} = ${draft.exchangeRate || '?'} ${company.currency}`}
                >
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={draft.exchangeRate ?? 0}
                      onValueChange={(exchangeRate) => set({ exchangeRate })}
                      allowNegative={false}
                    />
                  )}
                </Field>
              ) : null}
              <Field label={t('Vendor')} optional>
                {(id) => (
                  <Combobox
                    id={id}
                    value={draft.vendorId}
                    onChange={(vendorId) => set({ vendorId })}
                    options={vendorOptions}
                    placeholder={t('Who was paid?')}
                    searchPlaceholder={t('Search vendors…')}
                    onCreate={(name) => setVendorDialog({ open: true, name })}
                    createLabel={t('New vendor')}
                  />
                )}
              </Field>
              {!draft.vendorId ? (
                <Field label={t('Paid to')} optional>
                  {(id) => (
                    <Input
                      id={id}
                      value={draft.payee ?? ''}
                      onChange={(e) => set({ payee: e.target.value })}
                      placeholder={t('A shop or a person, when not a vendor')}
                      dir="auto"
                    />
                  )}
                </Field>
              ) : null}
              <Field label={t('Reference')} optional>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.reference}
                    onChange={(e) => set({ reference: e.target.value })}
                    placeholder={t('Receipt or transaction number')}
                  />
                )}
              </Field>
              <Field label={t('Description')} className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    placeholder={t('e.g. Taxi to a client meeting')}
                  />
                )}
              </Field>
              <Field label={t('Notes')} optional className="sm:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={draft.notes}
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            {!isNew ? (
              <Button
                variant="ghost"
                className="me-auto text-red-600 hover:bg-red-50"
                onClick={() => void remove()}
              >
                <Trash2 /> {t('Delete')}
              </Button>
            ) : null}
            {!isNew ? (
              <Button
                variant="outline"
                onClick={() => navigate(`/expenses/${draft.id}/voucher`)}
                disabled={changed}
                title={changed ? t('Save the expense first.') : undefined}
              >
                <Printer /> {t('Print voucher')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {isNew ? t('Record expense') : t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {vendorDialog.open ? (
        <ClientDialog
          open
          kind="vendor"
          onOpenChange={(open) => setVendorDialog((s) => ({ ...s, open }))}
          company={company}
          initialName={vendorDialog.name}
          onSaved={(saved) => set({ vendorId: saved.id })}
        />
      ) : null}
    </>
  );
}
