import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Ban,
  CheckCircle2,
  Copy,
  CreditCard,
  FileMinus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteDocument, duplicateDocument, markSent, setDocumentStatus } from '@/db/documents';
import { paymentMethodLabel } from '@/db/payments';
import { addAttachment, removeAttachment } from '@/db/purchases';
import type { InvoiceDocument, PurchaseDocumentType } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { computeDocument } from '@/lib/document-calc';
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
import { ApplyCreditDialog, RecordPaymentDialog } from '@/features/documents/payment-dialogs';
import { AttachmentList } from '@/features/purchases/attachments';
import { useAccounts } from '@/features/accounting/account-pickers';

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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/** A bill or vendor credit: what was bought, what is owed and what was paid. */
export default function BillViewPage({ type }: { type: PurchaseDocumentType }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const labels = DOCUMENT_LABELS[type];
  const base = DOCUMENT_ROUTES[type];
  const noun = labels.singular.toLowerCase();

  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const vendor = useLiveQuery(
    async () => (doc?.clientId ? ((await db.clients.get(doc.clientId)) ?? null) : null),
    [doc?.clientId],
  );
  const payments = useLiveQuery(async () => {
    if (!doc) return [];
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
  const related = useLiveQuery(async () => {
    if (!doc) return [];
    const ids = [doc.sourceId].filter((x): x is string => Boolean(x));
    const fromThis = await db.documents
      .where('companyId')
      .equals(doc.companyId)
      .filter((d) => d.sourceId === doc.id)
      .toArray();
    const sources = (await db.documents.bulkGet(ids)).filter((d): d is InvoiceDocument =>
      Boolean(d),
    );
    return [...sources, ...fromThis];
  }, [doc?.id, doc?.sourceId, doc?.companyId]);
  const accounts = useAccounts();

  const [recordPayment, setRecordPayment] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (doc === undefined || vendor === undefined || !accounts)
    return <Spinner className="py-24" label="Loading…" />;
  if (!doc || doc.companyId !== company.id || doc.type !== type) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This {noun} could not be found.</p>
        <Link to={base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          Back to {labels.plural.toLowerCase()}
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
    return account ? `${account.code} ${account.name}` : 'General expenses';
  };
  const open = doc.status === 'sent' || doc.status === 'partial';
  const isBill = type === 'bill';

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

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${noun} ${doc.number}?`,
      description:
        isBill && doc.totals.paid > 0
          ? 'Payments made against it will be kept as an unapplied advance to the vendor.'
          : 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await run('delete', async () => {
      await deleteDocument(doc.id);
      toast.success(`${labels.singular} deleted`);
      navigate(base);
    });
  };

  const voidDoc = async () => {
    const ok = await confirm({
      title: `Void ${doc.number}?`,
      description: 'A void document stays in your records for reference but leaves the books.',
      confirmLabel: 'Void',
      danger: true,
    });
    if (ok) await run('void', () => setDocumentStatus(doc.id, 'void'));
  };

  const primaryAction =
    doc.status === 'draft' ? (
      <Button loading={busy === 'open'} onClick={() => void run('open', () => markSent(doc.id))}>
        <CheckCircle2 /> Mark as open
      </Button>
    ) : isBill && open ? (
      <Button onClick={() => setRecordPayment(true)}>
        <CreditCard /> Record payment
      </Button>
    ) : !isBill && open && doc.totals.balance > 0 ? (
      <Button onClick={() => setApplyCredit(true)}>
        <CreditCard /> Apply to bill
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
          {vendor ? (
            <p className="mt-1 text-sm text-slate-500">
              from{' '}
              <Link
                to={`/vendors/${vendor.id}`}
                className="hover:text-primary-700 font-medium text-slate-700"
              >
                {vendor.name}
              </Link>
              {doc.vendorReference ? ` · their ref. ${doc.vendorReference}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              {isBill && doc.status !== 'draft' && doc.status !== 'void' ? (
                <DropdownItem
                  icon={<FileMinus />}
                  onSelect={() =>
                    void run('credit', async () => {
                      const credit = await duplicateDocument(doc.id, 'vendor_credit', {
                        sourceId: doc.id,
                        vendorReference: '',
                      });
                      toast.success(`Vendor credit ${credit.number} created`);
                      navigate(`/vendor-credits/${credit.id}/edit`);
                    })
                  }
                >
                  Create vendor credit
                </DropdownItem>
              ) : null}
              <DropdownItem
                icon={<Copy />}
                onSelect={() =>
                  void run('duplicate', async () => {
                    const copy = await duplicateDocument(doc.id, undefined, {
                      vendorReference: '',
                    });
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
              ) : doc.status !== 'draft' ? (
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
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label={isBill ? 'Bill date' : 'Date'}>{fmt.date(doc.issueDate)}</Detail>
                {isBill ? (
                  <Detail label="Due date">
                    {doc.dueDate ? (
                      <span className={overdueDays > 0 ? 'font-medium text-red-600' : undefined}>
                        {fmt.date(doc.dueDate)}
                        {overdueDays > 0 ? ` · ${overdueDays}d late` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Detail>
                ) : null}
                <Detail label="Vendor reference">{doc.vendorReference || '—'}</Detail>
                <Detail label="PO / reference">{doc.poNumber || '—'}</Detail>
                {doc.currency !== company.currency ? (
                  <Detail label="Exchange rate">
                    {doc.exchangeRate
                      ? `1 ${doc.currency} = ${doc.exchangeRate} ${company.currency}`
                      : 'Not set'}
                  </Detail>
                ) : null}
              </dl>
            </CardBody>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/60 text-xs tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5 text-start font-medium">Description</th>
                    <th className="px-3 py-2.5 text-start font-medium">Category</th>
                    <th className="px-3 py-2.5 text-end font-medium">Qty</th>
                    <th className="px-3 py-2.5 text-end font-medium">Rate</th>
                    <th className="px-5 py-2.5 text-end font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {doc.items.map((item, i) =>
                    item.kind === 'heading' ? null : (
                      <tr key={item.id}>
                        <td className="px-5 py-2.5 text-slate-800">
                          {item.name || <span className="text-slate-400">—</span>}
                          {item.taxes.length ? (
                            <span className="block text-xs text-slate-500">
                              {item.taxes.map((t) => `${t.name} ${fmt.percent(t.rate)}`).join(', ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {accountName(item.accountId)}
                        </td>
                        <td className="tabular px-3 py-2.5 text-end text-slate-600">
                          {fmt.quantity(item.quantity)}
                        </td>
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
                <SummaryRow label="Subtotal" value={money(result.subtotal)} />
                {result.discount ? (
                  <SummaryRow label="Discount" value={money(-result.discount)} />
                ) : null}
                {doc.charges.map((c) => (
                  <SummaryRow key={c.id} label={c.label || 'Charge'} value={money(c.amount)} />
                ))}
                {result.taxes
                  .filter((t) => t.kind !== 'reverse_charge')
                  .map((t) => (
                    <SummaryRow
                      key={t.key}
                      label={`${doc.pricesIncludeTax ? 'Includes ' : ''}${t.name} ${fmt.percent(t.rate)}`}
                      value={money(t.amount)}
                    />
                  ))}
                <SummaryRow label="Total" value={money(result.total)} tone="strong" />
                {result.taxes
                  .filter((t) => t.kind === 'reverse_charge')
                  .map((t) => (
                    <SummaryRow
                      key={t.key}
                      label={`Reverse charge ${t.name} ${fmt.percent(t.rate)}`}
                      value={money(t.amount)}
                    />
                  ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Attachments"
              description={`The ${isBill ? 'bill' : 'credit note'} as you received it.`}
            />
            <CardBody>
              <AttachmentList
                files={attachments ?? []}
                onAdd={(file) => addAttachment(company.id, doc.id, file)}
                onRemove={(fileId) => removeAttachment(fileId)}
                emptyText="No files attached."
              />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="py-3">
              <SummaryRow label="Total" value={money(doc.totals.total)} tone="strong" />
              <SummaryRow label={isBill ? 'Paid' : 'Applied'} value={money(doc.totals.paid)} />
              <SummaryRow
                label={isBill ? 'Balance due' : 'Remaining'}
                value={money(doc.status === 'void' ? 0 : doc.totals.balance)}
                tone={status === 'overdue' ? 'danger' : 'strong'}
              />
              {related && related.length > 0 ? (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  {related.map((r) => (
                    <Link
                      key={r.id}
                      to={`${DOCUMENT_ROUTES[r.type]}/${r.id}`}
                      className="text-primary-700 block py-1 text-sm font-medium hover:underline"
                    >
                      {r.id === doc.sourceId ? 'Created from' : 'Credited by'}{' '}
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

          <Card>
            <CardHeader
              title={isBill ? 'Payments' : 'Applied to'}
              actions={
                isBill && open ? (
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
                    const amount = isBill
                      ? p.allocations
                          .filter((a) => a.documentId === doc.id)
                          .reduce((s, a) => s + a.amount, 0)
                      : p.amount;
                    return (
                      <li key={p.id}>
                        <Link
                          to={`/payments-made/${p.id}`}
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
                  {isBill ? 'No payments recorded yet.' : 'Not applied to any bill yet.'}
                </p>
              )}
            </CardBody>
          </Card>

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

      {recordPayment ? (
        <RecordPaymentDialog open onOpenChange={setRecordPayment} invoice={doc} company={company} />
      ) : null}
      {applyCredit ? (
        <ApplyCreditDialog open onOpenChange={setApplyCredit} credit={doc} company={company} />
      ) : null}
    </div>
  );
}
