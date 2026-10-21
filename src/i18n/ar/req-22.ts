import type { Dictionary } from '../index';

/** The signature in blue ink, the signature pad, drafts that print as drafts, and the QR code. */
export default {
  'Sign on white paper and take a photo, draw it here, or use a transparent PNG. It is a printed signature, not an electronic one.':
    'وقّع على ورقة بيضاء والتقط لها صورة، أو ارسمه هنا، أو استخدم صورة PNG بخلفية شفافة. هذا توقيع مطبوع وليس توقيعًا إلكترونيًا.',
  'Draw signature': 'ارسم التوقيع',
  Ink: 'لون الحبر',
  Original: 'الأصلي',
  'Blue ink': 'حبر أزرق',
  'Blue ink turns dark strokes blue and the paper transparent. The upload is kept.':
    'الحبر الأزرق يجعل الخطوط الداكنة زرقاء والورقة شفافة، مع الاحتفاظ بالصورة الأصلية.',
  'Draw your signature': 'ارسم توقيعك',
  'Sign in the box with your finger, a pen or the mouse.':
    'وقّع داخل المربع بإصبعك أو بالقلم أو بالفأرة.',
  'Signature pad': 'لوحة التوقيع',
  'Use this signature': 'استخدام هذا التوقيع',
  'Drafts print without the stamp and signature, under a DRAFT watermark, so they can’t pass for the documents you send.':
    'تُطبع المسودات بلا ختم ولا توقيع وعليها علامة مائية «مسودة»، حتى لا تُحسب من المستندات التي ترسلها.',
  'The logo, stamp and signature are too large to keep together. Use smaller pictures.':
    'الشعار والختم والتوقيع أكبر من أن تُحفظ معًا. استخدم صورًا أصغر.',
  'Draft watermark': 'العلامة المائية للمسودة',
  'The QR code opens': 'رمز QR يفتح',
  'Printed on unpaid invoices and proformas, for paying by phone.':
    'يُطبع على الفواتير غير المدفوعة والفواتير المبدئية، للدفع بالهاتف.',
  'The payment link': 'رابط الدفع',
  'The invoice’s pay page (with online payments)': 'صفحة دفع الفاتورة (مع الدفع الإلكتروني)',
  'The QR code is on.': 'رمز QR مفعّل.',
  'The QR code is off, so documents print none.': 'رمز QR متوقف، فلا يُطبع على المستندات.',
  'Turn it on or off in Payment details': 'شغّله أو أوقفه من بيانات الدفع',
  'Drafts print with a DRAFT watermark, without the signature and stamp. Mark it as sent for the copy to share.':
    'تُطبع المسودات بعلامة مائية «مسودة» ومن دون التوقيع والختم. عيّن المستند كمرسل للحصول على النسخة التي تشاركها.',
  'Drafts print with a DRAFT watermark, without the signature and stamp.':
    'تُطبع المسودات بعلامة مائية «مسودة» ومن دون التوقيع والختم.',
  'The PDF stays a draft: a DRAFT watermark, without the signature and stamp.':
    'يبقى ملف PDF مسودة: بعلامة مائية «مسودة» ومن دون التوقيع والختم.',
  '{number} went out, but could not be marked as sent: {reason}':
    'أُرسل {number}، لكن تعذّر تعيينه كمُرسل: {reason}',
  'Drafts print with a DRAFT watermark, without the signature and stamp. Mark it as issued for the copy to send.':
    'تُطبع المسودات بعلامة مائية «مسودة» ومن دون التوقيع والختم. عيّن الأمر كصادر للحصول على النسخة التي ترسلها.',
} satisfies Dictionary;
