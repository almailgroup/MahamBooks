/**
 * The company's own leave reasons (#15): how their leave is paid, what it
 * does to balances, and the pause of annual leave in months of long unpaid
 * leave. Made-up data.
 */
import { describe, expect, it } from 'vitest';
import type { LeaveReason, LeaveRecord } from '@/db/types';
import { setDictionaryForTests } from '@/i18n';
import {
  accrualOptions,
  annualLeaveBalance,
  dayOffChecker,
  leaveInPeriod,
  leaveLabel,
  leaveReasonBase,
  leaveReasonPay,
  LEAVE_TYPES,
  leaveTypeInfo,
  leaveWarnings,
  reasonBalance,
  reasonDaysInYear,
  reasonOf,
  reasonsFor,
  sickDaysByTier,
  unpaidShare,
} from './leave';

const noHolidays = dayOffChecker(() => []);

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

const reason = (overrides: Partial<LeaveReason>): LeaveReason => ({
  id: 'x',
  name: 'Some leave',
  nameAr: 'إجازة ما',
  base: 'bereavement',
  pay: 'full',
  ...overrides,
});

const EMERGENCY = reason({
  id: 'emergency',
  name: 'Emergency leave',
  nameAr: 'إجازة طارئة',
  base: 'annual',
  pay: 'annual',
});
const COMPENSATORY = reason({
  id: 'comp',
  name: 'Compensatory days',
  nameAr: 'أيام بدل',
  pay: 'balance',
});
const HALF = reason({ id: 'half', name: 'Study leave', base: 'unpaid', pay: 'half' });
const MARRIAGE = reason({ id: 'marriage', name: 'Marriage leave', maxDaysPerYear: 5 });
const DOMESTIC = reason({ id: 'dom', name: 'Home visit', categories: ['domestic'] });

describe('reasons map onto the six types', () => {
  it('derive their base from how they are paid', () => {
    expect((['full', 'half', 'unpaid', 'annual', 'balance'] as const).map(leaveReasonBase)).toEqual(
      ['bereavement', 'unpaid', 'unpaid', 'annual', 'bereavement'],
    );
    // A way of paying a newer version saved reads as its base.
    expect(leaveReasonPay({ pay: 'other' as never, base: 'unpaid' }).percent).toBe(0);
    expect(leaveReasonPay({ pay: 'other' as never, base: 'bereavement' }).percent).toBe(100);
  });

  it('are named by the reason, in the interface language', () => {
    const reasons = [EMERGENCY];
    setDictionaryForTests('en', {});
    expect(leaveLabel({ type: 'annual', reasonId: 'emergency' }, reasons)).toBe('Emergency leave');
    expect(leaveLabel({ type: 'annual' }, reasons)).toBe('Annual leave');
    // A reason the company no longer has reads as its type.
    expect(leaveLabel({ type: 'bereavement', reasonId: 'gone' }, reasons)).toBe(
      'Bereavement leave',
    );
    setDictionaryForTests('ar', {});
    expect(leaveLabel({ type: 'annual', reasonId: 'emergency' }, reasons)).toBe('إجازة طارئة');
    setDictionaryForTests('en', {});
    expect(reasonOf({ reasonId: 'emergency' }, reasons)).toBe(EMERGENCY);
    expect(reasonOf({}, reasons)).toBeNull();
  });

  it('are read by older versions as their base type', () => {
    // What an older version knows of a record: its type, never the reason or the share.
    const older = ({ reasonId: _r, payPercent: _p, ...known }: LeaveRecord): LeaveRecord => known;
    const half = record({
      type: 'unpaid',
      reasonId: 'half',
      payPercent: 50,
      start: '2026-03-01',
      end: '2026-03-07',
    });
    expect(leaveTypeInfo(older(half).type)).toBe(LEAVE_TYPES.unpaid);
    // It pays leave on half pay as unpaid: a line it prepares must be updated here first.
    expect(leaveInPeriod([older(half)], '2026-03', noHolidays).unpaidDays).toBe(7);
    const full = record({ type: 'bereavement', reasonId: 'marriage', start: '2026-03-01' });
    expect(leaveTypeInfo(older(full).type).label).toBe('Bereavement leave');
  });

  it('are offered by category, and not once archived', () => {
    const all = [EMERGENCY, DOMESTIC, reason({ id: 'old', archived: true })];
    expect(reasonsFor(all, { category: 'expat' }).map((r) => r.id)).toEqual(['emergency']);
    expect(reasonsFor(all, { category: 'domestic' }).map((r) => r.id)).toEqual([
      'emergency',
      'dom',
    ]);
    expect(reasonsFor(undefined, { category: 'expat' })).toEqual([]);
  });
});

