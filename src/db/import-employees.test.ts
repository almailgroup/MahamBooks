import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { setupCompany } from './records';
import { createEmployee, saveEmployee } from './people';
import { createLeaveRecord } from './payroll';
import { importEmployees, loadImportContext, planImport, type ImportOptions } from './import';
import { employeeNumberKey, readBloodGroup, readGender, readPhone } from './import-employees';
import type { Company, Employee } from './types';
import {
  arabicNameFromFileName,
  guessColumns,
  IMPORT_COLUMNS,
  missingColumns,
  TEMPLATE_ROWS,
} from '@/features/company/import-columns';
import { detectDateFormats } from '@/lib/banking/statement';
import { readXlsx } from '@/lib/xlsx';
import { isStatelessText, nationalityCode } from '@/lib/hr/nationalities';
import { arabicJobTitle, englishJobTitle } from '@/lib/hr/job-titles';
import { employeeLeaveBalance } from '@/lib/hr/leave';
import { findBank, isValidCardNumber } from '@/lib/kuwait';
import { maskNumber } from '@/lib/format';
import { fakeCardNumber, fakeCivilId, zohoEmployees, zohoWorkbook } from '@/test/workbook';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const OPTIONS: ImportOptions = {
  contactType: 'customer',
  documentType: 'invoice',
  asOf: '2026-09-30',
  dateFormat: 'dd/MM/yyyy',
  fileName: 'Employee_View.xlsx',
  today: '2026-10-05',
};

const company = () => setupCompany({ name: 'Almail Security' });

async function zohoRows(employees = zohoEmployees()) {
  return readXlsx(zohoWorkbook(employees));
}

async function plan(c: Company, rows: string[][], options: Partial<ImportOptions> = {}) {
  const mapping = guessColumns('employees', rows[0], rows);
  return planImport(
    'employees',
    rows,
    mapping,
    { ...OPTIONS, ...options },
    await loadImportContext(c.id),
  );
}

/** The planned employee on a line of the file. */
function on(result: Awaited<ReturnType<typeof plan>>, line: number): Employee {
  const row = result.rows.find((r) => r.line === line)!;
  if (row.record?.kind !== 'employees') throw new Error(`line ${line} is not ready`);
  return row.record.value.employee;
}

/** The notes on a line, without the direction marks around values from the file. */
const notesOn = (result: Awaited<ReturnType<typeof plan>>, line: number) =>
  result.rows
    .find((r) => r.line === line)!
    .issues.map((i) => i.text.replace(/[\u2066-\u2069]/g, ''));

