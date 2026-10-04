import { db } from '../db';
import { saveEmployee } from '../people';
import {
  approvePayRun,
  createLeaveRecord,
  createPayRun,
  createStaffLoan,
  getPayrollSettings,
  payPayRun,
  paySettlement,
  postSettlement,
  saveLeaveRecord,
  saveStaffLoan,
  settlementDefaults,
  settlementSetup,
  updatePayLine,
} from '../payroll';
import {
  createComplianceDocument,
  markComplianceDone,
  renewDocument,
  saveComplianceDocument,
} from '../renewals';
import type { EmployeeKey } from './data';
import type { ID, ISODate, PayRun } from '../types';
import { addDaysISO } from '@/lib/dates';
import { payRunTotals } from '@/lib/hr/payroll';
import { employeeDocumentKey, fiscalYearEndIn, monthsAfter, recordKey } from '@/lib/compliance';
import { round } from '@/lib/money';
import type { DemoBooks } from './books';
import { Calendar, type Timeline } from './calendar';
import { both, monthNames, VEHICLE } from './data';
import { nextWorkday } from './sales';
import { employeeRecord } from './setup';

export function peopleStory(books: DemoBooks, tl: Timeline): void {
  leave(books, tl);
  loans(books, tl);
  leaver(books, tl);
  joiner(books, tl);
  payroll(books, tl);
  renewals(books, tl);
  statutory(books, tl);
}

const id = (books: DemoBooks, key: EmployeeKey): ID => books.employees[key].id;

/* -------------------------------------------------------------------------- */
/* Pay runs                                                                   */
/* -------------------------------------------------------------------------- */

/** Overtime, commission and the odd absence, the same every time. */
const RAMON_OVERTIME = [6, 0, 8, 0, 5, 0, 10, 0, 7, 0, 9, 0];
const COMMISSION = [35, 52.5, 41, 60, 28.5, 47, 55, 39, 62, 44, 50.5, 36];

function payroll(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  for (let m = -12; m <= -1; m++) {
    const n = m + 12;
    const period = cal.period(m);
    const end = cal.monthEnd(m);
    let run: PayRun;
    tl.at(end, `payroll ${period}`, async () => {
      run = await createPayRun(books.id, period);
      for (const line of run.lines) {
        if (line.employeeId === id(books, 'ramon') && RAMON_OVERTIME[n]) {
          run = await updatePayLine(run.id, line.id, {
            overtime: { normal: RAMON_OVERTIME[n], restDay: n % 4 === 1 ? 4 : 0, holiday: 0 },
          });
        }
        if (line.employeeId === id(books, 'mohammed')) {
          run = await updatePayLine(run.id, line.id, {
            adjustments: [
              {
                id: '',
                type: 'addition',
                amount: COMMISSION[n],
                note: both('Sales commission', 'عمولة مبيعات'),
              },
            ],
          });
        }
        if (line.employeeId === id(books, 'asif') && n === 3) {
          run = await updatePayLine(run.id, line.id, { absentDays: 1 });
        }
      }
      run = await approvePayRun(run.id);
    });
    // Salaries go out on the first working day on or after the month end.
    const paid = nextWorkday(end);
    tl.at(paid, `salaries ${period} paid`, async () => {
      await payPayRun(run.id, { date: paid, bankAccountId: books.money('nbk') });
    });
    // PIFSS contributions are paid by the 15th of the next month.
    const pifss = cal.workdayOf(m + 1, 10);
    tl.at(pifss, `PIFSS ${period}`, async () => {
      const totals = payRunTotals((await db.payRuns.get(run.id))!.lines, 3);
      const amount = round(totals.pifssEmployee + totals.pifssEmployer, 3);
      if (amount > 0) await pifssPaid(books, period, pifss, amount);
    });
  }
  // The opening balance held last month's contributions.
  const before = cal.period(-13);
  const first = cal.workdayOf(-12, 10);
  tl.at(first, `PIFSS ${before}`, async () => {
    if (books.openingPifss > 0) await pifssPaid(books, before, first, books.openingPifss);
  });

  // This month's run is prepared and waits for approval.
  tl.at(cal.today, 'payroll this month', async () => {
    await createPayRun(books.id, cal.period(0));
  });
}

