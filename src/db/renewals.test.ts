import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { LockedPeriodError, loadLedger } from './accounting';
import {
  createEmployee,
  getPeopleSettings,
  logDrivingLicencesFiled,
  saveEmployee,
  savePeopleSettings,
} from './people';
import { isPrivateRecord } from '@/cloud/roles';
import {
  clearComplianceMark,
  ComplianceError,
  createComplianceDocument,
  deleteComplianceDocument,
  documentRenewals,
  expiringDocuments,
  fileDrivingLicence,
  loadRegister,
  markComplianceDone,
  renewDocument,
  saveComplianceDocument,
  setDocumentArchived,
  upcomingCompliance,
} from './renewals';
import { setupCompany } from './records';
import { addDaysISO, today } from '@/lib/dates';
import { emptyAddress } from '@/lib/geo';
import { trialBalance } from '@/lib/accounting/statements';
import type { Company, ID } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const inDays = (n: number) => addDaysISO(today(), n);

async function kuwaitCompany(overrides: Partial<Company> = {}) {
  const company = await setupCompany({ name: 'Almail Trading', ...overrides });
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const code = (c: string) => accounts.find((a) => a.code === c)!;
  return { company, code };
}

async function expatWithResidency(companyId: ID, expiry = inDays(20)) {
  return saveEmployee(
    createEmployee(companyId, {
      name: 'Ravi Kumar',
      nameAr: 'رافي كومار',
      nationality: 'IN',
      category: 'expat',
      residencyArticle: '18',
      residencyNumber: '18/2024/55',
      residencyExpiry: expiry,
      basicSalary: 450,
    }),
  );
}

/** Ledger lines of one source record, as "code amount" in fils (debits positive). */
async function postings(company: Company, sourceId: ID) {
  const { lines, accounts } = await loadLedger(company);
  const codes = new Map(accounts.map((a) => [a.id, a.code]));
  return lines
    .filter((l) => l.sourceId === sourceId)
    .map((l) => `${codes.get(l.accountId)} ${l.amount}`)
    .sort();
}

async function balanced(company: Company) {
  const { lines, accounts } = await loadLedger(company);
  const tb = trialBalance(lines, accounts, inDays(400), { month: 12, day: 31 });
  return tb.totalDebit === tb.totalCredit;
}

describe('the documents register', () => {
  it('lists employee papers without copying them', async () => {
    const { company } = await kuwaitCompany();
    const employee = await expatWithResidency(company.id);
    const { entries } = await loadRegister(company.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: `emp:${employee.id}:residency`,
      type: 'residency',
      expiryDate: inDays(20),
    });
    expect(await db.complianceDocuments.count()).toBe(0);

    const expiring = await expiringDocuments(company.id, 30);
    expect(expiring).toHaveLength(1);
    expect(expiring[0].info).toMatchObject({ status: 'expiring', daysLeft: 20, reminder: 30 });
    expect(expiring[0].employee?.name).toBe('Ravi Kumar');
    expect(await expiringDocuments(company.id, 10)).toHaveLength(0);
  });

  it('checks register records', async () => {
    const { company } = await kuwaitCompany();
    await expect(
      saveComplianceDocument(createComplianceDocument(company.id, { type: 'residency' })),
    ).rejects.toThrow(ComplianceError);
    await expect(
      saveComplianceDocument(
        createComplianceDocument(company.id, { type: 'driving_licence', ownerType: 'employee' }),
      ),
    ).rejects.toThrow('Choose the employee');
    await expect(
      saveComplianceDocument(
        createComplianceDocument(company.id, {
          type: 'vehicle_registration',
          ownerType: 'vehicle',
        }),
      ),
    ).rejects.toThrow('plate number');
    await expect(
      saveComplianceDocument(
        createComplianceDocument(company.id, {
          issueDate: '2026-05-01',
          expiryDate: '2026-04-01',
        }),
      ),
    ).rejects.toThrow('before the issue date');
    const saved = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'commercial_licence',
        title: ' Main licence ',
        renewalCost: 12.3456,
        reminderDays: [7, 90],
      }),
    );
    expect(saved).toMatchObject({
      title: 'Main licence',
      renewalCost: 12.346,
      reminderDays: [90, 7],
    });
  });
});

