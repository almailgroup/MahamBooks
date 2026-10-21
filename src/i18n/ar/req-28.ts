import type { Dictionary } from '../index';

/** Item units, item codes (SKU) and their QR codes, labels and printed lists. */
export default {
  'Items and units': 'الأصناف والوحدات',
  Units: 'الوحدات',
  'Pick units from a list with Arabic names, printed on Arabic documents. Units typed before stay as they are.':
    'اختر الوحدات من قائمة بأسمائها العربية التي تُطبع على المستندات العربية. تبقى الوحدات المكتوبة سابقًا كما هي.',
  'Units from a list': 'الوحدات من قائمة',
  'Items and lines take their unit from the list: a unit picked on an English document prints in Arabic on an Arabic one.':
    'تأخذ الأصناف والبنود وحدتها من القائمة: الوحدة المختارة في مستند إنجليزي تُطبع بالعربية في المستند العربي.',
  'Built-in units': 'الوحدات الأساسية',
  'Your units': 'وحداتك',
  'Add the units you use that are not in the list, such as roll or bag.':
    'أضف الوحدات التي تستخدمها وليست في القائمة، مثل لفة أو كيس.',
  'Unit {number}': 'الوحدة {number}',
  'Restore unit {number}': 'استعادة الوحدة {number}',
  'Archive unit {number}': 'أرشفة الوحدة {number}',
  'Archived units are no longer offered; documents that have them still print them.':
    'لا تُعرض الوحدات المؤرشفة بعد الآن، وتبقى مطبوعة في المستندات التي تحملها.',
  'Add unit': 'إضافة وحدة',
  'Choose a unit…': 'اختر وحدة…',
  'Search units…': 'ابحث في الوحدات…',
  'Typed by hand': 'مكتوبة يدويًا',
  'Item codes (SKU)': 'رموز الأصناف',
  'Codes for items, printed on labels as a QR code that any scanner types into item search.':
    'رموز للأصناف تُطبع على الملصقات كرمز QR يكتبه أي ماسح ضوئي في بحث الأصناف.',
  'Give new items a code': 'إعطاء الأصناف الجديدة رمزًا',
  'A new item saved without an SKU gets the next code, such as {code}. SKUs typed by hand stay as they are.':
    'الصنف الجديد المحفوظ دون رمز يأخذ الرمز التالي، مثل {code}. تبقى الرموز المكتوبة يدويًا كما هي.',
  'Give codes to items without one': 'إعطاء رموز للأصناف التي ليس لها رمز',
  'Give codes to {count} items?': {
    one: 'إعطاء رمز لصنف واحد؟',
    two: 'إعطاء رموز لصنفين؟',
    few: 'إعطاء رموز لـ {count} أصناف؟',
    many: 'إعطاء رموز لـ {count} صنفًا؟',
    other: 'إعطاء رموز لـ {count} صنف؟',
  },
  'They get the next codes, in the order they were added. You can print their labels afterwards.':
    'تأخذ الرموز التالية بترتيب إضافتها، ويمكنك طباعة ملصقاتها بعد ذلك.',
  'Give codes': 'إعطاء الرموز',
  '{count} items have codes now': {
    one: 'صار لصنف واحد رمز',
    two: 'صار لصنفين رمزان',
    few: 'صار لـ {count} أصناف رموز',
    many: 'صار لـ {count} صنفًا رموز',
    other: 'صار لـ {count} صنف رموز',
  },
  '{count} items have no code yet.': {
    one: 'صنف واحد ليس له رمز بعد.',
    two: 'صنفان ليس لهما رمز بعد.',
    few: '{count} أصناف ليس لها رمز بعد.',
    many: '{count} صنفًا ليس لها رمز بعد.',
    other: '{count} صنف ليس لها رمز بعد.',
  },
  'Owners, admins and accountants set up items. You can look at it.':
    'يُعِدّ المالكون والمسؤولون والمحاسبون الأصناف، ويمكنك الاطلاع عليها.',
  'Item codes given to {count} items': 'أُعطيت رموز لـ {count} من الأصناف',
  'Another item already has the SKU {sku}.': 'رمز الصنف {sku} مستخدم لصنف آخر.',
  'Left blank, the item gets the next code.': 'إذا تُرك فارغًا يأخذ الصنف الرمز التالي.',
  'The QR code of the SKU, for labels: a scanner types it into item search.':
    'رمز QR لرمز الصنف، للملصقات: يكتبه الماسح الضوئي في بحث الأصناف.',
  'Labels printed with {sku} will no longer find this item. Print new ones after saving.':
    'الملصقات المطبوعة بالرمز {sku} لن تجد هذا الصنف بعد الآن. اطبع ملصقات جديدة بعد الحفظ.',
  'QR code of {sku}': 'رمز QR لـ {sku}',
  'Print label': 'طباعة الملصق',
  'Print labels': 'طباعة الملصقات',
  'Product list': 'قائمة الأصناف',
  'Price list': 'قائمة الأسعار',
  'Selected items': 'الأصناف المحددة',
  '{count} selected': {
    one: 'تم تحديد واحد',
    two: 'تم تحديد اثنين',
    few: 'تم تحديد {count}',
    many: 'تم تحديد {count}',
    other: 'تم تحديد {count}',
  },
  'Clear selection': 'إلغاء التحديد',
  'Select all': 'تحديد الكل',
  'Select {name}': 'تحديد {name}',
  'Same SKU as another item': 'رمز الصنف نفسه لصنف آخر',
  '{count} SKUs are each used by more than one item': {
    one: 'رمز صنف واحد مستخدم لأكثر من صنف',
    two: 'رمزا صنف كلٌّ منهما مستخدم لأكثر من صنف',
    few: '{count} رموز أصناف كلٌّ منها مستخدم لأكثر من صنف',
    many: '{count} رمزًا كلٌّ منها مستخدم لأكثر من صنف',
    other: '{count} رمز كلٌّ منها مستخدم لأكثر من صنف',
  },
  'The codes were given on several devices at once, without the cloud. Give one of the items a new SKU, and print its labels again.':
    'أُعطيت الرموز على عدة أجهزة في الوقت نفسه دون السحابة. أعطِ أحد الأصناف رمزًا جديدًا واطبع ملصقاته من جديد.',
  'A4 sheet, 3 × 8 labels': 'ورقة A4، 3 × 8 ملصقات',
  'Thermal label, 50 × 25 mm': 'ملصق حراري، 50 × 25 مم',
  'Show the labels': 'عرض الملصقات',
  'Test page': 'صفحة اختبار',
  'The QR code holds the SKU: a scanner types it into item search.':
    'يحمل رمز QR رمز الصنف: يكتبه الماسح الضوئي في بحث الأصناف.',
  'Copies of each': 'عدد النسخ من كل صنف',
  'Start at label': 'البدء من الملصق',
  'To use a sheet that has labels missing.': 'لاستخدام ورقة نقصت منها ملصقات.',
  'Move right (mm)': 'تحريك لليمين (مم)',
  'Move down (mm)': 'تحريك للأسفل (مم)',
  'Remembered on this device.': 'يُحفظ على هذا الجهاز.',
  'Show the price': 'إظهار السعر',
  'Print the grid on plain paper and hold it over a sheet of labels: if the lines are off, move the labels by that much.':
    'اطبع الشبكة على ورق عادي وضعها فوق ورقة الملصقات: إذا انحرفت الخطوط فحرّك الملصقات بمقدار الانحراف.',
  'Nothing to print.': 'لا شيء للطباعة.',
  'Sheet {number}': 'الورقة {number}',
  '{count} items': {
    one: 'صنف واحد',
    two: 'صنفان',
    few: '{count} أصناف',
    many: '{count} صنفًا',
    other: '{count} صنف',
  },
  '{count} items have no SKU, so they have no label.': {
    one: 'صنف واحد ليس له رمز، فلا ملصق له.',
    two: 'صنفان ليس لهما رمز، فلا ملصق لهما.',
    few: '{count} أصناف ليس لها رمز، فلا ملصقات لها.',
    many: '{count} صنفًا ليس لها رمز، فلا ملصقات لها.',
    other: '{count} صنف ليس لها رمز، فلا ملصقات لها.',
  },
} satisfies Dictionary;
