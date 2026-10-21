import { Check, Eye, Minus, PencilLine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MEMBER_ROLES, ROLE_LABELS, type MemberRole } from '@/cloud/roles';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/misc';
import { useLanguage } from '@/i18n/provider';
import { msg, t } from '@/i18n';
import { APPS, appAccess, appTitle } from './apps';
import type { AppAccess } from './types';

/** What each level means, in a word. */
export const ACCESS_LABELS: Record<AppAccess, string> = {
  none: msg('No access'),
  view: msg('View only'),
  edit: msg('Works in it'),
  manage: msg('Full access'),
};

export const ACCESS_ICONS: Record<AppAccess, LucideIcon> = {
  none: Minus,
  view: Eye,
  edit: PencilLine,
  manage: Check,
};

/** Literal class names, so Tailwind and the theme check see every one. */
export const ACCESS_TONES: Record<AppAccess, string> = {
  none: 'text-slate-400',
  view: 'text-slate-600',
  edit: 'text-sky-700',
  manage: 'text-emerald-700',
};

/**
 * Which apps of Maham One each role opens, and what it may do there. The
 * same rules the app and the cloud apply; `mine` marks the reader's role.
 */
export function AccessGrid({ mine }: { mine?: MemberRole | null }) {
  const { language } = useLanguage();
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{t('What each role can open')}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-start text-xs text-slate-500">
            <th scope="col" className="px-4 py-2 text-start font-medium sm:ps-0">
              {t('Role')}
            </th>
            {APPS.map((app) => (
              <th key={app.id} scope="col" className="px-3 py-2 text-start font-medium">
                {appTitle(app, language)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {MEMBER_ROLES.map((role) => (
            <tr key={role} className={cn(role === mine && 'bg-primary-50/60')}>
              <th scope="row" className="px-4 py-2.5 text-start font-medium text-slate-800 sm:ps-0">
                {t(ROLE_LABELS[role])}
                {role === mine ? (
                  <Badge tone="blue" className="ms-1.5">
                    {t('You')}
                  </Badge>
                ) : null}
              </th>
              {APPS.map((app) => {
                const access = appAccess(app.id, role);
                const Icon = ACCESS_ICONS[access];
                return (
                  <td key={app.id} className={cn('px-3 py-2.5', ACCESS_TONES[access])}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {t(ACCESS_LABELS[access])}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
