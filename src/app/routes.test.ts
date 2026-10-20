import { describe, expect, it } from 'vitest';
import { matchRoutes, type RouteObject } from 'react-router';
import { routes } from './routes';

/** Every path of the router, written out in full. */
function allPaths(list: RouteObject[], parent = ''): string[] {
  return list.flatMap((route) => {
    const own = route.index
      ? parent || '/'
      : route.path === undefined
        ? parent
        : route.path.startsWith('/')
          ? route.path
          : `${parent.replace(/\/$/, '')}/${route.path}`;
    const here = route.path !== undefined || route.index ? [own] : [];
    return [...here, ...(route.children ? allPaths(route.children, own) : [])];
  });
}

/**
 * The paths Maham Books had before it became part of Maham One. Bookmarks,
 * links in emails and shared links point at them: none may go.
 */
const LEGACY_PATHS = [
  '/signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/invite/:token',
  '/cloud/companies',
  '/',
  '/payments/:id/voucher',
  '/payments-made/:id/voucher',
  '/cheques/print',
  '/payroll/runs/:id/payslips',
  '/payroll/settlements/:id/print',
  '/inventory/count/print',
  '/invoices',
  '/invoices/new',
  '/invoices/:id',
  '/invoices/:id/edit',
  '/quotes',
  '/quotes/new',
  '/quotes/:id',
  '/quotes/:id/edit',
  '/credits',
  '/credits/new',
  '/credits/:id',
  '/credits/:id/edit',
  '/proformas',
  '/proformas/new',
  '/proformas/:id',
  '/proformas/:id/edit',
  '/sales-orders',
  '/sales-orders/new',
  '/sales-orders/:id',
  '/sales-orders/:id/edit',
  '/delivery-notes',
  '/delivery-notes/new',
  '/delivery-notes/:id',
  '/delivery-notes/:id/edit',
  '/recurring',
  '/recurring/new',
  '/recurring/:id',
  '/payments',
  '/payments/new',
  '/payments/:id',
  '/payments/:id/edit',
  '/cheques',
  '/clients',
  '/clients/new',
  '/clients/:id',
  '/clients/:id/edit',
  '/vendors',
  '/vendors/new',
  '/vendors/:id',
  '/vendors/:id/edit',
  '/bills',
  '/bills/new',
  '/bills/:id',
  '/bills/:id/edit',
  '/vendor-credits',
  '/vendor-credits/new',
  '/vendor-credits/:id',
  '/vendor-credits/:id/edit',
  '/purchase-orders',
  '/purchase-orders/new',
  '/purchase-orders/:id',
  '/purchase-orders/:id/edit',
  '/payments-made',
  '/payments-made/new',
  '/payments-made/:id',
  '/payments-made/:id/edit',
  '/expenses',
  '/products',
  '/inventory',
  '/inventory/adjustments/new',
  '/inventory/entries/:id',
  '/inventory/count',
  '/inventory/landed-costs/new',
  '/inventory/landed-costs/:id',
  '/reports',
  '/reports/:report',
  '/accounts',
  '/journals',
  '/journals/new',
  '/journals/:id',
  '/assets',
  '/assets/new',
  '/assets/:id',
  '/assets/:id/edit',
  '/year-end',
  '/banking',
  '/banking/:accountId',
  '/vat',
  '/vat/:start',
  '/employees',
  '/employees/new',
  '/employees/:id',
  '/employees/:id/edit',
  '/employees/:id/settlement',
  '/payroll',
  '/payroll/runs/:id',
  '/payroll/leave',
  '/payroll/loans',
  '/payroll/settings',
  '/compliance',
  '/compliance/documents',
  '/templates',
  '/settings/*',
  '/setup',
  '/*',
];

/** What the suite added. */
const SUITE_PATHS = [
  '/books',
  '/people',
  '/people/directory',
  '/crm',
  '/crm/prospects',
  // Payment vouchers for expenses (#24).
  '/expenses/:id/voucher',
];

/** Real addresses, as bookmarks and emails have them. */
const SAMPLE_URLS = [
  '/',
  '/books',
  '/invoices',
  '/invoices/8c1c7f70-6f1d-4d0e-a3a5-6f0c1c0b9a11',
  '/invoices/8c1c7f70-6f1d-4d0e-a3a5-6f0c1c0b9a11/edit',
  '/quotes/new',
  '/payments-made/p1/voucher',
  '/expenses/x1/voucher',
  '/payroll/runs/r1/payslips',
  '/payroll/settlements/s1/print',
  '/employees/e1/settlement',
  '/reports/profit-and-loss',
  '/banking/acc1',
  '/vat/2026-01-01',
  '/compliance/documents',
  '/settings/alerts',
  '/settings/team',
  '/people',
  '/people/directory',
  '/crm',
  '/crm/prospects',
  '/invite/abc',
];

describe('the routes', () => {
  const paths = new Set(allPaths(routes));

  it('keep every address Maham Books had', () => {
    expect(LEGACY_PATHS.filter((p) => !paths.has(p))).toEqual([]);
  });

  it('add the suite’s pages', () => {
    expect(SUITE_PATHS.filter((p) => !paths.has(p))).toEqual([]);
  });

  it('have each path once', () => {
    const list = allPaths(routes).filter((p) => p !== '/');
    expect(list.filter((p, i) => list.indexOf(p) !== i)).toEqual([]);
  });

  it('open a page for real addresses, not the page for links that lead nowhere', () => {
    const missing = SAMPLE_URLS.filter((url) => {
      const match = matchRoutes(routes, url);
      return !match || match[match.length - 1].route.path === '*';
    });
    expect(missing).toEqual([]);
  });

  it('send unknown addresses to the page for links that lead nowhere', () => {
    const match = matchRoutes(routes, '/no-such-page');
    expect(match?.[match.length - 1].route.path).toBe('*');
  });
});