describe('drivers’ licences', () => {
  const scan = (name: string) => ({ name, type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,' });

  async function driver(companyId: ID, overrides = {}) {
    return saveEmployee(
      createEmployee(companyId, {
        name: 'Made-up Driver',
        jobTitle: 'Bus Driver',
        jobTitleAr: 'سائق حافلة',
        ...overrides,
      }),
    );
  }

  it('flags drivers without a valid licence only once the company checks them', async () => {
    const { company } = await kuwaitCompany();
    const someone = await driver(company.id);
    // Off, as before: nothing is flagged.
    expect(await loadRegister(company.id)).toMatchObject({ drivingLicences: false, missing: [] });

    await savePeopleSettings({ ...(await getPeopleSettings(company.id)), drivingLicences: true });
    const register = await loadRegister(company.id);
    expect(register.drivingLicences).toBe(true);
    expect(register.missing).toEqual([
      { employeeId: someone.id, type: 'driving_licence', reason: 'missing', document: null },
    ]);

    const licence = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: someone.id,
        expiryDate: inDays(20),
      }),
    );
    expect((await loadRegister(company.id)).missing).toEqual([]);
    await saveComplianceDocument({ ...licence, expiryDate: inDays(-1) });
    expect((await loadRegister(company.id)).missing).toMatchObject([
      { employeeId: someone.id, reason: 'expired', document: { id: licence.id } },
    ]);
    // Set as not driving for work: nothing missing.
    await saveEmployee({ ...someone, drivingLicenceRequired: false });
    expect((await loadRegister(company.id)).missing).toEqual([]);
  });

  it('keeps the class of a driving licence only', async () => {
    const { company } = await kuwaitCompany();
    const someone = await driver(company.id);
    const saved = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: someone.id,
        licenceClass: ' Heavy ',
      }),
    );
    expect(saved.licenceClass).toBe('Heavy');
    const insurance = await saveComplianceDocument({ ...saved, type: 'health_insurance' });
    expect(insurance.licenceClass).toBe('');
    // Documents saved without one get none.
    const other = await saveComplianceDocument(
      createComplianceDocument(company.id, { type: 'commercial_licence' }),
    );
    expect(other).not.toHaveProperty('licenceClass');
  });

  it('files scans on the employee’s licence, adding one without dates when there is none', async () => {
    const { company } = await kuwaitCompany();
    const someone = await driver(company.id);
    const logged = await db.activities.count();

    const first = await fileDrivingLicence(someone.id, scan('licence front.jpg'));
    expect(first).toMatchObject({
      type: 'driving_licence',
      ownerType: 'employee',
      employeeId: someone.id,
      expiryDate: null,
    });
    const second = await fileDrivingLicence(someone.id, scan('licence back.jpg'));
    expect(second.id).toBe(first.id);
    expect(
      (await db.attachments.where('ownerId').equals(first.id).toArray()).map((a) => a.name).sort(),
    ).toEqual(['licence back.jpg', 'licence front.jpg']);
    // Nothing in the personnel file, and nothing logged here (the dialog logs once).
    expect(await db.attachments.where('ownerId').equals(someone.id).count()).toBe(0);
    expect(await db.activities.count()).toBe(logged);

    // A renewed licence that expires later gets the next scans.
    const renewed = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: someone.id,
        expiryDate: inDays(900),
      }),
    );
    await saveComplianceDocument({ ...first, expiryDate: inDays(-30) });
    expect((await fileDrivingLicence(someone.id, scan('new.jpg'))).id).toBe(renewed.id);
    await expect(fileDrivingLicence('nobody', scan('x.jpg'))).rejects.toThrow(ComplianceError);
  });

  it('logs the scans filed at once, as people data', async () => {
    const { company } = await kuwaitCompany();
    const filed = () =>
      db.activities
        .where('companyId')
        .equals(company.id)
        .filter((a) => a.action === 'files')
        .toArray();
    await logDrivingLicencesFiled(company.id, 0, 0);
    expect(await filed()).toHaveLength(0);
    await logDrivingLicencesFiled(company.id, 3, 2);
    const [entry] = await filed();
    expect(entry).toMatchObject({
      entity: 'employee',
      messageKey: '{count} scans filed as the driving licences of {employees} employees',
      messageVars: { count: 3, employees: 2 },
    });
    expect(isPrivateRecord('activities', entry as unknown as Record<string, unknown>)).toBe(true);
  });
});

