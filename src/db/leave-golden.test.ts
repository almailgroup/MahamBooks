/**
 * Today's pay runs, provisions and settlement for leave of the six types,
 * pinned before custom leave reasons (#15) touched the leave code. Made-up
 * people and amounts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { createEmployee, newAllowance, saveEmployee } from './people';
import {
  approvePayRun,
  createLeaveRecord,
  createPayRun,
  getPayrollSettings,
  saveLeaveReasonSettings,
  saveLeaveRecord,
  settlementSetup,
} from './payroll';
import type { Company, Employee, LeaveType } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

const LEAVE: [LeaveType, string, string][] = [
  ['annual', '2026-01-04', '2026-01-15'],
  ['sick', '2026-02-01', '2026-03-15'],
  ['unpaid', '2026-04-12', '2026-05-03'],
  ['sick', '2026-04-26', '2026-04-30'],
  ['maternity', '2026-06-01', '2026-07-15'],
  ['bereavement', '2026-08-02', '2026-08-04'],
  ['unpaid', '2026-09-01', '2026-09-20'],
  ['annual', '2026-11-01', '2026-11-20'],
];

/** Per month and employee: absence deduction, gross and net pay. */
const PAY: Record<string, [number, number, number][]> = {
  '2026-01': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
  '2026-02': [
    [65.625, 984.375, 874.125],
    [0, 320, 320],
  ],
  '2026-03': [
    [177.822, 872.178, 761.928],
    [51.613, 268.387, 268.387],
  ],
  '2026-04': [
    [665, 385, 274.75],
    [96, 224, 224],
  ],
  '2026-05': [
    [101.613, 948.387, 838.137],
    [69.677, 250.323, 250.323],
  ],
  '2026-06': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
  '2026-07': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
  '2026-08': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
  '2026-09': [
    [700, 350, 239.75],
    [0, 320, 320],
  ],
  '2026-10': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
  '2026-11': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
  '2026-12': [
    [0, 1050, 939.75],
    [0, 320, 320],
  ],
};

/** Per month and employee: leave days and leave salary provision, end-of-service provision. */
const PROVISIONS: Record<string, [number, number, number][]> = {
  '2026-01': [
    [45, 1817.308, 0],
    [30, 369.231, 184.615],
  ],
  '2026-02': [
    [47.5, 1918.269, 0],
    [32.5, 400, 198.775],
  ],
  '2026-03': [
    [50, 2019.231, 0],
    [35, 430.769, 214.449],
  ],
  '2026-04': [
    [52.5, 2120.192, 0],
    [37.5, 461.538, 229.625],
  ],
  '2026-05': [
    [55, 2221.154, 0],
    [40, 492.308, 245.317],
  ],
  '2026-06': [
    [57.5, 2322.115, 0],
    [42.5, 523.077, 260.492],
  ],
  '2026-07': [
    [60, 2423.077, 0],
    [45, 553.846, 276.166],
  ],
  '2026-08': [
    [62.5, 2524.038, 0],
    [47.5, 584.615, 291.84],
  ],
  '2026-09': [
    [65, 2625, 0],
    [50, 615.385, 307.015],
  ],
  '2026-10': [
    [67.5, 2725.962, 0],
    [52.5, 646.154, 322.689],
  ],
  '2026-11': [
    [55, 2221.154, 0],
    [55, 676.923, 337.865],
  ],
  '2026-12': [
    [57.5, 2322.115, 0],
    [57.5, 707.692, 353.557],
  ],
};

