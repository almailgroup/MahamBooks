import type { Dictionary } from '../index';

/** The company's own leave reasons, their pay, balances and switches (#15). */
export default {
  // Payroll → Leave reasons
  'Leave reasons': 'أسباب الإجازة',
  'Reasons for leave of the company’s own, besides the six types of the Labour Law.':
    'أسباب إجازة خاصة بالشركة، إلى جانب الأنواع الستة في قانون العمل.',
  'Such as emergency leave or compensatory days. Each one says how its leave is paid and what it does to the balances. Leave keeps the pay it was recorded with.':
    'مثل الإجازة الطارئة أو أيام التعويض. يحدد كل سبب كيف تُدفع إجازته وأثرها على الأرصدة. وتبقى كل إجازة بالأجر الذي سُجلت به.',
  'Add a reason': 'إضافة سبب',
  'Offer these reasons when leave is recorded': 'عرض هذه الأسباب عند تسجيل الإجازات',
  'Off: leave is recorded with the six types of the Labour Law only, as before. Leave already recorded with a reason keeps its pay either way.':
    'عند الإيقاف: تُسجَّل الإجازات بالأنواع الستة في قانون العمل فقط، كما كان من قبل. وفي الحالتين تحتفظ الإجازات المسجلة بسبب بأجرها.',
  'Update the app on every device that records leave or prepares pay runs first. Older versions show each reason’s leave as one of the six types (see below each reason), and a pay run they work out can’t be approved here until it is updated from the records.':
    'حدِّث التطبيق أولًا على كل جهاز يُسجِّل الإجازات أو يُعِدّ مسيرات الرواتب. فالإصدارات الأقدم تعرض إجازة كل سبب كأحد الأنواع الستة (انظر أسفل كل سبب)، ولا يمكن اعتماد مسير رواتب أعدّته هنا حتى يُحدَّث من السجلات.',
  'No leave reasons yet': 'لا توجد أسباب إجازة بعد',
  'We recommend emergency leave taken from annual leave, and compensatory days added by hand. Any other reason starts on full pay; give it the most days a year it allows.':
    'نوصي بإجازة طارئة تُخصم من الإجازة السنوية، وأيام تعويض تُضاف يدويًا. ويبدأ أي سبب آخر بأجر كامل؛ وحدِّد له أقصى عدد من الأيام في السنة.',
  'Add the recommended reasons': 'إضافة الأسباب الموصى بها',
  'Recommended leave reasons added': 'أُضيفت أسباب الإجازة الموصى بها',
  'At most {days} days a year': '{days} يوم في السنة كحد أقصى',
  'For: {categories}': 'لـ: {categories}',
  'A note is needed': 'تلزم ملاحظة',
  'Leave reason saved': 'تم حفظ سبب الإجازة',
  'Leave reason archived': 'تمت أرشفة سبب الإجازة',
  'Leave reason restored': 'تمت استعادة سبب الإجازة',
  'Leave reason removed': 'تمت إزالة سبب الإجازة',
  'No leave is recorded with it, so it can be removed.':
    'لم تُسجَّل أي إجازة بهذا السبب، لذا يمكن إزالته.',
  'Leave reasons saved': 'تم حفظ أسباب الإجازة',
  'Leave reasons updated': 'تم تحديث أسباب الإجازة',

  // Long unpaid leave
  'Long unpaid leave': 'الإجازات الطويلة بدون أجر',
  'Annual leave is earned for each month of service, counted from the hire date (or the opening balance).':
    'تُستحق الإجازة السنوية عن كل شهر خدمة، يُحتسب من تاريخ التعيين (أو من الرصيد الافتتاحي).',
  'A month of service with more than {days} days of unpaid leave earns no annual leave':
    'شهر الخدمة الذي تزيد فيه الإجازة بدون أجر على {days} يومًا لا تُستحق عنه إجازة سنوية',
  'Off: every month of service earns annual leave, as before. Unpaid leave counts in calendar days; leave on half pay doesn’t count.':
    'عند الإيقاف: يُستحق عن كل شهر خدمة إجازة سنوية، كما كان من قبل. تُحتسب الإجازة بدون أجر بالأيام التقويمية، ولا تُحتسب الإجازة بنصف أجر.',
  'Ask your auditor to confirm that a month of service with more than 15 days of unpaid leave earns no annual leave before you switch this on: it lowers the annual leave balance, the leave salary provision and the final settlement of staff on long unpaid leave.':
    'اطلب من مدقق الحسابات تأكيد أن شهر الخدمة الذي تزيد فيه الإجازة بدون أجر على 15 يومًا لا تُستحق عنه إجازة سنوية، قبل تشغيل هذا الخيار: فهو يُخفِّض رصيد الإجازة السنوية ومخصص رواتب الإجازات والتسوية النهائية للموظفين في الإجازات الطويلة بدون أجر.',
  'Ask your auditor to confirm how each reason is paid before you switch them on: leave taken from annual leave lowers the annual leave balance and the leave salary provision, and leave on half pay or without pay lowers the month’s pay.':
    'اطلب من مدقق الحسابات تأكيد طريقة دفع كل سبب قبل تشغيل الأسباب: فالإجازة التي تُخصم من الإجازة السنوية تُخفِّض رصيد الإجازة السنوية ومخصص رواتب الإجازات، والإجازة بنصف أجر أو بدون أجر تُخفِّض أجر الشهر.',
  'Months of service that start before this date earn as before.':
    'أشهر الخدمة التي تبدأ قبل هذا التاريخ تُستحق عنها الإجازة كما كان من قبل.',
  '{count} months of service with more than 15 days of unpaid leave earned no leave.': {
    zero: 'لم يمر شهر خدمة زادت فيه الإجازة بدون أجر على 15 يومًا.',
    one: 'شهر خدمة واحد زادت فيه الإجازة بدون أجر على 15 يومًا لم تُستحق عنه إجازة.',
    two: 'شهرا خدمة زادت فيهما الإجازة بدون أجر على 15 يومًا لم تُستحق عنهما إجازة.',
    few: '{count} أشهر خدمة زادت فيها الإجازة بدون أجر على 15 يومًا لم تُستحق عنها إجازة.',
    many: '{count} شهرًا من الخدمة زادت فيها الإجازة بدون أجر على 15 يومًا لم تُستحق عنها إجازة.',
    other: '{count} شهر خدمة زادت فيها الإجازة بدون أجر على 15 يومًا لم تُستحق عنها إجازة.',
  },

  // How a reason is paid
  'Half pay': 'بنصف أجر',
  'Part pay': 'بجزء من الأجر',
  'Taken from annual leave': 'تُخصم من الإجازة السنوية',
  'Full pay, from days added by hand': 'بأجر كامل، من أيام تُضاف يدويًا',
  'Paid in full; the annual leave balance doesn’t change.':
    'تُدفع بأجر كامل، ولا يتغير رصيد الإجازة السنوية.',
  'Each calendar day of it costs half a day’s pay.': 'يُخصم عن كل يوم تقويمي منها نصف أجر يوم.',
  'Each calendar day of it costs a day’s pay, like unpaid leave.':
    'يُخصم عن كل يوم تقويمي منها أجر يوم، مثل الإجازة بدون أجر.',
  'Paid in full and taken from the annual leave balance, like annual leave.':
    'تُدفع بأجر كامل وتُخصم من رصيد الإجازة السنوية، مثل الإجازة السنوية.',
  'Paid in full from a balance of its own: add days to it by hand, such as compensatory days for work on a rest day.':
    'تُدفع بأجر كامل من رصيد خاص بها: أضف إليه الأيام يدويًا، مثل أيام التعويض عن العمل في يوم راحة.',
  'Older versions show it as bereavement leave, paid in full.':
    'تعرضها الإصدارات الأقدم كإجازة وفاة مدفوعة بأجر كامل.',
  'Older versions show it as unpaid leave and pay nothing for it.':
    'تعرضها الإصدارات الأقدم كإجازة بدون أجر ولا تدفع عنها شيئًا.',
  'Older versions show it as unpaid leave.': 'تعرضها الإصدارات الأقدم كإجازة بدون أجر.',
  'Older versions show it as annual leave.': 'تعرضها الإصدارات الأقدم كإجازة سنوية.',

  // The reason dialog
  'Add a leave reason': 'إضافة سبب إجازة',
  'Edit leave reason': 'تعديل سبب الإجازة',
  'Leave of this reason is recorded and paid as set here.':
    'تُسجَّل إجازات هذا السبب وتُدفع كما هو محدد هنا.',
  'How it is paid': 'طريقة الدفع',
  'Leave is recorded with this reason, so how it is paid stays as it is. To change it, archive this reason and add a new one.':
    'سُجلت إجازات بهذا السبب، لذا تبقى طريقة دفعه كما هي. لتغييرها، أرشِف هذا السبب وأضف سببًا جديدًا.',
  'Most days a year': 'أقصى عدد من الأيام في السنة',
  'Leave over it is still recorded, with a warning. Leave counts in the year it starts.':
    'تُسجَّل الإجازة التي تتجاوزه مع تنبيه. وتُحتسب الإجازة في السنة التي تبدأ فيها.',
  'No limit': 'بلا حد',
  For: 'لـ',
  'Tick none for everyone. Domestic workers come under their own law (Law 68/2015), so they can have reasons of their own.':
    'لا تحدد أيًّا منها ليكون للجميع. تخضع العمالة المنزلية لقانونها الخاص (القانون 68/2015)، لذا يمكن أن تكون لها أسباب خاصة بها.',
  'Leave of this reason can’t be saved without a note.': 'لا يمكن حفظ إجازة بهذا السبب دون ملاحظة.',
  'Enter the name of each leave reason.': 'أدخل اسم كل سبب إجازة.',

  // Recording leave
  'The company’s leave reasons': 'أسباب الإجازة الخاصة بالشركة',
  'This reason needs a note.': 'هذا السبب يحتاج إلى ملاحظة.',
  'Enter a note: {reason} needs one.': 'أدخل ملاحظة: {reason} يحتاج إلى ملاحظة.',
  '{days} days added and not taken': '{days} يوم مضاف لم يُؤخذ',
  '{taken} of {days} days a year taken': 'أُخذ {taken} من {days} يوم في السنة',
  'More than the {days} days a year this reason allows ({taken} taken this year).':
    'أكثر من {days} يوم في السنة يسمح بها هذا السبب (أُخذ {taken} هذه السنة).',
  'More than the {days} days added for this reason.': 'أكثر من {days} يوم مضاف لهذا السبب.',
  'Add or remove days: {reason}': 'إضافة أيام أو حذفها: {reason}',
  'Days added by hand, such as for work on a rest day. Leave of this reason is taken from them.':
    'أيام تُضاف يدويًا، مثل العمل في يوم راحة. وتُخصم منها إجازات هذا السبب.',

  // The employee's leave
  'The company’s leave reasons in {year}': 'أسباب الإجازة الخاصة بالشركة في {year}',
  'Days taken this year, and the days added for reasons that have them.':
    'الأيام المأخوذة هذه السنة، والأيام المضافة للأسباب التي لها رصيد.',
  '{count} days taken': {
    zero: 'لم يُؤخذ أي يوم',
    one: 'أُخذ يوم واحد',
    two: 'أُخذ يومان',
    few: 'أُخذت {count} أيام',
    many: 'أُخذ {count} يومًا',
    other: 'أُخذ {count} يوم',
  },
  'Add days': 'إضافة أيام',
  'Days added: {reason}': 'أيام مضافة: {reason}',

  // Pay lines and payslips
  'Leave by reason': 'الإجازات حسب السبب',
  '{reason}: {count} days, taken from annual leave.': {
    zero: '{reason}: لا أيام، تُخصم من الإجازة السنوية.',
    one: '{reason}: يوم واحد، يُخصم من الإجازة السنوية.',
    two: '{reason}: يومان، يُخصمان من الإجازة السنوية.',
    few: '{reason}: {count} أيام، تُخصم من الإجازة السنوية.',
    many: '{reason}: {count} يومًا، تُخصم من الإجازة السنوية.',
    other: '{reason}: {count} يوم، تُخصم من الإجازة السنوية.',
  },
  '{reason}: {count} days on full pay.': {
    zero: '{reason}: لا أيام بأجر كامل.',
    one: '{reason}: يوم واحد بأجر كامل.',
    two: '{reason}: يومان بأجر كامل.',
    few: '{reason}: {count} أيام بأجر كامل.',
    many: '{reason}: {count} يومًا بأجر كامل.',
    other: '{reason}: {count} يوم بأجر كامل.',
  },
  '{reason}: {count} days without pay.': {
    zero: '{reason}: لا أيام بدون أجر.',
    one: '{reason}: يوم واحد بدون أجر.',
    two: '{reason}: يومان بدون أجر.',
    few: '{reason}: {count} أيام بدون أجر.',
    many: '{reason}: {count} يومًا بدون أجر.',
    other: '{reason}: {count} يوم بدون أجر.',
  },
  '{reason}: {count} days at {percent} pay.': {
    zero: '{reason}: لا أيام بنسبة {percent} من الأجر.',
    one: '{reason}: يوم واحد بنسبة {percent} من الأجر.',
    two: '{reason}: يومان بنسبة {percent} من الأجر.',
    few: '{reason}: {count} أيام بنسبة {percent} من الأجر.',
    many: '{reason}: {count} يومًا بنسبة {percent} من الأجر.',
    other: '{reason}: {count} يوم بنسبة {percent} من الأجر.',
  },
  'From leave records: {days} calendar days at {percent} pay.':
    'من سجلات الإجازات: {days} يوم تقويمي بنسبة {percent} من الأجر.',
  'Leave this month': 'الإجازات هذا الشهر',

  // Refusals
  'This leave reason could not be found.': 'تعذّر العثور على سبب الإجازة هذا.',
  'The company’s leave reasons are switched off.': 'أسباب الإجازة الخاصة بالشركة متوقفة.',
  'This leave reason is archived.': 'سبب الإجازة هذا مؤرشف.',
  '{reason} isn’t for employees of this category.': '{reason} ليس لموظفي هذه الفئة.',
  'Only a reason paid from days added by hand has a balance to change.':
    'السبب الذي يُدفع من أيام تُضاف يدويًا هو وحده الذي له رصيد يمكن تغييره.',
  '{name} was set up on a newer version of the app. Update the app to record it.':
    'أُعدّ {name} في إصدار أحدث من التطبيق. حدِّث التطبيق لتسجيله.',
  '{name} was set up on a newer version of the app. Update the app to change it.':
    'أُعدّ {name} في إصدار أحدث من التطبيق. حدِّث التطبيق لتغييره.',
  'Leave is recorded with {name}, so it can’t be removed. Archive it instead.':
    'سُجلت إجازات بسبب {name}، لذا لا يمكن إزالته. أرشِفه بدلًا من ذلك.',
  'Leave is recorded with {name}, so how it is paid can’t change. Archive it and add a new reason.':
    'سُجلت إجازات بسبب {name}، لذا لا يمكن تغيير طريقة دفعه. أرشِفه وأضف سببًا جديدًا.',
  'The pay of {name} doesn’t show their leave by reason: it was worked out before that leave was recorded, or on an older version of the app. Click Update from records, then approve.':
    'لا يُظهر أجر {name} إجازاته حسب السبب: فقد احتُسب قبل تسجيل تلك الإجازة أو في إصدار أقدم من التطبيق. انقر «تحديث من السجلات» ثم اعتمد.',
} satisfies Dictionary;
