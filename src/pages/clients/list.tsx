import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Plus, Search } from 'lucide-react';
import { db } from '@/db/db';
import { isCustomer, isVendor } from '@/db/purchases';
import type { Client } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { countryName } from '@/lib/geo';
import { downloadCsv } from '@/lib/csv';
import { displayStatus } from '@/lib/status';
import { today } from '@/lib/dates';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import { CONTACT_COPY, type ContactKind } from '@/features/clients/contact-kind';

interface Row {
  client: Client;
  invoiced: number;
  balance: number;
  overdue: boolean;
  count: number;
}

export default function ClientListPage({ kind = 'customer' }: { kind?: ContactKind }) {
  const copy = CONTACT_COPY[kind];
  const company = useCompany();
  const fmt = useFormat();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');

  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const docs = useLiveQuery(
    () => db.documents.where('[companyId+type]').equals([company.id, copy.docType]).toArray(),
    [company.id, copy.docType],
  );

  const rows = useMemo<Row[] | null>(() => {
    if (!clients || !docs) return null;
    const now = today();
    const currencies = new Map(clients.map((c) => [c.id, c.currency ?? company.currency]));
    const stats = new Map<string, Omit<Row, 'client'>>();
    for (const d of docs) {
      if (d.status === 'draft' || d.status === 'void') continue;
      const s = stats.get(d.clientId) ?? { invoiced: 0, balance: 0, overdue: false, count: 0 };
      s.count += 1;
      if (d.currency === currencies.get(d.clientId)) {
        s.invoiced += d.totals.total;
        if (d.status === 'sent' || d.status === 'partial') s.balance += d.totals.balance;
      }
      if (displayStatus(d, now) === 'overdue') s.overdue = true;
      stats.set(d.clientId, s);
    }
    return clients
      .filter((c) => (kind === 'vendor' ? isVendor(c) : isCustomer(c)))
      .map((c) => ({
        client: c,
        ...(stats.get(c.id) ?? { invoiced: 0, balance: 0, overdue: false, count: 0 }),
      }))
      .sort((a, b) => localName(a.client).localeCompare(localName(b.client)));
  }, [clients, docs, company.currency, kind]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      ({ client }) =>
        (view === 'archived' ? client.archived : !client.archived) &&
        (!q ||
          [
            client.name,
            client.nameAr ?? '',
            client.number,
            client.email,
            client.phone,
            client.address.city,
            ...client.contacts.map((c) => `${c.name} ${c.email} ${c.phone}`),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, query, view]);

  if (!rows) return <Spinner className="py-24" label={t('Loading…')} />;

  const archivedCount = rows.filter((r) => r.client.archived).length;
  const currencyOf = (client: Client) => client.currency ?? company.currency;

  const exportCsv = () =>
    downloadCsv(
      `${copy.fileName}-${today()}`,
      [
        t('Number'),
        t('Name'),
        t('Arabic name'),
        t('Contact person'),
        t('Email'),
        t('Phone'),
        t('Address'),
        t('City'),
        t('Postal code'),
        t('Country'),
        t('Tax ID'),
        t('Currency'),
        t('Credit limit'),
        t(copy.amountLabel),
        t(copy.owedLabel),
      ],
      filtered.map(({ client, invoiced, balance }) => {
        const contact = client.contacts.find((c) => c.primary) ?? client.contacts[0];
        return [
          client.number,
          client.name,
          client.nameAr ?? '',
          contact?.name ?? '',
          contact?.email || client.email,
          client.phone || contact?.phone || '',
          [client.address.line1, client.address.line2].filter(Boolean).join(', '),
          client.address.city,
          client.address.postalCode,
          client.address.country,
          client.taxId,
          currencyOf(client),
          client.creditLimit ?? '',
          invoiced,
          balance,
        ];
      }),
    );

  const badges = (row: Row) => (
    <>
      {row.client.creditHold ? <Badge tone="red">{t('On credit hold')}</Badge> : null}
      {row.overdue ? <Badge tone="red">{t('Overdue')}</Badge> : null}
    </>
  );

  return (
    <div>
      <PageHeader
        title={t(copy.title)}
        description={t(copy.description)}
        actions={
          <>
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> {t('Export CSV')}
              </Button>
            ) : null}
            <ButtonLink to={`${copy.base}/new`}>
              <Plus /> {t(copy.newLabel)}
            </ButtonLink>
          </>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={copy.icon}
            title={t(copy.emptyTitle)}
            description={t(copy.empty)}
            action={
              <ButtonLink to={`${copy.base}/new`}>
                <Plus /> {t(copy.newLabel)}
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'active', label: t('Active'), count: rows.length - archivedCount },
                { value: 'archived', label: t('Archived'), count: archivedCount },
              ]}
            />
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(copy.search)}
                className="ps-9"
                aria-label={t(copy.search)}
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">{t(copy.noMatch)}</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs font-medium tracking-wide text-slate-500 uppercase">
                      <th className="px-5 py-3 text-start">{t(copy.column)}</th>
                      <th className="hidden px-3 py-3 text-start md:table-cell">
                        {t('Contact person')}
                      </th>
                      <th className="hidden px-3 py-3 text-start lg:table-cell">{t('Location')}</th>
                      <th className="px-3 py-3 text-end">{t(copy.amountLabel)}</th>
                      <th className="px-5 py-3 text-end">{t(copy.owedLabel)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((row) => {
                      const { client } = row;
                      const contact = client.contacts.find((c) => c.primary) ?? client.contacts[0];
                      return (
                        <tr
                          key={client.id}
                          onClick={() => navigate(`${copy.base}/${client.id}`)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td className="px-5 py-3">
                            <Link
                              to={`${copy.base}/${client.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-primary-700 font-medium text-slate-900"
                            >
                              {client.name}
                            </Link>
                            <span className="block text-xs text-slate-500">
                              {[client.nameAr, client.number, client.currency]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </td>
                          <td className="hidden px-3 py-3 md:table-cell">
                            <span className="block text-slate-700">{contact?.name || '—'}</span>
                            <span className="block text-xs text-slate-500">
                              {contact?.email || client.email}
                            </span>
                          </td>
                          <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                            {[
                              client.address.city,
                              client.address.country
                                ? countryName(client.address.country, fmt.locale)
                                : '',
                            ]
                              .filter(Boolean)
                              .join(', ') || '—'}
                          </td>
                          <td className="tabular px-3 py-3 text-end text-slate-600">
                            {fmt.money(row.invoiced, currencyOf(client))}
                          </td>
                          <td className="tabular px-5 py-3 text-end">
                            <span
                              className={
                                row.balance > 0 ? 'font-medium text-slate-900' : 'text-slate-400'
                              }
                            >
                              {fmt.money(row.balance, currencyOf(client))}
                            </span>
                            <span className="ms-2 inline-flex gap-1">{badges(row)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Phones: one card per contact. */}
              <ul className="divide-y divide-slate-100 sm:hidden">
                {filtered.map((row) => (
                  <li key={row.client.id}>
                    <Link
                      to={`${copy.base}/${row.client.id}`}
                      className="flex items-start justify-between gap-3 px-4 py-3 active:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">
                          {localName(row.client)}
                        </span>
                        <span className="block text-xs text-slate-500">{row.client.number}</span>
                        <span className="mt-1 flex flex-wrap gap-1">{badges(row)}</span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span
                          className={
                            row.balance > 0
                              ? 'tabular block text-sm font-semibold text-slate-900'
                              : 'tabular block text-sm text-slate-400'
                          }
                        >
                          {fmt.money(row.balance, currencyOf(row.client))}
                        </span>
                        <span className="text-xs text-slate-500">{t(copy.owedLabel)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
