import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Download,
  FileMinus,
  FileText,
  Plus,
  Receipt,
  ReceiptText,
  ScrollText,
  Search,
} from 'lucide-react';
import { db } from '@/db/db';
import type { Client, DocumentType } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { displayStatus, type DisplayStatus } from '@/lib/status';
import { today } from '@/lib/dates';
import { isPurchaseType } from '@/lib/document-types';
import { downloadCsv } from '@/lib/csv';
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Card,
  EmptyState,
  PageHeader,
  Segmented,
  Spinner,
  StatusBadge,
} from '@/components/ui/misc';
import { Input } from '@/components/ui/form';

type Filter = 'all' | DisplayStatus | 'unpaid';

const FILTERS: Record<DocumentType, { value: Filter; label: string }[]> = {
  invoice: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ],
  quote: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'expired', label: 'Expired' },
    { value: 'invoiced', label: 'Invoiced' },
    { value: 'declined', label: 'Declined' },
  ],
  credit: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Open' },
    { value: 'applied', label: 'Applied' },
    { value: 'void', label: 'Void' },
  ],
  bill: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ],
  vendor_credit: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'open', label: 'Open' },
    { value: 'applied', label: 'Applied' },
    { value: 'void', label: 'Void' },
  ],
};

const DESCRIPTIONS: Record<DocumentType, string> = {
  invoice: 'Bill your clients and track what is paid.',
  quote: 'Send estimates and convert accepted quotes into invoices.',
  credit: 'Issue credit notes and apply them to invoices.',
  bill: 'Record bills from your suppliers and keep track of what you owe.',
  vendor_credit: 'Credits from suppliers for returns or refunds, applied to their bills.',
};

const ICONS: Record<DocumentType, React.ReactNode> = {
  invoice: <FileText />,
  quote: <ScrollText />,
  credit: <FileMinus />,
  bill: <Receipt />,
  vendor_credit: <ReceiptText />,
};