describe('employee columns', () => {
  it('match a Zoho People export and find the Arabic names in the file names', async () => {
    const rows = await zohoRows();
    const mapping = guessColumns('employees', rows[0], rows);
    expect(mapping).toMatchObject({
      number: 1,
      name: null,
      firstName: 2,
      department: 4,
      jobTitle: 5,
      hireDate: 6,
      birthDate: 8,
      gender: 10,
      nationality: 11,
      bloodGroup: 12,
      passportNumber: 13,
      passportExpiry: 14,
      accountNumber: 15,
      phone: 16,
      civilId: 17,
      civilIdExpiry: 18,
      drivingLicenceExpiry: 19,
      residencyExpiry: 20,
      nameArFile: 21,
      nameAr: null,
    });
    // ZOHO_LINK_ID, Photo, Current Experience, Age and Location 2 are left alone.
    const used = Object.values(mapping).filter((v) => v !== null);
    for (const ignored of [0, 3, 7, 9, 22]) expect(used).not.toContain(ignored);
    expect(missingColumns('employees', mapping)).toEqual([]);
  });

  it('match Arabic and common English headers', () => {
    expect(
      guessColumns('employees', [
        'الرقم الوظيفي',
        'الاسم',
        'الاسم بالعربي',
        'الجنسية',
        'الرقم المدني',
        'تاريخ انتهاء الإقامة',
        'المسمى الوظيفي',
        'القسم',
        'تاريخ التعيين',
        'الراتب الأساسي',
        'الهاتف',
        'البريد الإلكتروني',
        'الجنس',
        'تاريخ الميلاد',
      ]),
    ).toMatchObject({
      number: 0,
      name: 1,
      nameAr: 2,
      nationality: 3,
      civilId: 4,
      residencyExpiry: 5,
      jobTitle: 6,
      department: 7,
      hireDate: 8,
      basicSalary: 9,
      phone: 10,
      email: 11,
      gender: 12,
      birthDate: 13,
    });
    expect(
      guessColumns('employees', [
        'Employee No',
        'First Name',
        'Last Name',
        'Passport No',
        'Residency Expiry',
        'Work Permit',
        'Joining Date',
        'Basic Salary',
        'IBAN',
        'Bank',
        'Mobile',
        'Email',
        'Job Title',
      ]),
    ).toMatchObject({
      number: 0,
      firstName: 1,
      lastName: 2,
      passportNumber: 3,
      residencyExpiry: 4,
      workPermitNumber: 5,
      hireDate: 6,
      basicSalary: 7,
      iban: 8,
      bank: 9,
      phone: 10,
      email: 11,
      jobTitle: 12,
    });
    // A name or an employee number is needed.
    expect(
      missingColumns('employees', guessColumns('employees', ['Department'])).map((c) => c.key),
    ).toEqual(['name']);
  });

  it('find a column of file names with Arabic names whatever it is called, unless there is an Arabic name column', () => {
    const rows = [
      ['Emp No', 'Name', 'Scans', 'Remarks'],
      ['7', 'Ali Test', 'علي تجربة 7.pdf', 'none'],
      ['8', 'Omar Test', 'عمر تجربة 8.jpeg', ''],
    ];
    expect(guessColumns('employees', rows[0], rows)).toMatchObject({ nameArFile: 2, notes: 3 });
    const withArabic = [['Emp No', 'Name', 'Arabic name', 'Docs'], ...rows.slice(1)];
    expect(guessColumns('employees', withArabic[0], withArabic)).toMatchObject({
      nameAr: 2,
      nameArFile: null,
    });
    // A "Docs" column without Arabic names is not used for them.
    const english = [
      ['Emp No', 'Name', 'Docs'],
      ['7', 'Ali Test', 'contract.pdf'],
    ];
    expect(guessColumns('employees', english[0], english).nameArFile).toBeNull();
  });
});

