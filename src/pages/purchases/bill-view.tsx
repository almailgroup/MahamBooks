import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Ban,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileMinus,
  MoreHorizontal,
  Pencil,
  Printer,
  Receipt,
  RotateCcw,
  Trash2,
  Undo2,
  ShipWheel,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteDocument, duplicateDocument, markSent, setDocumentStatus } from '@/db/documents';
import { progressOf } from '@/db/orders';
import { activityText } from '@/db/activity';
import { paymentMethodLabel } from '@/db/payments';
import { addAttachment, removeAttachment } from '@/db/purchases';
import type { Client, DocumentStatus, InvoiceDocument, PurchaseDocumentType } from '@/db/types';
import {
  DOCUMENT_LABELS,
  DOCUMENT_ROUTES,
  documentNoun,
  useCompany,
  useFormat,
} from '@/app/company';
import { computeDocument } from '@/lib/document-calc';
import { displayStatus } from '@/lib/status';
import { daysBetween, today } from '@/lib/dates';
import { t, tp } from '@/i18n';
import { tr } from '@/i18n/provider';
import { localName } from '@/i18n/names';
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
import { ApplyCreditDialog, RecordPaymentDialog } from '@/features/documents/payment-dialogs';
import { AttachmentList } from '@/features/purchases/attachments';
import { useAccounts } from '@/features/accounting/account-pickers';
import { PaymentStatusBadge } from '@/features/payments/status-badge';
import { PartDialog } from '@/features/orders/part-dialog';
import { RelatedDocuments } from '@/features/orders/related';

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

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/** The PDF of a purchase order (bills and vendor credits are the vendor's documents). */
function usePurchaseOrderPdf(
  doc: InvoiceDocument | null | undefined,
  vendor: Client | null | undefined,
) {
  const company = useCompany();
  const printed = doc && doc.type === 'purchase_order' && vendor !== undefined ? doc : null;
  const pdf = useLivePdf(
    printed,
    company,
    vendor ?? null,
    doc?.templateId ?? company.branding.templateId,
    { delay: 0 },
  );
  const fileName = useMemo(
    () =>
      doc
        ? pdfFileName(`${DOCUMENT_LABELS[doc.type].singular} ${doc.number}`, vendor?.name ?? '')
        : 'document.pdf',
    [doc, vendor],
  );
  const getPdf = async () =>
    pdf.blob ?? (doc ? (await generatePdf(doc, company, vendor ?? null)).blob : null);
  return { pdf, fileName, getPdf };
}

