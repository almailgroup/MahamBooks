import { describe, expect, it } from 'vitest';
import { collectAlerts } from './collect';
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
});
