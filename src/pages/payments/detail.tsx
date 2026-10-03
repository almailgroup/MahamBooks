import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Mail, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deletePayment, paymentMethodLabel, unappliedAmount } from '@/db/payments';
import type { InvoiceDocument } from '@/db/types';
import { DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { fillTemplate, mailtoLink } from '@/lib/email';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { useAccounts } from '@/features/accounting/account-pickers';
import {
  PAYMENT_COPY,
  paymentDirection,
  type PaymentDirection,
} from '@/features/payments/direction';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-end text-slate-800">{value}</span>
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
  const accounts = useAccounts();

  if (payment === undefined || client === undefined || !docs)
    return <Spinner className="py-24" label="Loading…" />;
  if (payment && payment.companyId === company.id && paymentDirection(payment) !== direction) {
    // Links that only know "a payment" (the general ledger) land on the right page.
    return (
      <Navigate to={`${PAYMENT_COPY[paymentDirection(payment)].base}/${payment.id}`} replace />
    );
  }
  if (!payment || payment.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This payment could not be found.</p>
        <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          Back to {copy.title.toLowerCase()}
        </Link>
      </Card>
    );
  }

  const money = (n: number) => fmt.money(n, payment.currency);
  // Same choice as the ledger: the account picked, else bank (or cash for cash payments).
  const account =
    accounts?.find((a) => a.id === payment.accountId) ??
    accounts?.find((a) => a.role === (payment.method === 'cash' ? 'cash' : 'bank')) ??
    accounts?.find((a) => a.role === 'bank');
  const credit = payment.creditId ? docs.find((d) => d.id === payment.creditId) : null;
  const unapplied = unappliedAmount(payment);

  const remove = async () => {
    const ok = await confirm({
      title: `Delete payment ${payment.number}?`,
      description: `${direction === 'out' ? 'Bills' : 'Invoices'} it was applied to will show the amount as unpaid again.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deletePayment(payment.id);
    toast.success('Payment deleted');
    navigate(copy.base);
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            <Link to={copy.base} className="hover:text-slate-700">
              {copy.title}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Payment {payment.number}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {money(payment.amount)} {copy.preposition}{' '}
            {client ? (
              <Link
                to={`${copy.contactBase}/${client.id}`}
                className="hover:text-primary-700 font-medium text-slate-700"
              >
                {client.name}
              </Link>
            ) : (
              `unknown ${copy.party.toLowerCase()}`
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {direction === 'in' ? (
            <Button variant="outline" onClick={receipt}>
              <Mail /> Email receipt
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => navigate(`${copy.base}/${payment.id}/edit`)}>
            <Pencil /> Edit
          </Button>
          <Button variant="outline" onClick={() => void remove()}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="divide-y divide-slate-100 py-2">
            <Row
              label="Amount"
              value={<strong className="tabular">{money(payment.amount)}</strong>}
            />
            <Row label="Date" value={fmt.date(payment.date)} />
            <Row label="Method" value={paymentMethodLabel(payment.method)} />
            {payment.method !== 'credit_note' ? (
              <Row label={copy.account} value={account ? `${account.code} ${account.name}` : '—'} />
            ) : null}
            {payment.reference ? <Row label="Reference" value={payment.reference} /> : null}
            {credit ? (
              <Row
                label={direction === 'out' ? 'Vendor credit' : 'Credit note'}
                value={
                  <Link
                    to={`${direction === 'out' ? '/vendor-credits' : '/credits'}/${credit.id}`}
                    className="text-primary-700 font-medium hover:underline"
                  >
                    {credit.number}
                  </Link>
                }
              />
            ) : null}
            {unapplied > 0 ? (
              <Row
                label={`Unapplied (${copy.unapplied})`}
                value={<span className="tabular text-amber-700">{money(unapplied)}</span>}
              />
            ) : null}
            {payment.notes ? (
              <Row
                label="Notes"
                value={<span className="whitespace-pre-line">{payment.notes}</span>}
              />
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Applied to" />
          <CardBody className="py-2">
            {payment.allocations.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">Not applied to any {copy.doc}.</p>
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
                        <span className="text-slate-400">Deleted {copy.doc}</span>
                      )}
                      <span className="tabular font-medium">{money(a.amount)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
