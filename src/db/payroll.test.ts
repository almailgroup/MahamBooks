import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { loadLedger } from './accounting';
import { createEmployee, newAllowance, saveEmployee } from './people';
import { setupCompany } from './records';
import {
  approvePayRun,
  cancelStaffLoan,
  createLeaveRecord,
  createPayRun,
  createStaffLoan,
  deletePayRun,
  getPayrollSettings,
  loanBalance,
  payPayRun,
  paySettlement,
  postSettlement,
  refreshPayRun,
  reopenPayRun,
  reverseSettlement,
  saveLeaveRecord,
  savePayrollSettings,
  saveStaffLoan,
  settlementDefaults,
  settlementSetup,
  undoPayRunPayment,
  updatePayLine,
} from './payroll';
import type { Company, Employee, LeavePolicy, ManualJournal } from './types';
import { DEFAULT_LEAVE_POLICY } from '@/lib/hr/leave';
import { buildSalaryFile, salaryFileCivilId } from '@/lib/hr/salary-file';
import { eosProvisionFor } from '@/lib/hr/payroll';
import { toMinor } from '@/lib/money';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const IBAN = 'KW81CBKU0000000000001234560101';

async function company(): Promise<Company> {
  return setupCompany({ name: 'Almail Trading' });
}

async function staff(c: Company): Promise<{ kuwaiti: Employee; expat: Employee }> {
  const kuwaiti = await saveEmployee(
    createEmployee(c.id, {
      name: 'Fatima Al-Sabah',
      nameAr: 'فاطمة الصباح',
      category: 'kuwaiti',
      nationality: 'KW',
      hireDate: '2019-01-01',
      basicSalary: 2600,
      allowances: [newAllowance({ name: 'Social allowance', amount: 400 })],
      iban: IBAN,
    }),
  );
  const expat = await saveEmployee(
    createEmployee(c.id, {
      name: 'Ravi Kumar',
      category: 'expat',
      nationality: 'IN',
      hireDate: '2026-09-16',
      basicSalary: 450,
      allowances: [newAllowance({ name: 'Housing', amount: 60, countsForEos: false })],
      iban: IBAN,
    }),
  );
  return { kuwaiti, expat };
}

/** Balances by account code in minor units (debit positive), with the trial balance check. */
async function balances(c: Company): Promise<Record<string, number>> {
  const fresh = (await db.companies.get(c.id))!;
  const { accounts, lines, problems } = await loadLedger(fresh);
  expect(problems).toEqual([]);
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
  const out: Record<string, number> = {};
  for (const l of lines) {
    const code = accounts.find((a) => a.id === l.accountId)!.code;
    out[code] = (out[code] ?? 0) + l.amount;
  }
  return out;
}

async function journal(id: string | null): Promise<ManualJournal> {
  return (await db.journals.get(id!))!;
}

