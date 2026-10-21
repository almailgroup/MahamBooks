import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Ban,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  Download,
  FileClock,
  FileMinus,
  FileText,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  convertDocument,
  deleteDocument,
  duplicateDocument,
  markSent,
  setDocumentStatus,
} from '@/db/documents';
import { progressOf, type PartTarget } from '@/db/orders';
import { activityText } from '@/db/activity';
import { paymentMethodLabel } from '@/db/payments';
import type { DocumentStatus, DocumentType, InvoiceDocument } from '@/db/types';
import {
  DOCUMENT_LABELS,
  DOCUMENT_ROUTES,
  documentNoun,
  useCompany,
  useFormat,
} from '@/app/company';
import { deliveryStatusMeta, displayStatus, issuedStatus } from '@/lib/status';
import { hasPrices, postsToLedger } from '@/lib/document-types';
import { daysBetween, today } from '@/lib/dates';
import { t, tp } from '@/i18n';
import { tr } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, Spinner, StatusBadge } from '@/components/ui/misc';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';
import { PdfPreview } from '@/components/pdf/pdf-preview';
import { generatePdf, useLivePdf } from '@/components/pdf/use-pdf';
import { documentTemplate } from '@/pdf/template-resolve';
import { downloadBlob, pdfFileName, printBlob } from '@/pdf/client';
import { printsAsDraft } from '@/pdf/model';
import {
  SendDialog,
  WhatsAppDialog,
  type EmailKind,
} from '@/apps/books/features/documents/send-dialog';
import {
  ApplyCreditDialog,
  RecordPaymentDialog,
} from '@/apps/books/features/documents/payment-dialogs';
import { PaymentLinkCard } from '@/apps/books/features/payments/payment-link';
import { PaymentStatusBadge } from '@/apps/books/features/payments/status-badge';
import { PartDialog } from '@/apps/books/features/orders/part-dialog';
import { DeliverDialog } from '@/apps/books/features/orders/deliver-dialog';
import { OrderProgressCard, RelatedDocuments } from '@/apps/books/features/orders/related';

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'danger' | 'strong';
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={
          tone === 'danger'
            ? 'tabular text-end font-semibold text-red-600'
            : tone === 'strong'
              ? 'tabular text-end font-semibold text-slate-900'
              : 'tabular text-end text-slate-700'
        }
      >
        {value}
      </span>
    </div>
  );
}

/** Documents that are emailed and shared with the app's own templates. */
const EMAILED: DocumentType[] = ['invoice', 'quote', 'credit'];

