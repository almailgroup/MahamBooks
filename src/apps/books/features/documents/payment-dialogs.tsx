import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { db } from '@/db/db';
import type {
  ChequeDetails,
  Company,
  InvoiceDocument,
  PaymentMethod,
  PaymentProvider,
} from '@/db/types';
import { createPayment, newCheque, savePayment } from '@/db/payments';
import { useFormat } from '@/app/company';
import { today } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { currencyPrecision, dec, round, toMinor } from '@/lib/money';
import { providersFor, takesFee } from '@/lib/payment-methods';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { useAccounts } from '@/apps/books/features/accounting/account-pickers';
import {
  CashRuleNotice,
  ChequeFields,
  MethodSelect,
  noCashHint,
  PaymentAccountSelect,
  ProviderSelect,
  useCashCheck,
} from '@/apps/books/features/payments/fields';
import { DateField } from '@/components/ui/date-field';
import { useReadOnly } from '@/components/ui/read-only';
import { AttachmentList, useDraftAttachments } from '@/features/purchases/attachments';
import { ChequeConfirmationRequiredError } from '@/db/cheque-rules';
import { requestChequeConfirmation } from '@/db/cheque-approvals';
import { useChequeView, useMyName } from '@/features/approvals/hooks';

/** Records a payment against one invoice (money in) or bill (money out). */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoice,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceDocument;
  company: Company;
}) {
  const out = invoice.type === 'bill';
  const direction = out ? 'out' : 'in';
  const fmt = useFormat();
  const accounts = useAccounts();
  const vendorOrClient = useLiveQuery(
    () => (invoice.clientId ? db.clients.get(invoice.clientId) : undefined),
    [invoice.clientId],
  );
  const [amount, setAmount] = useState(Math.max(0, invoice.totals.balance));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [fee, setFee] = useState(0);
  const [chequeInput, setCheque] = useState<ChequeDetails | null>(null);
  const [drawerEdited, setDrawerEdited] = useState(false);
  // The drawer defaults to the contact, which may still be loading when the
  // method changes to cheque.
  const cheque =
    chequeInput && !chequeInput.drawer && !drawerEdited && vendorOrClient
      ? { ...chequeInput, drawer: vendorOrClient.name }
      : chequeInput;
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Known before saving, so scans can be attached to the payment to be.
  const [paymentId] = useState(newId);
  const attachments = useDraftAttachments(paymentId);
  const { readOnly } = useReadOnly();
  const precision = currencyPrecision(invoice.currency);
  const money = (n: number) => fmt.money(n, invoice.currency);
  const overpaid = toMinor(amount, precision) > toMinor(invoice.totals.balance, precision);
  const cashCheck = useCashCheck(company, {
    method,
    direction,
    amount,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate,
  });
  const isCheque = method === 'cheque';
  const showFee = takesFee(method, direction);
  // A cheque the company's rules keep for an approver's confirmation (#9).
  const chequeView = useChequeView(company);
  const myName = useMyName();
  const waits = chequeView.waits('payments', undefined, { method, direction });

  const changeMethod = (next: PaymentMethod) => {
    setMethod(next);
    setAccountId(null);
    setCashConfirmed(false);
    if (!providersFor(next).some((p) => p.value === provider)) setProvider(null);
    if (next === 'cheque' && !cheque) {
      setCheque(newCheque({ date, drawer: vendorOrClient?.name ?? '' }));
    }
  };

  const save = async () => {
    if (!(amount > 0)) {
      toast.error(out ? t('Enter the amount paid.') : t('Enter the amount received.'));
      return;
    }
    if (isCheque && !cheque?.number.trim()) {
      toast.error(t('Enter the cheque number.'));
      return;
    }
    if ((cashCheck.status === 'over_limit' || cashCheck.status === 'banned') && !cashConfirmed) {
      toast.error(t('Confirm the cash payment first.'));
      return;
    }
    setSaving(true);
    try {
      const applied = Math.min(amount, Math.max(0, invoice.totals.balance));
      const saved = await savePayment(
        createPayment(company.id, {
          id: paymentId,
          direction,
          clientId: invoice.clientId,
          accountId,
          date,
          amount,
          currency: invoice.currency,
          // Same rate as the invoice unless the user records it differently later.
          exchangeRate: invoice.exchangeRate,
          method,
          provider,
          fee: showFee && fee > 0 ? fee : undefined,
          cheque: isCheque ? cheque : null,
          reference: reference.trim() || (isCheque ? (cheque?.number.trim() ?? '') : ''),
          notes: notes.trim(),
          allocations:
            applied > 0 ? [{ documentId: invoice.id, amount: round(applied, precision) }] : [],
        }),
      );
      const filesSaved = await attachments.commit(company.id).then(
        () => true,
        () => false,
      );
      if (filesSaved) toast.success(t('Payment of {amount} recorded', { amount: money(amount) }));
      else
        toast.error(
          t('Payment {number} saved, but its files were not. Attach them again on the payment.', {
            number: saved.number,
          }),
        );
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ChequeConfirmationRequiredError) {
        // Not a payment yet: it waits for an approver, with its scans.
        try {
          await requestChequeConfirmation(error.ask, { byName: myName });
          await attachments.commit(company.id).catch(() => undefined);
          toast.success(
            t('Sent for confirmation. The cheque is recorded once an approver confirms it.'),
          );
          onOpenChange(false);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('Could not record the payment.'));
        }
        return;
      }
      toast.error(error instanceof Error ? error.message : t('Could not record the payment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('Record payment')}
        description={t('{number} · balance {amount}', {
          number: invoice.number,
          amount: money(invoice.totals.balance),
        })}
        size={isCheque ? 'lg' : 'md'}
      >
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('Amount ({currency})', { currency: invoice.currency })}
              hint={
                overpaid
                  ? out
                    ? t('The extra {amount} stays as an advance to the vendor.', {
                        amount: money(
                          round(dec(amount).minus(dec(invoice.totals.balance)), precision),
                        ),
                      })
                    : t('The extra {amount} stays as client credit.', {
                        amount: money(
                          round(dec(amount).minus(dec(invoice.totals.balance)), precision),
                        ),
                      })
                  : undefined
              }
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={amount}
                  onValueChange={setAmount}
                  allowNegative={false}
                  autoFocus
                />
              )}
            </Field>
            <Field label={t('Date')}>
              {(id) => (
                <DateField id={id} value={date} onChange={(iso) => setDate(iso || today())} />
              )}
            </Field>
            <Field label={t('Method')} hint={noCashHint(company, direction)}>
              {(id) => (
                <MethodSelect
                  id={id}
                  value={method}
                  onChange={changeMethod}
                  direction={direction}
                  company={company}
                  creditNotes={false}
                />
              )}
            </Field>
            {isCheque ? null : (
              <Field label={out ? t('Paid from') : t('Deposit to')}>
                {(id) => (
                  <PaymentAccountSelect
                    id={id}
                    value={accountId}
                    onChange={setAccountId}
                    accounts={accounts ?? []}
                    company={company}
                    direction={direction}
                    method={method}
                  />
                )}
              </Field>
            )}
            {providersFor(method).length ? (
              <Field label={t('Provider')} optional>
                {(id) => (
                  <ProviderSelect id={id} method={method} value={provider} onChange={setProvider} />
                )}
              </Field>
            ) : null}
            {showFee ? (
              <Field label={t('Fee')} optional hint={t('Recorded as KNET and card fees.')}>
                {(id) => (
                  <NumberInput id={id} value={fee} onValueChange={setFee} allowNegative={false} />
                )}
              </Field>
            ) : null}
            {isCheque ? null : (
              <Field label={t('Reference')} optional>
                {(id) => (
                  <Input
                    id={id}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={t('Transaction ID or KNET reference')}
                  />
                )}
              </Field>
            )}
          </div>
          {isCheque && cheque ? (
            <ChequeFields
              cheque={cheque}
              onChange={(patch) => {
                if ('drawer' in patch) setDrawerEdited(true);
                setCheque({ ...cheque, ...patch });
              }}
              direction={direction}
              paymentDate={date}
            />
          ) : null}
          {waits ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t(
                'This cheque waits for an approver’s confirmation. It is recorded, numbered and paid against the documents once confirmed, dated {date}.',
                { date: fmt.date(date) },
              )}
            </p>
          ) : null}
          <CashRuleNotice
            company={company}
            check={cashCheck}
            confirmed={cashConfirmed}
            onConfirm={setCashConfirmed}
          />
          <Field label={t('Notes')} optional>
            {(id) => (
              <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            )}
          </Field>
          <section aria-label={t('Attachments')}>
            <p className="mb-2 text-sm font-medium text-slate-700">
              {t('Attachments')}
              <span className="ms-1 font-normal text-slate-500">({t('optional')})</span>
            </p>
            <AttachmentList
              files={attachments.files}
              onAdd={attachments.add}
              onRemove={attachments.remove}
              emptyText={t('A scan of the cheque or the transfer receipt.')}
              camera
              compact
              readOnly={readOnly}
            />
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving}>
            {waits ? t('Send for confirmation') : t('Record payment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Applies a credit note to an open invoice, or a vendor credit to an open bill. */
export function ApplyCreditDialog({
  open,
  onOpenChange,
  credit,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: InvoiceDocument;
  company: Company;
}) {
  const out = credit.type === 'vendor_credit';
  const target = out ? 'bill' : 'invoice';
  const fmt = useFormat();
  const invoices = useLiveQuery(
    () =>
      db.documents
        .where('clientId')
        .equals(credit.clientId)
        .filter(
          (d) =>
            d.type === target &&
            (d.status === 'sent' || d.status === 'partial') &&
            d.totals.balance > 0 &&
            d.currency === credit.currency,
        )
        .toArray(),
    [credit.clientId, credit.currency, target],
  );
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const money = (n: number) => fmt.money(n, credit.currency);
  const selected = useMemo(
    () => invoices?.find((i) => i.id === invoiceId) ?? null,
    [invoices, invoiceId],
  );
  const max = selected
    ? Math.min(credit.totals.balance, selected.totals.balance)
    : credit.totals.balance;

  const save = async () => {
    if (!selected || amount <= 0) {
      toast.error(out ? t('Choose a bill and an amount.') : t('Choose an invoice and an amount.'));
      return;
    }
    setSaving(true);
    try {
      const value = Math.min(amount, max);
      await savePayment(
        createPayment(company.id, {
          direction: out ? 'out' : 'in',
          clientId: credit.clientId,
          date: today(),
          amount: value,
          currency: credit.currency,
          method: 'credit_note',
          creditId: credit.id,
          reference: credit.number,
          allocations: [{ documentId: selected.id, amount: value }],
        }),
      );
      toast.success(
        t('{amount} applied to {number}', { amount: money(value), number: selected.number }),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not apply the credit.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={out ? t('Apply vendor credit') : t('Apply credit note')}
        description={t('{number} · {amount} available', {
          number: credit.number,
          amount: money(credit.totals.balance),
        })}
      >
        <DialogBody>
          {invoices && invoices.length === 0 ? (
            <p className="text-sm text-slate-600">
              {out
                ? t('This vendor has no open bills in {currency}.', { currency: credit.currency })
                : t('This client has no open invoices in {currency}.', {
                    currency: credit.currency,
                  })}
            </p>
          ) : (
            <>
              <Field label={out ? t('Bill') : t('Invoice')}>
                {(id) => (
                  <Select
                    id={id}
                    value={invoiceId}
                    onChange={(e) => {
                      setInvoiceId(e.target.value);
                      const inv = invoices?.find((i) => i.id === e.target.value);
                      if (inv) setAmount(Math.min(credit.totals.balance, inv.totals.balance));
                    }}
                  >
                    <option value="">{out ? t('Choose a bill…') : t('Choose an invoice…')}</option>
                    {invoices?.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {t('{number} · {date} · balance {amount}', {
                          number: inv.number,
                          date: fmt.date(inv.issueDate),
                          amount: money(inv.totals.balance),
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={t('Amount to apply')}
                hint={t('Up to {amount}', { amount: money(max) })}
              >
                {(id) => (
                  <NumberInput
                    id={id}
                    value={amount}
                    onValueChange={setAmount}
                    allowNegative={false}
                  />
                )}
              </Field>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={saving} disabled={!selected}>
            {t('Apply credit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
