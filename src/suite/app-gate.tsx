import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Eye, Lock } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/misc';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { PeopleGate, useRoleView } from '@/features/cloud/role-gates';
import { useLanguage } from '@/i18n/provider';
import { t } from '@/i18n';
import { appAccess, appById, appTitle, roleAccess } from './apps';
import type { AppId } from './types';

/**
 * The pages of an app, for those who may open it. People keeps its own lock
 * card (salaries are private). An app someone may only look at (Compliance
 * for staff and viewers, or an app the owner made view only for them) is
 * shown with its saving turned off, the same rule the server applies to
 * their changes. Books' pages show at once, as they always have: only a
 * limit of the owner, once known, makes them view only.
 */
export function AppGate({ app, children }: { app: AppId; children: ReactNode }) {
  const view = useRoleView();
  if (app === 'people') {
    return (
      <PeopleGate>
        <Limited app={app}>{children}</Limited>
      </PeopleGate>
    );
  }
  if (app === 'books' && !view.known) return <>{children}</>;
  // Nothing until the role is known.
  if (!view.known) return null;
  return <Limited app={app}>{children}</Limited>;
}

function Limited({ app, children }: { app: AppId; children: ReactNode }) {
  const view = useRoleView();
  const { language } = useLanguage();
  const access = appAccess(app, view.role, view.known, view.permissions);
  const name = appTitle(appById(app), language);
  // Taken away by the owner, not by the role.
  const byOwner = access !== roleAccess(app, view.role);
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
  if (access === 'view' && !view.readOnly.readOnly) {
    return (
      <ReadOnlyContext.Provider value={{ readOnly: true, reason: t('View only in this app') }}>
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
        {children}
      </ReadOnlyContext.Provider>
    );
  }
  return <>{children}</>;
}
