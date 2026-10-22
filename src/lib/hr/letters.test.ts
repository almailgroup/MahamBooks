import { describe, expect, it } from 'vitest';
import {
  LETTER_FIELDS,
  fieldsIn,
  fillLetter,
  letterPay,
  letterValues,
  serviceLength,
  serviceMonths,
  unknownFields,
  usesPrivateFields,
  type LetterContext,
} from './letters';
import { DEFAULT_LETTER_KINDS } from './letters';
import { DEFAULT_WORDING, PREVIEW_EMPLOYEE, defaultTemplateKind } from './letter-templates';

/**
 * The merge of employee letters (#19): every field in both languages, with
 * Western digits, amounts in KWD to three decimals and in words, and the
 * private fields masked unless allowed. Made-up people only.
 */

const company: LetterContext['company'] = {
  name: 'Made-up Trading Co.',
  nameAr: 'شركة التجارة التجريبية',
  currency: 'KWD',
  currencyDisplay: 'local',
  dateFormat: 'dd/MM/yyyy',
};

const employee: LetterContext['employee'] = {
  ...PREVIEW_EMPLOYEE,
  name: 'Made-up Person',
  nameAr: 'شخص تجريبي',
  number: 'EMP-042',
  gender: 'female',
  jobTitle: 'Accountant',
  jobTitleAr: 'محاسبة',
  department: 'Finance',
  nationality: 'KW',
  hireDate: '2023-08-15',
  basicSalary: 1234.5,
  allowances: [
    { id: 'a', name: 'Housing', nameAr: 'سكن', amount: 150.25, countsForEos: true },
    { id: 'b', name: 'Transport', nameAr: 'مواصلات', amount: 40, countsForEos: false },
  ],
  civilId: '290010112345',
  passportNumber: 'K1234567',
  bank: 'NBOK',
  iban: 'KW00NBOK0000000000000000000001',
  accountNumber: '2001234567',
};

const context = (overrides: Partial<LetterContext> = {}): LetterContext => ({
  employee,
  company,
  departments: [{ id: 'd1', name: 'Finance', nameAr: 'المالية' }],
  letter: { number: 'HR-2026-0007', date: '2026-10-05', addressee: '', purpose: '' },
  privateFields: false,
  ...overrides,
});

describe('letterValues', () => {
  it('fills every field in English, with Western digits and KWD to three decimals', () => {
    expect(letterValues(context(), 'en')).toEqual({
      'employee.name': 'Made-up Person',
      'employee.title': 'Ms.',
      'employee.number': 'EMP-042',
      'employee.jobTitle': 'Accountant',
      'employee.department': 'Finance',
      'employee.nationality': 'Kuwait',
      'employee.hireDate': '15/08/2023',
      'employee.leavingDate': '',
      'service.length': '3 years and 1 month',
      'service.end': '05/10/2026',
      'salary.basic': 'KD\u00a01,234.500',
      'salary.allowances': 'KD\u00a0190.250',
      'salary.total': 'KD\u00a01,424.750',
      'salary.totalWords':
        'One Thousand Four Hundred Twenty-Four Kuwaiti Dinars and Seven Hundred Fifty Fils Only',
      'letter.number': 'HR-2026-0007',
      'letter.date': '05/10/2026',
      'letter.addressee': 'To whom it may concern',
      'letter.purpose': '',
      'company.name': 'Made-up Trading Co.',
      'employee.civilId': '•••• 2345',
      'employee.passportNumber': '•••• 4567',
      'employee.bank': 'National Bank of Kuwait',
      'employee.iban': '•••• 0001',
      'employee.accountNumber': '•••• 4567',
    });
  });

  it('fills every field in Arabic, still with Western digits', () => {
    const values = letterValues(context(), 'ar');
    expect(values).toMatchObject({
      'employee.name': 'شخص تجريبي',
      'employee.title': 'السيدة',
      'employee.jobTitle': 'محاسبة',
      'employee.department': 'المالية',
      'employee.nationality': 'الكويت',
      'employee.hireDate': '15/08/2023',
      'service.length': '3 سنوات وشهر واحد',
      'salary.basic': '1,234.500\u00a0د.ك',
      'salary.total': '1,424.750\u00a0د.ك',
      'letter.addressee': 'إلى من يهمه الأمر',
      'company.name': 'شركة التجارة التجريبية',
      'employee.bank': 'بنك الكويت الوطني',
    });
    expect(values['salary.totalWords']).toBe(
      'فقط ألف وأربعمائة وأربعة وعشرون دينارًا كويتيًا وسبعمائة وخمسون فلسًا لا غير',
    );
    // No Arabic-Indic digits, and none of the marks Intl puts around them.
    for (const value of Object.values(values)) {
      expect(value).not.toMatch(/[٠-٩‎‏؜]/);
    }
  });

  it('has a value for every field the editor offers', () => {
    const values = letterValues(context(), 'en');
    expect(LETTER_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(values).sort());
  });

  it('shows the Civil ID, passport and bank account only when allowed', () => {
    const shown = letterValues(context({ privateFields: true }), 'en');
    expect(shown['employee.civilId']).toBe('290010112345');
    expect(shown['employee.passportNumber']).toBe('K1234567');
    expect(shown['employee.iban']).toBe('KW00 NBOK 0000 0000 0000 0000 0000 01');
    expect(shown['employee.accountNumber']).toBe('2001234567');
  });

  it('counts service to the leaving date of someone who left, and the letter date otherwise', () => {
    const left = context({
      employee: { ...employee, status: 'left', leavingDate: '2026-02-14' },
    });
    expect(letterValues(left, 'en')['employee.leavingDate']).toBe('14/02/2026');
    expect(letterValues(left, 'en')['service.end']).toBe('14/02/2026');
    expect(letterValues(left, 'en')['service.length']).toBe('2 years and 6 months');
    // A leaving date kept on someone current is not shown.
    const current = context({ employee: { ...employee, leavingDate: '2026-02-14' } });
    expect(letterValues(current, 'en')['employee.leavingDate']).toBe('');
  });

  it('uses the addressee and purpose typed in', () => {
    const typed = context({
      letter: {
        number: '',
        date: '2026-10-05',
        addressee: 'Made-up Bank',
        purpose: 'a personal loan',
      },
    });
    expect(letterValues(typed, 'ar')['letter.addressee']).toBe('Made-up Bank');
    expect(letterValues(typed, 'en')['letter.purpose']).toBe('a personal loan');
    expect(letterValues(typed, 'en')['letter.number']).toBe('');
  });

  it('adds the allowances to the basic salary to the currency’s decimals', () => {
    expect(letterPay(employee, 'KWD')).toEqual({
      basic: 1234.5,
      allowances: 190.25,
      total: 1424.75,
    });
    expect(letterPay({ ...employee, basicSalary: 0.1, allowances: [] }, 'KWD').total).toBe(0.1);
  });
});

