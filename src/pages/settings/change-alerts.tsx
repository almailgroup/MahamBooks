import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany, useFormat } from '@/app/company';
import { IMMEDIATE_KIND_LABELS } from '@/alerts/changes';
import { cloudErrorMessage, type ChangeNotificationSettings, type CloudApi } from '@/cloud/api';
import { IMMEDIATE_KINDS, type ChangeDigest, type ImmediateKind } from '@/cloud/change-feed';
import { Button, buttonClass } from '@/components/ui/button';
import { Checkbox, Switch } from '@/components/ui/form';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { refreshChangeStatus, useChangeFeedAccess } from '@/features/notifications/hooks';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { SettingsSection } from './shared';

interface Draft {
  enabled: boolean;
  immediateKinds: ImmediateKind[];
  digest: ChangeDigest;
}

const draftOf = (s: ChangeNotificationSettings): Draft => ({
  enabled: s.enabled,
  immediateKinds: [...s.immediateKinds],
  digest: s.digest,
});

const sameDraft = (a: Draft, b: Draft) =>
  a.enabled === b.enabled &&
  a.digest === b.digest &&
  a.immediateKinds.length === b.immediateKinds.length &&
  a.immediateKinds.every((kind) => b.immediateKinds.includes(kind));

/** Where the app is open, for the button in the email. */
function appAddress(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * Settings → Email alerts → Changes by your team (تغييرات الفريق), for the
 * owner (the Super Admin) and the members the owner allowed to approve:
 * important changes by email within minutes, the rest in a morning summary,
 * everything under Updates (the bell). Off until each of them turns it on;
 * until someone of the company has, the cloud records nothing.
 */
export function ChangesForm({
  api,
  companyId,
  email,
}: {
  api: CloudApi;
  companyId: string;
  email: string;
}) {
  const company = useCompany();
  const fmt = useFormat();
  const access = useChangeFeedAccess(companyId);
  // undefined while loading; null when the server doesn't have it.
  const [saved, setSaved] = useState<ChangeNotificationSettings | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({
    enabled: false,
    immediateKinds: [...IMMEDIATE_KINDS],
    digest: 'daily',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .changeNotifications(companyId)
      .then((settings) => {
        if (cancelled) return;
        setSaved(settings);
        if (settings) setDraft(draftOf(settings));
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

  const title = t('Changes by your team');
  if (saved === undefined && !error) {
    return (
      <SettingsSection title={title}>
        <Spinner className="py-8" label={t('Loading…')} />
      </SettingsSection>
    );
  }
  if (!saved) {
    return (
      <SettingsSection title={title}>
        <EmptyState
          className="py-8"
          icon={<Users />}
          title={t('The changes of the team could not be loaded')}
          description={error}
          action={
            <Button variant="outline" onClick={reload}>
              {t('Try again')}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  const dirty = !sameDraft(draft, draftOf(saved));
  const name = localName(company);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.setChangeNotifications(companyId, { ...draft, appUrl: appAddress() });
      if (!next) {
        setSaved(null);
        return;
      }
      setSaved(next);
      setDraft(draftOf(next));
      toast.success(
        next.enabled ? t('Changes by your team are on') : t('Changes by your team are off'),
      );
      if (access) await refreshChangeStatus(access);
    } catch (err) {
      toast.error(cloudErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleKind = (kind: ImmediateKind, on: boolean) =>
    setDraft((d) => ({
      ...d,
      immediateKinds: on
        ? IMMEDIATE_KINDS.filter((k) => k === kind || d.immediateKinds.includes(k))
        : d.immediateKinds.filter((k) => k !== kind),
    }));

  return (
    <SettingsSection
      id="changes"
      title={title}
      description={t(
        'What the rest of the team changes in {company}: important changes by email within a few minutes, everything else in a summary at 8:00 in the morning (Kuwait time), and all of it under Updates, the bell at the top.',
        { company: name },
      )}
      actions={
        saved.enabled ? (
          <Link to="/notifications" className={buttonClass('outline')}>
            {t('Open Updates')}
          </Link>
        ) : null
      }
    >
      <Switch
        checked={draft.enabled}
        onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
        label={t('Tell me about changes by my team in {company}', { company: name })}
        description={t(
          'The emails go to {email}, the address of your account. Your own changes are left out.',
          { email },
        )}
      />
      <fieldset disabled={!draft.enabled} className="space-y-3 disabled:opacity-60">
        <legend className="mb-3 text-sm font-medium text-slate-800">
          {t('Email at once (within about 5 minutes)')}
        </legend>
        {IMMEDIATE_KINDS.map((kind) => (
          <Checkbox
            key={kind}
            checked={draft.immediateKinds.includes(kind)}
            onChange={(e) => toggleKind(kind, e.target.checked)}
            label={t(IMMEDIATE_KIND_LABELS[kind].label)}
            description={t(IMMEDIATE_KIND_LABELS[kind].description)}
          />
        ))}
      </fieldset>
      <fieldset disabled={!draft.enabled} className="disabled:opacity-60">
        <Switch
          checked={draft.digest === 'daily'}
          onChange={(on) => setDraft((d) => ({ ...d, digest: on ? 'daily' : 'off' }))}
          label={t('Everything else in a morning summary')}
          description={t(
            'At 8:00 Kuwait time, on days the team changed something. Off: only the changes above are emailed.',
          )}
        />
      </fieldset>
      <p className="text-sm text-slate-500">
        {t(
          'At most one email every 15 minutes and 20 a day; whatever waits goes in the next one. Payroll changes never name anyone or show amounts.',
        )}
      </p>
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
      {dirty ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="ghost" onClick={() => setDraft(draftOf(saved))} disabled={saving}>
            {t('Discard')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Save')}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}
