import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { useCompany, useFormat, useOpenInCompany } from '@/app/company';
import { changeKindLabel } from '@/alerts/changes';
import type { ChangeEvent } from '@/cloud/api';
import { cloudErrorMessage } from '@/cloud/api';
import { useCloudLink } from '@/cloud/hooks';
import { getsChangeFeed } from '@/cloud/roles';
import { linkHasFeature } from '@/cloud/features';
import { Button, buttonClass } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card, CardBody, EmptyState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { ChangeRow, useChangeTime } from '@/features/notifications/change-row';
import {
  refreshChangeStatus,
  useChangeFeedAccess,
  useChangeFeedStatus,
  type ChangeFeedAccess,
} from '@/features/notifications/hooks';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { addDaysISO, toISODate, today } from '@/lib/dates';

/** Changes asked for at a time. */
const PAGE = 50;

type Show = 'all' | 'unread' | 'important';

/**
 * A link to Updates in a company (#/notifications?company=…, as the emails
 * of the changes have it) opens it in that company when this device has it.
 */
function useCompanyOfLink(current: string) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const openInCompany = useOpenInCompany();
  const wanted = params.get('company');
  useEffect(() => {
    if (!wanted) return;
    if (wanted === current) {
      navigate('/notifications', { replace: true });
      return;
    }
    void openInCompany(wanted, '/notifications').then((opened) => {
      if (!opened) navigate('/notifications', { replace: true });
    });
  }, [wanted, current, navigate, openInCompany]);
}

/**
 * Updates (المستجدات): every change the team made in the company, newest
 * first, by day, for the owner (the Super Admin) and the members the owner
 * allowed to approve. Their own changes are left out. Filters, "Mark all as
 * read" and older pages; each change opens its record.
 */
export default function NotificationsPage() {
  const company = useCompany();
  useCompanyOfLink(company.id);
  const link = useCloudLink(company.id);
  const access = useChangeFeedAccess(company.id);
  const status = useChangeFeedStatus(access);

  const header = (
    <PageHeader
      title={t('Updates')}
      description={t('What your team changed in {company}.', { company: localName(company) })}
    />
  );

  if (link === undefined) {
    return (
      <div>
        {header}
        <Spinner className="py-24" label={t('Loading…')} />
      </div>
    );
  }
  if (!access) {
    const reason = !link
      ? t('Updates are for companies kept in the cloud, where a team works together.')
      : !linkHasFeature(link, 'change_feed')
        ? t(
            'The cloud needs the latest database script first. Ask the owner of the company to run it.',
          )
        : !getsChangeFeed(link.role, link.approver)
          ? t(
              'Only the owner and the members the owner allowed to approve see the changes of the team.',
            )
          : t('Sign in to see the changes of the team.');
    return (
      <div>
        {header}
        <Card>
          <EmptyState icon={<Bell />} title={t('No updates here')} description={reason} />
        </Card>
      </div>
    );
  }
  return (
    <div>
      {header}
      {status && !status.enabled ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>
            {t(
              'Changes are recorded only while someone has Changes by your team on. Turn it on in Settings → Email alerts.',
            )}
          </p>
          <Link to="/settings/alerts" className={buttonClass('outline', 'sm')}>
            {t('Email alerts')}
          </Link>
        </div>
      ) : null}
      <Feed key={`${access.companyId} ${access.userId}`} access={access} />
    </div>
  );
}

