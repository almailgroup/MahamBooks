import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout } from './layout';
import { Bare, Root, RouteError } from './route-shell';
import SetupPage from '@/pages/setup';
import { booksPrintRoutes, booksRoutes } from '@/apps/books/routes';
import { peoplePrintRoutes, peopleRoutes } from '@/apps/people/routes';
import { crmRoutes } from '@/apps/crm/routes';
import { complianceRoutes } from '@/apps/compliance/routes';

/**
 * Every page of Maham One. Each app brings its own routes
 * (src/apps/<app>/routes.tsx); the suite adds its home, the settings, the
 * account screens and the page for links that lead nowhere. No URL of
 * Maham Books has changed: bookmarks and links in emails still open.
 */

const SuiteHome = lazy(() => import('@/suite/home/index'));
const Settings = lazy(() => import('@/pages/settings/index'));
const Files = lazy(() => import('@/pages/files'));
const Approvals = lazy(() => import('@/pages/approvals'));
const NotFound = lazy(() => import('@/pages/not-found'));
const AuthPage = lazy(() => import('@/pages/account/auth'));
const AuthCallback = lazy(() => import('@/pages/account/callback'));
const InvitePage = lazy(() => import('@/pages/account/invite'));
const CloudCompanies = lazy(() => import('@/pages/account/companies'));

export const routes: RouteObject[] = [
  // Account screens work without a company on this device.
  {
    path: '/signin',
    element: (
      <Bare>
        <AuthPage key="signin" mode="signin" />
      </Bare>
    ),
  },
  {
    path: '/signup',
    element: (
      <Bare>
        <AuthPage key="signup" mode="signup" />
      </Bare>
    ),
  },
  {
    path: '/forgot-password',
    element: (
      <Bare>
        <AuthPage key="forgot" mode="forgot" />
      </Bare>
    ),
  },
  {
    path: '/reset-password',
    element: (
      <Bare>
        <AuthPage key="reset" mode="reset" />
      </Bare>
    ),
  },
  {
    path: '/auth/callback',
    element: (
      <Bare>
        <AuthCallback />
      </Bare>
    ),
  },
  {
    path: '/invite/:token',
    element: (
      <Bare>
        <InvitePage />
      </Bare>
    ),
  },
  {
    path: '/cloud/companies',
    element: (
      <Bare>
        <CloudCompanies />
      </Bare>
    ),
  },
  {
    path: '/',
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      // Print views, without the navigation.
      ...booksPrintRoutes,
      ...peoplePrintRoutes,
      {
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <SuiteHome /> },
          ...booksRoutes,
          ...peopleRoutes,
          ...crmRoutes,
          ...complianceRoutes,
          // Every app's files, listed in Compliance (the document finder).
          { path: 'files', element: <Files /> },
          // Approval requests of every app (Books now, People later).
          { path: 'approvals', element: <Approvals /> },
          { path: 'settings/*', element: <Settings /> },
          { path: 'setup', element: <SetupPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];
