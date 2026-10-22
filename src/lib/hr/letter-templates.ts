import type { ID, LetterKind, LetterTemplate, Timestamp } from '@/db/types';
import type { LetterContext } from './letters';

/**
 * The wording a company starts with for each kind of letter (#19), in Arabic
 * and English, and an invented employee for previews. A default template is
 * not stored until someone changes it: until then the company's list shows
 * it as written here, under the id `default:<companyId>:<kind>` that every
 * device gives it, so two devices never make two of them. The wording is a
 * starting point: warning letters and no objection certificates have legal
 * weight, so the owner or a lawyer checks it before it is used.
 */

interface Wording {
  name: string;
  nameAr: string;
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
}

const lines = (...rows: string[]) => rows.join('\n');

export const DEFAULT_WORDING: Record<LetterKind, Wording> = {
  salary_certificate: {
    name: 'Salary certificate',
    nameAr: 'شهادة راتب',
    subjectEn: 'Salary certificate',
    subjectAr: 'شهادة راتب',
    bodyEn: lines(
      '{letter.addressee}',
      '',
      'This is to certify that the holder of this certificate is employed by {company.name} as follows:',
      '',
      'Name: {employee.name}',
      'Nationality: {employee.nationality}',
      'Job title: {employee.jobTitle}',
      'Department: {employee.department}',
      'Date of joining: {employee.hireDate}',
      'Total monthly salary: {salary.total}',
      '({salary.totalWords})',
      '',
      'This certificate is issued at the employee’s request, without any liability on the company.',
    ),
    bodyAr: lines(
      '{letter.addressee}',
      '',
      'تشهد {company.name} بأن صاحب هذه الشهادة يعمل لديها وفق البيانات التالية:',
      '',
      'الاسم: {employee.name}',
      'الجنسية: {employee.nationality}',
      'المسمى الوظيفي: {employee.jobTitle}',
      'القسم: {employee.department}',
      'تاريخ التعيين: {employee.hireDate}',
      'الراتب الشهري الإجمالي: {salary.total}',
      '({salary.totalWords})',
      '',
      'وقد أُعطيت هذه الشهادة بناءً على طلبه دون أدنى مسؤولية على الشركة.',
    ),
  },
  experience_certificate: {
    name: 'Experience certificate',
    nameAr: 'شهادة خبرة',
    subjectEn: 'Experience certificate',
    subjectAr: 'شهادة خبرة',
    bodyEn: lines(
      '{letter.addressee}',
      '',
      'This is to certify that the holder of this certificate worked for {company.name} as follows:',
      '',
      'Name: {employee.name}',
      'Nationality: {employee.nationality}',
      'Job title: {employee.jobTitle}',
      'Department: {employee.department}',
      'Period of service: from {employee.hireDate} to {service.end} ({service.length})',
      '',
      'This certificate is issued at the employee’s request, without any liability on the company. We wish them every success.',
    ),
    bodyAr: lines(
      '{letter.addressee}',
      '',
      'تشهد {company.name} بأن صاحب هذه الشهادة عمل لديها وفق البيانات التالية:',
      '',
      'الاسم: {employee.name}',
      'الجنسية: {employee.nationality}',
      'المسمى الوظيفي: {employee.jobTitle}',
      'القسم: {employee.department}',
      'مدة الخدمة: من {employee.hireDate} إلى {service.end} ({service.length})',
      '',
      'وقد أُعطيت هذه الشهادة بناءً على طلبه دون أدنى مسؤولية على الشركة، مع تمنياتنا له بالتوفيق.',
    ),
  },
  employment_certificate: {
    name: 'Employment certificate',
    nameAr: 'شهادة عمل',
    subjectEn: 'Employment certificate',
    subjectAr: 'شهادة عمل',
    bodyEn: lines(
      '{letter.addressee}',
      '',
      'This is to certify that the holder of this certificate is employed by {company.name} to date as follows:',
      '',
      'Name: {employee.name}',
      'Employee number: {employee.number}',
      'Nationality: {employee.nationality}',
      'Job title: {employee.jobTitle}',
      'Department: {employee.department}',
      'Date of joining: {employee.hireDate}',
      '',
      'This certificate is issued at the employee’s request, without any liability on the company.',
    ),
    bodyAr: lines(
      '{letter.addressee}',
      '',
      'تشهد {company.name} بأن صاحب هذه الشهادة يعمل لديها حتى تاريخه وفق البيانات التالية:',
      '',
      'الاسم: {employee.name}',
      'الرقم الوظيفي: {employee.number}',
      'الجنسية: {employee.nationality}',
      'المسمى الوظيفي: {employee.jobTitle}',
      'القسم: {employee.department}',
      'تاريخ التعيين: {employee.hireDate}',
      '',
      'وقد أُعطيت هذه الشهادة بناءً على طلبه دون أدنى مسؤولية على الشركة.',
    ),
  },
  warning: {
    name: 'Warning letter',
    nameAr: 'خطاب إنذار',
    subjectEn: 'Warning',
    subjectAr: 'إنذار',
    bodyEn: lines(
      'To: {employee.name}',
      'Employee number: {employee.number}',
      'Job title: {employee.jobTitle}',
      'Department: {employee.department}',
      '',
      'The following was noted: {letter.purpose}',
      '',
      'This breaches the company’s work rules, and this letter is a formal warning. Please follow the work rules from now on: repeating the breach may lead to the penalties set out in the Private Sector Labour Law and the company’s penalties regulation.',
      '',
      'Please sign below to confirm that you received this letter.',
      '',
      'Employee’s signature: ____________',
      'Date received: ____________',
    ),
    bodyAr: lines(
      'إلى: {employee.name}',
      'الرقم الوظيفي: {employee.number}',
      'المسمى الوظيفي: {employee.jobTitle}',
      'القسم: {employee.department}',
      '',
      'لوحظ ما يلي: {letter.purpose}',
      '',
      'ويُعد ذلك مخالفة لأنظمة العمل لدى الشركة، لذا نوجّه إليكم هذا الإنذار. نرجو الالتزام بأنظمة العمل مستقبلاً، علماً بأن تكرار المخالفة قد يعرّضكم للجزاءات المنصوص عليها في قانون العمل في القطاع الأهلي ولائحة الجزاءات لدى الشركة.',
      '',
      'يرجى التوقيع بما يفيد الاستلام.',
      '',
      'توقيع الموظف: ____________',
      'تاريخ الاستلام: ____________',
    ),
  },
  noc: {
    name: 'No objection certificate',
    nameAr: 'شهادة عدم ممانعة',
    subjectEn: 'No objection certificate',
    subjectAr: 'شهادة عدم ممانعة',
    bodyEn: lines(
      '{letter.addressee}',
      '',
      '{company.name} has no objection to {letter.purpose} for the holder of this certificate, whose details are:',
      '',
      'Name: {employee.name}',
      'Nationality: {employee.nationality}',
      'Job title: {employee.jobTitle}',
      'Date of joining: {employee.hireDate}',
      '',
      'This certificate is issued at the employee’s request, without any liability on the company.',
    ),
    bodyAr: lines(
      '{letter.addressee}',
      '',
      'تفيد {company.name} بأنه لا مانع لديها من {letter.purpose} لصاحب هذه الشهادة، وبياناته كالتالي:',
      '',
      'الاسم: {employee.name}',
      'الجنسية: {employee.nationality}',
      'المسمى الوظيفي: {employee.jobTitle}',
      'تاريخ التعيين: {employee.hireDate}',
      '',
      'وقد أُعطيت هذه الشهادة بناءً على طلبه دون أدنى مسؤولية على الشركة.',
    ),
  },
  salary_transfer: {
    name: 'Salary transfer letter',
    nameAr: 'خطاب تحويل راتب',
    subjectEn: 'Salary transfer',
    subjectAr: 'تحويل راتب',
    bodyEn: lines(
      '{letter.addressee}',
      '',
      '{company.name} confirms that the holder of this letter has been employed as {employee.jobTitle} since {employee.hireDate}, with a total monthly salary of {salary.total} ({salary.totalWords}).',
      '',
      'The company will transfer the monthly salary to the employee’s account with you.',
    ),
    bodyAr: lines(
      '{letter.addressee}',
      '',
      'تفيد {company.name} بأن صاحب هذا الخطاب يعمل لديها بوظيفة {employee.jobTitle} منذ {employee.hireDate}، ويتقاضى راتباً شهرياً إجمالياً قدره {salary.total} ({salary.totalWords}).',
      '',
      'وستحوّل الشركة راتبه الشهري إلى حسابه لديكم.',
    ),
  },
  custom: {
    name: 'Letter',
    nameAr: 'خطاب',
    subjectEn: '',
    subjectAr: '',
    bodyEn: lines('{letter.addressee}', ''),
    bodyAr: lines('{letter.addressee}', ''),
  },
};