async function seed(): Promise<{ c: Company; clerk: Employee }> {
  const c = await setupCompany({ name: 'Test Trading Co' });
  const clerk = await saveEmployee(
    createEmployee(c.id, {
      name: 'Test Clerk',
      category: 'kuwaiti',
      nationality: 'KW',
      hireDate: '2024-03-10',
      basicSalary: 900,
      allowances: [newAllowance({ name: 'Social allowance', amount: 150 })],
      iban: IBAN,
    }),
  );
  const driver = await saveEmployee(
    createEmployee(c.id, {
      name: 'Test Driver',
      category: 'expat',
      nationality: 'IN',
      hireDate: '2025-02-01',
      basicSalary: 320,
      iban: IBAN,
    }),
  );
  for (const [type, start, end] of LEAVE) {
    await saveLeaveRecord(createLeaveRecord(c.id, clerk.id, { type, start, end }));
  }
  await saveLeaveRecord(
    createLeaveRecord(c.id, driver.id, { type: 'unpaid', start: '2026-03-08', end: '2026-03-12' }),
  );
  await saveLeaveRecord(
    createLeaveRecord(c.id, driver.id, { type: 'sick', start: '2026-03-15', end: '2026-05-10' }),
  );
  return { c, clerk };
}

/** Pays a year and checks every line and provision against today's numbers. */
async function payTheYear(c: Company) {
  for (const period of Object.keys(PAY)) {
    const run = await approvePayRun((await createPayRun(c.id, period)).id);
    expect(
      run.lines.map((l) => [l.absenceDeduction, l.gross, l.net]),
      period,
    ).toEqual(PAY[period]);
    // In the order of the lines (the clerk first).
    const order = run.lines.map((l) => l.employeeId);
    const provisions = [...(run.provisions ?? [])].sort(
      (a, b) => order.indexOf(a.employeeId) - order.indexOf(b.employeeId),
    );
    expect(
      provisions.map((p) => [p.leaveDays, p.leave, p.eos]),
      period,
    ).toEqual(PROVISIONS[period]);
  }
}

async function settlementLeave(c: Company, clerk: Employee) {
  const data = {
    settings: await getPayrollSettings(c.id),
    people: { eosDailyDivisor: 26 },
    leave: await db.leaveRecords.toArray(),
    loans: [],
    runs: [],
    settlements: [],
  };
  return settlementSetup(clerk, '2026-12-31', data, 3).leave;
}

describe('pay runs with leave of the six types, as before', () => {
  it('pay, provision and settle exactly as before', async () => {
    const { c, clerk } = await seed();
    await payTheYear(c);
    expect(await settlementLeave(c, clerk)).toMatchObject({
      accrued: 82.5,
      taken: 25,
      balance: 57.5,
    });
  });

  it('pay, provision and settle the same with the company’s reasons on but unused', async () => {
    const { c, clerk } = await seed();
    await saveLeaveReasonSettings(c.id, {
      leaveReasonsOn: true,
      leaveReasons: [
        {
          id: 'emergency',
          name: 'Emergency leave',
          nameAr: 'إجازة طارئة',
          base: 'annual',
          pay: 'annual',
        },
        { id: 'study', name: 'Study leave', nameAr: 'إجازة دراسية', base: 'unpaid', pay: 'half' },
      ],
      // The pause from a date after all the leave.
      leaveAccrualPause: { from: '2027-01-01' },
    });
    await payTheYear(c);
    const runs = await db.payRuns.toArray();
    expect(runs.flatMap((r) => r.lines).some((l) => 'leaveDetail' in l)).toBe(false);
    expect(await settlementLeave(c, clerk)).toMatchObject({ balance: 57.5 });
  });

  it('the pause takes in only months of service with more than 15 unpaid days', async () => {
    const { c, clerk } = await seed();
    await saveLeaveReasonSettings(c.id, { leaveAccrualPause: { from: '2026-01-01' } });
    // Service months start on the 10th (hired 10 March 2024). 10 April to 9 May
    // has 22 days of unpaid leave and earns nothing; September's 20 days are
    // split 9 and 11 between two months of service, which both earn.
    const leave = await settlementLeave(c, clerk);
    expect(leave).toMatchObject({ accrued: 80, balance: 55, pausedMonths: 1 });
  });
});
