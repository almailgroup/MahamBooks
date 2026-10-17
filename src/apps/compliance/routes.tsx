import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { AppGate } from '@/suite/app-gate';

/** Maham Compliance's pages: the deadline calendar and the papers that expire. */

const Compliance = lazy(() => import('./pages/compliance/index'));
const ComplianceDocuments = lazy(() => import('./pages/compliance/documents'));

const page = (path: string, element: ReactNode): RouteObject => ({
  path,
  element: <AppGate app="compliance">{element}</AppGate>,
});

export const complianceRoutes: RouteObject[] = [
  page('compliance', <Compliance />),
  page('compliance/documents', <ComplianceDocuments />),
];
