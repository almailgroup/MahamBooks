import { useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/app/company';
import { useCloudLink } from '@/cloud/hooks';
import { saveCompany } from '@/db/records';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { aiSwitchOn, useAiAvailability, withAiSwitch } from '@/features/ai/availability';
import { checkHealth } from '@/features/ai/client';
import { aiErrorMessage } from '@/features/ai/errors';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { SettingsSection } from './shared';

/**
 * Settings → AI assistant (المساعد الذكي): the company's switch for the
 * Ask AI button on every page (Company.ai, off until the owner or an admin
 * turns it on), what the assistant is sent, and a test of the connection
 * to the AI service. Companies kept on this device only can't use it: the
 * service knows people by their sign-in.
 */
export default function AiSettings() {
  const company = useCompany();
  const link = useCloudLink(company.id);
  const availability = useAiAvailability();
  const [busy, setBusy] = useState(false);
  const name = localName(company);

  if (link === undefined) return <Spinner className="py-24" label={t('Loading…')} />;

  const title = t('AI assistant');
  const description = t(
    'Answers questions about using Maham One, on every page, for everyone in {company}.',
    { company: name },
  );

  if (availability === 'device') {
    return (
      <div className="space-y-6">
        <SettingsSection title={title} description={description}>
          <p className="text-sm text-slate-600">
            {t(
              'The AI assistant needs a company kept in the cloud, and everyone using it signed in. Keep this company in the cloud first, in Settings → Team.',
            )}{' '}
            <Link to="/settings/team" className="text-primary-700 font-medium hover:underline">
              {t('Team')}
            </Link>
          </p>
        </SettingsSection>
        <WhatIsSent />
      </div>
    );
  }

  const on = aiSwitchOn(company);
  const manager = link?.role === 'owner' || link?.role === 'admin';
  const canChange = manager && availability !== 'signed-out' && availability !== 'removed';

  const change = async (next: boolean) => {
    setBusy(true);
    try {
      await saveCompany(withAiSwitch(company, next));
      toast.success(next ? t('AI assistant turned on') : t('AI assistant turned off'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save settings.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection title={title} description={description}>
        <Switch
          checked={on}
          onChange={(next) => void change(next)}
          disabled={!canChange || busy}
          label={t('Use the AI assistant')}
          description={t(
            'Everyone in {company} sees an Ask AI button at the bottom of every page (Ctrl J or ⌘J opens it too), on each device once it syncs. It explains how to do things in the app; it doesn’t do them.',
            { company: name },
          )}
        />
        {availability === 'signed-out' ? (
          <p className="text-sm text-slate-600">{t('Sign in to use the AI assistant.')}</p>
        ) : !manager ? (
          <p className="text-sm text-slate-500">
            {t('Only the owner or an admin turns the AI assistant on or off.')}
          </p>
        ) : null}
      </SettingsSection>
      <WhatIsSent />
      <ConnectionTest />
    </div>
  );
}

/** What the assistant is sent and where it goes, in plain words. */
function WhatIsSent() {
  return (
    <SettingsSection
      title={t('What the AI assistant sees')}
      description={t('Kept short on purpose, for this first version.')}
    >
      <ul className="space-y-2.5 text-sm text-slate-700">
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            {t(
              'Only what you type in the chat, with the name of the app and page you are on, your role and the app’s language. It doesn’t see your records, documents or what is in a form.',
            )}
          </span>
        </li>
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            {t(
              'Questions go through Maham One’s own AI service to Google Gemini, under Google’s paid-tier terms: Google doesn’t use them to improve its products.',
            )}
          </span>
        </li>
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            {t(
              'The conversation stays in that browser tab only: it is gone when the page is reloaded or New chat is pressed, and it is never synced.',
            )}
          </span>
        </li>
      </ul>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        {t(
          'Don’t paste Civil IDs, IBANs, salaries or other personal details into the chat. Describe the case instead.',
        )}
      </p>
    </SettingsSection>
  );
}

type TestResult = { ok: true; model?: string } | { ok: false; message: string } | null;

/** GET /health of the AI service, from this browser. */
function ConnectionTest() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const health = await checkHealth(AbortSignal.timeout(15_000));
      setResult({ ok: true, model: health.model });
    } catch (error) {
      setResult({ ok: false, message: aiErrorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsSection
      title={t('Connection')}
      description={t('Checks that this device reaches the AI service.')}
      actions={
        <Button variant="outline" onClick={() => void test()} loading={testing}>
          {t('Test the connection')}
        </Button>
      }
    >
      {result === null ? (
        <p className="text-sm text-slate-500">
          {t('Nothing is asked of the AI: this only checks the service answers.')}
        </p>
      ) : result.ok ? (
        <p role="status" className="flex items-center gap-2 text-sm text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {result.model
            ? t('Connected. The AI service answers with {model}.', { model: result.model })
            : t('Connected. The AI service answers.')}
        </p>
      ) : (
        <p role="alert" className="flex items-center gap-2 text-sm text-red-700">
          <XCircle className="size-4 shrink-0" aria-hidden />
          {result.message}
        </p>
      )}
    </SettingsSection>
  );
}
