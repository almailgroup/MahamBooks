import type { Dictionary } from '../index';

/** Payroll: pay runs, PIFSS, payslips, the salary file, leave, staff loans and final settlements. */
export default {
  // Navigation and sections
  Payroll: 'الرواتب',
  'Payroll sections': 'أقسام الرواتب',
  'Monthly pay runs, PIFSS, payslips, leave and staff loans.':
    'مسيرات الرواتب الشهرية والتأمينات الاجتماعية وقسائم الرواتب والإجازات وقروض الموظفين.',
  'Pay runs': 'مسيرات الرواتب',
  Leave: 'الإجازات',
  Loans: 'القروض',
  Overview: 'نظرة عامة',
  'End of service': 'نهاية الخدمة',
  'Employee sections': 'أقسام ملف الموظف',

  // General words
  Approved: 'معتمد',
  Paid: 'مدفوعة',
  Verify: 'تحقق',
  'Check the current figure with the authority before relying on it.':
    'تحقق من الرقم الحالي لدى الجهة المختصة قبل الاعتماد عليه.',
  Check: 'للمراجعة',
  Month: 'الشهر',
  Days: 'الأيام',
  days: 'أيام',
  months: 'أشهر',
  None: 'لا يوجد',
  From: 'من',
  Change: 'نوع التغيير',
  Keep: 'إبقاء',
  Approve: 'اعتماد',
  Reopen: 'إعادة فتح',
  Reverse: 'عكس',
  Repaid: 'مسددة',
  Instalment: 'القسط',
  Amounts: 'المبالغ',
  Accounts: 'الحسابات',
  Provisions: 'المخصصات',
  'Payment date': 'تاريخ الدفع',
  'Pay date': 'تاريخ صرف الرواتب',
  'Pay date {date}': 'تاريخ الصرف {date}',
  'Paid on': 'تاريخ الدفع',
  'Paid on {date}': 'دُفعت في {date}',
  '{days} of {total} days': '{days} من {total} يومًا',
  '{start} to {end}': 'من {start} إلى {end}',
  '{count} days': {
    zero: 'لا أيام',
    one: 'يوم واحد',
    two: 'يومان',
    few: '{count} أيام',
    many: '{count} يوماً',
    other: '{count} يوم',
  },
  '{count} employees': {
    zero: 'لا موظفين',
    one: 'موظف واحد',
    two: 'موظفان',
    few: '{count} موظفين',
    many: '{count} موظفًا',
    other: '{count} موظف',
  },
  'Back to payroll': 'العودة إلى الرواتب',
  'Could not save the changes.': 'تعذر حفظ التغييرات.',
  'Debits and credits must be equal.': 'يجب أن يتساوى المدين والدائن.',
  'Reversal of {number}': 'عكس القيد {number}',
  'The books are locked up to {date}. Change the lock date in Settings → Accounting to post on an earlier date.':
    'الدفاتر مقفلة حتى {date}. غيّر تاريخ الإقفال من الإعدادات ← المحاسبة للترحيل بتاريخ سابق.',
  'Choose the bank account the money is paid from.': 'اختر الحساب البنكي الذي يُدفع منه المبلغ.',

  // Accounts and postings
  Salaries: 'الرواتب',
  'Allowances and overtime': 'البدلات والعمل الإضافي',
  'PIFSS – employer share': 'حصة صاحب العمل في التأمينات الاجتماعية',
  'PIFSS – employee share': 'حصة الموظف في التأمينات الاجتماعية',
  'End-of-service indemnity': 'مكافأة نهاية الخدمة',
  'End-of-service indemnity provision': 'مخصص مكافأة نهاية الخدمة',
  'Leave salary': 'رواتب الإجازات',
  'Leave salary provision': 'مخصص الإجازات',
  'Salaries payable': 'رواتب مستحقة',
  'PIFSS payable': 'التأمينات الاجتماعية المستحقة',
  'Staff loans and advances': 'قروض وسلف الموظفين',
  'Other deductions': 'استقطاعات أخرى',
  'Basic salaries': 'الرواتب الأساسية',
  'Net salaries payable': 'صافي الرواتب المستحقة',
  'PIFSS contributions': 'اشتراكات التأمينات الاجتماعية',
  'Loan recoveries': 'استقطاعات القروض',
  'Notice pay': 'بدل مهلة الإنذار',
  'Payroll {period}': 'الرواتب {period}',
  'Payroll provisions {period}': 'مخصصات الرواتب {period}',
  'Salaries {period}': 'رواتب {period}',
  'Salaries {period} paid': 'دفع رواتب {period}',
  'Loan to {name}': 'قرض إلى {name}',
  'Final settlement – {name}': 'المخالصة النهائية – {name}',
  'Final settlement – {name} paid': 'دفع المخالصة النهائية – {name}',

  // Activity
  'Payroll settings updated': 'تم تحديث إعدادات الرواتب',
  'Pay run {period} prepared': 'تم إعداد مسير رواتب {period}',
  'Pay run {period} deleted': 'تم حذف مسير رواتب {period}',
  'Pay run {period} approved': 'تم اعتماد مسير رواتب {period}',
  'Pay run {period} paid': 'تم دفع مسير رواتب {period}',
  'Pay run {period} reopened': 'تمت إعادة فتح مسير رواتب {period}',
  'Payment of pay run {period} undone': 'تم التراجع عن دفع مسير رواتب {period}',
  'Loan to {name} recorded': 'تم تسجيل قرض إلى {name}',
  'Loan to {name} cancelled': 'تم إلغاء القرض إلى {name}',
  'Leave recorded for {name}': 'تم تسجيل إجازة لـ {name}',
  'Leave of {name} updated': 'تم تحديث إجازة {name}',
  'Leave of {name} cancelled': 'تم إلغاء إجازة {name}',
  'Final settlement for {name} posted': 'تم ترحيل المخالصة النهائية لـ {name}',
  'Final settlement for {name} paid': 'تم دفع المخالصة النهائية لـ {name}',
  'Final settlement for {name} reversed': 'تم عكس المخالصة النهائية لـ {name}',
  'Payment of the final settlement for {name} undone':
    'تم التراجع عن دفع المخالصة النهائية لـ {name}',

  // Errors
  'Enter the amount of the loan.': 'أدخل مبلغ القرض.',
  'Enter the monthly instalment.': 'أدخل القسط الشهري.',
  'The instalment can’t be more than the loan.': 'لا يمكن أن يزيد القسط على مبلغ القرض.',
  'Choose the first month of repayment.': 'اختر أول شهر للسداد.',
  'This loan was cancelled.': 'تم إلغاء هذا القرض.',
  'Enter the date the loan was paid.': 'أدخل تاريخ صرف القرض.',
  'Part of this loan was recovered, so it can’t be cancelled.':
    'تم استرداد جزء من هذا القرض، لذا لا يمكن إلغاؤه.',
  'Enter the first day.': 'أدخل اليوم الأول.',
  'The last day can’t be before the first day.': 'لا يمكن أن يسبق اليوم الأخير اليوم الأول.',
  'Leave can’t be longer than a year.': 'لا يمكن أن تزيد الإجازة على سنة.',
  'These dates are all weekends or public holidays.': 'كل هذه الأيام عطلات أسبوعية أو عطلات رسمية.',
  'Enter the number of days.': 'أدخل عدد الأيام.',
  'Choose a month.': 'اختر الشهر.',
  'There is already a pay run for this month.': 'يوجد مسير رواتب لهذا الشهر بالفعل.',
  'No employees were on the payroll in this month.': 'لم يكن أي موظف على الرواتب في هذا الشهر.',
  'This pay run could not be found.': 'تعذر العثور على مسير الرواتب هذا.',
  'Only a draft pay run can be changed. Reopen it first.':
    'لا يمكن تعديل مسير الرواتب إلا وهو مسودة. أعد فتحه أولًا.',
  'This pay run is already paid.': 'تم دفع مسير الرواتب هذا بالفعل.',
  'Enter the pay date.': 'أدخل تاريخ صرف الرواتب.',
  'This pay run was approved before, so it is kept. Change it and approve it again.':
    'تم اعتماد مسير الرواتب هذا من قبل لذا يُحتفظ به. عدّله واعتمده من جديد.',
  'This pay run has no employees.': 'لا يوجد موظفون في مسير الرواتب هذا.',
  'Net pay can’t be below zero. Lower the deductions of {names}.':
    'لا يمكن أن يقل صافي الراتب عن صفر. خفّض استقطاعات {names}.',
  '{name} was paid for this month in a final settlement. Update the pay run.':
    'دُفع راتب {name} عن هذا الشهر في المخالصة النهائية. حدّث مسير الرواتب.',
  'The loan recovery of {name} is more than what is left on the loan. Update the pay run.':
    'استقطاع قرض {name} أكبر من المتبقي على القرض. حدّث مسير الرواتب.',
  'Approve the pay run before recording the payment.': 'اعتمد مسير الرواتب قبل تسجيل الدفع.',
  'Enter the payment date.': 'أدخل تاريخ الدفع.',
  'This pay run is not paid.': 'مسير الرواتب هذا غير مدفوع.',
  'Undo the payment before reopening the pay run.': 'تراجع عن الدفع قبل إعادة فتح مسير الرواتب.',
  'This pay run is not approved.': 'مسير الرواتب هذا غير معتمد.',
  'This employee already has a final settlement.': 'لهذا الموظف مخالصة نهائية بالفعل.',
  'Enter the leaving date.': 'أدخل تاريخ ترك العمل.',
  'The leaving date can’t be before the hire date.':
    'لا يمكن أن يسبق تاريخ ترك العمل تاريخ التعيين.',
  'The pay run of this month already pays this employee. Set the last salary days to 0.':
    'مسير رواتب هذا الشهر يدفع لهذا الموظف بالفعل. اجعل أيام الراتب الأخير 0.',
  'A loan recovery is more than what is left on the loan.':
    'أحد استقطاعات القروض أكبر من المتبقي على القرض.',
  'The deductions are more than what is due. Lower the loan recovery or other deductions.':
    'الاستقطاعات أكبر من المستحق. خفّض استقطاع القرض أو الاستقطاعات الأخرى.',
  'This settlement could not be found.': 'تعذر العثور على هذه المخالصة.',
  'This settlement can’t be paid.': 'لا يمكن دفع هذه المخالصة.',
  'This settlement was reversed.': 'تم عكس هذه المخالصة.',
  'This employee has payroll records. Mark them as left instead.':
    'لهذا الموظف سجلات رواتب. سجّل أنه ترك العمل بدلًا من ذلك.',

  // Pay runs
  'New pay run': 'مسير رواتب جديد',
  'Every employee on the payroll that month is added with their salary, allowances, leave and loan instalments.':
    'يُضاف كل موظف على الرواتب في ذلك الشهر مع راتبه وبدلاته وإجازاته وأقساط قروضه.',
  'Prepare pay run': 'إعداد المسير',
  'Payroll for {month} prepared': 'تم إعداد رواتب {month}',
  'Could not prepare the pay run.': 'تعذر إعداد مسير الرواتب.',
  'Add your employees first': 'أضف موظفيك أولًا',
  'Pay runs are prepared from the employee records: salary, allowances, IBAN and whether they are insured with PIFSS.':
    'تُعد مسيرات الرواتب من سجلات الموظفين: الراتب والبدلات ورقم الآيبان والتأمين لدى التأمينات الاجتماعية.',
  'No pay runs yet': 'لا توجد مسيرات رواتب بعد',
  'Prepare a month’s payroll: pay and overtime, PIFSS, loan instalments, payslips and the bank salary file.':
    'أعدّ رواتب الشهر: الأجر والعمل الإضافي والتأمينات الاجتماعية وأقساط القروض وقسائم الرواتب وملف الرواتب للبنك.',
  'Net pay, {month}': 'صافي الرواتب، {month}',
  'PIFSS, {month}': 'التأمينات الاجتماعية، {month}',
  'Pay by {date}.': 'تُدفع قبل {date}.',
  'Payroll for {month}': 'رواتب {month}',
  'Approve the payroll for {month}?': 'اعتماد رواتب {month}؟',
  'Salaries, PIFSS and deductions are posted to the books on {date}. You can reopen the pay run until it is paid.':
    'تُرحَّل الرواتب والتأمينات الاجتماعية والاستقطاعات إلى الدفاتر بتاريخ {date}. يمكنك إعادة فتح المسير ما لم يُدفع.',
  'Payroll for {month} approved': 'تم اعتماد رواتب {month}',
  'Reopen the payroll for {month}?': 'إعادة فتح رواتب {month}؟',
  'Its entries are reversed so you can change it and approve it again.':
    'تُعكس قيوده لتتمكن من تعديله واعتماده من جديد.',
  'Pay run reopened': 'تمت إعادة فتح مسير الرواتب',
  'Undo the payment?': 'التراجع عن الدفع؟',
  'The payment entry is reversed and the pay run goes back to approved.':
    'يُعكس قيد الدفع ويعود مسير الرواتب معتمدًا.',
  'Undo payment': 'التراجع عن الدفع',
  'Payment undone': 'تم التراجع عن الدفع',
  'Delete this draft?': 'حذف هذه المسودة؟',
  'Nothing was posted for it. You can prepare the month again later.':
    'لم يُرحَّل أي شيء لها. يمكنك إعداد الشهر مرة أخرى لاحقًا.',
  'Draft deleted': 'تم حذف المسودة',
  'Delete draft': 'حذف المسودة',
  'Pay run updated from the records': 'تم تحديث المسير من السجلات',
  'Update from records': 'تحديث من السجلات',
  Payslips: 'قسائم الرواتب',
  'Salary file': 'ملف الرواتب',
  'Cost to the company': 'التكلفة على الشركة',
  'With the employer’s PIFSS share': 'مع حصة صاحب العمل في التأمينات الاجتماعية',
  'Check before paying': 'راجع قبل الدفع',
  'Other deductions go to': 'تُرحّل الاستقطاعات الأخرى إلى',
  'Fines and recoveries of {amount} this month.': 'جزاءات ومبالغ مستردة بقيمة {amount} هذا الشهر.',
  'Select an employee to add overtime, absence, additions or deductions.':
    'اختر موظفًا لإضافة عمل إضافي أو غياب أو إضافات أو استقطاعات.',
  'Wages are due within 7 days of the end of the month (art. 56).':
    'تُستحق الأجور خلال 7 أيام من نهاية الشهر (المادة 56).',
  PIFSS: 'التأمينات الاجتماعية',
  'Employee share': 'حصة الموظف',
  'Employer share': 'حصة صاحب العمل',
  'Total due': 'إجمالي المستحق',
  'In the books': 'في الدفاتر',
  'Nothing is posted until the pay run is approved.': 'لا يُرحَّل شيء قبل اعتماد مسير الرواتب.',
  'Pay the salaries for {month}': 'دفع رواتب {month}',
  'Records the transfer from the bank: Dr salaries payable, Cr bank.':
    'يسجل التحويل من البنك: من حـ/ الرواتب المستحقة إلى حـ/ البنك.',
  'Salaries for {month} paid': 'تم دفع رواتب {month}',
  Earnings: 'المستحقات',
  'Gross pay': 'إجمالي الراتب',
  Deductions: 'الاستقطاعات',
  'Net pay': 'صافي الراتب',

  // Pay line warnings
  'Net pay is below zero. Lower the deductions.': 'صافي الراتب أقل من صفر. خفّض الاستقطاعات.',
  'Loan recovery is over 10% of the wage ({limit}), the most the law allows.':
    'استقطاع القرض يتجاوز 10% من الأجر ({limit})، وهو الحد الأقصى المسموح به قانونًا.',
  'Deductions are over 25% of the wage ({limit}), the most the law allows.':
    'الاستقطاعات تتجاوز 25% من الأجر ({limit})، وهو الحد الأقصى المسموح به قانونًا.',
  'Net pay is below the minimum wage ({minimum}).':
    'صافي الراتب أقل من الحد الأدنى للأجور ({minimum}).',
  'Basic salary is below the salary on the work permit ({permit}).':
    'الراتب الأساسي أقل من الراتب المسجل في إذن العمل ({permit}).',
  'No valid IBAN: the salary can’t go in the bank file.':
    'لا يوجد رقم آيبان صحيح: لا يمكن إدراج الراتب في ملف البنك.',
  'No contribution rates for nationals of {country}. Add them in the payroll settings.':
    'لا توجد نسب اشتراك لمواطني {country}. أضفها في إعدادات الرواتب.',
  'No PIFSS rates are set. Add them in the payroll settings.':
    'لم تُحدد نسب التأمينات الاجتماعية. أضفها في إعدادات الرواتب.',
  'No salary on record.': 'لا يوجد راتب مسجل.',

  // Pay line dialog
  'Pay of {name} updated': 'تم تحديث راتب {name}',
  'Paid for {days} of {total} days this month.': 'يُدفع له عن {days} من {total} يومًا هذا الشهر.',
  'Overtime hours': 'ساعات العمل الإضافي',
  'Hourly rate {rate}: the daily rate over 8 hours.':
    'أجر الساعة {rate}: الأجر اليومي مقسومًا على 8 ساعات.',
  'Working days (+25%)': 'أيام العمل (+25%)',
  'Rest days (+50%)': 'أيام الراحة (+50%)',
  'Public holidays (double)': 'العطلات الرسمية (أجر مضاعف)',
  'Unpaid absence (days)': 'غياب بدون أجر (أيام)',
  'Deducted at the daily rate of {rate}.': 'يُستقطع بالأجر اليومي البالغ {rate}.',
  'From leave records: {days} unpaid days.': 'من سجل الإجازات: {days} يوم بدون أجر.',
  'From leave records: {days} sick days at {percent} pay.':
    'من سجل الإجازات: {days} يوم مرضي بنسبة {percent} من الأجر.',
  'Loan instalments': 'أقساط القروض',
  'Loan of {amount} from {date}': 'قرض بمبلغ {amount} بتاريخ {date}',
  Loan: 'قرض',
  'Additions and deductions': 'الإضافات والاستقطاعات',
  'Bonuses, commissions, fines or other one-off amounts.':
    'المكافآت أو العمولات أو الجزاءات أو غيرها من المبالغ لمرة واحدة.',
  Addition: 'إضافة',
  Deduction: 'استقطاع',
  'Add an addition or deduction': 'إضافة مبلغ أو استقطاع',
  Overtime: 'العمل الإضافي',
  Additions: 'الإضافات',
  'Unpaid days': 'أيام بدون أجر',
  'Loan recovery': 'استقطاع القرض',

  // Salary file
  'Salary file downloaded': 'تم تنزيل ملف الرواتب',
  'Salary transfer file': 'ملف تحويل الرواتب',
  'Upload it to your bank’s corporate service to pay the salaries. Banks use different layouts: ask yours and set the columns to match.':
    'ارفعه إلى خدمة الشركات لدى بنكك لدفع الرواتب. تختلف صيغ الملفات بين البنوك: اسأل بنكك واضبط الأعمدة لتطابقها.',
  Layout: 'الصيغة',
  Custom: 'مخصص',
  'Salary month as': 'كتابة شهر الراتب',
  'Columns, in order': 'الأعمدة بالترتيب',
  'Move up': 'نقل لأعلى',
  'Move down': 'نقل لأسفل',
  'First row has the column names': 'الصف الأول يحمل أسماء الأعمدة',
  'Add a valid IBAN for these employees first:': 'أضف رقم آيبان صحيحًا لهؤلاء الموظفين أولًا:',
  '{count} transfers, total {amount}': '{count} تحويل، الإجمالي {amount}',
  'Matches the salaries payable in the books.': 'يطابق الرواتب المستحقة في الدفاتر.',
  'Doesn’t match the salaries payable of {amount}.': 'لا يطابق الرواتب المستحقة البالغة {amount}.',
  'Use this layout next time': 'استخدام هذه الصيغة في المرة القادمة',
  'Download file': 'تنزيل الملف',
  'Bank code': 'رمز البنك',
  'Salary month': 'شهر الراتب',
  'PAM file number': 'رقم الملف لدى الهيئة العامة للقوى العاملة',
  'Wage protection (WPS) – full details': 'حماية الأجور (WPS) – التفاصيل كاملة',
  'Bulk bank transfer – IBAN, name and amount': 'تحويل بنكي جماعي – الآيبان والاسم والمبلغ',
  'Bank transfer with SWIFT codes': 'تحويل بنكي مع رموز السويفت',

  // Payslips
  Payslip: 'قسيمة الراتب',
  'Days paid': 'الأيام المدفوعة',
  'Total deductions': 'إجمالي الاستقطاعات',
  'Employee signature': 'توقيع الموظف',
  'Back to the pay run': 'العودة إلى مسير الرواتب',

  // Leave
  'Annual leave': 'الإجازة السنوية',
  'Sick leave': 'الإجازة المرضية',
  'Maternity leave': 'إجازة الوضع',
  'Hajj leave': 'إجازة الحج',
  'Bereavement leave': 'إجازة الوفاة',
  'Unpaid leave': 'إجازة بدون أجر',
  'Full pay': 'بأجر كامل',
  'Without pay': 'بدون أجر',
  '{percent} pay': 'بنسبة {percent} من الأجر',
  'Cancel this leave?': 'إلغاء هذه الإجازة؟',
  'It no longer counts against the balance or in pay runs prepared from now on.':
    'لن تُحتسب من الرصيد ولا في مسيرات الرواتب التي تُعد من الآن.',
  'Cancel leave': 'إلغاء الإجازة',
  'Leave cancelled': 'تم إلغاء الإجازة',
  '30 days a year, 2.5 days for each month of service (art. 70).':
    '30 يومًا في السنة، بواقع 2.5 يوم عن كل شهر خدمة (المادة 70).',
  'Opening balance on {date}': 'الرصيد الافتتاحي في {date}',
  'Earned since {date}': 'المستحق منذ {date}',
  Earned: 'المستحق',
  Adjustments: 'التعديلات',
  Taken: 'المأخوذ',
  'Annual leave can be taken from {date}, after nine months of service.':
    'يمكن أخذ الإجازة السنوية اعتبارًا من {date}، بعد تسعة أشهر من الخدمة.',
  'Record leave': 'تسجيل إجازة',
  'Set the leave balance': 'ضبط رصيد الإجازات',
  'Sick leave in {year}': 'الإجازة المرضية في {year}',
  'Paid in tiers over the year (art. 69).': 'تُدفع على شرائح خلال السنة (المادة 69).',
  '{used} of {days} days': '{used} من {days} يومًا',
  'Leave records': 'سجل الإجازات',
  'No leave recorded yet.': 'لم تُسجل إجازات بعد.',
  'Balance adjustment': 'تعديل الرصيد',
  'More than the annual leave balance of {days} days.':
    'أكثر من رصيد الإجازة السنوية البالغ {days} يوم.',
  'More than the {days} days allowed.': 'أكثر من الأيام المسموح بها وعددها {days}.',
  'Hajj leave is given once during the service.': 'تُمنح إجازة الحج مرة واحدة طوال مدة الخدمة.',
  'Overlaps other leave of this employee.': 'تتداخل مع إجازة أخرى لهذا الموظف.',
  'Leave balance of {name} updated': 'تم تحديث رصيد إجازات {name}',
  'Could not save the leave.': 'تعذر حفظ الإجازة.',
  'Working days skip Fridays, Saturdays and public holidays.':
    'أيام العمل لا تشمل الجمعة والسبت والعطلات الرسمية.',
  'Use an opening balance for staff who joined before you started here; it replaces what came before its date.':
    'استخدم الرصيد الافتتاحي للموظفين المعينين قبل بدء استخدامك للنظام؛ فهو يحل محل ما قبل تاريخه.',
  'Type of leave': 'نوع الإجازة',
  'First day': 'اليوم الأول',
  'Last day': 'اليوم الأخير',
  'Balance {days} days': 'الرصيد {days} يوم',
  'Opening balance on a date': 'رصيد افتتاحي في تاريخ',
  'Add or remove days': 'إضافة أيام أو خصمها',
  'Use a minus sign to remove days.': 'استخدم علامة السالب لخصم أيام.',
  '{count} calendar days': {
    zero: 'لا أيام تقويمية',
    one: 'يوم تقويمي واحد',
    two: 'يومان تقويميان',
    few: '{count} أيام تقويمية',
    many: '{count} يومًا تقويميًا',
    other: '{count} يوم تقويمي',
  },
  '{count} working days': {
    zero: 'لا أيام عمل',
    one: 'يوم عمل واحد',
    two: 'يوما عمل',
    few: '{count} أيام عمل',
    many: '{count} يوم عمل',
    other: '{count} يوم عمل',
  },
  'No current employees': 'لا يوجد موظفون حاليون',
  'Leave balances show here once you add employees.': 'تظهر أرصدة الإجازات هنا بعد إضافة الموظفين.',
  'Annual leave balance': 'رصيد الإجازة السنوية',
  'Taken in {year}': 'المأخوذ في {year}',
  'Sick days in {year}': 'الأيام المرضية في {year}',
  '{leave} until {date}': '{leave} حتى {date}',
  'Balances in days on {date}: 2.5 days a month, less leave taken.':
    'الأرصدة بالأيام في {date}: 2.5 يوم عن كل شهر، مخصومًا منها الإجازات المأخوذة.',

  // Loans
  'Cancel this loan?': 'إلغاء هذا القرض؟',
  'Its payment is reversed in the books. Only loans with nothing recovered can be cancelled.':
    'يُعكس صرفه في الدفاتر. لا يمكن إلغاء إلا القروض التي لم يُسترد منها شيء.',
  'Cancel loan': 'إلغاء القرض',
  'Loan cancelled': 'تم إلغاء القرض',
  'New loan': 'قرض جديد',
  'No loans or advances': 'لا توجد قروض أو سلف',
  'Loans are interest-free and recovered from pay in monthly instalments.':
    'القروض بدون فوائد وتُسترد من الراتب على أقساط شهرية.',
  'Loans and advances': 'القروض والسلف',
  'Loan of {amount} paid on {date}': 'قرض بمبلغ {amount} صُرف في {date}',
  '{amount} a month from {month}': '{amount} شهريًا اعتبارًا من {month}',
  'Recovered {recovered}, left {balance}': 'المسترد {recovered}، والمتبقي {balance}',
  '{count} instalments to go': {
    zero: 'لا أقساط متبقية',
    one: 'قسط واحد متبقٍ',
    two: 'قسطان متبقيان',
    few: '{count} أقساط متبقية',
    many: '{count} قسطًا متبقيًا',
    other: '{count} قسط متبقٍ',
  },
  'Could not save the loan.': 'تعذر حفظ القرض.',
  'New loan or advance': 'قرض أو سلفة جديدة',
  'Interest-free and recovered from pay in monthly instalments, at most 10% of the wage (art. 59).':
    'بدون فوائد ويُسترد من الراتب على أقساط شهرية لا تتجاوز 10% من الأجر (المادة 59).',
  'Monthly instalment': 'القسط الشهري',
  'First instalment in': 'أول قسط في',
  'Over 10% of the monthly wage ({limit}), the most the law allows.':
    'يتجاوز 10% من الأجر الشهري ({limit})، وهو الحد الأقصى المسموح به قانونًا.',
  'Pay the loan': 'صرف القرض',
  '{count} instalments, the last in {month}': {
    one: 'قسط واحد في {month}',
    two: 'قسطان، آخرهما في {month}',
    few: '{count} أقساط، آخرها في {month}',
    many: '{count} قسطًا، آخرها في {month}',
    other: '{count} قسط، آخرها في {month}',
  },
  'Record an interest-free loan or salary advance; its instalments are deducted in each pay run.':
    'سجّل قرضًا بدون فوائد أو سلفة على الراتب؛ تُستقطع أقساطه في كل مسير رواتب.',
  'Still to recover': 'المتبقي للاسترداد',
  'Active loans': 'القروض القائمة',
  'Paid on {date}, from {month}': 'صُرف في {date}، ويُسدد اعتبارًا من {month}',

  // End of service and final settlement
  'Final settlement': 'المخالصة النهائية',
  'Indemnity, notice pay, unused leave and the last salary, less loans, with the settlement sheet and its entry.':
    'المكافأة وبدل الإنذار والإجازات غير المستخدمة والراتب الأخير، مخصومًا منها القروض، مع كشف المخالصة وقيدها.',
  'Posted on {date}, not paid yet': 'رُحّلت في {date}، ولم تُدفع بعد',
  'Open the settlement': 'فتح المخالصة',
  'Start the final settlement': 'بدء المخالصة النهائية',
  'Provisions in the books': 'المخصصات في الدفاتر',
  'As at {date}, from the {month} pay run.': 'كما في {date}، من مسير رواتب {month}.',
  'Leave salary ({days} days)': 'رواتب الإجازات ({days} يوم)',
  'Open the pay run': 'فتح مسير الرواتب',
  'Amounts due': 'المبالغ المستحقة',
  'Unused leave': 'الإجازات غير المستخدمة',
  'Last salary': 'الراتب الأخير',
  'Net amount due': 'صافي المبلغ المستحق',
  'Received by the employee': 'استلمه الموظف',
  'Approved by': 'اعتمده',
  'Back to the settlement': 'العودة إلى المخالصة',
  'Notice pay ({months} months)': 'بدل مهلة الإنذار ({months} أشهر)',
  'Unused leave ({days} days)': 'الإجازات غير المستخدمة ({days} يوم)',
  'Last salary ({days} of {total} days)': 'الراتب الأخير ({days} من {total} يومًا)',
  'Reverse the settlement?': 'عكس المخالصة؟',
  'The payment entry is reversed and the settlement goes back to unpaid.':
    'يُعكس قيد الدفع وتعود المخالصة غير مدفوعة.',
  'Its entry is reversed on the leaving date. The employee stays marked as left; you can prepare a new settlement.':
    'يُعكس قيدها بتاريخ ترك العمل. يبقى الموظف مسجلًا بأنه ترك العمل، ويمكنك إعداد مخالصة جديدة.',
  'Settlement reversed': 'تم عكس المخالصة',
  'Not paid yet': 'لم تُدفع بعد',
  'Left on {date}': 'ترك العمل في {date}',
  'Settlement sheet': 'كشف المخالصة',
  'Reverse the settlement': 'عكس المخالصة',
  '{years} years of service; indemnity on a monthly wage of {wage}.':
    '{years} سنة خدمة؛ المكافأة على أجر شهري قدره {wage}.',
  Settlement: 'المخالصة',
  'Released from the provisions: {eos} end of service and {leave} leave salary.':
    'المحرر من المخصصات: {eos} لنهاية الخدمة و{leave} لرواتب الإجازات.',
  'Pay the final settlement': 'دفع المخالصة النهائية',
  'Final settlement paid': 'تم دفع المخالصة النهائية',
  'Post the final settlement?': 'ترحيل المخالصة النهائية؟',
  '{name} is marked as left on {date} and the settlement is posted to the books. You can reverse it while it is unpaid.':
    'يُسجل أن {name} ترك العمل في {date} وتُرحَّل المخالصة إلى الدفاتر. يمكنك عكسها ما دامت غير مدفوعة.',
  'Post settlement': 'ترحيل المخالصة',
  'Final settlement posted': 'تم ترحيل المخالصة النهائية',
  'Everything due on leaving, worked out from the records. Check each amount before posting.':
    'كل المستحقات عند ترك العمل محسوبة من السجلات. راجع كل مبلغ قبل الترحيل.',
  Leaving: 'ترك العمل',
  'Domestic workers: one month’s wage for each year of service (Law 68/2015).':
    'العمالة المنزلية: أجر شهر عن كل سنة خدمة (القانون 68/2015).',
  'Share paid': 'النسبة المدفوعة',
  'Enter the indemnity myself': 'إدخال المكافأة يدويًا',
  Indemnity: 'المكافأة',
  'Notice, leave and last salary': 'الإنذار والإجازات والراتب الأخير',
  'Notice pay (months)': 'بدل مهلة الإنذار (أشهر)',
  'When the employer ends an unlimited contract without notice: 3 months for monthly-paid staff, 1 for others (art. 44).':
    'عند إنهاء صاحب العمل لعقد غير محدد المدة دون إنذار: 3 أشهر لمن يتقاضون أجرًا شهريًا، وشهر لغيرهم (المادة 44).',
  'Unused leave (days)': 'الإجازات غير المستخدمة (أيام)',
  'Balance on the leaving date: {days} days. Paid out on leaving (art. 73).':
    'الرصيد في تاريخ ترك العمل: {days} يوم. يُدفع بدلها عند ترك العمل (المادة 73).',
  'Last salary (days)': 'الراتب الأخير (أيام)',
  'The {month} pay run already pays this month.': 'مسير رواتب {month} يدفع هذا الشهر بالفعل.',
  'Days worked in {month}.': 'أيام العمل في {month}.',
  'Left on the loan: {amount}.': 'المتبقي على القرض: {amount}.',
  'Reason for the deduction': 'سبب الاستقطاع',
  'Releases {eos} of the end-of-service provision and {leave} of the leave provision; the difference is expensed.':
    'تحرر {eos} من مخصص نهاية الخدمة و{leave} من مخصص الإجازات؛ ويُحمّل الفرق على المصروفات.',

  // Settings
  'Employee %': 'نسبة الموظف %',
  'Employer %': 'نسبة صاحب العمل %',
  'Salary cap': 'سقف الراتب',
  'Payroll settings saved': 'تم حفظ إعدادات الرواتب',
  'Pay day': 'يوم صرف الرواتب',
  'The pay date suggested for each month.': 'تاريخ الصرف المقترح لكل شهر.',
  'Day {day} of the month': 'اليوم {day} من الشهر',
  'Last day of the month': 'آخر يوم في الشهر',
  'Salaries paid from': 'تُدفع الرواتب من',
  'Working days in a month': 'أيام العمل في الشهر',
  'The daily rate is the monthly wage divided by this; 26 for a six-day week (art. 67).':
    'الأجر اليومي هو الأجر الشهري مقسومًا على هذا العدد؛ 26 لأسبوع عمل من ستة أيام (المادة 67).',
  'Overtime and unpaid days use': 'يُحسب العمل الإضافي والأيام بدون أجر على',
  'Overtime is paid at 125%, on rest days 150% and on public holidays 200% of the hourly rate.':
    'يُدفع العمل الإضافي بنسبة 125%، وفي أيام الراحة 150%، وفي العطلات الرسمية 200% من أجر الساعة.',
  'Basic salary and allowances': 'الراتب الأساسي والبدلات',
  'Basic salary only': 'الراتب الأساسي فقط',
  'Minimum wage': 'الحد الأدنى للأجور',
  'Pay runs warn when net pay is below it. Commonly cited as {amount}.':
    'تنبه مسيرات الرواتب عندما يقل صافي الراتب عنه. يُذكر عادةً أنه {amount}.',
  'Your company file with the Public Authority for Manpower, for the salary file.':
    'ملف شركتك لدى الهيئة العامة للقوى العاملة، لملف الرواتب.',
  'PIFSS rates for Kuwaiti staff': 'نسب التأمينات الاجتماعية للموظفين الكويتيين',
  'Shares of the insured salary (basic salary and allowances) up to the cap. Rates apply from their date until newer ones.':
    'نسب من الراتب الخاضع للتأمين (الراتب الأساسي والبدلات) حتى السقف. تسري النسب من تاريخها حتى أحدث منها.',
  'Add new rates': 'إضافة نسب جديدة',
  'GCC nationals': 'مواطنو دول مجلس التعاون',
  'GCC nationals contribute to their home scheme through PIFSS. Enter the rates of each country you employ; until then they are paid without contributions.':
    'يشترك مواطنو دول مجلس التعاون في نظام بلدهم عبر التأمينات الاجتماعية. أدخل نسب كل دولة لديك موظفون منها؛ وحتى ذلك تُدفع رواتبهم دون اشتراكات.',
  'Add a country': 'إضافة دولة',
  'Post end-of-service and leave provisions each month':
    'ترحيل مخصصي نهاية الخدمة والإجازات كل شهر',
  'When a pay run is approved, the end-of-service provision is brought to what everyone would get at the month end, and the leave salary provision to the value of unused leave.':
    'عند اعتماد مسير الرواتب يُعدَّل مخصص نهاية الخدمة إلى ما يستحقه الجميع في نهاية الشهر، ومخصص الإجازات إلى قيمة الإجازات غير المستخدمة.',
  'Include staff insured with PIFSS in the end-of-service provision':
    'شمول المؤمن عليهم لدى التأمينات الاجتماعية في مخصص نهاية الخدمة',
  'For Kuwaiti and GCC staff the employer pays only what PIFSS does not cover. Leave it off unless you owe them an indemnity.':
    'للموظفين الكويتيين ومواطني دول المجلس يدفع صاحب العمل ما لا تغطيه التأمينات الاجتماعية فقط. اتركه متوقفًا ما لم تكن مدينًا لهم بمكافأة.',
  'Where the payroll posts. Accounts that are missing are created when first used.':
    'الحسابات التي تُرحّل إليها الرواتب. تُنشأ الحسابات غير الموجودة عند أول استخدام.',
  '{code} {name} (created when used)': '{code} {name} (يُنشأ عند الاستخدام)',
  'Discard changes': 'تجاهل التغييرات',
  'Save settings': 'حفظ الإعدادات',
} satisfies Dictionary;
