/**
 * Review findings (people / payroll, database level): the scenarios the
 * payroll and HR review found, with what happens now. Names are made up.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import {
  createEmployee,
  deleteEmployee,
  newAllowance,
  saveEmployee,
  setEmployeePhoto,
  setLeaveOpening,
} from './people';
import { importEmployees, type ImportOptions } from './import';
import { guessColumns } from '@/features/company/import-columns';
import { validateEmployee } from '@/features/people/employee-form';
import { removeAttachment } from './purchases';
import { renewDocument } from './renewals';
import {
  approvePayRun,
  createLeaveRecord,
  createPayRun,
  getPayrollSettings,
  payPayRun,
  postSettlement,
  saveLeaveRecord,
  settlementDefaults,
  settlementInput,
  settlementSetup,
  type SettlementData,
} from './payroll';
import { computeSettlement } from '@/lib/hr/payroll';
import { employeeLeaveBalance } from '@/lib/hr/leave';
import type { Company, Employee, LeavingReason } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

const OPTIONS: ImportOptions = {
  contactType: 'customer',
  documentType: 'invoice',
  asOf: '2026-09-30',
  dateFormat: 'dd/MM/yyyy',
  fileName: 'guards.xlsx',
  today: '2026-10-05',
  updateExisting: true,
};

const PIXEL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const company = () => setupCompany({ name: 'Test Security Co' });

const guard = (c: Company, overrides: Partial<Employee> = {}) =>
  saveEmployee(
    createEmployee(c.id, {
      name: 'Test Guard',
      category: 'expat',
      nationality: 'NP',
      hireDate: '2022-01-01',
      basicSalary: 260,
      iban: IBAN,
      ...overrides,
    }),
  );

async function settlementData(c: Company): Promise<SettlementData> {
  const [leave, runs] = await Promise.all([db.leaveRecords.toArray(), db.payRuns.toArray()]);
  return {
    settings: await getPayrollSettings(c.id),
    people: { eosDailyDivisor: 26 },
    leave,
    loans: [],
    runs,
    settlements: [],
  };
}

describe('importing with “Update existing employees”', () => {
  it('adds the Arabic names without replacing the English ones', async () => {
    const c = await company();
    const one = await guard(c, { number: '101', name: 'Test Guard One' });
    // A second sheet with the employee numbers and the Arabic names.
    const rows = [
      ['Employee Number', 'Arabic Name'],
      ['101', 'موظف تجريبي واحد'],
      ['102', 'موظف تجريبي اثنان'],
    ];
    const mapping = guessColumns('employees', rows[0], rows);
    expect(mapping).toMatchObject({ number: 0, nameAr: 1 });
    const result = await importEmployees(c.id, rows, mapping, OPTIONS);
    expect(result).toMatchObject({ updated: 1, added: 1 });

    const after = (await db.employees.get(one.id))!;
    expect(after.nameAr).toBe('موظف تجريبي واحد');
    // The English name (used in the bank salary file) stays.
    expect(after.name).toBe('Test Guard One');
    // A new employee with only an Arabic name is named with it.
    const added = (await db.employees.toArray()).find((e) => e.number === '102')!;
    expect(added).toMatchObject({ name: 'موظف تجريبي اثنان', nameAr: 'موظف تجريبي اثنان' });
  });
});

describe('the reason for leaving', () => {
  it('is never saved unless someone chose it, and the form asks for it', async () => {
    const c = await company();
    const two = await guard(c, {
      name: 'Test Guard Two',
      hireDate: '2024-10-01',
      basicSalary: 300,
    });
    const left = await saveEmployee({ ...two, status: 'left', leavingDate: '2026-09-30' });
    expect(left.leavingReason).toBeNull();
    expect(validateEmployee(left)).toEqual({ leavingReason: 'Choose the reason for leaving.' });
    expect(validateEmployee({ ...left, leavingReason: 'resignation' })).toEqual({});
  });

  it('is asked for by the settlement, never taken as a termination', async () => {
    const c = await company();
    const three = await guard(c, {
      name: 'Test Guard Three',
      hireDate: '2024-10-01',
      basicSalary: 300,
    });
    const left = await saveEmployee({ ...three, status: 'left', leavingDate: '2026-09-30' });
    const setup = settlementSetup(left, '2026-09-30', await settlementData(c), 3);
    const form = settlementDefaults(left, '2026-09-30', 'resignation', setup, 3);
    await expect(
      postSettlement({ ...form, reason: null as unknown as LeavingReason }),
    ).rejects.toThrow('Choose the reason for leaving.');
    // Chosen: two years of service and a resignation give no indemnity and no notice pay.
    const amounts = computeSettlement(settlementInput(left, form, setup, 3));
    expect(amounts).toMatchObject({ indemnity: 0, noticePay: 0 });
    const posted = await postSettlement(form);
    expect(posted.reason).toBe('resignation');
    expect((await db.employees.get(left.id))!.leavingReason).toBe('resignation');
  });
});

describe('employee photos', () => {
  it('stop being the photo when their file is removed', async () => {
    const c = await company();
    const four = await guard(c, { name: 'Test Guard Four' });
    const withPhoto = await setEmployeePhoto(four.id, { name: 'guard.jpg', dataUrl: PIXEL });
    await removeAttachment(withPhoto.photoId!);
    expect((await db.employees.get(four.id))!.photoId).toBeNull();
  });
});

describe('an edit form opened before a final settlement', () => {
  it('can’t bring the employee back onto the payroll', async () => {
    const c = await company();
    const six = await guard(c, {
      name: 'Test Guard Six',
      hireDate: '2020-01-01',
      basicSalary: 250,
    });
    // /employees/:id/edit loads the record once.
    const formState = { ...(await db.employees.get(six.id))!, notes: 'Night shift' };

    // Meanwhile (another tab, or a colleague's device through sync) the settlement is posted.
    const setup = settlementSetup(six, '2026-09-30', await settlementData(c), 3);
    await postSettlement(settlementDefaults(six, '2026-09-30', 'resignation', setup, 3));
    expect((await db.employees.get(six.id))!.status).toBe('left');

    // The form is refused: the record changed after it was opened...
    await expect(
      saveEmployee(formState, { expectedUpdatedAt: formState.updatedAt }),
    ).rejects.toThrow(/changed somewhere else/);
    // ...and nothing makes someone with a final settlement current again.
    await expect(saveEmployee(formState)).rejects.toThrow(/final settlement/);
    const october = await createPayRun(c.id, '2026-10').catch(() => null);
    expect(october?.lines.map((l) => l.employeeId) ?? []).not.toContain(six.id);
  });
});

describe('imported staff', () => {
  it('bring their leave from the import date, not confirmed, unlike staff added by hand', async () => {
    const c = await company();
    const rows = [
      ['Employee Number', 'Name', 'Date of Joining', 'Basic Salary', 'IBAN', 'Nationality'],
      ['201', 'Test Guard Seven', '2016-01-01', '260', IBAN, 'Nepali'],
    ];
    await importEmployees(c.id, rows, guessColumns('employees', rows[0], rows), OPTIONS);
    const seven = (await db.employees.toArray()).find((e) => e.number === '201')!;
    expect(seven.leaveOpening).toEqual({ date: '2026-10-05', days: 0, confirmed: false });
    const byHand = await guard(c, { name: 'Test Guard Hand', hireDate: '2016-01-01' });

    const october = await approvePayRun((await createPayRun(c.id, '2026-10')).id);
    const share = (id: string) => october.provisions!.find((p) => p.employeeId === id)!;
    // Nothing accrued before the import is posted.
    expect(share(seven.id)).toMatchObject({ leaveDays: 0, leave: 0 });
    // Staff added by hand still accrue from the hire date: 130 months × 2.5 days.
    expect(share(byHand.id).leaveDays).toBe(325);

    // HR enters what the guard had left on the import date, and confirms it.
    const confirmed = await setLeaveOpening(seven.id, { date: '2026-10-05', days: 12 });
    expect(confirmed.leaveOpening).toEqual({ date: '2026-10-05', days: 12, confirmed: true });
    expect(employeeLeaveBalance(confirmed, [], '2026-12-31')).toMatchObject({
      from: '2026-10-05',
      opening: 12,
      accrued: 5,
      balance: 17,
    });
  });
});

describe('deleting an employee', () => {
  it('leaves no name, Civil ID number or note in the renewal fee kept in the books', async () => {
    const c = await company();
    const civilId = '290010112345';
    const eight = await guard(c, {
      name: 'Test Guard Eight',
      civilId,
      civilIdExpiry: '2026-11-30',
    });
    const { renewal, expense } = await renewDocument({
      companyId: c.id,
      key: `emp:${eight.id}:civil_id`,
      newExpiry: '2027-11-30',
      renewedOn: '2026-10-01',
      note: 'Renewed for Test Guard Eight',
      fee: { amount: 5, accountId: null, paidFromAccountId: null },
    });
    // Recorded now: nothing about the employee on the expense.
    expect(expense).toMatchObject({
      description: 'Document renewal fee',
      reference: '',
      notes: '',
    });
    expect(renewal).toMatchObject({ number: civilId, note: 'Renewed for Test Guard Eight' });
    // As renewals recorded the fee before: name, number and note on the expense.
    await db.expenses.put({
      ...expense!,
      description: 'Civil ID renewal – Test Guard Eight',
      reference: civilId,
      notes: 'Renewed for Test Guard Eight',
    });
    await deleteEmployee(eight.id);
    const fee = (await db.expenses.get(expense!.id))!;
    expect(fee).toMatchObject({ description: 'Document renewal fee', reference: '', notes: '' });
    expect(JSON.stringify(fee)).not.toContain(civilId);
  });
});

describe('a final settlement for an imported employee without a hire date or salary', () => {
  it('is refused until they are filled in', async () => {
    const c = await company();
    // 217 imported guards: salary 0, some without a hire date.
    const nine = await guard(c, { name: 'Test Guard Nine', hireDate: null, basicSalary: 0 });
    const setup = settlementSetup(nine, '2026-10-15', await settlementData(c), 3);
    const form = settlementDefaults(nine, '2026-10-15', 'termination', setup, 3);
    await expect(postSettlement(form)).rejects.toThrow(
      'Add the hire date and the salary to Test Guard Nine’s record before the final settlement.',
    );
    const salaried = await saveEmployee({ ...nine, basicSalary: 250 });
    await expect(postSettlement({ ...form, employeeId: salaried.id })).rejects.toThrow(
      'Add the hire date to Test Guard Nine’s record before the final settlement.',
    );
    expect((await db.employees.get(nine.id))!.status).toBe('active');
  });
});

describe('unpaid leave recorded after the month’s pay run', () => {
  it('is refused until the pay run is reopened', async () => {
    const c = await company();
    const ten = await guard(c, { name: 'Test Guard Ten' });
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    const unpaid = createLeaveRecord(c.id, ten.id, {
      type: 'unpaid',
      start: '2026-09-20',
      end: '2026-09-24',
    });
    await expect(saveLeaveRecord(unpaid)).rejects.toThrow(/already approved\. Reopen/);
    // Sick leave at full pay changes nothing in the run: it can be recorded.
    await saveLeaveRecord(
      createLeaveRecord(c.id, ten.id, { type: 'sick', start: '2026-09-21', end: '2026-09-22' }),
    );
    await payPayRun(september.id, { date: '2026-10-01' });
    await expect(saveLeaveRecord(unpaid)).rejects.toThrow(/already paid\. Undo its payment/);
    // October's own leave is fine.
    await saveLeaveRecord({ ...unpaid, start: '2026-10-20', end: '2026-10-24' });
  });
});

describe('unpaid leave in a pay run', () => {
  it('a guard away on unpaid leave for the whole month is not paid for it', async () => {
    const c = await company();
    const five = await guard(c, {
      name: 'Test Guard Five',
      basicSalary: 230,
      allowances: [newAllowance({ name: 'Food allowance', amount: 30 })],
    });
    await saveLeaveRecord(
      createLeaveRecord(c.id, five.id, { type: 'unpaid', start: '2026-09-01', end: '2026-09-30' }),
    );
    const run = await createPayRun(c.id, '2026-09');
    expect(run.lines[0]).toMatchObject({
      calendarLeave: { unpaidDays: 30, reducedPay: [] },
      absenceDeduction: 260,
      net: 0,
    });
    // What older versions of the app read: September's 22 working days, at the daily rate.
    expect(run.lines[0].unpaidLeaveDays).toBe(22);
  });
});
