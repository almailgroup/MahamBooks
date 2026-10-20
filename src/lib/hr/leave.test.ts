import { describe, expect, it } from 'vitest';
import type { Employee, LeavePolicy, LeaveRecord } from '@/db/types';
import { kuwaitHolidays } from '@/lib/kuwait';
import {
  annualDaysOn,
  annualLeaveBalance,
  annualLeaveRecorded,
  completedMonths,
  countLeaveDays,
  dayOffChecker,
  DEFAULT_LEAVE_POLICY,
  employeeLeaveBalance,
  employeesNeedingLeaveOpening,
  leaveCounting,
  leaveInPeriod,
  leavePolicyStart,
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
      working: { unpaidDays: 0, reducedPay: [] },
      byType: { sick: 15 },
    });
    expect(leaveInPeriod(records, '2026-04', dayOff)).toEqual({
      unpaidDays: 2,
      reducedPay: [{ percent: 75, days: 5 }],
      working: { unpaidDays: 2, reducedPay: [{ percent: 75, days: 5 }] },
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
      // As older versions count them: 8 working days, Thursday 26 unpaid.
      working: { unpaidDays: 1, reducedPay: [{ percent: 75, days: 7 }] },
      byType: { sick: 23, unpaid: 3 },
    });
    // Thursday 2 April is the 25th working day; Friday and Saturday follow it.
    expect(leaveInPeriod(records, '2026-04', dayOff)).toEqual({
      unpaidDays: 0,
      reducedPay: [{ percent: 75, days: 4 }],
      working: { unpaidDays: 0, reducedPay: [{ percent: 75, days: 2 }] },
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

  it('starts from leave brought forward, or an opening record that replaces it', () => {
    const opening = (start: string, days: number) =>
      record({ kind: 'opening', start, end: start, days });
    const imported = { date: '2026-10-05', days: 0, confirmed: false };
    // An opening record replaces an import's 0 days nobody confirmed, whatever its date.
    expect(
      annualLeaveBalance([opening('2026-10-01', 15)], '2021-03-01', '2026-10-31', imported),
    ).toMatchObject({ from: '2026-10-01', opening: 15, accrued: 2.5, balance: 17.5 });
    // Confirmed leave brought forward counts from its date; a record dated before it only
    // before then, and a record on or after it from its own date.
    const confirmed = { date: '2026-10-05', days: 10, confirmed: true };
    const early = [opening('2026-10-01', 15)];
    expect(annualLeaveBalance(early, '2021-03-01', '2026-10-31', confirmed).balance).toBe(10);
    expect(annualLeaveBalance(early, '2021-03-01', '2026-10-03', confirmed).balance).toBe(15);
    const late = [opening('2026-10-05', 12)];
    expect(annualLeaveBalance(late, '2021-03-01', '2026-10-31', confirmed).balance).toBe(12);
  });

  it('works the balance back from the first opening, never from the hire date', () => {
    const brought = { date: '2026-10-05', days: 12.5, confirmed: true };
    const on = (date: string) => annualLeaveBalance([], '2021-03-01', date, brought);
    // No complete month between 30 September and 5 October.
    expect(on('2026-09-30')).toMatchObject({ from: '2026-10-05', opening: 12.5, balance: 12.5 });
    // September is a complete month before it: 12.5 − 2.5.
    expect(on('2026-08-31')).toMatchObject({ accrued: -2.5, balance: 10 });
    // Never below 0, and nothing before the hire date.
    expect(on('2026-03-31').balance).toBe(0);
    expect(annualLeaveBalance([], '2026-09-01', '2026-08-31', brought).balance).toBe(0);
    // An opening record after the day works the same way.
    const records = [record({ kind: 'opening', start: '2026-10-01', end: '2026-10-01', days: 15 })];
    expect(annualLeaveBalance(records, '2021-03-01', '2026-09-30').balance).toBe(15);
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

describe('the company’s leave policy', () => {
  const policy = (overrides: Partial<LeavePolicy>): LeavePolicy => ({
    ...DEFAULT_LEAVE_POLICY,
    ...overrides,
  });

  it('is the law’s until one is set: the same balances as before', () => {
    const records = [
      record({ start: '2022-06-01', end: '2022-06-05', days: 5 }),
      record({ kind: 'opening', start: '2024-01-01', end: '2024-01-01', days: 12 }),
      record({ kind: 'adjustment', start: '2024-02-01', end: '2024-02-01', days: -2 }),
      record({ start: '2025-03-01', end: '2025-03-10', days: 8 }),
      record({ start: '2025-04-01', end: '2025-04-01', days: 1, status: 'cancelled' }),
    ];
    const brought = { date: '2021-07-05', days: 4, confirmed: true };
    // The law's days written out from a date, and an entitlement of the same 30 days.
    const law = policy({ annualDays: [{ from: '2015-01-01', days: 30 }] });
    // The same days again from a date in the middle of a month of service.
    const again = policy({ annualDays: [{ from: '2023-03-15', days: 30 }] });
    for (const on of ['2021-03-31', '2021-07-04', '2023-12-31', '2024-06-30', '2026-10-31']) {
      const today = annualLeaveBalance(records, '2020-05-01', on, brought);
      expect(annualLeaveBalance(records, '2020-05-01', on, brought, DEFAULT_LEAVE_POLICY)).toEqual(
        today,
      );
      expect(annualLeaveBalance(records, '2020-05-01', on, brought, law)).toEqual(today);
      expect(annualLeaveBalance(records, '2020-05-01', on, brought, again)).toEqual(today);
      expect(annualLeaveBalance(records, '2020-05-01', on, brought, null, 30)).toEqual(today);
    }
    expect(annualLeaveBalance(records, '2020-05-01', '2026-10-31', brought)).not.toHaveProperty(
      'forfeited',
    );
    expect(annualDaysOn('2026-10-31')).toBe(30);
    expect(
      countLeaveDays('annual', '2026-02-23', '2026-03-01', official, DEFAULT_LEAVE_POLICY),
    ).toBe(3);
    expect(leavePolicyStart(DEFAULT_LEAVE_POLICY)).toBeNull();
  });

  it('gives 3.75 days a month for 45 days a year, from the policy or the employee’s contract', () => {
    const generous = policy({ annualDays: [{ from: '2026-01-01', days: 45 }] });
    expect(annualLeaveBalance([], '2026-01-01', '2026-06-30', null, generous)).toMatchObject({
      accrued: 22.5,
      balance: 22.5,
    });
    expect(annualDaysOn('2025-12-31', generous)).toBe(30);
    expect(annualDaysOn('2026-01-01', generous)).toBe(45);
    // The employee's own days count throughout, whatever the policy's dates.
    const employee = { id: 'e', hireDate: '2020-01-01', annualLeaveDays: 45 };
    expect(employeeLeaveBalance(employee, [], '2020-04-30').balance).toBe(15);
    expect(employeeLeaveBalance(employee, [], '2020-04-30', generous).balance).toBe(15);
    expect(annualDaysOn('2020-04-30', generous, 45)).toBe(45);
  });

  it('counts a change in the middle of the year from its date only', () => {
    const july = policy({ annualDays: [{ from: '2026-07-01', days: 45 }] });
    // Six months at 2.5 days, then six at 3.75.
    expect(annualLeaveBalance([], '2026-01-01', '2026-06-30', null, july).balance).toBe(15);
    expect(annualLeaveBalance([], '2026-01-01', '2026-12-31', null, july).balance).toBe(37.5);
    // Hired on the 15th: the month from 15 June to 14 July earns 16 days' share at 30 days
    // a year and 14 days' at 45, 1.33 + 1.75.
    expect(annualLeaveBalance([], '2026-01-15', '2026-06-30', null, july).balance).toBe(12.5);
    expect(annualLeaveBalance([], '2026-01-15', '2026-07-14', null, july).balance).toBe(15.58);
    // Back to 30 days a year in 2027.
    const back = policy({
      annualDays: [
        { from: '2026-07-01', days: 45 },
        { from: '2027-01-01', days: 30 },
      ],
    });
    expect(annualLeaveBalance([], '2026-01-01', '2027-06-30', null, back).balance).toBe(52.5);
    // From an opening balance after the change, at the new days.
    const opening = [record({ kind: 'opening', start: '2026-09-01', end: '2026-09-01', days: 10 })];
    expect(annualLeaveBalance(opening, '2021-03-01', '2026-12-31', null, july)).toMatchObject({
      from: '2026-09-01',
      accrued: 15,
      balance: 25,
    });
    // Worked back from leave brought forward: September earned 3.75 days.
    const brought = { date: '2026-10-05', days: 12.5, confirmed: true };
    expect(annualLeaveBalance([], '2021-03-01', '2026-08-31', brought, july).balance).toBe(8.75);
  });

  it('loses unused days over the cap when a new year starts, from the policy’s date', () => {
    const capped = policy({ annualDays: [{ from: '2026-01-01', days: 30 }], carryForwardMax: 10 });
    expect(leavePolicyStart(capped)).toBe('2026-01-01');
    expect(annualLeaveBalance([], '2025-01-01', '2025-12-31', null, capped)).toMatchObject({
      balance: 30,
    });
    // 30 days at the end of 2025, 10 of them carried into 2026.
    expect(annualLeaveBalance([], '2025-01-01', '2026-01-31', null, capped)).toMatchObject({
      accrued: 32.5,
      forfeited: 20,
      balance: 12.5,
    });
    // 35 days at the end of 2026 after 5 taken in March: 25 more lost.
    const taken = [record({ start: '2026-03-01', end: '2026-03-05', days: 5 })];
    expect(annualLeaveBalance(taken, '2025-01-01', '2027-01-31', null, capped)).toMatchObject({
      accrued: 62.5,
      taken: 5,
      forfeited: 45,
      balance: 12.5,
    });
    expect(annualLeaveBalance(taken, '2025-01-01', '2027-01-31').balance).toBe(57.5);
    // A policy from June 2026 leaves the start of 2026 alone.
    const june = policy({ annualDays: [{ from: '2026-06-01', days: 30 }], carryForwardMax: 10 });
    expect(annualLeaveBalance([], '2025-01-01', '2026-01-31', null, june).balance).toBe(32.5);
    expect(annualLeaveBalance([], '2025-01-01', '2027-01-31', null, june)).toMatchObject({
      forfeited: 50,
      balance: 12.5,
    });
  });

  it('sets the months before the first leave and how annual leave is counted', () => {
    const six = policy({ firstYearMonths: 6 });
    expect(annualLeaveBalance([], '2026-01-01', '2026-03-31', null, six).eligibleFrom).toBe(
      '2026-07-01',
    );
    const calendar = policy({ counting: 'calendar' });
    expect(leaveCounting('annual')).toBe('working');
    expect(leaveCounting('annual', calendar)).toBe('calendar');
    expect(leaveCounting('maternity', calendar)).toBe('calendar');
    expect(leaveCounting('sick', calendar)).toBe('working');
    // Mon 23 Feb – Sun 1 Mar 2026: every day of annual leave, still three working days of sick leave.
    expect(countLeaveDays('annual', '2026-02-23', '2026-03-01', official, calendar)).toBe(7);
    expect(countLeaveDays('sick', '2026-02-23', '2026-03-01', official, calendar)).toBe(3);
    // The counting stays once annual leave is recorded: other leave and cancelled leave don't count.
    expect(annualLeaveRecorded([])).toBe(false);
    expect(
      annualLeaveRecorded([
        record({ kind: 'opening', days: 10 }),
        record({ type: 'sick' }),
        record({ status: 'cancelled' }),
      ]),
    ).toBe(false);
    expect(annualLeaveRecorded([record({ days: 1 })])).toBe(true);
  });
});
