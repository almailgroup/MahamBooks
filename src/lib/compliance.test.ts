import { describe, expect, it } from 'vitest';
import {
  complianceCalendar,
  dayOfMonthAfter,
  employeeDocuments,
  expiryStatus,
  fiscalYearEndIn,
  monthsAfter,
  normalizeReminderDays,
  registerEntries,
  registerTypesFor,
  statutoryDeadlines,
  type StatutoryContext,
} from './compliance';
import { createEmployee } from '@/db/people';
import { createComplianceDocument } from '@/db/renewals';
import type { LegalForm } from '@/db/types';

const DAYS = [60, 30, 7];

const context = (
  legalForm: LegalForm,
  foreignOwnershipPercent = 0,
  overrides: Partial<StatutoryContext> = {},
): StatutoryContext => ({
  fiscalYearEnd: { month: 12, day: 31 },
  profile: { legalForm, foreignOwnershipPercent },
  settings: { auditFilingMonths: 3, pifssDueDay: 15 },
  pifss: false,
  ...overrides,
});

const due = (ctx: StatutoryContext, from = '2027-01-01', to = '2027-12-31') =>
  statutoryDeadlines(ctx, from, to).map((d) => `${d.dueDate} ${d.key}`);

describe('document status', () => {
  const on = '2026-10-03';

  it('is valid, expiring within the first reminder, or expired after the expiry date', () => {
    expect(expiryStatus('2026-12-03', DAYS, on)).toEqual({
      status: 'valid',
      daysLeft: 61,
      reminder: null,
    });
    expect(expiryStatus('2026-12-02', DAYS, on)).toEqual({
      status: 'expiring',
      daysLeft: 60,
      reminder: 60,
    });
    expect(expiryStatus('2026-10-23', DAYS, on)).toEqual({
      status: 'expiring',
      daysLeft: 20,
      reminder: 30,
    });
    expect(expiryStatus('2026-10-03', DAYS, on)).toEqual({
      status: 'expiring',
      daysLeft: 0,
      reminder: 7,
    });
    expect(expiryStatus('2026-10-02', DAYS, on)).toEqual({
      status: 'expired',
      daysLeft: -1,
      reminder: null,
    });
    expect(expiryStatus(null, DAYS, on).status).toBe('valid');
  });

  it('uses the document’s own reminder days', () => {
    expect(expiryStatus('2026-11-02', [90], on).status).toBe('expiring');
    expect(expiryStatus('2026-11-02', [14], on).status).toBe('valid');
  });

  it('cleans up reminder days', () => {
    expect(normalizeReminderDays([7, 30, 30, -1, 60.6])).toEqual([60, 30, 7]);
    expect(normalizeReminderDays([])).toEqual(DAYS);
    expect(normalizeReminderDays(null)).toEqual(DAYS);
  });
});