describe('pay runs', () => {
  it('pay Kuwaitis with capped PIFSS and joiners pro rata, and post one balanced entry', async () => {
    const c = await company();
    const { kuwaiti, expat } = await staff(c);
    const run = await createPayRun(c.id, '2026-09');
    expect(run).toMatchObject({ status: 'draft', date: '2026-09-30', payDate: '2026-09-30' });
    expect(run.lines.map((l) => l.name)).toEqual(['Fatima Al-Sabah', 'Ravi Kumar']);
    const [fatima, ravi] = run.lines;
    // KD 3,000 a month is insured up to KD 2,750.
    expect(fatima).toMatchObject({ gross: 3000, pifssEmployee: 288.75, pifssEmployer: 316.25 });
    expect(fatima.net).toBe(2711.25);
    // Joined on 16 September: 15 of 30 days.
    expect(ravi).toMatchObject({ daysWorked: 15, basic: 225, allowanceTotal: 30, gross: 255 });

    await expect(createPayRun(c.id, '2026-09')).rejects.toThrow(/already a pay run/);

    const edited = await updatePayLine(run.id, ravi.id, {
      overtime: { normal: 2, restDay: 0, holiday: 0 },
      adjustments: [{ id: '', type: 'deduction', amount: 5, note: 'Uniform' }],
    });
    // KD 510 ÷ 26 ÷ 8 × 2 hours × 1.25.
    expect(edited.lines[1].overtimePay).toBe(6.13);
    expect(edited.lines[1].net).toBe(256.13);

    const approved = await approvePayRun(run.id);
    expect(approved.status).toBe('approved');
    const entry = await journal(approved.journalId);
    expect(entry).toMatchObject({ kind: 'payroll', sourceId: run.id, date: '2026-09-30' });

    const b = await balances(c);
    expect(b['6010']).toBe(2_825_000); // 2,600 + 225
    expect(b['6020']).toBe(436_130); // 400 + 30 + 6.130 overtime
    expect(b['6030']).toBe(316_250);
    expect(b['2300']).toBe(-2_967_380); // 2,711.250 + 256.130
    expect(b['2310']).toBe(-605_000); // 288.750 + 316.250
    expect(b['4500']).toBe(-5000); // the uniform deduction
    expect(b['2700']).toBe(-toMinor(eosProvisionFor(expat, '2026-09-30', 26, 3), 3));
    expect(kuwaiti.category).toBe('kuwaiti');

    // The salary file adds up to the salaries payable, to the fils.
    const settings = await getPayrollSettings(c.id);
    const file = buildSalaryFile(
      approved.lines.map((l) => ({
        employeeId: l.employeeId,
        employeeNumber: l.number,
        civilId: l.civilId,
        nameEn: l.name,
        nameAr: l.nameAr,
        iban: l.iban,
        amount: l.net,
      })),
      {
        layout: settings.salaryFile,
        period: approved.period,
        currency: 'KWD',
        precision: 3,
        pamFileNumber: '',
        reference: '',
      },
    );
    expect(file.totalMinor).toBe(-b['2300']);
    expect(file.problems).toEqual([]);
  });

  it('keep each employee’s department, and a stateless employee’s review card for the bank', async () => {
    const c = await company();
    await saveEmployee(
      createEmployee(c.id, {
        name: 'Saad Testing',
        category: 'expat',
        stateless: true,
        nationality: '',
        civilId: '',
        centralCardNumber: 'RC-2041',
        department: 'Security',
        hireDate: '2020-01-01',
        basicSalary: 300,
        iban: IBAN,
      }),
    );
    await saveEmployee(
      createEmployee(c.id, {
        name: 'Huda Testing',
        category: 'kuwaiti',
        civilId: '290010112345',
        department: ' Head Office ',
        hireDate: '2020-01-01',
        basicSalary: 1000,
        iban: IBAN,
      }),
    );
    const run = await createPayRun(c.id, '2026-09');
    const line = (name: string) => run.lines.find((l) => l.name === name)!;
    const [huda, saad] = [line('Huda Testing'), line('Saad Testing')];
    expect(huda).toMatchObject({ department: 'Head Office', civilId: '290010112345' });
    // Not insured with PIFSS, as an expatriate; the card stands in for the Civil ID
    // in the bank's salary file only, never as one on the payslip.
    expect(saad).toMatchObject({
      department: 'Security',
      civilId: '',
      centralCardNumber: 'RC-2041',
      pifssEmployee: 0,
      pifssEmployer: 0,
      net: 300,
    });
    expect(salaryFileCivilId(saad)).toBe('RC-2041');
    expect(salaryFileCivilId(huda)).toBe('290010112345');
    expect(huda).not.toHaveProperty('centralCardNumber');
  });

  it('are paid from the bank, and reopened by reversing their entries', async () => {
    const c = await company();
    await staff(c);
    const run = await createPayRun(c.id, '2026-09');
    await approvePayRun(run.id);
    await expect(updatePayLine(run.id, run.lines[0].id, { absentDays: 1 })).rejects.toThrow(
      /Reopen/,
    );
    const paid = await payPayRun(run.id, { date: '2026-10-01' });
    expect(paid).toMatchObject({ status: 'paid', paidOn: '2026-10-01' });
    const payment = await journal(paid.paymentJournalId);
    expect(payment).toMatchObject({ kind: 'payroll', date: '2026-10-01' });
    let b = await balances(c);
    expect(b['2300'] ?? 0).toBe(0);
    expect(b['1000']).toBe(-2_966_250);

    await expect(reopenPayRun(run.id)).rejects.toThrow(/Undo the payment/);
    const unpaid = await undoPayRunPayment(run.id);
    expect(await journal(unpaid.reversalJournalIds[0])).toMatchObject({
      kind: 'payroll',
      sourceId: run.id,
      reversalOf: paid.paymentJournalId,
      date: '2026-10-01',
    });
    const reopened = await reopenPayRun(run.id);
    expect(reopened.status).toBe('draft');
    expect(reopened.reversalJournalIds).toHaveLength(3);
    b = await balances(c);
    for (const code of ['1000', '2300', '2310', '6010', '6020', '6030', '2700', '6040']) {
      expect(b[code] ?? 0).toBe(0);
    }
    // History is kept: a run approved once can't be deleted.
    await expect(deletePayRun(run.id)).rejects.toThrow(/approved before/);
    const again = await approvePayRun(run.id);
    expect(again.status).toBe('approved');
  });

  it('respect the lock date', async () => {
    const c = await company();
    await staff(c);
    const run = await createPayRun(c.id, '2026-09');
    await db.companies.put({ ...c, accounting: { ...c.accounting!, lockDate: '2026-09-30' } });
    await expect(approvePayRun(run.id)).rejects.toThrow(/locked/);
    await db.companies.put({ ...c, accounting: { ...c.accounting!, lockDate: null } });
    await approvePayRun(run.id);
    await db.companies.put({ ...c, accounting: { ...c.accounting!, lockDate: '2026-09-30' } });
    await expect(reopenPayRun(run.id)).rejects.toThrow(/locked/);
    await expect(payPayRun(run.id, { date: '2026-09-30' })).rejects.toThrow(/locked/);
    await payPayRun(run.id, { date: '2026-10-02' });
  });

  it('bring the end-of-service provision to its target each month', async () => {
    const c = await company();
    const { expat } = await staff(c);
    await savePayrollSettings({ ...(await getPayrollSettings(c.id)), eosForInsured: true });
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    const fatima = (await db.employees.toArray()).find((e) => e.name === 'Fatima Al-Sabah')!;
    const target = (on: string) =>
      toMinor(eosProvisionFor(expat, on, 26, 3), 3) +
      toMinor(eosProvisionFor(fatima, on, 26, 3), 3);
    const sepTarget = target('2026-09-30');
    let b = await balances(c);
    expect(b['2700']).toBe(-sepTarget);
    expect(b['6040']).toBe(sepTarget);
    expect(september.provisions?.find((p) => p.employeeId === expat.id)?.eos).toBe(
      eosProvisionFor(expat, '2026-09-30', 26, 3),
    );

    const october = await approvePayRun((await createPayRun(c.id, '2026-10')).id);
    const octTarget = target('2026-10-31');
    const provision = await journal(october.provisionJournalId);
    const change = provision.lines.find((l) => l.debit > 0)!;
    expect(toMinor(change.debit, 3)).toBe(octTarget - sepTarget);
    b = await balances(c);
    expect(b['2700']).toBe(-octTarget);
  });
});

