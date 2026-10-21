import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { AppGate } from '@/suite/app-gate';

/** Maham Compliance's pages: the deadline calendar, the papers that expire and the vehicles. */

const Compliance = lazy(() => import('./pages/compliance/index'));
const ComplianceDocuments = lazy(() => import('./pages/compliance/documents'));
const ComplianceVehicles = lazy(() => import('./pages/compliance/vehicles'));

const page = (path: string, element: ReactNode): RouteObject => ({
  path,
  element: <AppGate app="compliance">{element}</AppGate>,
});

export const complianceRoutes: RouteObject[] = [
  page('compliance', <Compliance />),
  page('compliance/documents', <ComplianceDocuments />),
  page('compliance/vehicles', <ComplianceVehicles />),
];
