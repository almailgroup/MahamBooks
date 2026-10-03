import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Plus, Search } from 'lucide-react';
import { db } from '@/db/db';
import { isCustomer, isVendor } from '@/db/purchases';
import { useCompany, useFormat } from '@/app/company';
import { countryName } from '@/lib/geo';
import { downloadCsv } from '@/lib/csv';
import { displayStatus } from '@/lib/status';
import { today } from '@/lib/dates';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import { CONTACT_COPY, type ContactKind } from '@/features/clients/contact-kind';

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

  const rows = useMemo(() => {
    if (!clients || !docs) return null;
    const now = today();
    const stats = new Map<
      string,
      { invoiced: number; balance: number; overdue: boolean; count: number }
    >();
    for (const d of docs) {
      if (d.status === 'draft' || d.status === 'void') continue;
      const s = stats.get(d.clientId) ?? { invoiced: 0, balance: 0, overdue: false, count: 0 };
      s.count += 1;
      if (d.currency === (clients.find((c) => c.id === d.clientId)?.currency ?? company.currency)) {
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
        stats: stats.get(c.id) ?? { invoiced: 0, balance: 0, overdue: false, count: 0 },
      }))
      .sort((a, b) => a.client.name.localeCompare(b.client.name));
  }, [clients, docs, company.currency, kind]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter(
      ({ client }) =>
        (view === 'archived' ? client.archived : !client.archived) &&
        (!q ||
          `${client.name} ${client.number} ${client.email} ${client.contacts.map((c) => `${c.name} ${c.email}`).join(' ')} ${client.address.city}`
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, query, view]);

  if (!rows) return <Spinner className="py-24" label="Loading…" />;

  const archivedCount = rows.filter((r) => r.client.archived).length;

  const exportCsv = () =>
    downloadCsv(
      `${copy.plural}-${today()}`,
      [
        'Number',
        'Name',
        'Contact',
        'Email',
        'Phone',
        'Address',
        'City',
        'Postal code',
        'Country',
        'Tax ID',
        'Currency',
        copy.amountLabel,
        'Outstanding',
      ],
      filtered.map(({ client, stats }) => {
        const contact = client.contacts.find((c) => c.primary) ?? client.contacts[0];
        return [
          client.number,
          client.name,
          contact?.name ?? '',
          contact?.email || client.email,
          client.phone || contact?.phone || '',
          [client.address.line1, client.address.line2].filter(Boolean).join(', '),
          client.address.city,
          client.address.postalCode,
          client.address.country,
          client.taxId,
          client.currency ?? company.currency,
          stats.invoiced,
          stats.balance,
        ];
      }),
    );

  return (
    <div>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <>
            {rows.length > 0 ? (
              <Button variant="outline" onClick={exportCsv}>
                <Download /> Export CSV
              </Button>
            ) : null}
            <ButtonLink to={`${copy.base}/new`}>
              <Plus /> New {copy.singular}
            </ButtonLink>
          </>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={copy.icon}
            title={`No ${copy.plural} yet`}
            description={copy.empty}
            action={
              <ButtonLink to={`${copy.base}/new`}>
                <Plus /> New {copy.singular}
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
                { value: 'active', label: 'Active', count: rows.length - archivedCount },
                { value: 'archived', label: 'Archived', count: archivedCount },
              ]}
            />
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${copy.plural}…`}
                className="ps-9"
                aria-label={`Search ${copy.plural}`}
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">No {copy.plural} match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-start text-xs font-medium tracking-wide text-slate-500 uppercase">
                    <th className="px-5 py-3">{copy.column}</th>
                    <th className="hidden px-3 py-3 md:table-cell">Contact</th>
                    <th className="hidden px-3 py-3 lg:table-cell">Location</th>
                    <th className="px-3 py-3 text-end">{copy.amountLabel}</th>
                    <th className="px-5 py-3 text-end">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(({ client, stats }) => {
                    const contact = client.contacts.find((c) => c.primary) ?? client.contacts[0];
                    const currency = client.currency ?? company.currency;
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
                            {client.number}
                            {client.currency ? ` · ${client.currency}` : ''}
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
                          {fmt.money(stats.invoiced, currency)}
                        </td>
                        <td className="tabular px-5 py-3 text-end">
                          <span
                            className={
                              stats.balance > 0 ? 'font-medium text-slate-900' : 'text-slate-400'
                            }
                          >
                            {fmt.money(stats.balance, currency)}
                          </span>
                          {stats.overdue ? (
                            <Badge tone="red" className="ms-2">
                              Overdue
                            </Badge>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
