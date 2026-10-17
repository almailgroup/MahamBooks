import { useId, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  ExternalLink,
  FileBadge,
  FileText,
  HandCoins,
  Receipt,
  WalletCards,
} from 'lucide-react';
import { db } from '@/db/db';
import type { InvoiceDocument } from '@/db/types';
import { useCompany, useFormat } from '@/app/company';
import {
  TOPIC_LABELS,
  alertLookups,
  type Alert,
  type AlertData,
  type AlertTopic,
} from '@/alerts/collect';
import { describeAlert } from '@/alerts/email';
import { followUps, pipelineQuotes } from '@/apps/crm/lib/pipeline';
import { isCurrent } from '@/lib/hr/employees';
import { displayStatus } from '@/lib/status';
import { sidebarLinks } from '@/lib/links';
import { currencyPrecision, round, sum } from '@/lib/money';
import { today } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { Badge, Card, CardHeader, Spinner } from '@/components/ui/misc';
import { MoneyText } from '@/components/ui/money-text';
import { useRoleView } from '@/features/cloud/role-gates';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { appTitle, visibleApps } from '../apps';
import { useAppAccess } from '../current-app';
import { AppMark, PreviewBadge } from '../switcher';
import type { AppId, SuiteApp } from '../types';
import {
  alertPage,
  homeAlerts,
  homeTopics,
  loadHomeAlertData,
  TOPIC_APPS,
  TOPIC_PAGES,
} from './attention';

/**
 * Maham One's home: the apps the person may open, what needs attention in
 * them today, and the company's other tools. Each app keeps its own
 * dashboard (Maham Books' is at /books).
 */

/** Lines shown before "and N more". */
const MAX_LINES = 8;

const TOPIC_ICONS: Record<AlertTopic, LucideIcon> = {
  documents: FileBadge,
  deadlines: CalendarClock,
  cheques: WalletCards,
  bills: Receipt,
  invoices: FileText,
};

function greeting(hour: number): string {
  if (hour < 12) return t('Good morning');
  if (hour < 18) return t('Good afternoon');
  return t('Good evening');
}

