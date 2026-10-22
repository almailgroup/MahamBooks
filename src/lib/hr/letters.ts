import { addDays, differenceInMonths } from 'date-fns';
import type {
  Company,
  Department,
  Employee,
  ISODate,
  LetterKind,
  LetterLanguage,
  LetterTrigger,
} from '@/db/types';
import { msg } from '@/i18n';
import { localName } from '@/i18n/names';
import { lookup } from '@/lib/known';
import { isISODate, parseISODate } from '@/lib/dates';
import { formatDate, formatMoney, maskNumber } from '@/lib/format';
import { countryName } from '@/lib/geo';
import { bankFromIban, formatIban, KUWAIT_BANKS } from '@/lib/kuwait';
import { currencyPrecision, dec, round } from '@/lib/money';
import { amountInWords } from '@/lib/words';
import { departmentLabel } from './departments';

/**
 * Employee letters (#19 of docs/requirements-plan.md): the merge of a
 * template's text with the employee's record. Fields are written
 * `{employee.name}`, `{salary.total}`… and filled in the letter's language,
 * with Western digits and amounts in the company's currency to its decimals
 * (KWD to three) and in words. Template text is the company's own data, not
 * interface text: it is never translated. Emails keep `fillTemplate`.
 *
 * The Civil ID, passport number and bank account are private fields: they
 * are filled only when the template allows them and the person filling the
 * letter may issue it (the owner, an admin or an approver); otherwise they
 * show masked. Letters are printed, never emailed (D14).
 */

/** Every kind of letter, in the order they are offered. */
export const LETTER_KINDS: readonly LetterKind[] = [
  'salary_certificate',
  'experience_certificate',
  'employment_certificate',
  'warning',
  'noc',
  'salary_transfer',
  'custom',
];

/** The kinds the company starts with (the owner's choice of the first letters). */
export const DEFAULT_LETTER_KINDS: readonly LetterKind[] = [
  'salary_certificate',
  'experience_certificate',
  'employment_certificate',
  'warning',
  'noc',
];

export const LETTER_KIND_LABELS: Record<LetterKind, string> = {
  salary_certificate: msg('Salary certificate'),
  experience_certificate: msg('Experience certificate'),
  employment_certificate: msg('Employment certificate'),
  warning: msg('Warning letter'),
  noc: msg('No objection certificate'),
  salary_transfer: msg('Salary transfer letter'),
  custom: msg('Other letter'),
};

/** A kind this version doesn't know (made by a newer one) reads as a letter. */
export function letterKindLabel(kind: unknown): string {
  return lookup(LETTER_KIND_LABELS, kind, msg('Letter'));
}

export const LETTER_LANGUAGES: readonly LetterLanguage[] = ['ar', 'en', 'ar-en'];

export const LETTER_LANGUAGE_LABELS: Record<LetterLanguage, string> = {
  ar: msg('Arabic'),
  en: msg('English'),
  'ar-en': msg('Arabic and English'),
};

export function letterLanguageLabel(language: unknown): string {
  return lookup(LETTER_LANGUAGE_LABELS, language, msg('Arabic'));
}

/** A language this version doesn't know is printed in Arabic, the default. */
export function letterLanguage(value: unknown): LetterLanguage {
  return value === 'en' || value === 'ar-en' ? value : 'ar';
}

export const LETTER_TRIGGERS: readonly LetterTrigger[] = ['joining', 'leaving', 'salary_change'];

export const LETTER_TRIGGER_LABELS: Record<LetterTrigger, string> = {
  joining: msg('When an employee joins'),
  leaving: msg('When an employee leaves'),
  salary_change: msg('When a salary changes'),
};

/** What made an automatic draft, in a few words. */
export const LETTER_TRIGGER_NOTES: Record<LetterTrigger, string> = {
  joining: msg('Made when they joined'),
  leaving: msg('Made when they left'),
  salary_change: msg('Made when their salary changed'),
};

export function letterTriggerNote(trigger: unknown): string {
  return lookup(LETTER_TRIGGER_NOTES, trigger, msg('Made automatically'));
}

export const LETTER_STATUS_LABELS: Record<'draft' | 'issued' | 'void', string> = {
  draft: msg('Draft'),
  issued: msg('Issued'),
  void: msg('Void'),
};