describe('leave in pay runs', () => {
  it('counts working days with the company’s holidays and deducts unpaid and sick days', async () => {
    const c = await company();
    const { kuwaiti, expat } = await staff(c);
    await db.companies.put({
      ...c,
      holidays: [{ date: '2026-10-06', name: 'Bridge day', nameAr: 'يوم عطلة' }],
    });
    // Sun 4 – Thu 8 October: unpaid leave runs in calendar days, the holiday included.
    const unpaid = await saveLeaveRecord(
      createLeaveRecord(c.id, expat.id, { type: 'unpaid', start: '2026-10-04', end: '2026-10-08' }),
    );
    expect(unpaid.days).toBe(5);
    // 16 sick days for Fatima (the bridge day is not counted): 15 at full pay, 1 at three quarters.
    await saveLeaveRecord(
      createLeaveRecord(c.id, kuwaiti.id, { type: 'sick', start: '2026-10-01', end: '2026-10-25' }),
    );
    const run = await createPayRun(c.id, '2026-10');
    const [fatima, ravi] = run.lines;
    // Sunday 25 October, the 16th working day; the weekend before it is still at full pay.
    expect(fatima.calendarLeave).toEqual({ unpaidDays: 0, reducedPay: [{ percent: 75, days: 1 }] });
    // A quarter of a day of KD 3,000 in a 31-day month: 3,000 − 30.75 days' pay.
    expect(fatima.absenceDeduction).toBe(24.194);
    expect(ravi.calendarLeave).toEqual({ unpaidDays: 5, reducedPay: [] });
    // 510 × 5 ÷ 31: KD 450 basic and KD 60 housing each for 26 days, 377.419 + 50.323.
    expect(ravi.absenceDeduction).toBe(82.258);
    // Older versions of the app read working days at the daily rate, as they always did:
    // the bridge day is off.
    expect(ravi).toMatchObject({ unpaidLeaveDays: 4, reducedPay: [] });
    expect(fatima).toMatchObject({ unpaidLeaveDays: 0, reducedPay: [{ percent: 75, days: 1 }] });
    await expect(
      saveLeaveRecord(
        createLeaveRecord(c.id, expat.id, { start: '2026-10-09', end: '2026-10-10' }),
      ),
    ).rejects.toThrow(/weekends/);
  });

  it('pay nothing for a month of unpaid leave, and joiners only for their days', async () => {
    const c = await company();
    const { expat } = await staff(c);
    // Joined on 16 September: 15 days employed, 10 of them on unpaid leave.
    await saveLeaveRecord(
      createLeaveRecord(c.id, expat.id, { type: 'unpaid', start: '2026-09-01', end: '2026-09-25' }),
    );
    await saveLeaveRecord(
      createLeaveRecord(c.id, expat.id, { type: 'unpaid', start: '2026-10-01', end: '2026-10-31' }),
    );
    const september = await createPayRun(c.id, '2026-09');
    const ravi = september.lines.find((l) => l.employeeId === expat.id)!;
    expect(ravi).toMatchObject({
      daysWorked: 15,
      calendarLeave: { unpaidDays: 10 },
      // Working days, for older versions: 16 to 25 September less three weekend days.
      unpaidLeaveDays: 7,
      basic: 225,
    });
    // Paid for 5 of 30 days: 450 × 5 ÷ 30 + 60 × 5 ÷ 30.
    expect(ravi.gross).toBe(85);
    const october = await createPayRun(c.id, '2026-10');
    const away = october.lines.find((l) => l.employeeId === expat.id)!;
    expect(away).toMatchObject({ calendarLeave: { unpaidDays: 31 }, gross: 0, net: 0 });
  });
});

