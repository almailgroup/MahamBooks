import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { KeyRound, LogIn, MailCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { currentLanguage, t, type Language } from '@/i18n';
import { tr, useLanguage } from '@/i18n/provider';
import { isValidEmail } from '@/lib/email';
import { suiteName } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { connectCloud, useCloud } from '@/cloud/store';
import {
  AuthProblem,
  loadProfile,
  MIN_PASSWORD,
  resendConfirmation,
  sendPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from '@/cloud/auth';
import { AuthShell, FormError, PasswordInput, safeNext } from '@/features/cloud/auth-shell';

export type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

const message = (error: unknown) =>
  error instanceof AuthProblem || error instanceof Error
    ? error.message
    : t('Something went wrong. Try again in a moment.');

/** Keeps where to go after signing in (an invitation) on the links between the screens. */
function withNext(path: string, next: string | null, email?: string) {
  const params = new URLSearchParams();
  if (next) params.set('next', next);
  if (email) params.set('email', email);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export default function AuthPage({ mode }: { mode: AuthMode }) {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const preset = params.get('email') ?? '';
  switch (mode) {
    case 'signin':
      return <SignIn next={next} preset={preset} />;
    case 'signup':
      return <SignUp next={next} preset={preset} />;
    case 'forgot':
      return <Forgot preset={preset} />;
    case 'reset':
      return <Reset />;
  }
}

function SignIn({ next, preset }: { next: string | null; preset: string }) {
  const navigate = useNavigate();
  const { setLanguage } = useLanguage();
  const [email, setEmail] = useState(preset);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) return setError(t('Check the email address.'));
    if (!password) return setError(t('Enter your password.'));
    setBusy(true);
    try {
      await connectCloud();
      const user = await signIn(email, password);
      toast.success(t('Signed in as {email}', { email: user.email ?? email }));
      navigate(next ?? '/cloud/companies?continue=1');
      // Your language follows you to every device.
      const profile = await loadProfile(user.id);
      if (profile && profile.language !== currentLanguage()) {
        void setLanguage(profile.language as Language);
      }
    } catch (err) {
      setUnconfirmed(err instanceof AuthProblem && err.code === 'email_not_confirmed');
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<LogIn />}
      title={t('Sign in')}
      description={t('Your companies sync to every device you sign in on.')}
      footer={
        <div className="space-y-2">
          <p>
            {tr('New to {app}? {link}', {
              app: suiteName(),
              link: (
                <Link
                  to={withNext('/signup', next, email)}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {t('Create an account')}
                </Link>
              ),
            })}
          </p>
          <p>
            <Link to="/" className="text-slate-600 hover:text-slate-900 hover:underline">
              {t('Use on this device only')}
            </Link>
          </p>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('Email')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              className="rtl:text-end"
              autoFocus={!preset}
              required
            />
          )}
        </Field>
        <Field label={t('Password')}>
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              autoFocus={Boolean(preset)}
            />
          )}
        </Field>
        <div className="-mt-1 text-end">
          <Link
            to={withNext('/forgot-password', null, email)}
            className="text-primary-700 text-sm font-medium hover:underline"
          >
            {t('Forgot your password?')}
          </Link>
        </div>
        <FormError>{error}</FormError>
        {unconfirmed ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              void resendConfirmation(email)
                .then(() => toast.success(t('We sent the link again.')))
                .catch((err) => setError(message(err)))
            }
          >
            {t('Send the confirmation link again')}
          </Button>
        ) : null}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('Sign in')}
        </Button>
      </form>
    </AuthShell>
  );
}

function SignUp({ next, preset }: { next: string | null; preset: string }) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(preset);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const callback = next ? `/auth/callback?next=${encodeURIComponent(next)}` : '/auth/callback';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError(t('Enter your name.'));
    if (!isValidEmail(email)) return setError(t('Check the email address.'));
    if (password.length < MIN_PASSWORD) {
      return setError(
        t('Choose a password of at least {count} characters.', { count: MIN_PASSWORD }),
      );
    }
    setBusy(true);
    try {
      await connectCloud();
      const { confirm } = await signUp({
        email,
        password,
        fullName: name,
        language,
        next: callback,
      });
      if (confirm) setSent(true);
      else navigate(next ?? '/cloud/companies?continue=1');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) return <CheckEmail email={email} next={callback} onBack={() => setSent(false)} />;

  return (
    <AuthShell
      icon={<UserPlus />}
      title={t('Create an account')}
      description={t(
        'Keep your books safe in the cloud, use them on every device and work with your team. They still work offline.',
      )}
      footer={
        <div className="space-y-2">
          <p>
            {tr('Already have an account? {link}', {
              link: (
                <Link
                  to={withNext('/signin', next, email)}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {t('Sign in')}
                </Link>
              ),
            })}
          </p>
          <p>
            <Link to="/" className="text-slate-600 hover:text-slate-900 hover:underline">
              {t('Use on this device only')}
            </Link>
          </p>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('Full name')}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              dir="auto"
              autoFocus
              required
            />
          )}
        </Field>
        <Field label={t('Email')} hint={t('We send a link to confirm it.')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              className="rtl:text-end"
              required
            />
          )}
        </Field>
        <Field
          label={t('Password')}
          hint={t('At least {count} characters.', { count: MIN_PASSWORD })}
        >
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
          )}
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('Create an account')}
        </Button>
      </form>
    </AuthShell>
  );
}

