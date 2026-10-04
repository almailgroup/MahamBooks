import { Fragment, useMemo, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  Ban,
  CircleCheck,
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
import { returnedCheques } from '@/db/cheques';
import { setCreditHold } from '@/db/credit';
import { heldRetention } from '@/db/retention';
import type { DocumentType, InvoiceDocument, Payment } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES, useCompany, useFormat } from '@/app/company';
import { CONTACT_COPY, type ContactKind } from '@/features/clients/contact-kind';
import { ContactSummary } from '@/features/clients/contact-summary';
import { RetentionPanel } from '@/features/clients/retention-panel';
import { StatementPanel } from '@/features/statements/statement-panel';
import { formatAddressLines, isAddressEmpty } from '@/lib/geo';
import { CHEQUE_STATUS_META, displayStatus } from '@/lib/status';
import { contactPosition } from '@/lib/statements';
import { contactRetention, retentionKindLabel } from '@/lib/retention';
import { daysBetween, today } from '@/lib/dates';
import { isPosted } from '@/lib/accounting/ledger';
import { t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { taxIdLabel } from '@/features/company/taxes';
import { Button, ButtonLink } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Segmented,
  Spinner,
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

type Tab = 'overview' | 'documents' | 'payments' | 'statement' | 'retentions';

/** Document types listed on each kind of contact, in this order. */
const DOC_TYPES: Record<ContactKind, DocumentType[]> = {
  customer: ['invoice', 'quote', 'credit', 'proforma', 'sales_order', 'delivery_note'],
  vendor: ['bill', 'vendor_credit', 'purchase_order'],
};

/**
 * An address, one line under the other: each line keeps its own direction
 * ("5 Mill Lane" stays in order on an Arabic page) and the block its side.
 */
function AddressLines({ lines }: { lines: string[] }) {
  return (
    <p>
      {lines.map((line, i) => (
        <span key={i} className="block">
          <bdi>{line}</bdi>
        </span>
      ))}
    </p>
  );
}

function DocumentRow({ doc, now }: { doc: InvoiceDocument; now: string }) {
  const fmt = useFormat();
  const priced = doc.type !== 'delivery_note';
  const held = doc.totals.retention ? heldRetention(doc) : 0;
  const open = isPosted(doc) && doc.totals.balance > 0;
  return (
    <li>
      <Link
        to={`${DOCUMENT_ROUTES[doc.type]}/${doc.id}`}
        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">
            {/* Isolated, so two Latin numbers don't run together in Arabic. */}
            <bdi>{doc.number}</bdi>
            {doc.vendorReference ? (
              <bdi className="ms-2 font-normal text-slate-500">{doc.vendorReference}</bdi>
            ) : null}
          </span>
          <span className="text-xs text-slate-500">
            {[
              t(DOCUMENT_LABELS[doc.type].singular),
              fmt.date(doc.issueDate),
              doc.dueDate && open ? t('Due {date}', { date: fmt.date(doc.dueDate) }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          {priced ? (
            <span className="tabular text-end text-sm font-semibold text-slate-900">
              {fmt.money(open ? doc.totals.balance : doc.totals.total, doc.currency)}
              {open && doc.totals.balance !== doc.totals.total ? (
                <span className="block text-xs font-normal text-slate-500">
                  {t('of {amount}', { amount: fmt.money(doc.totals.total, doc.currency) })}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            {held > 0 ? (
              <Badge tone="violet">
                {t('{amount} held', { amount: fmt.money(held, doc.currency) })}
              </Badge>
            ) : null}
            <StatusBadge status={displayStatus(doc, now)} />
          </span>
        </span>
      </Link>
    </li>
  );
}

function PaymentRow({ payment, href, out }: { payment: Payment; href: string; out: boolean }) {
  const fmt = useFormat();
  const cheque = payment.method === 'cheque' ? payment.cheque : null;
  const status = cheque ? CHEQUE_STATUS_META[cheque.status] : null;
  return (
    <li>
      <Link
        to={href}
        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">
            {payment.number} · {fmt.date(payment.date)}
          </span>
          <span className="text-xs text-slate-500">
            {paymentMethodLabel(payment.method)}
            {cheque ? ` ${cheque.number}` : payment.reference ? ` · ${payment.reference}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {status && (cheque?.status !== 'cleared' || payment.voided) ? (
            <Badge tone={status.tone}>{t(status.label)}</Badge>
          ) : null}
          <span
            className={
              payment.voided
                ? 'tabular text-sm text-slate-500 line-through'
                : out
                  ? 'tabular text-sm font-semibold text-slate-900'
                  : 'tabular text-sm font-semibold text-emerald-700'
            }
          >
            {fmt.money(payment.amount, payment.currency)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Detail({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}

export default function ClientDetailPage({ kind = 'customer' }: { kind?: ContactKind }) {
  const copy = CONTACT_COPY[kind];
  const vendorView = kind === 'vendor';
  const side = vendorView ? 'vendor' : 'customer';
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();

  const client = useLiveQuery(() => db.clients.get(id), [id]);
  const docs = useLiveQuery(() => db.documents.where('clientId').equals(id).toArray(), [id]);
  const allPayments = useLiveQuery(() => db.payments.where('clientId').equals(id).toArray(), [id]);
  const expenses = useLiveQuery(() => db.expenses.where('vendorId').equals(id).toArray(), [id]);
  const returned = useLiveQuery(() => returnedCheques(id), [id]);
  const payments = useMemo(
    () =>
      allPayments?.filter(
        (p) => (p.direction === 'out') === vendorView && p.method !== 'credit_note',
      ),
    [allPayments, vendorView],
  );

  const position = useMemo(
    () =>
      client && docs && allPayments
        ? contactPosition({
            side,
            client,
            documents: docs,
            payments: allPayments,
            companyCurrency: company.currency,
            todayIso: today(),
          })
        : null,
    [client, docs, allPayments, side, company.currency],
  );

  if (client === undefined || !docs || !payments || !allPayments || !expenses || !position) {
    return <Spinner className="py-24" label={t('Loading…')} />;
  }
  if (!client || client.companyId !== company.id) {
    return (
      <Card className="p-10 text-center">
        <p className="text-slate-600">{t(copy.notFound)}</p>
        <Link to={copy.base} className="text-primary-700 mt-4 inline-block text-sm font-medium">
          {t(copy.back)}
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
  const types = DOC_TYPES[kind];
  const ownDocs = docs.filter((d) => types.includes(d.type));
  const showRetentions =
    contactRetention(client) > 0 ||
    (client.clearanceCertificates ?? []).length > 0 ||
    ownDocs.some((d) => (d.totals.retention ?? 0) > 0);
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'documents', label: t('Documents'), count: ownDocs.length },
    { value: 'payments', label: t('Payments'), count: payments.length },
    { value: 'statement', label: t('Statement') },
    ...(showRetentions ? [{ value: 'retentions' as const, label: t('Retentions') }] : []),
  ];
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some((x) => x.value === requested) ? requested! : 'overview';
  const setTab = (next: Tab) =>
    setParams(
      (p) => {
        if (next === 'overview') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  const docFilter = (params.get('type') as DocumentType | null) ?? types[0];
  const shownType = types.includes(docFilter) ? docFilter : types[0];
  const listFilter = params.get('list') === 'expenses' && vendorView ? 'expenses' : 'payments';

  const otherKind: ContactKind | null = vendorView
    ? isCustomer(client)
      ? 'customer'
      : null
    : isVendor(client)
      ? 'vendor'
      : null;
  const paymentsBase = vendorView ? '/payments-made' : '/payments';
  const editHref = `${copy.base}/${client.id}/edit`;
  const currency = client.currency ?? company.currency;
  const returnedCount = returned?.length ?? 0;

  const toggleArchive = async () => {
    await saveClient({ ...client, archived: !client.archived });
    toast.success(client.archived ? t(copy.restored) : t(copy.archived));
  };

  const toggleHold = async () => {
    const hold = !client.creditHold;
    if (hold) {
      const ok = await confirm({
        title: t('Put {name} on credit hold?', { name: client.name }),
        description: t(
          'New invoices and sales orders for them need an override until the hold is lifted.',
        ),
        confirmLabel: t('Put on hold'),
        danger: true,
      });
      if (!ok) return;
    }
    await setCreditHold(client.id, hold);
    toast.success(hold ? t('Credit hold on') : t('Credit hold lifted'));
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Delete {name}?', { name: client.name }),
      description: t(
        'This cannot be undone. Contacts with documents, payments or expenses can only be archived.',
      ),
      confirmLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteClient(client.id);
      toast.success(t(copy.deleted));
      navigate(copy.base);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(copy.deleteError));
    }
  };

  const address = formatAddressLines(client.address, fmt.locale);
  const shipping =
    client.shippingAddress && !isAddressEmpty(client.shippingAddress)
      ? formatAddressLines(client.shippingAddress, fmt.locale)
      : [];
  const mainType = copy.docType;
  const open = docs
    .filter((d) => d.type === mainType && isPosted(d) && d.totals.balance > 0)
    .sort((a, b) => (a.dueDate ?? a.issueDate).localeCompare(b.dueDate ?? b.issueDate));
  const recent = [...ownDocs]
    .sort(
      (a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 5);
  const percent = contactRetention(client);

  const details = (
    <Card>
      <CardHeader
        title={t('Details')}
        actions={
          <ButtonLink to={editHref} variant="ghost" size="sm">
            <Pencil /> {t('Edit')}
          </ButtonLink>
        }
      />
      <CardBody className="space-y-5 text-sm">
        {client.contacts.length > 0 ? (
          <div className="space-y-3">
            {client.contacts.map((c) => (
              <div key={c.id}>
                <p className="font-medium text-slate-800">
                  {c.name || t('Contact person')}
                  {c.primary && client.contacts.length > 1 ? (
                    <span className="ms-2 text-xs font-normal text-slate-500">
                      {t('Primary contact')}
                    </span>
                  ) : null}
                </p>
                {c.email ? (
                  <a
                    href={`mailto:${c.email}`}
                    className="text-primary-700 flex items-center gap-1.5 hover:underline"
                  >
                    <Mail className="size-3.5" aria-hidden /> <span dir="ltr">{c.email}</span>
                  </a>
                ) : null}
                {c.phone ? (
                  <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-slate-600">
                    <Phone className="size-3.5" aria-hidden /> <span dir="ltr">{c.phone}</span>
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {address.length ? (
          <Detail label={vendorView ? t('Address') : t('Billing address')}>
            <AddressLines lines={address} />
          </Detail>
        ) : null}
        {shipping.length ? (
          <Detail label={t('Shipping address')}>
            <AddressLines lines={shipping} />
          </Detail>
        ) : null}
        {client.taxId ? <Detail label={taxIdLabel(company)}>{client.taxId}</Detail> : null}
        {client.civilId ? (
          <Detail label={t('Civil ID')}>
            <span dir="ltr">{client.civilId}</span>
          </Detail>
        ) : null}
        <Detail label={t('Payment terms')}>
          {tp(
            client.paymentTermsDays ?? company.defaults.paymentTermsDays,
            '{count} day',
            '{count} days',
          )}
        </Detail>
        {!vendorView ? (
          <Detail label={t('Credit limit')}>
            {client.creditLimit !== null && client.creditLimit !== undefined
              ? fmt.money(client.creditLimit)
              : t('No credit limit')}
          </Detail>
        ) : null}
        {percent ? (
          <Detail label={t('Retention')}>
            {t('{kind} of {percent}', {
              kind: t(retentionKindLabel(client.retentionKind)),
              percent: fmt.percent(percent),
            })}
          </Detail>
        ) : null}
        {client.notes ? (
          <p
            dir="auto"
            className="rounded-md bg-amber-50 p-3 text-xs whitespace-pre-line text-amber-900"
          >
            {client.notes}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );

  const docList = (list: InvoiceDocument[]) => (
    <ul className="divide-y divide-slate-100">
      {list.map((d) => (
        <DocumentRow key={d.id} doc={d} now={now} />
      ))}
    </ul>
  );

  let body: ReactNode;
  if (tab === 'overview') {
    body = (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title={vendorView ? t('Open bills') : t('Open invoices')}
              description={
                open.length
                  ? tp(
                      open.length,
                      '{count} document still to pay',
                      '{count} documents still to pay',
                    )
                  : undefined
              }
            />
            {open.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">{t('Nothing is due.')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {open.map((d) => {
                  const late = d.dueDate ? daysBetween(d.dueDate, now) : 0;
                  return (
                    <li key={d.id}>
                      <Link
                        to={`${DOCUMENT_ROUTES[d.type]}/${d.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">
                            {d.number}
                          </span>
                          <span className="text-xs text-slate-500">
                            {d.dueDate
                              ? t('Due {date}', { date: fmt.date(d.dueDate) })
                              : fmt.date(d.issueDate)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {late > 0 ? (
                            <Badge tone="red">
                              {tp(late, '{count} day late', '{count} days late')}
                            </Badge>
                          ) : null}
                          <span className="tabular text-sm font-semibold text-slate-900">
                            {fmt.money(d.totals.balance, d.currency)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader
              title={t('Recent documents')}
              actions={
                ownDocs.length > recent.length ? (
                  <Button variant="ghost" size="sm" onClick={() => setTab('documents')}>
                    {t('View all')}
                  </Button>
                ) : null
              }
            />
            {recent.length === 0 ? (
              <EmptyState
                className="py-10"
                title={t('No documents yet')}
                description={
                  vendorView
                    ? t('Bills from this vendor show here.')
                    : t('Quotes, invoices and credit notes for this client show here.')
                }
              />
            ) : (
              docList(recent)
            )}
          </Card>
        </div>
        {details}
      </div>
    );
  } else if (tab === 'documents') {
    const listed = docs
      .filter((d) => d.type === shownType)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
    body = (
      <Card>
        <div className="border-b border-slate-100 p-4">
          <Segmented
            size="sm"
            value={shownType}
            onChange={(type) =>
              setParams(
                (p) => {
                  p.set('type', type);
                  return p;
                },
                { replace: true },
              )
            }
            options={types.map((type) => ({
              value: type,
              label: t(DOCUMENT_LABELS[type].plural),
              count: docs.filter((d) => d.type === type).length,
            }))}
          />
        </div>
        {listed.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            {t('Nothing here yet.')}{' '}
            <Link
              to={`${DOCUMENT_ROUTES[shownType]}/new?client=${client.id}`}
              className="text-primary-700 font-medium"
            >
              {t('Create one')}
            </Link>
          </div>
        ) : (
          docList(listed)
        )}
      </Card>
    );
  } else if (tab === 'payments') {
    body = (
      <Card>
        {vendorView ? (
          <div className="border-b border-slate-100 p-4">
            <Segmented
              size="sm"
              value={listFilter}
              onChange={(list) =>
                setParams(
                  (p) => {
                    p.set('list', list);
                    return p;
                  },
                  { replace: true },
                )
              }
              options={[
                { value: 'payments', label: t('Payments'), count: payments.length },
                { value: 'expenses', label: t('Expenses'), count: expenses.length },
              ]}
            />
          </div>
        ) : null}
        {listFilter === 'expenses' ? (
          expenses.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">{t('No expenses yet.')}</p>
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
                      <span className="min-w-0">
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
        ) : payments.length === 0 ? (
          <EmptyState
            className="py-10"
            title={t('No payments yet.')}
            action={
              <ButtonLink
                to={`${paymentsBase}/new?client=${client.id}`}
                size="sm"
                variant="outline"
              >
                <Plus /> {t('Record payment')}
              </ButtonLink>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...payments]
              .sort(
                (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
              )
              .map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  href={`${paymentsBase}/${p.id}`}
                  out={vendorView}
                />
              ))}
          </ul>
        )}
      </Card>
    );
  } else if (tab === 'statement') {
    body = (
      <Card>
        <CardBody>
          <StatementPanel
            key={client.id}
            client={client}
            side={side}
            documents={docs}
            payments={allPayments}
          />
        </CardBody>
      </Card>
    );
  } else {
    body = (
      <RetentionPanel
        key={client.id}
        client={client}
        side={side}
        documents={docs}
        editHref={editHref}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-slate-500">
            <Link to={copy.base} className="hover:text-slate-700">
              {t(copy.title)}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              <bdi>{localName(client)}</bdi>
            </h1>
            {client.archived ? <Badge tone="slate">{t('Archived')}</Badge> : null}
            {client.creditHold && !vendorView ? (
              <Badge tone="red">{t('On credit hold')}</Badge>
            ) : null}
            {returnedCount > 0 && !vendorView ? (
              <button type="button" onClick={() => setTab('payments')} className="rounded-full">
                <Badge tone="red">
                  {tp(returnedCount, '{count} returned cheque', '{count} returned cheques')}
                </Badge>
              </button>
            ) : null}
            {percent ? (
              <Badge tone="violet">
                {t('{percent} retention', { percent: fmt.percent(percent) })}
              </Badge>
            ) : null}
            {client.taxExempt ? <Badge tone="amber">{t('Tax exempt')}</Badge> : null}
            {client.currency ? <Badge tone="blue">{client.currency}</Badge> : null}
            {otherKind ? (
              <Link to={`${CONTACT_COPY[otherKind].base}/${client.id}`}>
                <Badge tone="violet">{t(copy.alsoOther)}</Badge>
              </Link>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {/* The other name: English under an Arabic one, and the other way round. */}
            {[localName(client) === client.name ? client.nameAr : client.name, client.number]
              .filter(Boolean)
              .map((part, i) => (
                <Fragment key={i}>
                  {i > 0 ? ' · ' : null}
                  <bdi>{part}</bdi>
                </Fragment>
              ))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {vendorView ? (
            <ButtonLink to={`/bills/new?client=${client.id}`}>
              <Plus /> {t('New bill')}
            </ButtonLink>
          ) : (
            <>
              <ButtonLink to={`/quotes/new?client=${client.id}`} variant="outline">
                {t('New quote')}
              </ButtonLink>
              <ButtonLink to={`/invoices/new?client=${client.id}`}>
                <Plus /> {t('New invoice')}
              </ButtonLink>
            </>
          )}
          <Button variant="outline" onClick={() => navigate(editHref)}>
            <Pencil /> {t('Edit')}
          </Button>
          <DropdownMenu>
            <DropdownTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('More actions')}>
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
                {vendorView ? t('New vendor credit') : t('New credit note')}
              </DropdownItem>
              {!vendorView ? (
                <DropdownItem
                  icon={<Plus />}
                  onSelect={() => navigate(`/sales-orders/new?client=${client.id}`)}
                >
                  {t('New sales order')}
                </DropdownItem>
              ) : null}
              <DropdownItem
                icon={<Plus />}
                onSelect={() => navigate(`${paymentsBase}/new?client=${client.id}`)}
              >
                {t('Record payment')}
              </DropdownItem>
              {vendorView ? (
                <DropdownItem
                  icon={<Plus />}
                  onSelect={() => navigate(`/expenses?new=1&vendor=${client.id}`)}
                >
                  {t('Record expense')}
                </DropdownItem>
              ) : (
                <DropdownItem
                  icon={client.creditHold ? <CircleCheck /> : <Ban />}
                  onSelect={() => void toggleHold()}
                >
                  {client.creditHold ? t('Lift credit hold') : t('Put on credit hold')}
                </DropdownItem>
              )}
              <DropdownSeparator />
              <DropdownItem
                icon={client.archived ? <ArchiveRestore /> : <Archive />}
                onSelect={() => void toggleArchive()}
              >
                {client.archived ? t('Restore') : t('Archive')}
              </DropdownItem>
              <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
                {t('Delete')}
              </DropdownItem>
            </DropdownContent>
          </DropdownMenu>
        </div>
      </div>

      <ContactSummary
        side={side}
        position={position}
        currency={company.currency}
        onHold={Boolean(client.creditHold)}
        paymentsHref={paymentsBase}
      />
      {currency !== company.currency ? (
        <p className="-mt-3 text-xs text-slate-500">
          {t('Amounts in {currency}, at each document’s exchange rate.', {
            currency: company.currency,
          })}
        </p>
      ) : null}

      <div role="group" aria-label={t('Sections')} className="max-w-full">
        <Segmented value={tab} onChange={setTab} options={tabs} />
      </div>
      {body}
    </div>
  );
}
