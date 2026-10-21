import type { Dictionary } from '../index';

/**
 * Change notifications to the Super Admin (#7): the changes of the team in
 * the bell (المستجدات, never الإشعارات, which are credit notes here, nor
 * تنبيهات, the morning alerts), the Updates page, Settings → Email alerts →
 * Changes by your team (تغييرات الفريق), the emails, and who made each entry
 * of the activity log.
 */
export default {
  // Kinds of change
  'Invoices and documents': 'الفواتير والمستندات',
  'Payroll and people': 'الرواتب والموظفون',
  'Items and stock': 'الأصناف والمخزون',
  'Other changes': 'تغييرات أخرى',
  'Invoices and credit notes': 'الفواتير والإشعارات الدائنة',
  'An issued invoice or credit note changed, voided, restored or deleted.':
    'تعديل فاتورة أو إشعار دائن صادر، أو إبطاله أو استعادته أو حذفه.',
  'A cheque recorded, changed, returned, cancelled or deleted, and security cheques.':
    'تسجيل شيك أو تعديله أو إرجاعه أو إلغاؤه أو حذفه، وشيكات الضمان.',
  'A request for approval, and each approval or rejection.': 'كل طلب اعتماد، وكل اعتماد أو رفض.',
  'Someone joined or left, a role or a member’s permissions changed.':
    'انضمام عضو أو مغادرته، أو تغيير دور عضو أو صلاحياته.',
  'The numbering, the lock date or the approval rules changed.':
    'تغيير الترقيم أو تاريخ الإقفال أو قواعد الاعتماد.',
  'A pay run added, approved, paid or deleted (without names or amounts).':
    'إضافة مسير رواتب أو اعتماده أو صرفه أو حذفه (دون أسماء أو مبالغ).',

  // What was changed
  'the pay run for {month}': 'مسير رواتب {month}',
  'a pay run': 'مسير رواتب',
  'cheque {number}': 'الشيك {number}',
  'payment {number}': 'الدفعة {number}',
  'security cheque {number}': 'شيك الضمان {number}',
  'expense {number}': 'المصروف {number}',
  'journal entry {number}': 'القيد {number}',
  'a member': 'عضو',
  Member: 'عضو',

  // The team
  '{name} joined the team as {role}': 'انضمام {name} إلى الفريق بصفة {role}',
  '{name} left the team': 'مغادرة {name} الفريق',
  'Removed {name} from the team': 'إزالة {name} من الفريق',
  'Made {name} the owner': 'نقل الملكية إلى {name}',
  '{name} took over as the owner': 'انتقال الملكية إلى {name}',
  'Changed what {name} may do': 'تعديل صلاحيات {name}',
  'Made {name} {role}': 'تغيير دور {name} إلى {role}',

  // Company settings
  'Moved the lock date to {date}': 'نقل تاريخ الإقفال إلى {date}',
  'Removed the lock date': 'إلغاء تاريخ الإقفال',
  'Changed the numbering': 'تعديل الترقيم',
  'Changed the approval rules': 'تعديل قواعد الاعتماد',
  'Changed the company settings': 'تعديل إعدادات الشركة',

  // What was done
  'Added {thing}': 'إضافة {thing}',
  'Deleted {thing}': 'حذف {thing}',
  'Voided {thing}': 'إبطال {thing}',
  'Restored {thing} from void': 'استعادة {thing} من الإبطال',
  'Issued {thing}': 'إصدار {thing}',
  'Edited {thing} after it was issued': 'تعديل {thing} بعد الإصدار',
  'Changed {thing}': 'تعديل {thing}',
  'Deposited {thing}': 'إيداع {thing}',
  'Cleared {thing}': 'تحصيل {thing}',
  'Marked {thing} as returned': 'تسجيل {thing} كمرتجع',
  'Took back the request: {thing}': 'سحب الطلب: {thing}',
  'Cancelled {thing}': 'إلغاء {thing}',
  'Cashed {thing}': 'صرف {thing}',
  'Put {thing} back as held': 'إعادة {thing} إلى قيد الاحتفاظ',
  'Asked for approval: {thing}': 'طلب اعتماد: {thing}',
  'Approved {thing}': 'اعتماد {thing}',
  'Turned down {thing}': 'رفض {thing}',
  'Carried out {thing}': 'تنفيذ {thing}',
  'Marked {thing} as paid': 'تسجيل {thing} كمدفوع',
  'Someone in the team': 'أحد أعضاء الفريق',
  '{count} changes to {things}': {
    zero: 'لا تغييرات على {things}',
    one: 'تغيير واحد على {things}',
    two: 'تغييران على {things}',
    few: '{count} تغييرات على {things}',
    many: '{count} تغييرًا على {things}',
    other: '{count} تغيير على {things}',
  },

  // The activity log
  '{when} · by {name}': '{when} · بواسطة {name}',

  // The bell and the Updates page
  Updates: 'المستجدات',
  'Mark all as read': 'تعليم الكل كمقروء',
  'The changes could not be loaded. Try again when you are online.':
    'تعذّر تحميل التغييرات. حاول مرة أخرى عند الاتصال بالإنترنت.',
  'Nothing new from your team yet.': 'لا جديد من فريقك حتى الآن.',
  'See all updates': 'عرض كل المستجدات',
  'Updates: {count} unread': {
    zero: 'المستجدات: لا شيء غير مقروء',
    one: 'المستجدات: واحد غير مقروء',
    two: 'المستجدات: اثنان غير مقروءين',
    few: 'المستجدات: {count} غير مقروءة',
    many: 'المستجدات: {count} غير مقروء',
    other: 'المستجدات: {count} غير مقروء',
  },
  Important: 'مهم',
  Unread: 'غير مقروء',
  Yesterday: 'أمس',
  'What your team changed in {company}.': 'ما غيّره فريقك في {company}.',
  'Updates are for companies kept in the cloud, where a team works together.':
    'المستجدات للشركات المحفوظة في السحابة، حيث يعمل فريق معاً.',
  'Only the owner and the members the owner allowed to approve see the changes of the team.':
    'لا يرى تغييرات الفريق إلا المالك والأعضاء الذين سمح لهم المالك بالاعتماد.',
  'Sign in to see the changes of the team.': 'سجّل الدخول لرؤية تغييرات الفريق.',
  'No updates here': 'لا مستجدات هنا',
  'Changes are recorded only while someone has Changes by your team on. Turn it on in Settings → Email alerts.':
    'لا تُسجَّل التغييرات إلا إذا فعّل أحدٌ تغييرات الفريق. فعّلها من الإعدادات ← تنبيهات البريد.',
  'Kind of change': 'نوع التغيير',
  'Every kind of change': 'كل أنواع التغييرات',
  'Nothing matches': 'لا شيء مطابق',
  'Try another filter.': 'جرّب عامل تصفية آخر.',
  'Changes the others make appear here as soon as their device syncs.':
    'تظهر هنا تغييرات الآخرين فور مزامنة أجهزتهم.',
  'Show older changes': 'عرض التغييرات الأقدم',

  // Settings → Email alerts → Changes by your team
  'Changes by your team': 'تغييرات الفريق',
  'The changes of the team could not be loaded': 'تعذّر تحميل تغييرات الفريق',
  'Changes by your team are on': 'تم تفعيل تغييرات الفريق',
  'Changes by your team are off': 'تم إيقاف تغييرات الفريق',
  'What the rest of the team changes in {company}: important changes by email within a few minutes, everything else in a summary at 8:00 in the morning (Kuwait time), and all of it under Updates, the bell at the top.':
    'ما يغيّره بقية الفريق في {company}: التغييرات المهمة بالبريد خلال دقائق، وكل ما عداها في ملخص الساعة 8:00 صباحاً (بتوقيت الكويت)، وكلها في المستجدات، الجرس في أعلى الصفحة.',
  'Open Updates': 'فتح المستجدات',
  'Tell me about changes by my team in {company}': 'أبلغني بتغييرات فريقي في {company}',
  'The emails go to {email}, the address of your account. Your own changes are left out.':
    'تُرسل الرسائل إلى {email}، عنوان حسابك. لا تُضمَّن تغييراتك أنت.',
  'Email at once (within about 5 minutes)': 'بالبريد فوراً (خلال 5 دقائق تقريباً)',
  'Everything else in a morning summary': 'كل ما عدا ذلك في ملخص صباحي',
  'At 8:00 Kuwait time, on days the team changed something. Off: only the changes above are emailed.':
    'الساعة 8:00 بتوقيت الكويت، في الأيام التي غيّر فيها الفريق شيئاً. عند الإيقاف: لا تُرسل بالبريد إلا التغييرات أعلاه.',
  'At most one email every 15 minutes and 20 a day; whatever waits goes in the next one. Payroll changes never name anyone or show amounts.':
    'رسالة واحدة كل 15 دقيقة على الأكثر و20 رسالة في اليوم؛ وما ينتظر يُضاف إلى الرسالة التالية. تغييرات الرواتب لا تذكر أي اسم ولا تُظهر مبالغ.',

  // The emails
  '{company}: {count} important changes by your team': {
    zero: '{company}: لا تغييرات مهمة من فريقك',
    one: '{company}: تغيير مهم واحد من فريقك',
    two: '{company}: تغييران مهمان من فريقك',
    few: '{company}: {count} تغييرات مهمة من فريقك',
    many: '{company}: {count} تغييرًا مهمًا من فريقك',
    other: '{company}: {count} تغيير مهم من فريقك',
  },
  '{company}: {count} changes by your team': {
    zero: '{company}: لا تغييرات من فريقك',
    one: '{company}: تغيير واحد من فريقك',
    two: '{company}: تغييران من فريقك',
    few: '{company}: {count} تغييرات من فريقك',
    many: '{company}: {count} تغييرًا من فريقك',
    other: '{company}: {count} تغيير من فريقك',
  },
  'Your team made changes in {company} that you asked to hear about at once.':
    'أجرى فريقك تغييرات في {company} طلبتَ أن تُبلَّغ بها فوراً.',
  'Good morning. This is what your team changed in {company} since the last email.':
    'صباح الخير. هذا ما غيّره فريقك في {company} منذ الرسالة السابقة.',
  'You get these emails because you turned on Changes by your team for {company} in {app}: important changes within a few minutes (at most one email every {minutes} minutes and {max} a day), and the rest every morning at 8:00 (Kuwait time).':
    'تصلك هذه الرسائل لأنك فعّلت تغييرات الفريق لشركة {company} في {app}: التغييرات المهمة خلال دقائق (رسالة واحدة كل {minutes} دقيقة على الأكثر و{max} رسالة في اليوم)، والباقي كل صباح الساعة 8:00 (بتوقيت الكويت).',
} satisfies Dictionary;
