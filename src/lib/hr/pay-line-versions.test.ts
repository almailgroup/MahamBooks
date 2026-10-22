/**
 * Pay lines are read by more than one version of the app: another device on
 * the same cloud company, or a restored backup. Versions before October 2026
 * read unpaidLeaveDays and reducedPay as working days at the daily rate;
 * this one pays leave from calendarLeave. Lines prepared on 5 and 6 October
 * 2026 had calendar days in the old fields, marked by leaveBasis.
 */
import { describe, expect, it } from 'vitest';
import { calculatePayLine } from './payroll';
import type { PayLine, PayRules } from '@/db/types';

const rules: PayRules = {
  dailyDivisor: 26,
  rateBase: 'wage',
  pifss: null,
  gcc: [],
  minimumWage: 75,
};

const line = {
  id: 'line-1',
  employeeId: 'emp-1',
  number: '7',
  name: 'Test Driver',
  nameAr: '',
  jobTitle: '',
  jobTitleAr: '',
  category: 'expat',
  nationality: 'IN',
  civilId: '',
  iban: '',
  hireDate: '2022-01-01',
  leavingDate: null,
  permitSalary: 0,
  monthlyBasic: 300,
  allowances: [],
  daysWorked: 30,
  daysInMonth: 30,
  overtime: { normal: 0, restDay: 0, holiday: 0 },
  absentDays: 0,
  unpaidLeaveDays: 0,
  reducedPay: [],
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
} as PayLine;

/** What a version before October 2026 does with a line: it knows only the old fields. */
const olderVersion = ({ calendarLeave: _c, leaveBasis: _b, ...old }: PayLine) =>
  calculatePayLine(old, rules, 3);

describe('a stored pay line', () => {
  it('as prepared on 5 October 2026 (calendar days in the old fields) costs 10/30 of the month', () => {
    // 10 calendar days of unpaid leave, as that version stored them.
    const stored = { ...line, unpaidLeaveDays: 10, leaveBasis: 'calendar' } as PayLine;
    expect(calculatePayLine(stored, rules, 3).absenceDeduction).toBe(100);
  });

  it('as prepared now means the same to older versions as their own lines', () => {
    // Ten days of unpaid leave, two of them a weekend: 8 working days.
    const stored = {
      ...line,
      unpaidLeaveDays: 8,
      calendarLeave: { unpaidDays: 10, reducedPay: [] },
    } as PayLine;
    // This version: 10 of the month's 30 days.
    expect(calculatePayLine(stored, rules, 3).absenceDeduction).toBe(100);
    // An older version: 8 working days at the daily rate (300 ÷ 26), as it always deducted.
    expect(olderVersion(stored).absenceDeduction).toBe(92.308);
  });

  it('with leave on half pay (a company’s reason) means half pay to versions that know calendar days', () => {
    // Ten days at half pay, two of them a weekend: 8 working days at half pay.
    const stored = {
      ...line,
      reducedPay: [{ percent: 50, days: 8 }],
      calendarLeave: { unpaidDays: 0, reducedPay: [{ percent: 50, days: 10 }] },
      leaveDetail: [{ reasonId: 'study', name: 'Study leave', nameAr: '', days: 10, percent: 50 }],
    } as PayLine;
    // This version: half of 10 of the month's 30 days.
    expect(calculatePayLine(stored, rules, 3).absenceDeduction).toBe(50);
    // The detail is only shown, never paid from, and stays on the line.
    expect(calculatePayLine(stored, rules, 3).leaveDetail).toEqual(stored.leaveDetail);
    // An older version: 8 working days at half the daily rate.
    expect(olderVersion(stored).absenceDeduction).toBe(46.154);
  });
});
