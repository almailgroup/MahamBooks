import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { createEmployee, saveEmployee } from './people';
import { createLeaveRecord } from './payroll';
import {
  planLeaveSheet,
  setLeaveOpeningForEveryone,
  setLeaveOpeningsFromSheet,
  type LeaveSheetPlan,
} from './leave-openings';
import type { Employee, ID } from './types';
import { employeeLeaveBalance } from '@/lib/hr/leave';
import { today } from '@/lib/dates';
import { readXlsx } from '@/lib/xlsx';
import { buildWorkbook } from '@/test/workbook';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const company = () => setupCompany({ name: 'Almail Security' });

/** The rows of a plan, as line → what was read or why not. */
const read = (plan: LeaveSheetPlan) =>
  plan.rows.map((r) =>
    r.status === 'ready'
      ? [r.line, r.employee?.number, r.days, r.date, r.replaces]
      : [r.line, r.status, r.problem.replace(/[⁦-⁩]/g, '')],
  );

const ready = (plan: LeaveSheetPlan, date: string) =>
  plan.rows
    .filter((r) => r.status === 'ready')
    .map((r) => ({ employeeId: r.employee!.id, date: r.date ?? date, days: r.days! }));

describe('a spreadsheet of leave balances', () => {
  const staff = [
    createEmployee('c', { id: 'a', number: '000101', name: 'Test Guard One' }),
    createEmployee('c', {
      id: 'b',
      number: '000102',
      name: 'Test Guard Two',
      leaveOpening: { date: '2026-09-01', days: 4, confirmed: true },
    }),
    createEmployee('c', { id: 'c3', number: '000103', name: 'Test Guard Three' }),
    createEmployee('c', { id: 'c4', number: '000104', name: 'Test Guard Four' }),
    createEmployee('c', { id: 'c5', number: '000105', name: 'Test Guard Five' }),
    createEmployee('c', { id: 'c7', number: 'EMP-7', name: 'Test Guard Seven' }),
  ];

  it('matches employees by number and reads the days and dates, saying why a row is not used', () => {
    const plan = planLeaveSheet(
      [
        ['Emp No', 'Hire date', 'Leave Balance', 'As of'],
        ['101', '01/01/2015', '12.5', ''],
        ['000102', '01/01/2016', '3', '30/09/2026'],
        ['emp-7', '', '٧', '2026-09-30'],
        ['999', '', '5', ''],
        ['', '', '5', ''],
        ['101', '', '4', ''],
        ['103', '', 'ten', ''],
        ['104', '', '-2', ''],
        ['105', '', '6', '31/02/2026'],
        ['', '', '', ''],
      ],
      staff,
      [],
    );
    expect(plan.columns).toEqual({ number: 0, days: 2, asOf: 3 });
    expect(plan).toMatchObject({ missing: [], matched: 3, unmatched: 2, invalid: 4 });
    expect(read(plan)).toEqual([
      // Without the zeros; no date of its own.
      [2, '000101', 12.5, null, false],
      // Already had a balance: the spreadsheet replaces it.
      [3, '000102', 3, '2026-09-30', true],
      // Any case, Arabic digits, a date from a spreadsheet cell.
      [4, 'EMP-7', 7, '2026-09-30', false],
      [5, 'unmatched', 'No employee has this number.'],
      [6, 'unmatched', 'No employee number.'],
      [7, 'invalid', 'The same employee is on row 2.'],
      [8, 'invalid', '“ten” is not a number of days.'],
      [9, 'invalid', 'The days can’t be below 0.'],
      [10, 'invalid', '“31/02/2026” is not a date.'],
    ]);
  });

  it('knows the columns by other names, in English and Arabic', () => {
    const columns = (headers: string[]) => planLeaveSheet([headers], staff, []).columns;
    expect(columns(['الرقم الوظيفي', 'الرصيد', 'التاريخ'])).toEqual({
      number: 0,
      days: 1,
      asOf: 2,
    });
    expect(columns(['Employee ID', 'رصيد الإجازات'])).toMatchObject({ number: 0, days: 1 });
    expect(columns(['Staff No', 'Annual leave balance (days)'])).toMatchObject({ days: 1 });
    expect(columns(['Employee number', 'Balance', 'Date'])).toEqual({
      number: 0,
      days: 1,
      asOf: 2,
    });
    // A hire date is not the date of the balance.
    expect(columns(['Emp No', 'Hire date', 'Days'])).toEqual({ number: 0, days: 2, asOf: null });
    expect(planLeaveSheet([['Name', 'Leave balance']], staff, []).missing).toEqual([
      'Employee number',
    ]);
  });

  it('reads an Excel workbook', async () => {
    const rows = await readXlsx(
      buildWorkbook([
        ['Employee No', 'Annual leave balance', 'As of'],
        ['000101', 12.5, { date: '2026-09-30' }],
        [103, 0, null],
      ]),
    );
    expect(read(planLeaveSheet(rows, staff, []))).toEqual([
      [2, '000101', 12.5, '2026-09-30', false],
      [3, '000103', 0, null, false],
    ]);
  });
});