describe('staff loans', () => {
  it('are paid from the bank and recovered in instalments', async () => {
    const c = await company();
    const { kuwaiti } = await staff(c);
    const loan = await saveStaffLoan(
      createStaffLoan(c.id, kuwaiti.id, {
        date: '2026-09-05',
        amount: 500,
        instalment: 200,
        firstPeriod: '2026-09',
      }),
    );
    expect(await journal(loan.journalId)).toMatchObject({ kind: 'payroll', date: '2026-09-05' });
    let b = await balances(c);
    expect(b['1320']).toBe(500_000);
    expect(b['1000']).toBe(-500_000);

    const september = await createPayRun(c.id, '2026-09');
    expect(september.lines[0].loans).toEqual([{ loanId: loan.id, amount: 200 }]);
    await approvePayRun(september.id);
    await expect(cancelStaffLoan(loan.id)).rejects.toThrow(/recovered/);

    const october = await createPayRun(c.id, '2026-10');
    await approvePayRun(october.id);
    const november = await createPayRun(c.id, '2026-11');
    expect(november.lines[0].loans).toEqual([{ loanId: loan.id, amount: 100 }]);
    await approvePayRun(november.id);
    b = await balances(c);
    expect(b['1320'] ?? 0).toBe(0);
    const runs = await db.payRuns.toArray();
    expect(loanBalance(loan, runs, [], 3)).toBe(0);
    const december = await createPayRun(c.id, '2026-12');
    expect(december.lines[0].loans).toEqual([]);
  });

  it('can be cancelled before anything is recovered', async () => {
    const c = await company();
    const { expat } = await staff(c);
    const loan = await saveStaffLoan(
      createStaffLoan(c.id, expat.id, { amount: 100, instalment: 50, date: '2026-09-20' }),
    );
    const run = await createPayRun(c.id, '2026-09');
    expect(run.lines[1].loans).toHaveLength(1);
    await cancelStaffLoan(loan.id);
    const refreshed = await refreshPayRun(run.id);
    expect(refreshed.lines[1].loans).toEqual([]);
    const b = await balances(c);
    expect(b['1320'] ?? 0).toBe(0);
  });
});

