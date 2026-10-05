import type { Dictionary } from '../index';

/**
 * Keeping data safe: backups with every file, restores that keep what is
 * here, changes not sent to the cloud yet, switching the language with
 * unsaved changes, and what staff and viewers see of the books.
 */
export default {
  // Changes not sent to the cloud yet
  '{count} changes have not reached the cloud yet. Sync first, or confirm that they may be lost.': {
    one: 'لم يصل تغيير واحد إلى السحابة بعد. قم بالمزامنة أولاً، أو أكّد أنه قد يضيع.',
    two: 'لم يصل تغييران إلى السحابة بعد. قم بالمزامنة أولاً، أو أكّد أنهما قد يضيعان.',
    few: 'لم تصل {count} تغييرات إلى السحابة بعد. قم بالمزامنة أولاً، أو أكّد أنها قد تضيع.',
    many: 'لم يصل {count} تغييراً إلى السحابة بعد. قم بالمزامنة أولاً، أو أكّد أنها قد تضيع.',
    other: 'لم يصل {count} تغيير إلى السحابة بعد. قم بالمزامنة أولاً، أو أكّد أنها قد تضيع.',
  },
  'Could not delete the data.': 'تعذّر حذف البيانات.',
  'You are also signed out on this device, so your companies kept in the cloud don’t download again until you sign in.':
    'سيتم أيضاً تسجيل خروجك على هذا الجهاز، فلا تُنزَّل شركاتك المحفوظة في السحابة مرة أخرى حتى تسجّل الدخول.',

  // Backing up
  'Downloading files from the cloud: {done} of {total}':
    'جارٍ تنزيل الملفات من السحابة: {done} من {total}',
  'Back up without {count} files?': {
    one: 'إنشاء النسخة الاحتياطية بدون ملف واحد؟',
    two: 'إنشاء النسخة الاحتياطية بدون ملفين؟',
    few: 'إنشاء النسخة الاحتياطية بدون {count} ملفات؟',
    many: 'إنشاء النسخة الاحتياطية بدون {count} ملفاً؟',
    other: 'إنشاء النسخة الاحتياطية بدون {count} ملف؟',
  },
  'They are kept in the cloud and could not be downloaded now, for example because this device is offline or signed out. The backup lists them, without their content.':
    'هذه الملفات محفوظة في السحابة وتعذّر تنزيلها الآن، مثلاً لأن هذا الجهاز غير متصل أو لم يُسجَّل الدخول فيه. تذكرها النسخة الاحتياطية دون محتواها.',
  'Back up without them': 'إنشاء النسخة بدونها',
  '{count} files are not in this backup.': {
    one: 'ملف واحد غير موجود في هذه النسخة الاحتياطية.',
    two: 'ملفان غير موجودين في هذه النسخة الاحتياطية.',
    few: '{count} ملفات غير موجودة في هذه النسخة الاحتياطية.',
    many: '{count} ملفاً غير موجود في هذه النسخة الاحتياطية.',
    other: '{count} ملف غير موجود في هذه النسخة الاحتياطية.',
  },
  'The backup is too large to save as one file.': 'النسخة الاحتياطية أكبر من أن تُحفظ في ملف واحد.',
  'Could not make the backup.': 'تعذّر إنشاء النسخة الاحتياطية.',

  // Restoring
  '{count} files could not be included when this backup was made.': {
    one: 'تعذّر تضمين ملف واحد عند إنشاء هذه النسخة الاحتياطية.',
    two: 'تعذّر تضمين ملفين عند إنشاء هذه النسخة الاحتياطية.',
    few: 'تعذّر تضمين {count} ملفات عند إنشاء هذه النسخة الاحتياطية.',
    many: 'تعذّر تضمين {count} ملفاً عند إنشاء هذه النسخة الاحتياطية.',
    other: 'تعذّر تضمين {count} ملف عند إنشاء هذه النسخة الاحتياطية.',
  },
  '{merge} adds what this device doesn’t have and keeps every record already here as it is. {replace} deletes everything first.':
    '{merge} يضيف ما ليس موجوداً على هذا الجهاز ويُبقي كل سجل موجود هنا كما هو. {replace} يحذف كل شيء أولاً.',
  '{names} are kept in the cloud: Merge sends the records the backup adds to your team.':
    '{names} محفوظة في السحابة: يرسل الدمج السجلات التي تضيفها النسخة الاحتياطية إلى فريقك.',
  'After Replace they are copies on this device only and no longer sync.': {
    one: 'بعد الاستبدال تصبح نسخة على هذا الجهاز فقط ولا تتزامن.',
    other: 'بعد الاستبدال تصبح نسخاً على هذا الجهاز فقط ولا تتزامن.',
  },
  'Afterwards {names} are copies on this device only and no longer sync with your team. The cloud copies are not changed.':
    {
      one: 'بعد ذلك تصبح {names} نسخة على هذا الجهاز فقط ولا تتزامن مع فريقك. لا تتغير النسخة في السحابة.',
      other:
        'بعد ذلك تصبح {names} نسخاً على هذا الجهاز فقط ولا تتزامن مع فريقك. لا تتغير النسخ في السحابة.',
    },
  'Backup merged': 'تم دمج النسخة الاحتياطية',
  '{count} records added. Records already here were kept as they are.': {
    zero: 'لم يُضف أي سجل، وبقيت السجلات الموجودة هنا كما هي.',
    one: 'أُضيف سجل واحد، وبقيت السجلات الموجودة هنا كما هي.',
    two: 'أُضيف سجلان، وبقيت السجلات الموجودة هنا كما هي.',
    few: 'أُضيفت {count} سجلات، وبقيت السجلات الموجودة هنا كما هي.',
    many: 'أُضيف {count} سجلاً، وبقيت السجلات الموجودة هنا كما هي.',
    other: 'أُضيف {count} سجل، وبقيت السجلات الموجودة هنا كما هي.',
  },

  // Switching the language with unsaved changes
  'Discard your changes?': 'تجاهل تغييراتك؟',
  'Switching the language reloads the page, so changes that have not been saved yet are lost.':
    'تغيير اللغة يعيد تحميل الصفحة، فتضيع التغييرات التي لم تُحفظ بعد.',

  // Staff and viewers
  'Payroll isn’t included in what you see.': 'الرواتب غير مشمولة فيما تراه.',

  // Importing employees
  'The date of birth is in the future ({date}).': 'تاريخ الميلاد في المستقبل ({date}).',
} satisfies Dictionary;
