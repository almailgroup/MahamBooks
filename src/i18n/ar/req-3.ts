import type { Dictionary } from '../index';

/**
 * Separate Sales, Books (finance) and Inventory apps (#3, part a): the
 * layout of the apps in Settings → Team, and the new apps' descriptions.
 * Maham Sales is مهام سيلز and Maham Inventory مهام إنفنتوري, like مهام بوكس.
 * Manpower costing (#3, part b) is تسعير العمالة, its cost sheet كشف التكلفة.
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

  // Manpower costing (#3, part b): People → Manpower costing (تسعير العمالة).
  'Manpower costing': 'تسعير العمالة',
  'New manpower costing': 'تسعير عمالة جديد',
  'New costing': 'تسعير جديد',
  Costing: 'التسعير',
  'Costing not found': 'التسعير غير موجود',
  'Costing saved': 'تم حفظ التسعير',
  'Manpower costing is off': 'تسعير العمالة متوقف',
  'Manpower costing is on.': 'تسعير العمالة مُشغَّل.',
  'Manpower costing is off. Ask the owner, an admin or an accountant to turn it on.':
    'تسعير العمالة متوقف. اطلب من المالك أو المدير أو المحاسب تشغيله.',
  'Manpower costing turned on': 'تم تشغيل تسعير العمالة',
  'Manpower costing turned off': 'تم إيقاف تسعير العمالة',
  'Manpower costing settings updated': 'تم تحديث إعدادات تسعير العمالة',
  'Use manpower costing': 'استخدام تسعير العمالة',
  'Price posts of guards, cleaners and other staff from what they cost, with overhead and a margin, and make a quote for the customer with sell prices only.':
    'سعّر وظائف الحراس وعمال النظافة وغيرهم بحسب تكلفتهم، مع المصاريف غير المباشرة وهامش الربح، وأعدّ للعميل عرض سعر بأسعار البيع فقط.',
  'Off: nothing changes, as before. On: the owner, admins and accountants make costings here. Costings, their salaries, costs and margins stay private like payroll: staff and viewers never see them, and the quote shows the sell prices only.':
    'متوقف: لا يتغير شيء، كما كان من قبل. مُشغَّل: يُعدّ المالك والمديرون والمحاسبون التسعيرات هنا. وتبقى التسعيرات ورواتبها وتكاليفها وهوامشها سرية مثل الرواتب: لا يراها الموظفون والمشاهدون أبداً، ويُظهر عرض السعر أسعار البيع فقط.',
  'Hours past 8 a day are priced as overtime at 1.25. A post that needs more than 2 hours of overtime a day is flagged: article 66 of Labour Law 6/2010 allows that only with an exemption. Confirm with counsel before quoting such a post.':
    'تُسعَّر الساعات التي تزيد على 8 في اليوم عملاً إضافياً بنسبة 1.25. ويُنبَّه إلى الوظيفة التي تحتاج إلى أكثر من ساعتين من العمل الإضافي في اليوم، إذ لا تجيز المادة 66 من قانون العمل 6/2010 ذلك إلا باستثناء. تأكد من المستشار القانوني قبل تسعير مثل هذه الوظيفة.',
  'Posts priced from staff cost, with overhead and a margin, and the quotes they make.':
    'وظائف مسعّرة بحسب تكلفة العمالة، مع المصاريف غير المباشرة وهامش الربح، وعروض الأسعار المُعدّة منها.',
  'No costings yet': 'لا توجد تسعيرات بعد',
  'A costing prices the posts a customer asks for: guards, cleaners and other staff, their hours and days. It makes a quote with sell prices only.':
    'يسعّر التسعير الوظائف التي يطلبها العميل: الحراس وعمال النظافة وغيرهم، وساعاتهم وأيامهم. ويُعدّ منه عرض سعر بأسعار البيع فقط.',
  'A customer no longer here': 'عميل لم يعد موجوداً',
  'Only the owner, an admin or an accountant makes manpower costings.':
    'المالك أو المدير أو المحاسب وحده يُعدّ تسعيرات العمالة.',
  'Give the costing a name.': 'أدخل اسماً للتسعير.',
  'Give each post a job title.': 'أدخل مسمى وظيفياً لكل وظيفة.',
  'Choose the customer of the costing first.': 'اختر عميل التسعير أولاً.',
  'Add a post to the costing first.': 'أضف وظيفة إلى التسعير أولاً.',
  'Manpower costing {name} created': 'تم إنشاء تسعير العمالة {name}',
  'Manpower costing {name} updated': 'تم تحديث تسعير العمالة {name}',
  'Manpower costing {name} marked as won': 'تم تعليم تسعير العمالة {name} كرابح',
  'Manpower costing {name} marked as lost': 'تم تعليم تسعير العمالة {name} كخاسر',
  'Manpower costing {name} deleted': 'تم حذف تسعير العمالة {name}',
  'Quote {number} made from manpower costing {name}':
    'تم إعداد عرض السعر {number} من تسعير العمالة {name}',
  'A quote made from manpower costing {name}': 'عرض سعر مُعدّ من تسعير العمالة {name}',
  'Quote made': 'أُعدّ عرض السعر',

  // The costing page: switch, overhead and margin, rate card.
  'Overhead and margin': 'المصاريف غير المباشرة وهامش الربح',
  'Used by new costings. Each costing can change them.':
    'تُستخدم في التسعيرات الجديدة، ويمكن تغييرها في كل تسعير.',
  'Overhead (%)': 'المصاريف غير المباشرة (%)',
  'Added to the cost of each post.': 'تُضاف إلى تكلفة كل وظيفة.',
  'Margin (% of the sell price)': 'هامش الربح (% من سعر البيع)',
  'At most {max}%.': 'بحد أقصى {max}%.',
  'A {margin}% margin is a {markup}% markup on cost: a cost of 100.000 sells at {price}. The margin is a share of the sell price; a markup is added to the cost.':
    'هامش ربح بنسبة {margin}% يساوي إضافة {markup}% على التكلفة: تكلفة 100.000 تُباع بسعر {price}. فهامش الربح حصة من سعر البيع، أما الإضافة فتُضاف إلى التكلفة.',
  Saved: 'تم الحفظ',
  'Rate card': 'جدول الأجور',
  'The pay of each job title that posts are priced from, per person a month. Costings copy it into their posts, where it can be changed.':
    'أجر كل مسمى وظيفي تُسعَّر الوظائف بحسبه، للفرد في الشهر. وتنسخه التسعيرات إلى وظائفها حيث يمكن تغييره.',
  'Rate card saved': 'تم حفظ جدول الأجور',
  'Save rate card': 'حفظ جدول الأجور',
  'Fill from salaries': 'تعبئة من الرواتب',
  'Fill the rate card from the current salaries?': 'تعبئة جدول الأجور من الرواتب الحالية؟',
  'Each job title gets the average basic salary and allowances of the employees who have it now. The rate card is saved only when you save it.':
    'يأخذ كل مسمى وظيفي متوسط الراتب الأساسي والبدلات للموظفين الذين يشغلونه الآن. ولا يُحفظ جدول الأجور إلا عند حفظه.',
  'Worked out on this device from the current salaries: the average of each job title. An average of one person is their salary. Save it to keep it, or change it first.':
    'حُسب على هذا الجهاز من الرواتب الحالية: متوسط كل مسمى وظيفي. ومتوسط شخص واحد هو راتبه. احفظه للاحتفاظ به، أو غيّره أولاً.',
  'No job titles yet': 'لا توجد مسميات وظيفية بعد',
  'Add the job titles you price, or add employees with their job titles.':
    'أضف المسميات الوظيفية التي تسعّرها، أو أضف الموظفين بمسمياتهم الوظيفية.',
  'Add a job title': 'إضافة مسمى وظيفي',
  'Arabic job title': 'المسمى الوظيفي بالعربية',
  'Other costs': 'تكاليف أخرى',

  // A costing.
  'Make quote': 'إعداد عرض سعر',
  'Make another quote?': 'إعداد عرض سعر آخر؟',
  'This costing already has quote {number}. A new quote is made at today’s prices, and the costing points to it. {number} stays as it is.':
    'لهذا التسعير عرض السعر {number} بالفعل. سيُعدّ عرض سعر جديد بأسعار اليوم ويرتبط به التسعير، ويبقى {number} كما هو.',
  'Quote {number} made': 'تم إعداد عرض السعر {number}',
  'Draft quote made': 'تم إعداد مسودة عرض سعر',
  'Quote {number}': 'عرض السعر {number}',
  'Delete this costing?': 'حذف هذا التسعير؟',
  'Quote {number} made from it stays as it is.': 'يبقى عرض السعر {number} المُعدّ منه كما هو.',
  'This can’t be undone.': 'لا يمكن التراجع عن ذلك.',
  'Delete costing': 'حذف التسعير',
  'For the company only, never on the quote.': 'للشركة وحدها، ولا يظهر في عرض السعر أبداً.',
  'For example: Tower A, night shift': 'مثلاً: البرج أ، الوردية الليلية',
  'Choose a customer': 'اختر عميلاً',
  'Never on the quote.': 'لا تظهر في عرض السعر أبداً.',
  Posts: 'الوظائف',
  'Pay per person a month. Hours past 8 a day are overtime at 1.25; days past {days} a month are rest days worked, at 1.5.':
    'الأجر للفرد في الشهر. الساعات التي تزيد على 8 في اليوم عمل إضافي بنسبة 1.25، والأيام التي تزيد على {days} في الشهر أيام راحة يُعمل فيها بنسبة 1.5.',
  'Add from the rate card': 'إضافة من جدول الأجور',
  'Add from the rate card…': 'إضافة من جدول الأجور…',
  'No posts yet': 'لا توجد وظائف بعد',
  'Add the posts the customer asks for, from the rate card or by hand.':
    'أضف الوظائف التي يطلبها العميل، من جدول الأجور أو يدوياً.',
  'Choose…': 'اختر…',
  'Hours a day': 'الساعات في اليوم',
  'Days a month': 'الأيام في الشهر',
  'Cost a person': 'تكلفة الفرد',
  'With overhead': 'مع المصاريف غير المباشرة',
  'Sell price a person': 'سعر البيع للفرد',
  'A month': 'في الشهر',
  'Remove post': 'إزالة الوظيفة',
  'Add post': 'إضافة وظيفة',
  'Totals a month': 'الإجماليات في الشهر',
  'The quote shows the job titles, hours, days, people and sell prices only. Costs, salaries and the margin stay here.':
    'يُظهر عرض السعر المسميات الوظيفية والساعات والأيام وعدد الأفراد وأسعار البيع فقط. وتبقى التكاليف والرواتب وهامش الربح هنا.',
  'Cost a month': 'التكلفة في الشهر',
  Overhead: 'المصاريف غير المباشرة',
  'Sell price a month': 'سعر البيع في الشهر',
  Margin: 'هامش الربح',
  'Margin of the sell price': 'هامش الربح من سعر البيع',
  'Markup on cost': 'الإضافة على التكلفة',

  // What a post needs a second look for (lib/hr/costing.ts).
  'A post': 'وظيفة',
  '{title}: {value} hours of overtime a day. Article 66 of Labour Law 6/2010 allows at most 2 a day unless an exemption applies. Confirm with counsel before quoting, or add people to the post.':
    '{title}: {value} ساعات عمل إضافي في اليوم. لا تجيز المادة 66 من قانون العمل 6/2010 أكثر من ساعتين في اليوم إلا باستثناء. تأكد من المستشار القانوني قبل التسعير، أو أضف أفراداً إلى الوظيفة.',
  '{title}: {value} rest days worked a month, priced at 1.5. Article 67 also gives a day off in lieu for each; relief staff may cost less.':
    '{title}: {value} أيام راحة يُعمل فيها في الشهر، مسعّرة بنسبة 1.5. وتمنح المادة 67 أيضاً يوم راحة بديلاً عن كل منها، وقد تكون العمالة البديلة أقل تكلفة.',
  '{title}: the basic salary is below the minimum wage in Payroll settings.':
    '{title}: الراتب الأساسي أقل من الحد الأدنى للأجور في إعدادات الرواتب.',
  '{title}: no PIFSS rates are set in Payroll settings, so the employer’s share is left out.':
    '{title}: لم تُحدَّد نسب التأمينات الاجتماعية في إعدادات الرواتب، فلم تُحتسب حصة صاحب العمل.',
  '{title}: no rates are set for this GCC nationality in Payroll settings, so the employer’s share is left out.':
    '{title}: لم تُحدَّد نسب هذه الجنسية الخليجية في إعدادات الرواتب، فلم تُحتسب حصة صاحب العمل.',
  '{hours} hours a day, {days} days a month, per person a month':
    '{hours} ساعات في اليوم، {days} يوماً في الشهر، للفرد في الشهر',
  '{hours} hours a day, {days} days a month': '{hours} ساعات في اليوم، {days} يوماً في الشهر',

  // The cost sheet (كشف التكلفة), src/pdf/costing.tsx.
  'Cost sheet': 'كشف التكلفة',
  'Internal: never sent to the customer.': 'داخلي: لا يُرسل إلى العميل أبداً.',
  '{margin} of the sell price ({markup} markup on cost)':
    '{margin} من سعر البيع ({markup} إضافة على التكلفة)',
  'Amounts in {currency}, per person a month.': 'المبالغ بعملة {currency}، للفرد في الشهر.',
  Post: 'الوظيفة',
  Wage: 'الأجر',
  'Sell price': 'سعر البيع',
  'Cost with overhead': 'التكلفة مع المصاريف غير المباشرة',
  'An estimate under Labour Law 6/2010 from the company’s payroll settings, not legal advice. The quote shows the sell prices only.':
    'تقدير وفق قانون العمل 6/2010 من إعدادات الرواتب في الشركة، وليس استشارة قانونية. ويُظهر عرض السعر أسعار البيع فقط.',
} satisfies Dictionary;