describe('clean-up', () => {
  it('reads Arabic names from document file names', () => {
    expect(arabicNameFromFileName('موظف  تجريبي واحد   424.pdf')).toEqual({
      name: 'موظف تجريبي واحد',
      number: '424',
    });
    expect(arabicNameFromFileName('موظف تجريبي٤٢٤.PDF')).toEqual({
      name: 'موظف تجريبي',
      number: '424',
    });
    expect(arabicNameFromFileName('موظف تجريبي 424 (2).pdf')?.number).toBe('424');
    expect(arabicNameFromFileName('موظف تجريبي.pdf')).toEqual({
      name: 'موظف تجريبي',
      number: null,
    });
    expect(arabicNameFromFileName('WhatsApp Image 2023-05-12 at 10.20.30.jpeg')).toBeNull();
    expect(arabicNameFromFileName('passport.pdf')).toBeNull();
  });

  it('reads nationalities in English and Arabic', () => {
    const cases: [string, string | null][] = [
      ['EGYPT', 'EG'],
      ['Egyptian', 'EG'],
      ['مصري', 'EG'],
      ['مصرية', 'EG'],
      ['المصرية', 'EG'],
      ['مصر', 'EG'],
      ['NEPAL', 'NP'],
      ['Nepalese', 'NP'],
      ['Nepali', 'NP'],
      ['INDIA', 'IN'],
      ['Indian', 'IN'],
      ['الهند', 'IN'],
      ['Filipino', 'PH'],
      ['Pakistani', 'PK'],
      ['Sri Lankan', 'LK'],
      ['Bangladeshi', 'BD'],
      ['BANGLADESH', 'BD'],
      ['Syrian', 'SY'],
      ['Jordanian', 'JO'],
      ['Lebanese', 'LB'],
      ['KUWAIT', 'KW'],
      ['Kuwaiti', 'KW'],
      ['كويتي', 'KW'],
      ['UGANDA', 'UG'],
      ['CHAD', 'TD'],
      ['NIGERIA', 'NG'],
      ['YEMEN', 'YE'],
      ['IRAN', 'IR'],
      ['Saudi', 'SA'],
      ['Emirati', 'AE'],
      ['eg', 'EG'],
      ['IND', 'IN'],
      ['Nationality: Egyptian', 'EG'],
      ['Bedoon', null],
      ['Non-Kuwaiti', null],
      ['غير محدد الجنسية', null],
      ['ATLANTIS', null],
      ['', null],
    ];
    for (const [text, code] of cases) expect(nationalityCode(text), text).toBe(code);
  });

  it('fills in Arabic job titles', () => {
    expect(arabicJobTitle('Security Guard')).toBe('حارس أمن');
    expect(arabicJobTitle('SECURITY  GUARD')).toBe('حارس أمن');
    expect(arabicJobTitle('Cleaner')).toBe('عامل نظافة');
    expect(arabicJobTitle('Bus Driver')).toBe('سائق حافلة');
    expect(arabicJobTitle('Mandoop')).toBe('مندوب');
    expect(arabicJobTitle('HR Officer')).toBe('مسؤول موارد بشرية');
    expect(arabicJobTitle('IT')).toBe('تقنية المعلومات');
    expect(arabicJobTitle('CEO')).toBe('الرئيس التنفيذي');
    expect(arabicJobTitle('Welder')).toBe('لحّام');
    expect(arabicJobTitle('Astronaut')).toBe('');
    expect(englishJobTitle('محاسب')).toBe('Accountant');
  });

  it('reads phones, genders, blood groups, banks and cards', () => {
    expect(readPhone('965-55123456')).toEqual({ phone: '+965 5512 3456', kind: 'kuwaiti' });
    expect(readPhone('55123456')).toEqual({ phone: '+965 5512 3456', kind: 'kuwaiti' });
    expect(readPhone('977-9812345678')).toEqual({
      phone: '+977 9812345678',
      kind: 'international',
    });
    expect(readPhone('235-66123456')).toEqual({ phone: '+235 66123456', kind: 'international' });
    expect(readPhone('+44 7700 900123')).toEqual({
      phone: '+44 7700900123',
      kind: 'international',
    });
    expect(readPhone('965-12345678')).toEqual({ phone: '965-12345678', kind: 'kept' });
    expect(readPhone('')).toBeNull();
    expect(readGender('Male')).toBe('male');
    expect(readGender('F')).toBe('female');
    expect(readGender('أنثى')).toBe('female');
    expect(readGender('ذكر')).toBe('male');
    expect(readGender('other')).toBeNull();
    expect(readBloodGroup('A +ve')).toBe('A+');
    expect(readBloodGroup('o neg')).toBe('O-');
    expect(readBloodGroup('AB')).toBe('AB');
    expect(findBank('NBK')?.code).toBe('NBOK');
    expect(findBank('بيت التمويل الكويتي')?.code).toBe('KFHO');
    expect(findBank('Boubyan Bank')?.code).toBe('BBYN');
    expect(findBank('Some Bank')).toBeUndefined();
    expect(isValidCardNumber(fakeCardNumber('5407', 1))).toBe(true);
    expect(isValidCardNumber('5407000000000001')).toBe(false);
    expect(maskNumber('5407123412341234')).toBe('•••• 1234');
    expect(maskNumber('123')).toBe('••••');
    expect(employeeNumberKey('000424')).toBe('424');
    expect(employeeNumberKey('424')).toBe('424');
    expect(employeeNumberKey('EMP-0424')).toBe('emp-0424');
  });
});

