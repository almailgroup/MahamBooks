import type { Dictionary } from '../index';

/**
 * Separate Sales, Books (finance) and Inventory apps (#3, part a): the
 * layout of the apps in Settings → Team, and the new apps' descriptions.
 * Maham Sales is مهام سيلز and Maham Inventory مهام إنفنتوري, like مهام بوكس.
 */
export default {
  // The apps (src/apps/sales, src/apps/inventory, Books' finance variant).
  'Quotes, orders, invoices, payments received and customers.':
    'عروض الأسعار والطلبات والفواتير والمقبوضات والعملاء.',
  'Items, stock, warehouses and stock counts.': 'الأصناف والمخزون والمستودعات وجرد المخزون.',
  'Purchases, cheques, banking, accounting and reports.':
    'المشتريات والشيكات والبنوك والمحاسبة والتقارير.',
  Products: 'المنتجات',

  // Settings → Team → App layout.
  'App layout': 'تخطيط التطبيقات',
  'The apps everyone in {company} sees.': 'التطبيقات التي يراها كل من في {company}.',
  'Maham Sales and Maham Inventory as their own apps': 'مهام سيلز ومهام إنفنتوري تطبيقان مستقلان',
  'Maham Sales has quotes, orders, invoices, payments received and customers; Maham Inventory has items and stock. Maham Books keeps purchases, cheques, banking, accounting and reports, with invoices under Receivables. Pages, addresses and records stay as they are.':
    'يضم مهام سيلز عروض الأسعار والطلبات والفواتير والمقبوضات والعملاء، ويضم مهام إنفنتوري الأصناف والمخزون. ويبقى في مهام بوكس المشتريات والشيكات والبنوك والمحاسبة والتقارير، والفواتير تحت الذمم المدينة. وتبقى الصفحات وعناوينها والسجلات كما هي.',
  'Only the owner or an admin changes the app layout.':
    'المالك أو المدير وحده يغيّر تخطيط التطبيقات.',
  'Give Sales and Inventory their own apps?': 'فصل المبيعات والمخزون في تطبيقين مستقلين؟',
  'Everyone in {company} sees Maham Sales, Maham Books and Maham Inventory in place of Maham Books, on each device once it syncs. Pages, addresses and records stay as they are. You can switch back at any time.':
    'سيرى كل من في {company} مهام سيلز ومهام بوكس ومهام إنفنتوري بدلاً من مهام بوكس، على كل جهاز بعد مزامنته. وتبقى الصفحات وعناوينها والسجلات كما هي. ويمكنك العودة إلى التخطيط السابق في أي وقت.',
  'App layout saved': 'تم حفظ تخطيط التطبيقات',
} satisfies Dictionary;
