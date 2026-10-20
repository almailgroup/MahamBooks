import { describe, expect, it } from 'vitest';
import {
  canEdit,
  canEditAccounting,
  canManageTeam,
  canSeePeople,
  canWriteRecord,
  isPrivateRecord,
  MEMBER_ROLES,
  renewedDocumentId,
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
    // Logged about an employee's document: private without finding the document,
    // which may be deleted by now.
    expect(isPrivateRecord('activities', { ...about('gone'), employeeId: 'emp-1' })).toBe(true);
    expect(isPrivateRecord('activities', { ...about('gone'), employeeId: null })).toBe(false);

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

describe('private records of database version 16', () => {
  const records: Record<string, Record<string, Record<string, unknown>>> = {
    complianceDocuments: {
      'doc-secret': { id: 'doc-secret', employeeId: null, confidential: true },
      'doc-open': { id: 'doc-open', employeeId: null, confidential: false },
    },
    renewals: {
      'ren-secret': { id: 'ren-secret', documentKey: 'doc:doc-secret', documentId: 'doc-secret' },
      'ren-open': { id: 'ren-open', documentKey: 'doc:doc-open', documentId: 'doc-open' },
    },
    letterTemplates: { 'tpl-1': { id: 'tpl-1' } },
    employeeLetters: { 'let-1': { id: 'let-1', employeeId: 'emp-1' } },
  };
  const find: RecordLookup = (table, id) => records[table]?.[id] ?? null;

  it('are letters, whatever they contain, and approvals about payroll or people data', () => {
    for (const table of ['letterTemplates', 'employeeLetters']) {
      expect(isPrivateRecord(table, null)).toBe(true);
      expect(isPrivateRecord(table, { id: 'x' })).toBe(true);
    }
    const approval = (subjectTbl: unknown) => ({ id: 'apr', kind: 'payroll', subjectTbl });
    expect(isPrivateRecord('approvals', approval('payRuns'))).toBe(true);
    expect(isPrivateRecord('approvals', approval('employeeLetters'))).toBe(true);
    expect(isPrivateRecord('approvals', approval('documents'))).toBe(false);
    expect(isPrivateRecord('approvals', approval(undefined))).toBe(false);
    expect(isPrivateRecord('vehicles', { id: 'v', driverEmployeeId: 'emp-1' })).toBe(false);
    expect(isPrivateRecord('chequeLayouts', { id: 'l' })).toBe(false);
  });

  it('include confidential register documents with their renewals, files and activity', () => {
    expect(isPrivateRecord('complianceDocuments', { confidential: true })).toBe(true);
    expect(isPrivateRecord('complianceDocuments', { confidential: false })).toBe(false);
    expect(isPrivateRecord('complianceDocuments', { confidential: 'true' })).toBe(false);
    // A renewal is found to be of a confidential document by its key or its id.
    expect(isPrivateRecord('renewals', { documentKey: 'doc:doc-secret' }, find)).toBe(true);
    expect(isPrivateRecord('renewals', { documentId: 'doc-secret' }, find)).toBe(true);
    expect(isPrivateRecord('renewals', { documentKey: 'doc:doc-secret' })).toBe(false);
    expect(isPrivateRecord('renewals', { documentKey: 'doc:doc-open' }, find)).toBe(false);
    expect(isPrivateRecord('renewals', { documentKey: 'emp:emp-1:passport' }, find)).toBe(false);

    const file = (ownerId: string) => ({ id: 'att', ownerId });
    for (const owner of ['doc-secret', 'ren-secret', 'tpl-1', 'let-1']) {
      expect(isPrivateRecord('attachments', file(owner), find), owner).toBe(true);
    }
    expect(isPrivateRecord('attachments', file('doc-open'), find)).toBe(false);
    expect(isPrivateRecord('attachments', file('ren-open'), find)).toBe(false);

    const about = (entityId: string) => ({ entity: 'compliance', entityId });
    expect(isPrivateRecord('activities', about('doc-secret'), find)).toBe(true);
    expect(isPrivateRecord('activities', about('ren-secret'), find)).toBe(true);
    expect(isPrivateRecord('activities', about('doc-open'), find)).toBe(false);
    // Marked as about a confidential document: private once it is gone too.
    expect(isPrivateRecord('activities', { ...about('doc-gone'), confidential: true })).toBe(true);
    expect(isPrivateRecord('activities', about('doc-gone'), find)).toBe(false);
    expect(isPrivateRecord('activities', { ...about('doc-gone'), confidential: 'true' })).toBe(
      false,
    );
  });

  it('find the document of a renewal by its id, or else by its key', () => {
    expect(renewedDocumentId({ documentId: 'd1', documentKey: 'doc:d1' })).toBe('d1');
    expect(renewedDocumentId({ documentId: null, documentKey: 'doc:d2' })).toBe('d2');
    expect(renewedDocumentId({ documentId: '', documentKey: 'emp:e1:passport' })).toBeNull();
    expect(renewedDocumentId({ documentKey: 'doc:' })).toBeNull();
    expect(renewedDocumentId(null)).toBeNull();
  });

  it('are written by owners, admins and accountants, never by staff or viewers', () => {
    const tables = ['chequeLayouts', 'vehicles', 'approvals', 'letterTemplates', 'employeeLetters'];
    for (const table of tables) {
      const record = { id: 'x', subjectTbl: 'documents' };
      expect(canWriteRecord('staff', table, record, find), table).toBe(false);
      expect(canWriteRecord('viewer', table, record, find), table).toBe(false);
      for (const role of ['owner', 'admin', 'accountant', null] as const) {
        expect(canWriteRecord(role, table, record, find), `${role} ${table}`).toBe(true);
      }
    }
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
