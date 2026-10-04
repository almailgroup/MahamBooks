import { describe, expect, it } from 'vitest';
import {
  canEdit,
  canEditAccounting,
  canManageTeam,
  canSeePeople,
  canWriteRecord,
  isPrivateRecord,
  MEMBER_ROLES,
  sameData,
  staffCompanyChangeOk,
  type RecordLookup,
} from './roles';

/** Another record of the company, as the database would find it. */
const others: Record<string, Record<string, Record<string, unknown>>> = {
  employees: { 'emp-1': { id: 'emp-1', name: 'Rajesh Kumar' } },
  complianceDocuments: {
    'doc-emp': { id: 'doc-emp', employeeId: 'emp-1' },
    'doc-co': { id: 'doc-co', employeeId: null },
  },
  renewals: { 'ren-emp': { id: 'ren-emp', employeeId: 'emp-1' } },
};
const lookup: RecordLookup = (table, id) => others[table]?.[id] ?? null;

describe('private records', () => {
  it('are payroll and people data, whatever they contain', () => {
    for (const table of ['employees', 'payRuns', 'payrollSettings', 'leaveRecords']) {
      expect(isPrivateRecord(table, null)).toBe(true);
      expect(isPrivateRecord(table, { id: 'x' })).toBe(true);
    }
    expect(isPrivateRecord('clients', { id: 'c' })).toBe(false);
  });

  it('include an employee’s documents and renewals, not the company’s', () => {
    expect(isPrivateRecord('complianceDocuments', { employeeId: 'emp-1' })).toBe(true);
    expect(isPrivateRecord('complianceDocuments', { employeeId: '' })).toBe(false);
    expect(isPrivateRecord('complianceDocuments', { employeeId: null })).toBe(false);
    expect(isPrivateRecord('renewals', { employeeId: 'emp-1' })).toBe(true);
  });

  it('include payroll journals, which show salaries', () => {
    expect(isPrivateRecord('journals', { kind: 'payroll' })).toBe(true);
    expect(isPrivateRecord('journals', { kind: 'transfer' })).toBe(false);
    expect(isPrivateRecord('journals', { number: 'MJ-1' })).toBe(false);
  });

  it('include activity and files about employees and their documents', () => {
    expect(isPrivateRecord('activities', { entity: 'employee', entityId: 'emp-1' })).toBe(true);
    expect(isPrivateRecord('activities', { entity: 'payroll', entityId: 'run-1' })).toBe(true);
    expect(isPrivateRecord('activities', { entity: 'invoice', entityId: 'inv-1' })).toBe(false);
    const about = (entityId: string) => ({ entity: 'compliance', entityId });
    expect(isPrivateRecord('activities', about('doc-emp'), lookup)).toBe(true);
    expect(isPrivateRecord('activities', about('ren-emp'), lookup)).toBe(true);
    expect(isPrivateRecord('activities', about('doc-co'), lookup)).toBe(false);

    const file = (ownerId: string) => ({ id: 'att', ownerId });
    expect(isPrivateRecord('attachments', file('emp-1'), lookup)).toBe(true);
    expect(isPrivateRecord('attachments', file('doc-emp'), lookup)).toBe(true);
    expect(isPrivateRecord('attachments', file('ren-emp'), lookup)).toBe(true);
    expect(isPrivateRecord('attachments', file('doc-co'), lookup)).toBe(false);
    expect(isPrivateRecord('attachments', file('inv-1'), lookup)).toBe(false);
  });

  it('include anything marked private, which can only add privacy', () => {
    expect(isPrivateRecord('attachments', { ownerId: 'inv-1', _private: true }, lookup)).toBe(true);
    expect(isPrivateRecord('activities', { entity: 'invoice', _private: true })).toBe(true);
    expect(isPrivateRecord('employees', { _private: false })).toBe(true);
  });
});

