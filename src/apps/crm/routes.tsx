import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { AppGate } from '@/suite/app-gate';

/**
 * Maham CRM's own pages. Customers, quotes and sales orders are Books'
 * pages, listed in CRM's sidebar too (src/apps/crm/manifest.ts).
 */

const Pipeline = lazy(() => import('./pages/pipeline'));
const Prospects = lazy(() => import('./pages/prospects'));

const page = (path: string, element: ReactNode): RouteObject => ({
  path,
  element: <AppGate app="crm">{element}</AppGate>,
});

export const crmRoutes: RouteObject[] = [
  page('crm', <Pipeline />),
  page('crm/prospects', <Prospects />),
];
