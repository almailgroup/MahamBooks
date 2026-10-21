import type { Dictionary } from '../index';

/** The Books dashboard's overview: period, receivables and payables, cash flow, income and expense, top expenses, accounts and the watchlist. */
export default {
  // Layout and period
  'Dashboard layout': 'تخطيط لوحة التحكم',
  'Last 6 months': 'آخر 6 أشهر',
  '{period} · {currency}': '{period} · {currency}',
  '{from} – {to}': '{from} – {to}',
  'Show {count} hidden cards': {
    one: 'إظهار البطاقة المخفية',
    two: 'إظهار البطاقتين المخفيتين',
    few: 'إظهار {count} بطاقات مخفية',
    many: 'إظهار {count} بطاقة مخفية',
    other: 'إظهار {count} بطاقة مخفية',
  },
  'Hide {card}': 'إخفاء {card}',
  'Hide this card': 'إخفاء هذه البطاقة',
  'No invoices in this period': 'لا توجد فواتير في هذه الفترة',

  // Receivables and payables
  Receivables: 'الذمم المدينة',
  'Unpaid invoices': 'الفواتير غير المدفوعة',
  Payables: 'الذمم الدائنة',
  'Unpaid bills': 'فواتير المشتريات غير المدفوعة',
  'No unpaid bills. Everything you were billed has been paid.':
    'لا توجد فواتير مشتريات غير مدفوعة. سُدِّد كل ما فُوتِر عليك.',
  'Unpaid bills by age': 'فواتير المشتريات غير المدفوعة حسب عمرها',

  // Cash flow
  'No money in or out of your bank and cash accounts in this period.':
    'لا توجد مبالغ دخلت حسابات البنوك والنقد أو خرجت منها في هذه الفترة.',
  'Cash at the end of each month': 'النقد في نهاية كل شهر',
  'Cash at the end of the month': 'النقد في نهاية الشهر',
  'Cash on {date}': 'النقد في {date}',
  Incoming: 'الوارد',
  Outgoing: 'الصادر',

  // Income and expense
  'Income and expense': 'الإيرادات والمصروفات',
  '{period} · accrual basis': '{period} · على أساس الاستحقاق',
  'No income or expenses in this period.': 'لا توجد إيرادات أو مصروفات في هذه الفترة.',
  'Net profit': 'صافي الربح',
  'Net loss': 'صافي الخسارة',
  'Income and expenses per month': 'الإيرادات والمصروفات شهرياً',

  // Top expenses
  'Top expenses': 'أعلى المصروفات',
  'No expenses in this period.': 'لا توجد مصروفات في هذه الفترة.',
  'Expenses by account': 'المصروفات حسب الحساب',
  '{count} other accounts': {
    one: 'حساب آخر',
    two: 'حسابان آخران',
    few: '{count} حسابات أخرى',
    many: '{count} حساباً آخر',
    other: '{count} حساب آخر',
  },

  // Bank and card accounts
  'Bank and card accounts': 'الحسابات البنكية والبطاقات',
  'In your books today': 'في دفاترك اليوم',
  'Total in bank and cash': 'الإجمالي في البنوك والنقد',
  'Owed on cards': 'المستحق على البطاقات',

  // Watchlist
  Watchlist: 'قائمة المتابعة',
  'Balances on {date}; income and expenses for the period':
    'الأرصدة في {date}، والإيرادات والمصروفات عن الفترة',
  'Pick up to {count} accounts to keep an eye on, such as a deposit, a loan or a cost.':
    'اختر حتى {count} حسابات لمتابعتها، مثل وديعة أو قرض أو مصروف.',
  'In the period': 'خلال الفترة',
  'Balance on {date}': 'الرصيد في {date}',
  'Remove {name} from the watchlist': 'إزالة {name} من قائمة المتابعة',
  'Remove from the watchlist': 'إزالة من قائمة المتابعة',
  'The watchlist holds {count} accounts. Remove one to add another.':
    'تتسع قائمة المتابعة لـ{count} حسابات. أزل حساباً لإضافة غيره.',
  'Add an account…': 'إضافة حساب…',
  'No accounts found.': 'لا توجد حسابات مطابقة.',
  'Add an account to the watchlist': 'إضافة حساب إلى قائمة المتابعة',

  // Settings → Accounting
  'Books dashboard': 'لوحة تحكم مهام بوكس',
  'How the dashboard of Maham Books is laid out for everyone in this company.':
    'طريقة عرض لوحة تحكم مهام بوكس لكل من في هذه الشركة.',
  'Overview layout': 'تخطيط النظرة العامة',
  'Adds receivables next to payables, cash flow, income and expense, top expenses, bank and card accounts and a watchlist above today’s cards. Each person picks the period, the accounts they watch and the cards they hide.':
    'يضيف الذمم المدينة بجانب الذمم الدائنة، والتدفقات النقدية، والإيرادات والمصروفات، وأعلى المصروفات، والحسابات البنكية والبطاقات، وقائمة المتابعة فوق البطاقات الحالية. ويختار كل شخص الفترة والحسابات التي يتابعها والبطاقات التي يخفيها.',
  'Owners and admins choose the dashboard layout.': 'يختار المالكون والمديرون تخطيط لوحة التحكم.',
} satisfies Dictionary;