function Feed({ access }: { access: ChangeFeedAccess }) {
  const fmt = useFormat();
  const status = useChangeFeedStatus(access);
  const when = useChangeTime();
  const [events, setEvents] = useState<ChangeEvent[] | undefined>(undefined);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [marking, setMarking] = useState(false);
  const [show, setShow] = useState<Show>('all');
  const [kind, setKind] = useState('');
  const latest = status?.latest ?? 0;

  // The newest page, again whenever something new arrives.
  useEffect(() => {
    let cancelled = false;
    access.api
      .changeFeed(access.companyId, { limit: PAGE })
      .then((rows) => {
        if (cancelled) return;
        setEvents((before) => {
          const fresh = rows ?? [];
          // Older pages already loaded stay below.
          const oldest = fresh.at(-1)?.id ?? Infinity;
          return [...fresh, ...(before ?? []).filter((e) => e.id < oldest)];
        });
        setMore((rows?.length ?? 0) === PAGE);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(cloudErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [access, latest]);

  const loadOlder = useCallback(async () => {
    const oldest = events?.at(-1)?.id;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const rows =
        (await access.api.changeFeed(access.companyId, { before: oldest, limit: PAGE })) ?? [];
      setEvents((before) => [...(before ?? []), ...rows.filter((r) => r.id < oldest)]);
      setMore(rows.length === PAGE);
    } catch (err) {
      setError(cloudErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [access, events]);

  const markAll = async () => {
    if (!latest) return;
    setMarking(true);
    try {
      await access.api.markChangesRead(access.companyId, latest);
      setEvents((rows) => rows?.map((row) => ({ ...row, unread: false })));
      await refreshChangeStatus(access);
    } catch (err) {
      setError(cloudErrorMessage(err));
    } finally {
      setMarking(false);
    }
  };

  const shown = useMemo(
    () =>
      (events ?? []).filter(
        (e) =>
          (show === 'all' || (show === 'unread' ? e.unread : e.important)) &&
          (!kind || e.kind === kind),
      ),
    [events, show, kind],
  );

  // By day, the newest first.
  const days = useMemo(() => {
    const groups: { day: string; events: ChangeEvent[] }[] = [];
    for (const event of shown) {
      const time = new Date(event.at);
      const day = Number.isNaN(time.getTime()) ? '' : toISODate(time);
      const last = groups.at(-1);
      if (last && last.day === day) last.events.push(event);
      else groups.push({ day, events: [event] });
    }
    return groups;
  }, [shown]);

  const dayLabel = (day: string) =>
    day === today()
      ? t('Today')
      : day === addDaysISO(today(), -1)
        ? t('Yesterday')
        : day
          ? fmt.date(day)
          : '';

  const kinds = useMemo(() => [...new Set((events ?? []).map((e) => e.kind))].sort(), [events]);

  if (events === undefined && !error) return <Spinner className="py-24" label={t('Loading…')} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={show}
            onChange={setShow}
            options={[
              { value: 'all', label: t('All') },
              { value: 'unread', label: t('Unread'), count: status?.unread || undefined },
              { value: 'important', label: t('Important') },
            ]}
          />
          <Select
            aria-label={t('Kind of change')}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-auto"
          >
            <option value="">{t('Every kind of change')}</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(changeKindLabel(k))}
              </option>
            ))}
          </Select>
        </div>
        {status && status.unread > 0 ? (
          <Button variant="outline" size="sm" loading={marking} onClick={() => void markAll()}>
            <CheckCheck /> {t('Mark all as read')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {days.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bell />}
            title={events?.length ? t('Nothing matches') : t('Nothing new from your team yet.')}
            description={
              events?.length
                ? t('Try another filter.')
                : t('Changes the others make appear here as soon as their device syncs.')
            }
          />
        </Card>
      ) : (
        days.map((group) => (
          <section key={group.day} aria-label={dayLabel(group.day)}>
            <h2 className="mb-1.5 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {dayLabel(group.day)}
            </h2>
            <Card>
              <CardBody className="py-2">
                <ol className="divide-y divide-slate-100">
                  {group.events.map((event) => (
                    <li key={event.id}>
                      <ChangeRow event={event} when={when(event.at)} />
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          </section>
        ))
      )}
      {more ? (
        <div className="flex justify-center">
          <Button variant="outline" loading={loadingMore} onClick={() => void loadOlder()}>
            {t('Show older changes')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