describe('planning an employee file', () => {
  it('imports every row with a name or a number and notes what to check', async () => {
    const c = await company();
    const result = await plan(c, await zohoRows());
    expect(result.rows.map((r) => r.status)).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
      'skipped',
      'ready',
      'ready',
      'ready',
    ]);
    expect(result.errors).toBe(0);
    expect(result.employees).toMatchObject({
      add: 7,
      update: 0,
      existing: 0,
      empty: 1,
      arabicNamesFromFiles: 3,
      arabicJobTitles: 6,
      nationalities: { mapped: 6, unknown: 1, missing: 0 },
      phones: { kuwaiti: 2, international: 2, kept: 0 },
      accountNumbers: 1,
      ibans: 1,
      drivingLicences: 2,
      civilIdsToCheck: 1,
      expired: 1,
      expiring: 4,
      futureHireDates: 1,
      missingHireDates: 1,
      documentExpiry: { total: 4, sameAsCivilId: 3 },
      salaries: false,
    });

    // Line 2: a Zoho row read and cleaned up.
    const one = on(result, 2);
    expect(one).toMatchObject({
      number: '000101',
      name: 'TEST GUARD ONE',
      nameAr: 'موظف تجريبي واحد',
      nationality: 'EG',
      category: 'expat',
      gender: 'male',
      birthDate: '1990-05-01',
      hireDate: '2022-01-10',
      department: 'Guarding Services',
      jobTitle: 'Security Guard',
      jobTitleAr: 'حارس أمن',
      passportNumber: 'A1234567X',
      passportExpiry: '2030-01-01',
      accountNumber: fakeCardNumber('5407', 101),
      iban: '',
      phone: '+965 5512 3456',
      civilId: fakeCivilId('1990-05-01', 101),
      civilIdExpiry: '2027-01-15',
      residencyExpiry: '2027-01-15',
      basicSalary: 0,
      status: 'active',
      notes: 'Blood group: A+',
    });
    const record = result.rows[0].record;
    expect(record?.kind === 'employees' && record.value.drivingLicence).toEqual({
      number: '',
      expiryDate: '2027-06-30',
    });
    expect(notesOn(result, 2)).toEqual([]);

    // Line 3: Excel's empty dates, a Nepali number, expired and expiring papers.
    expect(on(result, 3)).toMatchObject({
      name: 'Sample Cleaner Two',
      nameAr: 'موظفة تجريبية اثنان',
      gender: 'female',
      birthDate: null,
      passportExpiry: null,
      phone: '+977 9812345678',
      nationality: 'NP',
      residencyExpiry: '2026-10-20',
    });
    expect(notesOn(result, 3)).toEqual([
      'Civil ID expired on 2026-09-01.',
      'Residency expires on 2026-10-20.',
    ]);

    // Line 4: things to check, imported all the same.
    expect(on(result, 4)).toMatchObject({
      nameAr: '',
      nationality: 'IN',
      jobTitleAr: 'سائق حافلة',
      phone: '+235 66123456',
      hireDate: '2027-02-01',
    });
    expect(notesOn(result, 4)).toEqual([
      'The Arabic name was not taken from “موظف تجريبي ثلاثة 101.pdf”: it has another employee number.',
      'This does not look like a valid Civil ID. Check the 12 digits.',
      'The hire date is in the future (2027-02-01).',
      'Driving licence expires on 2026-11-01.',
      'Civil ID and Residency expire on 2026-11-15.',
    ]);

    // Line 5: a Kuwaiti paid by IBAN; no residency.
    expect(on(result, 5)).toMatchObject({
      nationality: 'KW',
      category: 'kuwaiti',
      iban: 'KW81CBKU0000000000001234560101',
      accountNumber: '',
      residencyExpiry: null,
      phone: '+965 9988 7766',
      jobTitleAr: 'محاسب',
    });

    // Line 6: nothing to tell who it is.
    expect(notesOn(result, 6)).toEqual(['No name or employee number.']);

    // Line 7: the Arabic name from the file name is the only name.
    expect(on(result, 7)).toMatchObject({
      number: '106',
      name: 'موظف تجريبي ستة',
      nameAr: 'موظف تجريبي ستة',
      nationality: 'BD',
      jobTitleAr: 'مندوب',
    });

    // Line 8: an unknown nationality and no joining date.
    expect(on(result, 8)).toMatchObject({ nationality: '', category: 'expat', hireDate: null });
    expect(notesOn(result, 8)).toEqual([
      'Nationality “ATLANTIS” not recognised.',
      'No hire date in the file.',
    ]);

    // Line 9: the same employee number again gets the next free number.
    expect(on(result, 9)).toMatchObject({ number: '', nationality: 'PH' });
    expect(notesOn(result, 9)).toEqual([
      'Employee number 000101 is also on row 2: this one gets the next free number.',
    ]);
    expect(result.employees!.notes).toBe(10);
  });

  it('reads short years of birth in the past and leaves impossible dates of birth out', async () => {
    const c = await company();
    const result = await plan(c, [
      ['Employee Number', 'Name', 'Date of Birth', 'Nationality'],
      ['1', 'Test Guard One', '02/07/94', 'Indian'],
      ['2', 'Test Guard Two', '15/03/05', 'Indian'],
      ['3', 'Test Guard Three', '02/07/2094', 'Indian'],
      ['4', 'Test Guard Four', '02/07/1894', 'Indian'],
    ]);
    // 2094 would be in the future: 1994. 2005 is not.
    expect(on(result, 2).birthDate).toBe('1994-07-02');
    expect(notesOn(result, 2)).toEqual([]);
    expect(on(result, 3).birthDate).toBe('2005-03-15');
    expect(on(result, 4).birthDate).toBeNull();
    expect(notesOn(result, 4)).toEqual([
      'Date of birth “02/07/2094” is in the future, so it was left empty.',
    ]);
    expect(on(result, 5).birthDate).toBeNull();
    expect(notesOn(result, 5)).toEqual([
      'Date of birth “02/07/1894” is before 1900, so it was left empty.',
    ]);
  });

  it('starts the leave of new employees from the import, not confirmed', async () => {
    const c = await company();
    const result = await plan(c, [
      ['Employee Number', 'Name', 'Joining Date'],
      ['1', 'Test Guard One', '01/01/2016'],
    ]);
    expect(on(result, 2)).toMatchObject({
      hireDate: '2016-01-01',
      leaveOpening: { date: '2026-10-05', days: 0, confirmed: false },
    });
  });

  it('brings forward the leave balance the file gives, confirmed, on the import date', async () => {
    const c = await company();
    const result = await plan(c, [
      ['Employee Number', 'Name', 'Joining Date', 'Annual Leave Balance'],
      ['1', 'Test Guard One', '01/01/2016', '22.5'],
      ['2', 'Test Guard Two', '01/01/2017', ''],
      ['3', 'Test Guard Three', '01/01/2018', 'many'],
      ['4', 'Test Guard Four', '01/01/2019', '-3'],
    ]);
    expect(result.employees).toMatchObject({ leaveBalanceColumn: true, leaveBalances: 1 });
    expect(on(result, 2).leaveOpening).toEqual({ date: '2026-10-05', days: 22.5, confirmed: true });
    // Nothing in the file: 0 days, to be confirmed, as without the column.
    expect(on(result, 3).leaveOpening).toEqual({ date: '2026-10-05', days: 0, confirmed: false });
    expect(on(result, 4).leaveOpening).toEqual({ date: '2026-10-05', days: 0, confirmed: false });
    expect(notesOn(result, 4)).toEqual(['Leave balance: “many” is not a number of days.']);
    expect(notesOn(result, 5)).toEqual(['Leave balance: “-3” is not a number of days.']);

    // The column goes by other names, in English and Arabic.
    const column = (header: string) =>
      guessColumns('employees', ['Emp No', 'Name', header]).leaveBalance;
    expect(column('Leave Balance')).toBe(2);
    expect(column('Leave days')).toBe(2);
    expect(column('Balance')).toBe(2);
    expect(column('Annual leave balance (days)')).toBe(2);
    expect(column('رصيد الإجازات')).toBe(2);
    expect(column('الرصيد')).toBe(2);
    // "Balance" and "Leave days" are looked for only as the whole name.
    expect(column('Loan balance')).toBeNull();
    expect(column('Leave days taken')).toBeNull();
  });

  it('reads placeholders such as "-" and "N/A" as empty', async () => {
    const c = await company();
    const result = await plan(c, [
      ['Employee Number', 'Name', 'Mobile', 'Passport No', 'Nationality'],
      ['1', 'Ali Test', '-', 'N/A', 'Indian'],
    ]);
    expect(on(result, 2)).toMatchObject({ phone: '', passportNumber: '', nationality: 'IN' });
    expect(notesOn(result, 2)).toEqual([]);
  });

  it('marks Bedoon, بدون and غير محدد الجنسية as stateless, with their review card', async () => {
    expect(
      ['Bedoon', 'Bidoon', 'Stateless', 'بدون', 'غير محدد الجنسية', 'غير محددي الجنسية'].map(
        isStatelessText,
      ),
    ).toEqual([true, true, true, true, true, true]);
    expect(['Non-Kuwaiti', 'غير كويتي', 'Indian', ''].map(isStatelessText)).toEqual([
      false,
      false,
      false,
      false,
    ]);

    const c = await company();
    const rows = [
      [
        'Employee Number',
        'Name',
        'Nationality',
        'Residency Number',
        'Residency Expiry',
        'Review Card Number',
        'Review Card Expiry',
      ],
      ['1', 'Saad Test', 'Bedoon', '18/1', '01/01/2027', 'RC-100', '30/11/2026'],
      ['2', 'Nasser Test', 'بدون', '', '', '', ''],
      ['3', 'Fahad Test', 'غير محدد الجنسية', '', '', 'RC-300', ''],
      ['4', 'Omar Test', 'Indian', '18/4', '01/01/2027', 'RC-400', '30/11/2026'],
    ];
    const result = await plan(c, rows);
    expect(result.employees?.nationalities).toMatchObject({ stateless: 3, unknown: 0 });
    expect(on(result, 2)).toMatchObject({
      category: 'expat',
      stateless: true,
      nationality: '',
      centralCardNumber: 'RC-100',
      centralCardExpiry: '2026-11-30',
      // No residency for stateless staff.
      residencyNumber: '',
      residencyExpiry: null,
    });
    expect(notesOn(result, 2)).toEqual(['Central Agency review card expires on 2026-11-30.']);
    expect(on(result, 3)).toMatchObject({ stateless: true, nationality: '' });
    expect(notesOn(result, 3)).toEqual([]);
    expect(on(result, 4)).toMatchObject({ stateless: true, centralCardNumber: 'RC-300' });
    // A country: an expatriate with a residency, and no card.
    const expat = on(result, 5);
    expect(expat).toMatchObject({ category: 'expat', residencyNumber: '18/4' });
    expect(expat.stateless).toBeUndefined();
    expect(expat.centralCardNumber).toBeUndefined();

    // Saved: the flag stays; given a country later, they are no longer stateless.
    await importEmployees(c.id, rows, guessColumns('employees', rows[0], rows), OPTIONS);
    const saved = async (number: string) =>
      (await db.employees.where('companyId').equals(c.id).toArray()).find(
        (e) => e.number === number,
      )!;
    expect(await saved('1')).toMatchObject({ stateless: true, centralCardNumber: 'RC-100' });
    const update = [
      ['Employee Number', 'Name', 'Nationality'],
      ['1', 'Saad Test', 'Kuwaiti'],
    ];
    await importEmployees(c.id, update, guessColumns('employees', update[0], update), {
      ...OPTIONS,
      updateExisting: true,
    });
    const kuwaiti = await saved('1');
    expect(kuwaiti).toMatchObject({ category: 'kuwaiti', nationality: 'KW' });
    expect(kuwaiti.stateless).toBeUndefined();
  });

  it('notes duplicate Civil IDs in the file and rows without a name', async () => {
    const c = await company();
    const civilId = fakeCivilId('1991-01-01', 5);
    const result = await plan(c, [
      ['Employee Number', 'Name', 'Civil ID', 'Nationality'],
      ['1', 'Ali Test', civilId, 'Indian'],
      ['2', 'Omar Test', civilId, 'Indian'],
      ['3', '', '', ''],
    ]);
    expect(result.rows.map((r) => r.status)).toEqual(['ready', 'ready', 'ready']);
    expect(notesOn(result, 3)).toEqual(['The same Civil ID is also on row 2.']);
    expect(on(result, 4).name).toBe('Employee 3');
    expect(notesOn(result, 4)).toEqual(['No name in the file.', 'No nationality in the file.']);
  });
});