describe('pay', () => {
  it('a half-pay reason costs half of each calendar day', () => {
    // Sunday 1 to Saturday 7 March 2026: 7 calendar days, 5 working days.
    const half = record({
      type: 'unpaid',
      reasonId: 'half',
      payPercent: 50,
      start: '2026-03-01',
      end: '2026-03-07',
      days: 7,
    });
    const got = leaveInPeriod([half], '2026-03', noHolidays);
    expect(got.unpaidDays).toBe(0);
    expect(got.reducedPay).toEqual([{ percent: 50, days: 7 }]);
    // Older versions without calendar days read the working days.
    expect(got.working.reducedPay).toEqual([{ percent: 50, days: 5 }]);
    expect(got.byReason).toEqual([{ reasonId: 'half', type: 'unpaid', days: 7, percent: 50 }]);
  });

  it('without a share, unpaid leave pays nothing, as before', () => {
    expect(unpaidShare({})).toBe(0);
    expect(unpaidShare({ payPercent: Number.NaN })).toBe(0);
    expect(unpaidShare({ payPercent: 50 })).toBe(50);
    expect(unpaidShare({ payPercent: 140 })).toBe(100);
    const unpaid = record({ type: 'unpaid', start: '2026-03-01', end: '2026-03-07' });
    const got = leaveInPeriod([unpaid], '2026-03', noHolidays);
    expect([got.unpaidDays, got.reducedPay, got.byReason]).toEqual([7, [], undefined]);
  });

  it('a day on two kinds of leave takes the lower pay', () => {
    const half = record({
      type: 'unpaid',
      reasonId: 'half',
      payPercent: 50,
      start: '2026-03-01',
      end: '2026-03-07',
    });
    const unpaid = record({ type: 'unpaid', start: '2026-03-05', end: '2026-03-05' });
    // The year's first sick days, on full pay.
    const sick = record({ type: 'sick', start: '2026-03-03', end: '2026-03-04' });
    const got = leaveInPeriod([half, unpaid, sick], '2026-03', noHolidays);
    expect(got.unpaidDays).toBe(1);
    expect(got.reducedPay).toEqual([{ percent: 50, days: 6 }]);
    // Sick days at a quarter of pay are lower than half pay.
    const quarter = record({ type: 'sick', start: '2025-12-28', end: '2026-03-04' });
    const days = new Map(
      [...sickDaysByTier([quarter], 2026, noHolidays)].map((x) => [x.percent, x.days]),
    );
    expect(days.get(25)).toBeGreaterThan(0);
    const mixed = leaveInPeriod([half, quarter], '2026-03', noHolidays);
    expect(mixed.reducedPay.find((r) => r.percent === 50)?.days).toBe(3);
    expect(mixed.reducedPay.find((r) => r.percent === 25)?.days).toBe(4);
  });

  it('full-pay reasons, and leave taken from annual leave, cost nothing', () => {
    const records = [
      record({ type: 'bereavement', reasonId: 'marriage', start: '2026-03-01', end: '2026-03-05' }),
      record({ type: 'annual', reasonId: 'emergency', start: '2026-03-08', end: '2026-03-09' }),
    ];
    const got = leaveInPeriod(records, '2026-03', noHolidays);
    expect([got.unpaidDays, got.reducedPay]).toEqual([0, []]);
    expect(got.byReason).toEqual([
      { reasonId: 'marriage', type: 'bereavement', days: 5, percent: 100 },
      { reasonId: 'emergency', type: 'annual', days: 2, percent: 100 },
    ]);
    // Only the days employed show.
    const leaver = leaveInPeriod(records, '2026-03', noHolidays, { to: '2026-03-03' });
    expect(leaver.byReason).toEqual([
      { reasonId: 'marriage', type: 'bereavement', days: 3, percent: 100 },
    ]);
  });

  it('keeps sick leave tiers per calendar year, whatever else is recorded', () => {
    const sick = record({ type: 'sick', start: '2026-02-01', end: '2026-03-15' });
    const others = [
      record({ type: 'bereavement', reasonId: 'marriage', start: '2026-02-01', end: '2026-02-05' }),
      record({ type: 'unpaid', reasonId: 'half', payPercent: 50, start: '2026-03-01' }),
    ];
    expect(sickDaysByTier([sick, ...others], 2026, noHolidays)).toEqual(
      sickDaysByTier([sick], 2026, noHolidays),
    );
  });
});

