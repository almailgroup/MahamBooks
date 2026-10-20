import type { Employee } from '@/db/types';
import { nationalityKey as titleKey } from './nationalities';

/**
 * Common job titles in Kuwait with their Arabic, to fill in the Arabic job
 * title of employees brought in from another system. Other spellings of the
 * English title are listed after it.
 */
export const JOB_TITLES: { en: string[]; ar: string }[] = [
  // Security and facility services
  { en: ['Security Guard', 'Guard', 'Security', 'Security Gaurd'], ar: 'حارس أمن' },
  { en: ['Security Officer'], ar: 'مسؤول أمن' },
  { en: ['Security Supervisor'], ar: 'مشرف أمن' },
  { en: ['Supervisor'], ar: 'مشرف' },
  { en: ['Watchman', 'Gatekeeper', 'Natoor', 'Natour'], ar: 'ناطور' },
  { en: ['Cleaner', 'Cleaning Worker', 'Cleaning Labour', 'Janitor'], ar: 'عامل نظافة' },
  { en: ['Housekeeper', 'Housekeeping'], ar: 'عامل تدبير منزلي' },
  {
    en: ['Valet', 'Valet Parking', 'Valet Driver', 'Valet Parking Attendant'],
    ar: 'عامل صف سيارات',
  },
  { en: ['Parking Attendant'], ar: 'عامل مواقف' },
  { en: ['Driver', 'Light Driver'], ar: 'سائق' },
  { en: ['Bus Driver'], ar: 'سائق حافلة' },
  { en: ['Heavy Driver', 'Heavy Vehicle Driver', 'Truck Driver'], ar: 'سائق مركبة ثقيلة' },
  { en: ['Labourer', 'Laborer', 'Labour', 'Labor', 'Worker', 'General Worker'], ar: 'عامل' },
  { en: ['Helper', 'Assistant'], ar: 'مساعد' },
  { en: ['Office Boy', 'Tea Boy', 'Farrash'], ar: 'فرّاش' },
  { en: ['Messenger', 'Courier'], ar: 'مراسل' },
  { en: ['Gardener', 'Farmer'], ar: 'مزارع' },
  { en: ['Cook', 'Chef'], ar: 'طباخ' },
  { en: ['Waiter'], ar: 'نادل' },
  // Trades and maintenance
  { en: ['Technician'], ar: 'فني' },
  { en: ['Maintenance Technician', 'Maintenance'], ar: 'فني صيانة' },
  { en: ['AC Technician', 'A/C Technician', 'Air Conditioning Technician'], ar: 'فني تكييف' },
  { en: ['CCTV Technician', 'Camera Technician'], ar: 'فني كاميرات مراقبة' },
  { en: ['Electrician'], ar: 'كهربائي' },
  { en: ['Plumber'], ar: 'سبّاك' },
  { en: ['Welder'], ar: 'لحّام' },
  { en: ['Carpenter'], ar: 'نجّار' },
  { en: ['Painter'], ar: 'صبّاغ' },
  { en: ['Mason'], ar: 'بنّاء' },
  { en: ['Mechanic'], ar: 'ميكانيكي' },
  { en: ['Foreman'], ar: 'رئيس عمال' },
  { en: ['Forklift Operator'], ar: 'مشغل رافعة شوكية' },
  { en: ['Storekeeper', 'Store Keeper', 'Warehouse Keeper'], ar: 'أمين مخزن' },
  // Office
  {
    en: [
      'Mandoop',
      'Mandoob',
      'Mandub',
      'Mandob',
      'Representative',
      'Government Relations Officer',
      'PRO',
    ],
    ar: 'مندوب',
  },
  { en: ['Accountant'], ar: 'محاسب' },
  { en: ['Senior Accountant'], ar: 'محاسب أول' },
  { en: ['Chief Accountant'], ar: 'رئيس الحسابات' },
  { en: ['Cashier'], ar: 'أمين صندوق' },
  { en: ['Auditor', 'Internal Auditor'], ar: 'مدقق حسابات' },
  { en: ['HR Officer', 'Human Resources Officer'], ar: 'مسؤول موارد بشرية' },
  { en: ['HR', 'Human Resources'], ar: 'الموارد البشرية' },
  { en: ['HR Manager', 'Human Resources Manager'], ar: 'مدير الموارد البشرية' },
  { en: ['IT', 'Information Technology', 'IT Officer', 'IT Specialist'], ar: 'تقنية المعلومات' },
  { en: ['IT Support', 'IT Technician'], ar: 'دعم فني' },
  { en: ['Programmer', 'Developer', 'Software Developer'], ar: 'مبرمج' },
  { en: ['Sales', 'Sales Executive', 'Sales Officer'], ar: 'مبيعات' },
  { en: ['Salesman', 'Sales Representative', 'Salesperson'], ar: 'مندوب مبيعات' },
  { en: ['Sales Manager'], ar: 'مدير المبيعات' },
  { en: ['Marketing', 'Marketing Officer'], ar: 'تسويق' },
  { en: ['Secretary'], ar: 'سكرتير' },
  { en: ['Receptionist'], ar: 'موظف استقبال' },
  { en: ['Clerk', 'Office Clerk'], ar: 'كاتب' },
  { en: ['Data Entry', 'Data Entry Operator'], ar: 'مدخل بيانات' },
  { en: ['Administrator', 'Admin', 'Administrative Officer', 'Admin Officer'], ar: 'إداري' },
  { en: ['Admin Assistant', 'Administrative Assistant'], ar: 'مساعد إداري' },
  { en: ['Coordinator'], ar: 'منسق' },
  { en: ['Purchasing Officer', 'Purchaser', 'Buyer'], ar: 'مسؤول مشتريات' },
  { en: ['Legal Advisor', 'Legal Counsel', 'Lawyer'], ar: 'مستشار قانوني' },
  { en: ['Engineer'], ar: 'مهندس' },
  { en: ['Civil Engineer'], ar: 'مهندس مدني' },
  { en: ['Nurse'], ar: 'ممرض' },
  // Management
  { en: ['Manager'], ar: 'مدير' },
  { en: ['General Manager', 'GM'], ar: 'المدير العام' },
  { en: ['Operations Manager'], ar: 'مدير العمليات' },
  { en: ['Finance Manager', 'Financial Manager'], ar: 'المدير المالي' },
  { en: ['Project Manager'], ar: 'مدير مشروع' },
  { en: ['CEO', 'Chief Executive Officer', 'Chief Executive'], ar: 'الرئيس التنفيذي' },
  { en: ['Chairman'], ar: 'رئيس مجلس الإدارة' },
];

