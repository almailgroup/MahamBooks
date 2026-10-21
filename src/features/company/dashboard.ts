import type { Company, DashboardSettings } from '@/db/types';
import type { MemberRole } from '@/cloud/roles';

export type DashboardLayout = NonNullable<DashboardSettings['layout']>;

/** The Books dashboard's layout; anything but `overview` (a newer value too) is the classic one. */
export function dashboardLayout(company: Pick<Company, 'dashboard'>): DashboardLayout {
  return company.dashboard?.layout === 'overview' ? 'overview' : 'classic';
}

/**
 * The company with the dashboard laid out as `layout`. Classic leaves the
 * setting out, as before, so only choosing the overview writes it.
 */
export function withDashboardLayout(company: Company, layout: DashboardLayout): Company {
  const { dashboard: old, ...rest } = company;
  const { layout: _layout, ...others } = old ?? {};
  const dashboard: DashboardSettings =
    layout === 'overview' ? { ...others, layout: 'overview' } : others;
  return Object.keys(dashboard).length ? { ...rest, dashboard } : rest;
}

/** Owners and admins choose the layout (and anyone in a company kept on this device only). */
export function canChooseDashboardLayout(role: MemberRole | null | undefined): boolean {
  return role == null || role === 'owner' || role === 'admin';
}
