import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteClient, saveClient } from '@/db/records';
import { paymentMethodLabel } from '@/db/payments';
import { isCustomer, isVendor } from '@/db/purchases';
import type { DocumentType } from '@/db/types';
import { DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { CONTACT_COPY, type ContactKind } from '@/features/clients/contact-kind';
import { formatAddressLines, isAddressEmpty } from '@/lib/geo';
import { displayStatus } from '@/lib/status';
import { today } from '@/lib/dates';
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Segmented,
  Spinner,
  Stat,
  StatusBadge,
} from '@/components/ui/misc';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';

type Tab = DocumentType | 'payments' | 'expenses';

/** Tabs for each kind: the documents first, then money moved. */
const TABS: Record<ContactKind, { value: Tab; label: string }[]> = {
  customer: [
    { value: 'invoice', label: 'Invoices' },
    { value: 'quote', label: 'Quotes' },
    { value: 'credit', label: 'Credit notes' },
    { value: 'payments', label: 'Payments' },
  ],
  vendor: [
    { value: 'bill', label: 'Bills' },
    { value: 'vendor_credit', label: 'Vendor credits' },
    { value: 'payments', label: 'Payments' },
    { value: 'expenses', label: 'Expenses' },
  ],
};

export default function ClientDetailPage({ kind = 'customer' }: { kind?: ContactKind }) {
  const copy = CONTACT_COPY[kind];
  const vendorView = kind === 'vendor';
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(TABS[kind][0].value);

  const client = useLiveQuery(() => db.clients.get(id), [id]);
  const docs = useLiveQuery(() => db.documents.where('clientId').equals(id).toArray(), [id]);
  const allPayments = useLiveQuery(() => db.payments.where('clientId').equals(id).toArray(), [id]);
  const expenses = useLiveQuery(() => db.expenses.where('vendorId').equals(id).toArray(), [id]);
  const payments = useMemo(
    () => allPayments?.filter((p) => (p.direction === 'out') === vendorView) ?? allPayments,
    [allPayments, vendorView],
  );

  const currency = client?.currency ?? company.currency;
  const stats = useMemo(() => {
    if (!docs) return null;
    const now = today();
    const invoices = docs.filter(
      (d) =>
        d.type === copy.docType &&
        d.status !== 'draft' &&
        d.status !== 'void' &&
        d.currency === currency,
    );
    const creditType = vendorView ? 'vendor_credit' : 'credit';
    const credits = docs.filter(
      (d) =>
        d.type === creditType &&
        (d.status === 'sent' || d.status === 'partial') &&
        d.currency === currency,
    );
    return {
      invoiced: invoices.reduce((s, d) => s + d.totals.total, 0),
      paid: invoices.reduce((s, d) => s + d.totals.paid, 0),
      outstanding: invoices
        .filter((d) => d.status === 'sent' || d.status === 'partial')
        .reduce((s, d) => s + d.totals.balance, 0),
      overdue: invoices
        .filter((d) => displayStatus(d, now) === 'overdue')
        .reduce((s, d) => s + d.totals.balance, 0),
      credit: credits.reduce((s, d) => s + d.totals.balance, 0),
    };
  }, [docs, currency, copy.docType, vendorView]);

  if (client === undefined || !docs || !payments || !expenses)
    return <Spinner className="py-24" label="Loading…" />;
  if (!client || client.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">This {copy.singular} could not be found.</p>
        <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          Back to {copy.plural}
        </Link>
      </Card>
    );
  }

  // A vendor opened from a client link (or the reverse) shows on its own page.
  if (vendorView ? !isVendor(client) && isCustomer(client) : !isCustomer(client)) {
    return (
      <Navigate
        to={`${CONTACT_COPY[vendorView ? 'customer' : 'vendor'].base}/${client.id}`}
        replace
      />
    );
  }

  const now = today();
  const listed =
    tab === 'payments' || tab === 'expenses'
      ? []
      : docs.filter((d) => d.type === tab).sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const count = (value: Tab) =>
    value === 'payments'
      ? payments.length
      : value === 'expenses'
        ? expenses.length
        : docs.filter((d) => d.type === value).length;
  // The same contact can be both; link to the other side when it is.
  const otherKind: ContactKind | null = vendorView
    ? isCustomer(client)
      ? 'customer'
      : null
    : isVendor(client)
      ? 'vendor'
      : null;
  const paymentsBase = vendorView ? '/payments-made' : '/payments';

  const toggleArchive = async () => {
    await saveClient({ ...client, archived: !client.archived });
    toast.success(client.archived ? `${copy.column} restored` : `${copy.column} archived`);
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${client.name}?`,
      description:
        'This cannot be undone. Contacts with documents, payments or expenses can only be archived.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteClient(client.id);
      toast.success(`${copy.column} deleted`);
      navigate(copy.base);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not delete the ${copy.singular}.`,
      );
    }
  };

  const address = formatAddressLines(client.address, fmt.locale);
  const shipping =
    client.shippingAddress && !isAddressEmpty(client.shippingAddress)
      ? formatAddressLines(client.shippingAddress, fmt.locale)
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to={copy.base} className="hover:text-slate-700">
              {copy.title}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{client.name}</h1>
            {client.archived ? <Badge tone="slate">Archived</Badge> : null}
            {client.taxExempt ? <Badge tone="amber">Tax exempt</Badge> : null}
            {client.currency ? <Badge tone="blue">{client.currency}</Badge> : null}
            {otherKind ? (
              <Link to={`${CONTACT_COPY[otherKind].base}/${client.id}`}>
                <Badge tone="violet">Also a {CONTACT_COPY[otherKind].singular}</Badge>
              </Link>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">{client.number}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {vendorView ? (
            <ButtonLink to={`/bills/new?client=${client.id}`}>
              <Plus /> New bill
            </ButtonLink>
          ) : (
            <>
              <ButtonLink to={`/quotes/new?client=${client.id}`} variant="outline">
                New quote
              </ButtonLink>
              <ButtonLink to={`/invoices/new?client=${client.id}`}>
                <Plus /> New invoice
              </ButtonLink>
            </>
          )}
          <Button variant="outline" onClick={() => navigate(`${copy.base}/${client.id}/edit`)}>
            <Pencil /> Edit
          </Button>
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem
                icon={<Plus />}
                onSelect={() =>
                  navigate(`${vendorView ? '/vendor-credits' : '/credits'}/new?client=${client.id}`)
                }
              >
                {vendorView ? 'New vendor credit' : 'New credit note'}
              </DropdownItem>
              <DropdownItem
                icon={<Plus />}
                onSelect={() => navigate(`${paymentsBase}/new?client=${client.id}`)}
              >
                Record payment
              </DropdownItem>
              {vendorView ? (
                <DropdownItem
                  icon={<Plus />}
                  onSelect={() => navigate(`/expenses?new=1&vendor=${client.id}`)}
                >
                  Record expense
                </DropdownItem>
              ) : null}
              <DropdownSeparator />
              <DropdownItem
                icon={client.archived ? <ArchiveRestore /> : <Archive />}
                onSelect={() => void toggleArchive()}
              >
                {client.archived ? 'Restore' : 'Archive'}
              </DropdownItem>
              <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                Delete
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={copy.amountLabel} value={fmt.money(stats.invoiced, currency)} />
          <Stat
            label="Paid"
            value={fmt.money(stats.paid, currency)}
            tone={stats.paid > 0 ? 'success' : 'default'}
          />
          <Stat
            label={vendorView ? 'You owe' : 'Outstanding'}
            value={fmt.money(stats.outstanding, currency)}
          />
          <Stat
            label="Overdue"
            value={fmt.money(stats.overdue, currency)}
            tone={stats.overdue > 0 ? 'danger' : 'default'}
            hint={
              stats.credit > 0 ? `${fmt.money(stats.credit, currency)} unused credit` : undefined
            }
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="border-b border-slate-100 p-4">
            <Segmented
              value={tab}
              onChange={setTab}
              options={TABS[kind].map((t) => ({ ...t, count: count(t.value) }))}
            />
          </div>
          {tab === 'expenses' ? (
            expenses.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">No expenses yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...expenses]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((e) => (
                    <li key={e.id}>
                      <Link
                        to={`/expenses?open=${e.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                      >
                        <span>
                          <span className="block text-sm font-medium text-slate-800">
                            {e.number} · {fmt.date(e.date)}
                          </span>
                          <span className="text-xs text-slate-500">{e.description || '—'}</span>
                        </span>
                        <span className="tabular text-sm font-semibold text-slate-900">
                          {fmt.money(e.amount, e.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )
          ) : tab === 'payments' ? (
            payments.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-slate-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...payments]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`${paymentsBase}/${p.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                      >
                        <span>
                          <span className="block text-sm font-medium text-slate-800">
                            {p.number} · {fmt.date(p.date)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {paymentMethodLabel(p.method)}
                            {p.reference ? ` · ${p.reference}` : ''}
                          </span>
                        </span>
                        <span
                          className={
                            vendorView
                              ? 'tabular text-sm font-semibold text-slate-900'
                              : 'tabular text-sm font-semibold text-emerald-700'
                          }
                        >
                          {fmt.money(p.amount, p.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )
          ) : listed.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Nothing here yet.{' '}
              <Link
                to={`${DOCUMENT_ROUTES[tab]}/new?client=${client.id}`}
                className="text-primary-700 font-medium"
              >
                Create one
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {listed.map((d) => (
                <li key={d.id}>
                  <Link
                    to={`${DOCUMENT_ROUTES[d.type]}/${d.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{d.number}</span>
                      <span className="text-xs text-slate-500">
                        {fmt.date(d.issueDate)}
                        {d.dueDate ? ` · due ${fmt.date(d.dueDate)}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular text-sm font-semibold text-slate-900">
                        {fmt.money(d.totals.total, d.currency)}
                      </span>
                      <StatusBadge status={displayStatus(d, now)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-5 text-sm">
            {client.contacts.length > 0 ? (
              <div className="space-y-3">
                {client.contacts.map((c) => (
                  <div key={c.id}>
                    <p className="font-medium text-slate-800">
                      {c.name || 'Contact'}
                      {c.primary && client.contacts.length > 1 ? (
                        <span className="ms-2 text-xs font-normal text-slate-400">Primary</span>
                      ) : null}
                    </p>
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-primary-700 flex items-center gap-1.5 hover:underline"
                      >
                        <Mail className="size-3.5" /> {c.email}
                      </a>
                    ) : null}
                    {c.phone ? (
                      <a
                        href={`tel:${c.phone}`}
                        className="flex items-center gap-1.5 text-slate-600"
                      >
                        <Phone className="size-3.5" /> {c.phone}
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {address.length ? (
              <div>
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {vendorView ? 'Address' : 'Billing address'}
                </p>
                <p className="whitespace-pre-line text-slate-700">{address.join('\n')}</p>
              </div>
            ) : null}
            {shipping.length ? (
              <div>
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Shipping address
                </p>
                <p className="whitespace-pre-line text-slate-700">{shipping.join('\n')}</p>
              </div>
            ) : null}
            {client.taxId ? (
              <div>
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {company.taxIdLabel || 'Tax ID'}
                </p>
                <p className="text-slate-700">{client.taxId}</p>
              </div>
            ) : null}
            {client.paymentTermsDays !== null ? (
              <div>
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Payment terms
                </p>
                <p className="text-slate-700">{client.paymentTermsDays} days</p>
              </div>
            ) : null}
            {client.notes ? (
              <p className="rounded-md bg-amber-50 p-3 text-xs whitespace-pre-line text-amber-900">
                {client.notes}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
