import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ClipboardList,
  Download,
  FileClock,
  FileMinus,
  FileText,
  PackageCheck,
  Palette,
  Plus,
  Receipt,
  ReceiptText,
  ScrollText,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { db } from '@/db/db';
import type { Client, DocumentType, InvoiceDocument } from '@/db/types';
import {
  DOCUMENT_LABELS,
  DOCUMENT_ROUTES,
  documentCount,
  useCompany,
  useFormat,
} from '@/app/company';
import { deliveryStatusMeta, displayStatus, statusMeta, type DisplayStatus } from '@/lib/status';
import { today } from '@/lib/dates';
import { hasPrices, isPurchaseType, postsToLedger } from '@/lib/document-types';
import { downloadCsv } from '@/lib/csv';
import { msg, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Spinner,
  StatusBadge,
} from '@/components/ui/misc';
import { Input } from '@/components/ui/form';

/** `approval`: documents with a change waiting for an approver. */
type Filter = 'all' | DisplayStatus | 'unpaid' | 'approval';

const WAITING = { value: 'approval', label: msg('Waiting for approval') } as const;

/** What the list of void documents is called (the `?status=void` view). */
const VOID_TITLES: Partial<Record<DocumentType, string>> = {
  invoice: msg('Void invoices'),
  credit: msg('Void credit notes'),
};

const ALL = { value: 'all', label: msg('All') } as const;
const DRAFT = { value: 'draft', label: msg('Draft') } as const;

const FILTERS: Record<DocumentType, { value: Filter; label: string }[]> = {
  invoice: [
    ALL,
    DRAFT,
    { value: 'unpaid', label: msg('Unpaid') },
    { value: 'overdue', label: msg('Overdue') },
    { value: 'paid', label: msg('Paid') },
    { value: 'void', label: msg('Void') },
  ],
  quote: [
    ALL,
    DRAFT,
    { value: 'sent', label: msg('Sent') },
    { value: 'accepted', label: msg('Accepted') },
    { value: 'expired', label: msg('Expired') },
    { value: 'invoiced', label: msg('Invoiced') },
    { value: 'converted', label: msg('Converted') },
    { value: 'declined', label: msg('Declined') },
  ],
  credit: [
    ALL,
    DRAFT,
    { value: 'sent', label: msg('Open') },
    { value: 'applied', label: msg('Applied') },
    { value: 'void', label: msg('Void') },
  ],
  bill: [
    ALL,
    DRAFT,
    { value: 'unpaid', label: msg('Unpaid') },
    { value: 'overdue', label: msg('Overdue') },
    { value: 'paid', label: msg('Paid') },
    { value: 'void', label: msg('Void') },
  ],
  vendor_credit: [
    ALL,
    DRAFT,
    { value: 'open', label: msg('Open') },
    { value: 'applied', label: msg('Applied') },
    { value: 'void', label: msg('Void') },
  ],
  proforma: [
    ALL,
    DRAFT,
    { value: 'sent', label: msg('Sent') },
    { value: 'accepted', label: msg('Accepted') },
    { value: 'expired', label: msg('Expired') },
    { value: 'converted', label: msg('Converted') },
  ],
  sales_order: [
    ALL,
    DRAFT,
    { value: 'confirmed', label: msg('Confirmed') },
    { value: 'partially_invoiced', label: msg('Partially invoiced') },
    { value: 'invoiced', label: msg('Invoiced') },
    { value: 'cancelled', label: msg('Cancelled') },
  ],
  purchase_order: [
    ALL,
    DRAFT,
    { value: 'issued', label: msg('Issued') },
    { value: 'partially_billed', label: msg('Partially billed') },
    { value: 'billed', label: msg('Billed') },
    { value: 'cancelled', label: msg('Cancelled') },
  ],
  delivery_note: [
    ALL,
    DRAFT,
    { value: 'delivered', label: msg('Delivered') },
    { value: 'cancelled', label: msg('Cancelled') },
  ],
};

const ICONS: Record<DocumentType, React.ReactNode> = {
  invoice: <FileText />,
  quote: <ScrollText />,
  credit: <FileMinus />,
  bill: <Receipt />,
  vendor_credit: <ReceiptText />,
  proforma: <FileClock />,
  sales_order: <ClipboardList />,
  purchase_order: <ShoppingCart />,
  delivery_note: <PackageCheck />,
};

/** The second date column: when it is due, valid until or delivered. */
function secondDate(type: DocumentType): { label: string; of: (d: InvoiceDocument) => string } {
  if (type === 'quote' || type === 'proforma') {
    return { label: msg('Valid until'), of: (d) => d.dueDate ?? '' };
  }
  if (type === 'sales_order' || type === 'purchase_order' || type === 'delivery_note') {
    return { label: msg('Delivery date'), of: (d) => d.deliveryDate ?? '' };
  }
  return { label: msg('Due'), of: (d) => d.dueDate ?? '' };
}

function matches(filter: Filter, status: DisplayStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'unpaid')
    return status === 'sent' || status === 'open' || status === 'partial' || status === 'overdue';
  if (filter === 'sent') return status === 'sent' || status === 'partial';
  if (filter === 'open') return status === 'open' || status === 'partial';
  return status === filter;
}