describe('service length', () => {
  it('counts whole months, both days included', () => {
    expect(serviceMonths('2023-10-01', '2026-09-30')).toBe(36);
    expect(serviceMonths('2023-10-01', '2026-09-29')).toBe(35);
    expect(serviceMonths(null, '2026-09-30')).toBe(0);
    expect(serviceMonths('2026-10-01', '2026-09-30')).toBe(0);
  });

  it('reads well in both languages', () => {
    expect(serviceLength(0, 'en')).toBe('less than a month');
    expect(serviceLength(1, 'en')).toBe('1 month');
    expect(serviceLength(12, 'en')).toBe('1 year');
    expect(serviceLength(26, 'en')).toBe('2 years and 2 months');
    expect(serviceLength(0, 'ar')).toBe('أقل من شهر');
    expect(serviceLength(2, 'ar')).toBe('شهران');
    expect(serviceLength(12, 'ar')).toBe('سنة واحدة');
    expect(serviceLength(24 + 5, 'ar')).toBe('سنتان و5 أشهر');
    expect(serviceLength(11 * 12 + 11, 'ar')).toBe('11 سنة و11 شهراً');
  });
});

describe('fillLetter', () => {
  it('fills the fields it knows and leaves the others as written', () => {
    const values = letterValues(context(), 'en');
    expect(fillLetter('Dear {employee.name}, {nope.field} {plain}', values)).toBe(
      'Dear Made-up Person, {nope.field} {plain}',
    );
    expect(unknownFields('{employee.name} {nope.field} {employee.typo}')).toEqual([
      'nope.field',
      'employee.typo',
    ]);
    expect(fieldsIn('{a.b} {a.b} {c.d}')).toEqual(['a.b', 'c.d']);
  });

  it('tidies empty lines left by empty fields', () => {
    expect(fillLetter('A\n{letter.purpose}  \n\n\n\nB', { 'letter.purpose': '' })).toBe('A\n\nB');
  });

  it('tells a text that asks for private fields', () => {
    expect(usesPrivateFields('Civil ID: {employee.civilId}')).toBe(true);
    expect(usesPrivateFields('{employee.name}')).toBe(false);
  });
});

describe('the default wording', () => {
  it('uses only fields the merge knows, and no private ones', () => {
    for (const kind of Object.keys(DEFAULT_WORDING) as (keyof typeof DEFAULT_WORDING)[]) {
      const wording = DEFAULT_WORDING[kind];
      for (const text of [wording.bodyEn, wording.bodyAr, wording.subjectEn, wording.subjectAr]) {
        expect(unknownFields(text)).toEqual([]);
        expect(usesPrivateFields(text)).toBe(false);
      }
    }
  });

  it('starts with the five first letters, in both languages', () => {
    expect(DEFAULT_LETTER_KINDS).toEqual([
      'salary_certificate',
      'experience_certificate',
      'employment_certificate',
      'warning',
      'noc',
    ]);
    for (const kind of DEFAULT_LETTER_KINDS) {
      expect(DEFAULT_WORDING[kind].bodyAr).not.toBe('');
      expect(DEFAULT_WORDING[kind].bodyEn).not.toBe('');
    }
    expect(defaultTemplateKind('default:co-1:noc')).toBe('noc');
    expect(defaultTemplateKind('default:co-1:nonsense')).toBeNull();
    expect(defaultTemplateKind('tpl-1')).toBeNull();
  });

  it('fills a salary certificate with the employee’s data', () => {
    const values = letterValues(context(), 'en');
    expect(fillLetter(DEFAULT_WORDING.salary_certificate.bodyEn, values)).toBe(
      [
        'To whom it may concern',
        '',
        'This is to certify that the holder of this certificate is employed by Made-up Trading Co. as follows:',
        '',
        'Name: Made-up Person',
        'Nationality: Kuwait',
        'Job title: Accountant',
        'Department: Finance',
        'Date of joining: 15/08/2023',
        'Total monthly salary: KD\u00a01,424.750',
        '(One Thousand Four Hundred Twenty-Four Kuwaiti Dinars and Seven Hundred Fifty Fils Only)',
        '',
        'This certificate is issued at the employee’s request, without any liability on the company.',
      ].join('\n'),
    );
  });
});
