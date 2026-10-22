import { describe, expect, it } from 'vitest';
import { alertsFor, collectAlerts } from './collect';
import type { DocumentRenewal } from '@/db/types';
import { sampleData, TODAY } from './testing';

const keys = (alerts: { key: string }[]) => alerts.map((a) => a.key);

describe('collectAlerts', () => {
  it('reports what needs attention, by topic and soonest first, and nothing else', () => {
    const alerts = collectAlerts(sampleData(), TODAY);
    expect(alerts.map((a) => [a.key, a.daysLeft, a.tone])).toEqual([
      ['documents:emp:emp-noura:civil_id:2026-10-01:expired', -5, 'red'],
      ['documents:emp:emp-omar:civil_id:2026-10-11:7d', 5, 'red'],
      ['documents:emp:emp-ravi:residency:2026-10-31:30d', 25, 'amber'],
      ['documents:doc:licence:2026-12-01:60d', 56, 'amber'],
      ['deadlines:pifss:2026-09:soon', 9, 'amber'],
      ['cheques:chq-late:2026-10-01:late', -5, 'red'],
      ['cheques:chq-out:2026-10-06:due', 0, 'red'],
      ['cheques:chq-due:2026-10-08:due', 2, 'amber'],
      ['bills:bill-late:2026-10-01:overdue', -5, 'red'],
      ['bills:bill-week:2026-10-10:due', 4, 'amber'],
      ['invoices:inv-late:2026-09-30:overdue', -6, 'red'],
      ['invoices:inv-partial:2026-10-05:overdue', -1, 'red'],
    ]);
  });

  it('gives a paper a new key at each reminder, at expiry and after a renewal', () => {
    const data = sampleData();
    const ravi = (on: string) =>
      keys(collectAlerts(data, on, ['documents'])).filter((k) => k.includes('emp-ravi'));
    expect(ravi('2026-08-31')).toEqual([]);
    expect(ravi('2026-09-01')).toEqual(['documents:emp:emp-ravi:residency:2026-10-31:60d']);
    expect(ravi('2026-10-01')).toEqual(['documents:emp:emp-ravi:residency:2026-10-31:30d']);
    expect(ravi('2026-10-24')).toEqual(['documents:emp:emp-ravi:residency:2026-10-31:7d']);
    // Still valid on its expiry date, expired the day after.
    expect(ravi('2026-10-31')).toEqual(['documents:emp:emp-ravi:residency:2026-10-31:7d']);
    expect(ravi('2026-11-01')).toEqual(['documents:emp:emp-ravi:residency:2026-10-31:expired']);
    data.employees[0] = { ...data.employees[0], residencyExpiry: '2027-10-31' };
    expect(ravi('2026-11-01')).toEqual([]);
  });

  it("follows the company's reminder days, and a document's own", () => {
    const data = sampleData();
    data.peopleSettings = { reminderDays: [45, 15] };
    data.complianceDocuments[0] = { ...data.complianceDocuments[0], reminderDays: [90] };
    expect(keys(collectAlerts(data, TODAY, ['documents']))).toEqual([
      'documents:emp:emp-noura:civil_id:2026-10-01:expired',
      'documents:emp:emp-omar:civil_id:2026-10-11:15d',
      'documents:emp:emp-ravi:residency:2026-10-31:45d',
      'documents:doc:licence:2026-12-01:90d',
    ]);
  });

  it('drops deadlines marked as done and reports late ones as overdue', () => {
    const data = sampleData();
    expect(keys(collectAlerts(data, '2026-10-16', ['deadlines']))).toEqual([
      'deadlines:pifss:2026-09:overdue',
    ]);
    data.complianceMarks = [
      {
        id: `${data.company.id}:pifss:2026-09`,
        companyId: data.company.id,
        key: 'pifss:2026-09',
        doneOn: '2026-10-12',
        note: '',
        createdAt: '2026-10-12T09:00:00.000Z',
      },
    ];
    expect(keys(collectAlerts(data, '2026-10-16', ['deadlines']))).toEqual([]);
  });

  it('has no PIFSS deadline for a company without insured staff', () => {
    const data = sampleData();
    data.employees = data.employees.filter((e) => e.category !== 'kuwaiti');
    expect(collectAlerts(data, TODAY, ['deadlines'])).toEqual([]);
  });

  it('only reports the topics asked for', () => {
    const alerts = collectAlerts(sampleData(), TODAY, ['invoices', 'cheques']);
    expect([...new Set(alerts.map((a) => a.topic))]).toEqual(['cheques', 'invoices']);
    expect(collectAlerts(sampleData(), TODAY, [])).toEqual([]);
  });

  it('tells received cheques from issued ones', () => {
    const alerts = collectAlerts(sampleData(), TODAY, ['cheques']);
    expect(
      alerts.map((a) => (a.topic === 'cheques' ? [a.payment.id, a.received, a.late] : null)),
    ).toEqual([
      ['chq-late', true, true],
      ['chq-out', false, false],
      ['chq-due', true, false],
    ]);
  });

  it('reports a bill without a due date by its date', () => {
    const data = sampleData();
    data.documents.push({ ...data.documents[5], id: 'bill-no-due', dueDate: null });
    expect(keys(collectAlerts(data, TODAY, ['bills']))).toContain(
      'bills:bill-no-due:2026-09-01:overdue',
    );
  });

  it('keeps every key as it was while the expiry reminders of #18 are not set', () => {
    const before = keys(collectAlerts(sampleData(), TODAY));
    const data = sampleData();
    data.peopleSettings = { reminderDaysByType: {}, expiredRepeatDays: 0, newCopyGraceDays: 0 };
    data.renewals = [renewal()];
    data.copies = [];
    expect(keys(collectAlerts(data, TODAY))).toEqual(before);
    // Seven weeks after it expired, an expired paper keeps its one key.
    expect(
      keys(collectAlerts(sampleData(), '2026-11-19', ['documents'])).filter((k) =>
        k.includes('emp-noura'),
      ),
    ).toEqual(['documents:emp:emp-noura:civil_id:2026-10-01:expired']);
  });

  it("uses each type's own lead times", () => {
    const data = sampleData();
    data.peopleSettings = {
      reminderDaysByType: { residency: [90, 60, 30, 7], passport: [180, 90, 30] },
    };
    expect(keys(collectAlerts(data, TODAY, ['documents']))).toEqual([
      'documents:emp:emp-noura:civil_id:2026-10-01:expired',
      'documents:emp:emp-omar:civil_id:2026-10-11:7d',
      'documents:emp:emp-ravi:residency:2026-10-31:30d',
      'documents:doc:licence:2026-12-01:60d',
      // 90 days left: reached the passport's 90-day reminder.
      'documents:emp:emp-maria:passport:2027-01-04:90d',
    ]);
    // A residency is reminded of 90 days before.
    const ravi = (on: string) =>
      keys(collectAlerts(data, on, ['documents'])).filter((k) => k.includes('emp-ravi'));
    expect(ravi('2026-08-01')).toEqual([]);
    expect(ravi('2026-08-02')).toEqual(['documents:emp:emp-ravi:residency:2026-10-31:90d']);
  });

  it('reminds again every N days once a paper has expired, until it is renewed', () => {
    const data = sampleData();
    data.peopleSettings = { expiredRepeatDays: 7 };
    const noura = (on: string) =>
      keys(collectAlerts(data, on, ['documents'])).filter((k) => k.includes('emp-noura'));
    expect(noura('2026-10-02')).toEqual(['documents:emp:emp-noura:civil_id:2026-10-01:expired']);
    expect(noura('2026-10-08')).toEqual(['documents:emp:emp-noura:civil_id:2026-10-01:expired']);
    expect(noura('2026-10-09')).toEqual(['documents:emp:emp-noura:civil_id:2026-10-01:expired+7']);
    expect(noura('2026-10-16')).toEqual(['documents:emp:emp-noura:civil_id:2026-10-01:expired+14']);
    data.employees[1] = { ...data.employees[1], civilIdExpiry: '2027-10-01' };
    expect(noura('2026-10-16')).toEqual([]);
  });

  it('asks for the new copy of a renewed paper, until a file is marked as it', () => {
    const data = sampleData();
    data.peopleSettings = { newCopyGraceDays: 14, newCopySince: '2026-09-01' };
    // The licence was renewed on 1 October until 1 December 2027.
    data.complianceDocuments[0] = { ...data.complianceDocuments[0], expiryDate: '2027-12-01' };
    data.renewals = [renewal()];
    const licence = (on: string) =>
      keys(collectAlerts(data, on, ['documents'])).filter((k) => k.includes('doc:licence'));
    expect(licence('2026-10-15')).toEqual([]);
    expect(licence('2026-10-16')).toEqual(['documents:doc:licence:2027-12-01:noscan']);
    const [alert] = collectAlerts(data, '2026-10-16', ['documents']).filter(
      (a) => a.topic === 'documents' && a.entry.key === 'doc:licence',
    );
    expect(alert).toMatchObject({
      newCopy: true,
      expired: false,
      date: '2026-10-15',
      tone: 'amber',
    });
    // Repeated as expired papers are.
    data.peopleSettings = { ...data.peopleSettings, expiredRepeatDays: 7 };
    expect(licence('2026-10-23')).toEqual(['documents:doc:licence:2027-12-01:noscan+7']);
    // A tag clears it.
    data.copies = [{ id: 'scan', docKey: 'doc:licence', validUntil: '2027-12-01' }];
    expect(licence('2026-10-23')).toEqual([]);
  });

  it('gives each person the kinds of paper they chose, and only what they may see', () => {
    const data = sampleData();
    data.complianceDocuments.push(
      {
        ...data.complianceDocuments[0],
        id: 'van-card',
        type: 'vehicle_registration',
        ownerType: 'vehicle',
        ownerName: '18/62417',
      },
      {
        ...data.complianceDocuments[0],
        id: 'hotel-contract',
        type: 'client_contract',
        ownerType: 'other',
        clientId: 'client-gulf',
        title: 'Guarding contract',
      },
    );
    const all = collectAlerts(data, TODAY);
    const docs = (alerts: typeof all) =>
      alerts.filter((a) => a.topic === 'documents').map((a) => a.key.split(':')[2]);
    expect(docs(alertsFor(all, {}))).toEqual(docs(all));
    expect(docs(alertsFor(all, { documentKinds: null }))).toEqual(docs(all));
    expect(docs(alertsFor(all, { documentKinds: ['vehicle', 'client'] }))).toEqual([
      'hotel-contract',
      'van-card',
    ]);
    expect(docs(alertsFor(all, { documentKinds: ['staff'] }))).toEqual([
      'emp-noura',
      'emp-omar',
      'emp-ravi',
    ]);
    // No access to People: no employee's papers. To Compliance: no others, and no deadlines.
    expect(docs(alertsFor(all, { people: false }))).toEqual([
      'hotel-contract',
      'licence',
      'van-card',
    ]);
    const limited = alertsFor(all, { compliance: false });
    expect(docs(limited)).toEqual(['emp-noura', 'emp-omar', 'emp-ravi']);
    expect(limited.some((a) => a.topic === 'deadlines')).toBe(false);
    expect(limited.filter((a) => a.topic === 'invoices')).toEqual(
      all.filter((a) => a.topic === 'invoices'),
    );
  });
});

function renewal(overrides: Partial<DocumentRenewal> = {}): DocumentRenewal {
  return {
    id: 'renewal-licence',
    companyId: 'company-acme',
    documentKey: 'doc:licence',
    documentId: 'licence',
    employeeId: null,
    type: 'commercial_licence',
    renewedOn: '2026-10-01',
    previousExpiry: '2026-12-01',
    newExpiry: '2027-12-01',
    fee: 0,
    expenseId: null,
    note: '',
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}
