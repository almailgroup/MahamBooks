import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock, Plus } from 'lucide-react';
import { db } from '@/db/db';
import type { Client, InvoiceDocument } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import { ButtonLink } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Spinner } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { useReadOnly } from '@/components/ui/read-only';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { msg, t, tp } from '@/i18n';
import {
  followUps,
  pipelineQuotes,
  stageOf,
  summarize,
  type Stage,
  type StageSummary,
} from '../lib/pipeline';

/**
 * Maham CRM's pipeline: the company's quotes as deals, from draft to won or
 * lost, and the ones waiting too long for an answer. Quotes are made and
 * changed on their own pages, as in Maham Books.
 */

const STAGE_LABELS: Record<Stage, string> = {
  draft: msg('Draft'),
  open: msg('Waiting for an answer'),
  won: msg('Won'),
  lost: msg('Lost'),
};

/** Literal class names, so Tailwind and the theme check see every one. */
const STAGE_TONES: Record<Stage, string> = {
  draft: 'bg-slate-400',
  open: 'bg-sky-500',
  won: 'bg-emerald-500',
  lost: 'bg-red-400',
};

/** Quotes listed per stage before "and N more". */
const PER_STAGE = 6;

export default function PipelinePage() {
  const company = useCompany();
  const fmt = useFormat();
  const { readOnly } = useReadOnly();
  const now = today();
  const docs = useLiveQuery(
    () =>
      db.documents
        .where('companyId')
        .equals(company.id)
        .filter((d) => d.type === 'quote')
        .toArray(),
    [company.id],
  );
  const clients = useLiveQuery(
    () => db.clients.where('companyId').equals(company.id).toArray(),
    [company.id],
  );

  const data = useMemo(() => {
    if (!docs || !clients) return null;
    const quotes = pipelineQuotes(docs).sort(
      (a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number),
    );
    return {
      quotes,
      summary: summarize(quotes, company.currency, now),
      followUps: followUps(quotes, now),
      clients: new Map<string, Client>(clients.map((c) => [c.id, c])),
    };
  }, [docs, clients, company.currency, now]);

  if (!data) return <Spinner className="py-24" label={t('Loading…')} />;
  const name = (id: string) => localName(data.clients.get(id)) || '—';
  const open = data.summary.stages.find((s) => s.stage === 'open')!;
  // The count, and the quotes in other currencies the amount leaves out.
  const quotesHint = (stage: StageSummary) =>
    [
      tp(stage.count, '{count} quote', '{count} quotes'),
      stage.foreign
        ? tp(stage.foreign, '+ {count} in another currency', '+ {count} in other currencies')
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const won = data.summary.stages.find((s) => s.stage === 'won')!;

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title={t('Pipeline')}
        description={t('Your quotes, from draft to won.')}
        actions={
          readOnly ? null : (
            <ButtonLink to="/quotes/new">
              <Plus /> {t('New quote')}
            </ButtonLink>
          )
        }
      />

      <section
        aria-label={t('Key figures')}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
      >
        <Figure label={t('Open quotes')} hint={quotesHint(open)}>
          <MoneyText amount={open.value} />
        </Figure>
        <Figure label={t('Won')} hint={quotesHint(won)}>
          <MoneyText amount={won.value} />
        </Figure>
        <Figure label={t('Win rate')} hint={t('Last 12 months')}>
          {data.summary.winRate === null ? '—' : fmt.percent(data.summary.winRate)}
        </Figure>
        <Figure
          label={t('To follow up')}
          hint={tp(7, 'Sent {count} day ago or more', 'Sent {count} days ago or more')}
        >
          {fmt.quantity(data.followUps.length)}
        </Figure>
      </section>

      {data.followUps.length ? (
        <Card>
          <CardHeader title={t('To follow up')} />
          <ul className="divide-y divide-slate-100 px-5 py-1">
            {data.followUps.slice(0, 8).map(({ quote, days, expired }) => (
              <li key={quote.id}>
                <Link
                  to={`/quotes/${quote.id}`}
                  className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <Clock
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        expired ? 'text-red-600' : 'text-amber-600',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span
                        dir="auto"
                        className="block truncate text-sm font-medium text-slate-800"
                      >
                        {quote.number} · {name(quote.clientId)}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {expired
                          ? t('Expired on {date}', { date: fmt.date(quote.dueDate) })
                          : tp(days, 'Sent {count} day ago', 'Sent {count} days ago')}
                      </span>
                    </span>
                  </span>
                  <MoneyText
                    amount={quote.totals.total}
                    currency={quote.currency}
                    className="shrink-0 text-sm font-medium"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.summary.stages.map((stage) => {
          const list = data.quotes.filter((q) => stageOf(q) === stage.stage);
          return (
            <section
              key={stage.stage}
              aria-label={t(STAGE_LABELS[stage.stage])}
              className="flex min-w-0 flex-col rounded-xl bg-slate-50 p-3 ring-1 ring-slate-900/5"
            >
              <header className="mb-2 flex items-center gap-2 px-1">
                <span className={cn('size-2 rounded-full', STAGE_TONES[stage.stage])} aria-hidden />
                <h2 className="flex-1 truncate text-sm font-semibold text-slate-800">
                  {t(STAGE_LABELS[stage.stage])}
                </h2>
                <Badge>{fmt.quantity(stage.count)}</Badge>
              </header>
              <p className="mb-2 px-1 text-xs text-slate-500">
                <MoneyText amount={stage.value} />
                {stage.foreign ? (
                  <span className="block">
                    {tp(
                      stage.foreign,
                      '+ {count} in another currency',
                      '+ {count} in other currencies',
                    )}
                  </span>
                ) : null}
              </p>
              {list.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-slate-400">{t('None')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.slice(0, PER_STAGE).map((q) => (
                    <DealCard key={q.id} quote={q} client={name(q.clientId)} />
                  ))}
                </ul>
              )}
              {list.length > PER_STAGE ? (
                <Link
                  to="/quotes"
                  className="text-primary-700 mt-2 px-1 text-xs font-medium hover:underline"
                >
                  {tp(list.length - PER_STAGE, 'And {count} more.', 'And {count} more.')}
                </Link>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({ quote, client }: { quote: InvoiceDocument; client: string }) {
  const fmt = useFormat();
  return (
    <li>
      <Link
        to={`/quotes/${quote.id}`}
        className="bg-surface block rounded-lg p-3 shadow-xs ring-1 ring-slate-900/5 hover:ring-slate-900/15"
      >
        <span dir="auto" className="block truncate text-sm font-medium text-slate-900">
          {client}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">
          {quote.number} · {fmt.date(quote.issueDate)}
        </span>
        <span className="mt-1 block text-sm font-medium text-slate-800">
          <MoneyText amount={quote.totals.total} currency={quote.currency} />
        </span>
      </Link>
    </li>
  );
}

function Figure({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="bg-surface flex min-w-0 flex-col rounded-xl border border-slate-200 p-3.5 shadow-xs sm:p-5">
      <span className="truncate text-xs font-medium text-slate-500 sm:text-sm">{label}</span>
      <span className="mt-2 block text-lg font-semibold tracking-tight text-slate-900 sm:text-2xl">
        {children}
      </span>
      <span className="mt-1 truncate text-xs text-slate-500">{hint}</span>
    </div>
  );
}
