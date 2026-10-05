/**
 * Review findings (payroll / HR): each test states what should happen and
 * fails while the bug is there. Names and numbers are made up.
 */
import { describe, expect, it } from 'vitest';
import type { LeaveRecord, PayLine, PayRules } from '@/db/types';
import { calculateEosi, serviceYears } from './eosi';
import { calculatePayLine, lastMonthDays } from './payroll';
import { dayOffChecker, leaveInPeriod } from './leave';
import { kuwaitHolidays } from '@/lib/kuwait';
import { matchDocuments, numberInFileName } from './document-match';
import { buildSalaryFile, presetLayout } from './salary-file';

const RULES: PayRules = {
  dailyDivisor: 26,
  rateBase: 'wage',
  pifss: { from: '2026-01-01', employer: 11.5, employee: 10.5, cap: 2750 },
  gcc: [],
  minimumWage: 75,
};

function line(overrides: Partial<PayLine> = {}): PayLine {
  return {
    id: 'l1',
    employeeId: 'e1',
    number: '000015',
    name: 'Test Guard',
    nameAr: '',
    jobTitle: '',
    jobTitleAr: '',
    category: 'expat',
    nationality: 'IN',
    civilId: '',
    iban: 'KW81CBKU0000000000001234560101',
    hireDate: '2020-01-01',
    leavingDate: null,
    permitSalary: 0,
    monthlyBasic: 260,
    allowances: [],
    daysWorked: 30,
    daysInMonth: 30,
    overtime: { normal: 0, restDay: 0, holiday: 0 },
    absentDays: 0,
    unpaidLeaveDays: 0,
    reducedPay: [],
    // As pay runs prepare lines now: leave in calendar days.
    leaveBasis: 'calendar',
    adjustments: [],
    loans: [],
    basic: 0,
    allowanceTotal: 0,
    overtimePay: 0,
    absenceDeduction: 0,
    additions: 0,
    gross: 0,
    pifssBase: 0,
    pifssEmployee: 0,
    pifssEmployer: 0,
    loanDeduction: 0,
    otherDeductions: 0,
    net: 0,
    ...overrides,
  };
}

function leave(overrides: Partial<LeaveRecord>): LeaveRecord {
  return {
    id: 'r1',
    companyId: 'c1',
    employeeId: 'e1',
    type: 'unpaid',
    kind: 'leave',
    start: '2026-09-01',
    end: '2026-09-30',
    days: 0,
    status: 'approved',
    notes: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('service years end on the leaving date, which is a day worked', () => {
  it('counts the leaving date itself, as the last salary and leave accrual do', () => {
    // Hired 1 Oct 2023, last day 30 Sep 2026: exactly three years.
    // The last salary pays 30 September as a day worked...
    expect(lastMonthDays('2023-10-01', '2026-09-30')).toBe(30);
    // ...so the service is three full years.
    expect(serviceYears('2023-10-01', '2026-09-30')).toBeGreaterThanOrEqual(3);
  });

  it('gives half the indemnity to a worker who resigns on the last day of year 3', () => {
    const years = serviceYears('2023-10-01', '2026-09-30');
    const result = calculateEosi({
      payBasis: 'monthly',
      monthlyWage: 500,
      years,
      reason: 'resignation',
    });
    expect(result.share).toEqual({ numerator: 1, denominator: 2 });
    expect(result.payable).toBeGreaterThan(0);
  });

  it('pays in full a worker who resigns on the last day of year 10', () => {
    const years = serviceYears('2016-01-01', '2025-12-31');
    const result = calculateEosi({
      payBasis: 'monthly',
      monthlyWage: 800,
      years,
      reason: 'resignation',
    });
    expect(result.share).toEqual({ numerator: 1, denominator: 1 });
  });
});

describe('unpaid leave', () => {
  const noHolidays = dayOffChecker(() => []);

  it('a whole month of unpaid leave leaves nothing to pay', () => {
    const month = leaveInPeriod([leave({})], '2026-09', noHolidays);
    const paid = calculatePayLine(
      line({ unpaidLeaveDays: month.unpaidDays, reducedPay: month.reducedPay }),
      RULES,
      3,
    );
    // Not one day of September was worked or paid leave.
    expect(paid.gross).toBe(0);
    expect(paid.net).toBe(0);
  });

  it('a week of unpaid leave costs a week of pay, weekend included', () => {
    // Sun 6 – Sat 12 September 2026: 7 calendar days off without pay.
    const week = leaveInPeriod(
      [leave({ start: '2026-09-06', end: '2026-09-12' })],
      '2026-09',
      dayOffChecker((y) => kuwaitHolidays(y).map((h) => h.date)),
    );
    const paid = calculatePayLine(line({ unpaidLeaveDays: week.unpaidDays }), RULES, 3);
    // 260 × 7 ÷ 30 = 60.667, not 260 ÷ 26 × 5 working days = 50.
    expect(paid.absenceDeduction).toBe(60.667);
  });
});

describe('salary file for staff paid on salary cards', () => {
  it('does not put a card number under the IBAN header', () => {
    const file = buildSalaryFile(
      [
        {
          employeeId: 'e1',
          employeeNumber: '000101',
          civilId: '',
          nameEn: 'Test Guard One',
          nameAr: '',
          iban: '',
          accountNumber: '5407000000000008',
          amount: 260,
        },
      ],
      {
        layout: presetLayout('wps'),
        period: '2026-09',
        currency: 'KWD',
        precision: 3,
        pamFileNumber: '',
        reference: '',
      },
    );
    const ibanColumn = file.headers.indexOf('IBAN');
    expect(file.problems).toEqual([]); // the file is offered for download
    expect(file.rows[0][ibanColumn]).not.toBe('5407000000000008');
  });
});

describe('employee numbers in document file names', () => {
  it('does not take the day of a date at the end of the name for an employee number', () => {
    // “Dates and times are not taken for numbers” (document-match.ts).
    expect(numberInFileName('Residency 2026-03-15.pdf')).toBeNull();
    const [match] = matchDocuments(
      [{ name: 'Residency 2026-03-15.pdf', size: 1000, type: 'application/pdf' }],
      [{ id: 'guard-15', number: '000015' }],
    );
    expect(match.status).not.toBe('matched');
  });
});
