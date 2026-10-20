import type { Dictionary } from '../index';

/** Importing bank statements from Excel and HTML files, with their layout remembered. */
export default {
  'Download a statement from your online banking as Excel, CSV or OFX, then choose it here.':
    'نزّل كشف الحساب من خدمة الإنترنت البنكية بصيغة Excel أو CSV أو OFX، ثم اختره هنا.',
  'Excel, CSV, OFX or QFX': 'Excel أو CSV أو OFX أو QFX',
  'Import an Excel, CSV or OFX statement from your online banking to match it to your books.':
    'استورد كشف حساب بصيغة Excel أو CSV أو OFX من خدمة الإنترنت البنكية لمطابقته مع دفاترك.',
  'PDF statements can’t be read. Download the statement as Excel or CSV instead.':
    'لا يمكن قراءة كشوف الحساب بصيغة PDF. نزّل الكشف بصيغة Excel أو CSV بدلاً منها.',
  'The table starts at row': 'يبدأ الجدول من الصف',
  'Rows above it, such as the account name and the period, are left out.':
    'تُستبعد الصفوف التي فوقه، مثل اسم الحساب والفترة.',
  'Row {number}: {sample}': 'الصف {number}: {sample}',
  'The file as it is': 'الملف كما هو',
  'One column and a debit or credit column': 'عمود للمبلغ وعمود يبيّن مدين أو دائن',
  'Debit or credit': 'مدين أو دائن',
  'Value date': 'تاريخ القيمة',
  'Value date {date}': 'تاريخ القيمة {date}',
  'Remember this layout for this account': 'تذكّر هذا التنسيق لهذا الحساب',
  'Read with the layout remembered for this account.': 'قُرئ بالتنسيق المحفوظ لهذا الحساب.',
  'Its next statements are then read the same way.': 'وتُقرأ كشوفه التالية بالطريقة نفسها.',
  '{count} rows of totals or notes after the lines left out': {
    one: 'استُبعد صف واحد من الإجماليات أو الملاحظات بعد الحركات',
    two: 'استُبعد صفّان من الإجماليات أو الملاحظات بعد الحركات',
    few: 'استُبعدت {count} صفوف من الإجماليات أو الملاحظات بعد الحركات',
    many: 'استُبعد {count} صفاً من الإجماليات أو الملاحظات بعد الحركات',
    other: 'استُبعد {count} صف من الإجماليات أو الملاحظات بعد الحركات',
  },
  'The amounts add up to the balances in the file.': 'تتطابق المبالغ مع الأرصدة الواردة في الملف.',
  'The balances go the other way: money in and money out look swapped. Check the amount columns, or flip the signs.':
    'تسير الأرصدة في الاتجاه المعاكس: يبدو أن المبالغ الواردة والصادرة مبدّلة. راجع أعمدة المبالغ أو اعكس الإشارات.',
  'The amounts don’t add up to the balances in the file. Check the amount columns before importing.':
    'لا تتطابق المبالغ مع الأرصدة الواردة في الملف. راجع أعمدة المبالغ قبل الاستيراد.',
} satisfies Dictionary;