describe('the register', () => {
  it('reads employee papers from the employee record', () => {
    const kuwaiti = createEmployee('co', {
      category: 'kuwaiti',
      civilId: '290010112345',
      civilIdExpiry: '2028-01-01',
      // Kuwaitis hold no residency; stray data is ignored.
      residencyNumber: 'X',
      residencyExpiry: '2027-01-01',
    });
    expect(employeeDocuments(kuwaiti, DAYS).map((d) => d.type)).toEqual(['civil_id']);

    const expat = createEmployee('co', {
      nationality: 'IN',
      category: 'expat',
      passportNumber: 'P1234567',
      passportExpiry: '2030-05-01',
      residencyNumber: '18/123',
      residencyExpiry: '2026-10-23',
      workPermitNumber: 'WP-1',
      workPermitExpiry: '2026-10-23',
      contractType: 'fixed',
      contractEnd: '2027-06-30',
    });
    const docs = employeeDocuments(expat, DAYS);
    expect(docs.map((d) => d.type)).toEqual([
      'passport',
      'residency',
      'work_permit',
      'employment_contract',
    ]);
    expect(docs[1]).toMatchObject({
      key: `emp:${expat.id}:residency`,
      source: 'employee',
      employeeId: expat.id,
      number: '18/123',
      expiryDate: '2026-10-23',
    });

    const domestic = createEmployee('co', {
      category: 'domestic',
      residencyExpiry: '2027-01-01',
      workPermitExpiry: '2027-01-01',
    });
    expect(employeeDocuments(domestic, DAYS).map((d) => d.type)).toEqual(['residency']);
  });

  it('leaves out archived records and the papers of employees who left', () => {
    const current = createEmployee('co', { civilIdExpiry: '2027-01-01' });
    const left = createEmployee('co', { civilIdExpiry: '2027-01-01', status: 'left' });
    const entries = registerEntries({
      employees: [current, left],
      documents: [
        createComplianceDocument('co', { type: 'commercial_licence', expiryDate: '2027-03-01' }),
        createComplianceDocument('co', { type: 'kcci_membership', archived: true }),
        createComplianceDocument('co', {
          type: 'health_insurance',
          ownerType: 'employee',
          employeeId: left.id,
        }),
        createComplianceDocument('co', {
          type: 'driving_licence',
          ownerType: 'employee',
          employeeId: current.id,
          reminderDays: [14],
        }),
      ],
      reminderDays: DAYS,
    });
    expect(entries.map((e) => e.type)).toEqual([
      'commercial_licence',
      'driving_licence',
      'civil_id',
    ]);
    expect(entries[1].reminderDays).toEqual([14]);
    expect(entries[0].reminderDays).toEqual(DAYS);
  });

  it('offers only the types that are not on the employee record', () => {
    expect(registerTypesFor('employee')).toEqual(['health_insurance', 'driving_licence', 'other']);
    expect(registerTypesFor('vehicle')).toEqual([
      'vehicle_registration',
      'vehicle_insurance',
      'other',
    ]);
    expect(registerTypesFor('company')).toContain('commercial_licence');
    expect(registerTypesFor('company')).not.toContain('residency');
  });
});

describe('statutory deadlines for a 31 December year end', () => {
  it('helpers keep month ends and clamp days', () => {
    expect(fiscalYearEndIn(2026, { month: 12, day: 31 })).toBe('2026-12-31');
    expect(fiscalYearEndIn(2027, { month: 2, day: 31 })).toBe('2027-02-28');
    expect(monthsAfter('2026-12-31', 3)).toBe('2027-03-31');
    expect(monthsAfter('2027-03-31', 3)).toBe('2027-06-30');
    expect(monthsAfter('2026-11-30', 3)).toBe('2027-02-28');
    expect(monthsAfter('2026-12-15', 3)).toBe('2027-03-15');
    expect(dayOfMonthAfter('2026-12-31', 4, 15)).toBe('2027-04-15');
    expect(dayOfMonthAfter('2027-01-31', 1, 30)).toBe('2027-02-28');
  });

  it('a W.L.L. owned by Kuwaitis files audited statements with MOCI', () => {
    expect(due(context('wll'))).toEqual(['2027-03-31 audited_statements:2026-12-31']);
  });

  it('the filing month is a setting', () => {
    expect(due(context('wll', 0, { settings: { auditFilingMonths: 4, pifssDueDay: 15 } }))).toEqual(
      ['2027-04-30 audited_statements:2026-12-31'],
    );
  });

  it('a closed shareholding company adds Zakat and KFAS', () => {
    expect(due(context('kscc'))).toEqual([
      '2027-03-31 audited_statements:2026-12-31',
      '2027-04-15 kfas:2026-12-31',
      '2027-04-15 zakat:2026-12-31',
    ]);
  });

  it('a listed company also pays NLST', () => {
    expect(due(context('ksc_listed'))).toEqual([
      '2027-03-31 audited_statements:2026-12-31',
      '2027-04-15 kfas:2026-12-31',
      '2027-04-15 nlst:2026-12-31',
      '2027-04-15 zakat:2026-12-31',
    ]);
  });

  it('a W.L.L. with foreign shareholders files income tax and pays it in four instalments', () => {
    const deadlines = statutoryDeadlines(context('wll', 49), '2027-01-01', '2027-12-31');
    expect(deadlines.map((d) => `${d.dueDate} ${d.key}`)).toEqual([
      '2027-03-31 audited_statements:2026-12-31',
      '2027-04-15 income_tax_instalment_1:2026-12-31',
      '2027-04-15 income_tax_return:2026-12-31',
      '2027-06-15 income_tax_instalment_2:2026-12-31',
      '2027-09-15 income_tax_instalment_3:2026-12-31',
      '2027-12-15 income_tax_instalment_4:2026-12-31',
    ]);
    expect(deadlines[3]).toMatchObject({
      rule: 'income_tax_instalment',
      vars: { number: 2 },
      period: '2026-12-31',
      checkWithAuditor: true,
    });
  });

  it('sole proprietors have no statutory filings', () => {
    expect(due(context('sole_proprietorship'))).toEqual([]);
  });

  it('follows another year end', () => {
    expect(
      due(context('wll', 0, { fiscalYearEnd: { month: 3, day: 31 } }), '2027-01-01', '2027-12-31'),
    ).toEqual(['2027-06-30 audited_statements:2027-03-31']);
  });

  it('PIFSS is paid monthly by the due day, when there are Kuwaiti or GCC staff', () => {
    const ctx = context('sole_proprietorship', 0, { pifss: true });
    expect(due(ctx, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-15 pifss:2026-09',
      '2026-11-15 pifss:2026-10',
      '2026-12-15 pifss:2026-11',
    ]);
    expect(
      due(
        { ...ctx, settings: { auditFilingMonths: 3, pifssDueDay: 10 } },
        '2026-10-11',
        '2026-11-30',
      ),
    ).toEqual(['2026-11-10 pifss:2026-10']);
  });
});

