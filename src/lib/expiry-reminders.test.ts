import { describe, expect, it } from 'vitest';
import { createEmployee } from '@/db/people';
import { createComplianceDocument } from '@/db/renewals';
import type { DocumentRenewal } from '@/db/types';
import {
  documentAlertKind,
  employeeDocuments,
  expiredStage,
  latestRenewals,
  newCopyMissing,
  normalizeReminderDaysByType,
  recordEntry,
  RECOMMENDED_REMINDER_DAYS_BY_TYPE,
  registerEntries,
  reminderDaysFor,
  repeatedStage,
} from './compliance';

/**
 * Expiry alerts with lead times and re-upload reminders (#18): the days of
 * each type, the stages after expiry and the new copy of a renewed paper.
 * Nothing set: exactly what was there before.
 */

const renewal = (overrides: Partial<DocumentRenewal> = {}): DocumentRenewal => ({
  id: 'renewal-1',
  companyId: 'co',
  documentKey: 'doc:licence',
  documentId: 'licence',
  employeeId: null,
  type: 'commercial_licence',
  renewedOn: '2026-10-01',
  previousExpiry: '2026-10-05',
  newExpiry: '2027-10-05',
  fee: 0,
  expenseId: null,
  note: '',
  createdAt: '2026-10-01T09:00:00.000Z',
  ...overrides,
});

describe('reminder days by document type', () => {
  it("are the company's days for every type until some are set", () => {
    expect(reminderDaysFor('residency', null)).toEqual([60, 30, 7]);
    expect(reminderDaysFor('residency', { reminderDays: [45, 15] })).toEqual([45, 15]);
    expect(
      reminderDaysFor('residency', { reminderDays: [45, 15], reminderDaysByType: {} }),
    ).toEqual([45, 15]);
    // An empty list for a type is never filled with 60/30/7: it means the company's days.
    expect(
      reminderDaysFor('residency', { reminderDays: [45], reminderDaysByType: { residency: [] } }),
    ).toEqual([45]);
  });

  it("use a type's own days, and a document's own before them", () => {
    const settings = {
      reminderDays: [60, 30, 7],
      reminderDaysByType: { residency: [7, 90, 30, 60] },
    };
    expect(reminderDaysFor('residency', settings)).toEqual([90, 60, 30, 7]);
    expect(reminderDaysFor('passport', settings)).toEqual([60, 30, 7]);
    expect(reminderDaysFor('residency', settings, [10])).toEqual([10]);
    expect(reminderDaysFor('residency', settings, [])).toEqual([90, 60, 30, 7]);
  });

  it('are what the owner chose when offered', () => {
    expect(RECOMMENDED_REMINDER_DAYS_BY_TYPE).toEqual({
      residency: [90, 60, 30, 7],
      passport: [180, 90, 30],
      vehicle_registration: [30, 14, 7],
      vehicle_insurance: [30, 14, 7],
    });
  });

  it('are cleaned up: whole days, largest first, five at most, empty types left out', () => {
    expect(
      normalizeReminderDaysByType({
        residency: [7, 30, 30, 0, -5, 90.6],
        passport: [],
        vehicle_insurance: [1, 2, 3, 4, 5, 6, 7],
        bad: 'x',
        // A type a newer version knows is kept.
        future_type: [10],
      }),
    ).toEqual({ residency: [90, 30, 7], vehicle_insurance: [7, 6, 5, 4, 3], future_type: [10] });
    expect(normalizeReminderDaysByType(null)).toEqual({});
    expect(normalizeReminderDaysByType([1, 2])).toEqual({});
  });

  it('reach the register entries of employees and of stored records', () => {
    const employee = createEmployee('co', {
      id: 'emp',
      category: 'expat',
      nationality: 'IN',
      residencyNumber: 'R-1',
      residencyExpiry: '2027-01-01',
      passportNumber: 'P-1',
      passportExpiry: '2028-01-01',
    });
    const byType = { residency: [90, 60, 30, 7] };
    const days = (type: string) =>
      employeeDocuments(employee, [60, 30, 7], byType).find((e) => e.type === type)?.reminderDays;
    expect(days('residency')).toEqual([90, 60, 30, 7]);
    expect(days('passport')).toEqual([60, 30, 7]);
    // Without reminders by type, the entries are exactly as before.
    expect(employeeDocuments(employee, [60, 30, 7])).toEqual(
      employeeDocuments(employee, [60, 30, 7], {}),
    );
    const card = createComplianceDocument('co', {
      id: 'card',
      type: 'vehicle_registration',
      ownerType: 'vehicle',
      ownerName: '18/62417',
    });
    expect(
      recordEntry(card, [60, 30, 7], { vehicle_registration: [30, 14, 7] }).reminderDays,
    ).toEqual([30, 14, 7]);
    expect(
      recordEntry({ ...card, reminderDays: [5] }, [60, 30, 7], { vehicle_registration: [30] })
        .reminderDays,
    ).toEqual([5]);
    const entries = registerEntries({
      employees: [employee],
      documents: [card],
      reminderDays: [60, 30, 7],
      reminderDaysByType: { vehicle_registration: [30, 14, 7], passport: [180, 90, 30] },
    });
    expect(Object.fromEntries(entries.map((e) => [e.type, e.reminderDays]))).toEqual({
      vehicle_registration: [30, 14, 7],
      passport: [180, 90, 30],
      residency: [60, 30, 7],
    });
  });
});

