import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db, DATA_TABLES, InvoiceDatabase } from './db';
import { exportBackup, importBackup, parseBackup, summarizeBackup } from './backup';
import { getCurrentCompanyId, setupCompany } from './records';
import type { ComplianceDocument, Vehicle } from './types';

/**
 * Database version 16: five new tables (empty until their features are
 * switched on) and new indexes. A device's data from version 15 is kept, and
 * backups made before it still restore.
 */

const NAME = 'version-15-device';

/** The tables and indexes of version 15, as the version before this one left them. */
const VERSION_15 = {
  companies: 'id, name',
  clients: 'id, companyId, name, number',
  products: 'id, companyId, name',
  taxRates: 'id, companyId',
  documents:
    'id, companyId, [companyId+type], [companyId+type+number], clientId, issueDate, status, recurringId, sourceId',
  payments: 'id, companyId, clientId, date, creditId, *documentIds',
  recurring: 'id, companyId, clientId, nextIssueDate',
  activities: 'id, companyId, [companyId+at], entityId, clientId, documentId',
  meta: 'key',
  accounts: 'id, companyId, [companyId+code], [companyId+role]',
  journals: 'id, companyId, [companyId+date], [companyId+number]',
  expenses: 'id, companyId, [companyId+date], vendorId, accountId',
  attachments: 'id, companyId, ownerId, [ownerId+name], [companyId+contentMissing]',
  vatReturns: 'id, companyId, [companyId+periodStart]',
  bankTransactions: 'id, companyId, accountId, date, fingerprint, importId',
  securityCheques: 'id, companyId, clientId, status',
  employees: 'id, companyId, [companyId+number], status',
  complianceDocuments: 'id, companyId, employeeId, expiryDate',
  renewals: 'id, companyId, documentKey, employeeId, expenseId',
  complianceMarks: 'id, companyId, [companyId+key]',
  peopleSettings: 'id, companyId',
  payRuns: 'id, companyId, [companyId+period], status',
  payrollSettings: 'id, companyId',
  leaveRecords: 'id, companyId, employeeId',
  staffLoans: 'id, companyId, employeeId',
  finalSettlements: 'id, companyId, employeeId',
  warehouses: 'id, companyId',
  stockMovements:
    'id, companyId, [companyId+productId], [companyId+date], sourceId, documentId, warehouseId',
  stockEntries: 'id, companyId, [companyId+date]',
  landedCosts: 'id, companyId, billId, targetBillId',
  assets: 'id, companyId, status, billId',
  depreciationRuns: 'id, companyId, [companyId+period]',
  yearEnds: 'id, companyId, [companyId+yearEnd]',
  outbox: '++seq, companyId, [companyId+parked], [table+id]',
  syncState: 'companyId',
  syncRevs: '[table+id], companyId',
  fileQueue: '++seq, companyId',
};

const NEW_TABLES = [
  'chequeLayouts',
  'vehicles',
  'approvals',
  'letterTemplates',
  'employeeLetters',
] as const;

let opened: InvoiceDatabase | null = null;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await Dexie.delete(NAME);
});

afterEach(async () => {
  opened?.close();
  opened = null;
  await Dexie.delete(NAME);
});

/** A device on version 15 with a little of everything the new indexes look at. */
async function version15Device(): Promise<void> {
  const old = new Dexie(NAME);
  old.version(15).stores(VERSION_15);
  await old.open();
  await old.table('companies').put({ id: 'co-1', name: 'Test Trading' });
  await old.table('products').bulkPut([
    { id: 'p-1', companyId: 'co-1', name: 'Gloves', sku: 'GL-01' },
    { id: 'p-2', companyId: 'co-1', name: 'Boots', sku: '' },
  ]);
  await old.table('complianceDocuments').put({
    id: 'doc-1',
    companyId: 'co-1',
    type: 'vehicle_registration',
    employeeId: null,
    ownerName: 'TEST-1',
    expiryDate: '2027-01-31',
  });
  await old.table('attachments').put({
    id: 'att-1',
    companyId: 'co-1',
    ownerId: 'doc-1',
    name: 'scan.pdf',
    dataUrl: 'data:application/pdf;base64,AA==',
  });
  await old.table('syncState').put({ companyId: 'co-1', userId: 'u-1', cursor: 42 });
  await old.table('outbox').add({ companyId: 'co-1', table: 'products', id: 'p-1', parked: 0 });
  await old.table('meta').put({ key: 'currentCompanyId', value: 'co-1' });
  old.close();
}

