import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  createEmployee,
  defaultPeopleSettings,
  deleteEmployee,
  EmployeeError,
  getPeopleSettings,
  newAllowance,
  saveEmployee,
  savePeopleSettings,
} from './people';
import { addAttachment } from './purchases';
import {
  createComplianceDocument,
  markComplianceDone,
  renewDocument,
  saveComplianceDocument,
} from './renewals';
import { deleteCompany, setupCompany } from './records';
import { exportBackup, importBackup, parseBackup, summarizeBackup } from './backup';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const kuwaitCompany = () => setupCompany({ name: 'Almail Trading' });

describe('employees', () => {
  it('get the next employee number and keep KWD amounts to the fils', async () => {
    const company = await kuwaitCompany();
    const first = await saveEmployee(
      createEmployee(company.id, {
        name: '  Fatima Al-Sabah ',
        nameAr: 'فاطمة الصباح',
        basicSalary: 1250.12345,
        allowances: [
          newAllowance({ name: 'Housing', nameAr: 'بدل سكن', amount: 150.0004 }),
          newAllowance({ name: '', amount: 0 }),
        ],
        phone: '99887766',
        iban: 'kw81 cbku 0000 0000 0000 1234 5601 01',
        contractType: 'unlimited',
        contractEnd: '2027-01-01',
      }),
    );
    expect(first).toMatchObject({
      number: 'EMP-001',
      name: 'Fatima Al-Sabah',
      basicSalary: 1250.123,
      phone: '+965 9988 7766',
      iban: 'KW81CBKU0000000000001234560101',
      contractEnd: null,
    });
    expect(first.allowances).toHaveLength(1);
    expect(first.allowances[0].amount).toBe(150);

    const second = await saveEmployee(createEmployee(company.id, { name: 'Ravi Kumar' }));
    expect(second.number).toBe('EMP-002');
    expect((await db.companies.get(company.id))?.numbering.employee.next).toBe(3);
    expect(await db.activities.where('entityId').equals(second.id).count()).toBe(1);
  });

  it('need a name and a number of their own', async () => {
    const company = await kuwaitCompany();
    await expect(saveEmployee(createEmployee(company.id, { name: ' ' }))).rejects.toThrow(
      EmployeeError,
    );
    await saveEmployee(createEmployee(company.id, { name: 'A', number: 'E-1' }));
    await expect(
      saveEmployee(createEmployee(company.id, { name: 'B', number: 'e-1' })),
    ).rejects.toThrow('already used');
  });

  it('record when someone leaves', async () => {
    const company = await kuwaitCompany();
    const saved = await saveEmployee(createEmployee(company.id, { name: 'A' }));
    const left = await saveEmployee({ ...saved, status: 'left', leavingReason: 'resignation' });
    expect(left.leavingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const back = await saveEmployee({ ...left, status: 'active' });
    expect(back.leavingDate).toBeNull();
    expect(back.leavingReason).toBeNull();
  });

  it('can be deleted with their file unless they have documents on record', async () => {
    const company = await kuwaitCompany();
    const a = await saveEmployee(createEmployee(company.id, { name: 'A' }));
    await addAttachment(company.id, a.id, {
      name: 'contract.pdf',
      type: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,AAAA',
    });
    await deleteEmployee(a.id);
    expect(await db.employees.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);

    const b = await saveEmployee(createEmployee(company.id, { name: 'B' }));
    await saveComplianceDocument(
      createComplianceDocument(company.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: b.id,
      }),
    );
    await expect(deleteEmployee(b.id)).rejects.toThrow('Mark them as left instead');
    expect(await db.employees.get(b.id)).toBeDefined();
  });
});

describe('people settings', () => {
  it('default to 60/30/7 day reminders, a 26-day month and PIFSS on the 15th', async () => {
    const company = await kuwaitCompany();
    expect(await getPeopleSettings(company.id)).toMatchObject({
      kuwaitizationTarget: null,
      eosDailyDivisor: 26,
      reminderDays: [60, 30, 7],
      auditFilingMonths: 3,
      pifssDueDay: 15,
    });
  });

  it('are cleaned up when saved', async () => {
    const company = await kuwaitCompany();
    await savePeopleSettings({
      ...defaultPeopleSettings(company.id),
      kuwaitizationTarget: 30.04,
      eosDailyDivisor: 40,
      reminderDays: [7, 90, 7],
      auditFilingMonths: 0,
      pifssDueDay: 31,
    });
    expect(await getPeopleSettings(company.id)).toMatchObject({
      kuwaitizationTarget: 30,
      eosDailyDivisor: 31,
      reminderDays: [90, 7],
      auditFilingMonths: 1,
      pifssDueDay: 28,
    });
  });
});

describe('backups', () => {
  it('carry employees, register documents, renewals, marks and settings', async () => {
    const company = await kuwaitCompany();
    const employee = await saveEmployee(
      createEmployee(company.id, {
        name: 'Ravi Kumar',
        category: 'expat',
        residencyExpiry: '2026-12-01',
      }),
    );
    const doc = await saveComplianceDocument(
      createComplianceDocument(company.id, { type: 'kcci_membership', expiryDate: '2026-12-31' }),
    );
    await renewDocument({
      companyId: company.id,
      key: `doc:${doc.id}`,
      newExpiry: '2027-12-31',
      renewedOn: '2026-12-20',
    });
    await markComplianceDone(company.id, 'pifss:2026-11');
    await savePeopleSettings({ ...defaultPeopleSettings(company.id), kuwaitizationTarget: 25 });

    const backup = await exportBackup(company.id);
    const counts = summarizeBackup(backup);
    expect(counts).toMatchObject({
      employees: 1,
      complianceDocuments: 1,
      renewals: 1,
      complianceMarks: 1,
      peopleSettings: 1,
    });

    await db.delete();
    await db.open();
    await importBackup(parseBackup(JSON.stringify(backup)), 'replace');
    expect((await db.employees.get(employee.id))?.residencyExpiry).toBe('2026-12-01');
    expect((await db.complianceDocuments.get(doc.id))?.expiryDate).toBe('2027-12-31');
    expect((await getPeopleSettings(company.id)).kuwaitizationTarget).toBe(25);

    // Deleting the company removes all of it.
    await deleteCompany(company.id);
    for (const table of [
      db.employees,
      db.complianceDocuments,
      db.renewals,
      db.complianceMarks,
      db.peopleSettings,
    ]) {
      expect(await table.count()).toBe(0);
    }
  });
});