export function letterStatusLabel(status: unknown): string {
  return lookup(LETTER_STATUS_LABELS, status, msg('Draft'));
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/* -------------------------------------------------------------------------- */

export type LetterFieldGroup = 'employee' | 'service' | 'salary' | 'letter' | 'company' | 'private';

export interface LetterField {
  /** As written in the text, without the braces: `employee.name`. */
  key: string;
  label: string;
  group: LetterFieldGroup;
}

/** The fields a template may use, by group (the editor's chips). */
export const LETTER_FIELDS: readonly LetterField[] = [
  { key: 'employee.name', label: msg('Employee name'), group: 'employee' },
  { key: 'employee.title', label: msg('Mr. or Ms.'), group: 'employee' },
  { key: 'employee.number', label: msg('Employee number'), group: 'employee' },
  { key: 'employee.jobTitle', label: msg('Job title'), group: 'employee' },
  { key: 'employee.department', label: msg('Department'), group: 'employee' },
  { key: 'employee.nationality', label: msg('Nationality'), group: 'employee' },
  { key: 'employee.hireDate', label: msg('Hire date'), group: 'employee' },
  { key: 'employee.leavingDate', label: msg('Leaving date'), group: 'employee' },
  { key: 'service.length', label: msg('Length of service'), group: 'service' },
  { key: 'service.end', label: msg('Service until'), group: 'service' },
  { key: 'salary.basic', label: msg('Basic salary'), group: 'salary' },
  { key: 'salary.allowances', label: msg('Allowances'), group: 'salary' },
  { key: 'salary.total', label: msg('Total monthly salary'), group: 'salary' },
  { key: 'salary.totalWords', label: msg('Total salary in words'), group: 'salary' },
  { key: 'letter.number', label: msg('Letter number'), group: 'letter' },
  { key: 'letter.date', label: msg('Letter date'), group: 'letter' },
  { key: 'letter.addressee', label: msg('Addressed to'), group: 'letter' },
  { key: 'letter.purpose', label: msg('Purpose or reason'), group: 'letter' },
  { key: 'company.name', label: msg('Company name'), group: 'company' },
  { key: 'employee.civilId', label: msg('Civil ID number'), group: 'private' },
  { key: 'employee.passportNumber', label: msg('Passport number'), group: 'private' },
  { key: 'employee.bank', label: msg('Bank'), group: 'private' },
  { key: 'employee.iban', label: msg('IBAN'), group: 'private' },
  { key: 'employee.accountNumber', label: msg('Account or salary card number'), group: 'private' },
];

export const LETTER_FIELD_GROUPS: Record<LetterFieldGroup, string> = {
  employee: msg('Employee'),
  service: msg('Service'),
  salary: msg('Salary'),
  letter: msg('Letter'),
  company: msg('Company'),
  private: msg('Private details'),
};

const KNOWN = new Set(LETTER_FIELDS.map((f) => f.key));
const PRIVATE = new Set(LETTER_FIELDS.filter((f) => f.group === 'private').map((f) => f.key));

/** A field in the text: `{group.name}`. */
const FIELD = /\{([a-z]+\.[a-zA-Z]+)\}/g;

/** The fields a text uses, once each, in the order they first appear. */
export function fieldsIn(text: string): string[] {
  return [...new Set([...text.matchAll(FIELD)].map((m) => m[1]))];
}

/** Fields of the text this version doesn't fill (a typing mistake): left as written. */
export function unknownFields(text: string): string[] {
  return fieldsIn(text).filter((key) => !KNOWN.has(key));
}

/** Whether the text asks for the Civil ID, passport number or bank account. */
export function usesPrivateFields(text: string): boolean {
  return fieldsIn(text).some((key) => PRIVATE.has(key));
}

/** The marks Intl puts around Arabic figures: a letter is plain text in its own direction. */
const BIDI_MARKS = /[‎‏؜⁦-⁩]/g;

/** Western digits, for dates and amounts in both languages. */
export function letterLocale(language: 'en' | 'ar'): string {
  return language === 'ar' ? 'ar-KW-u-nu-latn' : 'en-KW';
}

/** A date as a letter prints it: in its language, with Western digits. */
export function letterDate(
  value: ISODate | null | undefined,
  dateFormat: Company['dateFormat'],
  language: 'en' | 'ar',
): string {
  return formatDate(value, dateFormat, letterLocale(language)).replace(BIDI_MARKS, '').trim();
}

/** "3 years and 2 months", "3 سنوات وشهران". */
export function serviceLength(months: number, language: 'en' | 'ar'): string {
  const whole = Math.max(0, Math.floor(months));
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  if (language === 'ar') {
    const yearsText =
      years === 1
        ? 'سنة واحدة'
        : years === 2
          ? 'سنتان'
          : years >= 3 && years <= 10
            ? `${years} سنوات`
            : `${years} سنة`;
    const monthsText =
      rest === 1
        ? 'شهر واحد'
        : rest === 2
          ? 'شهران'
          : rest >= 3 && rest <= 10
            ? `${rest} أشهر`
            : `${rest} شهراً`;
    if (years === 0 && rest === 0) return 'أقل من شهر';
    if (years === 0) return monthsText;
    if (rest === 0) return yearsText;
    return `${yearsText} و${monthsText}`;
  }
  const yearsText = years === 1 ? '1 year' : `${years} years`;
  const monthsText = rest === 1 ? '1 month' : `${rest} months`;
  if (years === 0 && rest === 0) return 'less than a month';
  if (years === 0) return monthsText;
  if (rest === 0) return yearsText;
  return `${yearsText} and ${monthsText}`;
}

/** Whole months of service from the hire date through `until`, both days counted. */
export function serviceMonths(hireDate: ISODate | null, until: ISODate): number {
  if (!isISODate(hireDate) || !isISODate(until) || until < hireDate) return 0;
  return differenceInMonths(addDays(parseISODate(until), 1), parseISODate(hireDate));
}

/** What a letter is filled with: the employee, the company and the letter itself. */
export interface LetterContext {
  employee: Pick<
    Employee,
    | 'name'
    | 'nameAr'
    | 'number'
    | 'gender'
    | 'jobTitle'
    | 'jobTitleAr'
    | 'department'
    | 'nationality'
    | 'hireDate'
    | 'leavingDate'
    | 'status'
    | 'basicSalary'
    | 'allowances'
    | 'civilId'
    | 'passportNumber'
    | 'bank'
    | 'iban'
    | 'accountNumber'
  >;
  company: Pick<Company, 'name' | 'nameAr' | 'currency' | 'currencyDisplay' | 'dateFormat'>;
  /** The company's departments (#12), for the department's name in each language. */
  departments?: readonly Department[] | null;
  letter: {
    /** Empty while a draft: given at issue. */
    number: string;
    date: ISODate;
    addressee: string;
    purpose: string;
  };
  /** The Civil ID, passport number and bank account may be filled in (see the top). */
  privateFields: boolean;
}

/** The monthly pay a letter shows: the basic salary and every allowance. */
export function letterPay(employee: LetterContext['employee'], currency: string) {
  const places = currencyPrecision(currency);
  const allowances = round(
    employee.allowances.reduce((sum, a) => sum.plus(dec(a.amount)), dec(0)),
    places,
  );
  const basic = round(employee.basicSalary, places);
  return { basic, allowances, total: round(dec(basic).plus(dec(allowances)), places) };
}

/** Every field's value in one language. */
export function letterValues(ctx: LetterContext, language: 'en' | 'ar'): Record<string, string> {
  const { employee, company } = ctx;
  const locale = letterLocale(language);
  const clean = (text: string) => text.replace(BIDI_MARKS, '').trim();
  const date = (value: ISODate | null | undefined) =>
    clean(formatDate(value, company.dateFormat, locale));
  const money = (amount: number) =>
    clean(formatMoney(amount, company.currency, locale, company.currencyDisplay ?? 'local'));
  const pay = letterPay(employee, company.currency);
  const left = employee.status === 'left' && isISODate(employee.leavingDate);
  const until = left ? employee.leavingDate! : ctx.letter.date;
  const bank =
    KUWAIT_BANKS.find((b) => b.code === employee.bank) ?? bankFromIban(employee.iban) ?? null;
  const secret = (value: string) => (ctx.privateFields ? value : maskNumber(value));
  const title =
    employee.gender === 'male'
      ? language === 'ar'
        ? 'السيد'
        : 'Mr.'
      : employee.gender === 'female'
        ? language === 'ar'
          ? 'السيدة'
          : 'Ms.'
        : '';
  return {
    'employee.name': localName(employee, language),
    'employee.title': title,
    'employee.number': employee.number,
    'employee.jobTitle':
      language === 'ar'
        ? employee.jobTitleAr?.trim() || employee.jobTitle
        : employee.jobTitle || employee.jobTitleAr?.trim() || '',
    'employee.department': departmentLabel(ctx.departments, employee.department, language),
    'employee.nationality': clean(countryName(employee.nationality, language)),
    'employee.hireDate': date(employee.hireDate),
    'employee.leavingDate': left ? date(employee.leavingDate) : '',
    'service.length': serviceLength(serviceMonths(employee.hireDate, until), language),
    'service.end': date(until),
    'salary.basic': money(pay.basic),
    'salary.allowances': money(pay.allowances),
    'salary.total': money(pay.total),
    'salary.totalWords': amountInWords(pay.total, company.currency, language),
    'letter.number': ctx.letter.number,
    'letter.date': date(ctx.letter.date),
    'letter.addressee':
      ctx.letter.addressee.trim() ||
      (language === 'ar' ? 'إلى من يهمه الأمر' : 'To whom it may concern'),
    'letter.purpose': ctx.letter.purpose.trim(),
    'company.name': localName(company, language),
    'employee.civilId': secret(employee.civilId),
    'employee.passportNumber': secret(employee.passportNumber),
    'employee.bank': bank ? bank.name[language] : employee.bank,
    'employee.iban': secret(formatIban(employee.iban)),
    'employee.accountNumber': secret(employee.accountNumber ?? ''),
  };
}

/** The text with its fields filled; a field this version doesn't know is left as written. */
export function fillLetter(text: string, values: Record<string, string>): string {
  return text
    .replace(FIELD, (whole, key: string) => (key in values ? values[key] : whole))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