export default function SuiteHome() {
  const company = useCompany();
  const fmt = useFormat();
  const { language } = useLanguage();
  const { known } = useRoleView();
  const access = useAppAccess();
  const apps = visibleApps(access);
  const people = access.people !== 'none';
  const now = today();

  // Nothing is worked out before the role is known: no employee's papers flash up.
  const data = useLiveQuery(
    () => (known ? loadHomeAlertData(company, people) : undefined),
    [company, people, known],
  );
  const quotes = useLiveQuery(
    () =>
      db.documents
        .where('companyId')
        .equals(company.id)
        .filter((d) => d.type === 'quote')
        .toArray(),
    [company.id],
  );

  const alerts = useMemo(
    () => (data ? homeAlerts(data, now, homeTopics(access)) : undefined),
    [data, now, access],
  );

  const stats = useMemo(() => {
    const result: Partial<Record<AppId, string>> = {};
    if (data) {
      const overdue = data.documents.filter(
        (d) => d.type === 'invoice' && displayStatus(d, now) === 'overdue',
      ).length;
      result.books = overdue
        ? tp(overdue, '{count} overdue invoice', '{count} overdue invoices')
        : t('Nothing overdue');
      const staff = data.employees.filter(isCurrent).length;
      result.people = tp(staff, '{count} employee', '{count} employees');
    }
    if (alerts) {
      const due = alerts.filter((a) => TOPIC_APPS[a.topic] === 'compliance').length;
      result.compliance = due
        ? tp(due, '{count} needs attention', '{count} need attention')
        : t('All up to date');
    }
    if (quotes) {
      const waiting = followUps(pipelineQuotes(quotes), now).length;
      result.crm = waiting
        ? tp(waiting, '{count} quote to follow up', '{count} quotes to follow up')
        : t('No follow-ups due');
    }
    return result;
  }, [data, alerts, quotes, now]);

  const appsId = useId();

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {greeting(new Date().getHours())}
        </h1>
        <p className="mt-1 truncate text-sm text-slate-500">
          <span dir="auto">{localName(company)}</span> · {fmt.date(now)}
        </p>
      </header>

      <section aria-labelledby={appsId}>
        <h2 id={appsId} className="mb-3 text-sm font-semibold text-slate-500">
          {t('Your apps')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {apps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              title={appTitle(app, language)}
              viewOnly={access[app.id] === 'view'}
              stat={stats[app.id]}
            />
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title={t('Needs attention')} />
          {alerts && data ? (
            <AttentionList alerts={alerts} data={data} people={people} />
          ) : (
            <Spinner className="py-12" />
          )}
        </Card>
        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          {access.books !== 'none' && data ? <Glance data={data} /> : null}
          <CompanyTools />
        </div>
      </div>
    </div>
  );
}

function AppCard({
  app,
  title,
  viewOnly,
  stat,
}: {
  app: SuiteApp;
  title: string;
  viewOnly: boolean;
  stat: string | undefined;
}) {
  const badgesId = useId();
  const badges = app.preview || viewOnly;
  return (
    <li className="group bg-surface relative flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 p-3 shadow-xs transition-colors hover:border-slate-300 sm:gap-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <AppMark app={app} className="sm:size-12 sm:rounded-2xl sm:[&_svg]:size-6" />
        <span id={badgesId} className="flex flex-wrap justify-end gap-1">
          {app.preview ? <PreviewBadge /> : null}
          {viewOnly ? <Badge>{t('View only')}</Badge> : null}
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 sm:text-base">
          {/* The whole card opens the app; its name is the link's name. */}
          <Link
            to={app.home}
            aria-describedby={badges ? badgesId : undefined}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-[var(--color-primary-500)]"
          >
            {title}
          </Link>
        </h3>
        {/* Phones show two apps a row: names and figures only. */}
        <p className="mt-0.5 hidden text-sm text-slate-500 sm:block">{t(app.description)}</p>
      </div>
      <p className="mt-auto flex min-h-5 items-center gap-1 text-xs font-medium text-slate-600">
        {stat ?? ''}
        <ArrowRight
          className="ms-auto size-4 text-slate-300 transition-colors group-hover:text-slate-500 rtl:rotate-180"
          aria-hidden
        />
      </p>
    </li>
  );
}

function AttentionList({
  alerts,
  data,
  people,
}: {
  alerts: Alert[];
  data: AlertData;
  people: boolean;
}) {
  const fmt = useFormat();
  const lookups = useMemo(() => ({ company: data.company, ...alertLookups(data) }), [data]);
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <CircleCheck className="size-8 text-emerald-600" aria-hidden />
        <p className="mt-3 text-sm font-medium text-slate-900">
          {t('Nothing needs attention right now.')}
        </p>
      </div>
    );
  }
  const counts = new Map<AlertTopic, number>();
  for (const a of alerts) counts.set(a.topic, (counts.get(a.topic) ?? 0) + 1);
  const shown = alerts.slice(0, MAX_LINES);
  return (
    <div className="px-5 pt-3 pb-4">
      <ul className="flex flex-wrap gap-2" aria-label={t('By topic')}>
        {[...counts].map(([topic, count]) => (
          <li key={topic}>
            <Link
              to={TOPIC_PAGES[topic]}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 pointer-coarse:min-h-11"
            >
              {t(TOPIC_LABELS[topic])}
              <span className="tabular text-slate-500">{fmt.quantity(count)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="mt-3 divide-y divide-slate-100">
        {shown.map((alert) => {
          const line = describeAlert(alert, lookups);
          const Icon = TOPIC_ICONS[alert.topic];
          return (
            <li key={alert.key}>
              <Link
                to={alertPage(alert, people)}
                className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-slate-50"
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <Icon
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      line.tone === 'red' ? 'text-red-600' : 'text-amber-600',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span dir="auto" className="block truncate text-sm font-medium text-slate-800">
                      {line.title}
                    </span>
                    <span className="block text-xs text-slate-500">
                      <span className={line.tone === 'red' ? 'text-red-700' : 'text-amber-700'}>
                        {line.status}
                      </span>
                      {line.detail ? ` · ${line.detail}` : ''}
                    </span>
                  </span>
                </span>
                {line.amount ? (
                  <span dir="ltr" className="tabular shrink-0 text-sm font-medium text-slate-800">
                    {line.amount}
                  </span>
                ) : (
                  <ArrowRight
                    className="size-4 shrink-0 text-slate-400 rtl:rotate-180"
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {alerts.length > shown.length ? (
        <p className="mt-2 text-xs text-slate-500">
          {tp(alerts.length - shown.length, 'And {count} more.', 'And {count} more.')}
        </p>
      ) : null}
    </div>
  );
}

/** Money at a glance, in the company's currency. */
function Glance({ data }: { data: AlertData }) {
  const company = useCompany();
  const base = company.currency;
  const precision = currencyPrecision(base);
  const open = (type: InvoiceDocument['type']) =>
    data.documents.filter(
      (d) =>
        d.type === type &&
        (d.status === 'sent' || d.status === 'partial') &&
        d.totals.balance > 0 &&
        d.currency === base,
    );
  const total = (amounts: number[]) => round(sum(amounts), precision);
  // Received cheques not yet taken to the bank.
  const inHand = data.payments.filter(
    (p) => !p.voided && p.direction !== 'out' && p.currency === base && p.cheque?.status === 'held',
  );
  return (
    <Card>
      <CardHeader title={t('At a glance')} />
      <ul className="divide-y divide-slate-100 px-5 py-1">
        <GlanceRow to="/reports/aging" icon={HandCoins} label={t('Owed to you')}>
          <MoneyText amount={total(open('invoice').map((d) => d.totals.balance))} />
        </GlanceRow>
        <GlanceRow to="/bills?status=unpaid" icon={Receipt} label={t('Bills to pay')}>
          <MoneyText amount={total(open('bill').map((d) => d.totals.balance))} />
        </GlanceRow>
        <GlanceRow to="/cheques" icon={WalletCards} label={t('Cheques in hand')}>
          <MoneyText amount={total(inHand.map((p) => p.amount))} />
        </GlanceRow>
      </ul>
    </Card>
  );
}

function GlanceRow({
  to,
  icon: Icon,
  label,
  children,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 hover:bg-slate-50"
      >
        <Icon className="size-4 shrink-0 text-slate-400" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{label}</span>
        <span className="text-sm font-semibold text-slate-900">{children}</span>
      </Link>
    </li>
  );
}

/** The company's other tools (Settings → Links), a click away. */
function CompanyTools() {
  const company = useCompany();
  const links = sidebarLinks(company.links);
  const id = useId();
  if (!links.length) return null;
  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 id={id} className="text-base font-semibold text-slate-900">
          {t('Company tools')}
        </h2>
      </div>
      <ul aria-labelledby={id} className="grid grid-cols-1 gap-1 p-3">
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <ExternalLink className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {localName({ name: link.label, nameAr: link.labelAr })}
              </span>
              <span className="sr-only">{t('(opens in a new tab)')}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
