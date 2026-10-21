import { afterEach, describe, expect, it } from 'vitest';
import { createCompany } from '@/db/defaults';
import { createEmployee } from '@/db/people';
import type { CloudLink } from '@/cloud/types';
import type { MemberRole } from '@/cloud/roles';
import {
  companyTypesOf,
  departmentsOf,
  employeesCsv,
  findEmployees,
  loadFilters,
  peopleCompanies,
  saveFilters,
  seesPeopleIn,
} from './all-companies';

/** Made-up companies, people and numbers only. */

const ME = 'user-me';

const link = (companyId: string, role: MemberRole, extra: Partial<CloudLink> = {}): CloudLink => ({
  companyId,
  userId: ME,
  role,
  status: 'ready',
  cursor: 0,
  name: companyId,
  linkedAt: '2026-10-01T09:00:00Z',
  lastSyncAt: null,
  lastError: null,
  lastErrorAt: null,
  ...extra,
});

const company = (id: string, name: string, type?: string) =>
  createCompany({
    id,
    name,
    ...(type ? { companyType: { id: type, name: type } } : {}),
  });

const on = (...ids: string[]) => ids.map((companyId) => ({ companyId, groupSearch: true }));

describe('the companies searched across', () => {
  const companies = [
    company('device', 'Made-up Device Co'),
    company('owner', 'Made-up Owner Co'),
    company('admin', 'Made-up Admin Co'),
    company('accountant', 'Made-up Accountant Co'),
    company('staff', 'Made-up Staff Co'),
    company('viewer', 'Made-up Viewer Co'),
    company('removed', 'Made-up Removed Co'),
    company('other', 'Made-up Other Account Co'),
    company('off', 'Made-up Switched Off Co'),
  ];
  const links = [
    link('owner', 'owner'),
    link('admin', 'admin'),
    link('accountant', 'accountant'),
    link('staff', 'staff'),
    link('viewer', 'viewer'),
    link('removed', 'owner', { status: 'removed', removedReason: 'access' }),
    link('other', 'owner', { userId: 'user-someone-else' }),
    link('off', 'owner'),
  ];
  const everyOneOn = on(...companies.filter((c) => c.id !== 'off').map((c) => c.id));

  it('take in companies on this device and those whose role sees people', () => {
    const { eligible, included } = peopleCompanies(companies, links, ME, everyOneOn);
    expect(eligible.map((c) => c.id)).toEqual(['device', 'owner', 'admin', 'accountant', 'off']);
    expect(included.map((c) => c.id)).toEqual(['device', 'owner', 'admin', 'accountant']);
  });

  it('leave staff, viewers, removed companies and another account’s out, even switched on', () => {
    const { included } = peopleCompanies(companies, links, ME, everyOneOn);
    for (const id of ['staff', 'viewer', 'removed', 'other', 'off']) {
      expect(included.map((c) => c.id)).not.toContain(id);
    }
  });

  it('include nothing until a company is switched on (missing means off)', () => {
    const { eligible, included } = peopleCompanies(companies, links, ME, [
      undefined,
      null,
      { companyId: 'owner' },
      { companyId: 'admin', groupSearch: false },
    ]);
    expect(eligible.length).toBe(5);
    expect(included).toEqual([]);
  });

  it('keep only companies on this device when nobody is signed in', () => {
    expect(peopleCompanies(companies, links, null, everyOneOn).included.map((c) => c.id)).toEqual([
      'device',
    ]);
    // Those left out until someone signs in: the owner's, admin's, accountant's and switched off.
    expect(peopleCompanies(companies, links, null, everyOneOn).signedOut).toBe(5);
    expect(peopleCompanies(companies, links, ME, everyOneOn).signedOut).toBe(0);
  });

  it('judge each company by its own link, not by an unknown role', () => {
    expect(seesPeopleIn(null, null)).toBe(true);
    expect(seesPeopleIn(link('x', 'owner'), ME)).toBe(true);
    expect(seesPeopleIn(link('x', 'hr' as MemberRole), ME)).toBe(false);
    expect(seesPeopleIn(link('x', 'owner'), '')).toBe(false);
  });
});

