import type { Dictionary } from '../index';

/** Importing employees, Excel files, and the new employee fields (gender, birth date, salary card). */
export default {
  // Employee fields
  Gender: 'الجنس',
  Male: 'ذكر',
  Female: 'أنثى',
  'Date of birth': 'تاريخ الميلاد',
  'Account or salary card number': 'رقم الحساب أو بطاقة الراتب',
  'For salaries paid to a salary card or an account without an IBAN.':
    'للرواتب التي تُدفع إلى بطاقة راتب أو حساب بدون رقم آيبان.',
  'The IBAN is used for salaries while there is one.':
    'يُستخدم رقم الآيبان لتحويل الراتب ما دام موجوداً.',
  'Show the whole number': 'عرض الرقم كاملاً',
  'Hide the number': 'إخفاء الرقم',
  'Blood group': 'فصيلة الدم',
  'Blood group: {group}': 'فصيلة الدم: {group}',

  // Salary file and payroll
  'Add a valid IBAN or a salary card number for these employees first:':
    'أضف رقم آيبان صحيحاً أو رقم بطاقة راتب لهؤلاء الموظفين أولاً:',
  'No valid IBAN or salary card number: the salary can’t go in the bank file.':
    'لا يوجد رقم آيبان صحيح ولا رقم بطاقة راتب: لا يمكن إدراج الراتب في ملف البنك.',

  // Excel files
  'This file is not a valid Excel workbook.': 'هذا الملف ليس ملف Excel صالحاً.',
  'This browser can’t open Excel files. Save the file as CSV, or use a newer browser.':
    'لا يستطيع هذا المتصفح فتح ملفات Excel. احفظ الملف بصيغة CSV أو استخدم متصفحاً أحدث.',
  'This workbook is too large to import.': 'ملف Excel هذا أكبر من أن يُستورد.',
  'This workbook is protected with a password. Remove the password and try again.':
    'ملف Excel هذا محمي بكلمة مرور. أزل كلمة المرور ثم حاول مرة أخرى.',
  'This workbook has no sheets.': 'لا يحتوي ملف Excel هذا على أوراق عمل.',
  'Older Excel files (.xls) can’t be read. In Excel, save the file as .xlsx or CSV.':
    'لا يمكن قراءة ملفات Excel القديمة (.xls). في Excel احفظ الملف بصيغة .xlsx أو CSV.',
  'A CSV or Excel file with one row per record and the column names in the first row.':
    'ملف CSV أو Excel فيه صف لكل سجل، وأسماء الأعمدة في الصف الأول.',
  'Choose a CSV or Excel file': 'اختيار ملف CSV أو Excel',
  'Or drop it here. Excel files (.xlsx) are read from their first sheet. Arabic column names and text are fine.':
    'أو أفلته هنا. تُقرأ ملفات Excel (.xlsx) من ورقتها الأولى. أسماء الأعمدة والنصوص العربية مدعومة.',

  // Import: the employees kind and its columns
  'Your staff from Zoho People or a spreadsheet, with Civil IDs and papers.':
    'موظفوك من Zoho People أو من جدول بيانات، مع البطاقات المدنية والوثائق.',
  'Only owners, admins and accountants can import employees.':
    'استيراد الموظفين متاح للمالكين والمديرين والمحاسبين فقط.',
  'First name': 'الاسم الأول',
  'Middle name': 'الاسم الأوسط',
  'Last name': 'اسم العائلة',
  'File names with Arabic names': 'أسماء ملفات فيها الأسماء بالعربية',
  'Driving licence number': 'رقم رخصة القيادة',
  'Driving licence expiry': 'تاريخ انتهاء رخصة القيادة',
  Columns: 'الأعمدة',
  '{count} columns matched': {
    zero: 'لم يُطابَق أي عمود',
    one: 'عمود واحد مطابَق',
    two: 'عمودان مطابَقان',
    few: '{count} أعمدة مطابَقة',
    many: '{count} عموداً مطابَقاً',
    other: '{count} عمود مطابَق',
  },
  'Choose the column with the names or the employee numbers.':
    'اختر العمود الذي فيه الأسماء أو الأرقام الوظيفية.',
  'Nothing is saved until you import. Notes are things to check later.':
    'لا يُحفظ شيء حتى تنفّذ الاستيراد. الملاحظات أمور تراجعها لاحقاً.',

  // Import: the check before importing
  '{count} employees will be added': {
    zero: 'لن يُضاف أي موظف',
    one: 'سيُضاف موظف واحد',
    two: 'سيُضاف موظفان',
    few: 'سيُضاف {count} موظفين',
    many: 'سيُضاف {count} موظفاً',
    other: 'سيُضاف {count} موظف',
  },
  '{count} employees will be updated': {
    one: 'سيُحدَّث موظف واحد',
    two: 'سيُحدَّث موظفان',
    few: 'سيُحدَّث {count} موظفين',
    many: 'سيُحدَّث {count} موظفاً',
    other: 'سيُحدَّث {count} موظف',
  },
  '{count} already in your employees, skipped': {
    one: 'موظف واحد موجود مسبقاً، لن يُستورد',
    two: 'موظفان موجودان مسبقاً، لن يُستوردا',
    few: '{count} موظفين موجودون مسبقاً، لن يُستوردوا',
    many: '{count} موظفاً موجودون مسبقاً، لن يُستوردوا',
    other: '{count} موظف موجودون مسبقاً، لن يُستوردوا',
  },
  '{count} rows without a name or number, skipped': {
    one: 'صف واحد بلا اسم ولا رقم، لن يُستورد',
    two: 'صفان بلا اسم ولا رقم، لن يُستوردا',
    few: '{count} صفوف بلا اسم ولا رقم، لن تُستورد',
    many: '{count} صفاً بلا اسم ولا رقم، لن تُستورد',
    other: '{count} صف بلا اسم ولا رقم، لن تُستورد',
  },
  '{count} notes': {
    zero: 'لا ملاحظات',
    one: 'ملاحظة واحدة',
    two: 'ملاحظتان',
    few: '{count} ملاحظات',
    many: '{count} ملاحظة',
    other: '{count} ملاحظة',
  },
  'Import {count} employees': {
    one: 'استيراد موظف واحد',
    two: 'استيراد موظفَين',
    few: 'استيراد {count} موظفين',
    many: 'استيراد {count} موظفاً',
    other: 'استيراد {count} موظف',
  },
  '{count} employees ready': {
    zero: 'لا يوجد موظفون جاهزون',
    one: 'موظف واحد جاهز',
    two: 'موظفان جاهزان',
    few: '{count} موظفين جاهزون',
    many: '{count} موظفاً جاهزاً',
    other: '{count} موظف جاهز',
  },
  'Salaries are not in the file: add them before running payroll.':
    'الرواتب غير موجودة في الملف: أضفها قبل تشغيل مسيّر الرواتب.',
  'Update existing employees': 'تحديث الموظفين الموجودين',
  'Employees already here (same employee number or Civil ID) get the details in the file.':
    'يأخذ الموظفون الموجودون مسبقاً (بالرقم الوظيفي نفسه أو الرقم المدني نفسه) البيانات الموجودة في الملف.',
  'Importing employees': 'جارٍ استيراد الموظفين',
  '{done} of {total}': '{done} من {total}',
  Update: 'تحديث',
  Row: 'الصف',
  Rows: 'الصفوف',
  'Arabic names taken from the document file names for {count} employees.': {
    one: 'أُخذ الاسم بالعربية من اسم ملف المستند لموظف واحد.',
    two: 'أُخذ الاسمان بالعربية من أسماء ملفات المستندات لموظفَين.',
    few: 'أُخذت الأسماء بالعربية من أسماء ملفات المستندات لـ {count} موظفين.',
    many: 'أُخذت الأسماء بالعربية من أسماء ملفات المستندات لـ {count} موظفاً.',
    other: 'أُخذت الأسماء بالعربية من أسماء ملفات المستندات لـ {count} موظف.',
  },
  'Arabic job titles filled in for {count} employees.': {
    one: 'أُضيف المسمى الوظيفي بالعربية لموظف واحد.',
    two: 'أُضيف المسمى الوظيفي بالعربية لموظفَين.',
    few: 'أُضيف المسمى الوظيفي بالعربية لـ {count} موظفين.',
    many: 'أُضيف المسمى الوظيفي بالعربية لـ {count} موظفاً.',
    other: 'أُضيف المسمى الوظيفي بالعربية لـ {count} موظف.',
  },
  '“{column}” is read as the residency expiry, which is normally the Civil ID’s: they are the same for {same} of {total} employees.':
    'يُقرأ «{column}» على أنه تاريخ انتهاء الإقامة، وهو عادةً تاريخ انتهاء البطاقة المدنية: التاريخان متطابقان لـ {same} من أصل {total} موظف.',
  'Nationalities recognised for {count} employees.': {
    one: 'تم التعرّف على الجنسية لموظف واحد.',
    two: 'تم التعرّف على الجنسية لموظفَين.',
    few: 'تم التعرّف على الجنسية لـ {count} موظفين.',
    many: 'تم التعرّف على الجنسية لـ {count} موظفاً.',
    other: 'تم التعرّف على الجنسية لـ {count} موظف.',
  },
  '{count} mobile numbers written the standard way.': {
    one: 'كُتب رقم هاتف نقال واحد بالصيغة المعتادة.',
    two: 'كُتب رقما هاتف نقال بالصيغة المعتادة.',
    few: 'كُتبت {count} أرقام هواتف نقالة بالصيغة المعتادة.',
    many: 'كُتب {count} رقم هاتف نقال بالصيغة المعتادة.',
    other: 'كُتب {count} رقم هاتف نقال بالصيغة المعتادة.',
  },
  '{count} salary card or account numbers.': {
    one: 'رقم بطاقة راتب أو حساب واحد.',
    two: 'رقما بطاقة راتب أو حساب.',
    few: '{count} أرقام بطاقات رواتب أو حسابات.',
    many: '{count} رقماً لبطاقات رواتب أو حسابات.',
    other: '{count} رقم بطاقة راتب أو حساب.',
  },
  '{count} driving licences will be added to the documents register.': {
    one: 'ستُضاف رخصة قيادة واحدة إلى سجل الوثائق.',
    two: 'ستُضاف رخصتا قيادة إلى سجل الوثائق.',
    few: 'ستُضاف {count} رخص قيادة إلى سجل الوثائق.',
    many: 'ستُضاف {count} رخصة قيادة إلى سجل الوثائق.',
    other: 'ستُضاف {count} رخصة قيادة إلى سجل الوثائق.',
  },
  'Documents already expired: {expired}. Expiring within 60 days: {expiring}.':
    'وثائق منتهية: {expired}. وثائق تنتهي خلال 60 يوماً: {expiring}.',
  'Imported employees are active, with a basic salary of 0 until you add their salaries.':
    'الموظفون المستوردون نشطون، وراتبهم الأساسي 0 حتى تضيف رواتبهم.',

  // Import: notes on rows
  '{field}: “{value}” is not a date.': '{field}: «{value}» ليس تاريخاً صحيحاً.',
  'The Arabic name was not taken from “{file}”: it has another employee number.':
    'لم يُؤخذ الاسم بالعربية من «{file}»: فيه رقم وظيفي آخر.',
  'No name or employee number.': 'لا يوجد اسم ولا رقم وظيفي.',
  'Employee number {number} is also on row {line}: this one gets the next free number.':
    'الرقم الوظيفي {number} موجود أيضاً في الصف {line}: سيأخذ هذا الموظف الرقم المتاح التالي.',
  'The same Civil ID is also on row {line}.': 'الرقم المدني نفسه موجود أيضاً في الصف {line}.',
  '{name} ({number}) is already in your employees.': '{name} ({number}) موجود مسبقاً في الموظفين.',
  'Employee {number}': 'الموظف {number}',
  'No name in the file.': 'لا يوجد اسم في الملف.',
  'Nationality “{value}” not recognised.': 'لم يتم التعرّف على الجنسية «{value}».',
  'No nationality in the file.': 'لا توجد جنسية في الملف.',
  'Gender “{value}” not recognised.': 'لم يتم التعرّف على الجنس «{value}».',
  'The hire date is in the future ({date}).': 'تاريخ التعيين في المستقبل ({date}).',
  'No hire date in the file.': 'لا يوجد تاريخ تعيين في الملف.',
  'Basic salary: “{value}” is not an amount.': 'الراتب الأساسي: «{value}» ليس مبلغاً صحيحاً.',
  'The salary card number looks wrong. Check it.': 'يبدو أن رقم بطاقة الراتب غير صحيح. تحقق منه.',
  '{document} expired on {date}.': 'انتهت صلاحية {document} في {date}.',
  '{documents} expired on {date}.': 'انتهت صلاحية {documents} في {date}.',
  '{document} expires on {date}.': 'تنتهي صلاحية {document} في {date}.',
  '{documents} expire on {date}.': 'تنتهي صلاحية {documents} في {date}.',
  'Updates {name} ({number}).': 'سيُحدَّث {name} ({number}).',

  // Import: done
  '{count} employees imported': {
    one: 'تم استيراد {count} موظف',
    two: 'تم استيراد {count} موظفَين',
    few: 'تم استيراد {count} موظفين',
    many: 'تم استيراد {count} موظفاً',
    other: 'تم استيراد {count} موظف',
  },
  '{count} employee imported': 'تم استيراد {count} موظف',
  '{count} employees imported and {updated} updated':
    'تم استيراد {count} من الموظفين وتحديث {updated}',
  '{count} employees updated': {
    one: 'تم تحديث موظف واحد',
    two: 'تم تحديث موظفَين',
    few: 'تم تحديث {count} موظفين',
    many: 'تم تحديث {count} موظفاً',
    other: 'تم تحديث {count} موظف',
  },
  '{count} driving licences in the documents register': {
    one: 'رخصة قيادة واحدة في سجل الوثائق',
    two: 'رخصتا قيادة في سجل الوثائق',
    few: '{count} رخص قيادة في سجل الوثائق',
    many: '{count} رخصة قيادة في سجل الوثائق',
    other: '{count} رخصة قيادة في سجل الوثائق',
  },
} satisfies Dictionary;
