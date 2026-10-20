import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Mail, Pencil, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  canDeletePayment,
  canEditPayment,
  deletePayment,
  paymentMethodLabel,
  unappliedAmount,
} from '@/db/payments';
import { addAttachment, removeAttachment } from '@/db/purchases';
import type { ChequeDetails, InvoiceDocument, Payment } from '@/db/types';
import { DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { fillTemplate, mailtoLink } from '@/lib/email';
import { bankName } from '@/lib/cheques';
import { providerLabel } from '@/lib/payment-methods';
import { currentLanguage, t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { useReadOnly } from '@/components/ui/read-only';
import { useAccounts } from '@/apps/books/features/accounting/account-pickers';
import {
  PAYMENT_COPY,
  paymentDirection,
  type PaymentDirection,
} from '@/apps/books/features/payments/direction';
import { PaymentStatusBadge } from '@/apps/books/features/payments/status-badge';
import {
  ChequeActionDialog,
  ChequeActionsMenu,
  type ChequeAction,
} from '@/apps/books/features/cheques/action-dialogs';
import { AttachmentList } from '@/features/purchases/attachments';
import { hasVoucher } from '@/pdf/voucher/model';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 text-end break-words text-slate-800">{value}</span>
    </div>
  );
}

export default function PaymentDetailPage({ direction = 'in' }: { direction?: PaymentDirection }) {
  const copy = PAYMENT_COPY[direction];
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const [action, setAction] = useState<ChequeAction | null>(null);

  const payment = useLiveQuery(() => db.payments.get(id), [id]);
  const client = useLiveQuery(
    async () => (payment?.clientId ? ((await db.clients.get(payment.clientId)) ?? null) : null),
    [payment?.clientId],
  );
  const docs = useLiveQuery(async () => {
    if (!payment) return [];
    const ids = [...payment.documentIds, ...(payment.creditId ? [payment.creditId] : [])];
    return (await db.documents.bulkGet(ids)).filter((d): d is InvoiceDocument => Boolean(d));
  }, [payment]);
  // The cheque this one replaced, or the one that replaced it.
  const linked = useLiveQuery(async () => {
    const ids = [payment?.cheque?.replacedById, payment?.cheque?.replacesId].filter(
      (x): x is string => Boolean(x),
    );
    return (await db.payments.bulkGet(ids)).filter((p): p is Payment => Boolean(p));
  }, [payment?.cheque?.replacedById, payment?.cheque?.replacesId]);
  const accounts = useAccounts();
  const files = useLiveQuery(() => db.attachments.where('ownerId').equals(id).toArray(), [id]);
  const { readOnly } = useReadOnly();

  if (payment === undefined || client === undefined || !docs)
    return <Spinner className="py-24" label={t('Loading…')} />;
  if (payment && payment.companyId === company.id && paymentDirection(payment) !== direction) {
    // Links that only know "a payment" (the general ledger) land on the right page.
    return (
      <Navigate to={`${PAYMENT_COPY[paymentDirection(payment)].base}/${payment.id}`} replace />
    );
  }
  if (!payment || payment.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This payment could not be found.')}</p>
        <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to {list}', { list: t(copy.title) })}
        </Link>
      </Card>
    );
  }

  const money = (n: number) => fmt.money(n, payment.currency);
  const accountName = (accountId?: string | null) => {
    const a = accounts?.find((x) => x.id === accountId);
    return a ? `${a.code} ${localName(a)}` : '—';
  };
  // Same choice as the ledger: the account stored, else bank (or cash for cash payments).
  const cashLike = payment.method === 'cash' || payment.method === 'cod';
  const account =
    accounts?.find((a) => a.id === payment.accountId) ??
    accounts?.find((a) => a.role === (cashLike ? 'cash' : 'bank')) ??
    accounts?.find((a) => a.role === 'bank');
  const credit = payment.creditId ? docs.find((d) => d.id === payment.creditId) : null;
  const unapplied = payment.voided ? 0 : unappliedAmount(payment);
  const cheque = payment.cheque;
  const replacedBy = linked?.find((p) => p.id === cheque?.replacedById);
  const replaces = linked?.find((p) => p.id === cheque?.replacesId);
  const language = currentLanguage();

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete payment {number}?', { number: payment.number }),
      description: files?.length
        ? `${t(copy.deleteDescription)} ${t('Its attached files are deleted with it.')}`
        : t(copy.deleteDescription),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePayment(payment.id);
      toast.success(t('Payment deleted'));
      navigate(copy.base);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    }
  };

  const contact = client?.contacts.find((c) => c.primary) ?? client?.contacts[0];
  const email = contact?.email || client?.email || '';
  const receipt = () => {
    const values = {
      client: client?.name ?? '',
      contact: contact?.name || client?.name || 'there',
      number: payment.number,
      amount: money(payment.amount),
      balance: '',
      issueDate: fmt.date(payment.date),
      dueDate: '',
      company: company.name,
      paymentLink: '',
    };
    window.location.assign(
      mailtoLink({
        to: email ? [email] : [],
        subject: fillTemplate(company.emailTemplates.payment.subject, values),
        body: fillTemplate(company.emailTemplates.payment.body, values),
      }),
    );
  };

  const partyLink = client ? (
    <Link
      to={`${copy.contactBase}/${client.id}`}
      className="hover:text-primary-700 font-medium text-slate-700"
    >
      <bdi>{localName(client)}</bdi>
    </Link>
  ) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to={copy.base} className="hover:text-slate-700">
              {t(copy.title)}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t('Payment {number}', { number: payment.number })}
            </h1>
            <PaymentStatusBadge payment={payment} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {partyLink
              ? tr(copy.from, { amount: money(payment.amount), name: partyLink })
              : t(copy.unknownParty, { amount: money(payment.amount) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cheque ? (
            <ChequeActionsMenu
              payment={payment as Payment & { cheque: ChequeDetails }}
              onAction={setAction}
              showPaymentLink={false}
              label={t('Cheque')}
            />
          ) : null}
          {hasVoucher(payment) ? (
            <ButtonLink variant="outline" to={`${copy.base}/${payment.id}/voucher`}>
              <Printer /> {t('Print voucher')}
            </ButtonLink>
          ) : null}
          {direction === 'in' && !payment.voided ? (
            <Button variant="outline" onClick={receipt}>
              <Mail /> {t('Email receipt')}
            </Button>
          ) : null}
          {canEditPayment(payment) ? (
            <Button variant="outline" onClick={() => navigate(`${copy.base}/${payment.id}/edit`)}>
              <Pencil /> {t('Edit')}
            </Button>
          ) : null}
          {canDeletePayment(payment) ? (
            <Button variant="outline" onClick={() => void remove()}>
              <Trash2 /> {t('Delete')}
            </Button>
          ) : null}
        </div>
      </div>

      {payment.voided ? (
        <div
          role="status"
          className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">
              {t('This payment is void: {reason}', {
                reason: payment.voidReason || t('Voided'),
              })}
            </p>
            <p>{t('It no longer counts in the books or against the documents it paid.')}</p>
            {replacedBy ? (
              <p>
                {tr('Replaced by payment {payment}.', {
                  payment: (
                    <Link
                      to={`${copy.base}/${replacedBy.id}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {replacedBy.number}
                    </Link>
                  ),
                })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title={t('Details')} />
          <CardBody className="divide-y divide-slate-100 py-2">
            <Row
              label={t('Amount')}
              value={<strong className="tabular">{money(payment.amount)}</strong>}
            />
            <Row label={t('Date')} value={fmt.date(payment.date)} />
            <Row label={t('Method')} value={paymentMethodLabel(payment.method)} />
            {payment.provider ? (
              <Row label={t('Provider')} value={t(providerLabel(payment.provider))} />
            ) : null}
            {payment.fee ? (
              <Row
                label={t('Fee')}
                value={
                  <span className="tabular">
                    {money(payment.fee)}{' '}
                    <span className="text-slate-500">({accountName(payment.feeAccountId)})</span>
                  </span>
                }
              />
            ) : null}
            {payment.method !== 'credit_note' ? (
              <Row
                label={cheque ? t('Held in') : t(copy.account)}
                value={account ? `${account.code} ${localName(account)}` : '—'}
              />
            ) : null}
            {payment.reference ? <Row label={t('Reference')} value={payment.reference} /> : null}
            {credit ? (
              <Row
                label={t(copy.credit)}
                value={
                  <Link
                    to={`${copy.creditBase}/${credit.id}`}
                    className="text-primary-700 font-medium hover:underline"
                  >
                    {credit.number}
                  </Link>
                }
              />
            ) : null}
            {unapplied > 0 ? (
              <Row
                label={t(copy.unapplied)}
                value={<span className="tabular text-amber-700">{money(unapplied)}</span>}
              />
            ) : null}
            {payment.notes ? (
              <Row
                label={t('Notes')}
                value={
                  <span dir="auto" className="whitespace-pre-line">
                    {payment.notes}
                  </span>
                }
              />
            ) : null}
          </CardBody>
        </Card>
        <div className="space-y-6">
          {cheque ? (
            <Card>
              <CardHeader title={t('Cheque')} actions={<PaymentStatusBadge payment={payment} />} />
              <CardBody className="divide-y divide-slate-100 py-2">
                <Row label={t('Cheque number')} value={<span dir="ltr">{cheque.number}</span>} />
                {cheque.bank ? (
                  <Row label={t('Bank')} value={bankName(cheque.bank, language)} />
                ) : null}
                <Row label={t('Cheque date')} value={fmt.date(cheque.date)} />
                {cheque.drawer ? (
                  <Row
                    label={direction === 'out' ? t('Pay to') : t('Drawer')}
                    value={cheque.drawer}
                  />
                ) : null}
                {cheque.drawerCivilId ? (
                  <Row
                    label={t('Civil ID')}
                    value={<span dir="ltr">{cheque.drawerCivilId}</span>}
                  />
                ) : null}
                {cheque.depositedOn ? (
                  <Row label={t('Deposited on')} value={fmt.date(cheque.depositedOn)} />
                ) : null}
                {cheque.clearedOn ? (
                  <Row
                    label={t('Cleared on')}
                    value={`${fmt.date(cheque.clearedOn)} · ${accountName(cheque.bankAccountId)}`}
                  />
                ) : null}
                {cheque.returnedOn ? (
                  <Row
                    label={t('Returned on')}
                    value={`${fmt.date(cheque.returnedOn)} · ${cheque.returnReason ?? ''}`}
                  />
                ) : null}
                {cheque.clearingJournalId ? (
                  <Row
                    label={t('Clearing entry')}
                    value={
                      <Link
                        to={`/journals/${cheque.clearingJournalId}`}
                        className="text-primary-700 font-medium hover:underline"
                      >
                        {t('View entry')}
                      </Link>
                    }
                  />
                ) : null}
                {replaces ? (
                  <Row
                    label={t('Replaces')}
                    value={
                      <Link
                        to={`${copy.base}/${replaces.id}`}
                        className="text-primary-700 font-medium hover:underline"
                      >
                        {t('Cheque {number}', { number: replaces.cheque?.number ?? '' })} ·{' '}
                        {replaces.number}
                      </Link>
                    }
                  />
                ) : null}
                {replacedBy ? (
                  <Row
                    label={t('Replaced by')}
                    value={
                      <Link
                        to={`${copy.base}/${replacedBy.id}`}
                        className="text-primary-700 font-medium hover:underline"
                      >
                        {t('Cheque {number}', { number: replacedBy.cheque?.number ?? '' })} ·{' '}
                        {replacedBy.number}
                      </Link>
                    }
                  />
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t('Applied to')} />
            <CardBody className="py-2">
              {payment.allocations.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">{t(copy.notApplied)}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {payment.allocations.map((a) => {
                    const doc = docs.find((d) => d.id === a.documentId);
                    return (
                      <li
                        key={a.documentId}
                        className="flex items-center justify-between py-2.5 text-sm"
                      >
                        {doc ? (
                          <Link
                            to={`${DOCUMENT_ROUTES[doc.type]}/${doc.id}`}
                            className="text-primary-700 font-medium hover:underline"
                          >
                            {doc.number}
                          </Link>
                        ) : (
                          <span className="text-slate-500">{t(copy.deletedDoc)}</span>
                        )}
                        <span
                          className={
                            payment.voided
                              ? 'tabular text-slate-500 line-through'
                              : 'tabular font-medium'
                          }
                        >
                          {money(a.amount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title={t('Attachments')}
          description={t('A scan of the cheque or the transfer receipt.')}
        />
        <CardBody>
          <AttachmentList
            files={files ?? []}
            onAdd={(file) => addAttachment(company.id, payment.id, file)}
            onRemove={(fileId) => removeAttachment(fileId)}
            emptyText={t('No files attached.')}
            camera
            readOnly={readOnly}
          />
        </CardBody>
      </Card>

      {cheque ? (
        <ChequeActionDialog
          action={action}
          payment={payment as Payment & { cheque: ChequeDetails }}
          onClose={() => setAction(null)}
          onReplaced={(replacement) => navigate(`${copy.base}/${replacement.id}`)}
        />
      ) : null}
    </div>
  );
}
