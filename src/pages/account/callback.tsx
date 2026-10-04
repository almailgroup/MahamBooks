import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { Spinner } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import { connectCloud, useCloud } from '@/cloud/store';
import { takeAuthRedirectError } from '@/cloud/client';
import { AuthShell, safeNext } from '@/features/cloud/auth-shell';

/**
 * Where the link in a confirmation email lands. Signed in: on to the
 * companies (or the invitation that started it). The link was opened on
 * another device or has expired: the address is confirmed anyway, so the
 * person signs in here.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { ready, user, redirectError } = useCloud();
  const [linkError] = useState<string | null>(() => takeAuthRedirectError());
  const done = useRef(false);

  useEffect(() => {
    void connectCloud().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready || !user || done.current) return;
    done.current = true;
    toast.success(t('You are signed in.'));
    navigate(next ?? '/cloud/companies', { replace: true });
  }, [ready, user, next, navigate]);

  // A failed link leaves ?code=… behind: remove it so a reload doesn't try again.
  useEffect(() => {
    if (!ready || user) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('sb_flow_id')) return;
    url.searchParams.delete('code');
    url.searchParams.delete('sb_flow_id');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [ready, user]);

  if (!ready || user) return <Spinner className="min-h-dvh" label={t('Signing you in…')} />;

  const expired = Boolean(linkError) || /expired|invalid/i.test(redirectError ?? '');
  const signIn = next ? `/signin?next=${encodeURIComponent(next)}` : '/signin';
  return (
    <AuthShell
      icon={<MailWarning />}
      title={expired ? t('This link has expired') : t('Sign in to continue')}
      description={
        expired
          ? t('Links in emails work once, for a short time. Sign in, or ask for a new link.')
          : t(
              'If you confirmed your email on another device, your address is confirmed: sign in here.',
            )
      }
    >
      <Link to={signIn} className={buttonClass('primary', 'lg', 'w-full')}>
        {t('Sign in')}
      </Link>
    </AuthShell>
  );
}