/** Sales orders show how far delivery has got next to their status. */
function DeliveryBadge({ doc }: { doc: InvoiceDocument }) {
  if (doc.type !== 'sales_order' || doc.status === 'draft' || doc.status === 'cancelled') {
    return null;
  }
  const meta = deliveryStatusMeta(doc.deliveryStatus);
  return <Badge tone={meta.tone}>{t(meta.label)}</Badge>;
}

/** A change of the document waits for an approver. */
function WaitingBadge() {
  return <Badge tone="amber">{t('Waiting for approval')}</Badge>;
}

export default function DocumentListPage({ type }: { type: DocumentType }) {
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const filter = (params.get('status') as Filter) || 'all';
  const labels = DOCUMENT_LABELS[type];
  const base = DOCUMENT_ROUTES[type];
  const purchase = isPurchaseType(type);
  const party = purchase ? t('Vendor') : t('Client');
  const priced = hasPrices(type);
  const booked = postsToLedger(type);
  const second = secondDate(type);

  const docs = useLiveQuery(
    () => db.documents.where('[companyId+type]').equals([company.id, type]).toArray(),
    [company.id, type],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  // Documents with a change waiting for an approver (Settings → Approvals).
  const waiting = useLiveQuery(
    async () =>
      new Set(
        (await db.approvals.where('[companyId+status]').equals([company.id, 'pending']).toArray())
          .filter((r) => r.subjectTbl === 'documents')
          .map((r) => r.subjectId),
      ),
    [company.id],
  );
  const awaiting = (id: string) => waiting?.has(id) ?? false;
  const filters = useMemo(() => {
    const own = FILTERS[type];
    const shown =
      (company.approvalRules?.documentTypes ?? []).includes(type) ||
      Boolean(docs?.some((d) => waiting?.has(d.id)));
    return shown ? [...own, WAITING] : own;
  }, [type, company.approvalRules, docs, waiting]);

  const rows = useMemo(() => {
    if (!docs || !clients) return null;
    const byId = new Map<string, Client>(clients.map((c) => [c.id, c]));
    const now = today();
    return docs
      .map((d) => ({ doc: d, client: byId.get(d.clientId) ?? null, status: displayStatus(d, now) }))
      .sort((a, b) =>
        a.doc.issueDate === b.doc.issueDate
          ? b.doc.number.localeCompare(a.doc.number, undefined, { numeric: true })
          : b.doc.issueDate.localeCompare(a.doc.issueDate),
      );
  }, [docs, clients]);

  const counts = useMemo(() => {
    const c: Partial<Record<Filter, number>> = {};
    for (const f of filters)
      c[f.value] =
        rows?.filter((r) =>
          f.value === 'approval' ? waiting?.has(r.doc.id) : matches(f.value, r.status),
        ).length ?? 0;
    return c;
  }, [rows, filters, waiting]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === 'approval' ? Boolean(waiting?.has(r.doc.id)) : matches(filter, r.status)) &&
        (!q ||
          [
            r.doc.number,
            r.client?.name,
            r.client?.nameAr,
            r.doc.poNumber,
            r.doc.vendorReference,
            r.doc.receiverName,
          ]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, filter, query, waiting]);

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { total: number; balance: number }>();
    for (const { doc, status } of filtered) {
      if (status === 'void' || status === 'cancelled') continue;
      const entry = map.get(doc.currency) ?? { total: 0, balance: 0 };
      entry.total += doc.totals.total;
      if ((type === 'invoice' || type === 'bill') && status !== 'draft')
        entry.balance += doc.totals.balance;
      map.set(doc.currency, entry);
    }
    return [...map.entries()];
  }, [filtered, type]);

  const exportCsv = () => {
    const money = (n: number) => (priced ? n : '');
    downloadCsv(
      `${labels.plural.toLowerCase().replace(/\s+/g, '-')}-${today()}`,
      [
        t('Number'),
        t('Status'),
        party,
        t('Issue date'),
        t(second.label),
        purchase ? t('Vendor reference') : t('PO number'),
        t('Currency'),
        t('Subtotal'),
        t('Discount'),
        t('Tax'),
        t('Total'),
        t('Paid'),
        t('Balance'),
      ],
      filtered.map(({ doc, client, status }) => [
        doc.number,
        t(statusMeta(status).label),
        client?.name ?? '',
        doc.issueDate,
        second.of(doc),
        purchase ? (doc.vendorReference ?? '') : doc.poNumber,
        doc.currency,
        money(doc.totals.subtotal),
        money(doc.totals.discount),
        money(doc.totals.taxTotal),
        money(doc.totals.total),
        booked ? doc.totals.paid : '',
        booked ? doc.totals.balance : '',
      ]),
    );
  };

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;

  const createButton = (
    <ButtonLink to={`${base}/new`}>
      <Plus /> {t(labels.create)}
    </ButtonLink>
  );

  return (
    <div>
      <PageHeader
        title={filter === 'void' && VOID_TITLES[type] ? t(VOID_TITLES[type]) : t(labels.plural)}
        description={t(labels.description)}
        actions={
          <>
            {type === 'quote' ? (
              <ButtonLink to="/templates?type=quote" variant="outline">
                <Palette /> {t('Quote design')}
              </ButtonLink>
            ) : null}
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> {t('Export CSV')}
              </Button>
            ) : null}
            {createButton}
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ICONS[type]}
            title={t(labels.empty)}
            description={t('It only takes a minute.')}
            action={createButton}
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
            <Segmented
              value={filter}
              onChange={(value) => {
                setLimit(50);
                setParams(value === 'all' ? {} : { status: value }, { replace: true });
              }}
              options={filters.map((f) => ({
                value: f.value,
                label: t(f.label),
                count: counts[f.value],
              }))}
            />
            <div className="relative lg:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  purchase
                    ? t('Search number, vendor, reference…')
                    : t('Search number, client, PO…')
                }
                className="ps-9"
                aria-label={t('Search {list}', { list: t(labels.plural).toLowerCase() })}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {t('Nothing matches these filters.')}
            </p>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                      <th className="px-5 py-3 text-start">{t('Number')}</th>
                      <th className="px-3 py-3 text-start">{party}</th>
                      <th className="px-3 py-3 text-start">{t('Date')}</th>
                      <th className="px-3 py-3 text-start">{t(second.label)}</th>
                      {priced ? <th className="px-3 py-3 text-end">{t('Total')}</th> : null}
                      {booked ? (
                        <th className="px-3 py-3 text-end">
                          {type === 'credit' || type === 'vendor_credit'
                            ? t('Remaining')
                            : t('Balance')}
                        </th>
                      ) : null}
                      <th className="px-5 py-3 text-end">{t('Status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.slice(0, limit).map(({ doc, client, status }) => (
                      <tr
                        key={doc.id}
                        onClick={() => navigate(`${base}/${doc.id}`)}
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                      >
                        <td className="px-5 py-3 font-medium text-slate-900">
                          <Link
                            to={`${base}/${doc.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary-700"
                          >
                            {doc.number || t('Draft')}
                          </Link>
                          {purchase && doc.vendorReference ? (
                            <span className="block text-xs font-normal text-slate-500">
                              {doc.vendorReference}
                            </span>
                          ) : null}
                        </td>
                        <td dir="auto" className="max-w-56 truncate px-3 py-3 text-slate-700">
                          {client ? localName(client) : '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                          {fmt.date(doc.issueDate)}
                        </td>
                        <td
                          className={`px-3 py-3 whitespace-nowrap ${status === 'overdue' ? 'font-medium text-red-600' : 'text-slate-600'}`}
                        >
                          {fmt.date(second.of(doc)) || '—'}
                        </td>
                        {priced ? (
                          <td className="tabular px-3 py-3 text-end font-medium whitespace-nowrap text-slate-900">
                            {fmt.money(doc.totals.total, doc.currency)}
                          </td>
                        ) : null}
                        {booked ? (
                          <td className="tabular px-3 py-3 text-end whitespace-nowrap text-slate-600">
                            {status === 'void' || status === 'draft'
                              ? '—'
                              : fmt.money(doc.totals.balance, doc.currency)}
                          </td>
                        ) : null}
                        <td className="px-5 py-3 text-end">
                          <span className="inline-flex flex-wrap justify-end gap-1">
                            <StatusBadge status={status} />
                            <DeliveryBadge doc={doc} />
                            {awaiting(doc.id) ? <WaitingBadge /> : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-slate-100 md:hidden">
                {filtered.slice(0, limit).map(({ doc, client, status }) => (
                  <li key={doc.id}>
                    <Link
                      to={`${base}/${doc.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p dir="auto" className="truncate font-medium text-slate-900">
                          {client ? localName(client) : '—'}
                        </p>
                        <p className="text-xs text-slate-500">
                          <bdi>{doc.number || t('Draft')}</bdi> · {fmt.date(doc.issueDate)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {priced ? (
                          <span className="tabular text-sm font-semibold whitespace-nowrap text-slate-900">
                            {fmt.money(doc.totals.total, doc.currency)}
                          </span>
                        ) : null}
                        <span className="flex flex-wrap justify-end gap-1">
                          <StatusBadge status={status} />
                          <DeliveryBadge doc={doc} />
                          {awaiting(doc.id) ? <WaitingBadge /> : null}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>{documentCount(type, filtered.length)}</span>
                {priced ? (
                  <span className="tabular flex flex-wrap gap-x-4">
                    {totalsByCurrency.map(([currency, sum]) => (
                      <span key={currency}>
                        {t('Total')}{' '}
                        <strong className="text-slate-900">{fmt.money(sum.total, currency)}</strong>
                        {type === 'invoice' ? (
                          <>
                            {' '}
                            · {t('Outstanding')}{' '}
                            <strong className="text-slate-900">
                              {fmt.money(sum.balance, currency)}
                            </strong>
                          </>
                        ) : null}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
              {filtered.length > limit ? (
                <div className="border-t border-slate-100 p-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 100)}>
                    {t('Show more ({count} remaining)', { count: filtered.length - limit })}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
