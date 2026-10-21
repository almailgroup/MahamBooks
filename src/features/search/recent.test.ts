import { describe, expect, it } from 'vitest';
import { isPeopleItem, loadRecent, rememberRecent, type RecentItem } from './recent';

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

describe('recent items', () => {
  /** What the palette of the version before the document finder knows. */
  const OLDER_KINDS = ['page', 'action', 'client', 'vendor', 'item', 'employee', 'document'];
  const stored = (companyId: string) =>
    JSON.parse(localStorage.getItem(`almailbooks.palette.recent:${companyId}`) ?? '[]') as {
      kind: string;
    }[];

  it('are stored with a kind older versions know, and told again by their key', () => {
    localStorage.clear();
    rememberRecent('co', { key: 'file:f1', kind: 'file', title: 'scan.pdf', to: '/files' });
    rememberRecent('co', {
      key: 'paper:emp:e1:residency',
      kind: 'paper',
      title: 'Residency',
      to: '/employees/e1',
    });
    rememberRecent('co', { key: 'client:c1', kind: 'client', title: 'Made-up', to: '/clients/c1' });
    expect(stored('co').every((r) => OLDER_KINDS.includes(r.kind))).toBe(true);
    expect(loadRecent('co').map((r) => `${r.key} ${r.kind}`)).toEqual([
      'client:c1 client',
      'paper:emp:e1:residency paper',
      'file:f1 file',
    ]);
  });

  it('show a kind a newer version saved as a page', () => {
    localStorage.clear();
    localStorage.setItem(
      'almailbooks.palette.recent:co',
      JSON.stringify([{ key: 'thing:1', kind: 'thing', title: 'Made-up', to: '/somewhere' }]),
    );
    expect(loadRecent('co')).toEqual([
      { key: 'thing:1', kind: 'page', title: 'Made-up', to: '/somewhere' },
    ]);
  });
});