/** After signing up: open the link in the email to finish. */
function CheckEmail({ email, next, onBack }: { email: string; next: string; onBack: () => void }) {
  const [wait, setWait] = useState(60);
  const [error, setError] = useState('');
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  return (
    <AuthShell
      icon={<MailCheck />}
      title={t('Check your email')}
      description={tr('We sent a link to {email}. Open it to confirm your address and finish.', {
        email: (
          <strong dir="ltr" className="font-medium text-slate-900">
            {email}
          </strong>
        ),
      })}
      footer={
        <button type="button" onClick={onBack} className="hover:text-slate-900 hover:underline">
          {t('Wrong address? Start again')}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {t('Open the link on this device. Check the spam folder if it has not arrived.')}
        </p>
        <FormError>{error}</FormError>
        <Button
          variant="outline"
          className="w-full"
          disabled={wait > 0}
          onClick={() => {
            setError('');
            void resendConfirmation(email, next)
              .then(() => {
                setWait(60);
                toast.success(t('We sent the link again.'));
              })
              .catch((err) => setError(message(err)));
          }}
        >
          {wait > 0 ? t('Send again in {seconds} s', { seconds: wait }) : t('Send the link again')}
        </Button>
        <Link
          to="/signin"
          className="text-primary-700 block text-center text-sm font-medium hover:underline"
        >
          {t('Back to sign in')}
        </Link>
      </div>
    </AuthShell>
  );
}

function Forgot({ preset }: { preset: string }) {
  const [email, setEmail] = useState(preset);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidEmail(email)) return setError(t('Check the email address.'));
    setBusy(true);
    try {
      await connectCloud();
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        icon={<MailCheck />}
        title={t('Check your email')}
        description={tr('If {email} has an account, we sent it a link to choose a new password.', {
          email: (
            <strong dir="ltr" className="font-medium text-slate-900">
              {email}
            </strong>
          ),
        })}
      >
        <Link
          to="/signin"
          className="text-primary-700 block text-center text-sm font-medium hover:underline"
        >
          {t('Back to sign in')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={<KeyRound />}
      title={t('Forgot your password?')}
      description={t('Enter your email and we will send you a link to choose a new one.')}
      footer={
        <Link to="/signin" className="hover:text-slate-900 hover:underline">
          {t('Back to sign in')}
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('Email')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              className="rtl:text-end"
              autoFocus
              required
            />
          )}
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('Send the link')}
        </Button>
      </form>
    </AuthShell>
  );
}

/** Opened from the link in a password reset email. */
function Reset() {
  const navigate = useNavigate();
  const { ready, user } = useCloud();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void connectCloud().catch(() => undefined);
  }, []);

  if (!ready) return <Spinner className="min-h-dvh" label={t('Loading…')} />;

  if (!user) {
    return (
      <AuthShell
        icon={<KeyRound />}
        title={t('This link has expired')}
        description={t('Links to reset a password work once, for a short time. Ask for a new one.')}
      >
        <Link
          to="/forgot-password"
          className="text-primary-700 block text-center text-sm font-medium hover:underline"
        >
          {t('Send a new link')}
        </Link>
      </AuthShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) {
      return setError(
        t('Choose a password of at least {count} characters.', { count: MIN_PASSWORD }),
      );
    }
    setBusy(true);
    try {
      await updatePassword(password);
      toast.success(t('Your new password is saved.'));
      navigate('/');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<KeyRound />}
      title={t('Choose a new password')}
      description={tr('For {email}.', {
        email: (
          <strong dir="ltr" className="font-medium text-slate-900">
            {user.email}
          </strong>
        ),
      })}
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field
          label={t('New password')}
          hint={t('At least {count} characters.', { count: MIN_PASSWORD })}
        >
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              autoFocus
            />
          )}
        </Field>
        <FormError>{error}</FormError>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t('Save the new password')}
        </Button>
      </form>
    </AuthShell>
  );
}
