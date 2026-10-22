import { useMemo, useState } from 'react';
import { addYears } from 'date-fns';
import { toast } from 'sonner';
import { renewDocument, feeAccountSpec, findFeeAccount } from '@/db/renewals';
import type { ISODate } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { documentTypeInfo, type RegisterEntry } from '@/lib/compliance';
import { parseISODate, toISODate, today } from '@/lib/dates';
import { useAccounts } from '@/apps/books/features/accounting/account-pickers';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Switch, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { expenseCategoryOptions, PaidFromSelect } from './account-fields';
import { entryTitle } from './display';
import { currentLanguage, t } from '@/i18n';
import { DateField } from '@/components/ui/date-field';
import { FileList } from '@/features/people/file-list';
import type { AttachedFile } from '@/features/purchases/attachments';

/** Category value meaning "the fee account, created when the company doesn't have it". */
const NEW_FEE_ACCOUNT = '__fee_account__';

/** Passports usually last ten years; everything else is renewed for a year at a time. */
function suggestedExpiry(entry: RegisterEntry): ISODate {
  const now = today();
  const base = entry.expiryDate && entry.expiryDate > now ? entry.expiryDate : now;
  return toISODate(addYears(parseISODate(base), entry.type === 'passport' ? 10 : 1));
}

/**
 * Renews a document: a new expiry date and, if a fee was paid, an expense
 * in the government fees (or licence) account paid from the bank or cash.
 */
export function RenewDialog({
  entry,
  owner,
  onClose,
}: {
  entry: RegisterEntry;
  /** Who the document belongs to, for the title. */
  owner: string;
  onClose: () => void;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const accounts = useAccounts();
  const title = entryTitle(entry);
  const [renewedOn, setRenewedOn] = useState(today());
  const [newExpiry, setNewExpiry] = useState(() => suggestedExpiry(entry));
  const [number, setNumber] = useState('');
  const [recordFee, setRecordFee] = useState(true);
  const [fee, setFee] = useState(entry.renewalCost);
  const [category, setCategory] = useState<string | null>(null);
  const [paidFrom, setPaidFrom] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  // The renewed paper's new copy (#18), kept with the document and marked as it.
  const [copy, setCopy] = useState<AttachedFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feeAccount = useMemo(
    () => (accounts ? findFeeAccount(accounts, company, entry.type) : null),
    [accounts, company, entry.type],
  );
  const categoryValue = category ?? feeAccount?.id ?? NEW_FEE_ACCOUNT;
  const options = useMemo(() => {
    const list = expenseCategoryOptions(accounts ?? [], category ? [category] : []);
    if (feeAccount) return list;
    const spec = feeAccountSpec(documentTypeInfo(entry.type).fee);
    const name = currentLanguage() === 'ar' && spec.nameAr ? spec.nameAr : spec.name;
    return [
      { value: NEW_FEE_ACCOUNT, label: name, detail: t('New account'), keywords: spec.name },
      ...list,
    ];
  }, [accounts, category, feeAccount, entry.type]);
  const hasNumber = entry.type !== 'employment_contract';

  const save = async () => {
    setError(null);
    if (!newExpiry || newExpiry <= (entry.expiryDate ?? renewedOn)) {
      setError(t('The new expiry date must be after the current one.'));
      return;
    }
    setSaving(true);
    try {
      const { expense } = await renewDocument({
        companyId: company.id,
        key: entry.key,
        newExpiry,
        renewedOn,
        number: number.trim() || undefined,
        note,
        copy: copy ? { name: copy.name, type: copy.type, dataUrl: copy.dataUrl } : null,
        fee:
          recordFee && fee > 0
            ? {
                amount: fee,
                accountId: categoryValue === NEW_FEE_ACCOUNT ? null : categoryValue,
                paidFromAccountId: paidFrom,
                reference,
              }
            : null,
      });
      toast.success(
        t('{document} renewed until {date}', { document: title, date: fmt.date(newExpiry) }),
        expense
          ? {
              description: t('Expense {number} of {amount} recorded', {
                number: expense.number,
                amount: fmt.money(expense.amount),
              }),
            }
          : undefined,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not renew the document.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('Renew {document}', { document: title })}
        description={
          entry.expiryDate
            ? t('{owner} · expires {date}', { owner, date: fmt.date(entry.expiryDate) })
            : owner
        }
      >
        <DialogBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('Renewed on')}>
              {(id) => (
                <DateField id={id} value={renewedOn} onChange={(iso) => iso && setRenewedOn(iso)} />
              )}
            </Field>
            <Field label={t('New expiry date')}>
              {(id) => (
                <DateField
                  id={id}
                  value={newExpiry}
                  min={entry.expiryDate ?? undefined}
                  onChange={(iso) => setNewExpiry(iso)}
                  aria-invalid={Boolean(error)}
                />
              )}
            </Field>
            {hasNumber ? (
              <Field
                label={t('New document number')}
                optional
                hint={t('Only if the renewal changes it.')}
                className="sm:col-span-2"
              >
                {(id) => (
                  <Input
                    id={id}
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder={entry.number}
                    dir="auto"
                  />
                )}
              </Field>
            ) : null}
          </div>

          <div className="space-y-4 rounded-lg border border-slate-200 p-4">
            <Switch
              checked={recordFee}
              onChange={setRecordFee}
              label={t('Record the fee as an expense')}
              description={t(
                'Adds an expense paid from your bank or cash, so the books stay complete.',
              )}
            />
            {recordFee ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('Fee paid')}>
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={fee}
                      onValueChange={setFee}
                      allowNegative={false}
                      blankZero
                    />
                  )}
                </Field>
                <Field label={t('Paid from')}>
                  {(id) => (
                    <PaidFromSelect
                      id={id}
                      value={paidFrom}
                      onChange={setPaidFrom}
                      accounts={accounts ?? []}
                    />
                  )}
                </Field>
                <Field label={t('Category')} className="sm:col-span-2">
                  {(id) => (
                    <Combobox
                      id={id}
                      value={categoryValue}
                      onChange={setCategory}
                      options={options}
                      searchPlaceholder={t('Search accounts…')}
                      emptyText={t('No matches')}
                    />
                  )}
                </Field>
                <Field label={t('Receipt number')} optional className="sm:col-span-2">
                  {(id) => (
                    <Input
                      id={id}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      dir="auto"
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              {t('New copy')}
              <span className="ms-1 font-normal text-slate-500">({t('optional')})</span>
            </p>
            <p className="text-xs text-slate-500">
              {entry.source === 'employee'
                ? t('A scan of the renewed paper. It goes to the employee’s personnel file.')
                : t('A scan of the renewed paper. It is kept with the document.')}
            </p>
            <FileList
              files={copy ? [copy] : []}
              onAdd={(file) => setCopy(file)}
              onRemove={() => setCopy(null)}
              addLabel={copy ? t('Choose another file') : t('Add the new copy')}
            />
          </div>

          <Field label={t('Note')} optional>
            {(id) => (
              <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Renew')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
