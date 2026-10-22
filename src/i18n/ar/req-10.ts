import type { Dictionary } from '../index';

/**
 * Salary approval by the Super Admin (#10). Posting a pay run keeps اعتماد;
 * the Super Admin's decision on it is موافقة.
 */
export default {
  // The register by department and position
  'Payroll by department and position': 'كشف الرواتب حسب القسم والوظيفة',
  Position: 'الوظيفة',
  'Employer PIFSS': 'حصة صاحب العمل في التأمينات',
  'Other departments': 'أقسام أخرى',
  'No job title': 'بدون مسمى وظيفي',
  'Other positions': 'وظائف أخرى',
  'Prepared by': 'أعدّه',
  'Approval of the Super Admin': 'موافقة المشرف العام',
  'Draft: not posted yet': 'مسودة: لم تُعتمد بعد',

  // The approval email
  '{company}: the payroll for {month} is waiting for your approval':
    '{company}: رواتب {month} بانتظار موافقتك',
  '{name} sent the payroll for {month} for your approval.': 'أرسل {name} رواتب {month} لموافقتك.',
  'The payroll for {month} was sent for your approval.': 'أُرسلت رواتب {month} لموافقتك.',
  'Net pay is {amount} more than in {month}.':
    'صافي الرواتب أكثر بمبلغ {amount} مما كان في {month}.',
  'Net pay is {amount} less than in {month}.':
    'صافي الرواتب أقل بمبلغ {amount} مما كان في {month}.',
  'Net pay is the same as in {month}.': 'صافي الرواتب كما كان في {month}.',
  'Open the pay run in the app to see the amounts.': 'افتح مسير الرواتب في التطبيق لرؤية المبالغ.',
  'There is a note with it in the app.': 'معه ملاحظة في التطبيق.',
  'Each employee’s pay is in the app only, never in an email.':
    'راتب كل موظف في التطبيق فقط، ولا يُرسل أبدًا بالبريد.',
  'You get this email because you approve pay runs for {company} in {app}. Opening the link decides nothing: approve or reject the pay run in the app.':
    'تصلك هذه الرسالة لأنك توافق على مسيرات الرواتب لـ {company} في {app}. فتح الرابط لا يقرر شيئًا: وافق على مسير الرواتب أو ارفضه في التطبيق.',
  'Department and position': 'القسم والوظيفة',
  'By department and position': 'حسب القسم والوظيفة',
  'Open the pay run': 'فتح مسير الرواتب',

  // The pay run
  'Register by department': 'الكشف حسب القسم',
  'Salary approval': 'موافقة الرواتب',
  'Ask for approval': 'إرسال للموافقة',
  'Ask for approval again': 'إرسال للموافقة مرة أخرى',
  'Ask the Super Admin to approve the payroll for {month}?':
    'إرسال رواتب {month} لموافقة المشرف العام؟',
  'The owner and the members allowed to approve get its totals by department and position by email, and see each employee’s pay here. Any change to the pay run after this asks for a new approval.':
    'يتلقى المالك والأعضاء المسموح لهم بالموافقة إجمالياته حسب القسم والوظيفة بالبريد، ويرون راتب كل موظف هنا. وأي تغيير في مسير الرواتب بعد ذلك يحتاج إلى موافقة جديدة.',
  'Note for the Super Admin': 'ملاحظة للمشرف العام',
  'Sent for the Super Admin’s approval': 'أُرسل لموافقة المشرف العام',
  'As the owner you approve pay runs: approving it posts it at once.':
    'بصفتك المالك فأنت توافق على مسيرات الرواتب: اعتماده يرحّله فورًا.',
  'This pay run needs the Super Admin’s approval before it is approved.':
    'يحتاج مسير الرواتب هذا إلى موافقة المشرف العام قبل اعتماده.',
  'Approved by the Super Admin, and posted.': 'وافق عليه المشرف العام، واعتُمد.',
  'This pay run changed after it was approved. It needs a new approval.':
    'تغيّر مسير الرواتب هذا بعد الموافقة عليه. ويحتاج إلى موافقة جديدة.',
  'This pay run changed after it was sent for approval. Send it again.':
    'تغيّر مسير الرواتب هذا بعد إرساله للموافقة. أرسله مرة أخرى.',
  'Sent for the Super Admin’s approval. It can be approved once approval is given.':
    'أُرسل لموافقة المشرف العام. ويمكن اعتماده بعد الموافقة.',
  'The Super Admin approved it. You can approve (post) the pay run now.':
    'وافق عليه المشرف العام. يمكنك الآن اعتماد مسير الرواتب (ترحيله).',
  'Approved by the Super Admin.': 'وافق عليه المشرف العام.',
  'The Super Admin didn’t approve this pay run. Change it if needed and send it again.':
    'لم يوافق المشرف العام على مسير الرواتب هذا. عدّله إن لزم وأرسله مرة أخرى.',

  // The request and its decision
  'Waiting for the Super Admin': 'بانتظار موافقة المشرف العام',
  'Approval given': 'تمت الموافقة',
  'Not approved': 'لم تتم الموافقة',
  'Taken back': 'سُحب الطلب',
  'Approval given, pay run approved': 'تمت الموافقة واعتُمد المسير',
  'Decided. It reaches the cloud once this device syncs.':
    'تم القرار. ويصل إلى السحابة عند مزامنة هذا الجهاز.',
  'Give approval': 'موافقة',
  'You sent it, so the owner or another member allowed to approve decides it.':
    'أنت من أرسله، لذا يقرر فيه المالك أو عضو آخر مسموح له بالموافقة.',
  'Give approval to the payroll for {month}?': 'الموافقة على رواتب {month}؟',
  'Don’t approve the payroll for {month}?': 'رفض الموافقة على رواتب {month}؟',
  'It can then be approved (posted to the books) and paid as it stands. Any change to it asks for a new approval.':
    'يمكن بعدها اعتماده (ترحيله إلى الدفاتر) ودفعه كما هو. وأي تغيير فيه يحتاج إلى موافقة جديدة.',
  'The pay run stays a draft. Whoever sent it sees why.':
    'يبقى مسير الرواتب مسودة. ويرى من أرسله السبب.',
  'Hide each employee’s pay': 'إخفاء راتب كل موظف',
  'Show each employee’s pay': 'عرض راتب كل موظف',
  'The pay run on this device isn’t as it was sent for approval. Let the device sync; if it still differs, the pay run changed since: reject this request, and it can be sent again.':
    'مسير الرواتب على هذا الجهاز ليس كما أُرسل للموافقة. دع الجهاز يزامن؛ فإن بقي مختلفًا فقد تغيّر المسير بعد إرساله: ارفض هذا الطلب، ويمكن إرساله مرة أخرى.',
  'This pay run isn’t on this device yet. Let it sync, then decide.':
    'مسير الرواتب هذا ليس على هذا الجهاز بعد. دعه يزامن، ثم قرّر.',
  'Only the owner approves a pay run they sent for approval themselves.':
    'لا يوافق على مسير رواتب أرسله صاحبه للموافقة إلا المالك.',
  'This pay run changed after it was sent for approval. Reject this request; it can be sent again.':
    'تغيّر مسير الرواتب هذا بعد إرساله للموافقة. ارفض هذا الطلب، ويمكن إرساله مرة أخرى.',

  // Activity
  'Pay run {period} sent for approval': 'أُرسل مسير رواتب {period} للموافقة',
  'Approval request for pay run {period} cancelled': 'أُلغي طلب الموافقة على مسير رواتب {period}',
  'Approval given for pay run {period}': 'تمت الموافقة على مسير رواتب {period}',
  'Approval refused for pay run {period}': 'رُفضت الموافقة على مسير رواتب {period}',
  'Approval request for pay run {period} expired': 'انتهت مدة طلب الموافقة على مسير رواتب {period}',

  // Approving (posting) without it
  'This pay run needs the Super Admin’s approval before it is approved. Send it for approval first.':
    'يحتاج مسير الرواتب هذا إلى موافقة المشرف العام قبل اعتماده. أرسله للموافقة أولًا.',
  'This pay run changed after it was sent for approval. Send it for approval again.':
    'تغيّر مسير الرواتب هذا بعد إرساله للموافقة. أرسله للموافقة مرة أخرى.',
  'This pay run is waiting for the Super Admin’s approval.':
    'مسير الرواتب هذا بانتظار موافقة المشرف العام.',
  'The Super Admin didn’t approve this pay run. Change it if needed and send it for approval again.':
    'لم يوافق المشرف العام على مسير الرواتب هذا. عدّله إن لزم وأرسله للموافقة مرة أخرى.',
  'Only a draft pay run is sent for approval.': 'لا يُرسل للموافقة إلا مسير رواتب مسودة.',
  'Salary approval is off for this company.': 'موافقة الرواتب غير مفعّلة لهذه الشركة.',
  'Your role can’t send pay runs for approval.': 'لا يسمح دورك بإرسال مسيرات الرواتب للموافقة.',
  'This pay run is already approved. You can approve it now.':
    'تمت الموافقة على مسير الرواتب هذا. يمكنك اعتماده الآن.',
  'This pay run is already waiting for the Super Admin’s approval.':
    'مسير الرواتب هذا بانتظار موافقة المشرف العام بالفعل.',
  'An earlier version of this pay run is still waiting, sent by someone else. Ask them or an approver to take it back.':
    'لا تزال نسخة سابقة من مسير الرواتب هذا بانتظار الموافقة، أرسلها شخص آخر. اطلب منه أو ممن يوافق سحبها.',

  // Settings → Approvals → Pay runs
  'A draft pay run is sent for approval as it stands, with a note if needed. It can be approved (posted to the books) and paid only once the owner, or a member allowed to approve who didn’t send it, has approved it. Any change after it was sent asks for a new approval. The owner may approve a pay run at once.':
    'يُرسل مسير الرواتب المسودة للموافقة كما هو، مع ملاحظة إن لزم. ولا يمكن اعتماده (ترحيله إلى الدفاتر) ودفعه إلا بعد موافقة المالك، أو عضو مسموح له بالموافقة لم يرسله بنفسه. وأي تغيير بعد إرساله يحتاج إلى موافقة جديدة. ويمكن للمالك اعتماد مسير الرواتب فورًا.',
  'Pay runs need the Super Admin’s approval': 'مسيرات الرواتب تحتاج إلى موافقة المشرف العام',
  'The owner and the members allowed to approve get an email with the totals by department and position and a link to the pay run in the app. Nobody’s own pay is ever in the email: it is in the app only.':
    'يتلقى المالك والأعضاء المسموح لهم بالموافقة رسالة بالإجماليات حسب القسم والوظيفة ورابطًا إلى مسير الرواتب في التطبيق. ولا يكون راتب أي شخص في الرسالة أبدًا: فهو في التطبيق فقط.',
  'Nothing in the pay is worked out differently: approval only decides when a pay run can be posted. Ask the auditor to confirm that the approved pay run and its register by department and position (Payroll → the pay run → Register by department) are kept with the month’s records.':
    'لا يتغير شيء في احتساب الرواتب: الموافقة تحدد فقط متى يمكن ترحيل مسير الرواتب. اطلب من المدقق أن يؤكد حفظ مسير الرواتب الموافق عليه وكشفه حسب القسم والوظيفة (الرواتب ← المسير ← الكشف حسب القسم) مع سجلات الشهر.',
  'Before turning this on, update every device that prepares pay runs and let it sync. An older version of the app doesn’t know this switch and can still approve a pay run without the Super Admin’s approval; Updates show every pay run approved.':
    'قبل التفعيل، حدِّث كل جهاز يُعِدّ مسيرات الرواتب ودعه يزامن. فالإصدار الأقدم من التطبيق لا يعرف هذا الخيار وقد يعتمد مسير رواتب دون موافقة المشرف العام؛ وتُظهر المستجدات كل مسير رواتب اعتُمد.',
  'Pay runs are approved by the owner, or by a member allowed to approve who didn’t send them. Their requests are in Approvals in the People sidebar too, seen only by those who see payroll.':
    'يوافق على مسيرات الرواتب المالك، أو عضو مسموح له بالموافقة لم يرسلها بنفسه. وطلباتها في الاعتمادات في الشريط الجانبي لمهام بيبول أيضًا، ولا يراها إلا من يرى الرواتب.',
} satisfies Dictionary;
