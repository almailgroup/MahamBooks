import type { Dictionary } from '../index';

/**
 * Cheque confirmation by the owner (the Super Admin): cheques recorded by
 * anyone but an approver wait as requests (بانتظار التأكيد) until an approver
 * confirms them, and only then reach the books.
 */
export default {
  // Settings → Approvals → Cheques
  'A cheque recorded by anyone but an approver waits as a request. It reaches the books, the cheque register and the invoice or bill, and can be printed, only once an approver confirms it, dated the day it was written or received.':
    'الشيك الذي يسجّله غير المعتمِد يبقى طلباً بانتظار التأكيد، ولا يدخل الدفاتر وسجل الشيكات والفاتورة أو الفاتورة الواردة، ولا يُطبع، إلا بعد أن يؤكده معتمِد، ويؤرَّخ بيوم كتابته أو استلامه.',
  'Cheques need confirmation': 'الشيكات تحتاج إلى تأكيد',
  'Changing the amount, payee, number, bank or dates of a confirmed cheque, or deleting it, waits too. Depositing, clearing, returning, cancelling, printing and notes go on as before.':
    'تغيير مبلغ الشيك المؤكد أو المستفيد أو الرقم أو البنك أو التواريخ، أو حذفه، ينتظر التأكيد أيضاً. أما الإيداع والتحصيل والإرجاع والإلغاء والطباعة والملاحظات فتبقى كما كانت.',
  'Payments made by cheque, the cheques that replace them, and security cheques given that are cashed.':
    'المدفوعات بشيك، والشيكات البديلة عنها، وشيكات الضمان المسلَّمة عند صرفها.',
  'Security cheques given': 'شيكات الضمان المسلَّمة',
  'Guarantee cheques the company hands over, such as a rent deposit.':
    'شيكات الضمان التي تسلّمها الشركة، مثل تأمين الإيجار.',
  'Off is recommended: while a cheque received waits, its invoice stays unpaid, so the customer may still be reminded to pay.':
    'يُنصح بإيقافه: ما دام الشيك المستلم بانتظار التأكيد تبقى فاتورته غير مدفوعة، وقد يصل العميلَ تذكير بالدفع.',
  'Before turning this on, update every device and let it sync. A cheque an older version records is refused and kept aside in Settings → Cloud and sync, where it can be sent for confirmation.':
    'قبل تفعيل ذلك، حدّث كل جهاز ودعه يُزامن. الشيك الذي يسجّله إصدار أقدم يُرفض ويُحفظ جانباً في الإعدادات ← السحابة والمزامنة، حيث يمكن إرساله للتأكيد.',

  // Recording a cheque that waits
  'Send for confirmation': 'إرسال للتأكيد',
  'Send for confirmation instead': 'إرساله للتأكيد بدلاً من ذلك',
  'Sent for confirmation': 'أُرسل للتأكيد',
  'Sent for confirmation. The cheque is recorded once an approver confirms it.':
    'أُرسل للتأكيد. يُسجَّل الشيك بعد أن يؤكده معتمِد.',
  'Sent for confirmation. It is recorded once an approver confirms it.':
    'أُرسل للتأكيد. يُسجَّل بعد أن يؤكده معتمِد.',
  'Waiting for confirmation': 'بانتظار التأكيد',
  'Nothing is waiting for confirmation.': 'لا يوجد ما ينتظر التأكيد.',
  'Not in the books, the invoices and bills or the totals above until confirmed.':
    'لا تدخل الدفاتر ولا الفواتير ولا المجاميع أعلاه حتى تُؤكَّد.',
  'Note for the approver': 'ملاحظة للمعتمِد',
  'This cheque waits for an approver’s confirmation. It is recorded, numbered and paid against the documents once confirmed, dated {date}.':
    'هذا الشيك بانتظار تأكيد معتمِد. يُسجَّل ويُرقَّم ويُسدَّد به المستند بعد تأكيده، بتاريخ {date}.',
  'This change waits for an approver’s confirmation. The cheque stays as it is until it is confirmed.':
    'هذا التغيير بانتظار تأكيد معتمِد. يبقى الشيك كما هو حتى يُؤكَّد.',
  'The cheque stays as it is, and your change waits for an approver. It is made when they confirm it.':
    'يبقى الشيك كما هو، وينتظر تغييرك معتمِداً. ويُنفَّذ عند تأكيده.',
  'Deleting this cheque waits for an approver. It stays as it is until they confirm it.':
    'حذف هذا الشيك ينتظر معتمِداً. ويبقى كما هو حتى يؤكد الحذف.',
  'The cheque goes back to the cloud’s copy (a new one leaves this device), and your change waits for an approver. It is made when they confirm it.':
    'يعود الشيك إلى نسخة السحابة (والشيك الجديد يُحذف من هذا الجهاز)، وينتظر تغييرك معتمِداً. ويُنفَّذ عند تأكيده.',
  'This cheque needs confirmation. Send it for confirmation instead.':
    'هذا الشيك يحتاج إلى تأكيد. أرسله للتأكيد بدلاً من ذلك.',
  'Cheque {number} is already waiting for confirmation.': 'الشيك {number} بانتظار التأكيد بالفعل.',
  'A request on this cheque is already waiting for confirmation.':
    'يوجد طلب على هذا الشيك بانتظار التأكيد بالفعل.',
  'Nothing to send for confirmation.': 'لا يوجد ما يُرسل للتأكيد.',

  // The request
  'Cheque confirmation': 'تأكيد الشيك',
  'Cheque issued': 'شيك صادر',
  'Cheque received': 'شيك مستلم',
  'Security cheque given': 'شيك ضمان مسلَّم',
  'Security cheque received': 'شيك ضمان مستلم',
  'Confirmed and recorded': 'مؤكد ومسجَّل',
  'Cheque confirmed and recorded': 'تم تأكيد الشيك وتسجيله',
  'Reject this cheque?': 'رفض هذا الشيك؟',
  'Nothing is recorded. Whoever asked sees why.': 'لا يُسجَّل شيء، ويرى مقدّم الطلب السبب.',
  'Asks to delete this cheque.': 'يطلب حذف هذا الشيك.',
  'Confirmed, but not recorded yet on this device. Carry it out again, or reject it if it can’t be recorded.':
    'مؤكد، لكنه لم يُسجَّل بعد على هذا الجهاز. نفّذه مرة أخرى، أو ارفضه إن تعذّر تسجيله.',
  'Another contact': 'جهة أخرى',
  'Documents it pays': 'المستندات التي يسددها',
  '{count} documents': {
    zero: 'لا توجد مستندات',
    one: 'مستند واحد',
    two: 'مستندان',
    few: '{count} مستندات',
    many: '{count} مستنداً',
    other: '{count} مستند',
  },
  Direction: 'الاتجاه',
  'Fee account': 'حساب الرسوم',
  'Payee or drawer': 'المستفيد أو الساحب',
  'Cheque {number} of {amount} for this document is waiting for confirmation. It counts once an approver confirms it.':
    'الشيك {number} بمبلغ {amount} لهذا المستند بانتظار التأكيد، ولا يُحتسب إلا بعد أن يؤكده معتمِد.',
  'Cheques waiting for confirmation': 'الشيكات بانتظار التأكيد',

  // Confirming
  'Confirmation asked for cheque {number}': 'طُلب تأكيد الشيك {number}',
  'Confirmation request for cheque {number} cancelled': 'أُلغي طلب تأكيد الشيك {number}',
  'Cheque {number} confirmed': 'تم تأكيد الشيك {number}',
  'Cheque {number} not confirmed': 'لم يُؤكَّد الشيك {number}',
  'Confirmation request for cheque {number} expired': 'انتهت مدة طلب تأكيد الشيك {number}',
  '{number} has been paid meanwhile: only {amount} is left to pay. Reject this request, and record the cheque again if it is still needed.':
    'سُدِّد {number} في هذه الأثناء: المتبقي {amount} فقط. ارفض هذا الطلب، وسجّل الشيك مرة أخرى إن كانت الحاجة إليه قائمة.',
  'A document this cheque pays is no longer here. Reject the request and record it again.':
    'أحد المستندات التي يسددها هذا الشيك لم يعد موجوداً. ارفض الطلب وسجّله مرة أخرى.',
  'The payment of this request no longer exists.': 'الدفعة الخاصة بهذا الطلب لم تعد موجودة.',
  'The cheque of this request no longer exists.': 'الشيك الخاص بهذا الطلب لم يعد موجوداً.',
} satisfies Dictionary;
