import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Cloud, DatabaseBackup, LogOut, RefreshCw, UserRound, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { useCompany } from '@/app/company';
import { useCloud } from '@/cloud/store';
import { useCloudStatus } from '@/cloud/hooks';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/overlay';
import { SyncStatusLine } from './sync-status';
import { SignOutDialog } from './sign-out-dialog';

/** Initials for an avatar: first letters of the name, or of the email. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    return words
      .slice(0, 2)
      .map((w) => [...w][0]?.toUpperCase() ?? '')
      .join('');
  }
  return (email[0] ?? '?').toUpperCase();
}

export function Avatar({
  name,
  email,
  className,
}: {
  name: string;
  email: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-primary-100 text-primary-800 flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}

/**
 * The bottom of the sidebar: the signed-in person with the sync status of
 * the company, or, for people who keep their books on this device only, a
 * reminder to back up and a way to sign in.
 */
export function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, configured, manager } = useCloud();
  const company = useCompany();
  const status = useCloudStatus(company.id);
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const go = (to: string) => {
    onNavigate?.();
    navigate(to);
  };

  if (!user) {
    return (
      <div className="bg-surface/60 mt-2 rounded-2xl px-3 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-900/5">
        <Link to="/settings/data" onClick={onNavigate} className="group flex items-start gap-2.5">
          <DatabaseBackup className="mt-0.5 size-3.5 shrink-0 text-slate-500" aria-hidden />
          <span>
            {t('Data is stored in this browser.')}{' '}
            <span className="text-primary-700 font-medium group-hover:underline">
              {t('Back up')}
            </span>
          </span>
        </Link>
        {configured ? (
          <Link
            to="/signin"
            onClick={onNavigate}
            className="group mt-1.5 flex items-start gap-2.5 border-t border-slate-900/5 pt-1.5"
          >
            <Cloud className="mt-0.5 size-3.5 shrink-0 text-slate-500" aria-hidden />
            <span className="text-primary-700 font-medium group-hover:underline">
              {t('Sign in to sync across devices')}
            </span>
          </Link>
        ) : null}
      </div>
    );
  }

  const name = user.fullName || user.email;
  const linked = status.kind !== 'local';
  return (
    <>
      <DropdownMenu>
        <DropdownTrigger asChild>
          <button
            type="button"
            className="bg-surface/60 hover:bg-surface mt-2 flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-start ring-1 ring-slate-900/5 transition-colors pointer-coarse:min-h-12"
            aria-label={t('Account: {name}', { name })}
          >
            <Avatar name={user.fullName} email={user.email} />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-sm font-medium text-slate-900">
                {name}
              </span>
              <SyncStatusLine status={status} className="w-full text-xs text-slate-600" />
            </span>
          </button>
        </DropdownTrigger>
        <DropdownContent align="start" className="w-72">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={user.fullName} email={user.email} />
            <span className="min-w-0">
              {user.fullName ? (
                <span dir="auto" className="block truncate text-sm font-medium text-slate-900">
                  {user.fullName}
                </span>
              ) : null}
              <span dir="ltr" className="block truncate text-xs text-slate-500">
                {user.email}
              </span>
            </span>
          </div>
          <DropdownSeparator />
          {linked ? (
            <DropdownItem
              icon={<RefreshCw />}
              onSelect={() => {
                void manager?.syncNow(company.id).then(() => {
                  toast.success(t('Sync finished'));
                });
              }}
            >
              {t('Sync now')}
            </DropdownItem>
          ) : null}
          <DropdownItem icon={<Cloud />} onSelect={() => go('/settings/cloud')}>
            {t('Cloud and sync')}
          </DropdownItem>
          <DropdownItem icon={<UsersRound />} onSelect={() => go('/settings/team')}>
            {t('Team')}
          </DropdownItem>
          <DropdownItem icon={<UserRound />} onSelect={() => go('/settings/account')}>
            {t('Account settings')}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<LogOut />} onSelect={() => setSigningOut(true)}>
            {t('Sign out')}
          </DropdownItem>
        </DropdownContent>
      </DropdownMenu>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
    </>
  );
}
