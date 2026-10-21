import type { Dictionary } from '../index';

/** Fixes from the Phase 3 release check (security cheques waiting to be cashed, payment links). */
export default {
  // A security cheque while cashing it waits for confirmation
  'Cashing security cheque {number} is waiting for confirmation. Until that request is decided or taken back, the cheque can’t be changed or deleted.':
    'صرف شيك الضمان {number} بانتظار التأكيد. لا يمكن تعديل الشيك أو حذفه إلى أن يُبتّ في هذا الطلب أو يُسحب.',
  'Security cheque {number} has changed since cashing it was asked for. Reject this request, and ask again if it is still needed.':
    'تغيّر شيك الضمان {number} منذ طلب صرفه. ارفض هذا الطلب، واطلب الصرف مرة أخرى إن كانت الحاجة إليه قائمة.',

  // The payment link of an issued invoice kept for approvers
  'Only an approver can change or remove the payment link of an issued invoice. You can add one where there is none.':
    'المعتمِد وحده يغيّر رابط الدفع في فاتورة صادرة أو يزيله. يمكنك إضافة رابط حيث لا يوجد رابط.',
  'Only an approver can change or remove this payment link.':
    'المعتمِد وحده يغيّر رابط الدفع هذا أو يزيله.',
} satisfies Dictionary;
