import type { Dictionary } from '../index';

/** Values saved by a newer version of the app, and the kinds of records it adds. */
export default {
  'Other leave': 'إجازة أخرى',
  'Unknown status': 'حالة غير معروفة',

  // Kinds of records (sync problems)
  'Cheque layout': 'نموذج الشيك',
  'Approval request': 'طلب اعتماد',
  'Letter template': 'نموذج خطاب',
  'Employee letter': 'خطاب موظف',
} satisfies Dictionary;