describe('version 15 → 16', () => {
  it('keeps every record, change waiting to be sent and link', async () => {
    await version15Device();
    opened = new InvoiceDatabase(NAME);
    await opened.open();
    // Later versions (17: manpower costings) open over it in the same step.
    expect(opened.verno).toBeGreaterThanOrEqual(16);
    expect(await opened.companies.get('co-1')).toMatchObject({ name: 'Test Trading' });
    expect(await opened.products.count()).toBe(2);
    expect(await opened.complianceDocuments.get('doc-1')).toMatchObject({ ownerName: 'TEST-1' });
    expect(await opened.attachments.get('att-1')).toMatchObject({ name: 'scan.pdf' });
    expect(await opened.outbox.count()).toBe(1);
    // Made before version 16: it has no table list, so the next sync catches up.
    const link = await opened.syncState.get('co-1');
    expect(link).toMatchObject({ cursor: 42 });
    expect(link?.tables).toBeUndefined();
    expect(await opened.meta.get('currentCompanyId')).toMatchObject({ value: 'co-1' });
  });

  it('adds the new tables, empty, and the new indexes over what is there', async () => {
    await version15Device();
    opened = new InvoiceDatabase(NAME);
    await opened.open();
    for (const name of NEW_TABLES) expect(await opened.table(name).count(), name).toBe(0);
    expect(
      (await opened.products.where('[companyId+sku]').equals(['co-1', 'GL-01']).toArray()).map(
        (p) => p.id,
      ),
    ).toEqual(['p-1']);

    // Records written by a newer feature are found by them.
    const vehicle: Vehicle = {
      id: 'veh-1',
      companyId: 'co-1',
      plate: 'TEST-1',
      make: 'Test',
      model: 'Van',
      notes: '',
      archived: false,
      createdAt: '2026-10-20T08:00:00.000Z',
      updatedAt: '2026-10-20T08:00:00.000Z',
    };
    await opened.vehicles.put(vehicle);
    await opened.complianceDocuments.update('doc-1', {
      vehicleId: 'veh-1',
    } satisfies Partial<ComplianceDocument>);
    await opened.attachments.update('att-1', { docKey: 'doc:doc-1' });
    expect(await opened.vehicles.where('plate').equals('TEST-1').count()).toBe(1);
    expect(await opened.complianceDocuments.where('vehicleId').equals('veh-1').count()).toBe(1);
    expect(await opened.attachments.where('docKey').equals('doc:doc-1').count()).toBe(1);
    await opened.approvals.put({
      id: 'apr-1',
      companyId: 'co-1',
      kind: 'invoice_void',
      subjectTbl: 'documents',
      subjectId: 'inv-1',
      subjectNumber: 'INV-0001',
      reason: '',
      status: 'pending',
      requestedBy: 'u-1',
      requestedAt: '2026-10-20T08:00:00.000Z',
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      createdAt: '2026-10-20T08:00:00.000Z',
      updatedAt: '2026-10-20T08:00:00.000Z',
    });
    expect(
      await opened.approvals.where('[companyId+status]').equals(['co-1', 'pending']).count(),
    ).toBe(1);
  });
});

describe('backups and the new tables', () => {
  it('restores a backup made before them', async () => {
    const company = await setupCompany({ name: 'Before' });
    const backup = await exportBackup();
    const older = JSON.parse(JSON.stringify(backup));
    for (const name of NEW_TABLES) delete older.data[name];
    await db.delete();
    await db.open();

    const parsed = parseBackup(JSON.stringify(older));
    for (const name of NEW_TABLES) expect(parsed.data[name]).toEqual([]);
    await importBackup(parsed, 'replace');
    expect(await db.companies.get(company.id)).toMatchObject({ name: 'Before' });
    expect(await getCurrentCompanyId()).toBe(company.id);
    expect(summarizeBackup(parsed).vehicles).toBe(0);
  });

  it('keeps their records', async () => {
    const company = await setupCompany({ name: 'After' });
    await db.chequeLayouts.put({
      id: 'lay-1',
      companyId: company.id,
      bank: 'BRGN',
      name: 'Burgan Bank',
      version: 1,
      size: { width: 180, height: 80 },
      offset: { x: 0, y: 0 },
      fields: {
        date: { x: 140, y: 10, width: 30, height: 6 },
        payee: { x: 20, y: 25, width: 130, height: 6 },
        wordsLine1: { x: 20, y: 35, width: 130, height: 6 },
        wordsLine2: { x: 10, y: 43, width: 110, height: 6 },
        figures: { x: 140, y: 40, width: 30, height: 8 },
      },
      dateStyle: 'slashes',
      wordsLanguage: 'ar',
      figures: { prefix: 'KD', guard: '**' },
      calibrated: false,
      archived: false,
      createdAt: '2026-10-20T08:00:00.000Z',
      updatedAt: '2026-10-20T08:00:00.000Z',
    });
    const text = JSON.stringify(await exportBackup(company.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    expect(await db.chequeLayouts.get('lay-1')).toMatchObject({ bank: 'BRGN', version: 1 });
    expect(Object.keys(summarizeBackup(parseBackup(text)))).toEqual([...DATA_TABLES]);
  });

  it('refuses a backup with records of a table a later version added, rather than lose them', async () => {
    const company = await setupCompany({ name: 'Later' });
    const backup = JSON.parse(JSON.stringify(await exportBackup(company.id)));
    // A later version keeps the format and adds its tables (18: gateway payments).
    backup.data.gatewayPayments = [{ id: 'pay-1', companyId: company.id }];
    expect(() => parseBackup(JSON.stringify(backup))).toThrow(/newer version/);
    // Without records of it, nothing is lost.
    backup.data.gatewayPayments = [];
    expect(parseBackup(JSON.stringify(backup)).data).not.toHaveProperty('gatewayPayments');
  });
});
