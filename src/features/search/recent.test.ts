import { describe, expect, it } from 'vitest';
import { isPeopleItem, type RecentItem } from './recent';

/** Made-up data only. */

const item = (kind: RecentItem['kind'], to: string): RecentItem => ({
  key: `${kind}:${to}`,
  kind,
  title: 'Made-up',
  to,
});

describe('palette items hidden from staff and viewers', () => {
  it('are employees and the payroll and employee pages', () => {
    expect(isPeopleItem(item('employee', '/employees/e1'))).toBe(true);
    expect(isPeopleItem(item('page', '/payroll'))).toBe(true);
    expect(isPeopleItem(item('page', '/payroll/settings'))).toBe(true);
    expect(isPeopleItem(item('action', '/payroll/leave?employee=e1'))).toBe(true);
    expect(isPeopleItem(item('page', '/employees'))).toBe(true);
    // Maham People's own pages.
    expect(isPeopleItem(item('page', '/people'))).toBe(true);
    expect(isPeopleItem(item('page', '/people/directory?department=Sales'))).toBe(true);
  });

  it('are not the rest', () => {
    expect(isPeopleItem(item('client', '/clients/c1'))).toBe(false);
    expect(isPeopleItem(item('document', '/invoices/i1'))).toBe(false);
    expect(isPeopleItem(item('page', '/payroll-reports'))).toBe(false);
    expect(isPeopleItem(item('page', '/peoples'))).toBe(false);
    expect(isPeopleItem(item('action', '/compliance/documents'))).toBe(false);
  });
});