let english: Map<string, string> | null = null;
let arabic: Map<string, string> | null = null;

function tables() {
  if (!english || !arabic) {
    english = new Map();
    arabic = new Map();
    for (const title of JOB_TITLES) {
      for (const name of title.en) english.set(titleKey(name), title.ar);
      arabic.set(titleKey(title.ar), title.en[0]);
    }
  }
  return { english, arabic };
}

/** The Arabic of a common job title written in English, or '' when it isn't known. */
export function arabicJobTitle(title: string): string {
  return tables().english.get(titleKey(title)) ?? '';
}

/** The English of a common job title written in Arabic, or '' when it isn't known. */
export function englishJobTitle(title: string): string {
  return tables().arabic.get(titleKey(title)) ?? '';
}

/** سائق, also written without the hamza. */
const ARABIC_DRIVER = /سائق|سايق/;

/**
 * Whether the employee's job title is a driver's, in English, in Arabic or
 * on the work permit: the word "driver" (Driver, HEAVY DRIVER, Bus Driver,
 * Valet Driver…) or سائق (سائق, سائق حافلة, السائق). Valets who only park
 * cars (Valet, عامل صف سيارات) are not drivers. Free text is sometimes
 * misread: the employee's own setting corrects it (requiresDrivingLicence).
 */
export function isDriverTitle(
  employee: Pick<Employee, 'jobTitle' | 'jobTitleAr' | 'pamJobTitle'>,
): boolean {
  return [employee.jobTitle, employee.jobTitleAr, employee.pamJobTitle].some((title) => {
    const key = titleKey(title ?? '');
    if (!key) return false;
    return ARABIC_DRIVER.test(key) || key.split(' ').some((word) => /^drivers?$/.test(word));
  });
}
