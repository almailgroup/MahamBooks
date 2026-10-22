import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Eye, Lock } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/misc';
import { ReadOnlyContext, useReadOnly } from '@/components/ui/read-only';
import { PeopleLocked, useRoleView, type RoleView } from '@/features/cloud/role-gates';
import { useLanguage } from '@/i18n/provider';
import { t } from '@/i18n';
import { limitAppOf } from '@/cloud/roles';
import { appAccess, appById, appTitle, roleAccess } from './apps';
import { useCurrentApp } from './current-app';
import type { AppId } from './types';

/**
 * The pages of an app, for those who may open it. People keeps its own lock
 * card (salaries are private). An app someone may only look at (Compliance
 * for staff and viewers, or an app the owner made view only for them) is
 * shown with its saving turned off, the same rule the server applies to
 * their changes. Books' pages show at once, as they always have: only a
 * limit of the owner, once known, makes them view only.
 *
 * The role is read here once and handed down, so the page never sees a
 * guess of it, and Books' page stays the same element while the role is
 * read: it is mounted once, never again when the role becomes known.
 */
export function AppGate({ app, children }: { app: AppId; children: ReactNode }) {
  const view = useRoleView();
  // Nothing until the role is known: a page of salaries must not flash up.
  if (app !== 'books' && !view.known) return null;
  if (app === 'people' && view.peopleHidden) return <PeopleLocked role={view.role} />;
  return (
    <Limited app={app} view={view}>
      {children}
    </Limited>
  );
}

function Limited({ app, view, children }: { app: AppId; view: RoleView; children: ReactNode }) {
  const outer = useReadOnly();
  const { language } = useLanguage();
  // In the split layout Books' pages are also Maham Sales' and Maham
  // Inventory's: named as the app around them, whose limit is Books'.
  const current = useCurrentApp();
  // Not known yet (Books only): the page as it always was, with nothing said.
  const access = view.known ? appAccess(app, view.role, true, view.permissions) : null;
  const name = appTitle(limitAppOf(current.id) === app ? current : appById(app), language);
  // Taken away by the owner, not by the role.
  const byOwner = access !== null && access !== roleAccess(app, view.role);
  if (access === 'none') {
    return (
      <Card className="mx-auto max-w-xl">
        <EmptyState
          icon={<Lock />}
          title={
            byOwner
              ? t('The owner has turned {app} off for you', { app: name })
              : t('{app} is not part of your role', { app: name })
          }
          description={t('Ask the owner of the company if you need it.')}
          action={
            <Link to="/" className={buttonClass('outline')}>
              {t('Go to the home page')}
            </Link>
          }
        />
      </Card>
    );
  }
  const limited = access === 'view' && !view.readOnly.readOnly;
  // The same elements either way, so the page is not mounted again when a
  // limit becomes known.
  return (
    <ReadOnlyContext.Provider
      value={limited ? { readOnly: true, reason: t('View only in this app') } : outer}
    >
      {limited ? (
        <div
          role="status"
          className="mb-5 flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20"
        >
          <Eye className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {byOwner
              ? t(
                  'The owner has made {app} view only for you. Ask the owner if you need to change something.',
                  { app: name },
                )
              : t(
                  'You can look at {app} but not change it. Ask the owner of the company if you need more.',
                  { app: name },
                )}
          </p>
        </div>
      ) : null}
      {children}
    </ReadOnlyContext.Provider>
  );
}
