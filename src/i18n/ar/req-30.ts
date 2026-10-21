import type { Dictionary } from '../index';

/** Importing stock items from Excel or CSV: types, costs, quantities and warehouses. */
export default {
  'Item type': 'نوع الصنف',
  'Names in English and Arabic, codes, units, prices and opening stock.':
    'الأسماء بالإنجليزية والعربية، والرموز والوحدات والأسعار والمخزون الافتتاحي.',
  '“{value}” is not a number.': '«{value}» ليس رقمًا.',
  '“{value}” is not a quantity.': '«{value}» ليس كمية.',
  'The quantity can’t be negative.': 'لا يمكن أن تكون الكمية سالبة.',
  'The unit {unit} is not in the list of units; it is kept as written.':
    'الوحدة {unit} ليست في قائمة الوحدات، فتبقى كما كُتبت.',
  'No warehouse is called {name}.': 'لا يوجد مستودع باسم {name}.',
  'Updates the item already in your items.': 'يحدّث الصنف الموجود في أصنافك.',
  'Nothing to change.': 'لا شيء لتغييره.',
  'Already in your items: only its stock is taken.': 'موجود في أصنافك: يؤخذ مخزونه فقط.',
  'The type of an item already in your items is not changed by an import.':
    'لا يغيّر الاستيراد نوع صنف موجود في أصنافك.',
  'More than one item is called {name}. Add the SKU to say which.':
    'يوجد أكثر من صنف باسم {name}. أضف رمز الصنف لتحديد المقصود.',
  'Type “{value}” not recognised; imported as a stock item, as it has a quantity.':
    'لم يُتعرّف على النوع «{value}»، فاستُورد صنفًا مخزنيًا لأن له كمية.',
  'Type “{value}” not recognised; imported as a service.':
    'لم يُتعرّف على النوع «{value}»، فاستُورد خدمة.',
  '{name} is not a stock item, so it can’t have a quantity.':
    '{name} ليس صنفًا مخزنيًا، فلا يمكن أن تكون له كمية.',
  '{name} already has a quantity for this warehouse on another row.':
    'لـ {name} كمية لهذا المستودع في صف آخر.',
  'It has stock history, so the quantity is a count: {quantity} on record.':
    'لهذا الصنف حركات مخزون، فالكمية جرد: المسجّل {quantity}.',
  'No cost price: this stock is valued at nothing.':
    'لا يوجد سعر تكلفة: يُقيّم هذا المخزون بلا قيمة.',
  'Stock recorded': 'تم تسجيل المخزون',
  '{quantity} in {warehouse}': '{quantity} في {warehouse}',
  'Main store': 'المستودع الرئيسي',
  'Your opening balances already put {amount} on the inventory account. Stock imported here adds to it, so it would be counted twice.':
    'تضع أرصدتك الافتتاحية {amount} في حساب المخزون مسبقًا. المخزون المستورد هنا يُضاف إليه، فيُحتسب مرتين.',
  'Keep stock out of the opening balances and import it here.':
    'أبقِ المخزون خارج الأرصدة الافتتاحية واستورده هنا.',
  'Opening stock already put {amount} on the inventory account. The inventory in this file adds to it, so it would be counted twice.':
    'وضع المخزون الافتتاحي {amount} في حساب المخزون مسبقًا. المخزون الوارد في هذا الملف يُضاف إليه، فيُحتسب مرتين.',
  'Leave the inventory account out of this file: the opening stock is already imported.':
    'اترك حساب المخزون خارج هذا الملف: المخزون الافتتاحي مستورد مسبقًا.',
  'Import the opening balances?': 'استيراد الأرصدة الافتتاحية؟',
  'Post the stock in this file?': 'ترحيل المخزون الوارد في هذا الملف؟',
  'Opening stock worth {amount} goes to opening balance equity, dated {date}.':
    'يُرحّل مخزون افتتاحي بقيمة {amount} مقابل الأرصدة الافتتاحية بتاريخ {date}.',
  '{count} items with stock history are counted: the differences post as a stock adjustment.': {
    one: 'صنف واحد له حركات مخزون يُجرد: يُرحّل الفرق تسويةً للمخزون.',
    two: 'صنفان لهما حركات مخزون يُجردان: تُرحّل الفروقات تسويةً للمخزون.',
    few: '{count} أصناف لها حركات مخزون تُجرد: تُرحّل الفروقات تسويةً للمخزون.',
    many: '{count} صنفًا له حركات مخزون يُجرد: تُرحّل الفروقات تسويةً للمخزون.',
    other: '{count} صنف له حركات مخزون يُجرد: تُرحّل الفروقات تسويةً للمخزون.',
  },
  'Import and post stock': 'استيراد وترحيل المخزون',
  'Stock as at': 'المخزون كما في',
  'Opening stock and counts are dated this day: usually the last day of last month.':
    'يؤرَّخ المخزون الافتتاحي والجرد بهذا اليوم، وعادةً آخر يوم من الشهر الماضي.',
  'For rows that name no warehouse.': 'للصفوف التي لا تذكر مستودعًا.',
  'With a quantity column, stock items get their opening stock at the cost price, booked against opening balance equity. Items with stock history are counted instead. Nothing is posted until you confirm.':
    'مع عمود للكمية تأخذ الأصناف المخزنية مخزونها الافتتاحي بسعر التكلفة مقابل الأرصدة الافتتاحية، وتُجرد الأصناف التي لها حركات مخزون بدلًا من ذلك. لا يُرحّل شيء قبل أن تؤكد.',
  'Only owners, admins and accountants bring in stock quantities.':
    'يستورد كميات المخزون المالكون والمسؤولون والمحاسبون فقط.',
  'Stock entries {numbers}': 'قيود المخزون {numbers}',
  'View the stock entries': 'عرض قيود المخزون',
  'Update existing items': 'تحديث الأصناف الموجودة',
  'Items already here (same SKU, or same name when the file has no SKU) get the prices and details in the file.':
    'تأخذ الأصناف الموجودة (بنفس الرمز، أو بنفس الاسم إن لم يكن في الملف رمز) الأسعار والتفاصيل الواردة في الملف.',
  'Files with stock are imported only when every row is right.':
    'لا تُستورد الملفات التي فيها مخزون إلا إذا كانت كل الصفوف صحيحة.',
  '{count} items updated': {
    one: 'تم تحديث صنف واحد',
    two: 'تم تحديث صنفين',
    few: 'تم تحديث {count} أصناف',
    many: 'تم تحديث {count} صنفًا',
    other: 'تم تحديث {count} صنف',
  },
  '{count} new items without an SKU get the next item codes.': {
    one: 'صنف جديد واحد بلا رمز يأخذ رمز الصنف التالي.',
    two: 'صنفان جديدان بلا رمز يأخذان رمزي الصنف التاليين.',
    few: '{count} أصناف جديدة بلا رمز تأخذ رموز الأصناف التالية.',
    many: '{count} صنفًا جديدًا بلا رمز تأخذ رموز الأصناف التالية.',
    other: '{count} صنف جديد بلا رمز تأخذ رموز الأصناف التالية.',
  },
  '{count} warehouses': {
    one: 'مستودع واحد',
    two: 'مستودعان',
    few: '{count} مستودعات',
    many: '{count} مستودعًا',
    other: '{count} مستودع',
  },
} satisfies Dictionary;
