import type { Dictionary } from '../index';

/** Company documents, contracts and vehicles: the register's extras. */
export default {
  // Compliance settings
  'Contracts, customers and vehicles': 'العقود والعملاء والمركبات',
  'Company and customer contracts, cost sheets, what each document is for, the company’s vehicles with their papers, and confidential documents only owners, admins and accountants see.':
    'عقود الشركة والعملاء، وكشوف التكاليف، والغرض من كل وثيقة، ومركبات الشركة مع أوراقها، ووثائق سرية لا يراها إلا الملاك والمديرون والمحاسبون.',
  'Purposes of documents': 'أغراض الوثائق',
  'What documents are for, such as a tender, a site or a bank facility.':
    'الغرض من الوثائق، مثل مناقصة أو موقع عمل أو تسهيلات بنكية.',
  'Add purpose': 'إضافة غرض',
  'Archive {name}': 'أرشفة {name}',
  'Restore {name}': 'استعادة {name}',
  'Contracts, customers and vehicles switched on in the register':
    'تم تفعيل العقود والعملاء والمركبات في سجل الوثائق',
  'Contracts, customers and vehicles switched off in the register':
    'تم إيقاف العقود والعملاء والمركبات في سجل الوثائق',
  'Document purposes updated': 'تم تحديث أغراض الوثائق',
  'Document purpose {name} added': 'تمت إضافة غرض الوثائق {name}',
  'Enter the purpose’s name.': 'أدخل اسم الغرض.',
  'There is already a purpose called {name}.': 'يوجد غرض باسم {name} بالفعل.',
  'Purpose not found': 'الغرض غير موجود',
  'Could not save the purpose.': 'تعذّر حفظ الغرض.',

  // Document types
  'Company contract': 'عقد الشركة',
  'Customer contract': 'عقد العميل',
  'Customer cost sheet': 'كشف تكاليف العميل',

  // The document's form
  'No customer': 'بدون عميل',
  'Choose a customer…': 'اختر عميلاً…',
  'Search customers…': 'البحث في العملاء…',
  'No purpose': 'بدون غرض',
  'Choose a purpose…': 'اختر الغرض…',
  'Search purposes…': 'البحث في الأغراض…',
  'Choose a vehicle…': 'اختر مركبة…',
  'Search vehicles…': 'البحث في المركبات…',
  'New vehicle': 'مركبة جديدة',
  'The cloud needs the latest database script before vehicles can be added.':
    'تحتاج السحابة إلى أحدث نص لقاعدة البيانات قبل إضافة المركبات.',
  'Customer cost sheets can be added once the owner of the company runs the latest database script.':
    'يمكن إضافة كشوف تكاليف العملاء بعد أن يشغّل مالك الشركة أحدث نص لقاعدة البيانات.',
  Confidential: 'سري',
  'Only owners, admins and accountants see it, with its files, renewals and activity.':
    'لا يراها إلا الملاك والمديرون والمحاسبون، مع ملفاتها وتجديداتها وسجل نشاطها.',
  'A confidential document stays confidential.': 'تبقى الوثيقة السرية سرية.',
  'The cloud needs the latest database script first. Ask the owner of the company to run it.':
    'تحتاج السحابة أولاً إلى أحدث نص لقاعدة البيانات. اطلب من مالك الشركة تشغيله.',
  'Make this document confidential?': 'جعل هذه الوثيقة سرية؟',
  'Staff and viewers stop seeing it, its files, renewals and activity: their copies are removed from their devices. This can’t be undone.':
    'لن يرى الموظفون والمشاهدون الوثيقة ولا ملفاتها ولا تجديداتها ولا سجل نشاطها، وتُحذف نسخهم منها من أجهزتهم. لا يمكن التراجع عن ذلك.',
  'Make confidential': 'جعلها سرية',
  'Document {title} made confidential': 'أصبحت الوثيقة {title} سرية',
  'This document is in the cloud already: make it confidential from its form.':
    'هذه الوثيقة في السحابة بالفعل: اجعلها سرية من نموذجها.',
  'Some of its files are not on this device yet. Open them once, then try again.':
    'بعض ملفاتها ليست على هذا الجهاز بعد. افتحها مرة، ثم حاول مجدداً.',
  'Choose a customer of this company.': 'اختر عميلاً من عملاء هذه الشركة.',
  'Choose the customer the document belongs to.': 'اختر العميل الذي تخصه الوثيقة.',
  'Choose a vehicle of this company.': 'اختر مركبة من مركبات هذه الشركة.',
  'Choose a purpose from the list.': 'اختر غرضاً من القائمة.',
  'Enter the document’s title.': 'أدخل عنوان الوثيقة.',

  // The register
  'No file': 'بلا ملف',
  'Every customer': 'كل العملاء',
  'Open {document}': 'فتح {document}',

  // Vehicles
  Vehicles: 'المركبات',
  'Vehicles are switched off': 'المركبات غير مفعّلة',
  'Switch on contracts, customers and vehicles in the compliance settings to keep each vehicle with its papers and its driver.':
    'فعّل العقود والعملاء والمركبات في إعدادات الامتثال لتُحفظ كل مركبة مع أوراقها وسائقها.',
  'The cloud keeps vehicles once the owner of the company runs the latest database script. Until then they can’t be added or changed.':
    'تحفظ السحابة المركبات بعد أن يشغّل مالك الشركة أحدث نص لقاعدة البيانات. وحتى ذلك الحين لا يمكن إضافتها أو تغييرها.',
  'No vehicles yet': 'لا توجد مركبات بعد',
  'Add the company’s vehicles to keep their registration, insurance and other papers together.':
    'أضف مركبات الشركة لتُحفظ دفاترها وتأميناتها وأوراقها الأخرى معاً.',
  'Add vehicle': 'إضافة مركبة',
  'Edit vehicle': 'تعديل المركبة',
  'Current vehicles': 'المركبات الحالية',
  'Every vehicle is archived.': 'كل المركبات مؤرشفة.',
  'Driver: {name}': 'السائق: {name}',
  'Add paper': 'إضافة ورقة',
  'Add a paper for {plate}': 'إضافة ورقة للمركبة {plate}',
  'Edit {plate}': 'تعديل {plate}',
  'No papers yet.': 'لا توجد أوراق بعد.',
  'Link vehicles': 'ربط المركبات',
  'Link the papers of {count} vehicles?': {
    zero: 'ربط أوراق المركبات؟',
    one: 'ربط أوراق مركبة واحدة؟',
    two: 'ربط أوراق مركبتين؟',
    few: 'ربط أوراق {count} مركبات؟',
    many: 'ربط أوراق {count} مركبة؟',
    other: 'ربط أوراق {count} مركبة؟',
  },
  '{count} papers': {
    zero: 'لا أوراق',
    one: 'ورقة واحدة',
    two: 'ورقتان',
    few: '{count} أوراق',
    many: '{count} ورقة',
    other: '{count} ورقة',
  },
  'new vehicle': 'مركبة جديدة',
  'Papers that name the same plate go with one vehicle. A vehicle is added for each plate that isn’t on the list yet.':
    'تُربط الأوراق التي تذكر اللوحة نفسها بمركبة واحدة. وتُضاف مركبة لكل لوحة ليست في القائمة بعد.',
  '{count} papers linked': {
    zero: 'لم تُربط أي ورقة',
    one: 'رُبطت ورقة واحدة',
    two: 'رُبطت ورقتان',
    few: 'رُبطت {count} أوراق',
    many: 'رُبطت {count} ورقة',
    other: 'رُبطت {count} ورقة',
  },
  '{count} vehicles added': {
    zero: 'لم تُضف أي مركبة',
    one: 'أُضيفت مركبة واحدة',
    two: 'أُضيفت مركبتان',
    few: 'أُضيفت {count} مركبات',
    many: 'أُضيفت {count} مركبة',
    other: 'أُضيفت {count} مركبة',
  },
  '{count} vehicle papers in the register aren’t linked to a vehicle.': {
    zero: 'كل أوراق المركبات في السجل مرتبطة بمركباتها.',
    one: 'ورقة مركبة واحدة في السجل غير مرتبطة بمركبة.',
    two: 'ورقتا مركبات في السجل غير مرتبطتين بمركبة.',
    few: '{count} أوراق مركبات في السجل غير مرتبطة بمركبة.',
    many: '{count} ورقة مركبات في السجل غير مرتبطة بمركبة.',
    other: '{count} ورقة مركبات في السجل غير مرتبطة بمركبة.',
  },

  // The vehicle's form
  'Its registration, insurance and other papers are kept with it.':
    'تُحفظ معها دفتر المركبة والتأمين والأوراق الأخرى.',
  'Plate number': 'رقم اللوحة',
  Make: 'الصنع',
  'e.g. Toyota': 'مثل تويوتا',
  Model: 'الطراز',
  'Year made': 'سنة الصنع',
  'Chassis number': 'رقم الشاصي',
  Driver: 'السائق',
  'No driver': 'بدون سائق',
  'Needs a valid driving licence when the company checks them.':
    'تلزمه رخصة قيادة سارية إذا كانت الشركة تتحقق من الرخص.',
  'Not in the asset register': 'ليست في سجل الأصول',
  'Vehicle added': 'تمت إضافة المركبة',
  'Vehicle saved': 'تم حفظ المركبة',
  'Vehicle archived': 'تمت أرشفة المركبة',
  'Vehicle restored': 'تمت استعادة المركبة',
  'Vehicle deleted': 'تم حذف المركبة',
  'Delete this vehicle?': 'حذف هذه المركبة؟',
  'Could not save the vehicle.': 'تعذّر حفظ المركبة.',
  'Could not delete the vehicle.': 'تعذّر حذف المركبة.',
  'Enter the vehicle’s plate number.': 'أدخل رقم لوحة المركبة.',
  'Vehicle {plate} is already on the list.': 'المركبة {plate} موجودة في القائمة بالفعل.',
  'Enter the year it was made, for example 2022.': 'أدخل سنة الصنع، مثل 2022.',
  'Choose the driver from the company’s employees.': 'اختر السائق من موظفي الشركة.',
  'Choose one of the company’s fixed assets.': 'اختر أحد الأصول الثابتة للشركة.',
  'This vehicle has papers in the register. Archive it instead.':
    'لهذه المركبة أوراق في سجل الوثائق. أرشفها بدلاً من حذفها.',
  'Vehicle {plate} added': 'تمت إضافة المركبة {plate}',
  'Vehicle {plate} updated': 'تم تحديث المركبة {plate}',
  'Vehicle {plate} archived': 'تمت أرشفة المركبة {plate}',
  'Vehicle {plate} restored': 'تمت استعادة المركبة {plate}',
  'Vehicle {plate} deleted': 'تم حذف المركبة {plate}',

  // The customer's page
  'Contracts and papers': 'العقود والأوراق',
  'Kept in Compliance, with reminders before each expires.':
    'محفوظة في الامتثال، مع تذكير قبل انتهاء كل منها.',
  'No contracts or papers for this customer yet.': 'لا توجد عقود أو أوراق لهذا العميل بعد.',
} satisfies Dictionary;