describe('the employees template', () => {
  it('imports as it is downloaded', async () => {
    const c = await company();
    const rows = TEMPLATE_ROWS.employees;
    const columns = IMPORT_COLUMNS.employees.filter((col) => rows.some((r) => r[col.key]));
    const file = [
      columns.map((col) => col.label),
      ...rows.map((r) => columns.map((col) => r[col.key] ?? '')),
    ];
    const mapping = guessColumns('employees', file[0], file);
    for (const col of columns) expect(mapping[col.key], col.key).toBe(columns.indexOf(col));
    const dates = file
      .slice(1)
      .flatMap((r) => [r[columns.findIndex((col) => col.key === 'hireDate')]]);
    expect(detectDateFormats(dates)[0]).toBe('dd/MM/yyyy');
    const result = await plan(c, file);
    expect(result.rows.map((r) => r.status)).toEqual(['ready', 'ready']);
    expect(on(result, 2)).toMatchObject({
      number: '000101',
      nationality: 'KW',
      category: 'kuwaiti',
      basicSalary: 1250,
      hireDate: '2022-02-01',
      iban: 'KW81CBKU0000000000001234560101',
    });
    expect(on(result, 3)).toMatchObject({
      nationality: 'NP',
      residencyExpiry: '2027-06-15',
      accountNumber: '5407000000000008',
      phone: '+977 9800000000',
    });
    expect(result.rows.flatMap((r) => r.issues)).toEqual([]);
  });
});

