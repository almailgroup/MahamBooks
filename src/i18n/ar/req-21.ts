import type { Dictionary } from '../index';

/** Scans attached to payments: the payment form, the payment page and Record payment. */
export default {
  'A scan of the cheque or the transfer receipt.': 'صورة الشيك أو إيصال التحويل.',
  'Payment {number} saved, but its files were not. Attach them again on the payment.':
    'تم حفظ الدفعة {number}، لكن لم تُحفظ ملفاتها. أرفقها مرة أخرى من صفحة الدفعة.',
  'Its attached files are deleted with it.': 'وتُحذف الملفات المرفقة بها معها.',
  'Files attached': 'ملفات مرفقة',
} satisfies Dictionary;
