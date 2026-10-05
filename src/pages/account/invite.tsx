import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { MailOpen, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { Button, buttonClass } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { cloudErrorMessage, type InviteDetails } from '@/cloud/api';
import { connectCloud, signOutCloud, useCloud } from '@/cloud/store';
import { isInviteToken, parseInviteHint } from '@/cloud/invite';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole } from '@/cloud/roles';
import { startDownload } from '@/cloud/sync';
import { AuthShell, FormError } from '@/features/cloud/auth-shell';

/**
 * Opened from an invitation link (#/invite/{token}). Says who invited whom
 * to which company and as what, asks the person to sign in or create an
 * account with the invited address, then joins and downloads the company.
 */
export default function InvitePage() {
  const { token = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const hint = parseInviteHint(location.search);
  const { ready, user, api } = useCloud();
  const [details, setDetails] = useState<InviteDetails | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const here = `${location.pathname}${location.search}`;

  useEffect(() => {
    void connectCloud().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!api || !user || !isInviteToken(token)) return;
    let cancelled = false;
    api
      .inviteDetails(token)
      .then((found) => !cancelled && setDetails(found))
      .catch((err) => {
        if (cancelled) return;
        setDetails(null);
        setError(cloudErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, user, token]);

  if (!isInviteToken(token)) {
    return (
      <AuthShell icon={<MailOpen />} title={t('This invitation link is not valid.')}>
        <p className="text-sm text-slate-600">
          {t('Check that the whole link was copied, or ask for a new one.')}
        </p>
      </AuthShell>
    );
  }
  if (!ready || (user && details === undefined && !error)) {
    return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  }

  const company = details?.companyName ?? hint.company;
  const by = details?.invitedByName || hint.by;
  const role: MemberRole | undefined = details?.role ?? hint.role;
  const email = details?.email ?? hint.email;

  const summary = (
    <p>
      {company && role
        ? by
          ? tr('{person} invited you to join {company} as {role}.', {
              person: <strong className="font-medium text-slate-900">{by}</strong>,
              company: (
                <strong dir="auto" className="font-medium text-slate-900">
                  {company}
                </strong>
              ),
              role: <strong className="font-medium text-slate-900">{t(ROLE_LABELS[role])}</strong>,
            })
          : tr('You are invited to join {company} as {role}.', {
              company: (
                <strong dir="auto" className="font-medium text-slate-900">
                  {company}
                </strong>
              ),
              role: <strong className="font-medium text-slate-900">{t(ROLE_LABELS[role])}</strong>,
            })
        : t('You are invited to join a company on Maham Books.')}
    </p>
  );

  if (!user) {
    const next = encodeURIComponent(here);
    const withEmail = email ? `&email=${encodeURIComponent(email)}` : '';
    return (
      <AuthShell icon={<MailOpen />} title={t('You are invited')} description={summary}>
        <div className="space-y-4">
          {role ? <RoleNote role={role} /> : null}
          <p className="text-sm text-slate-600">
            {email
              ? tr('Sign in or create an account with {email} to accept.', {
                  email: (
                    <strong dir="ltr" className="font-medium text-slate-900">
                      {email}
                    </strong>
                  ),
                })
              : t('Sign in or create an account with the address the invitation was sent to.')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              to={`/signup?next=${next}${withEmail}`}
              className={buttonClass('primary', 'lg', 'w-full')}
            >
              {t('Create an account')}
            </Link>
            <Link
              to={`/signin?next=${next}${withEmail}`}
              className={buttonClass('outline', 'lg', 'w-full')}
            >
              {t('Sign in')}
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (!details) {
    return (
      <AuthShell icon={<MailOpen />} title={t('This invitation link is not valid.')}>
        <FormError>{error}</FormError>
        <p className="mt-4 text-sm text-slate-600">{t('Ask for a new invitation link.')}</p>
      </AuthShell>
    );
  }

  if (details.status !== 'pending') {
    const text = {
      expired: t('This invitation has expired. Ask for a new one.'),
      revoked: t('This invitation was cancelled. Ask for a new one.'),
      accepted: t('This invitation has already been used.'),
    }[details.status];
    return (
      <AuthShell icon={<MailOpen />} title={text} description={summary}>
        <Link to="/cloud/companies" className={buttonClass('outline', 'md', 'w-full')}>
          {t('Your companies')}
        </Link>
      </AuthShell>
    );
  }

  if (!details.emailMatches) {
    return (
      <AuthShell
        icon={<MailOpen />}
        title={t('This invitation is for another address')}
        description={summary}
      >
        <div className="space-y-4 text-sm text-slate-600">
          <p>
            {tr('It was sent to {email}, and you are signed in as {me}.', {
              email: (
                <strong dir="ltr" className="font-medium text-slate-900">
                  {details.email}
                </strong>
              ),
              me: (
                <strong dir="ltr" className="font-medium text-slate-900">
                  {user.email}
                </strong>
              ),
            })}
          </p>
          <Button
            className="w-full"
            onClick={() =>
              void signOutCloud({ removeCompanies: false }).then(() =>
                navigate(
                  `/signin?next=${encodeURIComponent(here)}&email=${encodeURIComponent(details.email)}`,
                ),
              )
            }
          >
            {t('Sign out and use the invited address')}
          </Button>
        </div>
      </AuthShell>
    );
  }

  const accept = async () => {
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      const joined = await api.acceptInvite(token);
      await startDownload(
        { id: joined.companyId, name: joined.companyName, role: joined.role },
        { api, userId: user.id },
      );
      toast.success(t('You joined {company}.', { company: joined.companyName }));
      navigate(`/cloud/companies?continue=1&open=${encodeURIComponent(joined.companyId)}`, {
        replace: true,
      });
    } catch (err) {
      setError(cloudErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<UserRoundCheck />}
      title={t('Join {company}', { company: details.companyName })}
      description={summary}
    >
      <div className="space-y-4">
        <RoleNote role={details.role} />
        <FormError>{error}</FormError>
        <Button size="lg" className="w-full" onClick={() => void accept()} loading={busy}>
          {t('Accept and download')}
        </Button>
        <p className="text-center text-xs text-slate-500">
          {tr('Signed in as {email}.', {
            email: <span dir="ltr">{user.email}</span>,
          })}
        </p>
      </div>
    </AuthShell>
  );
}

function RoleNote({ role }: { role: MemberRole }) {
  return (
    <p className="flex gap-2.5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200/70">
      <ShieldCheck className="text-primary-600 mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-slate-900">{t(ROLE_LABELS[role])}</span>
        {' – '}
        {t(ROLE_DESCRIPTIONS[role])}
      </span>
    </p>
  );
}
