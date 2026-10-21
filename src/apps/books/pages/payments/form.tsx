import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Info, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { createPayment, isChequeSettled, newCheque, savePayment } from '@/db/payments';
import type { InvoiceDocument, Payment, PaymentMethod } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { accountingSettings } from '@/db/chart-setup';
import { currencyPrecision, dec, round, toMinor } from '@/lib/money';
import { today } from '@/lib/dates';
import { chequeStatusMeta } from '@/lib/status';
import {
  findPaymentAccount,
  PAYMENT_ACCOUNTS,
  providersFor,
  takesFee,
} from '@/lib/payment-methods';
import { currentLanguage, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader, Spinner } from '@/components/ui/misc';
import { StickyActions } from '@/components/ui/sticky-actions';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Combobox } from '@/components/ui/combobox';
import { CurrencySelect } from '@/components/fields';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { isCustomer, isVendor } from '@/db/purchases';
import {
  PAYMENT_COPY,
  paymentDirection,
  type PaymentDirection,
} from '@/apps/books/features/payments/direction';
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

const METHODS = new Set<string>([
  'bank_transfer',
  'knet',
  'cash',
  'wamd',
  'cheque',
  'link',
  'card',
  'bnpl',
  'cod',
  'other',
]);

export default function PaymentFormPage({ direction = 'in' }: { direction?: PaymentDirection }) {
  const copy = PAYMENT_COPY[direction];
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const { readOnly } = useReadOnly();
  const attachments = useDraftAttachments(payment?.id ?? '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: Payment | undefined;
      if (id) {
        loaded = await db.payments.get(id);
        if (!loaded || loaded.companyId !== company.id || paymentDirection(loaded) !== direction) {
          if (!cancelled) setMissing(true);
          return;
        }
      } else {
        const clientId = params.get('client') ?? '';
        const client = clientId ? await db.clients.get(clientId) : undefined;
        const wanted = params.get('method') ?? '';
        const method = (METHODS.has(wanted) ? wanted : 'bank_transfer') as PaymentMethod;
        loaded = createPayment(company.id, {
          direction,
          clientId,
          currency: client?.currency ?? company.currency,
          method,
          cheque: method === 'cheque' ? newCheque({ drawer: client?.name ?? '' }) : null,
        });
      }
      if (!cancelled) {
        setPayment(loaded);
        setOriginal(JSON.stringify(loaded));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, direction, company.id, company.currency, params]);

  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const accounts = useLiveQuery(
    () => db.accounts.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const clientId = payment?.clientId ?? '';
  const clientDocs = useLiveQuery(
    () =>
      clientId
        ? db.documents.where('clientId').equals(clientId).toArray()
        : Promise.resolve([] as InvoiceDocument[]),
    [clientId],
  );

  const dirty = (payment !== null && JSON.stringify(payment) !== original) || attachments.dirty;
  const allowNavigation = useUnsavedGuard(dirty && !saving);

  // The payment as stored before editing; what it already holds is available again.
  const before = useMemo(() => (original ? (JSON.parse(original) as Payment) : null), [original]);
  const previous = useMemo(
    () => new Map((before?.allocations ?? []).map((a) => [a.documentId, a.amount] as const)),
    [before],
  );

  const invoices = useMemo(() => {
    if (!clientDocs || !payment) return [];
    return clientDocs
      .filter(
        (d) =>
          d.type === copy.docType &&
          d.currency === payment.currency &&
          // Drafts are not in the books yet: they are issued first.
          (d.status === 'sent' || d.status === 'partial' || previous.has(d.id)),
      )
      .map((d) => ({
        doc: d,
        available: round(
          dec(d.totals.balance).plus(dec(previous.get(d.id) ?? 0)),
          currencyPrecision(d.currency),
        ),
      }))
      .filter((x) => x.available > 0 || previous.has(x.doc.id))
      .sort((a, b) =>
        (a.doc.dueDate ?? a.doc.issueDate).localeCompare(b.doc.dueDate ?? b.doc.issueDate),
      );
  }, [clientDocs, payment, previous, copy.docType]);

  const credits = useMemo(() => {
    if (!clientDocs || !payment) return [];
    return clientDocs.filter(
      (d) =>
        d.type === copy.creditType &&
        d.currency === payment.currency &&
        (d.status === 'sent' || d.status === 'partial' || before?.creditId === d.id),
    );
  }, [clientDocs, payment, before, copy.creditType]);

  const cashCheck = useCashCheck(company, {
    method: payment?.method ?? 'bank_transfer',
    direction,
    amount: payment?.amount ?? 0,
    currency: payment?.currency ?? company.currency,
    exchangeRate: payment?.exchangeRate,
  });

  if (missing) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This payment could not be found.')}</p>
        <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to {list}', { list: t(copy.title) })}
        </Link>
      </Card>
    );
  }
  if (!payment || !clients || !accounts) return <Spinner className="py-24" label={t('Loading…')} />;
  if (payment.voided) {
    return (
      <Card className="mx-auto max-w-xl p-10 text-center">
        <p className="text-slate-600">{t('This payment is void and can no longer be changed.')}</p>
        <Link
          to={`${copy.base}/${payment.id}`}
          className="text-primary-700 mt-4 inline-block text-sm font-medium"
        >
          {t('Open the payment')}
        </Link>
      </Card>
    );
  }

  const set = (patch: Partial<Payment>) => setPayment((p) => (p ? { ...p, ...patch } : p));
  const precision = currencyPrecision(payment.currency);
  const minor = (n: number) => toMinor(n, precision);
  const allocationFor = (docId: string) =>
    payment.allocations.find((a) => a.documentId === docId)?.amount ?? 0;
  const setAllocation = (docId: string, amount: number) =>
    set({
      allocations: [
        ...payment.allocations.filter((a) => a.documentId !== docId),
        ...(amount !== 0 ? [{ documentId: docId, amount }] : []),
      ],
    });
  const allocated = round(
    payment.allocations.reduce((s, a) => s.plus(dec(a.amount)), dec(0)),
    precision,
  );
  const unapplied = round(dec(payment.amount).minus(dec(allocated)), precision);
  const isCredit = payment.method === 'credit_note';
  const isCheque = payment.method === 'cheque';
  // Cheque payments recorded before cheques were tracked keep their old form.
  const legacyCheque = isCheque && !payment.cheque && before?.method === 'cheque' && !before.cheque;
  const settled = before ? isChequeSettled(before) : false;
  const selectedCredit = credits.find((c) => c.id === payment.creditId) ?? null;
  const creditAvailable = selectedCredit
    ? round(
        dec(selectedCredit.totals.balance).plus(
          dec(before?.creditId === selectedCredit.id ? before.amount : 0),
        ),
        precision,
      )
    : 0;
  const client = clients.find((c) => c.id === payment.clientId);
  const template = accountingSettings(company).template;
  const chequesKey = direction === 'out' ? 'chequesIssued' : 'chequesReceived';
  const chequesAccount = findPaymentAccount(accounts, chequesKey, template);
  const chequesName = chequesAccount
    ? `${chequesAccount.code} ${localName(chequesAccount)}`
    : `${PAYMENT_ACCOUNTS[chequesKey].code} ${
        currentLanguage() === 'ar'
          ? PAYMENT_ACCOUNTS[chequesKey].nameAr
          : PAYMENT_ACCOUNTS[chequesKey].name
      }`;
  const fee = payment.fee ?? 0;
  const showFee = takesFee(payment.method, direction);

  const changeMethod = (method: PaymentMethod) => {
    setCashConfirmed(false);
    set({
      method,
      creditId: null,
      // Back to the new method's own account.
      accountId: null,
      provider: providersFor(method).some((p) => p.value === payment.provider)
        ? payment.provider
        : null,
      cheque:
        method === 'cheque'
          ? (payment.cheque ??
            (legacyCheque ? null : newCheque({ date: payment.date, drawer: client?.name ?? '' })))
          : payment.cheque,
    });
  };

  const autoApply = () => {
    let remaining = dec(payment.amount);
    const next: Payment['allocations'] = [];
    for (const { doc, available } of invoices) {
      if (remaining.lte(0)) break;
      const amount = round(Math.min(available, remaining.toNumber()), precision);
      if (amount > 0) {
        next.push({ documentId: doc.id, amount });
        remaining = remaining.minus(dec(amount));
      }
    }
    set({ allocations: next });
  };

  const save = async () => {
    if (!payment.clientId) return toast.error(t(copy.chooseParty));
    if (!(payment.amount > 0)) return toast.error(t(copy.enterAmount));
    if (minor(allocated) > minor(payment.amount)) return toast.error(t(copy.overApplied));
    for (const { doc, available } of invoices) {
      if (minor(allocationFor(doc.id)) > minor(available))
        return toast.error(
          t('{number} only has {amount} left to pay.', {
            number: doc.number,
            amount: fmt.money(available, doc.currency),
          }),
        );
    }
    if (isCredit) {
      if (!selectedCredit) return toast.error(t(copy.chooseCredit));
      if (minor(payment.amount) > minor(creditAvailable))
        return toast.error(
          t(copy.creditAvailable, { amount: fmt.money(creditAvailable, payment.currency) }),
        );
    }
    if (isCheque && !legacyCheque && !payment.cheque?.number.trim()) {
      return toast.error(t('Enter the cheque number.'));
    }
    if ((cashCheck.status === 'over_limit' || cashCheck.status === 'banned') && !cashConfirmed) {
      return toast.error(t('Confirm the cash payment first.'));
    }
    setSaving(true);
    try {
      const saved = await savePayment({
        ...payment,
        creditId: isCredit ? payment.creditId : null,
        cheque: isCheque ? payment.cheque : null,
      });
      // The payment is saved even when its files can't be: say so.
      const filesSaved = await attachments.commit(company.id).then(
        () => true,
        () => false,
      );
      if (filesSaved) toast.success(t('Payment {number} saved', { number: saved.number }));
      else
        toast.error(
          t('Payment {number} saved, but its files were not. Attach them again on the payment.', {
            number: saved.number,
          }),
        );
      allowNavigation();
      navigate(`${copy.base}/${saved.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the payment.'));
      setSaving(false);
    }
  };

  const clientOptions = clients
    .filter(
      (c) =>
        (!c.archived && (direction === 'out' ? isVendor(c) : isCustomer(c))) ||
        c.id === payment.clientId,
    )
    .sort((a, b) => localName(a).localeCompare(localName(b)))
    .map((c) => ({
      value: c.id,
      label: localName(c),
      detail: c.number,
      keywords: `${c.name} ${c.nameAr ?? ''}`,
    }));

  const status = payment.cheque ? chequeStatusMeta(payment.cheque.status, direction) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        breadcrumb={<Link to={copy.base}>{t(copy.title)}</Link>}
        title={id ? t('Edit payment {number}', { number: payment.number }) : t(copy.recordTitle)}
        actions={
          <StickyActions>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={saving}>
              {t('Save payment')}
            </Button>
          </StickyActions>
        }
      />

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t(copy.party)} className="sm:col-span-2">
            {(fid) => (
              <Combobox
                id={fid}
                value={payment.clientId || null}
                onChange={(value) => {
                  const next = clients.find((c) => c.id === value);
                  const drawer = payment.cheque?.drawer;
                  set({
                    clientId: value,
                    allocations: [],
                    creditId: null,
                    currency: next?.currency ?? company.currency,
                    ...(payment.cheque && (!drawer || drawer === client?.name)
                      ? { cheque: { ...payment.cheque, drawer: next?.name ?? '' } }
                      : {}),
                  });
                }}
                options={clientOptions}
                placeholder={t(copy.who)}
                searchPlaceholder={t(copy.searchParties)}
                disabled={settled}
              />
            )}
          </Field>
          <Field label={t(copy.amount)}>
            {(fid) => (
              <NumberInput
                id={fid}
                value={payment.amount}
                onValueChange={(amount) => set({ amount })}
                allowNegative={false}
                disabled={settled}
              />
            )}
          </Field>
          <Field label={t('Currency')}>
            {(fid) => (
              <CurrencySelect
                id={fid}
                value={payment.currency}
                onChange={(currency) => set({ currency, allocations: [], creditId: null })}
              />
            )}
          </Field>
          <Field label={t('Date')}>
            {(fid) => (
              <DateField
                id={fid}
                value={payment.date}
                onChange={(iso) => set({ date: iso || today() })}
              />
            )}
          </Field>
          <Field label={t('Method')} hint={noCashHint(company, direction)}>
            {(fid) =>
              settled ? (
                <Input id={fid} value={t('Cheque')} disabled />
              ) : (
                <MethodSelect
                  id={fid}
                  value={payment.method}
                  onChange={changeMethod}
                  direction={direction}
                  company={company}
                />
              )
            }
          </Field>
          {providersFor(payment.method).length ? (
            <Field label={t('Provider')} optional>
              {(fid) => (
                <ProviderSelect
                  id={fid}
                  method={payment.method}
                  value={payment.provider}
                  onChange={(provider) => set({ provider })}
                />
              )}
            </Field>
          ) : null}
          {showFee ? (
            <Field
              label={t('Fee')}
              optional
              hint={
                fee > 0
                  ? t('{amount} reaches the account after the fee.', {
                      amount: fmt.money(
                        round(dec(payment.amount).minus(dec(fee)), precision),
                        payment.currency,
                      ),
                    })
                  : t('What KNET, the bank or the provider keeps. Recorded as KNET and card fees.')
              }
            >
              {(fid) => (
                <NumberInput
                  id={fid}
                  value={fee}
                  onValueChange={(value) => set({ fee: value })}
                  allowNegative={false}
                />
              )}
            </Field>
          ) : null}
          {!isCredit && !isCheque ? (
            <Field label={t(copy.account)} hint={t(copy.accountHint)}>
              {(fid) => (
                <PaymentAccountSelect
                  id={fid}
                  value={payment.accountId}
                  onChange={(accountId) => set({ accountId })}
                  accounts={accounts}
                  company={company}
                  direction={direction}
                  method={payment.method}
                />
              )}
            </Field>
          ) : null}
          {!isCredit && payment.currency !== company.currency ? (
            <Field
              label={t('Exchange rate')}
              hint={t('1 {currency} = {rate} {base} on the payment date', {
                currency: payment.currency,
                rate: payment.exchangeRate || '?',
                base: company.currency,
              })}
            >
              {(fid) => (
                <NumberInput
                  id={fid}
                  value={payment.exchangeRate ?? 0}
                  onValueChange={(exchangeRate) => set({ exchangeRate })}
                  allowNegative={false}
                  disabled={settled}
                />
              )}
            </Field>
          ) : null}
          {isCredit ? (
            <Field
              label={t(copy.credit)}
              className="sm:col-span-2"
              hint={
                selectedCredit
                  ? t('{amount} available', {
                      amount: fmt.money(creditAvailable, payment.currency),
                    })
                  : undefined
              }
            >
              {(fid) => (
                <Select
                  id={fid}
                  value={payment.creditId ?? ''}
                  onChange={(e) => {
                    const credit = credits.find((c) => c.id === e.target.value);
                    set({
                      creditId: e.target.value || null,
                      reference: credit?.number ?? payment.reference,
                      amount: credit ? credit.totals.balance : payment.amount,
                    });
                  }}
                >
                  <option value="">
                    {credits.length ? t(copy.chooseCreditOption) : t(copy.noCredits)}
                  </option>
                  {credits.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number} ·{' '}
                      {t('{amount} available', { amount: fmt.money(c.totals.balance, c.currency) })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label={t('Reference')} optional>
            {(fid) => (
              <Input
                id={fid}
                value={payment.reference}
                onChange={(e) => set({ reference: e.target.value })}
                placeholder={t('Transaction ID or KNET reference')}
              />
            )}
          </Field>
          <Field label={t('Notes')} optional className="sm:col-span-2">
            {(fid) => (
              <Textarea
                id={fid}
                value={payment.notes}
                onChange={(e) => set({ notes: e.target.value })}
                rows={2}
              />
            )}
          </Field>
          <CashRuleNotice
            company={company}
            check={cashCheck}
            confirmed={cashConfirmed}
            onConfirm={setCashConfirmed}
            className="sm:col-span-2"
          />
        </CardBody>
      </Card>

      {isCheque ? (
        <Card>
          <CardHeader
            title={t('Cheque')}
            description={
              legacyCheque
                ? undefined
                : direction === 'out'
                  ? t('Held in {account} until the vendor presents it.', { account: chequesName })
                  : t('Held in {account} until it clears.', { account: chequesName })
            }
            actions={status ? <Badge tone={status.tone}>{t(status.label)}</Badge> : null}
          />
          <CardBody>
            {legacyCheque ? (
              <p className="flex gap-2 text-sm text-slate-600">
                <Info className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
                {t(
                  'This cheque was recorded before cheques were tracked, so it is not in the cheque register.',
                )}
              </p>
            ) : payment.cheque ? (
              <ChequeFields
                cheque={payment.cheque}
                onChange={(patch) =>
                  set({ cheque: payment.cheque ? { ...payment.cheque, ...patch } : null })
                }
                direction={direction}
                paymentDate={payment.date}
              />
            ) : null}
            {before?.cheque?.printedAt && !settled ? (
              <p className="mt-4 flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t(
                  'This cheque was printed on {date}. Saving another amount, payee, number, bank or date marks the printed leaf spoiled: destroy it and print the cheque again.',
                  { date: fmt.dateTime(before.cheque.printedAt) },
                )}
              </p>
            ) : null}
            {settled ? (
              <p className="mt-4 text-sm text-slate-500">
                {t(
                  'This cheque has its own entries now. Only the notes and the documents it pays can change.',
                )}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={t('Attachments')}
          description={t('A scan of the cheque or the transfer receipt.')}
        />
        <CardBody>
          <AttachmentList
            files={attachments.files}
            onAdd={attachments.add}
            onRemove={attachments.remove}
            camera
            readOnly={readOnly}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t(copy.applyTitle)}
          description={t(copy.applyDescription)}
          actions={
            invoices.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={autoApply}
                disabled={!(payment.amount > 0)}
              >
                <Wand2 /> {t('Apply oldest first')}
              </Button>
            ) : null
          }
        />
        {!payment.clientId ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">{t(copy.pickPartyFirst)}</p>
        ) : invoices.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            {t(copy.noOpenDocs, { currency: payment.currency })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <th className="px-5 py-3 text-start">{t(copy.doc)}</th>
                  <th className="px-3 py-3 text-start">{t('Due')}</th>
                  <th className="px-3 py-3 text-end">{t('Open balance')}</th>
                  <th className="w-40 px-5 py-3 text-end">{t('Apply')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map(({ doc, available }) => (
                  <tr key={doc.id}>
                    <td className="px-5 py-2.5">
                      <Link
                        to={`${copy.docBase}/${doc.id}`}
                        className="hover:text-primary-700 font-medium text-slate-900"
                      >
                        {doc.number}
                      </Link>
                      {doc.status === 'draft' ? <Badge className="ms-2">{t('Draft')}</Badge> : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmt.date(doc.dueDate) || '—'}</td>
                    <td className="tabular px-3 py-2.5 text-end text-slate-700">
                      {fmt.money(available, doc.currency)}
                    </td>
                    <td className="px-5 py-2.5">
                      <NumberInput
                        aria-label={t('Amount applied to {number}', { number: doc.number })}
                        value={allocationFor(doc.id)}
                        onValueChange={(v) => setAllocation(doc.id, v)}
                        allowNegative={false}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-slate-100 px-5 py-3 text-sm">
          <span className="text-slate-500">
            {t('Applied')}{' '}
            <strong className="tabular text-slate-900">
              {fmt.money(allocated, payment.currency)}
            </strong>
          </span>
          <span className={unapplied < 0 ? 'text-red-600' : 'text-slate-500'}>
            {t('Unapplied')}{' '}
            <strong className="tabular">{fmt.money(unapplied, payment.currency)}</strong>
          </span>
        </div>
      </Card>
    </div>
  );
}
