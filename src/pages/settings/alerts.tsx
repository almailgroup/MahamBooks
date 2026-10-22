import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BellRing, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany, useFormat } from '@/app/company';
import { msg, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Checkbox, Switch } from '@/components/ui/form';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { ReadOnlyContext } from '@/components/ui/read-only';
import {
  AlertEmailError,
  cloudErrorMessage,
  type AlertEmailErrorCode,
  type CloudApi,
  type EmailAlertSettings,
} from '@/cloud/api';
import { useCloud } from '@/cloud/store';
import { useCloudLink } from '@/cloud/hooks';
import { linkHasFeature } from '@/cloud/features';
import { appLimit, getsChangeFeed, getsEmailAlerts } from '@/cloud/roles';
import { ChangesForm } from './change-alerts';
import {
  ALERT_TOPICS,
  BOOKS_TOPICS,
  TOPIC_DESCRIPTIONS,
  TOPIC_LABELS,
  type AlertTopic,
} from '@/alerts/topics';
import { DOCUMENT_KIND_LABELS } from '@/alerts/email';
import { DOCUMENT_ALERT_KINDS, type DocumentAlertKind } from '@/lib/compliance';
import { SaveBar, SettingsSection } from './shared';

const NOT_READ_ONLY = { readOnly: false, reason: '' };

const SEND_ERRORS: Record<AlertEmailErrorCode, string> = {
  offline: msg('No connection. Try again when you are online.'),
  auth: msg('Your session has ended. Sign in again.'),
  permission: msg('Only the owner, admins and accountants can get email alerts.'),
  invalid: msg('The email could not be sent.'),
  not_enabled: msg('Turn email alerts on and save first.'),
  too_soon: msg('Wait a minute before sending another email.'),
  no_company: msg('This company is not in the cloud yet.'),
  not_configured: msg(
    'The email sender is not set up yet: add RESEND_API_KEY and ALERTS_FROM to the secrets of the email-alerts function in Supabase.',
  ),
  not_ready: msg('The email alerts script has not been run in Supabase yet.'),
  not_deployed: msg('The email-alerts function is not in Supabase yet.'),
  send_failed: msg('The email service did not send it: {detail}'),
  failed: msg('The email could not be sent.'),
};

/** What went wrong sending, in the person's language. */
export function alertEmailMessage(error: unknown): string {
  if (error instanceof AlertEmailError) {
    return t(SEND_ERRORS[error.code], { detail: error.detail || '—' });
  }
  return cloudErrorMessage(error);
}

