import type { Dictionary } from '../index';

/** Receipt and payment vouchers as PDFs, expense vouchers and the voucher settings. */
export default {
  'A credit note applied moved no money, so it has no voucher.':
    'تخصيص إشعار دائن لا يحرّك أي مبلغ، فلا سند له.',
  'This expense could not be found.': 'تعذّر العثور على هذا المصروف.',
  'Back to the expense': 'العودة إلى المصروف',
  'Paid to': 'المدفوع له',
  'A shop or a person, when not a vendor': 'متجر أو شخص، إن لم يكن من الموردين',
  'Save the expense first.': 'احفظ المصروف أولاً.',
  'Receipt and payment vouchers': 'سندات القبض والصرف',
  'Printed and saved as PDFs from payments and expenses, in Arabic and English. They keep the payment and expense numbers.':
    'تُطبع وتُحفظ بصيغة PDF من الدفعات والمصروفات، بالعربية والإنجليزية، وتحمل أرقام الدفعات والمصروفات نفسها.',
  'Print the stamp, signature and address': 'طباعة الختم والتوقيع والعنوان',
  'The signature prints in blue when its ink is blue in the company profile. Void vouchers never carry them. Anyone in the company can print a voucher.':
    'يُطبع التوقيع بالأزرق إذا كان حبره أزرق في ملف الشركة، ولا تحملها السندات الملغاة أبداً. يستطيع أي عضو في الشركة طباعة السند.',
  'PDF paper': 'ورق ملف PDF',
  'As the documents': 'مثل المستندات',
  'A5, landscape (half an A4 page)': 'A5 بالعرض (نصف صفحة A4)',
  'Signature lines on receipt vouchers': 'أسطر التوقيع في سندات القبض',
  'Signature lines on payment vouchers': 'أسطر التوقيع في سندات الصرف',
  'Signature line {number} in English': 'سطر التوقيع {number} بالإنجليزية',
  'Signature line {number} in Arabic': 'سطر التوقيع {number} بالعربية',
  'In English': 'بالإنجليزية',
  'In Arabic': 'بالعربية',
  'Remove signature line {number}': 'إزالة سطر التوقيع {number}',
  'Add a line': 'إضافة سطر',
  'The stamp and signature print over the last line but one; the last line is for the other party.':
    'يُطبع الختم والتوقيع فوق السطر قبل الأخير، والسطر الأخير للطرف الآخر.',
  'Use the standard lines': 'استخدام الأسطر المعتادة',
} satisfies Dictionary;