describe('finding employees across companies', () => {
  const trading = company('a', 'Made-up Trading', 'trading');
  const guarding = company('b', 'Made-up Guarding', 'security');
  const hidden = company('c', 'Made-up Hidden Co');
  const people = [
    createEmployee('a', {
      id: 'e1',
      name: 'Test Person One',
      nameAr: 'أحمد التجريبي',
      number: 'EMP-001',
      phone: '+965 5555 0101',
      department: 'Sales',
      category: 'kuwaiti',
    }),
    createEmployee('b', {
      id: 'e2',
      name: 'Test Person Two',
      civilId: '299010100001',
      department: 'Guards',
      category: 'expat',
      jobTitle: 'Guard',
    }),
    createEmployee('b', {
      id: 'e3',
      name: 'Test Person Three',
      status: 'left',
      department: 'Guards',
    }),
    createEmployee('c', { id: 'e4', name: 'Test Person Four' }),
  ];
  const companies = [trading, guarding];
  const ids = (list: { id: string }[]) => list.map((e) => e.id);

  it('show current employees of the companies given, never of another', () => {
    expect(ids(findEmployees(people, companies))).toEqual(['e1', 'e2']);
    expect(ids(findEmployees(people, companies, { view: 'left' }))).toEqual(['e3']);
    expect(ids(findEmployees(people, companies, { view: 'all' }))).toEqual(['e1', 'e3', 'e2']);
    expect(ids(findEmployees(people, [hidden, ...companies], { view: 'all' }))).toContain('e4');
    expect(ids(findEmployees(people, companies, { view: 'all', query: 'four' }))).toEqual([]);
  });

  it('match Arabic names however they are written', () => {
    expect(ids(findEmployees(people, companies, { query: 'احمد' }))).toEqual(['e1']);
    expect(ids(findEmployees(people, companies, { query: 'أَحْمَد التجريبي' }))).toEqual(['e1']);
  });

  it('match phone and Civil ID digits, spaced or in Arabic digits', () => {
    expect(ids(findEmployees(people, companies, { query: '55550101' }))).toEqual(['e1']);
    expect(ids(findEmployees(people, companies, { query: '٥٥٥٥ ٠١٠١' }))).toEqual(['e1']);
    expect(ids(findEmployees(people, companies, { query: '2990101' }))).toEqual(['e2']);
    expect(ids(findEmployees(people, companies, { query: 'emp-001' }))).toEqual(['e1']);
  });

  it('filter by company, company type, department and category', () => {
    expect(ids(findEmployees(people, companies, { companyId: 'b', view: 'all' }))).toEqual([
      'e3',
      'e2',
    ]);
    expect(ids(findEmployees(people, companies, { typeId: 'security' }))).toEqual(['e2']);
    expect(ids(findEmployees(people, companies, { typeId: 'cleaning' }))).toEqual([]);
    expect(ids(findEmployees(people, companies, { department: 'Sales' }))).toEqual(['e1']);
    expect(ids(findEmployees(people, companies, { category: 'expat' }))).toEqual(['e2']);
    // Stateless staff are expatriates with the flag: a filter of their own.
    const stateless = createEmployee('b', {
      id: 'e5',
      name: 'Test Person Six',
      category: 'expat',
      stateless: true,
      nationality: '',
    });
    const all = [...people, stateless];
    expect(ids(findEmployees(all, companies, { category: 'stateless' }))).toEqual(['e5']);
    expect(ids(findEmployees(all, companies, { category: 'expat' }))).toEqual(['e2']);
    expect(employeesCsv([stateless], companies).rows[0]).toContain('Stateless (Bedoon)');
  });

  it('offer the types and departments in use, once each', () => {
    const types = companyTypesOf([trading, guarding, company('d', 'Made-up D', 'trading')], 'en');
    expect(types.map((type) => type.id)).toEqual(['security', 'trading']);
    expect(companyTypesOf([hidden])).toEqual([]);
    expect(departmentsOf(people)).toEqual(['Guards', 'Sales']);
  });

  it('export who works where without salaries, IBANs or Civil IDs', () => {
    const paid = createEmployee('a', {
      name: 'Test Person Five',
      basicSalary: 987.654,
      iban: 'KW00TEST0000000000000000000009',
      civilId: '299010100009',
    });
    const { headers, rows } = employeesCsv([paid], companies);
    expect(headers).toContain('Company');
    expect(headers).not.toContain('IBAN');
    expect(headers).not.toContain('Civil ID number');
    expect(rows[0]).toContain('Made-up Trading');
    expect(rows[0]).toContain('General trading');
    const text = JSON.stringify(rows);
    for (const secret of ['987.654', 'KW00TEST', '299010100009']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('the filters remembered', () => {
  afterEach(() => localStorage.clear());

  it('come back as they were, without what was typed', () => {
    saveFilters({ companyId: 'b', typeId: 'security', view: 'left', query: 'secret' });
    expect(loadFilters()).toEqual({
      companyId: 'b',
      typeId: 'security',
      department: undefined,
      category: undefined,
      view: 'left',
    });
    saveFilters({ category: 'stateless' });
    expect(loadFilters().category).toBe('stateless');
  });

  it('ignore anything they don’t know', () => {
    localStorage.setItem(
      'almailbooks.people.all-companies',
      JSON.stringify({ view: 'sideways', category: 'robot', companyId: 7 }),
    );
    expect(loadFilters()).toEqual({
      companyId: undefined,
      typeId: undefined,
      department: undefined,
      category: undefined,
      view: undefined,
    });
    localStorage.setItem('almailbooks.people.all-companies', '{not json');
    expect(loadFilters()).toEqual({});
  });
});