const PREFIX = 'default:';

/** The id every device gives the company's default template of a kind. */
export function defaultTemplateId(companyId: ID, kind: LetterKind): ID {
  return `${PREFIX}${companyId}:${kind}`;
}

/** The kind a default template's id is of, or null for a template the company made. */
export function defaultTemplateKind(id: ID): LetterKind | null {
  if (!id.startsWith(PREFIX)) return null;
  const kind = id.slice(id.lastIndexOf(':') + 1);
  return kind in DEFAULT_WORDING ? (kind as LetterKind) : null;
}

/** A kind's starting wording as a template of the company (Arabic by default). */
export function templateFromWording(
  companyId: ID,
  kind: LetterKind,
  id: ID,
  stamp: Timestamp,
): LetterTemplate {
  const wording = DEFAULT_WORDING[kind] ?? DEFAULT_WORDING.custom;
  return {
    id,
    companyId,
    kind,
    name: wording.name,
    nameAr: wording.nameAr,
    language: 'ar',
    subjectEn: wording.subjectEn,
    subjectAr: wording.subjectAr,
    bodyEn: wording.bodyEn,
    bodyAr: wording.bodyAr,
    showStamp: true,
    showSignature: true,
    signatoryName: '',
    signatoryTitle: '',
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** The company's default template of a kind, as it is until someone changes it. */
export function defaultTemplate(companyId: ID, kind: LetterKind, stamp = ''): LetterTemplate {
  return templateFromWording(companyId, kind, defaultTemplateId(companyId, kind), stamp);
}

/** An invented employee, to preview a template with. */
export const PREVIEW_EMPLOYEE: LetterContext['employee'] = {
  name: 'Sample Employee',
  nameAr: 'موظف للمعاينة',
  number: 'EMP-000',
  gender: null,
  jobTitle: 'Accountant',
  jobTitleAr: 'محاسب',
  department: 'Finance',
  nationality: 'KW',
  hireDate: '2022-03-01',
  leavingDate: null,
  status: 'active',
  basicSalary: 850,
  allowances: [{ id: 'preview', name: 'Housing', nameAr: 'سكن', amount: 150, countsForEos: true }],
  civilId: '000000000000',
  passportNumber: 'P0000000',
  bank: '',
  iban: '',
  accountNumber: '',
};