describe('renewing', () => {
  it('moves an employee’s residency and records the fee as an expense in 6090', async () => {
    const { company, code } = await kuwaitCompany();
    const employee = await expatWithResidency(company.id);
    const newExpiry = inDays(20 + 365);

    const { renewal, expense } = await renewDocument({
      companyId: company.id,
      key: `emp:${employee.id}:residency`,
      newExpiry,
      renewedOn: today(),
      fee: { amount: 10.0004, accountId: null, paidFromAccountId: null },
      note: 'Renewed at the residency office',
    });

    expect((await db.employees.get(employee.id))?.residencyExpiry).toBe(newExpiry);
    // The details stay on the renewal, which only payroll roles see...
    expect(renewal).toMatchObject({
      employeeId: employee.id,
      type: 'residency',
      previousExpiry: inDays(20),
      newExpiry,
      fee: 10,
      expenseId: expense?.id,
      number: '18/2024/55',
      note: 'Renewed at the residency office',
    });
    // ...not on the expense, which staff and viewers see.
    expect(expense).toMatchObject({
      accountId: code('6090').id,
      amount: 10,
      currency: 'KWD',
      date: today(),
      description: 'Document renewal fee',
      reference: '',
      notes: '',
    });
    expect(expense?.number).toMatch(/^EXP-\d{4}-0001$/);
    // Dr 6090 Government fees 10.000, Cr 1000 Bank 10.000 (in fils).
    expect(await postings(company, expense!.id)).toEqual(['1000 -10000', '6090 10000']);
    expect(await balanced(company)).toBe(true);

    // The residency is valid again and the renewal is on file.
    expect(await expiringDocuments(company.id, 60)).toHaveLength(0);
    expect(await documentRenewals(`emp:${employee.id}:residency`)).toHaveLength(1);
  });

  it('can pay the fee in cash and change the document number', async () => {
    const { company, code } = await kuwaitCompany();
    const employee = await saveEmployee(
      createEmployee(company.id, {
        name: 'Ana Santos',
        category: 'expat',
        nationality: 'PH',
        passportNumber: 'P111',
        passportExpiry: inDays(5),
      }),
    );
    const { expense } = await renewDocument({
      companyId: company.id,
      key: `emp:${employee.id}:passport`,
      newExpiry: inDays(3650),
      renewedOn: today(),
      number: 'P222',
      fee: { amount: 25.5, accountId: null, paidFromAccountId: code('1010').id },
    });
    expect(await db.employees.get(employee.id)).toMatchObject({
      passportNumber: 'P222',
      passportExpiry: inDays(3650),
    });
    expect(await postings(company, expense!.id)).toEqual(['1010 -25500', '6090 25500']);
  });

  it('renews a commercial licence into 6100 and needs no expense without a fee', async () => {
    const { company, code } = await kuwaitCompany();
    const licence = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'commercial_licence',
        number: 'CL-1',
        issueDate: inDays(-700),
        expiryDate: inDays(30),
      }),
    );
    const { expense } = await renewDocument({
      companyId: company.id,
      key: `doc:${licence.id}`,
      newExpiry: inDays(30 + 730),
      renewedOn: today(),
      fee: { amount: 120, accountId: null, paidFromAccountId: null },
    });
    expect(expense?.accountId).toBe(code('6100').id);
    expect(await db.complianceDocuments.get(licence.id)).toMatchObject({
      expiryDate: inDays(760),
      issueDate: today(),
      renewalCost: 120,
    });

    const again = await renewDocument({
      companyId: company.id,
      key: `doc:${licence.id}`,
      newExpiry: inDays(30 + 1095),
      renewedOn: today(),
      fee: { amount: 0, accountId: null, paidFromAccountId: null },
    });
    expect(again.expense).toBeNull();
    expect(await db.expenses.count()).toBe(1);
    expect(await documentRenewals(`doc:${licence.id}`)).toHaveLength(2);
    expect(await balanced(company)).toBe(true);
  });

  it('creates the fee account in a company on another chart', async () => {
    const { company } = await kuwaitCompany({
      address: emptyAddress('AE'),
      currency: 'AED',
      locale: 'en-AE',
    });
    // The UAE chart uses 6090 for office supplies.
    const supplies = await db.accounts
      .where('[companyId+code]')
      .equals([company.id, '6090'])
      .first();
    expect(supplies?.name).toBe('Office supplies');
    const employee = await expatWithResidency(company.id);
    const { expense } = await renewDocument({
      companyId: company.id,
      key: `emp:${employee.id}:residency`,
      newExpiry: inDays(400),
      renewedOn: today(),
      fee: { amount: 100, accountId: null, paidFromAccountId: null },
    });
    const account = await db.accounts.get(expense!.accountId);
    expect(account).toMatchObject({
      code: '6091',
      name: 'Government fees, visas and residency',
      nameAr: 'الرسوم الحكومية والتأشيرات والإقامات',
      type: 'expense',
    });

    // The next renewal reuses it.
    const second = await renewDocument({
      companyId: company.id,
      key: `emp:${employee.id}:residency`,
      newExpiry: inDays(800),
      renewedOn: today(),
      fee: { amount: 100, accountId: null, paidFromAccountId: null },
    });
    expect(second.expense?.accountId).toBe(account!.id);
    expect(await balanced(company)).toBe(true);
  });

  it('refuses an earlier expiry date and a fee in a locked period, changing nothing', async () => {
    const { company } = await kuwaitCompany();
    const employee = await expatWithResidency(company.id);
    await expect(
      renewDocument({
        companyId: company.id,
        key: `emp:${employee.id}:residency`,
        newExpiry: inDays(10),
        renewedOn: today(),
      }),
    ).rejects.toThrow('must be after the current one');

    await db.companies.update(company.id, {
      accounting: { ...company.accounting!, lockDate: today() },
    });
    await expect(
      renewDocument({
        companyId: company.id,
        key: `emp:${employee.id}:residency`,
        newExpiry: inDays(400),
        renewedOn: today(),
        fee: { amount: 10, accountId: null, paidFromAccountId: null },
      }),
    ).rejects.toThrow(LockedPeriodError);
    expect((await db.employees.get(employee.id))?.residencyExpiry).toBe(inDays(20));
    expect(await db.renewals.count()).toBe(0);
    expect(await db.expenses.count()).toBe(0);
  });

  it('keeps renewed documents: they are archived, not deleted', async () => {
    const { company } = await kuwaitCompany();
    const doc = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'vehicle_registration',
        ownerType: 'vehicle',
        ownerName: 'Toyota Hiace 12/34567',
        expiryDate: inDays(3),
      }),
    );
    await renewDocument({
      companyId: company.id,
      key: `doc:${doc.id}`,
      newExpiry: inDays(368),
      renewedOn: today(),
    });
    await expect(deleteComplianceDocument(doc.id)).rejects.toThrow('Archive it instead');
    await setDocumentArchived(doc.id, true);
    expect((await loadRegister(company.id)).entries).toHaveLength(0);

    const mistake = await saveComplianceDocument(createComplianceDocument(company.id));
    await deleteComplianceDocument(mistake.id);
    expect(await db.complianceDocuments.get(mistake.id)).toBeUndefined();
  });
});

