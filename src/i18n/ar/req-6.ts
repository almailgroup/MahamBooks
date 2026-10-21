import type { Dictionary } from '../index';

/** The Super Admin (the owner): limits per member, approvers and who makes admins and accountants. */
export default {
  'Super Admin': 'المشرف العام',
  'Owner (Super Admin)': 'المالك (المشرف العام)',
  'As the owner of {company} you are its Super Admin: you decide who does what. To make someone else Super Admin, transfer ownership to them below.':
    'بصفتك مالك {company} فأنت مشرفها العام: تقرر من يفعل ماذا. لجعل شخص آخر المشرف العام، انقل الملكية إليه أدناه.',
  'Only the owner makes admins and accountants': 'المالك وحده يعيّن المديرين والمحاسبين',
  'Admins still invite and remove staff and viewers. Turning this on cancels invitations as admin or accountant that others made.':
    'يبقى للمديرين دعوة الموظفين والمطّلعين وإزالتهم. وتشغيل هذا الخيار يلغي دعوات المديرين والمحاسبين التي أرسلها غيرك.',
  'Use Permissions next to a member to make an app view only or turn it off for them, and to let up to two admins or accountants approve.':
    'استخدم «الصلاحيات» بجانب العضو لجعل تطبيق للاطلاع فقط أو إيقافه له، وللسماح لمديرَين أو محاسبَين على الأكثر بالاعتماد.',
  'Team rules saved': 'تم حفظ قواعد الفريق',
  'Only the owner invites admins and accountants.': 'المالك وحده يدعو المديرين والمحاسبين.',
  Permissions: 'الصلاحيات',
  'Permissions of {name}': 'صلاحيات {name}',
  'Permissions saved': 'تم حفظ الصلاحيات',
  'Can approve': 'صلاحية الاعتماد',
  'Limited access': 'وصول محدود',
  'What {name} can do': 'ما يمكن أن يفعله {name}',
  'As {role}, with the limits you set here. Limits only take away from the role, and the cloud applies them to what they save.':
    'بصفته {role}، مع القيود التي تضعها هنا. القيود تُنقص من صلاحيات الدور فقط، وتطبّقها السحابة على ما يحفظه.',
  'Access to {app}': 'الوصول إلى {app}',
  'As the role: {access}': 'حسب الدور: {access}',
  'As the role': 'حسب الدور',
  'Settings, files and activity follow the role. What is already on their device stays there.':
    'تتبع الإعدادات والملفات وسجل النشاط الدور. وما هو موجود على جهازه يبقى عليه.',
  'Two members already approve besides you. Turn one of them off first.':
    'يعتمد عضوان غيرك بالفعل. أوقف صلاحية أحدهما أولاً.',
  'Decides approval requests besides you, and sees what they are about. Up to two members.':
    'يبتّ في طلبات الاعتماد إلى جانبك ويطّلع على موضوعها. عضوان على الأكثر.',
  'The owner has turned {app} off for you': 'أوقف المالك {app} بالنسبة لك',
  'The owner has made {app} view only for you. Ask the owner if you need to change something.':
    'جعل المالك {app} للاطلاع فقط بالنسبة لك. اطلب من المالك إن احتجت إلى تغيير شيء.',
  'The owner has made this app view only for you. Ask the owner if you need to change it.':
    'جعل المالك هذا التطبيق للاطلاع فقط بالنسبة لك. اطلب من المالك إن احتجت إلى تغيير ذلك.',
  'Companies you own': 'الشركات التي تملكها',
  'You are the Super Admin of these companies in the cloud: you decide who does what in each, in Settings → Team.':
    'أنت المشرف العام لهذه الشركات في السحابة: تقرر من يفعل ماذا في كل منها، من الإعدادات ← الفريق.',
  'Open its team': 'فتح فريقها',
  'Not on this device': 'ليست على هذا الجهاز',
  '{count} members': {
    zero: 'لا أعضاء',
    one: 'عضو واحد',
    two: 'عضوان',
    few: '{count} أعضاء',
    many: '{count} عضواً',
    other: '{count} عضو',
  },
  '{count} requests waiting for approval': {
    zero: 'لا طلبات بانتظار الاعتماد',
    one: 'طلب واحد بانتظار الاعتماد',
    two: 'طلبان بانتظار الاعتماد',
    few: '{count} طلبات بانتظار الاعتماد',
    many: '{count} طلباً بانتظار الاعتماد',
    other: '{count} طلب بانتظار الاعتماد',
  },
} satisfies Dictionary;
