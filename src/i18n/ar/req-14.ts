import type { Dictionary } from '../index';

/** The company's annual leave policy and employees' own entitlements. */
export default {
  // Payroll → Settings: Annual leave
  'The law’s leave applies: 30 working days a year, 2.5 days for each month of service, usable after nine months (art. 70). Unused days carry forward and are paid when the employee leaves (art. 73).':
    'تُطبَّق إجازة القانون: 30 يوم عمل في السنة، بواقع 2.5 يوم عن كل شهر خدمة، ويمكن أخذها بعد تسعة أشهر من الخدمة (المادة 70). تُرحَّل الأيام غير المستخدمة ويُدفع مقابلها عند انتهاء خدمة الموظف (المادة 73).',
  'Set a policy for more days a year, contract entitlements, a cap on the days carried forward, or leave counted in calendar days. Balances before the date it applies from don’t change.':
    'حدِّد سياسة لمنح أيام أكثر في السنة، أو استحقاقات بحسب العقود، أو حدٍّ أقصى للأيام المرحَّلة، أو احتساب الإجازة بالأيام التقويمية. لا تتغير الأرصدة قبل تاريخ سريانها.',
  'Set the company’s leave policy': 'تحديد سياسة الإجازات للشركة',
  'Days a year are earned from their date on; balances before the first date are the law’s and don’t change.':
    'تُستحق أيام السنة اعتبارًا من تاريخها؛ أما الأرصدة قبل أول تاريخ فتبقى وفق القانون ولا تتغير.',
  'Days a year': 'الأيام في السنة',
  'At least 30 days a year (art. 70).': '30 يومًا في السنة على الأقل (المادة 70).',
  'This date has passed: balances from it change, and the next approved pay run’s leave provision takes in the difference.':
    'هذا التاريخ قد مضى: تتغير الأرصدة اعتبارًا منه، ويشمل مخصص الإجازات في مسير الرواتب المعتمد التالي الفرق.',
  'Change the days from a date': 'تغيير الأيام اعتبارًا من تاريخ',
  'Months before the first leave': 'الأشهر قبل أول إجازة',
  'Nine under the Labour Law (art. 70); fewer lets new staff take leave sooner.':
    'تسعة أشهر وفق قانون العمل (المادة 70)؛ والأقل يتيح للموظفين الجدد أخذ الإجازة مبكرًا.',
  'Most days carried into a new year': 'الحد الأقصى للأيام المرحَّلة إلى سنة جديدة',
  'Unused days above it are lost when a new year starts. Leave it empty to carry every day forward: unused days are paid when the employee leaves (art. 73).':
    'تسقط الأيام غير المستخدمة الزائدة عنه عند بداية كل سنة جديدة. اتركه فارغًا لترحيل جميع الأيام: يُدفع مقابل الأيام غير المستخدمة عند انتهاء خدمة الموظف (المادة 73).',
  'No cap': 'بدون حد',
  'Leave is counted in': 'تُحتسب الإجازة بـ',
  'Working days': 'أيام العمل',
  'Calendar days': 'الأيام التقويمية',
  'Annual leave has been recorded, so the way it is counted stays as it is.':
    'سُجلت إجازات سنوية، لذا تبقى طريقة احتسابها كما هي.',

  // Refusals when saving
  'Enter the date the leave policy applies from.': 'أدخل التاريخ الذي تسري منه سياسة الإجازات.',
  'Annual leave can’t be less than 30 days a year (art. 70).':
    'لا يجوز أن تقل الإجازة السنوية عن 30 يومًا في السنة (المادة 70).',
  'Annual leave has been recorded, so the way it is counted can’t change.':
    'سُجلت إجازات سنوية، لذا لا يمكن تغيير طريقة احتسابها.',

  // Balances
  '{days} days a year, {monthly} days for each month of service (art. 70).':
    '{days} يومًا في السنة، بواقع {monthly} يوم عن كل شهر خدمة (المادة 70).',
  '{days} days a year in their contract, {monthly} days for each month of service.':
    '{days} يومًا في السنة بحسب عقده، بواقع {monthly} يوم عن كل شهر خدمة.',
  'Over the carry-forward cap': 'ما تجاوز حد الترحيل',
  'Annual leave can be taken from {date}, after {count} months of service.': {
    zero: 'يمكن أخذ الإجازة السنوية اعتبارًا من {date}.',
    one: 'يمكن أخذ الإجازة السنوية اعتبارًا من {date}، بعد شهر واحد من الخدمة.',
    two: 'يمكن أخذ الإجازة السنوية اعتبارًا من {date}، بعد شهرين من الخدمة.',
    few: 'يمكن أخذ الإجازة السنوية اعتبارًا من {date}، بعد {count} أشهر من الخدمة.',
    many: 'يمكن أخذ الإجازة السنوية اعتبارًا من {date}، بعد {count} شهرًا من الخدمة.',
    other: 'يمكن أخذ الإجازة السنوية اعتبارًا من {date}، بعد {count} شهر من الخدمة.',
  },
  'Balances in days on {date}: {days} days a month, less leave taken.':
    'الأرصدة بالأيام في {date}: {days} يوم عن كل شهر، مخصومًا منها الإجازات المأخوذة.',
  'Balances in days on {date}: {days} days a month, or each employee’s own entitlement, less leave taken.':
    'الأرصدة بالأيام في {date}: {days} يوم عن كل شهر، أو بحسب استحقاق كل موظف، مخصومًا منها الإجازات المأخوذة.',

  // The employee's form
  'Annual leave days': 'أيام الإجازة السنوية',
  'Days a year in their contract, in place of the company’s {days}. Their balance is counted at this rate from their hire date or opening balance.':
    'الأيام في السنة بحسب عقده، بدلًا من {days} يومًا للشركة. يُحتسب رصيده بهذا المعدل من تاريخ تعيينه أو من رصيده الافتتاحي.',
} satisfies Dictionary;
