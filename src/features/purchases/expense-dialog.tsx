import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteExpense, isVendor, saveExpense } from '@/db/purchases';
import type { Expense, TaxLine } from '@/db/types';
import { isReverseCharge } from '@/lib/calc';
import { useCompany, useFormat } from '@/app/company';
import { currencyPrecision, dec } from '@/lib/money';
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
import { TaxSelect } from '@/features/editor/tax-select';
import { ClientDialog } from '@/features/clients/client-dialog';
import {
  categoryOptions,
  MoneyAccountSelect,
  useAccounts,
} from '@/features/accounting/account-pickers';
import { AttachmentList, useDraftAttachments } from './attachments';

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

  const set = (patch: Partial<Expense>) => setDraft((d) => ({ ...d, ...patch }));
  const currency = draft.currency || company.currency;
  const tax = includedTax(draft.amount, draft.taxes, currency);
  const reverse = reverseChargeTax(draft.amount, draft.taxes, currency);
  const vendorOptions = (clients ?? [])
    .filter((c) => (isVendor(c) && !c.archived) || c.id === draft.vendorId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, detail: c.number }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveExpense(draft);
      await attachments.commit(company.id);
      toast.success(`Expense ${saved.number} ${isNew ? 'recorded' : 'saved'}`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the expense.');
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete expense ${draft.number}?`,
      description: 'Its receipt is deleted too. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteExpense(draft.id);
      toast.success('Expense deleted');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the expense.');
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          title={isNew ? 'Record expense' : `Expense ${draft.number}`}
          description="Something paid straight away, without a bill to pay later."
          size="lg"
        >
          <DialogBody>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={draft.date}
                    onChange={(e) => e.target.value && set({ date: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Category">
                {(id) => (
                  <Combobox
                    id={id}
                    value={draft.accountId || null}
                    onChange={(accountId) => set({ accountId })}
                    options={categoryOptions(accounts ?? [], [draft.accountId])}
                    placeholder="Choose a category…"
                    searchPlaceholder="Search accounts…"
                  />
                )}
              </Field>
              <Field
                label="Amount paid"
                hint={
                  reverse
                    ? `Reverse charge: ${fmt.money(reverse, currency)} VAT due and reclaimed on your return`
                    : tax
                      ? `Includes ${fmt.money(tax, currency)} tax`
                      : 'The total on the receipt, tax included.'
                }
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={draft.amount}
                    onValueChange={(amount) => set({ amount })}
                    allowNegative={false}
                    blankZero
                  />
                )}
              </Field>
              <Field label="Tax included">
                {(id) => (
                  <TaxSelect
                    id={id}
                    value={draft.taxes}
                    onChange={(taxes) => set({ taxes })}
                    rates={taxRates ?? []}
                  />
                )}
              </Field>
              <Field label="Currency">
                {(id) => (
                  <CurrencySelect
                    id={id}
                    value={currency}
                    onChange={(value) => set({ currency: value })}
                  />
                )}
              </Field>
              <Field label="Paid from">
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
                  label="Exchange rate"
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
              <Field label="Vendor" optional>
                {(id) => (
                  <Combobox
                    id={id}
                    value={draft.vendorId}
                    onChange={(vendorId) => set({ vendorId })}
                    options={vendorOptions}
                    placeholder="Who was paid?"
                    searchPlaceholder="Search vendors…"
                    onCreate={(name) => setVendorDialog({ open: true, name })}
                    createLabel="New vendor"
                  />
                )}
              </Field>
              <Field label="Reference" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.reference}
                    onChange={(e) => set({ reference: e.target.value })}
                    placeholder="Receipt or transaction number"
                  />
                )}
              </Field>
              <Field label="Description" className="sm:col-span-2">
                {(id) => (
                  <Input
                    id={id}
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    placeholder="e.g. Train to client meeting"
                  />
                )}
              </Field>
              <Field label="Notes" optional className="sm:col-span-2">
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
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Receipt</p>
              <AttachmentList
                files={attachments.files}
                onAdd={attachments.add}
                onRemove={attachments.remove}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            {!isNew ? (
              <Button
                variant="ghost"
                className="me-auto text-red-600 hover:bg-red-50"
                onClick={() => void remove()}
              >
                <Trash2 /> Delete
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {isNew ? 'Record expense' : 'Save'}
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
