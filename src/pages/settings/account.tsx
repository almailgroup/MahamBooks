import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Cloud, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { LANGUAGES, t, type Language } from '@/i18n';
import { useLanguage } from '@/i18n/provider';
import { Button, buttonClass } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/misc';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { MIN_PASSWORD, saveProfile, updatePassword } from '@/cloud/auth';
import { updateCloudUser, useCloud } from '@/cloud/store';
import { Avatar } from '@/features/cloud/account-menu';
import { FormError, PasswordInput } from '@/features/cloud/auth-shell';
import { SignOutDialog } from '@/features/cloud/sign-out-dialog';
import { SettingsSection } from './shared';

const NOT_READ_ONLY = { readOnly: false, reason: '' };

/** The signed-in person: name, language, password, signing out. */
export default function AccountSettings() {
  const { user, configured } = useCloud();
  if (!user) {
    return (
      <SettingsSection title={t('Your account')}>
        <EmptyState
          className="py-8"
          icon={<Cloud />}
          title={t('Keep your books in the cloud')}
          description={
            configured
              ? t(
                  'With an account your companies are safe online, on all your devices and with your team. They still work offline.',
                )
              : t('The cloud is not available in this version of the app.')
          }
          action={
            configured ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/signup" className={buttonClass('primary')}>
                  {t('Create an account')}
                </Link>
                <Link to="/signin" className={buttonClass('outline')}>
                  {t('Sign in')}
                </Link>
              </div>
            ) : null
          }
        />
      </SettingsSection>
    );
  }
  return (
    <ReadOnlyContext.Provider value={NOT_READ_ONLY}>
      <div className="space-y-6">
        <Profile />
        <Password />
        <SignOut />
      </div>
    </ReadOnlyContext.Provider>
  );
}

function Profile() {
  const { user } = useCloud();
  const { language: current, setLanguage } = useLanguage();
  const [name, setName] = useState(user?.fullName ?? '');
  const [language, setChosen] = useState<Language>(user?.language ?? current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const dirty = name.trim() !== user.fullName || language !== user.language;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('Enter your name.'));
    setBusy(true);
    setError('');
    try {
      await saveProfile(user.id, { fullName: name, language });
      updateCloudUser({ fullName: name.trim(), language });
      toast.success(t('Your account is saved.'));
      if (language !== current) void setLanguage(language);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title={t('Your account')}
      description={t('Your name is shown to your team. Your language is used on every device.')}
    >
      <form className="space-y-5" onSubmit={(e) => void save(e)}>
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} email={user.email} className="size-11 text-sm" />
          <div className="min-w-0">
            <p dir="auto" className="truncate font-medium text-slate-900">
              {user.fullName || user.email}
            </p>
            <p dir="ltr" className="truncate text-sm text-slate-500 rtl:text-end">
              {user.email}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Full name')}>
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                dir="auto"
              />
            )}
          </Field>
          <Field label={t('Language')}>
            {(id) => (
              <Select
                id={id}
                value={language}
                onChange={(e) => setChosen(e.target.value as Language)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value} lang={l.value}>
                    {l.nativeLabel}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <FormError>{error}</FormError>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!dirty}>
            {t('Save changes')}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function Password() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      return setError(
        t('Choose a password of at least {count} characters.', { count: MIN_PASSWORD }),
      );
    }
    setBusy(true);
    setError('');
    try {
      await updatePassword(password);
      setPassword('');
      toast.success(t('Your new password is saved.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection title={t('Password')} description={t('Change the password you sign in with.')}>
      <form className="space-y-4" onSubmit={(e) => void save(e)}>
        <Field
          label={t('New password')}
          hint={t('At least {count} characters.', { count: MIN_PASSWORD })}
          className="max-w-sm"
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
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!password}>
            {t('Change password')}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function SignOut() {
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection
      title={t('Sign out')}
      description={t('Sign out on this device. Your other devices stay signed in.')}
      actions={
        <Button variant="outline" onClick={() => setOpen(true)}>
          <LogOut /> {t('Sign out')}
        </Button>
      }
    >
      <p className="text-sm text-slate-600">
        {t('On a shared computer you can also remove your companies from this device.')}
      </p>
      <SignOutDialog open={open} onOpenChange={setOpen} />
    </SettingsSection>
  );
}
