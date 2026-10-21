import type { Dictionary } from '../index';

/** Departments (the company's list, bulk assignment) and stateless (Bedoon) staff. */
export default {
  // Stateless staff and the Central Agency review card
  'Stateless (Bedoon)': 'غير محدد الجنسية (بدون)',
  'Central Agency review card': 'بطاقة المراجعة (الجهاز المركزي)',
  'Review card number': 'رقم بطاقة المراجعة',
  'Review card expiry': 'تاريخ انتهاء بطاقة المراجعة',
  'Stateless (Bedoon) in the file: not changed for an employee already here. Choose it on their page.':
    'غير محدد الجنسية (بدون) في الملف: لا يتغير لموظف موجود مسبقًا. اختره من صفحته.',
  'Stateless staff hold a review card, not a residency: {values} kept as the review card.':
    'يحمل غير محددي الجنسية بطاقة مراجعة لا إقامة: حُفظ {values} كبطاقة المراجعة.',
  'Not insured with PIFSS. No residency needed: they hold a Central Agency review card. A work permit is optional.':
    'غير مشمول بالتأمينات الاجتماعية. لا يحتاج إلى إقامة: يحمل بطاقة المراجعة من الجهاز المركزي. إذن العمل اختياري.',
  'Stateless staff hold a review card instead of a residency. The work permit is optional.':
    'يحمل غير محددي الجنسية بطاقة المراجعة بدل الإقامة. إذن العمل اختياري.',
  '{count} stateless (Bedoon) employees: a review card instead of a residency.': {
    one: 'موظف واحد غير محدد الجنسية (بدون): بطاقة المراجعة بدل الإقامة.',
    two: 'موظفان غير محددي الجنسية (بدون): بطاقة المراجعة بدل الإقامة.',
    few: '{count} موظفين غير محددي الجنسية (بدون): بطاقة المراجعة بدل الإقامة.',
    many: '{count} موظفًا غير محددي الجنسية (بدون): بطاقة المراجعة بدل الإقامة.',
    other: '{count} موظف غير محددي الجنسية (بدون): بطاقة المراجعة بدل الإقامة.',
  },

  // Departments
  'Add department': 'إضافة قسم',
  'Add the departments in use': 'إضافة الأقسام المستخدمة',
  'Department added': 'تمت إضافة القسم',
  'Department saved': 'تم حفظ القسم',
  'Department name': 'اسم القسم',
  'Departments merged': 'تم دمج القسمين',
  'No Arabic name': 'بدون اسم عربي',
  'Not in the list': 'غير موجودة في القائمة',
  'Other…': 'أخرى…',
  Rename: 'إعادة تسمية',
  'Merge into': 'الدمج في',
  'Merge into…': 'دمج في…',
  'Merge {from} into {to}?': 'دمج {from} في {to}؟',
  'Rename {from} to {to}?': 'إعادة تسمية {from} إلى {to}؟',
  '{name} leaves the list.': 'سيُحذف {name} من القائمة.',
  'The company’s departments in English and Arabic. Employees keep the English name; the Arabic one shows in Arabic.':
    'أقسام الشركة بالإنجليزية والعربية. يُحفظ للموظفين الاسم الإنجليزي، ويظهر الاسم العربي في الواجهة العربية.',
  'Departments your employees have under another name or spelling. Add them, or merge them into one of the list.':
    'أقسام لدى موظفيك باسم أو بكتابة أخرى. أضفها، أو ادمجها في أحد أقسام القائمة.',
  'Your employees already have {count} departments. Start the list with them?': {
    one: 'لدى موظفيك قسم واحد بالفعل. هل تبدأ القائمة به؟',
    two: 'لدى موظفيك قسمان بالفعل. هل تبدأ القائمة بهما؟',
    few: 'لدى موظفيك {count} أقسام بالفعل. هل تبدأ القائمة بها؟',
    many: 'لدى موظفيك {count} قسمًا بالفعل. هل تبدأ القائمة بها؟',
    other: 'لدى موظفيك {count} قسم بالفعل. هل تبدأ القائمة بها؟',
  },
  '{count} departments added': {
    zero: 'لم يُضف أي قسم',
    one: 'تمت إضافة قسم واحد',
    two: 'تمت إضافة قسمين',
    few: 'تمت إضافة {count} أقسام',
    many: 'تمت إضافة {count} قسمًا',
    other: 'تمت إضافة {count} قسم',
  },
  '{count} employees move to {department}.': {
    zero: 'لن يُنقل أي موظف إلى {department}.',
    one: 'سيُنقل موظف واحد إلى {department}.',
    two: 'سيُنقل موظفان إلى {department}.',
    few: 'سيُنقل {count} موظفين إلى {department}.',
    many: 'سيُنقل {count} موظفًا إلى {department}.',
    other: 'سيُنقل {count} موظف إلى {department}.',
  },
  '{count} employees in it get the new name. Someone changing them on another device at the same time may keep the old one.':
    {
      one: 'سيحصل الموظف الذي فيه على الاسم الجديد. إذا عدّله أحد على جهاز آخر في الوقت نفسه فقد يبقى الاسم القديم.',
      two: 'سيحصل الموظفان اللذان فيه على الاسم الجديد. إذا عدّلهما أحد على جهاز آخر في الوقت نفسه فقد يبقى الاسم القديم.',
      few: 'سيحصل {count} موظفين فيه على الاسم الجديد. إذا عدّلهم أحد على جهاز آخر في الوقت نفسه فقد يبقى الاسم القديم.',
      many: 'سيحصل {count} موظفًا فيه على الاسم الجديد. إذا عدّلهم أحد على جهاز آخر في الوقت نفسه فقد يبقى الاسم القديم.',
      other:
        'سيحصل {count} موظف فيه على الاسم الجديد. إذا عدّلهم أحد على جهاز آخر في الوقت نفسه فقد يبقى الاسم القديم.',
    },
  'Enter the department’s name.': 'أدخل اسم القسم.',
  'There is already a department called {name}.': 'يوجد قسم باسم {name} بالفعل.',
  'This department could not be found.': 'تعذر العثور على هذا القسم.',
  'Choose another department to merge into.': 'اختر قسمًا آخر للدمج فيه.',
  'Could not save the departments.': 'تعذر حفظ الأقسام.',

  // Choosing employees on the list
  'Selected employees': 'الموظفون المحددون',
  'Select all shown': 'تحديد كل المعروضين',
  'Select {name}': 'تحديد {name}',
  'Clear selection': 'إلغاء التحديد',
  '{count} selected': 'المحدد: {count}',
  'For the {count} employees selected.': {
    one: 'للموظف المحدد.',
    two: 'للموظفين المحددين.',
    few: 'للموظفين المحددين وعددهم {count}.',
    many: 'للموظفين المحددين وعددهم {count}.',
    other: 'للموظفين المحددين وعددهم {count}.',
  },
  '{count} employees moved': {
    zero: 'لم يُنقل أي موظف',
    one: 'تم نقل موظف واحد',
    two: 'تم نقل موظفين',
    few: 'تم نقل {count} موظفين',
    many: 'تم نقل {count} موظفًا',
    other: 'تم نقل {count} موظف',
  },
  'They are all in it already.': 'جميعهم في هذا القسم بالفعل.',

  // Activity
  'Department {name} added': 'تمت إضافة القسم {name}',
  'Departments added from the employees: {names}': 'تمت إضافة أقسام الموظفين: {names}',
  'Department {from} renamed {to}': 'تمت إعادة تسمية القسم {from} إلى {to}',
  'Arabic name of the department {name} changed': 'تم تغيير الاسم العربي للقسم {name}',
  'Department {name} archived': 'تمت أرشفة القسم {name}',
  'Department {name} restored': 'تمت استعادة القسم {name}',
  'Department {from} merged into {to}': 'تم دمج القسم {from} في {to}',
  '{count} employee moved to {department}': 'تم نقل {count} موظف إلى {department}',
  '{count} employees moved to {department}': 'تم نقل {count} موظفين إلى {department}',
  '{count} employee taken out of their department': 'تم إخراج {count} موظف من قسمه',
  '{count} employees taken out of their department': 'تم إخراج {count} موظفين من أقسامهم',
  'Take them out of their department': 'إخراجهم من أقسامهم',
} satisfies Dictionary;
