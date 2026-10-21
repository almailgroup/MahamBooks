import { describe, expect, it } from 'vitest';
import { accessMap } from '@/suite/apps';
import { createCompany } from '@/db/defaults';
import { createEmployee } from '@/db/people';
import type { CloudLink } from '@/cloud/types';
import type { MemberRole } from '@/cloud/roles';
import { peopleCompanies } from '@/features/people/all-companies';
import { searchEntries } from './rank';
import { otherCompanyEmployeeEntries, recordEntries, staticEntries } from './sources';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { saveEmployee } from '@/db/people';
import { createComplianceDocument, saveComplianceDocument } from '@/db/renewals';

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

  it('show Vehicles only with the register’s extras', () => {
    expect(keys(true)).not.toContain('page:/compliance/vehicles');
    expect(keys(true, { registerExtras: true })).toContain('page:/compliance/vehicles');
  });
});

describe('papers of the register', () => {
  const fmt = { money: (n: number) => String(n), date: (d: string | null | undefined) => d ?? '' };

  it('are found with the register’s extras, never confidential ones', async () => {
    await db.delete();
    await db.open();
    const company = await setupCompany({ name: 'Made-up Guarding' });
    const guard = await saveEmployee(createEmployee(company.id, { name: 'Test Guard' }));
    const contract = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'company_contract',
        title: 'Guarding contract, Site A',
        number: 'GC-2026-001',
      }),
    );
    const licence = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: guard.id,
      }),
    );
    await saveComplianceDocument(
      createComplianceDocument(company.id, {
        title: 'Guards cost sheet',
        confidential: true,
      }),
    );
    const papers = (entries: Awaited<ReturnType<typeof recordEntries>>) =>
      entries.filter((e) => e.key.startsWith('paper:'));

    expect(papers(await recordEntries(company, fmt))).toEqual([]);
    const on = { ...company, registerExtras: true };
    const found = papers(await recordEntries(on, fmt));
    expect(found.map((e) => e.key).sort()).toEqual(
      [`paper:${contract.id}`, `paper:${licence.id}`].sort(),
    );
    expect(searchEntries(found, 'gc-2026-001').map((e) => e.to)).toEqual([
      `/compliance/documents?doc=${contract.id}`,
    ]);
    // An employee's paper opens with them.
    expect(found.find((e) => e.key === `paper:${licence.id}`)?.to).toBe(`/employees/${guard.id}`);
  });
});

describe('employees of other companies', () => {
  const me = 'user-me';
  const company = (id: string, name: string) => createCompany({ id, name });
  const link = (companyId: string, role: MemberRole): CloudLink => ({
    companyId,
    userId: me,
    role,
    status: 'ready',
    cursor: 0,
    name: companyId,
    linkedAt: '2026-10-01T09:00:00Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  });
  const companies = [
    company('open', 'Made-up Open Co'),
    company('owned', 'Made-up Owned Co'),
    company('staffed', 'Made-up Staffed Co'),
    company('off', 'Made-up Off Co'),
  ];
  const links = [link('owned', 'owner'), link('staffed', 'staff'), link('off', 'owner')];
  const switchedOn = ['open', 'owned', 'staffed'].map((companyId) => ({
    companyId,
    groupSearch: true,
  }));
  const employees = [
    createEmployee('open', { id: 'e-open', name: 'Test Person Open' }),
    createEmployee('owned', { id: 'e-owned', name: 'Test Person Owned', jobTitle: 'Guard' }),
    createEmployee('owned', { id: 'e-left', name: 'Test Person Left', status: 'left' }),
    createEmployee('staffed', { id: 'e-staffed', name: 'Test Person Staffed' }),
    createEmployee('off', { id: 'e-off', name: 'Test Person Off' }),
  ];

  it('never come from a company the person may not see or didn’t switch on', () => {
    const { included } = peopleCompanies(companies, links, me, switchedOn);
    const entries = otherCompanyEmployeeEntries(employees, included, 'open');
    expect(entries.map((e) => e.key)).toEqual(['elsewhere:e-owned']);
    expect(entries[0]).toMatchObject({
      kind: 'elsewhere',
      companyId: 'owned',
      to: '/employees/e-owned',
      subtitle: 'Made-up Owned Co · Guard',
    });
    expect(searchEntries(entries, 'test person').map((e) => e.key)).toEqual(['elsewhere:e-owned']);
    // Found by the company's name too.
    expect(searchEntries(entries, 'owned co').map((e) => e.key)).toEqual(['elsewhere:e-owned']);
  });

  it('are nothing when no other company is switched on', () => {
    const { included } = peopleCompanies(companies, links, me, [
      { companyId: 'open', groupSearch: true },
    ]);
    expect(otherCompanyEmployeeEntries(employees, included, 'open')).toEqual([]);
    expect(otherCompanyEmployeeEntries(employees, [], 'open')).toEqual([]);
  });
});