describe('the compliance calendar', () => {
  it('shows expiring documents and statutory deadlines, and remembers what is done', async () => {
    const { company } = await kuwaitCompany({
      kuwait: {
        legalForm: 'kscc',
        licenceNumber: '',
        activity: 'general',
        foreignOwnershipPercent: 0,
        capital: 0,
        pamFileNumber: '',
        pifssEmployerNumber: '',
        mofTaxCardNumber: '',
        kcciNumber: '',
        digitalCommerceNumber: '',
        wamdPhone: '',
      },
    });
    await expatWithResidency(company.id);
    await saveEmployee(createEmployee(company.id, { name: 'Fatima', category: 'kuwaiti' }));

    const items = await upcomingCompliance(company, today(), 400);
    const residency = items.find((i) => i.entry?.type === 'residency');
    expect(residency).toMatchObject({ status: 'due_soon', daysLeft: 20 });
    const rules = new Set(items.map((i) => i.deadline?.rule).filter(Boolean));
    // A Kuwaiti staff member brings PIFSS; a closed shareholding company Zakat and KFAS.
    expect([...rules].sort()).toEqual(['audited_statements', 'kfas', 'pifss', 'zakat']);

    const pifss = items.find((i) => i.deadline?.rule === 'pifss')!;
    await markComplianceDone(company.id, pifss.key);
    const after = await upcomingCompliance(company, today(), 400);
    expect(after.find((i) => i.key === pifss.key)?.status).toBe('done');
    await clearComplianceMark(company.id, pifss.key);
    expect(
      (await upcomingCompliance(company, today(), 400)).find((i) => i.key === pifss.key)?.status,
    ).not.toBe('done');
  });
});