describe('importing employees', () => {
  it('adds them in batches with one activity entry and the driving licences', async () => {
    const c = await company();
    const rows = await zohoRows();
    const mapping = guessColumns('employees', rows[0], rows);
    const steps: number[] = [];
    const result = await importEmployees(c.id, rows, mapping, OPTIONS, (p) => steps.push(p.done));
    expect(result).toMatchObject({
      kind: 'employees',
      added: 7,
      updated: 0,
      skipped: 1,
      documents: 2,
    });
    expect(steps).toEqual([0, 7]);

    const employees = await db.employees.where('companyId').equals(c.id).toArray();
    expect(employees).toHaveLength(7);
    expect(employees.map((e) => e.number).sort()).toEqual([
      '000101',
      '000102',
      '000103',
      '000104',
      '000107',
      '106',
      'EMP-001',
    ]);
    const licences = await db.complianceDocuments.where('companyId').equals(c.id).toArray();
    expect(licences.map((d) => [d.type, d.ownerType, d.expiryDate]).sort()).toEqual([
      ['driving_licence', 'employee', '2026-11-01'],
      ['driving_licence', 'employee', '2027-06-30'],
    ]);
    const guard = employees.find((e) => e.number === '000101')!;
    expect(licences.some((d) => d.employeeId === guard.id)).toBe(true);

    const activities = await db.activities.where('companyId').equals(c.id).toArray();
    const people = activities.filter((a) => a.entity === 'employee' || a.entity === 'compliance');
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      action: 'imported',
      messageKey: '{count} employees imported',
      messageVars: { count: 7, updated: 0 },
      message: '7 employees imported',
    });
  });

  it('skips employees already here, or updates them when asked', async () => {
    const c = await company();
    // Already in the company: by employee number without the zeros, and by Civil ID.
    const kept = await saveEmployee(
      createEmployee(c.id, {
        number: '101',
        name: 'Guard Entered By Hand',
        basicSalary: 175,
        nationality: 'EG',
        category: 'expat',
      }),
    );
    const byCivilId = await saveEmployee(
      createEmployee(c.id, {
        number: 'K-4',
        name: 'Kuwaiti Entered By Hand',
        civilId: fakeCivilId('1985-03-14', 104),
      }),
    );
    const rows = await zohoRows();
    const skipped = await plan(c, rows);
    expect(skipped.employees).toMatchObject({ add: 5, update: 0, existing: 2 });
    expect(notesOn(skipped, 2)).toEqual([
      'Guard Entered By Hand (101) is already in your employees.',
    ]);

    const mapping = guessColumns('employees', rows[0], rows);
    const updating = { ...OPTIONS, updateExisting: true };
    const preview = await plan(c, rows, { updateExisting: true });
    expect(preview.employees).toMatchObject({ add: 5, update: 2, existing: 2 });
    const result = await importEmployees(c.id, rows, mapping, updating);
    expect(result).toMatchObject({ added: 5, updated: 2 });

    const guard = (await db.employees.get(kept.id))!;
    // The file's details, the employee's own number and salary.
    expect(guard).toMatchObject({
      number: '101',
      name: 'TEST GUARD ONE',
      nameAr: 'موظف تجريبي واحد',
      basicSalary: 175,
      accountNumber: fakeCardNumber('5407', 101),
      phone: '+965 5512 3456',
    });
    const kuwaiti = (await db.employees.get(byCivilId.id))!;
    expect(kuwaiti).toMatchObject({
      number: 'K-4',
      name: 'Kuwaiti Staff Four',
      category: 'kuwaiti',
    });
    expect(await db.employees.where('companyId').equals(c.id).count()).toBe(7);
    const activity = (await db.activities.where('companyId').equals(c.id).toArray()).find(
      (a) => a.action === 'imported',
    );
    expect(activity?.message).toBe('5 employees imported and 2 updated');

    // Importing the same file again adds nobody twice.
    const again = await plan(c, rows);
    expect(again.employees).toMatchObject({ add: 1, existing: 6 });
  });

  it('gives updated employees the leave balance in the file: it replaces the one they had', async () => {
    const c = await company();
    const hand = await saveEmployee(
      createEmployee(c.id, { number: '7', name: 'Guard Entered By Hand', hireDate: '2015-02-01' }),
    );
    await db.employees.update(hand.id, {
      leaveOpening: { date: '2026-09-01', days: 4, confirmed: true },
    });
    const later = createLeaveRecord(c.id, hand.id, {
      type: 'annual',
      kind: 'opening',
      start: '2026-10-05',
      end: '2026-10-05',
      days: 9,
    });
    await db.leaveRecords.add(later);
    const blank = await saveEmployee(
      createEmployee(c.id, {
        number: '8',
        name: 'Guard Without A Balance',
        hireDate: '2016-02-01',
      }),
    );
    const rows = [
      ['Employee Number', 'Name', 'Leave Balance'],
      ['7', 'Guard Entered By Hand', '15'],
      ['8', 'Guard Without A Balance', ''],
      ['9', 'New Guard', '6.25'],
    ];
    const mapping = guessColumns('employees', rows[0], rows);

    // Not updating: the employees here keep what they have.
    await importEmployees(c.id, rows, mapping, OPTIONS);
    expect((await db.employees.get(hand.id))!.leaveOpening).toEqual({
      date: '2026-09-01',
      days: 4,
      confirmed: true,
    });
    const added = (await db.employees.where('companyId').equals(c.id).toArray()).find(
      (e) => e.number === '9',
    )!;
    expect(added.leaveOpening).toEqual({ date: '2026-10-05', days: 6.25, confirmed: true });

    // Updating: the file wins, even over an opening leave record dated after its date.
    await importEmployees(c.id, rows, mapping, { ...OPTIONS, updateExisting: true });
    const updated = (await db.employees.get(hand.id))!;
    expect(updated.leaveOpening).toEqual({ date: '2026-10-05', days: 15, confirmed: true });
    expect((await db.leaveRecords.get(later.id))!.status).toBe('cancelled');
    const records = await db.leaveRecords.where('companyId').equals(c.id).toArray();
    expect(employeeLeaveBalance(updated, records, '2026-10-05')).toMatchObject({
      from: '2026-10-05',
      balance: 15,
    });
    // An empty cell leaves the balance as it was.
    expect((await db.employees.get(blank.id))!.leaveOpening ?? null).toBeNull();
  });

  it('is not open to staff or viewers', async () => {
    const c = await company();
    await db.syncState.put({
      companyId: c.id,
      userId: 'u1',
      role: 'staff',
      status: 'ready',
      cursor: 0,
      name: c.name,
      linkedAt: '2026-10-01T00:00:00Z',
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
    });
    const rows = await zohoRows();
    const mapping = guessColumns('employees', rows[0], rows);
    await expect(importEmployees(c.id, rows, mapping, OPTIONS)).rejects.toThrow(
      'Only owners, admins and accountants can import employees.',
    );
    expect(await db.employees.count()).toBe(0);
  });

  it('keeps the new fields when employees are saved', async () => {
    const c = await company();
    const saved = await saveEmployee(
      createEmployee(c.id, {
        name: 'Card Holder',
        accountNumber: ' 5407 1234-5678 9012 ',
        gender: 'female',
        birthDate: '',
      }),
    );
    expect(saved).toMatchObject({
      accountNumber: '5407123456789012',
      gender: 'female',
      birthDate: null,
    });
  });
});