describe('roles', () => {
  it('decide who sees people data, edits, manages the team and the accounting setup', () => {
    const table = MEMBER_ROLES.map((role) => [
      role,
      canSeePeople(role),
      canEdit(role),
      canManageTeam(role),
      canEditAccounting(role),
    ]);
    expect(table).toEqual([
      ['owner', true, true, true, true],
      ['admin', true, true, true, true],
      ['accountant', true, true, false, true],
      ['staff', false, true, false, false],
      ['viewer', false, false, false, false],
    ]);
    // A company kept on this device only: everything.
    expect([canSeePeople(null), canEdit(null), canEditAccounting(null)]).toEqual([
      true,
      true,
      true,
    ]);
    expect(canManageTeam(null)).toBe(false);
  });

  it('let staff change sales, purchases, cheques, stock and files, never people data', () => {
    const staff = (table: string, record: Record<string, unknown> = { id: 'x' }) =>
      canWriteRecord('staff', table, record, lookup);
    for (const table of ['clients', 'documents', 'payments', 'expenses', 'securityCheques']) {
      expect(staff(table)).toBe(true);
    }
    expect(staff('stockMovements')).toBe(true);
    expect(staff('attachments', { ownerId: 'inv-1' })).toBe(true);
    expect(staff('attachments', { ownerId: 'emp-1' })).toBe(false);
    expect(staff('complianceDocuments', { employeeId: null })).toBe(false);
    for (const table of ['accounts', 'taxRates', 'assets', 'yearEnds', 'employees', 'payRuns']) {
      expect(staff(table)).toBe(false);
    }
    expect(staff('journals', { kind: 'transfer' })).toBe(true);
    expect(staff('journals', { kind: 'cheque_clearing' })).toBe(true);
    expect(staff('journals', { number: 'MJ-1' })).toBe(false);
    expect(staff('journals', { kind: 'payroll' })).toBe(false);
    expect(staff('journals', { kind: 'year_end' })).toBe(false);
  });

  it('let viewers change nothing, and the others everything', () => {
    expect(canWriteRecord('viewer', 'clients', { id: 'c' })).toBe(false);
    expect(canWriteRecord('viewer', 'activities', { id: 'a' })).toBe(false);
    for (const role of ['owner', 'admin', 'accountant', null] as const) {
      expect(canWriteRecord(role, 'employees', { id: 'e' })).toBe(true);
      expect(canWriteRecord(role, 'journals', { kind: 'payroll' })).toBe(true);
    }
  });

  it('let staff change only the document counters of the company', () => {
    const company = {
      id: 'co',
      name: 'Al Mail Trading',
      updatedAt: '2026-10-01T00:00:00.000Z',
      numbering: {
        invoice: { pattern: 'INV-{counter}', next: 5, padding: 4, reset: 'yearly', period: '2026' },
      },
    };
    const counters = {
      ...company,
      updatedAt: '2026-10-04T00:00:00.000Z',
      numbering: {
        invoice: { ...company.numbering.invoice, next: 6 },
        quote: { pattern: 'QUO-{counter}', next: 1, padding: 4, reset: 'never', period: '' },
      },
    };
    expect(staffCompanyChangeOk(company, counters)).toBe(true);
    expect(
      staffCompanyChangeOk(company, {
        ...company,
        numbering: { invoice: { ...company.numbering.invoice, pattern: 'X-{counter}' } },
      }),
    ).toBe(false);
    expect(staffCompanyChangeOk(company, { ...company, name: 'Someone else' })).toBe(false);
    expect(staffCompanyChangeOk(null, company)).toBe(false);
  });
});

describe('sameData', () => {
  it('compares JSON data the way it is stored', () => {
    expect(sameData({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameData({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    // As JSON: an undefined property is left out, an undefined array item is null.
    expect(sameData({ a: null }, { a: undefined })).toBe(false);
    expect(sameData([undefined], [null])).toBe(true);
    expect(sameData([1, 2], [2, 1])).toBe(false);
    expect(sameData({ a: 1 }, { a: '1' })).toBe(false);
    expect(sameData({ a: [] }, { a: {} })).toBe(false);
  });
});