describe('balances', () => {
  it('leave taken from annual leave lowers the annual balance', () => {
    const emergency = record({
      type: 'annual',
      reasonId: 'emergency',
      start: '2026-03-08',
      end: '2026-03-09',
      days: 2,
    });
    // 12 months from 1 January 2025 at 2.5 days, less the 2 days.
    expect(annualLeaveBalance([emergency], '2025-01-01', '2025-12-31').balance).toBe(30);
    expect(annualLeaveBalance([emergency], '2025-01-01', '2026-03-31').balance).toBe(35.5);
  });

  it('days added by hand make a reason’s own balance', () => {
    const records = [
      record({
        kind: 'adjustment',
        type: 'bereavement',
        reasonId: 'comp',
        start: '2026-02-01',
        days: 3,
      }),
      record({
        kind: 'adjustment',
        type: 'bereavement',
        reasonId: 'comp',
        start: '2026-04-01',
        days: 1,
      }),
      record({
        type: 'bereavement',
        reasonId: 'comp',
        start: '2026-03-02',
        end: '2026-03-03',
        days: 2,
      }),
      record({
        type: 'bereavement',
        reasonId: 'comp',
        start: '2026-03-10',
        days: 1,
        status: 'cancelled',
      }),
    ];
    expect(reasonBalance(records, 'comp', '2026-03-31')).toEqual({
      added: 3,
      taken: 2,
      balance: 1,
    });
    expect(reasonBalance(records, 'comp', '2026-04-30').balance).toBe(2);
    // None of it touches the annual leave balance.
    expect(annualLeaveBalance(records, '2025-01-01', '2026-04-30').balance).toBe(40);
  });

  it('counts a reason’s days in the calendar year the leave starts', () => {
    const records = [
      record({ type: 'bereavement', reasonId: 'marriage', start: '2025-12-30', days: 3 }),
      record({ type: 'bereavement', reasonId: 'marriage', start: '2026-02-01', days: 2 }),
      record({ type: 'bereavement', reasonId: 'marriage', start: '2026-03-01', days: 1 }),
    ];
    expect(reasonDaysInYear(records, 'marriage', 2026)).toBe(3);
    expect(reasonDaysInYear(records, 'marriage', 2026, records[2].id)).toBe(2);
    expect(reasonDaysInYear(records, 'marriage', 2025)).toBe(3);
  });
});

describe('warnings', () => {
  const leave = (overrides: Partial<LeaveRecord>) =>
    ({
      id: '',
      kind: 'leave',
      start: '2026-03-01',
      end: '2026-03-03',
      days: 3,
      ...overrides,
    }) as Pick<LeaveRecord, 'id' | 'type' | 'kind' | 'start' | 'end' | 'days'>;

  it('check a reason’s days a year instead of its type’s limit', () => {
    // A full-pay reason is bereavement leave underneath: its 3 days don't apply.
    const long = leave({ type: 'bereavement', days: 4 });
    expect(leaveWarnings(long, [], null, reason({ id: 'study' }))).toEqual([]);
    expect(leaveWarnings(long, [], null)).toEqual([{ code: 'over_limit', limit: 3 }]);
    const taken = [
      record({ type: 'bereavement', reasonId: 'marriage', start: '2026-01-10', days: 2 }),
    ];
    expect(leaveWarnings(long, taken, null, MARRIAGE)).toEqual([
      { code: 'over_year_max', limit: 5, taken: 2 },
    ]);
    expect(leaveWarnings(leave({ type: 'bereavement' }), taken, null, MARRIAGE)).toEqual([]);
  });

  it('check a reason’s own balance', () => {
    const added = [
      record({
        kind: 'adjustment',
        type: 'bereavement',
        reasonId: 'comp',
        start: '2026-02-01',
        days: 2,
      }),
    ];
    expect(leaveWarnings(leave({ type: 'bereavement' }), added, null, COMPENSATORY)).toEqual([
      { code: 'over_reason_balance', balance: 2 },
    ]);
    expect(
      leaveWarnings(leave({ type: 'bereavement', days: 2 }), added, null, COMPENSATORY),
    ).toEqual([]);
  });

  it('check leave taken from annual leave against the annual balance', () => {
    const balance = annualLeaveBalance([], '2026-01-01', '2026-03-01');
    expect(
      leaveWarnings(leave({ type: 'annual', days: 6 }), [], balance, EMERGENCY).map((w) => w.code),
    ).toEqual(['over_balance', 'not_eligible']);
    expect(HALF.base).toBe('unpaid');
  });
});