describe('final settlement', () => {
  it('clears the provisions, recovers the loan, pays the last salary and marks the employee as left', async () => {
    const c = await company();
    const { expat } = await staff(c);
    const ravi = await saveEmployee({ ...expat, hireDate: '2020-01-01' });
    const loan = await saveStaffLoan(
      createStaffLoan(c.id, ravi.id, {
        date: '2026-08-01',
        amount: 300,
        instalment: 100,
        firstPeriod: '2026-12',
      }),
    );
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    const share = september.provisions!.find((p) => p.employeeId === ravi.id)!;
    expect(share.eos).toBeGreaterThan(0);
    expect(share.leaveDays).toBe(202.5); // 81 months × 2.5 days, none taken

    const [settings, people, leave, loans, runs, settlements] = await Promise.all([
      getPayrollSettings(c.id),
      db.peopleSettings.get(c.id),
      db.leaveRecords.toArray(),
      db.staffLoans.toArray(),
      db.payRuns.toArray(),
      db.finalSettlements.toArray(),
    ]);
    const data = {
      settings,
      people: { eosDailyDivisor: people?.eosDailyDivisor ?? 26 },
      leave,
      loans,
      runs,
      settlements,
    };
    const setup = settlementSetup(ravi, '2026-10-15', data, 3);
    expect(setup.provisions).toEqual({ eos: share.eos, leave: share.leave });
    expect(setup.paidInRun).toBeNull();
    const form = {
      ...settlementDefaults(ravi, '2026-10-15', 'termination', setup, 3),
      leaveDays: 10,
    };
    expect(form).toMatchObject({ noticeMonths: 3, lastSalaryDays: 15 });
    expect(form.loans).toEqual([{ loanId: loan.id, amount: 300 }]);

    const settlement = await postSettlement(form);
    expect(settlement).toMatchObject({ status: 'posted', noticePay: 1530, leavePay: 196.154 });
    // 15 of October's 31 days of KD 510.
    expect(settlement.lastSalary).toMatchObject({ days: 15, daysInMonth: 31, gross: 246.774 });
    const entry = await journal(settlement.journalId);
    expect(entry).toMatchObject({ kind: 'payroll', date: '2026-10-15' });

    const b = await balances(c);
    // Ravi's share of the provisions is released, Fatima's stays.
    const fatimaShare = september.provisions!.find((p) => p.employeeId !== ravi.id)!;
    // Fatima is insured with PIFSS, so has no end-of-service provision by default.
    expect(fatimaShare.eos).toBe(0);
    expect(b['2700'] ?? 0).toBe(0);
    expect(b['2320']).toBe(-toMinor(fatimaShare.leave, 3));
    expect(b['1320'] ?? 0).toBe(0);
    expect(b['2300']).toBe(
      -(
        toMinor(
          september.lines.reduce((s, l) => s + l.net, 0),
          3,
        ) + toMinor(settlement.net, 3)
      ),
    );
    expect(await db.employees.get(ravi.id)).toMatchObject({
      status: 'left',
      leavingDate: '2026-10-15',
      leavingReason: 'termination',
    });

    // October's pay run leaves Ravi out: his last salary was in the settlement.
    const october = await createPayRun(c.id, '2026-10');
    expect(october.lines.map((l) => l.name)).toEqual(['Fatima Al-Sabah']);
    await expect(postSettlement(form)).rejects.toThrow(/already has/);

    const paid = await paySettlement(settlement.id, { date: '2026-10-20' });
    expect(await journal(paid.paymentJournalId)).toMatchObject({ kind: 'payroll' });
    const undone = await reverseSettlement(settlement.id);
    expect(undone.status).toBe('posted');
    const reversed = await reverseSettlement(settlement.id);
    expect(reversed.status).toBe('reversed');
    const after = await balances(c);
    expect(after['1320']).toBe(300_000);
  });
});