async function pifssPaid(books: DemoBooks, period: string, date: ISODate, amount: number) {
  const month = monthNames(period);
  const paid = amount.toFixed(3);
  await books.journal(
    date,
    both(`PIFSS contributions ${month.en}`, `اشتراكات التأمينات الاجتماعية ${month.ar}`),
    [
      ['2310', amount, 0, both('Employee and employer shares', 'حصة الموظفين وصاحب العمل')],
      ['1000', 0, amount, both('Paid online to PIFSS', 'سداد إلكتروني للتأمينات الاجتماعية')],
    ],
  );
  await markComplianceDone(books.id, `pifss:${period}`, {
    doneOn: date,
    note: both(`KD ${paid} paid from NBK`, `سُدّد ${paid} د.ك من حساب الوطني`),
    label: both('PIFSS contributions', 'اشتراكات التأمينات الاجتماعية'),
  });
}

/* -------------------------------------------------------------------------- */
/* Leave and loans                                                            */
/* -------------------------------------------------------------------------- */

function leave(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const record = (
    key: EmployeeKey,
    type: 'annual' | 'sick' | 'hajj',
    start: ISODate,
    end: ISODate,
    notes: string,
    recordedOn: ISODate = start,
  ) => {
    tl.at(recordedOn, `leave ${key}`, async () => {
      await saveLeaveRecord(
        createLeaveRecord(books.id, id(books, key), {
          type,
          start: nextWorkday(start),
          end,
          notes,
        }),
      );
    });
  };
  record(
    'rajesh',
    'annual',
    cal.day(-7, 6),
    cal.day(-7, 27),
    both('Home leave, India', 'إجازة إلى الهند'),
    cal.day(-8, 20),
  );
  record(
    'sanjay',
    'annual',
    cal.day(-4, 3),
    cal.day(-4, 30),
    both('Home leave, Nepal', 'إجازة إلى نيبال'),
    cal.day(-5, 18),
  );
  record(
    'ramon',
    'sick',
    cal.day(-2, 11),
    cal.day(-2, 13),
    both('Medical certificate on file', 'شهادة طبية في الملف'),
  );
  record('maryam', 'annual', cal.day(-1, 18), cal.day(-1, 24), both('Family trip', 'رحلة عائلية'));
  record(
    'abdulaziz',
    'annual',
    cal.day(-9, 7),
    cal.day(-9, 13),
    both('Annual leave', 'إجازة سنوية'),
  );
  // Approved leave still to come.
  record(
    'mohammed',
    'annual',
    cal.ahead(12),
    cal.ahead(25),
    both('Home leave, Egypt', 'إجازة إلى مصر'),
    cal.ago(3),
  );
}

