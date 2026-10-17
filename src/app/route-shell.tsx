import { Suspense, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, Outlet, useRouteError } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { CompanyProvider } from './company';
import { Spinner } from '@/components/ui/misc';
import { buttonClass } from '@/components/ui/button';
import SetupPage from '@/pages/setup';
import { t } from '@/i18n';

/**
 * The pieces every app's routes are built from: the company context, pages
 * without navigation (print views) and the error page. Kept apart from the
 * route tables so app modules can use them without importing the router.
 */

export function Root() {
  return (
    <CompanyProvider
      fallback={<Spinner className="min-h-dvh" label={t('Loading…')} />}
      onboarding={<SetupPage firstRun />}
    >
      <Outlet />
    </CompanyProvider>
  );
}

/** Pages without the app's navigation, such as print views. */
export function Bare({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner className="min-h-dvh" />}>{children}</Suspense>;
}

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : t('Unknown error');
  return (
    <div className="bg-page flex min-h-dvh items-center justify-center p-6">
      <div className="bg-surface max-w-md rounded-xl border border-slate-200 p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-10 text-amber-500" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{t('Something went wrong')}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {t('Your data is safe — it is stored in this browser. Try reloading the page.')}
        </p>
        <pre className="mt-4 max-h-32 overflow-auto rounded-md bg-slate-50 p-3 text-start text-xs text-slate-500">
          {message}
        </pre>
        <div className="mt-6 flex justify-center gap-3">
          <button className={buttonClass('outline')} onClick={() => window.location.reload()}>
            {t('Reload')}
          </button>
          <Link to="/" className={buttonClass('primary')} reloadDocument>
            {t('Go to the home page')}
          </Link>
        </div>
      </div>
    </div>
  );
}
