import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createProduct } from './defaults';
import {
  backupFileName,
  exportBackup,
  importBackup,
  parseBackup,
  BackupError,
  summarizeBackup,
} from './backup';
import { saveClient, setupCompany, getCurrentCompanyId } from './records';
import { seedDemoCompany } from './demo';
import {
  addDepartment,
  createEmployee,
  getPeopleSettings,
  saveEmployee,
  savePeopleSettings,
} from './people';
import {
  addDocumentPurpose,
  createComplianceDocument,
  saveComplianceDocument,
  setRegisterExtras,
} from './renewals';
import { createVehicle, saveVehicle } from './vehicles';
import { getPayrollSettings, savePayrollSettings } from './payroll';
import { setFileFinder } from './files';
import { saveItem } from './inventory';
import { addProductImages } from './product-images';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('backup', () => {
  it('round-trips everything through JSON', async () => {
    const demo = await seedDemoCompany();
    const backup = await exportBackup();
    const counts = summarizeBackup(backup);
    expect(counts.companies).toBe(1);
    expect(counts.documents).toBeGreaterThan(10);
    expect(counts.payments).toBeGreaterThan(3);

    const text = JSON.stringify(backup);
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');

    expect(await db.documents.count()).toBe(counts.documents);
    expect(await db.payments.count()).toBe(counts.payments);
    expect(await getCurrentCompanyId()).toBe(demo.id);
    const restored = await db.documents.where('companyId').equals(demo.id).first();
    expect(restored?.totals.total).toBeGreaterThan(0);
    // Seeding the demo takes seconds on a busy machine (as in demo.test.ts).
  }, 120_000);

  it('exports a single company', async () => {
    const a = await setupCompany({ name: 'A' });
    const b = await setupCompany({ name: 'B' });
    await saveClient(createClient(a.id, { name: 'Client A' }));
    await saveClient(createClient(b.id, { name: 'Client B' }));
    const backup = await exportBackup(a.id);
    expect(backup.data.companies.map((c) => c.id)).toEqual([a.id]);
    expect(backup.data.clients).toHaveLength(1);
  });

  it('keeps the company type and the description of the legal form', async () => {
    const a = await setupCompany({
      name: 'Made-up Guarding',
      companyType: { id: 'type-guarding', name: 'Guarding', nameAr: 'الحراسة' },
      kuwait: { legalForm: 'other', legalFormOther: 'Professional company' },
    });
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    const restored = await db.companies.get(a.id);
    expect(restored?.companyType).toEqual({
      id: 'type-guarding',
      name: 'Guarding',
      nameAr: 'الحراسة',
    });
    expect(restored?.kuwait).toMatchObject({
      legalForm: 'other',
      legalFormOther: 'Professional company',
    });
  });

  it('keeps where each link shows and the integration it was added as', async () => {
    const links = [
      { id: 'l1', label: 'Tasks', url: 'https://tasks.example.com/' },
      {
        id: 'l2',
        label: 'Taly',
        labelAr: 'تالي',
        url: 'https://merchant.example.com/',
        section: 'integrations' as const,
        preset: 'taly' as const,
        apps: ['books', 'crm'],
      },
    ];
    const a = await setupCompany({ name: 'Made-up Trading', links });
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect((await db.companies.get(a.id))?.links).toEqual(links);
  });

  it('keeps the departments and stateless employees with their review card', async () => {
    const a = await setupCompany({ name: 'Made-up Guarding' });
    await addDepartment(a.id, { name: 'Security', nameAr: 'الأمن' });
    const saad = await saveEmployee(
      createEmployee(a.id, {
        name: 'Saad Testing',
        category: 'expat',
        stateless: true,
        nationality: '',
        department: 'Security',
        centralCardNumber: 'RC-1',
        centralCardExpiry: '2027-01-31',
      }),
    );
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect((await db.peopleSettings.get(a.id))?.departments).toEqual([
      expect.objectContaining({ name: 'Security', nameAr: 'الأمن' }),
    ]);
    expect(await db.employees.get(saad.id)).toMatchObject({
      stateless: true,
      department: 'Security',
      centralCardNumber: 'RC-1',
      centralCardExpiry: '2027-01-31',
    });
  });

  it('keeps who drives for work, the licence class and the check of drivers’ licences', async () => {
    const a = await setupCompany({ name: 'Made-up Transport' });
    await savePeopleSettings({ ...(await getPeopleSettings(a.id)), drivingLicences: true });
    const driver = await saveEmployee(
      createEmployee(a.id, { name: 'Made-up Driver', drivingLicenceRequired: true }),
    );
    const licence = await saveComplianceDocument(
      createComplianceDocument(a.id, {
        type: 'driving_licence',
        ownerType: 'employee',
        employeeId: driver.id,
        licenceClass: 'Heavy',
      }),
    );
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect((await db.peopleSettings.get(a.id))?.drivingLicences).toBe(true);
    expect((await db.employees.get(driver.id))?.drivingLicenceRequired).toBe(true);
    expect((await db.complianceDocuments.get(licence.id))?.licenceClass).toBe('Heavy');
  });

  it('keeps vehicles, purposes, customers’ papers and the register’s extras', async () => {
    const a = await setupCompany({ name: 'Made-up Guarding' });
    await setRegisterExtras(a.id, true);
    const purpose = await addDocumentPurpose(a.id, { name: 'Tenders', nameAr: 'المناقصات' });
    const client = await saveClient(createClient(a.id, { name: 'Made-up Customer Co.' }));
    const vehicle = await saveVehicle(createVehicle(a.id, { plate: 'TEST-1', make: 'Toyota' }));
    const sheet = await saveComplianceDocument(
      createComplianceDocument(a.id, {
        ownerType: 'other',
        type: 'customer_cost',
        title: 'Guards cost sheet',
        clientId: client.id,
        purposeId: purpose.id,
        confidential: true,
      }),
    );
    const paper = await saveComplianceDocument(
      createComplianceDocument(a.id, { ownerType: 'vehicle', vehicleId: vehicle.id }),
    );
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect(await db.companies.get(a.id)).toMatchObject({
      registerExtras: true,
      documentPurposes: [purpose],
    });
    expect(await db.vehicles.get(vehicle.id)).toMatchObject({ plate: 'TEST-1', make: 'Toyota' });
    expect(await db.complianceDocuments.get(sheet.id)).toMatchObject({
      clientId: client.id,
      purposeId: purpose.id,
      confidential: true,
      ownerName: 'Made-up Customer Co.',
    });
    expect((await db.complianceDocuments.get(paper.id))?.vehicleId).toBe(vehicle.id);
  });

  it('keeps the document finder switched on', async () => {
    const a = await setupCompany({ name: 'Made-up Guarding' });
    await setFileFinder(a.id, true);
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect((await db.companies.get(a.id))?.fileFinder).toBe(true);
  });

  it('keeps the leave policy and employees’ own days of annual leave', async () => {
    const a = await setupCompany({ name: 'Made-up Security' });
    await savePayrollSettings({
      ...(await getPayrollSettings(a.id)),
      leavePolicy: {
        annualDays: [{ from: '2026-11-01', days: 35 }],
        firstYearMonths: 6,
        carryForwardMax: 40,
        counting: 'working',
      },
    });
    const guard = await saveEmployee(
      createEmployee(a.id, {
        name: 'Made-up Supervisor',
        annualLeaveDays: 45,
        annualLeaveDaysFrom: '2026-12-01',
      }),
    );
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect((await db.payrollSettings.get(a.id))?.leavePolicy).toEqual({
      annualDays: [{ from: '2026-11-01', days: 35 }],
      firstYearMonths: 6,
      carryForwardMax: 40,
      counting: 'working',
    });
    expect(await db.employees.get(guard.id)).toMatchObject({
      annualLeaveDays: 45,
      annualLeaveDaysFrom: '2026-12-01',
    });
  });

  it('never gives a number again when an older backup replaces what is here', async () => {
    const a = await setupCompany({ name: 'A' });
    const at = (next: number, period = '2026') => ({ next, period });
    const company = (await db.companies.get(a.id))!;
    await db.companies.put({
      ...company,
      numbering: {
        ...company.numbering,
        letter: { ...company.numbering.letter!, ...at(4) },
        invoice: { ...company.numbering.invoice, next: 7 },
      },
    });
    const backup = await exportBackup(a.id);
    // Letters HR-2026-0004 and 0005 and invoice 7 are given after the backup.
    const later = (await db.companies.get(a.id))!;
    await db.companies.put({
      ...later,
      numbering: {
        ...later.numbering,
        letter: { ...later.numbering.letter!, ...at(6) },
        invoice: { ...later.numbering.invoice, next: 8 },
      },
    });
    await importBackup(backup, 'replace');
    const restored = (await db.companies.get(a.id))!;
    expect(restored.numbering.letter).toMatchObject(at(6));
    expect(restored.numbering.invoice.next).toBe(8);
    expect(restored.name).toBe('A');
    // A company only in the backup comes back as it was.
    await db.delete();
    await db.open();
    await importBackup(backup, 'replace');
    expect((await db.companies.get(a.id))!.numbering.letter).toMatchObject(at(4));
  });

  it('merges without deleting existing data', async () => {
    const a = await setupCompany({ name: 'A' });
    const backup = await exportBackup(a.id);
    await setupCompany({ name: 'B' });
    await importBackup(backup, 'merge');
    expect(await db.companies.count()).toBe(2);
  });

  it('labels backups with the app name and accepts any label with the right structure', async () => {
    const a = await setupCompany({ name: 'A' });
    const backup = await exportBackup(a.id);
    expect(backup.app).toBe('Maham Books');
    expect(backupFileName({ name: 'A Co' })).toMatch(
      /^MahamBooks-backup-a-co-\d{4}-\d{2}-\d{2}\.json$/,
    );
    // A name in Arabic letters only is left out, without a double dash.
    expect(backupFileName({ name: 'شركة الميل' })).toMatch(
      /^MahamBooks-backup-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const earlierBuild = JSON.stringify({ ...backup, app: 'earlier-build' });
    await db.delete();
    await db.open();
    await importBackup(parseBackup(earlierBuild), 'replace');
    expect((await db.companies.get(a.id))?.name).toBe('A');
  });

  it('keeps item pictures, and restores items saved before items had them', async () => {
    const a = await setupCompany({ name: 'A' });
    const lamp = await saveItem(createProduct(a.id, { name: 'Desk lamp' }));
    const plain = await saveItem(createProduct(a.id, { name: 'Chair' }));
    const JPEG =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';
    const { imageIds } = await addProductImages(lamp.id, [{ name: 'front', dataUrl: JPEG }]);
    const text = JSON.stringify(await exportBackup(a.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect((await db.products.get(lamp.id))?.imageIds).toEqual(imageIds);
    expect(await db.attachments.get(imageIds![0])).toMatchObject({
      ownerId: lamp.id,
      dataUrl: JPEG,
    });
    expect('imageIds' in (await db.products.get(plain.id))!).toBe(false);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ app: 'other' }))).toThrow(BackupError);
    expect(() =>
      parseBackup(
        JSON.stringify({
          // Made before the product was renamed: still read.
          app: 'AlmailBooks',
          format: 99,
          exportedAt: '',
          data: { companies: [] },
        }),
      ),
    ).toThrow(/newer version/);
  });

  it('sanitizes logos on import', async () => {
    const a = await setupCompany({ name: 'A' });
    await db.companies.update(a.id, {
      branding: { ...a.branding, logo: 'data:image/png;base64,broken' },
    });
    const backup = await exportBackup();
    await importBackup(backup, 'replace', async () => null);
    expect((await db.companies.get(a.id))?.branding.logo).toBeNull();
  });
});