function loans(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const lent = cal.workdayOf(-5, 6);
  tl.at(lent, 'staff loan', async () => {
    await saveStaffLoan(
      createStaffLoan(books.id, id(books, 'mohammed'), {
        date: lent,
        amount: 400,
        instalment: 50,
        firstPeriod: cal.period(-4),
        paidFromAccountId: books.money('nbk'),
        notes: both('Advance for school fees', 'سلفة للرسوم المدرسية'),
      }),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* A leaver and a joiner                                                      */
/* -------------------------------------------------------------------------- */

/** Ahmed resigns after ten years; his final settlement is posted and paid. */
function leaver(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const leaving = cal.workdayOf(-4, 15);
  let settlementId: ID;
  tl.at(leaving, 'final settlement', async () => {
    const employee = (await db.employees.get(id(books, 'ahmed')))!;
    const [settings, people, leaveRecords, loanRecords, runs, settlements] = await Promise.all([
      getPayrollSettings(books.id),
      db.peopleSettings.get(books.id),
      db.leaveRecords.where('companyId').equals(books.id).toArray(),
      db.staffLoans.where('companyId').equals(books.id).toArray(),
      db.payRuns.where('companyId').equals(books.id).toArray(),
      db.finalSettlements.where('companyId').equals(books.id).toArray(),
    ]);
    const setup = settlementSetup(
      employee,
      leaving,
      {
        settings,
        people: { eosDailyDivisor: people?.eosDailyDivisor ?? 26 },
        leave: leaveRecords,
        loans: loanRecords,
        runs,
        settlements,
      },
      3,
    );
    const form = settlementDefaults(employee, leaving, 'resignation', setup, 3);
    const settlement = await postSettlement({
      ...form,
      notes:
        'Resigned with one month’s notice served. Ticket home booked by the company.\n' +
        'استقال بعد قضاء مدة الإنذار شهراً كاملاً، وحجزت الشركة تذكرة عودته.',
    });
    settlementId = settlement.id;
  });
  // Paid within a week of leaving (art. 57).
  const paid = cal.workdayOf(-4, 20);
  tl.at(paid, 'final settlement paid', async () => {
    await paySettlement(settlementId, { date: paid, bankAccountId: books.money('nbk') });
  });
}

function joiner(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const hired = cal.workdayOf(-3, 8);
  tl.at(hired, 'new electrician', async () => {
    const year = hired.slice(0, 4);
    books.employees.sherif = await saveEmployee(
      employeeRecord(books, 'sherif', {
        hireDate: hired,
        probationEnd: addDaysISO(hired, 100),
        contractEnd: addDaysISO(addDaysISO(hired, 730), -1),
        residencyNumber: `18/${year}/074419`,
        workPermitNumber: `WP-${year}-0215583`,
        residencyExpiry: addDaysISO(hired, 365),
        workPermitExpiry: addDaysISO(hired, 365),
        civilIdExpiry: addDaysISO(hired, 365),
        passportExpiry: addDaysISO(hired, 2190),
      }),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Renewals and statutory deadlines                                           */
/* -------------------------------------------------------------------------- */

function renewals(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  // Ramon's residency was renewed last year, with its fee.
  const due = cal.day(-8, 25);
  const renewed = cal.workdayOf(-8, 12);
  tl.at(renewed, 'Ramon residency renewed', async () => {
    const next = addDaysISO(due, 365);
    for (const type of ['residency', 'work_permit', 'civil_id'] as const) {
      await renewDocument({
        companyId: books.id,
        key: employeeDocumentKey(id(books, 'ramon'), type),
        newExpiry: next,
        renewedOn: renewed,
        fee:
          type === 'residency'
            ? { amount: 60, accountId: null, paidFromAccountId: books.money('nbk') }
            : null,
        note:
          type === 'residency'
            ? both('Residency and health insurance fees', 'رسوم الإقامة والتأمين الصحي')
            : '',
      });
    }
  });

  // Company papers renewed during the year.
  const yearly = (
    type: 'kcci_membership' | 'vehicle_registration',
    expiresIn: number,
    fee: number,
    extra: Record<string, string>,
  ) => {
    const expiry = cal.ahead(expiresIn);
    const previous = addDaysISO(expiry, -365);
    const renewedOn = cal.workday(addDaysISO(previous, -6));
    let recordId: ID;
    tl.at(addDaysISO(renewedOn, -1), `${type} on file`, async () => {
      const doc = await saveComplianceDocument(
        createComplianceDocument(books.id, {
          type,
          issueDate: addDaysISO(previous, -365),
          expiryDate: previous,
          renewalCost: fee,
          ...extra,
        }),
      );
      recordId = doc.id;
    });
    tl.at(renewedOn, `${type} renewed`, async () => {
      await renewDocument({
        companyId: books.id,
        key: recordKey(recordId),
        newExpiry: expiry,
        renewedOn,
        fee: { amount: fee, accountId: null, paidFromAccountId: books.money('nbk') },
      });
    });
  };
  yearly('kcci_membership', 84, 25, {
    number: '88214',
    issuer: both('Kuwait Chamber of Commerce and Industry', 'غرفة تجارة وصناعة الكويت'),
    ownerType: 'company',
  });
  yearly('vehicle_registration', 178, 10, {
    number: '18/62417',
    issuer: both(
      'Ministry of Interior, Traffic Department',
      'وزارة الداخلية، الإدارة العامة للمرور',
    ),
    ownerType: 'vehicle',
    ownerName: VEHICLE,
  });
}

/** Last year's audited statements went to MOCI before the deadline. */
function statutory(books: DemoBooks, tl: Timeline) {
  const cal = books.calendar;
  const yearEnd = fiscalYearEndIn(Calendar.year(cal.today) - 1, { month: 12, day: 31 });
  const due = monthsAfter(yearEnd, 3);
  const filed = cal.workday(addDaysISO(due, -9));
  tl.at(filed, 'audited statements filed', async () => {
    await markComplianceDone(books.id, `audited_statements:${yearEnd}`, {
      doneOn: filed,
      note:
        'Filed with the Ministry of Commerce and Industry with the auditor’s report.\n' +
        'قُدّمت إلى وزارة التجارة والصناعة مع تقرير مدقق الحسابات.',
      label: both(
        'Audited financial statements to MOCI',
        'البيانات المالية المدققة لوزارة التجارة',
      ),
    });
  });
}
