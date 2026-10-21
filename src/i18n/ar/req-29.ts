import type { Dictionary } from '../index';

/** Pictures of items: in the item, in lists and on printed documents. */
export default {
  // Settings → Items and units
  'Pictures of your items, to tell them apart in lists and to show customers on quotes and invoices.':
    'صور أصنافك، لتمييزها في القوائم ولعرضها على العملاء في عروض الأسعار والفواتير.',
  'Give items pictures': 'إضافة صور إلى الأصناف',
  'Up to five pictures per item, the first one its main picture: shown in Products & services and when picking items, and printed on documents whose design shows item pictures (Templates).':
    'حتى خمس صور لكل صنف، أولاها صورته الرئيسية: تظهر في المنتجات والخدمات وعند اختيار الأصناف، وتُطبع في المستندات التي يُظهر تصميمها صور الأصناف (القوالب).',
  'Add pictures to each item in Products & services. Staff can add them too.':
    'أضف الصور إلى كل صنف من المنتجات والخدمات. يمكن للموظفين إضافتها أيضًا.',

  // Templates
  'The main picture of each item that has one, beside it.':
    'الصورة الرئيسية لكل صنف له صورة، بجانبه.',
  'Turn on item pictures in Settings → Items and units first.':
    'فعّل صور الأصناف أولًا من الإعدادات ← الأصناف والوحدات.',

  // The item's pictures
  Pictures: 'الصور',
  'Main picture': 'صورة رئيسية',
  'Picture {number}': 'الصورة {number}',
  'View full size': 'عرض بالحجم الكامل',
  'Make main picture': 'تعيين كصورة رئيسية',
  Rotate: 'تدوير',
  'Add picture': 'إضافة صورة',
  'No pictures yet.': 'لا توجد صور بعد.',
  'Up to {count} pictures, kept whole. The first is the main one: shown in lists and printed on documents whose design shows item pictures.':
    'حتى {count} صور تُحفظ كاملة دون قص. الأولى هي الصورة الرئيسية: تظهر في القوائم وتُطبع في المستندات التي يُظهر تصميمها صور الأصناف.',
  'Choose pictures': 'اختيار الصور',
  'Choose a picture': 'اختيار صورة',
  'Could not save the picture.': 'تعذّر حفظ الصورة.',
  '{count} pictures added': {
    one: 'أُضيفت صورة واحدة',
    two: 'أُضيفت صورتان',
    few: 'أُضيفت {count} صور',
    many: 'أُضيفت {count} صورة',
    other: 'أُضيفت {count} صورة',
  },
  'Picture replaced': 'تم استبدال الصورة',
  'Main picture changed': 'تم تغيير الصورة الرئيسية',
  'Remove this picture?': 'إزالة هذه الصورة؟',
  'The next picture becomes the main one.': 'تصبح الصورة التالية هي الصورة الرئيسية.',
  'Picture removed': 'تمت إزالة الصورة',
  'This item could not be found.': 'تعذّر العثور على هذا الصنف.',
  'This picture is no longer on the item.': 'لم تعد هذه الصورة من صور الصنف.',
  'An item can have up to {count} pictures.': 'يمكن أن يكون للصنف حتى {count} صور.',

  // Activity
  'Picture added to item {name}': 'أُضيفت صورة إلى الصنف {name}',
  '{count} pictures added to item {name}': 'أُضيفت {count} صور إلى الصنف {name}',
  'Picture of item {name} replaced': 'استُبدلت صورة الصنف {name}',
  'Picture removed from item {name}': 'أُزيلت صورة من الصنف {name}',
  'Main picture of item {name} changed': 'تغيّرت الصورة الرئيسية للصنف {name}',
} satisfies Dictionary;
