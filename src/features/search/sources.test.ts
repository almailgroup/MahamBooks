import { describe, expect, it } from 'vitest';
import { accessMap } from '@/suite/apps';
import { searchEntries } from './rank';
import { staticEntries } from './sources';

const keys = (...args: Parameters<typeof staticEntries>) =>
  staticEntries(...args).map((e) => e.key);

describe('the pages and actions search finds', () => {
  it('cover every app for the owner, each page once', () => {
    const all = keys(true);
    expect(all.filter((k, i) => all.indexOf(k) !== i)).toEqual([]);
    for (const key of [
      'page:/',
      'app:books',
      'app:people',
      'app:crm',
      'app:compliance',
      'page:/books',
      'page:/people',
      'page:/people/directory',
      'page:/crm',
      'page:/crm/prospects',
      'page:/compliance',
      'page:/invoices',
      'page:/payroll',
      'page:/settings/team',
      'action:invoice',
      'action:employee',
      'action:payroll-leave',
    ]) {
      expect(all).toContain(key);
    }
  });

  it('leave out People for staff and viewers, and creating for viewers', () => {
    for (const role of ['staff', 'viewer'] as const) {
      const found = keys(true, { access: accessMap(role) });
      expect(
        found.filter((k) => /\/(people|employees|payroll)\b|employee|payroll/.test(k)),
      ).toEqual([]);
      expect(found).toContain('page:/invoices');
    }
    expect(keys(true, { access: accessMap('staff') })).toContain('action:invoice');
    expect(
      keys(true, { access: accessMap('viewer') }).filter((k) => k.startsWith('action:')),
    ).toEqual([
      'action:cheques-week',
      'action:cheques-issued-week',
      'action:overdue-invoices',
      'action:low-stock',
      'action:expiring',
      'action:stock-count',
    ]);
  });

  it('offer nothing to create to someone who can no longer change the company', () => {
    const found = keys(true, { access: accessMap('accountant'), create: false });
    expect(found).not.toContain('action:invoice');
    expect(found).not.toContain('action:employee');
    expect(found).toContain('page:/invoices');
  });

  it('find each app, and the page at the same address by its own name', () => {
    const entries = staticEntries(true);
    const first = (q: string) => searchEntries(entries, q, 5)[0]?.key;
    expect(first('maham people')).toBe('app:people');
    expect(first('dashboard')).toBe('page:/books');
    expect(first('deadlines')).toBe('page:/compliance');
    expect(first('payroll')).toBe('page:/payroll');
    expect(first('directory')).toBe('page:/people/directory');
    expect(first('pipeline')).toBe('page:/crm');
  });

  it('show VAT returns only when taxes are on', () => {
    expect(keys(true)).toContain('page:/vat');
    expect(keys(false)).not.toContain('page:/vat');
  });
});
