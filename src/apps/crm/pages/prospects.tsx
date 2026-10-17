import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, UserRoundSearch } from 'lucide-react';
import { db } from '@/db/db';
import { useCompany, useFormat } from '@/app/company';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Input } from '@/components/ui/form';
import { MoneyText } from '@/components/ui/money-text';
import { useReadOnly } from '@/components/ui/read-only';
import { normalizeSearch } from '@/features/search/normalize';
import { toISODate } from '@/lib/dates';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { prospects, type ProspectKind } from '../lib/pipeline';

/**
 * Customers who haven't bought yet: those with a quote waiting, and new ones
 * nothing has been sent to. Once they are invoiced they are customers.
 */

type View = 'all' | ProspectKind;

export default function ProspectsPage() {
  const company = useCompany();
  const fmt = useFormat();
  const { readOnly } = useReadOnly();
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );
  const docs = useLiveQuery(
    () =>
      db.documents
        .where('companyId')
        .equals(company.id)
        .filter((d) => d.type === 'quote' || d.type === 'invoice')
        .toArray(),
    [company.id],
  );
  const list = useMemo(
    () => (clients && docs ? prospects(clients, docs, company.currency) : undefined),
    [clients, docs, company.currency],
  );
  const shown = useMemo(() => {
    if (!list) return [];
    const words = normalizeSearch(query).split(' ').filter(Boolean);
    return list.filter((p) => {
      if (view !== 'all' && p.kind !== view) return false;
      const text = normalizeSearch(
        [p.client.name, p.client.nameAr, p.client.email, p.client.phone].filter(Boolean).join(' '),
      );
      return words.every((w) => text.includes(w));
    });
  }, [list, view, query]);

  if (!list) return <Spinner className="py-24" label={t('Loading…')} />;
  const count = (kind: ProspectKind) => list.filter((p) => p.kind === kind).length;

  return (
    <>
      <PageHeader
        title={t('Prospects')}
        description={t('Customers who haven’t bought from you yet.')}
        actions={
          readOnly ? null : (
            <ButtonLink to="/clients/new">
              <Plus /> {t('New client')}
            </ButtonLink>
          )
        }
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UserRoundSearch />}
            title={t('No prospects')}
            description={t(
              'Every customer has been invoiced. New customers show here until their first invoice.',
            )}
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: t('All'), count: list.length },
                { value: 'quoted', label: t('Quoted'), count: count('quoted') },
                { value: 'contacted', label: t('Quoted before'), count: count('contacted') },
                { value: 'new', label: t('Not contacted'), count: count('new') },
              ]}
            />
            <div className="relative sm:w-64">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search prospects…')}
                aria-label={t('Search prospects')}
                className="ps-9"
              />
            </div>
          </div>
          <Card>
            <ul className="divide-y divide-slate-100">
              {shown.map((p) => (
                <li key={p.client.id}>
                  <Link
                    to={`/clients/${p.client.id}`}
                    className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span
                        dir="auto"
                        className="block truncate text-sm font-medium text-slate-900"
                      >
                        {localName(p.client)}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {p.kind === 'quoted'
                          ? tp(p.openQuotes, '{count} open quote', '{count} open quotes')
                          : p.kind === 'contacted'
                            ? t('No open quote')
                            : t('Added {date}', {
                                date: fmt.date(toISODate(new Date(p.client.createdAt))),
                              })}
                      </span>
                    </span>
                    {p.kind === 'quoted' ? (
                      <span className="shrink-0 text-end text-sm font-medium">
                        {p.openQuotes > p.foreign ? <MoneyText amount={p.openValue} /> : null}
                        {p.foreign ? (
                          <span className="block text-xs font-normal text-slate-500">
                            {tp(
                              p.foreign,
                              '+ {count} in another currency',
                              '+ {count} in other currencies',
                            )}
                          </span>
                        ) : null}
                      </span>
                    ) : p.kind === 'new' ? (
                      <Badge tone="blue">{t('New')}</Badge>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            {shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">
                {t('No one matches your search')}
              </p>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
