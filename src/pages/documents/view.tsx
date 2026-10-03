import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Ban,
  BellRing,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileMinus,
  FileText,
  MoreHorizontal,
  Pencil,
  Printer,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import {
  convertQuoteToInvoice,
  deleteDocument,
  duplicateDocument,
  markSent,
  setDocumentStatus,
} from '@/db/documents';
import { paymentMethodLabel } from '@/db/payments';
import type { DocumentType, InvoiceDocument } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { displayStatus } from '@/lib/status';
import { daysBetween, today } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Spinner, StatusBadge } from '@/components/ui/misc';
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
import { downloadBlob, pdfFileName, printBlob } from '@/pdf/client';
import { SendDialog, type EmailKind } from '@/features/documents/send-dialog';
import { ApplyCreditDialog, RecordPaymentDialog } from '@/features/documents/payment-dialogs';

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'danger' | 'strong';
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={
          tone === 'danger'
            ? 'tabular font-semibold text-red-600'
            : tone === 'strong'
              ? 'tabular font-semibold text-slate-900'
              : 'tabular text-slate-700'
        }
      >
        {value}
      </span>
    </div>
  );
}

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
    if (!doc) return [];
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
  const related = useLiveQuery(async () => {
    if (!doc) return [];
    const ids = [doc.sourceId, doc.convertedToId].filter((x): x is string => Boolean(x));
    return (await db.documents.bulkGet(ids)).filter((d): d is InvoiceDocument => Boolean(d));
  }, [doc?.sourceId, doc?.convertedToId]);

  const [send, setSend] = useState<EmailKind | null>(null);
  const [recordPayment, setRecordPayment] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const ready = doc && client !== undefined;
  const pdf = useLivePdf(
    ready ? doc : null,
    company,
    client ?? null,
    doc?.templateId ?? company.branding.templateId,
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

  if (doc === undefined) return <Spinner className="py-24" label="Loading…" />;
  if (!doc || doc.companyId !== company.id || doc.type !== type) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This {labels.singular.toLowerCase()} could not be found.</p>
        <Link to={base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          Back to {labels.plural.toLowerCase()}
        </Link>
      </Card>
    );
  }

  const status = displayStatus(doc, today());
  const money = (n: number) => fmt.money(n, doc.currency);
  const overdueDays = status === 'overdue' && doc.dueDate ? daysBetween(doc.dueDate, today()) : 0;

  const getPdf = async () => pdf.blob ?? (await generatePdf(doc, company, client ?? null)).blob;

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const download = () =>
    run('download', async () => {
      downloadBlob(await getPdf(), fileName);
      if (doc.status === 'draft') toast('Tip: mark the document as sent once you have shared it.');
    });

  const print = () => run('print', async () => printBlob(await getPdf()));

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${labels.singular.toLowerCase()} ${doc.number}?`,
      description:
        doc.type === 'invoice' && doc.totals.paid > 0
          ? 'Payments recorded against it will be kept as unapplied client credit.'
          : 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteDocument(doc.id);
    toast.success(`${labels.singular} deleted`);
    navigate(base);
  };

  const voidDoc = async () => {
    const ok = await confirm({
      title: `Void ${doc.number}?`,
      description:
        'A void document stays in your records for reference but no longer counts as owed.',
      confirmLabel: 'Void',
      danger: true,
    });
    if (ok) await run('void', () => setDocumentStatus(doc.id, 'void'));
  };

  const primaryAction =
    type === 'invoice' && (doc.status === 'sent' || doc.status === 'partial') ? (
      <Button onClick={() => setRecordPayment(true)}>
        <CreditCard /> Record payment
      </Button>
    ) : type === 'quote' && (doc.status === 'accepted' || doc.status === 'sent') ? (
      <Button
        loading={busy === 'convert'}
        onClick={() =>
          run('convert', async () => {
            const invoice = await convertQuoteToInvoice(doc.id);
            toast.success(`Invoice ${invoice.number} created`);
            navigate(`/invoices/${invoice.id}`);
          })
        }
      >
        <FileText /> Convert to invoice
      </Button>
    ) : type === 'credit' &&
      (doc.status === 'sent' || doc.status === 'partial') &&
      doc.totals.balance > 0 ? (
      <Button onClick={() => setApplyCredit(true)}>
        <CreditCard /> Apply to invoice
      </Button>
    ) : doc.status === 'draft' ? (
      <Button onClick={() => setSend('document')}>
        <Send /> Send
      </Button>
    ) : null;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to={base} className="hover:text-slate-700">
              {labels.plural}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {labels.singular} {doc.number}
            </h1>
            <StatusBadge status={status} />
          </div>
          {client ? (
            <p className="mt-1 text-sm text-slate-500">
              for{' '}
              <Link
                to={`/clients/${client.id}`}
                className="hover:text-primary-700 font-medium text-slate-700"
              >
                {client.name}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={download} loading={busy === 'download'}>
            <Download /> Download PDF
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={print}
            loading={busy === 'print'}
            aria-label="Print"
          >
            <Printer />
          </Button>
          <Button variant="outline" onClick={() => navigate(`${base}/${doc.id}/edit`)}>
            <Pencil /> Edit
          </Button>
          {primaryAction}
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              {doc.status !== 'draft' || !primaryAction ? (
                <DropdownItem icon={<Send />} onSelect={() => setSend('document')}>
                  Send by email
                </DropdownItem>
              ) : null}
              {type === 'invoice' &&
              (status === 'overdue' || doc.status === 'partial' || doc.status === 'sent') ? (
                <DropdownItem icon={<BellRing />} onSelect={() => setSend('reminder')}>
                  Send reminder
                </DropdownItem>
              ) : null}
              {doc.status === 'draft' ? (
                <DropdownItem
                  icon={<CheckCircle2 />}
                  onSelect={() => void run('sent', () => markSent(doc.id))}
                >
                  Mark as sent
                </DropdownItem>
              ) : null}
              {type === 'quote' && doc.status !== 'accepted' && doc.status !== 'invoiced' ? (
                <DropdownItem
                  icon={<ThumbsUp />}
                  onSelect={() => void run('accept', () => setDocumentStatus(doc.id, 'accepted'))}
                >
                  Mark as accepted
                </DropdownItem>
              ) : null}
              {type === 'quote' && doc.status !== 'declined' && doc.status !== 'invoiced' ? (
                <DropdownItem
                  icon={<ThumbsDown />}
                  onSelect={() => void run('decline', () => setDocumentStatus(doc.id, 'declined'))}
                >
                  Mark as declined
                </DropdownItem>
              ) : null}
              {type === 'invoice' && doc.status !== 'draft' && doc.status !== 'void' ? (
                <DropdownItem
                  icon={<FileMinus />}
                  onSelect={() =>
                    void run('credit', async () => {
                      const credit = await duplicateDocument(doc.id, 'credit', {
                        sourceId: doc.id,
                      });
                      toast.success(`Credit note ${credit.number} created`);
                      navigate(`/credits/${credit.id}/edit`);
                    })
                  }
                >
                  Create credit note
                </DropdownItem>
              ) : null}
              <DropdownItem
                icon={<Copy />}
                onSelect={() =>
                  void run('duplicate', async () => {
                    const copy = await duplicateDocument(doc.id);
                    toast.success(`${labels.singular} ${copy.number} created`);
                    navigate(`${base}/${copy.id}/edit`);
                  })
                }
              >
                Duplicate
              </DropdownItem>
              {doc.status === 'void' ? (
                <DropdownItem
                  icon={<Undo2 />}
                  onSelect={() => void run('unvoid', () => setDocumentStatus(doc.id, 'sent'))}
                >
                  Restore (un-void)
                </DropdownItem>
              ) : type !== 'quote' && doc.status !== 'draft' ? (
                <DropdownItem icon={<Ban />} onSelect={() => void voidDoc()}>
                  Void
                </DropdownItem>
              ) : null}
              <DropdownSeparator />
              <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                Delete
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-xl bg-slate-200/60 p-3 sm:p-6">
          <div className="mx-auto max-w-[820px]">
            <PdfPreview blob={pdf.blob} loading={pdf.loading} error={pdf.error} />
          </div>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="py-3">
              <SummaryRow label="Issued" value={fmt.date(doc.issueDate)} />
              {doc.dueDate ? (
                <SummaryRow
                  label={type === 'quote' ? 'Valid until' : 'Due'}
                  value={
                    overdueDays > 0
                      ? `${fmt.date(doc.dueDate)} · ${overdueDays}d late`
                      : fmt.date(doc.dueDate)
                  }
                  tone={overdueDays > 0 ? 'danger' : undefined}
                />
              ) : null}
              <SummaryRow label="Total" value={money(doc.totals.total)} tone="strong" />
              {type !== 'quote' ? (
                <>
                  <SummaryRow
                    label={type === 'credit' ? 'Applied' : 'Paid'}
                    value={money(doc.totals.paid)}
                  />
                  <SummaryRow
                    label={type === 'credit' ? 'Remaining' : 'Balance'}
                    value={money(doc.status === 'void' ? 0 : doc.totals.balance)}
                    tone={status === 'overdue' ? 'danger' : 'strong'}
                  />
                </>
              ) : null}
              {doc.sentAt ? <SummaryRow label="Sent" value={fmt.dateTime(doc.sentAt)} /> : null}
              {related && related.length > 0 ? (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  {related.map((r) => (
                    <Link
                      key={r.id}
                      to={`${DOCUMENT_ROUTES[r.type]}/${r.id}`}
                      className="text-primary-700 block py-1 text-sm font-medium hover:underline"
                    >
                      {r.id === doc.sourceId ? 'Created from' : 'Converted to'}{' '}
                      {DOCUMENT_LABELS[r.type].singular.toLowerCase()} {r.number}
                    </Link>
                  ))}
                </div>
              ) : null}
              {doc.privateNotes ? (
                <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs whitespace-pre-line text-amber-900">
                  {doc.privateNotes}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {type !== 'quote' ? (
            <Card>
              <CardHeader
                title={type === 'credit' ? 'Applied to' : 'Payments'}
                actions={
                  type === 'invoice' && doc.status !== 'void' && doc.status !== 'paid' ? (
                    <Button variant="ghost" size="sm" onClick={() => setRecordPayment(true)}>
                      Add
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
                            className="hover:text-primary-700 flex items-center justify-between py-2.5 text-sm"
                          >
                            <span>
                              <span className="block font-medium text-slate-800">
                                {fmt.date(p.date)}
                              </span>
                              <span className="text-xs text-slate-500">
                                {paymentMethodLabel(p.method)}
                                {p.reference ? ` · ${p.reference}` : ''}
                              </span>
                            </span>
                            <span className="tabular font-medium">{money(amount)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-3 text-sm text-slate-500">
                    {type === 'credit'
                      ? 'Not applied to any invoice yet.'
                      : 'No payments recorded yet.'}
                  </p>
                )}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Activity" />
            <CardBody className="py-3">
              {activity && activity.length > 0 ? (
                <ol className="relative space-y-4 border-s border-slate-200 ps-4">
                  {activity.slice(0, 12).map((a) => (
                    <li key={a.id} className="relative">
                      <span className="bg-primary-500 absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-white" />
                      <p className="text-sm text-slate-700">{a.message}</p>
                      <p className="text-xs text-slate-400">{fmt.dateTime(a.at)}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">No activity yet.</p>
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
      {recordPayment ? (
        <RecordPaymentDialog open onOpenChange={setRecordPayment} invoice={doc} company={company} />
      ) : null}
      {applyCredit ? (
        <ApplyCreditDialog open onOpenChange={setApplyCredit} credit={doc} company={company} />
      ) : null}
    </div>
  );
}