export default function DocumentViewPage({ type }: { type: DocumentType }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const labels = DOCUMENT_LABELS[type];
  const base = DOCUMENT_ROUTES[type];

  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const client = useLiveQuery(
    async () => (doc?.clientId ? ((await db.clients.get(doc.clientId)) ?? null) : null),
    [doc?.clientId],
  );
  const payments = useLiveQuery(async () => {
    if (!doc || !postsToLedger(doc.type)) return [];
    const list =
      doc.type === 'credit'
        ? await db.payments.where('creditId').equals(doc.id).toArray()
        : await db.payments.where('documentIds').equals(doc.id).toArray();
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [doc?.id, doc?.type]);
  const activity = useLiveQuery(
    () => db.activities.where('documentId').equals(id).reverse().sortBy('at'),
    [id],
  );
  // Invoices and delivery notes made from a sales order, delivery notes of an invoice.
  const progress = useLiveQuery(
    async () => (doc && (type === 'sales_order' || type === 'invoice') ? progressOf(doc) : null),
    [doc, type],
  );

  const [send, setSend] = useState<EmailKind | null>(null);
  const [whatsApp, setWhatsApp] = useState(false);
  const [recordPayment, setRecordPayment] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [part, setPart] = useState<PartTarget | null>(null);
  const [deliver, setDeliver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const ready = doc && client !== undefined;
  const pdf = useLivePdf(
    ready ? doc : null,
    company,
    client ?? null,
    doc ? documentTemplate(doc, company) : company.branding.templateId,
    { delay: 0 },
  );

  // "Save and download" from the editor lands here with a flag.
  const autoDownload = useRef((location.state as { download?: boolean } | null)?.download ?? false);
  const fileName = useMemo(
    () =>
      doc ? pdfFileName(`${labels.singular} ${doc.number}`, client?.name ?? '') : 'document.pdf',
    [doc, client, labels.singular],
  );
  useEffect(() => {
    if (autoDownload.current && pdf.blob) {
      autoDownload.current = false;
      downloadBlob(pdf.blob, fileName);
    }
  }, [pdf.blob, fileName]);

  if (doc === undefined) return <Spinner className="py-24" label={t('Loading…')} />;
  if (!doc || doc.companyId !== company.id || doc.type !== type) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t('This document could not be found.')}</p>
        <Link to={base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t('Back to {list}', { list: t(labels.plural).toLowerCase() })}
        </Link>
      </Card>
    );
  }

  const status = displayStatus(doc, today());
  const money = (n: number) => fmt.money(n, doc.currency);
  const overdueDays = status === 'overdue' && doc.dueDate ? daysBetween(doc.dueDate, today()) : 0;
  const emailed = EMAILED.includes(type);
  const booked = postsToLedger(type);
  const priced = hasPrices(type);
  const left = (key: 'toInvoice' | 'toDeliver') => progress?.some((p) => p[key] > 0) ?? false;
  const canInvoice =
    type === 'sales_order' &&
    (doc.status === 'confirmed' || doc.status === 'partially_invoiced') &&
    left('toInvoice');
  const canDeliver =
    ((type === 'sales_order' && doc.status !== 'draft' && doc.status !== 'cancelled') ||
      (type === 'invoice' && doc.status !== 'void')) &&
    left('toDeliver');
  const settled = doc.status === 'invoiced' || doc.status === 'converted';

  /**
   * The PDF as the document is now (the preview's, unless it is still being
   * redrawn after a change). `issued` gives a draft's copy as it is sent
   * (signed and stamped, with no watermark), for sending it and marking it as
   * sent at once.
   */
  const getPdf = async (issued = false) => {
    const status = issued && printsAsDraft(doc) ? issuedStatus(doc.type) : null;
    if (status) return (await generatePdf({ ...doc, status }, company, client ?? null)).blob;
    if (pdf.blob && !pdf.loading) return pdf.blob;
    return (await generatePdf(doc, company, client ?? null)).blob;
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Something went wrong.'));
    } finally {
      setBusy(null);
    }
  };

  const download = () =>
    run('download', async () => {
      downloadBlob(await getPdf(), fileName);
      if (printsAsDraft(doc)) {
        toast(
          emailed || type === 'proforma'
            ? t(
                'Drafts print with a DRAFT watermark, without the signature and stamp. Mark it as sent for the copy to share.',
              )
            : t('Drafts print with a DRAFT watermark, without the signature and stamp.'),
        );
      }
    });

  const print = () => run('print', async () => printBlob(await getPdf()));

  const opened = (created: InvoiceDocument, edit = false) => {
    toast.success(
      t('{document} {number} created', {
        document: t(DOCUMENT_LABELS[created.type].singular),
        number: created.number,
      }),
    );
    navigate(`${DOCUMENT_ROUTES[created.type]}/${created.id}${edit ? '/edit' : ''}`);
  };

  const convert = (to: 'invoice' | 'proforma' | 'sales_order') =>
    run(`convert-${to}`, async () => opened(await convertDocument(doc.id, to)));

  const setStatus = (status: DocumentStatus) =>
    run(status, () => setDocumentStatus(doc.id, status));

  // Credit notes applied to this invoice, or this credit note's applications:
  // voiding or deleting it takes them off.
  const credits = (payments ?? []).filter((p) => p.method === 'credit_note');
  const creditsNote = credits.length
    ? type === 'credit'
      ? t('It is taken off the invoices it was applied to, so they are owed again.')
      : t('Credit notes applied to it are taken off, so they can be used again.')
    : '';
  const moneyPaid = (payments ?? []).some((p) => p.method !== 'credit_note' && !p.voided);

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete {document} {number}?', { document: documentNoun(type), number: doc.number }),
      description: [
        doc.type === 'invoice' && moneyPaid
          ? t('Payments recorded against it will be kept as unapplied client credit.')
          : t('This cannot be undone.'),
        creditsNote,
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    await run('delete', async () => {
      await deleteDocument(doc.id);
      toast.success(t('{document} deleted', { document: t(labels.singular) }));
      navigate(base);
    });
  };

  const voidDoc = async () => {
    const ok = await confirm({
      title: t('Void {number}?', { number: doc.number }),
      description: [
        t('A void document stays in your records for reference but no longer counts as owed.'),
        creditsNote,
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: t('Void document'),
      danger: true,
    });
    if (ok) await run('void', () => setDocumentStatus(doc.id, 'void'));
  };

  const cancelLabel = type === 'sales_order' ? t('Cancel order') : t('Cancel delivery note');
  const cancelDoc = async () => {
    const ok = await confirm({
      title: t('Cancel {number}?', { number: doc.number }),
      description: t(
        'A cancelled document stays in your records for reference. Invoices and delivery notes already made from it are not changed.',
      ),
      confirmLabel: cancelLabel,
      cancelLabel: t('Keep'),
      danger: true,
    });
    if (ok) await setStatus('cancelled');
  };

  // The main next step; everything else is in the "More actions" menu.
  let primary: string | null = null;
  if (type === 'invoice' && (doc.status === 'sent' || doc.status === 'partial')) primary = 'pay';
  else if (
    (type === 'quote' || type === 'proforma') &&
    (doc.status === 'accepted' || doc.status === 'sent')
  )
    primary = 'to-invoice';
  else if (
    type === 'credit' &&
    (doc.status === 'sent' || doc.status === 'partial') &&
    doc.totals.balance > 0
  )
    primary = 'apply';
  else if (type === 'sales_order' && doc.status === 'draft') primary = 'confirm';
  else if (canInvoice) primary = 'invoice';
  else if (type === 'sales_order' && canDeliver) primary = 'deliver';
  else if (type === 'delivery_note' && doc.status === 'draft') primary = 'delivered';
  else if (type === 'proforma' && doc.status === 'draft') primary = 'sent';
  else if (emailed && doc.status === 'draft') primary = 'send';

  const primaryAction: ReactNode =
    {
      pay: (
        <Button onClick={() => setRecordPayment(true)}>
          <CreditCard /> {t('Record payment')}
        </Button>
      ),
      'to-invoice': (
        <Button loading={busy === 'convert-invoice'} onClick={() => void convert('invoice')}>
          <FileText /> {t('Convert to invoice')}
        </Button>
      ),
      apply: (
        <Button onClick={() => setApplyCredit(true)}>
          <CreditCard /> {t('Apply to invoice')}
        </Button>
      ),
      confirm: (
        <Button
          loading={busy === 'confirm'}
          onClick={() => void run('confirm', () => markSent(doc.id))}
        >
          <CheckCircle2 /> {t('Confirm order')}
        </Button>
      ),
      invoice: (
        <Button onClick={() => setPart('invoice')}>
          <FileText /> {t('Create invoice')}
        </Button>
      ),
      deliver: (
        <Button onClick={() => setPart('delivery_note')}>
          <PackageCheck /> {t('Create delivery note')}
        </Button>
      ),
      delivered: (
        <Button onClick={() => setDeliver(true)}>
          <PackageCheck /> {t('Mark as delivered')}
        </Button>
      ),
      sent: (
        <Button loading={busy === 'sent'} onClick={() => void run('sent', () => markSent(doc.id))}>
          <CheckCircle2 /> {t('Mark as sent')}
        </Button>
      ),
      send: (
        <Button onClick={() => setSend('document')}>
          <Send /> {t('Send')}
        </Button>
      ),
    }[primary ?? ''] ?? null;

  const menu: ReactNode[] = [];
  const item = (key: string, icon: ReactNode, label: string, onSelect: () => void) =>
    menu.push(
      <DropdownItem key={key} icon={icon} onSelect={onSelect}>
        {label}
      </DropdownItem>,
    );
  if (emailed && (doc.status !== 'draft' || !primaryAction)) {
    item('email', <Send />, t('Send by email'), () => setSend('document'));
  }
  if (
    type === 'invoice' &&
    (status === 'overdue' || doc.status === 'partial' || doc.status === 'sent')
  ) {
    item('reminder', <BellRing />, t('Send reminder'), () => setSend('reminder'));
  }
  if (emailed && doc.status === 'draft') {
    item(
      'sent',
      <CheckCircle2 />,
      t('Mark as sent'),
      () => void run('sent', () => markSent(doc.id)),
    );
  }
  if ((type === 'quote' || type === 'proforma') && !settled && doc.status !== 'accepted') {
    item('accept', <ThumbsUp />, t('Mark as accepted'), () => void setStatus('accepted'));
  }
  if (type === 'quote' && !settled && doc.status !== 'declined') {
    item('decline', <ThumbsDown />, t('Mark as declined'), () => void setStatus('declined'));
  }
  if (type === 'quote' && !settled && doc.status !== 'declined') {
    item(
      'to-proforma',
      <FileClock />,
      t('Convert to proforma invoice'),
      () => void convert('proforma'),
    );
    item(
      'to-order',
      <ClipboardList />,
      t('Convert to sales order'),
      () => void convert('sales_order'),
    );
  }
  if (type === 'proforma' && doc.status === 'draft') {
    item('to-invoice', <FileText />, t('Convert to invoice'), () => void convert('invoice'));
  }
  if (canDeliver && primary !== 'deliver') {
    item('deliver', <PackageCheck />, t('Create delivery note'), () => setPart('delivery_note'));
  }
  if (type === 'invoice' && doc.status !== 'draft' && doc.status !== 'void') {
    item(
      'credit',
      <FileMinus />,
      t('Create credit note'),
      () =>
        void run('credit', async () =>
          opened(await duplicateDocument(doc.id, 'credit', { sourceId: doc.id }), true),
        ),
    );
  }
  if (type === 'delivery_note' && doc.status === 'delivered') {
    item('undeliver', <Undo2 />, t('Mark as not delivered'), () => void setStatus('draft'));
  }
  item(
    'duplicate',
    <Copy />,
    t('Duplicate'),
    () => void run('duplicate', async () => opened(await duplicateDocument(doc.id), true)),
  );
  if (doc.status === 'void' && booked) {
    item('unvoid', <Undo2 />, t('Restore (un-void)'), () => void setStatus('sent'));
  } else if (booked && doc.status !== 'draft') {
    item('void', <Ban />, t('Void document'), () => void voidDoc());
  }
  if (doc.status === 'cancelled') {
    item(
      'reopen',
      <RotateCcw />,
      t('Reopen'),
      () => void setStatus(type === 'sales_order' ? 'confirmed' : 'draft'),
    );
  } else if (type === 'sales_order' || type === 'delivery_note') {
    item('cancel', <Ban />, cancelLabel, () => void cancelDoc());
  }

  const deliveryMeta =
    type === 'sales_order' && doc.status !== 'draft' && doc.status !== 'cancelled'
      ? deliveryStatusMeta(doc.deliveryStatus)
      : null;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to={base} className="hover:text-slate-700">
              {t(labels.plural)}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {t(labels.singular)} {doc.number}
            </h1>
            <StatusBadge status={status} />
            {deliveryMeta ? <Badge tone={deliveryMeta.tone}>{t(deliveryMeta.label)}</Badge> : null}
          </div>
          {client ? (
            <p className="mt-1 text-sm text-slate-500">
              {tr('for {client}', {
                client: (
                  <Link
                    to={`/clients/${client.id}`}
                    className="hover:text-primary-700 font-medium text-slate-700"
                  >
                    <bdi>{localName(client)}</bdi>
                  </Link>
                ),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={download} loading={busy === 'download'}>
            <Download /> {t('Download PDF')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={print}
            loading={busy === 'print'}
            aria-label={t('Print')}
          >
            <Printer />
          </Button>
          <Button variant="outline" onClick={() => navigate(`${base}/${doc.id}/edit`)}>
            <Pencil /> {t('Edit')}
          </Button>
          {type === 'invoice' || type === 'quote' ? (
            <Button
              variant="outline"
              onClick={() => setWhatsApp(true)}
              aria-label={t('Share on WhatsApp')}
            >
              <MessageCircle /> <span className="hidden sm:inline">{t('WhatsApp')}</span>
            </Button>
          ) : null}
          {primaryAction}
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('More actions')}>
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              {menu}
              <DropdownSeparator />
              <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                {t('Delete')}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl bg-slate-200/60 p-3 sm:p-6">
          <div className="mx-auto max-w-[820px]">
            <PdfPreview blob={pdf.blob} loading={pdf.loading} error={pdf.error} />
          </div>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title={t('Summary')} />
            <CardBody className="py-3">
              <SummaryRow label={t('Issue date')} value={fmt.date(doc.issueDate)} />
              {doc.dueDate ? (
                <SummaryRow
                  label={type === 'quote' || type === 'proforma' ? t('Valid until') : t('Due')}
                  value={
                    overdueDays > 0
                      ? `${fmt.date(doc.dueDate)} · ${tp(overdueDays, '{count} day late', '{count} days late')}`
                      : fmt.date(doc.dueDate)
                  }
                  tone={overdueDays > 0 ? 'danger' : undefined}
                />
              ) : null}
              {doc.deliveryDate ? (
                <SummaryRow label={t('Delivery date')} value={fmt.date(doc.deliveryDate)} />
              ) : null}
              {type === 'delivery_note' && doc.deliveryPlace ? (
                <SummaryRow label={t('Deliver to')} value={doc.deliveryPlace} />
              ) : null}
              {type === 'delivery_note' && doc.status === 'delivered' && doc.receiverName ? (
                <SummaryRow
                  label={t('Received by')}
                  value={
                    <>
                      {doc.receiverName}
                      {doc.receiverCivilId ? (
                        <span className="block text-xs text-slate-500" dir="ltr">
                          {doc.receiverCivilId}
                        </span>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {priced ? (
                <SummaryRow label={t('Total')} value={money(doc.totals.total)} tone="strong" />
              ) : null}
              {(type === 'proforma' || type === 'invoice') && doc.deposit > 0 ? (
                <SummaryRow label={t('Deposit requested')} value={money(doc.deposit)} />
              ) : null}
              {booked ? (
                <>
                  <SummaryRow
                    label={type === 'credit' ? t('Applied') : t('Paid')}
                    value={money(doc.totals.paid)}
                  />
                  <SummaryRow
                    label={type === 'credit' ? t('Remaining') : t('Balance')}
                    value={money(doc.status === 'void' ? 0 : doc.totals.balance)}
                    tone={status === 'overdue' ? 'danger' : 'strong'}
                  />
                </>
              ) : null}
              {doc.sentAt && type !== 'delivery_note' ? (
                <SummaryRow
                  label={type === 'sales_order' ? t('Confirmed') : t('Sent')}
                  value={fmt.dateTime(doc.sentAt)}
                />
              ) : null}
              <RelatedDocuments doc={doc} />
              {doc.privateNotes ? (
                <p
                  dir="auto"
                  className="mt-3 rounded-md bg-amber-50 p-3 text-xs whitespace-pre-line text-amber-900"
                >
                  {doc.privateNotes}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {type === 'invoice' ? <PaymentLinkCard doc={doc} /> : null}

          {progress &&
          progress.length > 0 &&
          (type === 'sales_order' || progress.some((p) => p.delivered || p.inDelivery)) ? (
            <OrderProgressCard doc={doc} progress={progress} />
          ) : null}

          {booked ? (
            <Card>
              <CardHeader
                title={type === 'credit' ? t('Applied to') : t('Payments')}
                actions={
                  // Payments go on issued invoices only (a draft is issued first).
                  type === 'invoice' && (doc.status === 'sent' || doc.status === 'partial') ? (
                    <Button variant="ghost" size="sm" onClick={() => setRecordPayment(true)}>
                      {t('Add')}
                    </Button>
                  ) : null
                }
              />
              <CardBody className="py-2">
                {payments && payments.length > 0 ? (
                  <ul className="divide-y divide-slate-100">
                    {payments.map((p) => {
                      const amount =
                        type === 'credit'
                          ? p.amount
                          : p.allocations
                              .filter((a) => a.documentId === doc.id)
                              .reduce((s, a) => s + a.amount, 0);
                      return (
                        <li key={p.id}>
                          <Link
                            to={`/payments/${p.id}`}
                            className="hover:text-primary-700 flex items-center justify-between gap-3 py-2.5 text-sm"
                          >
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5 font-medium text-slate-800">
                                {fmt.date(p.date)}
                                <PaymentStatusBadge payment={p} />
                              </span>
                              <span className="text-xs text-slate-500">
                                {paymentMethodLabel(p.method)}
                                {p.cheque?.number
                                  ? ` · ${t('Cheque {number}', { number: p.cheque.number })}`
                                  : p.reference
                                    ? ` · ${p.reference}`
                                    : ''}
                              </span>
                            </span>
                            <span
                              className={
                                p.voided
                                  ? 'tabular text-slate-500 line-through'
                                  : 'tabular font-medium'
                              }
                            >
                              {money(amount)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-3 text-sm text-slate-500">
                    {type === 'credit'
                      ? t('Not applied to any invoice yet.')
                      : t('No payments recorded yet.')}
                  </p>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('Activity')} />
            <CardBody className="py-3">
              {activity && activity.length > 0 ? (
                <ol className="relative space-y-4 border-s border-slate-200 ps-4">
                  {activity.slice(0, 12).map((a) => (
                    <li key={a.id} className="relative">
                      <span className="bg-primary-500 border-surface absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2" />
                      <p className="text-sm text-slate-700">{activityText(a, fmt)}</p>
                      <p className="text-xs text-slate-500">{fmt.dateTime(a.at)}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">{t('No activity yet.')}</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>

      {send ? (
        <SendDialog
          open
          onOpenChange={(open) => !open && setSend(null)}
          doc={doc}
          company={company}
          client={client ?? null}
          kind={send}
          getPdf={getPdf}
          fileName={fileName}
        />
      ) : null}
      {whatsApp ? (
        <WhatsAppDialog
          open
          onOpenChange={setWhatsApp}
          doc={doc}
          company={company}
          client={client ?? null}
          getPdf={getPdf}
          fileName={fileName}
        />
      ) : null}
      {recordPayment ? (
        <RecordPaymentDialog open onOpenChange={setRecordPayment} invoice={doc} company={company} />
      ) : null}
      {applyCredit ? (
        <ApplyCreditDialog open onOpenChange={setApplyCredit} credit={doc} company={company} />
      ) : null}
      {part ? (
        <PartDialog
          open
          onOpenChange={(open) => !open && setPart(null)}
          doc={doc}
          target={part}
          onCreated={(created) => {
            setPart(null);
            opened(created);
          }}
        />
      ) : null}
      {deliver ? <DeliverDialog open onOpenChange={setDeliver} doc={doc} /> : null}
    </div>
  );
}
