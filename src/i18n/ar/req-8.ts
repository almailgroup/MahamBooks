import type { Dictionary } from '../index';

/**
 * Approvals (طلبات الاعتماد) and invoices that keep their numbers: changes to
 * issued invoices and credit notes that wait for the owner (the Super Admin),
 * Void invoices, Void and reissue, and drafts numbered when they are issued.
 */
export default {
  // The approvals service
  Approvals: 'الاعتمادات',
  'Approval requests': 'طلبات الاعتماد',
  'Approval settings': 'إعدادات الاعتماد',
  'Waiting for approval': 'بانتظار الاعتماد',
  'Send for approval': 'إرسال للاعتماد',
  'Send for approval instead': 'إرساله للاعتماد بدلاً من ذلك',
  'Sent for approval': 'أُرسل للاعتماد',
  'Approved and done': 'معتمد ومنفَّذ',
  Rejected: 'مرفوض',
  Reject: 'رفض',
  'Take back': 'سحب الطلب',
  'Request taken back': 'تم سحب الطلب',
  'Carry it out again': 'تنفيذه مرة أخرى',
  'Reject this request?': 'رفض هذا الطلب؟',
  'The document stays as it is. Whoever asked sees why.':
    'يبقى المستند كما هو، ويرى مقدّم الطلب السبب.',
  'Note for whoever asked': 'ملاحظة لمقدّم الطلب',
  'A team member': 'أحد أعضاء الفريق',
  'Another customer': 'عميل آخر',
  Changed: 'تم التغيير',
  'Asked by {name} · {date}': 'طلبه {name} · {date}',
  '{status} by {name} · {date}': '{status} من {name} · {date}',
  Now: 'الآن',
  'Asked for': 'المطلوب',
  'The document has changed since this was asked. Approving changes only what was asked for.':
    'تغيّر المستند منذ تقديم هذا الطلب. الاعتماد يغيّر ما طُلب فقط.',
  '{count} lines': {
    zero: 'لا بنود',
    one: 'بند واحد',
    two: 'بندان',
    few: '{count} بنود',
    many: '{count} بندًا',
    other: '{count} بند',
  },
  'Change to an issued document': 'تعديل مستند صادر',
  'Restore from void': 'استعادة من الإبطال',
  'New cheque': 'شيك جديد',
  'Change to a cheque': 'تعديل شيك',
  'Cheque deleted': 'حذف شيك',
  'Cheque replaced': 'استبدال شيك',
  'Security cheque cashed': 'صرف شيك ضمان',
  'Discount type': 'نوع الخصم',
  'Retention kind': 'نوع المحتجزات',
  'Say why, for the approver.': 'اذكر السبب للمعتمِد.',
  'A request on {number} is already waiting for approval.':
    'يوجد طلب على {number} بانتظار الاعتماد بالفعل.',
  'Nothing to send for approval.': 'لا يوجد ما يُرسل للاعتماد.',
  'Nothing has changed.': 'لم يتغير شيء.',
  'This request has already been decided.': 'تم البتّ في هذا الطلب بالفعل.',
  'Only an approver decides approval requests.': 'المعتمِد وحده يبتّ في طلبات الاعتماد.',
  'This version of the app can’t carry out this request.':
    'لا يستطيع هذا الإصدار من التطبيق تنفيذ هذا الطلب.',
  'The document of this request no longer exists.': 'مستند هذا الطلب لم يعد موجوداً.',
  'This change can’t be sent for approval. Undo it instead.':
    'لا يمكن إرسال هذا التعديل للاعتماد. تراجع عنه بدلاً من ذلك.',
  '{number} is issued, so this change needs approval. Send it for approval instead.':
    '{number} صادر، لذا يحتاج هذا التعديل إلى اعتماد. أرسله للاعتماد بدلاً من ذلك.',
  '{number} is issued, so only an approver can make this change.':
    '{number} صادر، لذا لا يجري هذا التعديل إلا المعتمِد.',
  'Approval asked for on {number}': 'طُلب اعتماد على {number}',
  'Approval request on {number} cancelled': 'أُلغي طلب الاعتماد على {number}',
  'Approval request on {number} approved': 'اعتُمد طلب الاعتماد على {number}',
  'Approval request on {number} rejected': 'رُفض طلب الاعتماد على {number}',
  'Approval request on {number} expired': 'انتهت مدة طلب الاعتماد على {number}',

  // The inbox
  Waiting: 'بالانتظار',
  'Asked by me': 'طلباتي',
  Decided: 'تم البتّ فيها',
  'Nothing is waiting for approval.': 'لا شيء بانتظار الاعتماد.',
  'No requests yet.': 'لا توجد طلبات بعد.',
  'Changes that need your approval show here.': 'تظهر هنا التعديلات التي تحتاج إلى اعتمادك.',
  'Changes you send for approval show here until they are decided.':
    'تظهر هنا التعديلات التي ترسلها للاعتماد حتى يُبتّ فيها.',
  'Changes to issued documents that wait for the owner or a member the owner allowed to approve.':
    'تعديلات المستندات الصادرة التي تنتظر المالك أو عضواً سمح له المالك بالاعتماد.',
  'Approvals are for companies kept in the cloud': 'الاعتمادات للشركات المحفوظة في السحابة',
  'On this device only, nobody else changes the company, so nothing waits for approval.':
    'على هذا الجهاز وحده لا يغيّر أحد غيرك الشركة، فلا شيء ينتظر الاعتماد.',
  'Waiting for your approval': 'بانتظار اعتمادك',
  'Your requests still waiting': 'طلباتك التي لا تزال بالانتظار',

  // The cloud's refusals
  'This change needs approval. Send it for approval instead.':
    'يحتاج هذا التعديل إلى اعتماد. أرسله للاعتماد بدلاً من ذلك.',
  'This change needs approval.': 'يحتاج هذا التعديل إلى اعتماد.',
  'Only the owner changes the approval rules.': 'المالك وحده يغيّر قواعد الاعتماد.',
  'Approval requests are kept as the record of who asked and who decided.':
    'تُحفظ طلبات الاعتماد سجلاً لمن طلب ومن بتّ فيها.',
  'Issued documents are voided, never deleted, so their numbers stay used.':
    'تُبطَل المستندات الصادرة ولا تُحذف أبداً، فتبقى أرقامها مستخدمة.',
  'The document goes back to the cloud’s copy, and your change waits for an approver. It is made when they approve.':
    'يعود المستند إلى نسخة السحابة، وينتظر تعديلك المعتمِد. ويُنفَّذ عند اعتماده.',

  // Documents
  'Send the change of {number} for approval?': 'إرسال تعديل {number} للاعتماد؟',
  '{number} has been issued, so an approver decides on this change. It stays as it is until they approve.':
    'صدر {number}، لذا يبتّ المعتمِد في هذا التعديل. ويبقى كما هو حتى يعتمده.',
  'Request void': 'طلب الإبطال',
  'Request restore': 'طلب الاستعادة',
  'Ask to void {number}?': 'طلب إبطال {number}؟',
  'Ask to restore {number}?': 'طلب استعادة {number}؟',
  'An approver decides. It is voided when they approve.':
    'يبتّ المعتمِد في الطلب، ويُبطَل المستند عند اعتماده.',
  'An approver decides. It counts as owed again when they approve.':
    'يبتّ المعتمِد في الطلب، ويُحتسب المبلغ مستحقاً من جديد عند اعتماده.',
  'Void and reissue': 'إبطال وإعادة إصدار',
  'Void {number} and issue it again?': 'إبطال {number} وإعادة إصداره؟',
  'A new draft is made in its place, to correct and issue with a new number. It prints which invoice it replaces.':
    'تُنشأ مسودة جديدة بدلاً منه لتصحيحها وإصدارها برقم جديد، وتُطبع عليها الفاتورة التي تحل محلها.',
  'Why it is voided': 'سبب الإبطال',
  'Why it was voided: {reason}': 'سبب الإبطال: {reason}',
  'Issue again in its place': 'إصدار مستند بدلاً منه',
  'Only a void document is issued again.': 'لا يُعاد إصدار إلا مستند مُبطَل.',
  '{number} has already been issued again.': 'أُعيد إصدار {number} بالفعل.',
  '{number} is issued, so it is voided instead of deleted: its number stays used.':
    '{number} صادر، لذا يُبطَل بدلاً من حذفه: ويبقى رقمه مستخدماً.',
  'Void invoices': 'الفواتير الملغاة',
  'Void credit notes': 'الإشعارات الدائنة الملغاة',
  'Draft invoice created': 'تم إنشاء مسودة فاتورة',
  'Draft invoice updated': 'تم تحديث مسودة فاتورة',
  'Draft invoice deleted': 'تم حذف مسودة فاتورة',
  'Draft credit note created': 'تم إنشاء مسودة إشعار دائن',
  'Draft credit note updated': 'تم تحديث مسودة إشعار دائن',
  'Draft credit note deleted': 'تم حذف مسودة إشعار دائن',
  'Draft {document} created': 'تم إنشاء مسودة {document}',
  'Draft {document} saved': 'تم حفظ مسودة {document}',
  '{number} converted to a draft invoice': 'تم تحويل {number} إلى مسودة فاتورة',
  'Given when it is issued, so a draft that is deleted uses up no number.':
    'يُعطى عند الإصدار، فلا تستهلك المسودة المحذوفة أي رقم.',
  'Invoice it replaces': 'الفاتورة التي تحل محلها',

  // Settings → Approvals
  'Changes to issued invoices and credit notes that wait for the owner (the Super Admin).':
    'تعديلات الفواتير والإشعارات الدائنة الصادرة التي تنتظر المالك (المشرف العام).',
  'Approvals are for companies kept in the cloud, where a team works on them. Keep this company in the cloud first, in Settings → Team.':
    'الاعتمادات للشركات المحفوظة في السحابة حيث يعمل عليها فريق. احفظ هذه الشركة في السحابة أولاً من الإعدادات ← الفريق.',
  'Issued invoices need an approver to change': 'تعديل الفواتير الصادرة يحتاج إلى معتمِد',
  'Edits, voids and restores of an invoice that has been issued are sent for approval by everyone else.':
    'يرسل الآخرون جميعاً تعديل الفاتورة الصادرة وإبطالها واستعادتها للاعتماد.',
  'Issued credit notes need an approver to change':
    'تعديل الإشعارات الدائنة الصادرة يحتاج إلى معتمِد',
  'The same for credit notes.': 'وكذلك الإشعارات الدائنة.',
  'Void instead of delete': 'الإبطال بدلاً من الحذف',
  'Issued invoices and credit notes are voided, never deleted, so their numbers stay used and appear under Void invoices. Drafts can still be deleted.':
    'تُبطَل الفواتير والإشعارات الدائنة الصادرة ولا تُحذف أبداً، فتبقى أرقامها مستخدمة وتظهر ضمن الفواتير الملغاة. ويبقى حذف المسودات ممكناً.',
  'Cancel requests still waiting after (days)': 'إلغاء الطلبات التي لا تزال بالانتظار بعد (أيام)',
  '0 keeps them waiting until they are decided.': 'القيمة 0 تُبقيها بالانتظار حتى يُبتّ فيها.',
  'Who approves': 'من يعتمد',
  'The owner approves. Up to two admins or accountants the owner allows (Permissions → Can approve, in Settings → Team) approve too, and their own changes need no request.':
    'يعتمد المالك. ويعتمد أيضاً مديران أو محاسبان على الأكثر يسمح لهم المالك (الصلاحيات ← صلاحية الاعتماد في الإعدادات ← الفريق)، ولا تحتاج تعديلاتهم إلى طلب.',
  'Requests are in Approvals, in the Books sidebar, and on the home page. Payments, payment links and retention releases go on as before.':
    'الطلبات في «الاعتمادات» بالقائمة الجانبية لمهام بوكس وفي الصفحة الرئيسية. وتستمر الدفعات وروابط الدفع والإفراج عن المحتجزات كما كانت.',
  'Before turning approvals on, update every device and let it sync. A change an older version makes to an issued invoice is refused and kept aside in Settings → Cloud and sync, where it can be sent for approval.':
    'قبل تشغيل الاعتمادات، حدّث كل جهاز واتركه يزامن. التعديل الذي يجريه إصدار أقدم على فاتورة صادرة يُرفض ويُحفظ جانباً في الإعدادات ← السحابة والمزامنة، حيث يمكن إرساله للاعتماد.',

  // Settings → Numbering
  'When invoices get their number': 'متى تحصل الفواتير على أرقامها',
  'Numbers are never given twice: a void invoice keeps its number, and an invoice issued in place of one gets a new number that says which it replaces.':
    'لا يُعطى الرقم مرتين أبداً: تحتفظ الفاتورة الملغاة برقمها، والفاتورة الصادرة بدلاً منها تأخذ رقماً جديداً يذكر الفاتورة التي تحل محلها.',
  'Number invoices and credit notes when they are issued':
    'ترقيم الفواتير والإشعارات الدائنة عند إصدارها',
  'Drafts have no number until they are sent, so a draft that is deleted never uses one up. In a company kept in the cloud, update every device first.':
    'لا رقم للمسودات حتى تُرسل، فلا تستهلك المسودة المحذوفة أي رقم. وفي الشركة المحفوظة في السحابة حدّث كل جهاز أولاً.',
} satisfies Dictionary;
