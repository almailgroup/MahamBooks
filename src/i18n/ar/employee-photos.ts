import type { Dictionary } from '../index';

/** Employee photos: on the employee's page, in the list, and many at once. */
export default {
  'Photo saved': 'تم حفظ الصورة',
  'Could not save the photo.': 'تعذّر حفظ الصورة.',
  'Remove the photo of {name}?': 'إزالة صورة {name}؟',
  'Photo removed': 'تمت إزالة الصورة',
  'Photo of {name}': 'صورة {name}',
  'Change photo': 'تغيير الصورة',
  'Remove photo': 'إزالة الصورة',
  'Add a photo of {name}': 'إضافة صورة {name}',
  'Choose a photo': 'اختيار صورة',
  'Please choose a photo smaller than 10 MB.': 'يُرجى اختيار صورة أصغر من 10 ميغابايت.',
  'Please choose a photo (JPG, PNG or WebP).': 'يُرجى اختيار صورة (JPG أو PNG أو WebP).',
  '{count} employee photo added': 'تمت إضافة {count} صورة موظف',
  '{count} employee photos added': 'تمت إضافة {count} من صور الموظفين',

  // Many at once
  'Add photos': 'إضافة صور',
  'Choose many photos at once. Each goes to the employee whose number ends its name, like “424.jpg” for employee 000424, or whose name it is.':
    'اختر عدة صور دفعة واحدة. تذهب كل صورة إلى الموظف الذي ينتهي اسم الملف برقمه الوظيفي، مثل «424.jpg» للموظف 000424، أو الذي يحمل الملف اسمه.',
  'Or drop them here. Photos up to 10 MB each.': 'أو أفلتها هنا. صور حتى 10 ميغابايت لكل صورة.',
  'Only photos can be added.': 'يمكن إضافة الصور فقط.',
  'No employee number or name in the file name.': 'لا يوجد رقم وظيفي أو اسم موظف في اسم الملف.',
  'More than one employee has this name.': 'أكثر من موظف يحمل هذا الاسم.',
  'Another photo is chosen for this employee': 'اختيرت صورة أخرى لهذا الموظف',
  'Replaces their current photo': 'تحلّ محل صورته الحالية',
  'Adding photos': 'جارٍ إضافة الصور',
  '{count} photos added': {
    one: 'تمت إضافة صورة واحدة',
    two: 'تمت إضافة صورتين',
    few: 'تمت إضافة {count} صور',
    many: 'تمت إضافة {count} صورة',
    other: 'تمت إضافة {count} صورة',
  },
  'Add {count} photos': {
    zero: 'إضافة الصور',
    one: 'إضافة صورة واحدة',
    two: 'إضافة صورتين',
    few: 'إضافة {count} صور',
    many: 'إضافة {count} صورة',
    other: 'إضافة {count} صورة',
  },
} satisfies Dictionary;
