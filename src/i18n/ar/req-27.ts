import type { Dictionary } from '../index';

/** Designs per type of document: quote design, logo, SKU column, acceptance box, introduction. */
export default {
  'Colour of this document': 'لون هذا المستند',
  'Use the default colour': 'استخدام اللون الافتراضي',
  Introduction: 'المقدمة',
  'Printed above the items.': 'تُطبع فوق الأصناف.',
  'Quote design': 'تصميم عرض السعر',
  'Invoice design': 'تصميم الفاتورة',
  'Credit note design': 'تصميم الإشعار الدائن',
  Small: 'صغير',
  'Medium (as designed)': 'متوسط (كما في القالب)',
  Large: 'كبير',
  'Where the template puts it': 'حيث يضعه القالب',
  'On top, left': 'في الأعلى، يسارًا',
  'On top, centred': 'في الأعلى، في الوسط',
  'On top, right': 'في الأعلى، يمينًا',
  'Quotes now print with {name}': 'تُطبع عروض الأسعار الآن بقالب {name}',
  'Credit notes now print with {name}': 'تُطبع الإشعارات الدائنة الآن بقالب {name}',
  'Owners, admins and accountants choose the design of documents. You can look at it.':
    'يختار المالكون والمسؤولون والمحاسبون تصميم المستندات، ويمكنك الاطلاع عليه.',
  'Proformas, orders and delivery notes print like invoices, and so do quotes and credit notes until they have a design of their own.':
    'تُطبع الفواتير المبدئية والأوامر وأذونات التسليم مثل الفواتير، وكذلك عروض الأسعار والإشعارات الدائنة ما لم يكن لها تصميم خاص.',
  'Documents downloaded again later print with the design set here, unless they have a template or colour of their own.':
    'المستندات التي تُنزَّل لاحقًا تُطبع بالتصميم المحدد هنا، ما لم يكن لها قالب أو لون خاص.',
  'Same as invoices': 'مثل الفواتير',
  'Turn this off to give them a template, colour and layout of their own.':
    'أوقف هذا الخيار لتمنحها قالبًا ولونًا وتنسيقًا خاصًا بها.',
  'They have a design of their own, set below.': 'لها تصميم خاص، تحدده أدناه.',
  'Logo size': 'حجم الشعار',
  'Logo position': 'موضع الشعار',
  'Arabic documents read from the right, so left and right swap.':
    'المستندات العربية تُقرأ من اليمين، فيتبادل اليسار واليمين.',
  'SKU column': 'عمود رمز الصنف',
  'The code of each line picked from your items.': 'رمز كل بند اختير من أصنافك.',
  'Item pictures': 'صور الأصناف',
  'A small picture beside each item, once items can have pictures.':
    'صورة صغيرة بجانب كل صنف، عندما يصبح للأصناف صور.',
  'Customer acceptance box': 'خانة قبول العميل',
  'On quotes and proformas: a box for the customer to sign, stamp and date.':
    'على عروض الأسعار والفواتير المبدئية: خانة يوقّع فيها العميل ويختم ويكتب التاريخ.',
  'On every document': 'على كل المستندات',
  'Quote introduction': 'مقدمة عرض السعر',
  'Printed above the items of new quotes, e.g. “Further to your request…”.':
    'تُطبع فوق أصناف عروض الأسعار الجديدة، مثل «بالإشارة إلى طلبكم…».',
  'Acceptance wording on quotes': 'عبارة القبول على عروض الأسعار',
} satisfies Dictionary;
