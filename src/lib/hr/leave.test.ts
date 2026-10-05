import { describe, expect, it } from 'vitest';
import type { Employee, LeaveRecord } from '@/db/types';
import { kuwaitHolidays } from '@/lib/kuwait';
import {
  annualLeaveBalance,
  completedMonths,
  countLeaveDays,
  dayOffChecker,
  employeesNeedingLeaveOpening,
  leaveInPeriod,
  leaveWarnings,
  sickDayRates,
  sickDaysByTier,
  sickPercent,
} from './leave';

const official = dayOffChecker((year) => kuwaitHolidays(year).map((h) => h.date));

function record(overrides: Partial<LeaveRecord>): LeaveRecord {
  return {
    id: Math.random().toString(36).slice(2),
    companyId: 'c',
    employeeId: 'e',
    type: 'annual',
    kind: 'leave',
    start: '2026-01-01',
    end: '2026-01-01',
    days: 0,
    status: 'approved',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('counting leave days', () => {
  it('skips Fridays, Saturdays and public holidays', () => {
    // Mon 23 Feb – Sun 1 Mar 2026: National Day (Wed 25) and Liberation Day
    // (Thu 26) are holidays, Friday 27 and Saturday 28 the weekend.
    expect(countLeaveDays('annual', '2026-02-23', '2026-03-01', official)).toBe(3);
    // A plain working week.
    expect(countLeaveDays('annual', '2026-03-01', '2026-03-05', official)).toBe(5);
  });

  it('uses the company’s own holidays when given', () => {
    const company = dayOffChecker(() => ['2026-03-03']);
    expect(countLeaveDays('annual', '2026-03-01', '2026-03-05', company)).toBe(4);
  });

  it('counts calendar days for maternity, Hajj and unpaid leave', () => {
    expect(countLeaveDays('maternity', '2026-02-23', '2026-03-01', official)).toBe(7);
    expect(countLeaveDays('hajj', '2026-05-01', '2026-05-21', official)).toBe(21);
    expect(countLeaveDays('unpaid', '2026-02-23', '2026-03-01', official)).toBe(7);
    expect(countLeaveDays('annual', '2026-03-05', '2026-03-01', official)).toBe(0);
  });
});

describe('sick leave', () => {
  it('is paid in tiers of 15, 10, 10, 10 and 30 days a year', () => {
    expect([0, 14, 15, 24, 25, 35, 45, 74, 75].map(sickPercent)).toEqual([
      100, 100, 75, 75, 50, 25, 0, 0, 0,
    ]);
  });

  it('feeds unpaid and reduced-pay days into the month’s pay', () => {
    const dayOff = dayOffChecker(() => []);
    // 20 working days in March and April 2026.
    const records = [
      record({ type: 'sick', start: '2026-03-01', end: '2026-03-19' }), // 15 working days
      record({ type: 'sick', start: '2026-04-05', end: '2026-04-09' }), // 5 working days
      record({ type: 'unpaid', start: '2026-04-12', end: '2026-04-13' }),
      record({ type: 'sick', start: '2026-04-14', end: '2026-04-14', status: 'cancelled' }),
    ];
    expect(sickDayRates(records, 2026, dayOff).size).toBe(20);
    expect(leaveInPeriod(records, '2026-03', dayOff)).toEqual({
      unpaidDays: 0,
      reducedPay: [],
      byType: { sick: 15 },
    });
    expect(leaveInPeriod(records, '2026-04', dayOff)).toEqual({
      unpaidDays: 2,
      reducedPay: [{ percent: 75, days: 5 }],
      byType: { sick: 5, unpaid: 2 },
    });
    expect(sickDaysByTier(records, 2026, dayOff)).toEqual([
      { percent: 100, days: 15 },
      { percent: 75, days: 5 },
      { percent: 50, days: 0 },
      { percent: 25, days: 0 },
      { percent: 0, days: 0 },
    ]);
  });

  it('costs pay for every calendar day: weekends inside take the working day before', () => {
    const dayOff = dayOffChecker(() => []);
    const records = [
      // 15 working days at full pay (1–19 March), then Sun 22 March – Sat 4 April:
      // 10 working days at three quarters and the weekends between them.
      record({ type: 'sick', start: '2026-03-01', end: '2026-03-19' }),
      record({ type: 'sick', start: '2026-03-22', end: '2026-04-04' }),
      // Unpaid leave on a sick day counts once, without pay.
      record({ type: 'unpaid', start: '2026-03-26', end: '2026-03-28' }),
    ];
    expect(leaveInPeriod(records, '2026-03', dayOff)).toEqual({
      unpaidDays: 3,
      // 22–31 March is 10 calendar days, 3 of them unpaid instead.
      reducedPay: [{ percent: 75, days: 7 }],
      byType: { sick: 23, unpaid: 3 },
    });
    // Thursday 2 April is the 25th working day; Friday and Saturday follow it.
    expect(leaveInPeriod(records, '2026-04', dayOff)).toEqual({
      unpaidDays: 0,
      reducedPay: [{ percent: 75, days: 4 }],
      byType: { sick: 2 },
    });
    // Only days of the employment count.
    expect(
      leaveInPeriod(records, '2026-03', dayOff, { from: '2026-03-27', to: '2026-03-29' }),
    ).toMatchObject({ unpaidDays: 2, reducedPay: [{ percent: 75, days: 1 }] });
  });
});

describe('annual leave balance', () => {
  it('accrues 2.5 days a month and carries unused days forward', () => {
    expect(completedMonths('2026-01-01', '2026-06-30')).toBe(6);
    expect(completedMonths('2026-01-15', '2026-02-13')).toBe(0);
    expect(completedMonths('2026-01-15', '2026-02-14')).toBe(1);
    const taken = [record({ start: '2026-04-05', end: '2026-04-09', days: 5 })];
    expect(annualLeaveBalance(taken, '2026-01-01', '2026-06-30')).toMatchObject({
      accrued: 15,
      taken: 5,
      balance: 10,
      eligibleFrom: '2026-10-01',
    });
    expect(annualLeaveBalance(taken, '2026-01-01', '2027-12-31').balance).toBe(55);
  });

  it('starts from an opening balance and counts adjustments after it', () => {
    const records = [
      record({ start: '2025-06-01', end: '2025-06-05', days: 5 }), // before the opening
      record({ kind: 'opening', start: '2026-01-01', end: '2026-01-01', days: 12 }),
      record({ kind: 'adjustment', start: '2026-02-01', end: '2026-02-01', days: -2 }),
      record({ start: '2026-03-01', end: '2026-03-03', days: 3 }),
      record({ start: '2026-04-01', end: '2026-04-01', days: 1, status: 'cancelled' }),
    ];
    expect(annualLeaveBalance(records, '2015-05-01', '2026-03-31')).toMatchObject({
      from: '2026-01-01',
      opening: 12,
      accrued: 7.5,
      adjusted: -2,
      taken: 3,
      balance: 14.5,
    });
  });

  it('warns about leave over the balance, before nine months, over limits and overlapping', () => {
    const others = [
      record({ id: 'x', type: 'hajj', start: '2024-06-01', end: '2024-06-21', days: 21 }),
    ];
    const balance = annualLeaveBalance([], '2026-01-01', '2026-06-30');
    expect(
      leaveWarnings(
        {
          id: 'n',
          type: 'annual',
          kind: 'leave',
          start: '2026-07-01',
          end: '2026-07-30',
          days: 22,
        },
        others,
        balance,
      ),
    ).toEqual([
      { code: 'over_balance', balance: 15 },
      { code: 'not_eligible', date: '2026-10-01' },
    ]);
    expect(
      leaveWarnings(
        { id: 'n', type: 'hajj', kind: 'leave', start: '2024-06-10', end: '2024-07-10', days: 31 },
        others,
        null,
      ).map((w) => w.code),
    ).toEqual(['over_limit', 'hajj_taken', 'overlap']);
  });
});

describe('employees needing an opening leave balance', () => {
  type Staff = Pick<Employee, 'id' | 'status' | 'hireDate' | 'createdAt' | 'leaveOpening'>;
  const staff = (id: string, overrides: Partial<Staff> = {}): Staff => ({
    id,
    status: 'active',
    hireDate: '2015-03-01',
    // Added on 20 September 2026.
    createdAt: '2026-09-20T08:00:00.000Z',
    leaveOpening: undefined,
    ...overrides,
  });

  it('are current staff hired before they were added, with no opening balance or record', () => {
    const employees = [
      staff('guard'),
      // Added within a month of joining: all their leave is here.
      staff('joiner', { hireDate: '2026-09-01' }),
      staff('month', { hireDate: '2026-08-19' }),
      staff('no-hire-date', { hireDate: null }),
      staff('confirmed', { leaveOpening: { date: '2026-10-01', days: 3, confirmed: true } }),
      // An import's 0 days, not confirmed yet.
      staff('imported', {
        hireDate: '2026-09-15',
        leaveOpening: { date: '2026-09-20', days: 0, confirmed: false },
      }),
      staff('opening-record'),
      staff('cancelled-record'),
      staff('left', { status: 'left' }),
    ];
    const records = [
      record({ employeeId: 'opening-record', kind: 'opening', start: '2026-01-01', days: 10 }),
      record({
        employeeId: 'cancelled-record',
        kind: 'opening',
        start: '2026-01-01',
        days: 10,
        status: 'cancelled',
      }),
      // Other leave doesn't give a balance to start from.
      record({ employeeId: 'guard', type: 'sick', start: '2026-09-21', end: '2026-09-22' }),
    ];
    expect(employeesNeedingLeaveOpening(employees, records).map((e) => e.id)).toEqual([
      'guard',
      'month',
      'no-hire-date',
      'imported',
      'cancelled-record',
    ]);
  });
});