/** Where the app is open, for the button in the email. */
function appAddress(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Settings → Email alerts: the signed-in owner or admin (and accountant,
 * once the server has 20261130000000_people_alerts.sql) turns their own
 * morning email for this company on or off and chooses what it covers, and
 * with that server which kinds of paper (#18).
 */
export default function AlertSettings() {
  const company = useCompany();
  const { user, api } = useCloud();
  const link = useCloudLink(company.id);
  const navigate = useNavigate();

  if (link === undefined) return <Spinner className="py-24" label={t('Loading…')} />;

  if (!link || link.status === 'removed' || !user || !api || link.userId !== user.id) {
    return (
      <SettingsSection title={t('Email alerts')}>
        <EmptyState
          className="py-8"
          icon={<BellRing />}
          title={t('What needs attention, by email')}
          description={t(
            'Email alerts work for companies kept in the cloud. Keep {company} in the cloud (Settings → Team), then turn them on here.',
            { company: localName(company) },
          )}
          action={
            user ? (
              <Button variant="outline" onClick={() => navigate('/settings/team')}>
                {t('Open Team settings')}
              </Button>
            ) : (
              <Button onClick={() => navigate('/signin?next=/settings/alerts')}>
                {t('Sign in')}
              </Button>
            )
          }
        />
      </SettingsSection>
    );
  }

  const morning = getsEmailAlerts(link.role, linkHasFeature(link, 'document_alerts'));
  // The changes of the team (#7): the owner and approvers, once the server has the feed.
  const changes = linkHasFeature(link, 'change_feed') && getsChangeFeed(link.role, link.approver);

  if (!morning && !changes) {
    return (
      <SettingsSection title={t('Email alerts')}>
        <EmptyState
          className="py-8"
          icon={<BellRing />}
          title={t('For owners and admins')}
          description={t('Only the owner and admins of a company can get its email alerts.')}
        />
      </SettingsSection>
    );
  }

  return (
    <ReadOnlyContext.Provider value={NOT_READ_ONLY}>
      <div className="space-y-8">
        {morning ? (
          <AlertsForm
            api={api}
            companyId={company.id}
            email={user.email}
            // The emails leave Maham Books out for whoever the owner gave no access to it.
            books={
              !linkHasFeature(link, 'document_alerts') ||
              appLimit(link.role, link.permissions, 'books') !== 'none'
            }
          />
        ) : null}
        {changes ? <ChangesForm api={api} companyId={company.id} email={user.email} /> : null}
      </div>
    </ReadOnlyContext.Provider>
  );
}

interface Draft {
  enabled: boolean;
  topics: AlertTopic[];
  /** The kinds of paper (#18); every kind until chosen. */
  kinds: DocumentAlertKind[];
}

const sameList = <T,>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

const sameDraft = (a: Draft, b: Draft) =>
  a.enabled === b.enabled && sameList(a.topics, b.topics) && sameList(a.kinds, b.kinds);

/** Every kind, for null (what is kept for "all"). */
const kindsOf = (scope: DocumentAlertKind[] | null | undefined): DocumentAlertKind[] =>
  scope?.length ? DOCUMENT_ALERT_KINDS.filter((k) => scope.includes(k)) : [...DOCUMENT_ALERT_KINDS];

function AlertsForm({
  api,
  companyId,
  email,
  books = true,
}: {
  api: CloudApi;
  companyId: string;
  email: string;
  /** The person may open Maham Books: its invoices, bills and cheques are offered. */
  books?: boolean;
}) {
  const topicsShown = ALERT_TOPICS.filter((topic) => books || !BOOKS_TOPICS.includes(topic));
  const company = useCompany();
  const fmt = useFormat();
  // undefined while loading; null when the cloud doesn't have email alerts yet.
  const [saved, setSaved] = useState<EmailAlertSettings | null | undefined>(undefined);
  // The kinds of paper as saved: undefined when the server can't keep them yet.
  const [scope, setScope] = useState<DocumentAlertKind[] | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({
    enabled: false,
    topics: [...ALERT_TOPICS],
    kinds: [...DOCUMENT_ALERT_KINDS],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.emailAlerts(companyId),
      // An older server keeps no kinds of paper: the page stays as it was.
      api.emailAlertScope(companyId).catch(() => undefined),
    ])
      .then(([settings, chosen]) => {
        if (cancelled) return;
        setSaved(settings);
        const kinds = chosen === undefined ? undefined : kindsOf(chosen);
        setScope(kinds);
        if (settings) {
          setDraft({
            enabled: settings.enabled,
            topics: settings.topics,
            kinds: kinds ?? [...DOCUMENT_ALERT_KINDS],
          });
        }
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setSaved((s) => s ?? null);
        setError(cloudErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, companyId, version]);

  if (saved === undefined && !error) return <Spinner className="py-24" label={t('Loading…')} />;

  if (!saved) {
    return (
      <SettingsSection title={t('Email alerts')}>
        <EmptyState
          className="py-8"
          icon={<BellRing />}
          title={error ? t('Email alerts could not be loaded') : t('Not set up in the cloud yet')}
          description={
            error ||
            t(
              'The owner of the cloud runs the email alerts script in Supabase first (see the guide, docs/email-alerts.md).',
            )
          }
          action={
            <Button variant="outline" onClick={reload}>
              {t('Try again')}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  const savedKinds = scope ?? [...DOCUMENT_ALERT_KINDS];
  const dirty = !sameDraft(draft, {
    enabled: saved.enabled,
    topics: saved.topics,
    kinds: savedKinds,
  });
  const name = localName(company);

  const sendNow = async (first: boolean, functionReady: boolean) => {
    setSending(true);
    try {
      const { to } = await api.sendAlertEmail(companyId);
      toast.success(
        first
          ? t('Email alerts are on. The first email is on its way to {email}.', { email: to })
          : t('Email sent to {email}.', { email: to }),
      );
    } catch (err) {
      // A function that was never published fails like a lost connection.
      const missing =
        err instanceof AlertEmailError &&
        err.code === 'offline' &&
        !functionReady &&
        navigator.onLine;
      toast.error(missing ? t(SEND_ERRORS.not_deployed) : alertEmailMessage(err));
    } finally {
      setSending(false);
      reload();
    }
  };

  const save = async () => {
    if (draft.enabled && !draft.topics.some((topic) => topicsShown.includes(topic))) {
      toast.error(t('Choose at least one kind of alert.'));
      return;
    }
    if (scope && draft.topics.includes('documents') && !draft.kinds.length) {
      toast.error(t('Choose at least one kind of paper.'));
      return;
    }
    setSaving(true);
    try {
      // The kinds first: the first email, sent as alerts are turned on, follows them.
      let kinds = scope;
      if (scope && draft.kinds.length && !sameList(draft.kinds, scope)) {
        const all = draft.kinds.length === DOCUMENT_ALERT_KINDS.length;
        if (await api.setEmailAlertScope(companyId, all ? null : draft.kinds)) {
          kinds = kindsOf(draft.kinds);
          setScope(kinds);
        }
      }
      const next = await api.setEmailAlerts(companyId, {
        enabled: draft.enabled,
        topics: draft.topics,
        appUrl: appAddress(),
      });
      if (!next) {
        setSaved(null);
        return;
      }
      const turnedOn = next.enabled && !saved.enabled;
      setSaved(next);
      setDraft({
        enabled: next.enabled,
        topics: next.topics,
        kinds: kinds ?? [...DOCUMENT_ALERT_KINDS],
      });
      if (turnedOn) {
        await sendNow(true, next.functionReady);
      } else {
        toast.success(next.enabled ? t('Email alerts saved') : t('Email alerts are off'));
      }
    } catch (err) {
      toast.error(cloudErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleKind = (kind: DocumentAlertKind, on: boolean) =>
    setDraft((d) => ({
      ...d,
      kinds: on
        ? DOCUMENT_ALERT_KINDS.filter((x) => x === kind || d.kinds.includes(x))
        : d.kinds.filter((x) => x !== kind),
    }));

  const toggleTopic = (topic: AlertTopic, on: boolean) =>
    setDraft((d) => ({
      ...d,
      topics: on
        ? ALERT_TOPICS.filter((x) => x === topic || d.topics.includes(x))
        : d.topics.filter((x) => x !== topic),
    }));

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('Email alerts')}
        description={t(
          'Every morning at 8:00 (Kuwait time) when something in {company} needs attention, and every Sunday a summary of everything still open.',
          { company: name },
        )}
        actions={
          saved.enabled && !dirty ? (
            <Button
              variant="outline"
              loading={sending}
              onClick={() => void sendNow(false, saved.functionReady)}
            >
              <Send /> {t('Send me the email now')}
            </Button>
          ) : null
        }
      >
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
          label={t('Email me alerts for {company}', { company: name })}
          description={t('Sent to {email}, the address of your account.', { email })}
        />
        <fieldset disabled={!draft.enabled} className="space-y-3 disabled:opacity-60">
          <legend className="mb-3 text-sm font-medium text-slate-800">
            {t('What to include')}
          </legend>
          {topicsShown.map((topic) => (
            <div key={topic} className="space-y-3">
              <Checkbox
                checked={draft.topics.includes(topic)}
                onChange={(e) => toggleTopic(topic, e.target.checked)}
                label={t(TOPIC_LABELS[topic])}
                description={t(TOPIC_DESCRIPTIONS[topic])}
              />
              {topic === 'documents' && scope ? (
                <fieldset
                  disabled={!draft.topics.includes('documents')}
                  className="space-y-2 ps-7 disabled:opacity-60"
                >
                  <legend className="sr-only">{t('Kinds of paper')}</legend>
                  {DOCUMENT_ALERT_KINDS.map((kind) => (
                    <Checkbox
                      key={kind}
                      checked={draft.kinds.includes(kind)}
                      onChange={(e) => toggleKind(kind, e.target.checked)}
                      label={t(DOCUMENT_KIND_LABELS[kind])}
                    />
                  ))}
                </fieldset>
              ) : null}
            </div>
          ))}
          {books ? null : (
            <p className="text-sm text-slate-500">
              {t(
                'Invoices, bills and cheques are left out: the owner has given you no access to Maham Books.',
              )}
            </p>
          )}
        </fieldset>
        {!saved.functionReady ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t(
              'The email sender is not set up in Supabase yet, so no email goes out. The guide docs/email-alerts.md shows how.',
            )}
          </p>
        ) : null}
        {saved.enabled && saved.lastError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {t('The last email could not be sent ({date}): {problem}', {
              date: fmt.dateTime(saved.lastErrorAt),
              problem: saved.lastError,
            })}
          </p>
        ) : saved.lastSentAt ? (
          <p className="text-sm text-slate-500">
            {t('Last email: {date}', { date: fmt.dateTime(saved.lastSentAt) })}
          </p>
        ) : null}
        {draft.enabled ? (
          <p className="text-sm text-slate-500">
            {tp(
              draft.topics.filter((topic) => topicsShown.includes(topic)).length,
              'The email covers {count} kind of alert. Nothing is sent on days without anything new, except Sundays.',
              'The email covers {count} kinds of alert. Nothing is sent on days without anything new, except Sundays.',
            )}
          </p>
        ) : null}
      </SettingsSection>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onReset={() =>
          setDraft({ enabled: saved.enabled, topics: saved.topics, kinds: savedKinds })
        }
      />
    </div>
  );
}
