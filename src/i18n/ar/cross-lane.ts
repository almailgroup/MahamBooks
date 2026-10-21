import type { Dictionary } from '../index';

/** Fixes found where the Books lane and the People and Compliance lane meet. */
export default {
  // A printed cheque changed on a device with an older version of the app
  'This cheque was changed after it was printed: its leaf no longer matches it. Mark the leaf spoiled first.':
    'تغيّر هذا الشيك بعد طباعته، فلم تعد ورقته مطابقة له. سجّل الورقة كورقة تالفة أولًا.',
  'Leaf {number} was printed on {date}, but the cheque was changed on another device afterwards: the leaf no longer matches it. Mark the leaf spoiled and destroy it, then print the cheque again.':
    'طُبعت الورقة {number} في {date}، لكن الشيك تغيّر بعدها على جهاز آخر، فلم تعد الورقة مطابقة له. سجّل الورقة كورقة تالفة وأتلِفها، ثم اطبع الشيك من جديد.',
  'Mark the leaf spoiled': 'تسجيل الورقة كتالفة',
  'Changed on another device after printing': 'تغيّر على جهاز آخر بعد الطباعة',
  'The cheque was changed on another device after leaf {number} was printed: the leaf no longer matches it. Mark the leaf spoiled on Print cheque before the cheque is handed over.':
    'تغيّر الشيك على جهاز آخر بعد طباعة الورقة {number}، فلم تعد الورقة مطابقة له. سجّل الورقة كورقة تالفة من «طباعة الشيك» قبل تسليم الشيك.',
  'Payment {payment} was changed or deleted on another device, and with it the record of cheque leaves {numbers}. A printed leaf still in hand is a cheque: destroy it.':
    'تغيّرت الدفعة {payment} أو حُذفت على جهاز آخر، وذهب معها سجل أوراق الشيكات {numbers}. الورقة المطبوعة التي ما زالت بين يديك شيكٌ، فأتلِفها.',

  // Importing items
  '{name} is archived. Restore it in Products & services first.':
    '{name} مؤرشف. استعِده من المنتجات والخدمات أولًا.',

  // Settings → Invoice defaults
  'Owners, admins and accountants set up vouchers. You can look at them.':
    'يُعِدّ المالكون والمسؤولون والمحاسبون السندات، ويمكنك الاطلاع عليها.',

  // Settings → Compliance and files
  'Compliance and files': 'الامتثال والملفات',
  'Reminders and deadlines, drivers’ licences, contracts, customers’ papers and vehicles in the register, and the Files page with files and papers in search, for Books too.':
    'التذكيرات والمواعيد النهائية، ورخص قيادة السائقين، والعقود ووثائق العملاء والمركبات في السجل، وصفحة الملفات مع الملفات والوثائق في البحث، ولمهام بوكس أيضًا.',
  'Switched on': 'مفعّل',
  'Switched off': 'متوقف',
  'Owners, admins and accountants change the compliance settings.':
    'يغيّر المالكون والمسؤولون والمحاسبون إعدادات الامتثال.',
  'Reminders and deadlines, drivers’ licences, the register’s contracts, customers’ papers and vehicles, and the document finder for every app.':
    'التذكيرات والمواعيد النهائية، ورخص قيادة السائقين، وعقود السجل ووثائق العملاء والمركبات، والبحث في الوثائق لكل التطبيقات.',
} satisfies Dictionary;