/** A bill, vendor credit or purchase order: what was bought, what is owed and what was paid. */
export default function BillViewPage({ type }: { type: PurchaseDocumentType }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const labels = DOCUMENT_LABELS[type];
  const base = DOCUMENT_ROUTES[type];
  const order = type === 'purchase_order';

  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const vendor = useLiveQuery(
    async () => (doc?.clientId ? ((await db.clients.get(doc.clientId)) ?? null) : null),
    [doc?.clientId],
  );
  const payments = useLiveQuery(async () => {
    if (!doc || order) return [];
    const list =
      doc.type === 'vendor_credit'
        ? await db.payments.where('creditId').equals(doc.id).toArray()
        : await db.payments.where('documentIds').equals(doc.id).toArray();
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [doc?.id, doc?.type]);
  const attachments = useLiveQuery(
    () => db.attachments.where('ownerId').equals(id).toArray(),
    [id],
  );
  const activity = useLiveQuery(
    () => db.activities.where('documentId').equals(id).reverse().sortBy('at'),
    [id],
  );
  const progress = useLiveQuery(async () => (doc && order ? progressOf(doc) : null), [doc, order]);
  const accounts = useAccounts();
  const printing = usePurchaseOrderPdf(doc, vendor);

  const [recordPayment, setRecordPayment] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [convert, setConvert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (doc === undefined || vendor === undefined || !accounts)
    return <Spinner className="py-24" label={t('Loading…')} />;
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
  const result = computeDocument(doc, { paid: doc.totals.paid, taxExempt: vendor?.taxExempt });
  const accountName = (accountId?: string | null) => {
    const account = accounts.find((a) => a.id === accountId);
    return account ? `${account.code} ${localName(account)}` : t('General expenses');
  };
  const open = doc.status === 'sent' || doc.status === 'partial';
  const isBill = type === 'bill';
  const billed = new Map(progress?.map((p) => [p.line.id, p.invoiced]) ?? []);
  const canBill =
    order &&
    (doc.status === 'issued' || doc.status === 'partially_billed') &&
    (progress?.some((p) => p.toInvoice > 0) ?? false);

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

  const opened = (created: InvoiceDocument, edit = false) => {
    toast.success(
      t('{document} {number} created', {
        document: t(DOCUMENT_LABELS[created.type].singular),
        number: created.number,
      }),
    );
    navigate(`${DOCUMENT_ROUTES[created.type]}/${created.id}${edit ? '/edit' : ''}`);
  };

  const setStatus = (next: DocumentStatus) => run(next, () => setDocumentStatus(doc.id, next));

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete {document} {number}?', { document: documentNoun(type), number: doc.number }),
      description:
        isBill && doc.totals.paid > 0
          ? t('Payments made against it will be kept as an unapplied advance to the vendor.')
          : t('This cannot be undone.'),
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
      description: t('A void document stays in your records for reference but leaves the books.'),
      confirmLabel: t('Void'),
      danger: true,
    });
    if (ok) await run('void', () => setDocumentStatus(doc.id, 'void'));
  };

  const cancelOrder = async () => {
    const ok = await confirm({
      title: t('Cancel {number}?', { number: doc.number }),
      description: t(
        'A cancelled document stays in your records for reference. Bills already made from it are not changed.',
      ),
      confirmLabel: t('Cancel order'),
      danger: true,
    });
    if (ok) await setStatus('cancelled');
  };

  const download = () =>
    run('download', async () => {
      const blob = await printing.getPdf();
      if (blob) downloadBlob(blob, printing.fileName);
    });
  const print = () =>
    run('print', async () => {
      const blob = await printing.getPdf();
      if (blob) printBlob(blob);
    });

  const primaryAction =
    doc.status === 'draft' ? (
      <Button loading={busy === 'open'} onClick={() => void run('open', () => markSent(doc.id))}>
        <CheckCircle2 /> {order ? t('Mark as issued') : t('Mark as open')}
      </Button>
    ) : canBill ? (
      <Button onClick={() => setConvert(true)}>
        <Receipt /> {t('Convert to bill')}
      </Button>
    ) : isBill && open ? (
      <Button onClick={() => setRecordPayment(true)}>
        <CreditCard /> {t('Record payment')}
      </Button>
    ) : type === 'vendor_credit' && open && doc.totals.balance > 0 ? (
      <Button onClick={() => setApplyCredit(true)}>
        <CreditCard /> {t('Apply to bill')}
      </Button>
    ) : null;

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
          </div>
          {vendor ? (
            <p className="mt-1 text-sm text-slate-500">
              {tr(order ? 'to {vendor}' : 'from {vendor}', {
                vendor: (
                  <Link
                    to={`/vendors/${vendor.id}`}
                    className="hover:text-primary-700 font-medium text-slate-700"
                  >
                    {localName(vendor)}
                  </Link>
                ),
              })}
              {doc.vendorReference && !order
                ? ` · ${t('their ref. {reference}', { reference: doc.vendorReference })}`
                : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order ? (
            <>
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
            </>
          ) : null}
          <Button variant="outline" onClick={() => navigate(`${base}/${doc.id}/edit`)}>
            <Pencil /> {t('Edit')}
          </Button>
          {primaryAction}
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('More actions')}>
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              {isBill && doc.status !== 'draft' && doc.status !== 'void' ? (
                <DropdownItem
                  icon={<FileMinus />}
                  onSelect={() =>
                    void run('credit', async () =>
                      opened(
                        await duplicateDocument(doc.id, 'vendor_credit', {
                          sourceId: doc.id,
                          vendorReference: '',
                        }),
                        true,
                      ),
                    )
                  }
                >
                  {t('Create vendor credit')}
                </DropdownItem>
              ) : null}
              {isBill && doc.status !== 'draft' && doc.status !== 'void' ? (
                <DropdownItem
                  icon={<ShipWheel />}
                  onSelect={() => navigate(`/inventory/landed-costs/new?bill=${doc.id}`)}
                >
                  {t('Allocate landed costs')}
                </DropdownItem>
              ) : null}
              <DropdownItem
                icon={<Copy />}
                onSelect={() =>
                  void run('duplicate', async () =>
                    opened(
                      await duplicateDocument(doc.id, undefined, { vendorReference: '' }),
                      true,
                    ),
                  )
                }
              >
                {t('Duplicate')}
              </DropdownItem>
              {order ? (
                doc.status === 'cancelled' ? (
                  <DropdownItem icon={<RotateCcw />} onSelect={() => void setStatus('issued')}>
                    {t('Reopen')}
                  </DropdownItem>
                ) : doc.status !== 'draft' ? (
                  <DropdownItem icon={<Ban />} onSelect={() => void cancelOrder()}>
                    {t('Cancel order')}
                  </DropdownItem>
                ) : null
              ) : doc.status === 'void' ? (
                <DropdownItem icon={<Undo2 />} onSelect={() => void setStatus('sent')}>
                  {t('Restore (un-void)')}
                </DropdownItem>
              ) : doc.status !== 'draft' ? (
                <DropdownItem icon={<Ban />} onSelect={() => void voidDoc()}>
                  {t('Void')}
                </DropdownItem>
              ) : null}
              <DropdownSeparator />
              <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                {t('Delete')}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label={isBill ? t('Bill date') : order ? t('Order date') : t('Date')}>
                  {fmt.date(doc.issueDate)}
                </Detail>
                {isBill ? (
                  <Detail label={t('Due date')}>
                    {doc.dueDate ? (
                      <span className={overdueDays > 0 ? 'font-medium text-red-600' : undefined}>
                        {fmt.date(doc.dueDate)}
                        {overdueDays > 0
                          ? ` · ${tp(overdueDays, '{count} day late', '{count} days late')}`
                          : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Detail>
                ) : null}
                <Detail label={order ? t("Vendor's quote number") : t('Vendor reference')}>
                  {doc.vendorReference || '—'}
                </Detail>
                {order ? (
                  <>
                    <Detail label={t('Delivery date')}>{fmt.date(doc.deliveryDate) || '—'}</Detail>
                    <Detail label={t('Deliver to')}>{doc.deliveryPlace || '—'}</Detail>
                  </>
                ) : (
                  <Detail label={t('PO / reference')}>{doc.poNumber || '—'}</Detail>
                )}
                {doc.currency !== company.currency && !order ? (
                  <Detail label={t('Exchange rate')}>
                    {doc.exchangeRate
                      ? `1 ${doc.currency} = ${doc.exchangeRate} ${company.currency}`
                      : t('Not set')}
                  </Detail>
                ) : null}
              </dl>
            </CardBody>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5 text-start font-medium">{t('Description')}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t('Category')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('Qty')}</th>
                    {order ? (
                      <th className="px-3 py-2.5 text-end font-medium">{t('Billed')}</th>
                    ) : null}
                    <th className="px-3 py-2.5 text-end font-medium">{t('Rate')}</th>
                    <th className="px-5 py-2.5 text-end font-medium">{t('Amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {doc.items.map((item, i) =>
                    item.kind === 'heading' ? null : (
                      <tr key={item.id}>
                        <td className="px-5 py-2.5 text-slate-800">
                          {item.name || <span className="text-slate-400">—</span>}
                          {item.nameAr ? (
                            <span className="block text-xs text-slate-500" dir="rtl" lang="ar">
                              {item.nameAr}
                            </span>
                          ) : null}
                          {item.taxes.length ? (
                            <span className="block text-xs text-slate-500">
                              {item.taxes
                                .map((tax) => `${tax.name} ${fmt.percent(tax.rate)}`)
                                .join(', ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {accountName(item.accountId)}
                        </td>
                        <td className="tabular px-3 py-2.5 text-end text-slate-600">
                          {fmt.quantity(item.quantity)}
                        </td>
                        {order ? (
                          <td
                            className={
                              (billed.get(item.id) ?? 0) >= item.quantity && item.quantity > 0
                                ? 'tabular px-3 py-2.5 text-end font-medium text-emerald-700'
                                : 'tabular px-3 py-2.5 text-end text-slate-600'
                            }
                          >
                            {fmt.quantity(billed.get(item.id) ?? 0)}
                          </td>
                        ) : null}
                        <td className="tabular px-3 py-2.5 text-end text-slate-600">
                          {money(item.unitPrice)}
                        </td>
                        <td className="tabular px-5 py-2.5 text-end font-medium text-slate-900">
                          {money(result.lines[i]?.net ?? 0)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-4">
              <div className="w-full max-w-xs">
                <SummaryRow label={t('Subtotal')} value={money(result.subtotal)} />
                {result.discount ? (
                  <SummaryRow label={t('Discount')} value={money(-result.discount)} />
                ) : null}
                {doc.charges.map((c) => (
                  <SummaryRow key={c.id} label={c.label || t('Charge')} value={money(c.amount)} />
                ))}
                {result.taxes
                  .filter((tax) => tax.kind !== 'reverse_charge')
                  .map((tax) => (
                    <SummaryRow
                      key={tax.key}
                      label={
                        doc.pricesIncludeTax
                          ? t('Includes {tax}', { tax: `${tax.name} ${fmt.percent(tax.rate)}` })
                          : `${tax.name} ${fmt.percent(tax.rate)}`
                      }
                      value={money(tax.amount)}
                    />
                  ))}
                <SummaryRow label={t('Total')} value={money(result.total)} tone="strong" />
                {result.taxes
                  .filter((tax) => tax.kind === 'reverse_charge')
                  .map((tax) => (
                    <SummaryRow
                      key={tax.key}
                      label={t('Reverse charge {tax}', {
                        tax: `${tax.name} ${fmt.percent(tax.rate)}`,
                      })}
                      value={money(tax.amount)}
                    />
                  ))}
              </div>
            </div>
          </Card>

          {order ? (
            <Card>
              <CardHeader
                title={t('What the supplier receives')}
                description={t('The purchase order as it prints and downloads.')}
              />
              <div className="rounded-b-xl bg-slate-200/60 p-3 sm:p-6">
                <div className="mx-auto max-w-[820px]">
                  <PdfPreview
                    blob={printing.pdf.blob}
                    loading={printing.pdf.loading}
                    error={printing.pdf.error}
                  />
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title={t('Attachments')}
              description={
                isBill
                  ? t('The bill as you received it.')
                  : order
                    ? t('Quotes or other files for this order.')
                    : t('The credit note as you received it.')
              }
            />
            <CardBody>
              <AttachmentList
                files={attachments ?? []}
                onAdd={(file) => addAttachment(company.id, doc.id, file)}
                onRemove={(fileId) => removeAttachment(fileId)}
                emptyText={t('No files attached.')}
              />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title={t('Summary')} />
            <CardBody className="py-3">
              <SummaryRow label={t('Total')} value={money(doc.totals.total)} tone="strong" />
              {order ? null : (
                <>
                  <SummaryRow
                    label={isBill ? t('Paid') : t('Applied')}
                    value={money(doc.totals.paid)}
                  />
                  <SummaryRow
                    label={isBill ? t('Balance due') : t('Remaining')}
                    value={money(doc.status === 'void' ? 0 : doc.totals.balance)}
                    tone={status === 'overdue' ? 'danger' : 'strong'}
                  />
                </>
              )}
              <RelatedDocuments doc={doc} />
              {doc.privateNotes ? (
                <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs whitespace-pre-line text-amber-900">
                  {doc.privateNotes}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {order ? null : (
            <Card>
              <CardHeader
                title={isBill ? t('Payments') : t('Applied to')}
                actions={
                  isBill && open ? (
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
                      const amount = isBill
                        ? p.allocations
                            .filter((a) => a.documentId === doc.id)
                            .reduce((s, a) => s + a.amount, 0)
                        : p.amount;
                      return (
                        <li key={p.id}>
                          <Link
                            to={`/payments-made/${p.id}`}
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
                                  ? 'tabular text-slate-400 line-through'
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
                    {isBill ? t('No payments recorded yet.') : t('Not applied to any bill yet.')}
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={t('Activity')} />
            <CardBody className="py-3">
              {activity && activity.length > 0 ? (
                <ol className="relative space-y-4 border-s border-slate-200 ps-4">
                  {activity.slice(0, 12).map((a) => (
                    <li key={a.id} className="relative">
                      <span className="bg-primary-500 absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-white" />
                      <p className="text-sm text-slate-700">{activityText(a)}</p>
                      <p className="text-xs text-slate-400">{fmt.dateTime(a.at)}</p>
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

      {recordPayment ? (
        <RecordPaymentDialog open onOpenChange={setRecordPayment} invoice={doc} company={company} />
      ) : null}
      {applyCredit ? (
        <ApplyCreditDialog open onOpenChange={setApplyCredit} credit={doc} company={company} />
      ) : null}
      {convert ? (
        <PartDialog
          open
          onOpenChange={setConvert}
          doc={doc}
          target="bill"
          onCreated={(created) => {
            setConvert(false);
            opened(created);
          }}
        />
      ) : null}
    </div>
  );
}
