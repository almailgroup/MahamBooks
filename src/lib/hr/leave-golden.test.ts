/**
 * Today's leave numbers, pinned before custom leave reasons (#15) touched
 * the leave code: every record without a reason must keep giving exactly
 * these, with or without the company's reasons and switches. Made-up data.
 */
import { describe, expect, it } from 'vitest';
import type { LeaveRecord } from '@/db/types';
import { kuwaitHolidays } from '@/lib/kuwait';
import {
  accrualOptions,
  annualLeaveBalance,
  dayOffChecker,
  DEFAULT_LEAVE_POLICY,
  leaveInPeriod,
  sickDaysByTier,
} from './leave';

const official = dayOffChecker((year) => kuwaitHolidays(year).map((h) => h.date));

let n = 0;
function record(overrides: Partial<LeaveRecord>): LeaveRecord {
  n += 1;
  return {
    id: `r${n}`,
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

/** Every kind of leave the six types give, overlaps and a cancelled record included. */
const GOLDEN_RECORDS: LeaveRecord[] = [
  record({ kind: 'opening', start: '2025-01-01', end: '2025-01-01', days: 12 }),
  record({ start: '2026-01-04', end: '2026-01-15', days: 10 }),
  record({ type: 'sick', start: '2026-02-01', end: '2026-03-15', days: 27 }),
  record({ type: 'unpaid', start: '2026-04-12', end: '2026-05-03', days: 22 }),
  record({ type: 'sick', start: '2026-04-26', end: '2026-04-30', days: 5 }),
  record({ type: 'maternity', start: '2026-06-01', end: '2026-07-15', days: 45 }),
  record({ type: 'hajj', start: '2025-06-01', end: '2025-06-10', days: 10 }),
  record({ type: 'bereavement', start: '2026-08-02', end: '2026-08-04', days: 3 }),
  record({ kind: 'adjustment', start: '2026-08-15', end: '2026-08-15', days: 3 }),
  record({ type: 'unpaid', start: '2026-09-01', end: '2026-09-20', days: 20 }),
  record({ type: 'unpaid', start: '2026-10-05', end: '2026-10-10', days: 6, status: 'cancelled' }),
  record({ start: '2026-11-01', end: '2026-11-20', days: 14 }),
];

type Pair = [percent: number, days: number];

/** Per month: calendar unpaid days, calendar reduced pay, working unpaid days, working reduced pay, days by type. */
const MONTHS: Record<string, [number, Pair[], number, Pair[], Record<string, number>]> = {
  '2026-01': [0, [], 0, [], { annual: 10 }],
  '2026-02': [0, [[75, 7]], 0, [[75, 3]], { sick: 18 }],
  '2026-03': [
    0,
    [
      [75, 9],
      [50, 6],
    ],
    0,
    [
      [75, 7],
      [50, 4],
    ],
    { sick: 11 },
  ],
  '2026-04': [19, [], 15, [], { unpaid: 19, sick: 5 }],
  '2026-05': [3, [], 1, [], { unpaid: 3 }],
  '2026-06': [0, [], 0, [], { maternity: 30 }],
  '2026-07': [0, [], 0, [], { maternity: 15 }],
  '2026-08': [0, [], 0, [], { bereavement: 3 }],
  '2026-09': [20, [], 14, [], { unpaid: 20 }],
  '2026-10': [0, [], 0, [], {}],
  '2026-11': [0, [], 0, [], { annual: 15 }],
  '2026-12': [0, [], 0, [], {}],
};

const BALANCES: Record<string, number> = {
  '2024-12-31': 12,
  '2025-01-31': 14.5,
  '2025-06-30': 27,
  '2025-12-31': 42,
  '2026-03-31': 39.5,
  '2026-05-31': 44.5,
  '2026-08-31': 55,
  '2026-09-30': 57.5,
  '2026-12-31': 51,
};

/** Balance, days lost over the cap and days earned, with 36 days from July 2025 and a cap of 10. */
const CAPPED: Record<string, [number, number | undefined, number]> = {
  '2024-12-31': [12, undefined, 0],
  '2025-01-31': [14.5, undefined, 2.5],
  '2025-06-30': [27, undefined, 15],
  '2025-12-31': [45, undefined, 33],
  '2026-03-31': [36, 8, 42],
  '2026-05-31': [42, 8, 48],
  '2026-08-31': [54, 8, 57],
  '2026-09-30': [57, 8, 60],
  '2026-12-31': [52, 8, 69],
};

const pairs = (list: { percent: number; days: number }[]): Pair[] =>
  list.map((r) => [r.percent, r.days]);

describe('leave without reasons, as before', () => {
  it('pays each month exactly as before', () => {
    for (const [period, [unpaid, reduced, wUnpaid, wReduced, byType]] of Object.entries(MONTHS)) {
      const got = leaveInPeriod(GOLDEN_RECORDS, period, official, { from: '2024-03-10' });
      expect([got.unpaidDays, pairs(got.reducedPay)], period).toEqual([unpaid, reduced]);
      expect([got.working.unpaidDays, pairs(got.working.reducedPay)], period).toEqual([
        wUnpaid,
        wReduced,
      ]);
      expect(got.byType, period).toEqual(byType);
    }
    // A leaver on 10 September: only the days employed.
    const leaver = leaveInPeriod(GOLDEN_RECORDS, '2026-09', official, {
      from: '2024-03-10',
      to: '2026-09-10',
    });
    expect([leaver.unpaidDays, leaver.working.unpaidDays]).toEqual([10, 8]);
  });

  it('keeps every annual leave balance', () => {
    for (const [on, balance] of Object.entries(BALANCES)) {
      expect(annualLeaveBalance(GOLDEN_RECORDS, '2024-03-10', on).balance, on).toBe(balance);
    }
    const capped = {
      ...DEFAULT_LEAVE_POLICY,
      annualDays: [{ from: '2025-07-01', days: 36 }],
      carryForwardMax: 10,
    };
    for (const [on, [balance, forfeited, accrued]] of Object.entries(CAPPED)) {
      const got = annualLeaveBalance(GOLDEN_RECORDS, '2024-03-10', on, null, capped);
      expect([got.balance, got.forfeited, got.accrued], on).toEqual([balance, forfeited, accrued]);
    }
  });

  it('keeps the sick leave tiers of the year', () => {
    expect(pairs(sickDaysByTier(GOLDEN_RECORDS, 2026, official))).toEqual([
      [100, 15],
      [75, 10],
      [50, 9],
      [25, 0],
      [0, 0],
    ]);
  });

  it('gives the same balances with the pause switched off, or from after the leave', () => {
    for (const accrual of [
      accrualOptions(undefined),
      accrualOptions({ leaveAccrualPause: null }),
      accrualOptions({ leaveAccrualPause: { from: '2027-01-01' } }),
    ]) {
      for (const [on, balance] of Object.entries(BALANCES)) {
        const got = annualLeaveBalance(
          GOLDEN_RECORDS,
          '2024-03-10',
          on,
          null,
          null,
          null,
          null,
          accrual,
        );
        expect(got.balance, on).toBe(balance);
        expect(got.pausedMonths).toBeUndefined();
      }
    }
  });

  it('pauses the months of long unpaid leave once switched on', () => {
    // April (19 days) and September (20 days) of 2026 earn nothing; May (3 days) does.
    const from2026 = accrualOptions({ leaveAccrualPause: { from: '2026-01-01' } });
    const got = (on: string, accrual = from2026) =>
      annualLeaveBalance(GOLDEN_RECORDS, '2024-03-10', on, null, null, null, null, accrual);
    expect(got('2026-03-31').balance).toBe(39.5);
    expect(got('2026-05-31')).toMatchObject({ balance: 42, pausedMonths: 1 });
    expect(got('2026-12-31')).toMatchObject({ balance: 46, pausedMonths: 2 });
    const fromMay = accrualOptions({ leaveAccrualPause: { from: '2026-05-01' } });
    expect(got('2026-12-31', fromMay)).toMatchObject({ balance: 48.5, pausedMonths: 1 });
  });
});