describe('setting opening leave balances', () => {
  async function employee(companyId: ID, overrides: Partial<Employee>): Promise<Employee> {
    return saveEmployee(createEmployee(companyId, { hireDate: '2015-03-01', ...overrides }));
  }

  const actions = async (companyId: ID) =>
    (await db.activities.where('companyId').equals(companyId).toArray()).filter(
      (a) => a.action === 'leave_opening',
    );

  it('gives everyone without a balance the same one, with one activity entry', async () => {
    const c = await company();
    const guard = await employee(c.id, { number: '1', name: 'Test Guard One' });
    const second = await employee(c.id, { number: '2', name: 'Test Guard Two' });
    const imported = await employee(c.id, {
      number: '3',
      name: 'Test Guard Three',
      leaveOpening: { date: '2026-09-15', days: 0, confirmed: false },
    });
    const recorded = await employee(c.id, { number: '4', name: 'Test Guard Four' });
    await db.leaveRecords.add(
      createLeaveRecord(c.id, recorded.id, {
        type: 'annual',
        kind: 'opening',
        start: '2026-01-01',
        end: '2026-01-01',
        days: 8,
      }),
    );
    const confirmed = await employee(c.id, {
      number: '5',
      name: 'Test Guard Five',
      leaveOpening: { date: '2026-06-01', days: 5, confirmed: true },
    });
    // Added the day they joined: all their leave is here.
    const joiner = await employee(c.id, { number: '6', name: 'Test Guard Six', hireDate: today() });
    const left = await employee(c.id, {
      number: '7',
      name: 'Test Guard Seven',
      status: 'left',
      leavingDate: '2026-08-31',
      leavingReason: 'resignation',
    });

    expect(await setLeaveOpeningForEveryone(c.id, { date: '2026-10-01', days: 0 })).toBe(3);
    const after = new Map(
      (await db.employees.where('companyId').equals(c.id).toArray()).map((e) => [e.id, e]),
    );
    const opening = (e: Employee) => after.get(e.id)!.leaveOpening ?? null;
    const set = { date: '2026-10-01', days: 0, confirmed: true };
    expect(opening(guard)).toEqual(set);
    expect(opening(second)).toEqual(set);
    expect(opening(imported)).toEqual(set);
    // Those with a balance keep theirs; those who need none get none.
    expect(opening(recorded)).toBeNull();
    expect(opening(confirmed)).toEqual({ date: '2026-06-01', days: 5, confirmed: true });
    expect(opening(joiner)).toBeNull();
    expect(opening(left)).toBeNull();

    // Leave counts from the opening, not from 2015.
    const records = await db.leaveRecords.where('companyId').equals(c.id).toArray();
    expect(employeeLeaveBalance(after.get(guard.id)!, records, '2026-12-31')).toMatchObject({
      from: '2026-10-01',
      opening: 0,
      accrued: 7.5,
      balance: 7.5,
    });

    const logged = await actions(c.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      entity: 'employee',
      message: 'Leave brought forward set for 3 employees: 0 days on 2026-10-01',
    });

    // Done: nobody is left without one.
    await expect(setLeaveOpeningForEveryone(c.id, { date: '2026-10-01', days: 0 })).rejects.toThrow(
      'Every current employee has an opening leave balance already.',
    );
    await expect(
      setLeaveOpeningForEveryone(c.id, { date: '2026-10-01', days: -1 }),
    ).rejects.toThrow('Enter the number of days.');
  });

  it('sets each one’s own balance from a spreadsheet, replacing the one they had', async () => {
    const c = await company();
    const guard = await employee(c.id, { number: '000101', name: 'Test Guard One' });
    const had = await employee(c.id, {
      number: '000102',
      name: 'Test Guard Two',
      leaveOpening: { date: '2026-06-01', days: 5, confirmed: true },
    });
    const earlier = createLeaveRecord(c.id, had.id, {
      type: 'annual',
      kind: 'opening',
      start: '2026-01-01',
      end: '2026-01-01',
      days: 2,
    });
    const later = createLeaveRecord(c.id, had.id, {
      type: 'annual',
      kind: 'opening',
      start: '2026-10-10',
      end: '2026-10-10',
      days: 20,
    });
    await db.leaveRecords.bulkAdd([earlier, later]);
    const untouched = await employee(c.id, { number: '000103', name: 'Test Guard Three' });

    const plan = planLeaveSheet(
      [
        ['Employee No', 'Leave balance', 'As of'],
        ['101', '12.5', ''],
        ['102', '3', '30/09/2026'],
        ['999', '1', ''],
      ],
      await db.employees.where('companyId').equals(c.id).toArray(),
      await db.leaveRecords.where('companyId').equals(c.id).toArray(),
    );
    expect(plan).toMatchObject({ matched: 2, unmatched: 1, invalid: 0 });
    expect(await setLeaveOpeningsFromSheet(c.id, ready(plan, '2026-10-01'))).toBe(2);

    expect((await db.employees.get(guard.id))!.leaveOpening).toEqual({
      date: '2026-10-01',
      days: 12.5,
      confirmed: true,
    });
    const updated = (await db.employees.get(had.id))!;
    expect(updated.leaveOpening).toEqual({ date: '2026-09-30', days: 3, confirmed: true });
    // The opening record after the sheet's date would count instead: it is cancelled.
    expect((await db.leaveRecords.get(later.id))!.status).toBe('cancelled');
    expect((await db.leaveRecords.get(earlier.id))!.status).toBe('approved');
    const records = await db.leaveRecords.where('companyId').equals(c.id).toArray();
    expect(employeeLeaveBalance(updated, records, '2026-10-31')).toMatchObject({
      from: '2026-09-30',
      opening: 3,
      balance: 5.5,
    });
    expect((await db.employees.get(untouched.id))!.leaveOpening ?? null).toBeNull();

    const logged = await actions(c.id);
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toBe('Leave brought forward set for 2 employees from a spreadsheet');

    await expect(setLeaveOpeningsFromSheet(c.id, [])).rejects.toThrow('There is nothing to set.');
  });
});
