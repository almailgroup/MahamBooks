/**
 * The company's own leave reasons (#15) through the payroll: recording leave
 * with them, its pay and balances, the payslip detail, the rules that lock
 * once leave is recorded, and the pause of annual leave in months of long
 * unpaid leave. Made-up people and amounts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { createEmployee, saveEmployee } from './people';
import {
  approvePayRun,
  cancelLeaveRecord,
  createLeaveRecord,
  createPayRun,
  getPayrollSettings,
  refreshPayRun,
  saveLeaveReasonSettings,
  saveLeaveRecord,
  savePayrollSettings,
} from './payroll';
import { exportBackup, importBackup, parseBackup } from './backup';
import type { Company, Employee, LeaveReason } from './types';
import { employeeLeaveBalance, reasonBalance } from '@/lib/hr/leave';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

const REASONS: LeaveReason[] = [
  {
    id: 'emergency',
    name: 'Emergency leave',
    nameAr: 'إجازة طارئة',
    base: 'annual',
    pay: 'annual',
  },
  {
    id: 'comp',
    name: 'Compensatory days',
    nameAr: 'أيام بدل',
    base: 'bereavement',
    pay: 'balance',
  },
  {
    id: 'study',
    name: 'Study leave',
    nameAr: 'إجازة دراسية',
    base: 'unpaid',
    pay: 'half',
    noteRequired: true,
  },
  {
    id: 'marriage',
    name: 'Marriage leave',
    nameAr: 'إجازة زواج',
    base: 'bereavement',
    pay: 'full',
    maxDaysPerYear: 5,
  },
  {
    id: 'visit',
    name: 'Home visit',
    nameAr: 'زيارة الأهل',
    base: 'bereavement',
    pay: 'full',
    categories: ['domestic'],
  },
];

async function seed(): Promise<{ c: Company; e: Employee }> {
  const c = await setupCompany({ name: 'Test Trading Co' });
  const e = await saveEmployee(
    createEmployee(c.id, {
      name: 'Test Clerk',
      category: 'expat',
      nationality: 'IN',
      hireDate: '2025-01-01',
      basicSalary: 620,
      iban: IBAN,
    }),
  );
  return { c, e };
}

const on = (c: Company) =>
  saveLeaveReasonSettings(c.id, { leaveReasons: REASONS, leaveReasonsOn: true });

describe('recording leave with a reason', () => {
  it('needs the reasons switched on', async () => {
    const { c, e } = await seed();
    await saveLeaveReasonSettings(c.id, { leaveReasons: REASONS });
    const leave = createLeaveRecord(c.id, e.id, {
      reasonId: 'emergency',
      start: '2026-03-02',
      end: '2026-03-03',
    });
    await expect(saveLeaveRecord(leave)).rejects.toThrow(/switched off/);
    await saveLeaveReasonSettings(c.id, { leaveReasonsOn: true });
    // The rest of the settings stays as saved.
    expect((await getPayrollSettings(c.id)).leaveReasons).toHaveLength(REASONS.length);
    await expect(saveLeaveRecord(leave)).resolves.toMatchObject({ type: 'annual', days: 2 });
    await expect(
      saveLeaveRecord(createLeaveRecord(c.id, e.id, { reasonId: 'gone', start: '2026-03-04' })),
    ).rejects.toThrow(/could not be found/);
  });

  it('keeps the reason’s base type, so older versions read it', async () => {
    const { c, e } = await seed();
    await on(c);
    const save = (reasonId: string, notes = '') =>
      saveLeaveRecord(
        createLeaveRecord(c.id, e.id, {
          type: 'sick',
          reasonId,
          start: '2026-03-01',
          end: '2026-03-07',
          notes,
          payPercent: 10,
        }),
      );
    // Sunday 1 to Saturday 7 March 2026: 5 working days, 7 calendar days.
    expect(await save('marriage')).toMatchObject({ type: 'bereavement', days: 5 });
    expect((await save('marriage')).payPercent).toBeUndefined();
    expect(await save('emergency')).toMatchObject({ type: 'annual', days: 5 });
    expect(await save('study', 'Final exams')).toMatchObject({
      type: 'unpaid',
      payPercent: 50,
      days: 7,
    });
    // Without a reason, a share of pay is never kept.
    const plain = await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { type: 'unpaid', start: '2026-04-05', payPercent: 50 }),
    );
    expect(plain.payPercent).toBeUndefined();
    expect(plain.reasonId).toBeUndefined();
  });

  it('asks for a note, and offers a reason only to its categories', async () => {
    const { c, e } = await seed();
    await on(c);
    await expect(
      saveLeaveRecord(createLeaveRecord(c.id, e.id, { reasonId: 'study', start: '2026-03-02' })),
    ).rejects.toThrow(/needs one/);
    await expect(
      saveLeaveRecord(createLeaveRecord(c.id, e.id, { reasonId: 'visit', start: '2026-03-02' })),
    ).rejects.toThrow(/isn’t for employees of this category/);
    const maid = await saveEmployee(
      createEmployee(c.id, {
        name: 'Test Housekeeper',
        category: 'domestic',
        hireDate: '2025-01-01',
      }),
    );
    await expect(
      saveLeaveRecord(createLeaveRecord(c.id, maid.id, { reasonId: 'visit', start: '2026-03-02' })),
    ).resolves.toMatchObject({ type: 'bereavement', reasonId: 'visit' });
  });

  it('keeps an archived reason’s leave, but records no new leave with it', async () => {
    const { c, e } = await seed();
    await on(c);
    const taken = await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { reasonId: 'marriage', start: '2026-03-02' }),
    );
    await saveLeaveReasonSettings(c.id, {
      leaveReasons: REASONS.map((r) => (r.id === 'marriage' ? { ...r, archived: true } : r)),
    });
    await expect(
      saveLeaveRecord(createLeaveRecord(c.id, e.id, { reasonId: 'marriage', start: '2026-03-09' })),
    ).rejects.toThrow(/archived/);
    await cancelLeaveRecord(taken.id);
    expect((await db.leaveRecords.get(taken.id))?.status).toBe('cancelled');
  });

  it('adds days by hand only to a reason paid from them', async () => {
    const { c, e } = await seed();
    await on(c);
    const added = await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, {
        kind: 'adjustment',
        reasonId: 'comp',
        start: '2026-02-07',
        days: 2,
      }),
    );
    expect(added).toMatchObject({ type: 'bereavement', kind: 'adjustment', days: 2 });
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { reasonId: 'comp', start: '2026-03-02', end: '2026-03-02' }),
    );
    const records = await db.leaveRecords.toArray();
    expect(reasonBalance(records, 'comp', '2026-03-31')).toEqual({
      added: 2,
      taken: 1,
      balance: 1,
    });
    // Not the annual balance: 15 months at 2.5 days.
    expect(employeeLeaveBalance(e, records, '2026-03-31').balance).toBe(37.5);
    await expect(
      saveLeaveRecord(
        createLeaveRecord(c.id, e.id, {
          kind: 'adjustment',
          reasonId: 'marriage',
          start: '2026-02-07',
          days: 2,
        }),
      ),
    ).rejects.toThrow(/Only a reason paid from days added by hand/);
    await expect(
      saveLeaveRecord(
        createLeaveRecord(c.id, e.id, { kind: 'opening', reasonId: 'comp', start: '2026-02-07' }),
      ),
    ).rejects.toThrow(/Only a reason paid from days added by hand/);
  });
});

describe('pay and balances', () => {
  it('pays half-pay leave at half, and shows each reason on the line', async () => {
    const { c, e } = await seed();
    await on(c);
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, {
        reasonId: 'study',
        start: '2026-03-01',
        end: '2026-03-10',
        notes: 'Exams',
      }),
    );
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, {
        reasonId: 'emergency',
        start: '2026-03-15',
        end: '2026-03-16',
      }),
    );
    const run = await createPayRun(c.id, '2026-03');
    const [line] = run.lines;
    // 10 calendar days at half pay: 620 × 5 ÷ 31.
    expect(line.calendarLeave).toEqual({ unpaidDays: 0, reducedPay: [{ percent: 50, days: 10 }] });
    expect(line.absenceDeduction).toBe(100);
    expect(line.gross).toBe(520);
    // The copy older versions read: 8 working days at half the daily rate.
    expect([line.unpaidLeaveDays, line.reducedPay]).toEqual([0, [{ percent: 50, days: 8 }]]);
    expect(line.leaveDetail).toEqual([
      {
        reasonId: 'study',
        name: 'Study leave',
        nameAr: 'إجازة دراسية',
        days: 10,
        percent: 50,
      },
      {
        reasonId: 'emergency',
        name: 'Emergency leave',
        nameAr: 'إجازة طارئة',
        days: 2,
        percent: 100,
        fromAnnual: true,
      },
    ]);
    // Emergency leave comes off the annual balance: 15 months at 2.5, less 2.
    const records = await db.leaveRecords.toArray();
    expect(employeeLeaveBalance(e, records, '2026-03-31').balance).toBe(35.5);
    const approved = await approvePayRun(run.id);
    expect(approved.provisions?.[0].leaveDays).toBe(35.5);
  });

  it('refuses leave on half pay in a month already approved', async () => {
    const { c, e } = await seed();
    await on(c);
    await approvePayRun((await createPayRun(c.id, '2026-03')).id);
    await expect(
      saveLeaveRecord(
        createLeaveRecord(c.id, e.id, { reasonId: 'study', start: '2026-03-02', notes: 'Exam' }),
      ),
    ).rejects.toThrow(/already approved/);
    // Full pay changes nothing in it.
    await expect(
      saveLeaveRecord(createLeaveRecord(c.id, e.id, { reasonId: 'marriage', start: '2026-03-02' })),
    ).resolves.toMatchObject({ reasonId: 'marriage' });
  });

  it('refuses a line an older version worked out without the leave by reason', async () => {
    const { c, e } = await seed();
    await on(c);
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, {
        reasonId: 'study',
        start: '2026-03-01',
        end: '2026-03-10',
        notes: 'Exams',
      }),
    );
    const run = await createPayRun(c.id, '2026-03');
    // An older version reads the leave as unpaid and writes no detail.
    const older = run.lines.map(({ leaveDetail: _detail, ...line }) => ({
      ...line,
      calendarLeave: { unpaidDays: 10, reducedPay: [] },
    }));
    await db.payRuns.put({ ...run, lines: older });
    await expect(approvePayRun(run.id)).rejects.toThrow(/Update from records/);
    await refreshPayRun(run.id);
    const approved = await approvePayRun(run.id);
    expect(approved.lines[0].absenceDeduction).toBe(100);
  });
});

describe('the reasons’ rules', () => {
  it('lock how a reason is paid once leave is recorded with it', async () => {
    const { c, e } = await seed();
    await on(c);
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { reasonId: 'marriage', start: '2026-03-02' }),
    );
    const change = (patch: Partial<LeaveReason>) =>
      saveLeaveReasonSettings(c.id, {
        leaveReasons: REASONS.map((r) => (r.id === 'marriage' ? { ...r, ...patch } : r)),
      });
    await expect(change({ pay: 'unpaid' })).rejects.toThrow(/can’t change/);
    await expect(
      saveLeaveReasonSettings(c.id, { leaveReasons: REASONS.filter((r) => r.id !== 'marriage') }),
    ).rejects.toThrow(/Archive it instead/);
    // Names, limits and categories may change, and it may be archived.
    await change({ name: 'Wedding leave', maxDaysPerYear: 7, archived: true });
    const saved = (await getPayrollSettings(c.id)).leaveReasons?.find((r) => r.id === 'marriage');
    expect(saved).toMatchObject({ name: 'Wedding leave', maxDaysPerYear: 7, archived: true });
    // A reason nobody used can be paid another way, or removed.
    await saveLeaveReasonSettings(c.id, {
      leaveReasons: (await getPayrollSettings(c.id)).leaveReasons!.flatMap((r) =>
        r.id === 'visit' ? [] : r.id === 'comp' ? [{ ...r, pay: 'unpaid' as const }] : [r],
      ),
    });
    const reasons = (await getPayrollSettings(c.id)).leaveReasons!;
    expect(reasons.map((r) => r.id)).toEqual(['emergency', 'comp', 'study', 'marriage']);
    expect(reasons.find((r) => r.id === 'comp')).toMatchObject({ pay: 'unpaid', base: 'unpaid' });
  });

  it('are saved tidy: a name each, the base from the pay, only real limits', async () => {
    const { c } = await seed();
    await expect(
      saveLeaveReasonSettings(c.id, {
        leaveReasons: [{ ...REASONS[0], name: '  ' }],
      }),
    ).rejects.toThrow(/Enter the name/);
    await saveLeaveReasonSettings(c.id, {
      leaveReasons: [
        {
          id: 'x',
          name: ' Exam leave ',
          nameAr: ' إجازة امتحان ',
          base: 'sick',
          pay: 'full',
          maxDaysPerYear: 0,
          categories: ['domestic', 'domestic', 'nobody' as never],
          archived: false,
          noteRequired: false,
        },
      ],
      leaveAccrualPause: { from: 'soon' },
    });
    const saved = await getPayrollSettings(c.id);
    expect(saved.leaveReasons).toEqual([
      {
        id: 'x',
        name: 'Exam leave',
        nameAr: 'إجازة امتحان',
        base: 'bereavement',
        pay: 'full',
        categories: ['domestic'],
      },
    ]);
    expect(saved.leaveAccrualPause).toBeNull();
    // A reason a newer version set up is kept as it is, and can't be changed here.
    const newer = { ...REASONS[0], id: 'n', pay: 'tiers' as never, base: 'unpaid' as const };
    await savePayrollSettings({ ...saved, leaveReasons: [newer] }).catch(() => undefined);
    expect((await getPayrollSettings(c.id)).leaveReasons).toHaveLength(1);
    await db.payrollSettings.put({ ...saved, leaveReasons: [newer] });
    await saveLeaveReasonSettings(c.id, { leaveReasonsOn: true });
    expect((await getPayrollSettings(c.id)).leaveReasons).toEqual([newer]);
  });

  it('go with the backup', async () => {
    const { c, e } = await seed();
    await on(c);
    await saveLeaveReasonSettings(c.id, { leaveAccrualPause: { from: '2026-01-01' } });
    const leave = await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { reasonId: 'study', start: '2026-03-02', notes: 'Exam' }),
    );
    const text = JSON.stringify(await exportBackup(c.id));
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');
    const settings = await getPayrollSettings(c.id);
    expect(settings).toMatchObject({
      leaveReasonsOn: true,
      leaveAccrualPause: { from: '2026-01-01' },
    });
    expect(settings.leaveReasons).toHaveLength(REASONS.length);
    expect(await db.leaveRecords.get(leave.id)).toMatchObject({
      reasonId: 'study',
      payPercent: 50,
    });
  });
});

describe('pausing annual leave in months of long unpaid leave', () => {
  it('changes balances, provisions and settlements only once switched on', async () => {
    const { c, e } = await seed();
    // 20 days of unpaid leave in March 2026 (service months start on the 1st).
    await saveLeaveRecord(
      createLeaveRecord(c.id, e.id, { type: 'unpaid', start: '2026-03-05', end: '2026-03-24' }),
    );
    const march = await approvePayRun((await createPayRun(c.id, '2026-03')).id);
    expect(march.provisions?.[0].leaveDays).toBe(37.5);
    await saveLeaveReasonSettings(c.id, { leaveAccrualPause: { from: '2026-01-01' } });
    const april = await approvePayRun((await createPayRun(c.id, '2026-04')).id);
    // 16 months, March earning nothing.
    expect(april.provisions?.[0].leaveDays).toBe(37.5);
    await saveLeaveReasonSettings(c.id, { leaveAccrualPause: null });
    const may = await approvePayRun((await createPayRun(c.id, '2026-05')).id);
    expect(may.provisions?.[0].leaveDays).toBe(42.5);
  });
});