describe('pausing annual leave in months of long unpaid leave', () => {
  // Service months start on the 1st: hired 1 January 2025.
  const unpaid = (start: string, end: string, more: Partial<LeaveRecord> = {}) =>
    record({ type: 'unpaid', start, end, ...more });

  it('is off until switched on', () => {
    const records = [unpaid('2026-03-01', '2026-03-31')];
    expect(accrualOptions(undefined)).toEqual({});
    expect(accrualOptions({ leaveAccrualPause: null })).toEqual({});
    expect(annualLeaveBalance(records, '2025-01-01', '2026-03-31').balance).toBe(37.5);
    const on = accrualOptions({ leaveAccrualPause: { from: '2026-01-01' } });
    expect(on).toEqual({ pauseFrom: '2026-01-01' });
    const paused = annualLeaveBalance(
      records,
      '2025-01-01',
      '2026-03-31',
      null,
      null,
      null,
      null,
      on,
    );
    expect(paused).toMatchObject({ balance: 35, accrued: 35, pausedMonths: 1 });
  });

  it('pauses only months with more than 15 days of unpaid leave', () => {
    const on = { pauseFrom: '2026-01-01' };
    const balance = (records: LeaveRecord[]) =>
      annualLeaveBalance(records, '2025-01-01', '2026-04-30', null, null, null, null, on).balance;
    // 15 days in March, and 16 split over March and April: nothing paused.
    expect(balance([unpaid('2026-03-01', '2026-03-15')])).toBe(40);
    expect(balance([unpaid('2026-03-24', '2026-04-08')])).toBe(40);
    // 16 days in March: March earns nothing.
    expect(balance([unpaid('2026-03-01', '2026-03-16')])).toBe(37.5);
    // A day on two unpaid leaves counts once.
    expect(balance([unpaid('2026-03-01', '2026-03-10'), unpaid('2026-03-05', '2026-03-15')])).toBe(
      40,
    );
    // Leave paid in part, and cancelled leave, don't count.
    expect(balance([unpaid('2026-03-01', '2026-03-31', { payPercent: 50 })])).toBe(40);
    expect(balance([unpaid('2026-03-01', '2026-03-31', { status: 'cancelled' })])).toBe(40);
  });

  it('applies from its date only', () => {
    const records = [unpaid('2025-06-01', '2025-06-30'), unpaid('2026-03-01', '2026-03-31')];
    const balance = (pauseFrom: string) =>
      annualLeaveBalance(records, '2025-01-01', '2026-03-31', null, null, null, null, {
        pauseFrom,
      }).balance;
    expect(balance('2024-01-01')).toBe(32.5);
    expect(balance('2026-01-01')).toBe(35);
    expect(balance('2026-04-01')).toBe(37.5);
  });

  it('follows each month’s days a year, and the carry-forward cap', () => {
    const records = [unpaid('2026-03-01', '2026-03-31')];
    const policy = {
      annualDays: [{ from: '2026-03-16', days: 36 }],
      firstYearMonths: 9,
      carryForwardMax: 20,
      counting: 'working' as const,
    };
    const got = (pauseFrom?: string) =>
      annualLeaveBalance(records, '2025-01-01', '2026-04-30', null, policy, null, null, {
        pauseFrom,
      });
    const before = got();
    const after = got('2026-01-01');
    // March earned 30 days a year for its first 15 days and 36 for the other 16.
    expect(before.accrued - after.accrued).toBeCloseTo((30 * 15 + 36 * 16) / 31 / 12, 2);
    expect(after.forfeited).toBe(before.forfeited);
  });
});
