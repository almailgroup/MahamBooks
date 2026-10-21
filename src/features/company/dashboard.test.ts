import { describe, expect, it } from 'vitest';
import type { Company } from '@/db/types';
import { canChooseDashboardLayout, dashboardLayout, withDashboardLayout } from './dashboard';

const company = { id: 'co', name: 'Example Trading' } as Company;

describe('the Books dashboard layout', () => {
  it('is the classic one until the overview is chosen, and for values it doesn’t know', () => {
    expect(dashboardLayout(company)).toBe('classic');
    expect(dashboardLayout({ dashboard: {} })).toBe('classic');
    expect(dashboardLayout({ dashboard: { layout: 'overview' } })).toBe('overview');
    // A newer version's layout.
    expect(dashboardLayout({ dashboard: { layout: 'compact' as never } })).toBe('classic');
  });

  it('is written only when the overview is chosen', () => {
    const overview = withDashboardLayout(company, 'overview');
    expect(overview.dashboard).toEqual({ layout: 'overview' });
    const classic = withDashboardLayout(overview, 'classic');
    expect(classic).toEqual(company);
    expect('dashboard' in classic).toBe(false);
  });

  it('keeps other dashboard settings a newer version saved', () => {
    const newer = { ...company, dashboard: { layout: 'overview', density: 'compact' } } as Company;
    expect(withDashboardLayout(newer, 'classic').dashboard).toEqual({ density: 'compact' });
  });

  it('is chosen by owners and admins, or anyone in a company kept on this device', () => {
    expect(
      [null, 'owner', 'admin', 'accountant', 'staff', 'viewer'].map((r) =>
        canChooseDashboardLayout(r as never),
      ),
    ).toEqual([true, true, true, false, false, false]);
  });
});
