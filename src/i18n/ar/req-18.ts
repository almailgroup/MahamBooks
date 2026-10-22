import type { Dictionary } from '../index';

/**
 * Expiry alerts with lead times and re-upload reminders (#18). The bell is
 * المستجدات (Updates), never الإشعارات (credit notes) nor تنبيهات (the
 * morning email alerts, تنبيهات البريد).
 */
export default {
  // Compliance settings → expiry reminders
  'Expiry reminders': 'تذكيرات الانتهاء',
  'For the morning email alerts and the register. Each is off until you turn it on; while off, reminders work as before.':
    'لتنبيهات البريد الصباحية وسجل الوثائق. كل منها متوقف حتى تفعّله، وما دام متوقفاً تعمل التذكيرات كما كانت.',
  'Reminders by document type': 'التذكير حسب نوع المستند',
  'Some papers take longer to renew. A type listed here is reminded of on its own days; the others on the days above, and a document’s own days come first.':
    'بعض الوثائق يستغرق تجديدها وقتاً أطول. النوع المذكور هنا يُذكَّر به في أيامه الخاصة، وباقي الأنواع في الأيام المذكورة أعلاه، وأيام الوثيقة نفسها تأتي أولاً.',
  'Days before expiry for {type}': 'الأيام قبل انتهاء {type}',
  'Choose a document type…': 'اختر نوع المستند…',
  'Add type': 'إضافة نوع',
  'For example 90, 60, 30, 7. Up to five reminders a type.':
    'مثلاً 90، 60، 30، 7. حتى خمسة تذكيرات لكل نوع.',
  'Remind again after expiry': 'التذكير مجدداً بعد الانتهاء',
  'An expired paper is in the next email again every few days until it is renewed, instead of only in Sunday’s summary.':
    'تعود الوثيقة المنتهية إلى الرسالة التالية كل بضعة أيام حتى تُجدَّد، بدلاً من ملخص يوم الأحد وحده.',
  'Remind every (days) after expiry': 'التذكير كل (أيام) بعد الانتهاء',
  'Ask for the new copy after a renewal': 'طلب النسخة الجديدة بعد التجديد',
  'A paper renewed with Renew from today on is marked “New copy missing” until a file is added as its new copy, valid until the new expiry, and the email reminds you of it.':
    'الوثيقة التي تُجدَّد بزر «تجديد» من اليوم فصاعداً تُعلَّم «لم تُرفع النسخة الجديدة» حتى يُضاف ملف نسختها الجديدة صالحاً حتى تاريخ الانتهاء الجديد، وتذكّرك بها الرسالة.',
  'Ask for the new copy within (days)': 'طلب النسخة الجديدة خلال (أيام)',
  'Show the reminders in Updates': 'إظهار التذكيرات في المستجدات',
  'The owner and the approvers who get the changes of the team also find them under the bell, each morning. Employees’ papers show there without names.':
    'يجدها المالك والمعتمِدون الذين تصلهم تغييرات الفريق تحت الجرس أيضاً كل صباح. تظهر وثائق الموظفين هناك دون أسماء.',

  // Renewing, and the new copy
  'New copy': 'النسخة الجديدة',
  'A scan of the renewed paper. It goes to the employee’s personnel file.':
    'صورة الوثيقة بعد تجديدها. تُحفظ في ملف الموظف.',
  'A scan of the renewed paper. It is kept with the document.':
    'صورة الوثيقة بعد تجديدها. تُحفظ مع الوثيقة.',
  'Add the new copy': 'إضافة النسخة الجديدة',
  'New copy missing': 'لم تُرفع النسخة الجديدة',
  'Renewed on {date}': 'جُدّدت في {date}',
  'Renewed until {date}. Upload the new copy in the app.':
    'جُدّدت حتى {date}. ارفع النسخة الجديدة في التطبيق.',
  'File not found': 'الملف غير موجود',

  // This file is the…
  'This file is the…': 'هذا الملف هو…',
  'This file is the… ({name})': 'هذا الملف هو… ({name})',
  'Mark a scan as the copy of one of the employee’s papers. A renewed paper is no longer “New copy missing” once a file valid until its new expiry is marked as it.':
    'علّم صورة على أنها نسخة إحدى وثائق الموظف. لا تبقى الوثيقة المجدَّدة «لم تُرفع النسخة الجديدة» متى عُلّم ملف صالح حتى تاريخ انتهائها الجديد على أنه نسختها.',
  'Copy of': 'نسخة من',
  'Nothing in particular': 'لا شيء محدد',
  '{document}, expires {date}': '{document}، تنتهي في {date}',
  '{document}, valid until {date}': '{document}، صالحة حتى {date}',
  'The expiry date printed on the paper.': 'تاريخ الانتهاء المطبوع على الوثيقة.',
  'File saved': 'حُفظ الملف',
  'Could not save the file.': 'تعذّر حفظ الملف.',
  'These files are each employee’s': 'هذه الملفات لكل موظف هي',
  'Marks each scan as the copy of that paper, valid until its expiry date on the employee’s record.':
    'تُعلَّم كل صورة على أنها نسخة تلك الوثيقة، صالحة حتى تاريخ انتهائها في سجل الموظف.',

  // The email and Updates
  'Company papers and licences': 'وثائق الشركة وتراخيصها',
  'Vehicles’ papers': 'وثائق المركبات',
  'Employees’ papers': 'وثائق الموظفين',
  'Customers’ papers': 'وثائق العملاء',
  'An employee’s {document}': '{document} لأحد الموظفين',
  'A confidential document': 'وثيقة سرية',
  '{document} expires on {date}': 'تنتهي صلاحية {document} في {date}',
  '{document} expired on {date}': 'انتهت صلاحية {document} في {date}',
  '{document}: the new copy is not uploaded yet': '{document}: لم تُرفع النسخة الجديدة بعد',

  // Settings → Email alerts
  'Only the owner, admins and accountants can get email alerts.':
    'تنبيهات البريد متاحة للمالك والمديرين والمحاسبين فقط.',
  'Choose at least one kind of paper.': 'اختر نوعاً واحداً من الوثائق على الأقل.',
  'Kinds of paper': 'أنواع الوثائق',
} satisfies Dictionary;
