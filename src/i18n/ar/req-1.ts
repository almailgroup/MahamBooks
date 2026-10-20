import type { Dictionary } from '../index';

/** Employee search across companies: People → All companies, its switches and the search. */
export default {
  'All companies': 'كل الشركات',
  'Search all companies': 'البحث في كل الشركات',
  'Employees of {count} companies on this device': {
    zero: 'لا توجد شركات على هذا الجهاز',
    one: 'موظفو شركة واحدة على هذا الجهاز',
    two: 'موظفو شركتين على هذا الجهاز',
    few: 'موظفو {count} شركات على هذا الجهاز',
    many: 'موظفو {count} شركة على هذا الجهاز',
    other: 'موظفو {count} شركة على هذا الجهاز',
  },
  'Employees of the companies on this device': 'موظفو الشركات على هذا الجهاز',
  'No company is switched on yet': 'لم تُفعَّل أي شركة بعد',
  'Switch on below the companies whose employees you want to find from one place.':
    'فعّل أدناه الشركات التي تريد العثور على موظفيها من مكان واحد.',
  'Companies searched': 'الشركات المشمولة بالبحث',
  'Switch on the companies whose employees you want to find here and in search.':
    'فعّل الشركات التي تريد العثور على موظفيها هنا وفي البحث.',
  'Your role doesn’t show employees in any company on this device. Ask the owner if you need them.':
    'لا يتيح لك دورك رؤية الموظفين في أي شركة على هذا الجهاز. اطلب ذلك من المالك إذا احتجت إليه.',
  '{company} is open now.': 'تم فتح {company}.',
  'Employee search across companies': 'البحث عن الموظفين في كل الشركات',
  'Find the employees of the companies switched on here from any of them: on People → All companies and in search. Salaries, IBANs and Civil IDs aren’t shown there.':
    'اعثر على موظفي الشركات المفعّلة هنا من أي منها: في مهام بيبول ← كل الشركات وفي البحث. لا تظهر هناك الرواتب ولا أرقام الآيبان ولا الأرقام المدنية.',
  'Employees in other companies': 'موظفون في شركات أخرى',
  'Employees included in the search across companies': 'تم إدراج الموظفين في البحث في كل الشركات',
  'Employees left out of the search across companies': 'تم استبعاد الموظفين من البحث في كل الشركات',
} satisfies Dictionary;
