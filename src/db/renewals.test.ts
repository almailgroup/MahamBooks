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
  addDocumentPurpose,
  clearComplianceMark,
  ComplianceError,
  createComplianceDocument,
  deleteComplianceDocument,
  documentRenewals,
  expiringDocuments,
  fileDrivingLicence,
  FilesNotHereError,
  loadRegister,
  makeDocumentConfidential,
  markComplianceDone,
  renewDocument,
  saveComplianceDocument,
  saveDocumentPurposes,
  setDocumentArchived,
  setRegisterExtras,
  upcomingCompliance,
} from './renewals';
import { addAttachment } from './purchases';
import { createClient } from './defaults';
import { saveClient, setupCompany } from './records';
import { registerExtrasOn } from '@/lib/compliance';
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

  it('keeps a driver flagged after a scan is filed as their licence, until its dates are in', async () => {
    const { company } = await kuwaitCompany();
    const someone = await driver(company.id);
    await savePeopleSettings({ ...(await getPeopleSettings(company.id)), drivingLicences: true });
    // The scan makes a licence without dates: not a valid licence yet.
    const filed = await fileDrivingLicence(someone.id, scan('any scan.jpg'));
    expect((await loadRegister(company.id)).missing).toMatchObject([
      { employeeId: someone.id, reason: 'undated', document: { id: filed.id } },
    ]);
    await saveComplianceDocument({ ...filed, expiryDate: inDays(365) });
    expect((await loadRegister(company.id)).missing).toEqual([]);
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

/* -------------------------------------------------------------------------- */
/* The register's extras (#17)                                                */
/* -------------------------------------------------------------------------- */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The company as linked to the cloud, with what its server has. */
async function inTheCloud(companyId: ID, features?: string[]) {
  await db.syncState.put({
    companyId,
    userId: 'user-owner',
    role: 'owner',
    status: 'ready',
    cursor: 0,
    name: 'Made-up Trading',
    linkedAt: '2026-10-01T00:00:00Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    ...(features ? { features } : {}),
  });
}

const customer = (companyId: ID, name = 'Made-up Customer Co.') =>
  saveClient(createClient(companyId, { name }));

describe('the register’s extras', () => {
  it('keep a customer’s paper under Other, with the customer’s name for older versions', async () => {
    const { company } = await kuwaitCompany();
    const client = await customer(company.id);
    const doc = await saveComplianceDocument(
      createComplianceDocument(company.id, {
        ownerType: 'other',
        clientId: client.id,
        type: 'client_contract',
        title: 'Guarding contract, site A',
      }),
    );
    expect(doc).toMatchObject({ clientId: client.id, ownerName: 'Made-up Customer Co.' });
    expect((await loadRegister(company.id)).entries[0]).toMatchObject({ clientId: client.id });
    // Moved to the company, it no longer belongs to the customer.
    const moved = await saveComplianceDocument({
      ...doc,
      ownerType: 'company',
      type: 'company_contract',
    });
    expect(moved.clientId).toBeNull();
    // A document saved as before gets none of the new fields.
    const plain = await saveComplianceDocument(createComplianceDocument(company.id));
    for (const field of ['clientId', 'vehicleId', 'purposeId', 'confidential']) {
      expect(plain).not.toHaveProperty(field);
    }
  });

  it('check the customer, the vehicle, the purpose and the title of a contract', async () => {
    const { company } = await kuwaitCompany();
    const other = await setupCompany({ name: 'Another Company' });
    const stranger = await customer(other.id, 'Their Customer');
    const doc = (overrides: Parameters<typeof createComplianceDocument>[1]) =>
      saveComplianceDocument(createComplianceDocument(company.id, overrides));
    await expect(
      doc({ ownerType: 'other', clientId: stranger.id, type: 'client_contract', title: 'X' }),
    ).rejects.toThrow('Choose a customer of this company.');
    await expect(doc({ ownerType: 'other', type: 'customer_cost', title: 'X' })).rejects.toThrow(
      'Choose the customer the document belongs to.',
    );
    await expect(doc({ type: 'company_contract' })).rejects.toThrow('Enter the document’s title.');
    await expect(doc({ ownerType: 'vehicle', vehicleId: 'no-such-vehicle' })).rejects.toThrow(
      'Choose a vehicle of this company.',
    );
    await expect(doc({ purposeId: 'no-such-purpose' })).rejects.toThrow(
      'Choose a purpose from the list.',
    );
    expect(await db.complianceDocuments.count()).toBe(0);
  });

  it('add a customer’s cost sheet only where it can be kept confidential', async () => {
    const { company } = await kuwaitCompany();
    const client = await customer(company.id);
    const sheet = createComplianceDocument(company.id, {
      ownerType: 'other',
      clientId: client.id,
      type: 'customer_cost',
      title: 'Guards cost sheet',
    });
    // A server without the migration would give it to staff and viewers.
    await inTheCloud(company.id, []);
    await expect(saveComplianceDocument(sheet)).rejects.toThrow(
      'The cloud needs the latest database script first.',
    );
    const contract = await saveComplianceDocument({ ...sheet, type: 'client_contract' });
    await expect(saveComplianceDocument({ ...contract, type: 'customer_cost' })).rejects.toThrow(
      'The cloud needs the latest database script first.',
    );
    // Once it has the migration, it is added (the form ticks Confidential for it).
    await inTheCloud(company.id, ['tables_v16']);
    const another = createComplianceDocument(company.id, {
      ownerType: 'other',
      clientId: client.id,
      type: 'customer_cost',
      title: 'Guards cost sheet',
      confidential: true,
    });
    await expect(saveComplianceDocument(another)).resolves.toMatchObject({
      type: 'customer_cost',
      confidential: true,
    });
  });

  it('keep purposes in both languages, archived and never removed', async () => {
    const { company } = await kuwaitCompany();
    const tenders = await addDocumentPurpose(company.id, {
      name: ' Tenders ',
      nameAr: 'المناقصات',
    });
    expect(tenders).toMatchObject({ name: 'Tenders', nameAr: 'المناقصات' });
    // The same purpose typed again, in either language, is that one.
    expect((await addDocumentPurpose(company.id, { name: 'tenders' })).id).toBe(tenders.id);
    expect((await addDocumentPurpose(company.id, { name: '', nameAr: 'المناقصات' })).id).toBe(
      tenders.id,
    );
    const doc = await saveComplianceDocument(
      createComplianceDocument(company.id, { purposeId: tenders.id }),
    );
    // An empty new row is dropped; archived, the purpose stays with its documents.
    await saveDocumentPurposes(company.id, [
      { ...tenders, archived: true },
      { id: 'blank', name: ' ', nameAr: '' },
    ]);
    expect((await db.companies.get(company.id))!.documentPurposes).toEqual([
      { ...tenders, archived: true },
    ]);
    await expect(saveComplianceDocument({ ...doc, notes: 'Kept' })).resolves.toMatchObject({
      purposeId: tenders.id,
    });
    // Added again, it is restored.
    expect(await addDocumentPurpose(company.id, { name: 'Tenders' })).toEqual(tenders);
    await expect(
      saveDocumentPurposes(company.id, [tenders, { id: 'twice', name: 'TENDERS', nameAr: '' }]),
    ).rejects.toThrow('There is already a purpose called Tenders.');
  });

  it('are switched on and off by the company, and logged', async () => {
    const { company } = await kuwaitCompany();
    expect(registerExtrasOn(company)).toBe(false);
    await setRegisterExtras(company.id, true);
    await setRegisterExtras(company.id, true);
    expect(registerExtrasOn(await db.companies.get(company.id))).toBe(true);
    await setRegisterExtras(company.id, false);
    const logged = (await db.activities.where('entityId').equals(company.id).toArray())
      .filter((a) => a.action === 'updated')
      .map((a) => a.message)
      .sort();
    // Once each: switching on what is on logs nothing.
    expect(logged).toEqual([
      'Contracts, customers and vehicles switched off in the register',
      'Contracts, customers and vehicles switched on in the register',
    ]);
  });

  it('count each document’s files', async () => {
    const { company } = await kuwaitCompany();
    const scanned = await saveComplianceDocument(createComplianceDocument(company.id));
    const bare = await saveComplianceDocument(createComplianceDocument(company.id));
    for (const name of ['front.png', 'back.png']) {
      await addAttachment(company.id, scanned.id, { name, type: 'image/png', dataUrl: PNG });
    }
    const { files } = await loadRegister(company.id);
    expect(files.get(scanned.id)).toBe(2);
    expect(files.get(bare.id)).toBeUndefined();
  });
});

describe('making a document confidential', () => {
  async function withHistory(companyId: ID) {
    const doc = await saveComplianceDocument(
      createComplianceDocument(companyId, {
        type: 'other',
        title: 'Guards cost sheet',
        number: 'CS-0001',
        expiryDate: inDays(30),
      }),
    );
    const scan = await addAttachment(companyId, doc.id, {
      name: 'cost-sheet.png',
      type: 'image/png',
      dataUrl: PNG,
    });
    await db.attachments.update(scan.id, { docKey: `doc:${doc.id}` });
    const { renewal, expense } = await renewDocument({
      companyId,
      key: `doc:${doc.id}`,
      renewedOn: today(),
      newExpiry: inDays(400),
      note: 'For the new site',
      fee: { amount: 25, accountId: null, paidFromAccountId: null },
    });
    return { doc: (await db.complianceDocuments.get(doc.id))!, scan, renewal, expense: expense! };
  }

  it('only marks it in a company kept on this device', async () => {
    const { company } = await kuwaitCompany();
    const { doc, renewal, expense } = await withHistory(company.id);
    expect(expense).toMatchObject({ reference: 'CS-0001', notes: 'For the new site' });
    const saved = await makeDocumentConfidential({ ...doc, notes: 'Guard salaries' });
    expect(saved).toMatchObject({ id: doc.id, confidential: true, notes: 'Guard salaries' });
    expect(await db.renewals.get(renewal.id)).toBeDefined();
    // Its fees lose its name, number and note there too: expenses aren't private.
    expect(await db.expenses.get(expense.id)).toMatchObject({
      description: 'Document renewal fee',
      reference: '',
      notes: '',
      amount: 25,
    });
  });

  it('saves it again under new ids in the cloud, with its renewals, files and activity', async () => {
    const { company } = await kuwaitCompany();
    const { doc, scan, renewal, expense } = await withHistory(company.id);
    await inTheCloud(company.id, ['tables_v16']);
    const saved = await makeDocumentConfidential({ ...doc, notes: 'Guard salaries' });

    expect(saved.id).not.toBe(doc.id);
    expect(saved).toMatchObject({
      confidential: true,
      title: 'Guards cost sheet',
      notes: 'Guard salaries',
      expiryDate: inDays(400),
      createdAt: doc.createdAt,
    });
    expect(await db.complianceDocuments.get(doc.id)).toBeUndefined();
    const [moved] = await documentRenewals(`doc:${saved.id}`);
    expect(moved).toMatchObject({
      documentId: saved.id,
      expenseId: expense.id,
      newExpiry: inDays(400),
    });
    expect(moved.id).not.toBe(renewal.id);
    expect(await db.renewals.get(renewal.id)).toBeUndefined();

    const files = await db.attachments.where('ownerId').equals(saved.id).toArray();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: 'cost-sheet.png',
      dataUrl: PNG,
      docKey: `doc:${saved.id}`,
    });
    expect(files[0].id).not.toBe(scan.id);
    expect(files[0]).not.toHaveProperty('storagePath');
    expect(await db.attachments.get(scan.id)).toBeUndefined();

    expect(await db.activities.where('entityId').anyOf([doc.id, renewal.id]).count()).toBe(0);
    const activity = await db.activities.where('entityId').anyOf([saved.id, moved.id]).toArray();
    expect(activity.map((a) => a.action).sort()).toEqual(['created', 'renewed', 'updated']);
    expect(activity.every((a) => a.confidential === true)).toBe(true);
    expect(activity.every((a) => isPrivateRecord('activities', { ...a }))).toBe(true);

    // The fee, which staff see, no longer names it.
    expect(await db.expenses.get(expense.id)).toMatchObject({
      description: 'Document renewal fee',
      reference: '',
      notes: '',
      amount: 25,
    });
    // The old records' deletion goes to the cloud, their activity too.
    const deleted = (await db.outbox.toArray()).filter((e) => e.op === 'delete');
    expect(
      deleted
        .filter((e) => e.table !== 'activities')
        .map((e) => `${e.table}/${e.id}`)
        .sort(),
    ).toEqual(
      [`attachments/${scan.id}`, `complianceDocuments/${doc.id}`, `renewals/${renewal.id}`].sort(),
    );
    expect(deleted.filter((e) => e.table === 'activities')).toHaveLength(2);
  });

  it('removes the files taken off its form only once it is saved', async () => {
    const { company } = await kuwaitCompany();
    const { doc, scan } = await withHistory(company.id);
    const extra = await addAttachment(company.id, doc.id, {
      name: 'old page.png',
      type: 'image/png',
      dataUrl: PNG,
    });
    await inTheCloud(company.id, ['tables_v16']);
    // A check fails: nothing is removed, and the document stays as it was.
    await expect(
      makeDocumentConfidential(
        { ...doc, purposeId: 'no-such-purpose' },
        { removedFiles: [extra.id] },
      ),
    ).rejects.toThrow('Choose a purpose from the list.');
    expect(await db.attachments.get(extra.id)).toBeDefined();
    expect(await db.attachments.get(scan.id)).toBeDefined();
    // Saved: the file taken off isn't copied, and is gone with the old record.
    const saved = await makeDocumentConfidential(doc, { removedFiles: [extra.id] });
    const files = await db.attachments.where('ownerId').equals(saved.id).toArray();
    expect(files.map((f) => f.name)).toEqual(['cost-sheet.png']);
    expect(await db.attachments.get(extra.id)).toBeUndefined();
    expect(await db.attachments.get(scan.id)).toBeUndefined();
  });

  it('waits for the server, and for files kept in the cloud only', async () => {
    const { company } = await kuwaitCompany();
    const { doc, scan } = await withHistory(company.id);
    await inTheCloud(company.id);
    await expect(makeDocumentConfidential(doc)).rejects.toThrow(
      'The cloud needs the latest database script first. Ask the owner of the company to run it.',
    );
    await inTheCloud(company.id, ['tables_v16']);
    await db.attachments.update(scan.id, { dataUrl: '', storagePath: `${company.id}/${scan.id}` });
    await expect(makeDocumentConfidential(doc)).rejects.toBeInstanceOf(FilesNotHereError);
    expect(await db.complianceDocuments.get(doc.id)).toMatchObject({ title: 'Guards cost sheet' });
    expect((await db.complianceDocuments.get(doc.id))!.confidential).toBeUndefined();
  });

  it('is never saved with the mark in a cloud that can’t keep it, or over a copy staff hold', async () => {
    const { company } = await kuwaitCompany();
    const doc = await saveComplianceDocument(
      createComplianceDocument(company.id, { title: 'Guards cost sheet' }),
    );
    await inTheCloud(company.id);
    const secret = createComplianceDocument(company.id, {
      title: 'Cost sheet',
      confidential: true,
    });
    await expect(saveComplianceDocument(secret)).rejects.toThrow(
      'The cloud needs the latest database script first. Ask the owner of the company to run it.',
    );
    await inTheCloud(company.id, ['tables_v16']);
    await expect(saveComplianceDocument(secret)).resolves.toMatchObject({ confidential: true });
    await expect(saveComplianceDocument({ ...doc, confidential: true })).rejects.toThrow(
      'This document is in the cloud already: make it confidential from its form.',
    );
    expect((await db.complianceDocuments.get(doc.id))!.confidential).toBeUndefined();
  });

  it('keeps it confidential', async () => {
    const { company } = await kuwaitCompany();
    const doc = await saveComplianceDocument(
      createComplianceDocument(company.id, { title: 'Guards cost sheet', confidential: true }),
    );
    const saved = await saveComplianceDocument({ ...doc, confidential: false });
    expect(saved.confidential).toBe(true);
  });
});
