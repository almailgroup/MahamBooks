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
import { addAttachment, createExpense } from '@/db/purchases';
import { createAsset } from '@/db/assets';
import { createSecurityCheque } from '@/db/cheques';
import { isPeopleItem } from './recent';
import { loadLanguage } from '@/i18n';

const keys = (...args: Parameters<typeof staticEntries>) =>
  staticEntries(...args).map((e) => e.key);

describe('the pages and actions search finds', () => {
  it('offer cheque layouts only once the company prints cheques', () => {
    expect(keys(true)).not.toContain('page:/cheques/layouts');
    expect(keys(true, { chequePrinting: true })).toContain('page:/cheques/layouts');
  });

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

  it('offer the compliance and files settings while their switches are off', () => {
    for (const access of [undefined, accessMap('staff')]) {
      expect(keys(true, { access })).toContain('page:/settings/compliance');
    }
  });

  it('show Files only with the document finder', () => {
    expect(keys(true)).not.toContain('page:/files');
    expect(keys(true, { fileFinder: true })).toContain('page:/files');
    expect(keys(true, { fileFinder: true, access: accessMap('staff') })).toContain('page:/files');
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

describe('the document finder', () => {
  const fmt = { money: (n: number) => String(n), date: (d: string | null | undefined) => d ?? '' };
  const PDF = { type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' };

  async function seed() {
    await db.delete();
    await db.open();
    const company = await setupCompany({ name: 'Made-up Guarding' });
    const guard = await saveEmployee(
      createEmployee(company.id, {
        name: 'Ahmad Testing',
        nameAr: 'أحمد التجريبي',
        nationality: 'IN',
        category: 'expat',
        residencyNumber: '18/2024/55',
        residencyExpiry: '2027-03-01',
      }),
    );
    const expense = createExpense(company.id, {
      number: 'EXP-0002',
      description: 'Fuel for the pickup',
      amount: 12.5,
      currency: 'KWD',
    });
    await db.expenses.put(expense);
    const asset = createAsset(company.id, { name: 'Pickup truck', number: 'FA-0001' });
    await db.assets.put(asset);
    const cheque = createSecurityCheque(company.id, {
      number: '445566',
      purpose: 'Rent deposit',
      amount: 500,
      currency: 'KWD',
    });
    await db.securityCheques.put(cheque);
    const sheet = await saveComplianceDocument(
      createComplianceDocument(company.id, { title: 'Guards cost sheet', confidential: true }),
    );
    const receipt = await addAttachment(company.id, expense.id, { name: 'Receipt 12.pdf', ...PDF });
    const contract = await addAttachment(company.id, guard.id, { name: 'Contract.pdf', ...PDF });
    const costs = await addAttachment(company.id, sheet.id, { name: 'Cost sheet.pdf', ...PDF });
    return { company, guard, expense, asset, cheque, receipt, contract, costs };
  }
  const added = /^(file|paper|expense|asset|security):/;

  it('adds nothing to search until it is switched on', async () => {
    const { company } = await seed();
    expect((await recordEntries(company, fmt)).filter((e) => added.test(e.key))).toEqual([]);
  });

  it('finds files, papers on employees’ records, expenses, fixed assets and security cheques', async () => {
    const { company, guard, expense, asset, cheque, receipt, contract } = await seed();
    const found = await recordEntries({ ...company, fileFinder: true }, fmt);
    const first = (query: string) => searchEntries(found, query, 5)[0];

    expect(first('receipt 12')).toMatchObject({ key: `file:${receipt.id}`, kind: 'file' });
    // A file is also found by what it is kept with.
    expect(searchEntries(found, 'exp-0002').map((e) => e.key)).toContain(`file:${receipt.id}`);
    expect(first('fuel')).toMatchObject({
      key: `expense:${expense.id}`,
      to: `/expenses?open=${expense.id}`,
    });
    expect(first('pickup truck')).toMatchObject({ to: `/assets/${asset.id}` });
    expect(first('445566')?.to).toBe('/cheques?tab=security&q=445566');
    expect(searchEntries(found, '445566').map((e) => e.key)).toContain(`security:${cheque.id}`);

    // An employee's residency, by their name in any spelling or its number in any form.
    const residency = `paper:emp:${guard.id}:residency`;
    for (const query of [
      'residency ahmad',
      'احمد',
      'أحمد',
      '18/2024/55',
      '18202455',
      '١٨/٢٠٢٤/٥٥',
    ]) {
      expect(
        searchEntries(found, query).map((e) => e.key),
        query,
      ).toContain(residency);
    }
    const paper = found.find((e) => e.key === residency)!;
    expect(paper).toMatchObject({ kind: 'paper', to: `/employees/${guard.id}` });
    // An employee's files and papers are People data: hidden with them.
    expect(isPeopleItem(paper)).toBe(true);
    const file = found.find((e) => e.key === `file:${contract.id}`)!;
    expect(file.to).toBe(`/employees/${guard.id}`);
    expect(isPeopleItem(file)).toBe(true);
    expect(isPeopleItem(found.find((e) => e.key === `file:${receipt.id}`)!)).toBe(false);
  });

  it('finds an expense and its receipt by whom it was paid to when that isn’t a vendor', async () => {
    const { company } = await seed();
    const fuel = createExpense(company.id, {
      number: 'EXP-0007',
      description: 'Fuel',
      payee: 'Sahara Fuel Station',
      amount: 7,
      currency: 'KWD',
    });
    await db.expenses.put(fuel);
    const scan = await addAttachment(company.id, fuel.id, { name: 'Pump receipt.pdf', ...PDF });
    const found = await recordEntries({ ...company, fileFinder: true }, fmt);
    const hits = searchEntries(found, 'sahara').map((e) => e.key);
    expect(hits).toContain(`expense:${fuel.id}`);
    expect(hits).toContain(`file:${scan.id}`);
    expect(found.find((e) => e.key === `expense:${fuel.id}`)?.subtitle).toContain(
      'Sahara Fuel Station',
    );
  });

  it('finds papers by their Arabic names in the Arabic interface', async () => {
    const { company, guard } = await seed();
    await loadLanguage('ar');
    try {
      const found = await recordEntries({ ...company, fileFinder: true }, fmt);
      const keys = (query: string) => searchEntries(found, query).map((e) => e.key);
      // "الإقامة" written without its hamza, and the name with one.
      expect(keys('اقامه احمد')).toContain(`paper:emp:${guard.id}:residency`);
      // The English name still finds it.
      expect(keys('residency')).toContain(`paper:emp:${guard.id}:residency`);
    } finally {
      await loadLanguage('en');
    }
  });

  it('never offers a confidential paper’s files, nor people’s files to those who don’t see them', async () => {
    const { company, contract, costs, receipt } = await seed();
    const on = { ...company, fileFinder: true };
    const owner = (await recordEntries(on, fmt)).map((e) => e.key);
    expect(owner).toContain(`file:${contract.id}`);
    expect(owner).not.toContain(`file:${costs.id}`);
    const staff = (await recordEntries(on, fmt, { people: false })).map((e) => e.key);
    expect(staff).toContain(`file:${receipt.id}`);
    expect(staff).not.toContain(`file:${contract.id}`);
    expect(staff).not.toContain(`file:${costs.id}`);
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