describe('the compliance calendar', () => {
  const ctx = context('wll', 0, { pifss: true });

  it('merges deadlines and documents, overdue first, and hides what is done', () => {
    const residency = employeeDocuments(
      createEmployee('co', {
        category: 'expat',
        residencyNumber: '18/1',
        residencyExpiry: '2026-10-23',
      }),
      DAYS,
    );
    const licence = registerEntries({
      employees: [],
      documents: [
        createComplianceDocument('co', { type: 'commercial_licence', expiryDate: '2026-09-30' }),
        createComplianceDocument('co', { type: 'kcci_membership', expiryDate: '2027-06-30' }),
      ],
      reminderDays: DAYS,
    });
    const items = complianceCalendar({
      ctx,
      entries: [...residency, ...licence],
      marks: [
        {
          id: 'co:pifss:2026-09',
          companyId: 'co',
          key: 'pifss:2026-09',
          doneOn: '2026-10-01',
          note: '',
          createdAt: '',
        },
      ],
      from: '2026-10-03',
      days: 90,
      overdueSince: '2026-08-01',
    });
    expect(items.map((i) => `${i.dueDate} ${i.status} ${i.kind}`)).toEqual([
      '2026-08-15 overdue statutory', // PIFSS for July, not marked
      '2026-09-15 overdue statutory', // PIFSS for August
      '2026-09-30 overdue document', // expired licence
      '2026-10-15 done statutory', // PIFSS for September, marked done
      '2026-10-23 due_soon document', // residency, 20 days left
      '2026-11-15 upcoming statutory',
      '2026-12-15 upcoming statutory',
    ]);
    expect(items[4].entry?.type).toBe('residency');
    expect(items[4].daysLeft).toBe(20);
    expect(items[3].mark?.doneOn).toBe('2026-10-01');
  });

  it('reports nothing as overdue before the given date', () => {
    const items = complianceCalendar({
      ctx,
      entries: [],
      marks: [],
      from: '2026-10-03',
      days: 30,
      overdueSince: '2026-10-03',
    });
    expect(items.map((i) => i.key)).toEqual(['pifss:2026-09']);
  });
});