describe('the annual leave policy', () => {
  const law = (overrides: Partial<LeavePolicy>): LeavePolicy => ({
    ...DEFAULT_LEAVE_POLICY,
    ...overrides,
  });

  it('is saved only once set, with 30 days a year at least, and keeps its counting once leave is recorded', async () => {
    const c = await company();
    const { expat } = await staff(c);
    expect((await getPayrollSettings(c.id)).leavePolicy).toBeUndefined();
    await savePayrollSettings({ ...(await getPayrollSettings(c.id)), payDay: 25 });
    expect(await db.payrollSettings.get(c.id)).not.toHaveProperty('leavePolicy');

    const settings = await getPayrollSettings(c.id);
    await expect(
      savePayrollSettings({
        ...settings,
        leavePolicy: law({ annualDays: [{ from: '2026-07-01', days: 25 }] }),
      }),
    ).rejects.toThrow(/less than 30 days/);
    await expect(
      savePayrollSettings({ ...settings, leavePolicy: law({ annualDays: [] }) }),
    ).rejects.toThrow(/date the leave policy applies from/);
    const saved = await savePayrollSettings({
      ...settings,
      leavePolicy: {
        annualDays: [
          { from: '2027-01-01', days: 45.555 },
          { from: '2026-07-01', days: 40 },
          { from: 'someday', days: 50 },
        ],
        firstYearMonths: 12,
        carryForwardMax: 0,
        counting: 'calendar',
      },
    });
    expect(saved.leavePolicy).toEqual({
      annualDays: [
        { from: '2026-07-01', days: 40 },
        { from: '2027-01-01', days: 45.56 },
      ],
      firstYearMonths: 9,
      carryForwardMax: null,
      counting: 'calendar',
    });

    // Thursday 1 – Sunday 4 October in calendar days, the weekend included.
    const leave = await saveLeaveRecord(
      createLeaveRecord(c.id, expat.id, { start: '2026-10-01', end: '2026-10-04' }),
    );
    expect(leave.days).toBe(4);
    const policy = saved.leavePolicy!;
    await expect(
      savePayrollSettings({ ...saved, leavePolicy: { ...policy, counting: 'working' } }),
    ).rejects.toThrow(/counted can’t change/);
    await savePayrollSettings({ ...saved, leavePolicy: { ...policy, carryForwardMax: 60 } });
    expect((await getPayrollSettings(c.id)).leavePolicy?.carryForwardMax).toBe(60);
  });

  it('brings the leave provision up only from the policy’s date', async () => {
    const c = await company();
    // KD 520 a month: KD 20 a day over 26 days.
    const guard = await saveEmployee(
      createEmployee(c.id, {
        name: 'Made-up Guard',
        category: 'expat',
        nationality: 'IN',
        hireDate: '2026-01-01',
        basicSalary: 520,
        iban: IBAN,
      }),
    );
    // Hired with 60 days a year in the contract.
    const manager = await saveEmployee(
      createEmployee(c.id, {
        name: 'Made-up Manager',
        category: 'expat',
        nationality: 'IN',
        hireDate: '2026-09-01',
        basicSalary: 520,
        iban: IBAN,
        annualLeaveDays: 60,
      }),
    );
    const september = await approvePayRun((await createPayRun(c.id, '2026-09')).id);
    const share = (run: typeof september, id: string) =>
      run.provisions?.find((p) => p.employeeId === id);
    expect(share(september, guard.id)).toMatchObject({ leaveDays: 22.5, leave: 450 });
    expect(share(september, manager.id)).toMatchObject({ leaveDays: 5, leave: 100 });

    // 45 days a year from October: 3.75 days for October, nothing again for the months before.
    await savePayrollSettings({
      ...(await getPayrollSettings(c.id)),
      leavePolicy: law({ annualDays: [{ from: '2026-10-01', days: 45 }] }),
    });
    const october = await approvePayRun((await createPayRun(c.id, '2026-10')).id);
    expect(share(october, guard.id)).toMatchObject({ leaveDays: 26.25, leave: 525 });
    // The manager's own 60 days a year stay theirs.
    expect(share(october, manager.id)).toMatchObject({ leaveDays: 10, leave: 200 });
    const b = await balances(c);
    expect(b['2320']).toBe(-toMinor(525 + 200, 3));
    expect(b['6050']).toBe(toMinor(525 + 200, 3));
  });
});
