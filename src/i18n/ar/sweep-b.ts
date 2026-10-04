import type { Dictionary } from '../index';

/** Final sweep: pages, messages and generated texts that were still in English. */
export default {
  // Not found
  'Page not found': 'الصفحة غير موجودة',
  "The page you were looking for doesn't exist or has moved.":
    'الصفحة التي تبحث عنها غير موجودة أو نُقلت إلى مكان آخر.',

  // Leaving a page with unsaved changes
  'Discard unsaved changes?': 'تجاهل التغييرات غير المحفوظة؟',
  'You have changes that have not been saved yet.': 'لديك تغييرات لم تُحفظ بعد.',
  'Keep editing': 'متابعة التعديل',

  // Notifications and app updates
  Notifications: 'الإشعارات',
  'A new version of {app} is available': 'يتوفر إصدار جديد من {app}',
  'Save your work, then reload to update.': 'احفظ عملك، ثم أعد التحميل للتحديث.',
  '{app} now works offline': 'أصبح {app} يعمل دون اتصال بالإنترنت',
  'You can also install it as an app from your browser menu.':
    'يمكنك أيضاً تثبيته كتطبيق من قائمة المتصفح.',

  // Images and files
  'This file could not be read as an image.': 'تعذّرت قراءة هذا الملف كصورة.',
  'Your browser cannot process images.': 'لا يستطيع متصفحك معالجة الصور.',
  'Please choose an image smaller than 8 MB.': 'اختر صورة أصغر من 8 ميغابايت.',
  'Please choose an image file (PNG, JPG, SVG or WebP).':
    'اختر ملف صورة (PNG أو JPG أو SVG أو WebP).',
  'Please choose a file smaller than 10 MB.': 'اختر ملفاً أصغر من 10 ميغابايت.',
  'Please choose a photo or a PDF.': 'اختر صورة أو ملف PDF.',
  'PDF generation took too long. Please check the logo and content, then try again.':
    'استغرق إنشاء ملف PDF وقتاً طويلاً. تحقق من الشعار والمحتوى ثم حاول مرة أخرى.',
  'No statements to print.': 'لا توجد كشوف حساب للطباعة.',

  // Contacts
  'Client {name} deleted': 'تم حذف العميل {name}',
  'Vendor {name} deleted': 'تم حذف المورد {name}',
  'This contact has documents, payments or expenses. Archive it instead.':
    'لجهة الاتصال هذه مستندات أو دفعات أو مصروفات. أرشفها بدلاً من حذفها.',

  // Backups
  'This file is not a valid backup (it is not JSON).':
    'هذا الملف ليس نسخة احتياطية صالحة (ليس بصيغة JSON).',
  'This file is not an {app} backup, or it is damaged.':
    'هذا الملف ليس نسخة احتياطية من {app}، أو أنه تالف.',
  'This backup was made by a newer version of the app. Please update first.':
    'أُنشئت هذه النسخة الاحتياطية بإصدار أحدث من التطبيق. حدّث التطبيق أولاً.',

  // Ledger lines the books write
  'Invoice {number}': 'فاتورة {number}',
  'Credit note {number}': 'إشعار دائن {number}',
  'Bill {number}': 'فاتورة مشتريات {number}',
  'Vendor credit {number}': 'إشعار دائن من مورد {number}',
  'Retention {number}': 'محتجزات {number}',
  '{tax} {rate}% reverse charge': '{tax} {rate}% احتساب عكسي',
  // A reverse-charge rate in the narrow tax picker of a line ("5% RC")
  '{rate} RC': '{rate} احتساب عكسي',
  'Cost of sales {number}': 'تكلفة المبيعات {number}',
  'Stock cost difference {number}': 'فرق تكلفة المخزون {number}',
  'Opening stock {number}': 'المخزون الافتتاحي {number}',
  'Stock adjustment {number}': 'تسوية المخزون {number}',
  'Exchange difference {number}': 'فرق العملة {number}',
  'Fee {number}': 'العمولة {number}',
  'Cheque {cheque} returned ({number})': 'ارتجاع الشيك {cheque} ({number})',
  'Cheque {cheque} cancelled ({number})': 'إلغاء الشيك {cheque} ({number})',

  // Ledger problems
  'This entry does not balance.': 'هذا القيد غير متوازن.',
  'No account is set up for “{account}”. Choose one in the accounting settings.':
    'لم يُعدّ حساب لـ«{account}». اختر حساباً في إعدادات المحاسبة.',
  'No inventory account is set up.': 'لم يُعدّ حساب للمخزون.',
  'No inventory adjustments account is set up.': 'لم يُعدّ حساب لتسويات المخزون.',
  'No exchange rate for {currency}; 1:1 was used.':
    'لا يوجد سعر صرف لعملة {currency}، فاستُخدم السعر 1:1.',
  Drawings: 'المسحوبات',
  'Bank charges': 'الرسوم البنكية',

  // Tax number labels new companies start with
  'Tax card no.': 'رقم البطاقة الضريبية',
  'VAT No.': 'رقم ضريبة القيمة المضافة',
  'Tax No.': 'الرقم الضريبي',

  // Actions that share a word with a status ("Void" is ملغاة as a status, and
  // إلغاء is already the Cancel button next to it)
  'Void document': 'إبطال المستند',
} satisfies Dictionary;