function matches(filter: Filter, status: DisplayStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'unpaid')
    return status === 'sent' || status === 'open' || status === 'partial' || status === 'overdue';
  if (filter === 'sent') return status === 'sent' || status === 'partial';
  if (filter === 'open') return status === 'open' || status === 'partial';
  return status === filter;
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
  const party = purchase ? 'Vendor' : 'Client';

  const docs = useLiveQuery(
    () => db.documents.where('[companyId+type]').equals([company.id, type]).toArray(),
    [company.id, type],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

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
    for (const f of FILTERS[type])
      c[f.value] = rows?.filter((r) => matches(f.value, r.status)).length ?? 0;
    return c;
  }, [rows, type]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        matches(filter, r.status) &&
        (!q ||
          `${r.doc.number} ${r.client?.name ?? ''} ${r.doc.poNumber} ${r.doc.vendorReference ?? ''}`
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, filter, query]);

  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, { total: number; balance: number }>();
    for (const { doc, status } of filtered) {
      if (status === 'void') continue;
      const entry = map.get(doc.currency) ?? { total: 0, balance: 0 };
      entry.total += doc.totals.total;
      if ((type === 'invoice' || type === 'bill') && status !== 'draft')
        entry.balance += doc.totals.balance;
      map.set(doc.currency, entry);
    }
    return [...map.entries()];
  }, [filtered, type]);

  const exportCsv = () => {
    downloadCsv(
      `${labels.plural.toLowerCase().replace(/\s+/g, '-')}-${today()}`,
      [
        'Number',
        'Status',
        party,
        'Issue date',
        type === 'quote' ? 'Valid until' : 'Due date',
        purchase ? 'Vendor reference' : 'PO',
        'Currency',
        'Subtotal',
        'Discount',
        'Tax',
        'Total',
        'Paid',
        'Balance',
      ],
      filtered.map(({ doc, client, status }) => [
        doc.number,
        status,
        client?.name ?? '',
        doc.issueDate,
        doc.dueDate ?? '',
        purchase ? (doc.vendorReference ?? '') : doc.poNumber,
        doc.currency,
        doc.totals.subtotal,
        doc.totals.discount,
        doc.totals.taxTotal,
        doc.totals.total,
        doc.totals.paid,
        doc.totals.balance,
      ]),
    );
  };

  if (!rows) return <Spinner className="py-24" label="Loading…" />;

  return (
    <div>
      <PageHeader
        title={labels.plural}
        description={DESCRIPTIONS[type]}
        actions={
          <>
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> Export CSV
              </Button>
            ) : null}
            <ButtonLink to={`${base}/new`}>
              <Plus /> New {labels.singular.toLowerCase()}
            </ButtonLink>
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ICONS[type]}
            title={`No ${labels.plural.toLowerCase()} yet`}
            description={`Create your first ${labels.singular.toLowerCase()} — it only takes a minute.`}
            action={
              <ButtonLink to={`${base}/new`}>
                <Plus /> New {labels.singular.toLowerCase()}
              </ButtonLink>
            }
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
              options={FILTERS[type].map((f) => ({ ...f, count: counts[f.value] }))}
            />
            <div className="relative lg:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  purchase ? 'Search number, vendor, reference…' : 'Search number, client, PO…'
                }
                className="ps-9"
                aria-label={`Search ${labels.plural.toLowerCase()}`}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              Nothing matches these filters.
            </p>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                      <th className="px-5 py-3">Number</th>
                      <th className="px-3 py-3">{party}</th>
                      <th className="px-3 py-3">Date</th>
                      <th className="px-3 py-3">{type === 'quote' ? 'Valid until' : 'Due'}</th>
                      <th className="px-3 py-3 text-end">Total</th>
                      {type !== 'quote' ? (
                        <th className="px-3 py-3 text-end">
                          {type === 'credit' || type === 'vendor_credit' ? 'Remaining' : 'Balance'}
                        </th>
                      ) : null}
                      <th className="px-5 py-3 text-end">Status</th>
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
                            {doc.number || '—'}
                          </Link>
                          {purchase && doc.vendorReference ? (
                            <span className="block text-xs font-normal text-slate-500">
                              {doc.vendorReference}
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-56 truncate px-3 py-3 text-slate-700">
                          {client?.name ?? '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                          {fmt.date(doc.issueDate)}
                        </td>
                        <td
                          className={`px-3 py-3 whitespace-nowrap ${status === 'overdue' ? 'font-medium text-red-600' : 'text-slate-600'}`}
                        >
                          {fmt.date(doc.dueDate) || '—'}
                        </td>
                        <td className="tabular px-3 py-3 text-end font-medium whitespace-nowrap text-slate-900">
                          {fmt.money(doc.totals.total, doc.currency)}
                        </td>
                        {type !== 'quote' ? (
                          <td className="tabular px-3 py-3 text-end whitespace-nowrap text-slate-600">
                            {status === 'void' || status === 'draft'
                              ? '—'
                              : fmt.money(doc.totals.balance, doc.currency)}
                          </td>
                        ) : null}
                        <td className="px-5 py-3 text-end">
                          <StatusBadge status={status} />
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
                        <p className="truncate font-medium text-slate-900">{client?.name ?? '—'}</p>
                        <p className="text-xs text-slate-500">
                          {doc.number} · {fmt.date(doc.issueDate)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="tabular text-sm font-semibold text-slate-900">
                          {fmt.money(doc.totals.total, doc.currency)}
                        </span>
                        <StatusBadge status={status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {filtered.length}{' '}
                  {filtered.length === 1
                    ? labels.singular.toLowerCase()
                    : labels.plural.toLowerCase()}
                </span>
                <span className="tabular flex flex-wrap gap-x-4">
                  {totalsByCurrency.map(([currency, t]) => (
                    <span key={currency}>
                      Total{' '}
                      <strong className="text-slate-900">{fmt.money(t.total, currency)}</strong>
                      {type === 'invoice' ? (
                        <>
                          {' '}
                          · Outstanding{' '}
                          <strong className="text-slate-900">
                            {fmt.money(t.balance, currency)}
                          </strong>
                        </>
                      ) : null}
                    </span>
                  ))}
                </span>
              </div>
              {filtered.length > limit ? (
                <div className="border-t border-slate-100 p-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 100)}>
                    Show more ({filtered.length - limit} remaining)
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
