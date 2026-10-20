import type { Dictionary } from '../index';

/** Driving licences for drivers: who must hold one, the licence class and bulk filing. */
export default {
  // Compliance settings
  'Check drivers’ licences': 'التحقق من رخص قيادة السائقين',
  'Employees who drive for work, by their job title or as set on their page, are flagged when they hold no valid driving licence.':
    'يُنبَّه إلى الموظفين الذين يقودون مركبة للعمل، بحسب المسمى الوظيفي أو كما حُدِّد في صفحاتهم، إذا لم تكن لديهم رخصة قيادة سارية.',

  // The employee's form
  'Drives for work': 'يقود مركبة للعمل',
  'Automatic (from the job title)': 'تلقائي (من المسمى الوظيفي)',
  'A driver by the job title: a valid driving licence is needed.':
    'سائق بحسب المسمى الوظيفي: تلزمه رخصة قيادة سارية.',
  'Not a driver by the job title.': 'ليس سائقًا بحسب المسمى الوظيفي.',
  'A valid driving licence is needed.': 'تلزمه رخصة قيادة سارية.',
  'No driving licence is needed, whatever the job title.':
    'لا تلزمه رخصة قيادة، أيًّا كان المسمى الوظيفي.',

  // The licence
  'Licence class': 'فئة الرخصة',
  'As written on the licence.': 'كما هي مكتوبة في الرخصة.',
  'Class {class}': 'الفئة {class}',

  // Drivers without a valid licence
  'Driving licence missing': 'لا توجد رخصة قيادة',
  'Drives for work, but no driving licence is on file.':
    'يقود مركبة للعمل، ولا توجد له رخصة قيادة في السجل.',
  Missing: 'غير موجودة',
  'Add licence': 'إضافة الرخصة',
  'Add a driving licence for {name}': 'إضافة رخصة قيادة لـ {name}',
  'Drivers without a valid licence': 'السائقون بدون رخصة سارية',
  'Every driver holds a valid driving licence.': 'لدى جميع السائقين رخص قيادة سارية.',
  'Driving licence expired {date}': 'انتهت رخصة القيادة في {date}',

  // Add documents: scans filed as licences
  'File as driving licence': 'الحفظ كرخصة قيادة',
  'Each scan goes to the employee’s driving licence in the register instead of their personnel file. Enter the expiry date on the licence afterwards.':
    'تُحفظ كل نسخة ممسوحة مع رخصة قيادة الموظف في سجل الوثائق بدل ملف الموظف. أدخل تاريخ انتهاء الرخصة بعد ذلك.',
  'Already on their driving licence': 'موجودة في رخصة قيادته',
  '{count} scans filed as driving licences': {
    one: 'حُفظت نسخة واحدة كرخصة قيادة',
    two: 'حُفظت نسختان كرخص قيادة',
    few: 'حُفظت {count} نسخ كرخص قيادة',
    many: 'حُفظت {count} نسخة كرخص قيادة',
    other: 'حُفظت {count} نسخة كرخص قيادة',
  },
  '{count} scan filed as a driving licence': 'حُفظت {count} نسخة كرخصة قيادة',
  '{count} scans filed as the driving licences of {employees} employees':
    'حُفظت {count} من النسخ كرخص قيادة لـ {employees} من الموظفين',
} satisfies Dictionary;
