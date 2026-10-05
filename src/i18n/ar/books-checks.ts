import type { Dictionary } from '../index';

/**
 * Checks that keep the books in step with documents: payments and credits
 * applied only to issued documents, credits taken off documents that leave
 * the books, fixed currencies once paid, assets made from bills, recurring
 * invoices in locked periods and the aging row of unapplied credits.
 */
export default {
  // Payments and credits are applied to issued documents only.
  'Issue invoice {number} first.': 'أصدر الفاتورة {number} أولاً.',
  'Mark bill {number} as open first.': 'عيّن فاتورة المشتريات {number} كمفتوحة أولاً.',
  'Issue credit note {number} first.': 'أصدر الإشعار الدائن {number} أولاً.',
  'Mark vendor credit {number} as open first.':
    'عيّن الإشعار الدائن من المورد {number} كمفتوح أولاً.',
  '{number} is void, so nothing more can be applied to it.':
    'المستند {number} ملغى، لذا لا يمكن توزيع مبالغ إضافية عليه.',
  '{number} can’t take payments.': 'لا يقبل المستند {number} دفعات.',

  // Credits applied to documents that are voided or deleted.
  'It is taken off the invoices it was applied to, so they are owed again.':
    'يُزال من الفواتير التي طُبّق عليها، فتعود مستحقة.',
  'Credit notes applied to it are taken off, so they can be used again.':
    'تُزال الإشعارات الدائنة المطبقة عليها، فيمكن استخدامها مجدداً.',
  'It is taken off the bills it was applied to, so they are owed again.':
    'يُزال من فواتير المشتريات التي طُبّق عليها، فتعود مستحقة.',
  'Vendor credits applied to it are taken off, so they can be used again.':
    'تُزال الإشعارات الدائنة من الموردين المطبقة عليها، فيمكن استخدامها مجدداً.',

  // The currency of a document with payments.
  'Payments or credits are recorded on {number}, so its currency can’t change.':
    'سُجلت على {number} دفعات أو إشعارات دائنة، لذا لا يمكن تغيير عملته.',
  'Payments or credits are recorded on it, so its currency stays.':
    'سُجلت عليه دفعات أو إشعارات دائنة، لذا تبقى عملته كما هي.',

  // Fixed assets made from bill lines.
  'Asset {asset} was made from this bill. Void the asset first.':
    'أُنشئ الأصل {asset} من فاتورة المشتريات هذه. أبطل الأصل أولاً.',
  'Asset {asset} was made from line “{line}” of this bill, so the line can’t change. Void the asset first.':
    'أُنشئ الأصل {asset} من البند «{line}» في فاتورة المشتريات هذه، لذا لا يمكن تغيير البند. أبطل الأصل أولاً.',

  // Recurring invoices due in a locked period.
  'The invoice due on {date} was not created: the books are locked up to {lock}. Change the lock date in Settings → Accounting, or the schedule.':
    'لم تُنشأ الفاتورة المستحقة في {date}: الدفاتر مقفلة حتى {lock}. غيّر تاريخ الإقفال من الإعدادات ← المحاسبة، أو غيّر الجدول.',

  // Aging in the auditor pack.
  'Payments and credits not applied': 'دفعات وإشعارات دائنة غير موزعة',
} satisfies Dictionary;