describe('stages after expiry', () => {
  it('stay "expired" without repeats', () => {
    for (const days of [-1, -8, -60]) {
      expect(expiredStage(days, undefined)).toBe('expired');
      expect(expiredStage(days, 0)).toBe('expired');
    }
  });

  it('move on every N days once expired', () => {
    // Valid on its expiry date, expired the day after (-1).
    expect(expiredStage(-1, 7)).toBe('expired');
    expect(expiredStage(-7, 7)).toBe('expired');
    expect(expiredStage(-8, 7)).toBe('expired+7');
    expect(expiredStage(-14, 7)).toBe('expired+7');
    expect(expiredStage(-15, 7)).toBe('expired+14');
    expect(expiredStage(-31, 30)).toBe('expired+30');
    expect(repeatedStage('noscan', 0, 7)).toBe('noscan');
    expect(repeatedStage('noscan', 13, 7)).toBe('noscan+7');
    // Nonsense repeats are none.
    expect(expiredStage(-20, -3)).toBe('expired');
    expect(expiredStage(-20, Number.NaN)).toBe('expired');
  });
});

describe('the new copy of a renewed paper', () => {
  const entry = { key: 'doc:licence', expiryDate: '2027-10-05' };
  const rules = { newCopyGraceDays: 14, newCopySince: '2026-09-01' };

  it('is never asked for while the rule is off', () => {
    expect(newCopyMissing(entry, renewal(), [], null, '2026-12-01')).toBeNull();
    expect(newCopyMissing(entry, renewal(), [], { newCopyGraceDays: 0 }, '2026-12-01')).toBeNull();
  });

  it('is asked for once the days allowed have passed', () => {
    expect(newCopyMissing(entry, renewal(), [], rules, '2026-10-15')).toBeNull();
    expect(newCopyMissing(entry, renewal(), [], rules, '2026-10-16')).toMatchObject({
      due: '2026-10-15',
      daysLate: 1,
    });
  });

  it('is there with a file marked as its copy valid until the new expiry', () => {
    const on = '2026-11-01';
    const copy = { id: 'f1', docKey: 'doc:licence', validUntil: '2027-10-05' };
    expect(newCopyMissing(entry, renewal(), [copy], rules, on)).toBeNull();
    // Last year's copy, or another paper's, isn't it.
    expect(
      newCopyMissing(entry, renewal(), [{ ...copy, validUntil: '2026-10-05' }], rules, on),
    ).not.toBeNull();
    expect(
      newCopyMissing(entry, renewal(), [{ ...copy, docKey: 'doc:other' }], rules, on),
    ).not.toBeNull();
    // The renewal's own copy, while its file is kept.
    expect(
      newCopyMissing(entry, renewal({ newCopyId: 'f2' }), [{ id: 'f2' }], rules, on),
    ).toBeNull();
    expect(newCopyMissing(entry, renewal({ newCopyId: 'f2' }), [], rules, on)).not.toBeNull();
  });

  it('is not asked for renewals recorded before the rule, or an expiry changed since by hand', () => {
    const on = '2026-11-01';
    expect(
      newCopyMissing(entry, renewal({ createdAt: '2026-08-31T23:00:00.000Z' }), [], rules, on),
    ).toBeNull();
    expect(
      newCopyMissing({ ...entry, expiryDate: '2027-12-31' }, renewal(), [], rules, on),
    ).toBeNull();
    expect(newCopyMissing(entry, undefined, [], rules, on)).toBeNull();
  });

  it('follows the latest renewal of each paper', () => {
    const latest = latestRenewals([
      renewal({ id: 'a', newExpiry: '2026-10-05', createdAt: '2025-10-01T09:00:00.000Z' }),
      renewal({ id: 'b' }),
      renewal({ id: 'c', documentKey: 'emp:e1:residency' }),
    ]);
    expect(latest.get('doc:licence')?.id).toBe('b');
    expect(latest.get('emp:e1:residency')?.id).toBe('c');
  });
});

describe('kinds of paper', () => {
  it("are an employee's, a vehicle's, a customer's or the company's", () => {
    expect(documentAlertKind({ ownerType: 'employee' })).toBe('staff');
    expect(documentAlertKind({ ownerType: 'vehicle' })).toBe('vehicle');
    expect(documentAlertKind({ ownerType: 'other', clientId: 'c1' })).toBe('client');
    expect(documentAlertKind({ ownerType: 'other' })).toBe('company');
    expect(documentAlertKind({ ownerType: 'company' })).toBe('company');
  });
});
