import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createEmployee, getPeopleSettings, saveEmployee, savePeopleSettings } from './people';
import {
  addNewCopy,
  createComplianceDocument,
  loadRegister,
  makeDocumentConfidential,
  markNewCopy,
  renewDocument,
  saveComplianceDocument,
} from './renewals';
import { addAttachment, removeAttachment } from './purchases';
import { setupCompany } from './records';
import { collectAlerts } from '@/alerts/collect';
import { loadHomeAlertData } from '@/suite/home/attention';
import { addDaysISO, today } from '@/lib/dates';
import type { ID } from './types';

/**
 * Expiry alerts with lead times and re-upload reminders (#18) on the device:
 * the settings, the new copy given with a renewal or marked later, and the
 * register's "New copy missing".
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const inDays = (n: number) => addDaysISO(today(), n);
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const scan = (name = 'scan.png') => ({ name, type: 'image/png', dataUrl: PNG });

async function company() {
  return setupCompany({ name: 'Made-up Trading' });
}

async function licence(companyId: ID, expiry = inDays(10)) {
  return saveComplianceDocument(
    createComplianceDocument(companyId, {
      type: 'commercial_licence',
      number: 'CL-1',
      expiryDate: expiry,
    }),
  );
}

async function askForCopies(companyId: ID, grace = 14) {
  const settings = await getPeopleSettings(companyId);
  return savePeopleSettings({ ...settings, newCopyGraceDays: grace });
}

describe('the expiry reminder settings', () => {
  it('are not there until set, so everything is as before', async () => {
    const { id } = await company();
    const saved = await savePeopleSettings(await getPeopleSettings(id));
    for (const key of [
      'reminderDaysByType',
      'expiredRepeatDays',
      'newCopyGraceDays',
      'newCopySince',
      'expiryUpdates',
    ]) {
      expect(saved).not.toHaveProperty(key);
    }
    expect(saved.reminderDays).toEqual([60, 30, 7]);
  });

  it('are kept cleaned up, and an empty type is never filled with 60/30/7', async () => {
    const { id } = await company();
    const saved = await savePeopleSettings({
      ...(await getPeopleSettings(id)),
      reminderDaysByType: { residency: [7, 90, 60, 30], passport: [] },
      expiredRepeatDays: 7.4,
      expiryUpdates: true,
    });
    expect(saved).toMatchObject({
      reminderDaysByType: { residency: [90, 60, 30, 7] },
      expiredRepeatDays: 7,
      expiryUpdates: true,
    });
    const off = await savePeopleSettings({
      ...saved,
      reminderDaysByType: { passport: [] },
      expiredRepeatDays: 0,
      expiryUpdates: false,
    });
    expect(off).not.toHaveProperty('reminderDaysByType');
    expect(off).not.toHaveProperty('expiredRepeatDays');
    expect(off).not.toHaveProperty('expiryUpdates');
  });

  it('ask for new copies of the renewals recorded from the day it is turned on', async () => {
    const { id } = await company();
    const on = await askForCopies(id);
    expect(on).toMatchObject({ newCopyGraceDays: 14, newCopySince: today() });
    // Saved again later, the day stays.
    await db.peopleSettings.update(id, { newCopySince: '2026-01-01' });
    const again = await savePeopleSettings({
      ...(await getPeopleSettings(id)),
      newCopyGraceDays: 21,
    });
    expect(again).toMatchObject({ newCopyGraceDays: 21, newCopySince: '2026-01-01' });
    const off = await savePeopleSettings({ ...again, newCopyGraceDays: 0 });
    expect(off).not.toHaveProperty('newCopyGraceDays');
    expect(off).not.toHaveProperty('newCopySince');
  });

  it('keep what an older version of the form sends back as it is', async () => {
    const { id } = await company();
    const saved = await savePeopleSettings({
      ...(await getPeopleSettings(id)),
      reminderDaysByType: { residency: [90, 60, 30, 7] },
      expiredRepeatDays: 7,
    });
    // An older form spreads what it read and changes only what it knows.
    const older = await savePeopleSettings({ ...saved, auditFilingMonths: 4 });
    expect(older).toMatchObject({
      auditFilingMonths: 4,
      reminderDaysByType: { residency: [90, 60, 30, 7] },
      expiredRepeatDays: 7,
    });
  });
});

describe('the new copy of a renewed paper', () => {
  it('is kept with the document, marked as its copy, when given with the renewal', async () => {
    const { id } = await company();
    const doc = await licence(id);
    const { renewal } = await renewDocument({
      companyId: id,
      key: `doc:${doc.id}`,
      renewedOn: today(),
      newExpiry: inDays(375),
      copy: scan('licence-2027.png'),
    });
    const [file] = await db.attachments.where('ownerId').equals(doc.id).toArray();
    expect(file).toMatchObject({
      name: 'licence-2027.png',
      docKey: `doc:${doc.id}`,
      validUntil: inDays(375),
    });
    expect(renewal.newCopyId).toBe(file.id);
  });

  it("goes to an employee's personnel file for their own papers", async () => {
    const { id } = await company();
    const employee = await saveEmployee(
      createEmployee(id, {
        name: 'Made-up Person',
        category: 'expat',
        nationality: 'IN',
        residencyNumber: 'R-1',
        residencyExpiry: inDays(5),
      }),
    );
    const key = `emp:${employee.id}:residency`;
    const { renewal } = await renewDocument({
      companyId: id,
      key,
      renewedOn: today(),
      newExpiry: inDays(370),
      copy: scan('residency.png'),
    });
    const [file] = await db.attachments.where('ownerId').equals(employee.id).toArray();
    expect(file).toMatchObject({ docKey: key, validUntil: inDays(370) });
    expect(renewal.newCopyId).toBe(file.id);
  });

  it('is found when it was filed before the renewal was recorded', async () => {
    const { id } = await company();
    const doc = await licence(id);
    const early = await addNewCopy(id, doc.id, scan(), {
      docKey: `doc:${doc.id}`,
      validUntil: inDays(375),
    });
    const { renewal } = await renewDocument({
      companyId: id,
      key: `doc:${doc.id}`,
      renewedOn: today(),
      newExpiry: inDays(375),
    });
    expect(renewal.newCopyId).toBe(early.id);
  });

  it('is asked for in the register once the days allowed have passed, until a file is marked', async () => {
    const { id } = await company();
    const doc = await licence(id);
    await askForCopies(id, 14);
    await renewDocument({
      companyId: id,
      key: `doc:${doc.id}`,
      renewedOn: inDays(-20),
      newExpiry: inDays(345),
    });
    const key = `doc:${doc.id}`;
    let register = await loadRegister(id);
    expect(register.newCopies.get(key)).toMatchObject({ due: inDays(-6), daysLate: 6 });

    // Last year's copy marked as it: still missing.
    const old = await addAttachment(id, doc.id, scan('old.png'));
    await markNewCopy(old.id, { docKey: key, validUntil: inDays(-1) });
    register = await loadRegister(id);
    expect(register.newCopies.has(key)).toBe(true);

    // The new one, marked later: there.
    const fresh = await addAttachment(id, doc.id, scan('new.png'));
    await markNewCopy(fresh.id, { docKey: key, validUntil: inDays(345) });
    register = await loadRegister(id);
    expect(register.newCopies.has(key)).toBe(false);
    const [renewal] = await db.renewals.where('documentKey').equals(key).toArray();
    expect(renewal.newCopyId).toBe(fresh.id);

    // Removed, or unmarked: missing again.
    await markNewCopy(fresh.id, null);
    expect((await db.renewals.get(renewal.id))?.newCopyId).toBeNull();
    expect((await loadRegister(id)).newCopies.has(key)).toBe(true);
    await markNewCopy(fresh.id, { docKey: key, validUntil: inDays(345) });
    expect((await loadRegister(id)).newCopies.has(key)).toBe(false);
    await removeAttachment(fresh.id);
    expect((await loadRegister(id)).newCopies.has(key)).toBe(true);
  });

  it('is not asked for while the company does not ask for new copies', async () => {
    const { id } = await company();
    const doc = await licence(id);
    await renewDocument({
      companyId: id,
      key: `doc:${doc.id}`,
      renewedOn: inDays(-60),
      newExpiry: inDays(300),
    });
    expect((await loadRegister(id)).newCopies.size).toBe(0);
  });

  it('is on the home page and in the morning alerts the same way', async () => {
    const { id } = await company();
    const doc = await licence(id);
    await askForCopies(id, 7);
    await renewDocument({
      companyId: id,
      key: `doc:${doc.id}`,
      renewedOn: inDays(-10),
      newExpiry: inDays(355),
    });
    const company_ = (await db.companies.get(id))!;
    const data = await loadHomeAlertData(company_, true);
    expect(collectAlerts(data, today(), ['documents']).map((a) => a.key)).toEqual([
      `documents:doc:${doc.id}:${inDays(355)}:noscan`,
    ]);
  });

  it('follows its document when the document is made confidential in the cloud', async () => {
    const { id } = await company();
    const doc = await licence(id);
    const { renewal } = await renewDocument({
      companyId: id,
      key: `doc:${doc.id}`,
      renewedOn: today(),
      newExpiry: inDays(375),
      copy: scan(),
    });
    await db.syncState.put({
      companyId: id,
      userId: 'user-owner',
      role: 'owner',
      status: 'ready',
      cursor: 0,
      name: 'Made-up Trading',
      linkedAt: '2026-10-01T00:00:00Z',
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
      features: ['tables_v16'],
    });
    const saved = await makeDocumentConfidential((await db.complianceDocuments.get(doc.id))!);
    const [file] = await db.attachments.where('ownerId').equals(saved.id).toArray();
    const [moved] = await db.renewals.where('documentKey').equals(`doc:${saved.id}`).toArray();
    expect(file.id).not.toBe(renewal.newCopyId);
    expect(file.docKey).toBe(`doc:${saved.id}`);
    expect(moved.newCopyId).toBe(file.id);
  });
});
