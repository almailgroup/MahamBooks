import type { Dictionary } from '../index';

/** Employee letters: templates, drafts, issuing, approval and printing (#19). */
export default {
  // Kinds, languages, events and fields (src/lib/hr/letters.ts)
  'Salary certificate': 'شهادة راتب',
  'Experience certificate': 'شهادة خبرة',
  'Employment certificate': 'شهادة عمل',
  'Warning letter': 'خطاب إنذار',
  'No objection certificate': 'شهادة عدم ممانعة',
  'Salary transfer letter': 'خطاب تحويل راتب',
  'Other letter': 'خطاب آخر',
  'When an employee joins': 'عند تعيين موظف',
  'When an employee leaves': 'عند ترك موظف للعمل',
  'When a salary changes': 'عند تغيّر الراتب',
  'Made when they joined': 'أُعدّت عند تعيينه',
  'Made when they left': 'أُعدّت عند تركه العمل',
  'Made when their salary changed': 'أُعدّت عند تغيّر راتبه',
  'Made automatically': 'أُعدّت تلقائيًا',
  'Employee name': 'اسم الموظف',
  'Mr. or Ms.': 'السيد أو السيدة',
  'Length of service': 'مدة الخدمة',
  'Service until': 'الخدمة حتى',
  'Total monthly salary': 'الراتب الشهري الإجمالي',
  'Total salary in words': 'الراتب الإجمالي كتابةً',
  'Letter number': 'رقم الخطاب',
  'Letter date': 'تاريخ الخطاب',
  'Addressed to': 'موجّه إلى',
  'Purpose or reason': 'الغرض أو السبب',
  Salary: 'الراتب',
  'Private details': 'البيانات الخاصة',

  // People → Letters
  'Letters to and about employees, made from the company’s templates.':
    'خطابات إلى الموظفين أو بشأنهم، تُعدّ من قوالب الشركة.',
  'Letter templates': 'قوالب الخطابات',
  'New letter': 'خطاب جديد',
  'Employee letters': 'خطابات الموظفين',
  'Salary, experience and employment certificates, warning letters and no objection certificates, filled from each employee’s record and printed with the company’s letterhead.':
    'شهادات الراتب والخبرة والعمل وخطابات الإنذار وشهادات عدم الممانعة، تُملأ من سجل كل موظف وتُطبع على ورق الشركة الرسمي.',
  'Use employee letters': 'استخدام خطابات الموظفين',
  'Off: nothing changes, as before. On: accountants draft letters and ask for approval; the owner, admins and the members allowed to approve issue them. Each letter gets a number when it is issued (HR-2026-0001, from 1 again each year), which is never used twice.':
    'عند الإيقاف: لا يتغير شيء، كما كان من قبل. عند التشغيل: يُعدّ المحاسبون مسودات الخطابات ويطلبون اعتمادها، ويُصدرها المالك والمديرون والأعضاء المسموح لهم بالاعتماد. ويحصل كل خطاب على رقم عند إصداره (HR-2026-0001، يبدأ من 1 كل سنة)، ولا يُستخدم الرقم مرتين أبدًا.',
  'Employee letters are on. Only the owner or an admin turns them off.':
    'خطابات الموظفين مفعّلة. المالك أو المدير وحده يوقفها.',
  'Employee letters are off. Ask the owner or an admin to turn them on.':
    'خطابات الموظفين متوقفة. اطلب من المالك أو المدير تفعيلها.',
  'Warning letters and no objection certificates have legal weight under the Labour Law: ask your lawyer to check their wording in Letter templates before they are issued. Letters are printed, never emailed, and only the owner, admins and approvers print the company stamp on them.':
    'لخطابات الإنذار وشهادات عدم الممانعة أثر قانوني بموجب قانون العمل: اطلب من محاميك مراجعة صياغتها في قوالب الخطابات قبل إصدارها. تُطبع الخطابات ولا تُرسل بالبريد الإلكتروني أبدًا، ولا يطبع ختم الشركة عليها إلا المالك والمديرون والمعتمِدون.',
  'Employee letters turned on': 'تم تفعيل خطابات الموظفين',
  'Employee letters turned off': 'تم إيقاف خطابات الموظفين',
  'Letters accountants asked to issue. Approving issues the letter on this device.':
    'خطابات طلب المحاسبون إصدارها. الاعتماد يُصدر الخطاب على هذا الجهاز.',
  'Letters you asked to issue, until an approver decides.':
    'خطابات طلبتَ إصدارها، حتى يقرر المعتمِد.',
  'To print': 'للطباعة',
  Drafts: 'المسودات',
  'Search by name or number': 'ابحث بالاسم أو الرقم',
  'Search letters': 'البحث في الخطابات',
  'Print all': 'طباعة الكل',
  'Print selected': 'طباعة المحدد',
  'Nothing to print': 'لا يوجد ما يُطبع',
  'No drafts': 'لا توجد مسودات',
  'No letters issued yet': 'لم يصدر أي خطاب بعد',
  'No void letters': 'لا توجد خطابات ملغاة',
  'Letters show here once they are issued, until they are printed.':
    'تظهر الخطابات هنا بعد إصدارها، حتى تُطبع.',
  'Drafts made by hand, and those the templates make when an employee joins, leaves or has their salary changed. A person checks and issues each one.':
    'المسودات المُعدّة يدويًا، وتلك التي تُعدّها القوالب عند تعيين موظف أو تركه العمل أو تغيّر راتبه. ويراجع شخصٌ كل واحدة ويُصدرها.',
  'Letters: {count} to print': {
    zero: 'الخطابات: لا شيء للطباعة',
    one: 'الخطابات: خطاب واحد للطباعة',
    two: 'الخطابات: خطابان للطباعة',
    few: 'الخطابات: {count} خطابات للطباعة',
    many: 'الخطابات: {count} خطابًا للطباعة',
    other: 'الخطابات: {count} خطاب للطباعة',
  },
  'An employee no longer here': 'موظف لم يعد موجودًا',

  // Letter templates
  'The wording of each kind of letter. Fields in braces are filled from the employee’s record; the text itself is the company’s, in Arabic and English.':
    'صياغة كل نوع من الخطابات. تُملأ الحقول بين الأقواس من سجل الموظف، أما النص نفسه فهو نص الشركة، بالعربية والإنجليزية.',
  'New template': 'قالب جديد',
  'Employee letters are off': 'خطابات الموظفين متوقفة',
  'Turn them on in People → Letters first.': 'فعّلها أولًا من الموظفون ← الخطابات.',
  'The app’s wording': 'صياغة التطبيق',
  'This template could not be found.': 'تعذّر العثور على هذا القالب.',
  'Save template': 'حفظ القالب',
  'Template saved': 'تم حفظ القالب',
  'Template archived': 'تمت أرشفة القالب',
  'Template restored': 'تمت استعادة القالب',
  'Put back the app’s wording?': 'إعادة صياغة التطبيق؟',
  'The Arabic and English text of this template go back to the app’s wording. Letters already made keep theirs.':
    'يعود النص العربي والإنجليزي لهذا القالب إلى صياغة التطبيق. وتحتفظ الخطابات المُعدّة من قبل بنصوصها.',
  'The app’s wording is back': 'عادت صياغة التطبيق',
  'This template is archived: no new letters are made from it.':
    'هذا القالب مؤرشف: لا تُعدّ منه خطابات جديدة.',
  'Kind of letter': 'نوع الخطاب',
  'Printed in': 'لغة الطباعة',
  'Arabic unless you choose otherwise. Each letter can still be changed.':
    'بالعربية ما لم تختر غير ذلك. ويمكن تغييرها لكل خطاب.',
  Wording: 'الصياغة',
  'Click a field to put it where the cursor is. Fields are filled from the employee’s record when the letter is issued.':
    'انقر حقلًا لإدراجه في موضع المؤشر. تُملأ الحقول من سجل الموظف عند إصدار الخطاب.',
  'Subject ({language})': 'الموضوع ({language})',
  'Text ({language})': 'النص ({language})',
  'These fields aren’t known and print as written: {fields}':
    'هذه الحقول غير معروفة وتُطبع كما كُتبت: {fields}',
  'The text asks for private details, which print masked until the template is allowed to show them (below).':
    'يطلب النص بيانات خاصة، وتُطبع مخفية حتى يُسمح للقالب بإظهارها (أدناه).',
  'Signature and stamp': 'التوقيع والختم',
  'Signed by': 'يوقّعه',
  'Their title': 'منصبه',
  'Print the signature': 'طباعة التوقيع',
  'The signature of Settings → Company, on issued letters only. Drafts never show it.':
    'التوقيع المحفوظ في الإعدادات ← الشركة، على الخطابات الصادرة فقط. ولا يظهر على المسودات أبدًا.',
  'Print the company stamp': 'طباعة ختم الشركة',
  'On issued letters only. Drafts never show it.':
    'على الخطابات الصادرة فقط. ولا يظهر على المسودات أبدًا.',
  'Automatic drafts': 'المسودات التلقائية',
  'A draft of this letter is made by itself when one of these happens. It is never issued or printed without a person: it waits in People → Letters → Drafts.':
    'تُعدّ مسودة من هذا الخطاب تلقائيًا عند حدوث أحد هذه الأمور. ولا تُصدر ولا تُطبع أبدًا دون شخص: تنتظر في الموظفون ← الخطابات ← المسودات.',
  'Employees imported from a file make no drafts.':
    'الموظفون المستوردون من ملف لا تُعدّ لهم مسودات.',
  'This letter may show the Civil ID, passport number and bank account':
    'يجوز أن يُظهر هذا الخطاب الرقم المدني ورقم جواز السفر والحساب البنكي',
  'Only where its text asks for them, and only when the owner, an admin or an approver issues it. Otherwise they print masked. A salary transfer letter to a bank may need them.':
    'فقط حيث يطلبها نصه، وفقط عندما يُصدره المالك أو المدير أو المعتمِد. وإلا تُطبع مخفية. قد يحتاجها خطاب تحويل الراتب إلى البنك.',
  'With an invented employee.': 'ببيانات موظف افتراضي.',

  // The letter dialog
  '{kind} {number}': '{kind} {number}',
  'Made from a template, with the employee’s record.': 'يُعدّ من قالب، ببيانات سجل الموظف.',
  'Issued on {date}': 'صدر في {date}',
  'Not printed yet': 'لم يُطبع بعد',
  'Void on {date}: {reason}': 'أُلغي في {date}: {reason}',
  'Choose an employee': 'اختر موظفًا',
  'No employees found': 'لا يوجد موظفون مطابقون',
  'To whom it may concern': 'إلى من يهمه الأمر',
  'What happened': 'ما حدث',
  'Printed in the letter: the breach, with its date.': 'يُطبع في الخطاب: المخالفة وتاريخها.',
  'What the company has no objection to': 'ما لا تمانع فيه الشركة',
  'For example: their travel abroad, or a driving licence.':
    'مثلًا: سفره إلى الخارج، أو استخراج رخصة قيادة.',
  'Printed only where the text has the purpose field.': 'يُطبع فقط حيث يحتوي النص على حقل الغرض.',
  'Change the wording of this letter': 'تغيير صياغة هذا الخطاب',
  'Fields in braces, such as {employee.name}, are filled from the employee’s record when the letter is issued. Only this letter changes, not the template.':
    'تُملأ الحقول بين الأقواس، مثل {employee.name}، من سجل الموظف عند إصدار الخطاب. ويتغير هذا الخطاب وحده، لا القالب.',
  'The Civil ID, passport number and bank account show masked to you. They are filled in when the owner, an admin or an approver issues the letter.':
    'يظهر لك الرقم المدني ورقم جواز السفر والحساب البنكي مخفية. وتُملأ عندما يُصدر المالك أو المدير أو المعتمِد الخطاب.',
  'As issued': 'كما صدر',
  'Signed copy': 'النسخة الموقّعة',
  'Once it is signed, keep a scan in the employee’s personnel file here.':
    'بعد توقيعه، احفظ نسخة ممسوحة منه في ملف الموظف هنا.',
  'Attach the signed copy': 'إرفاق النسخة الموقّعة',
  'It has no number yet, so none is used.': 'ليس لها رقم بعد، فلا يُستخدم أي رقم.',
  'Save draft': 'حفظ المسودة',
  'Draft saved': 'تم حفظ المسودة',
  'Issue letter': 'إصدار الخطاب',
  'Issue this letter?': 'إصدار هذا الخطاب؟',
  'It gets the next letter number, and its text is frozen as it is now. An issued letter can be voided, never deleted, so its number stays used.':
    'يحصل على رقم الخطاب التالي، ويُثبَّت نصه كما هو الآن. ويمكن إلغاء الخطاب الصادر، ولا يُحذف أبدًا، فيبقى رقمه مستخدمًا.',
  'Letter {number} issued': 'صدر الخطاب {number}',
  'Letter issued': 'صدر الخطاب',
  'Void letter': 'إلغاء الخطاب',
  'Void letter {number}?': 'إلغاء الخطاب {number}؟',
  'It keeps its number, which is never given again, and prints as void. Make a new letter in its place if one is needed.':
    'يحتفظ برقمه، ولا يُعطى هذا الرقم مرة أخرى أبدًا، ويُطبع على أنه ملغى. أعدّ خطابًا جديدًا بدلًا منه إن لزم.',
  'Why is it void?': 'لماذا أُلغي؟',
  'Letter voided': 'تم إلغاء الخطاب',
  'There is no letter template to make it from. Add one in Letter templates.':
    'لا يوجد قالب خطاب يُعدّ منه. أضف قالبًا في قوالب الخطابات.',
  'Ask for approval to issue this letter?': 'طلب اعتماد إصدار هذا الخطاب؟',
  'The owner, or a member the owner allowed to approve, checks it and issues it. Until then it stays a draft, and can’t be changed unless the request is taken back.':
    'يراجعه المالك، أو عضو سمح له المالك بالاعتماد، ويُصدره. وحتى ذلك الحين يبقى مسودة، ولا يمكن تغييره إلا إذا سُحب الطلب.',
  'Waiting for approval to issue it.': 'بانتظار اعتماد إصداره.',
  'Approved, but not issued yet on the approver’s device.':
    'تم الاعتماد، لكنه لم يصدر بعد على جهاز المعتمِد.',
  'Not approved. Change it if needed and ask again.':
    'لم يُعتمد. غيّره إن لزم واطلب الاعتماد مرة أخرى.',
  'The request was taken back.': 'سُحب الطلب.',
  'Approve and issue': 'اعتماد وإصدار',
  'Approve and issue this letter?': 'اعتماد هذا الخطاب وإصداره؟',
  'Don’t issue this letter?': 'عدم إصدار هذا الخطاب؟',
  'It is issued on this device as it was sent: it gets the next letter number, and its text is frozen.':
    'يصدر على هذا الجهاز كما أُرسل: يحصل على رقم الخطاب التالي، ويُثبَّت نصه.',
  'The letter stays a draft. Whoever asked sees why.': 'يبقى الخطاب مسودة. ويرى مقدّم الطلب السبب.',
  'Approved, and the letter is issued': 'تم الاعتماد، وصدر الخطاب',
  'This letter isn’t on this device yet. Let it sync, then decide.':
    'هذا الخطاب ليس على هذا الجهاز بعد. انتظر المزامنة، ثم قرر.',

  // The employee's page and the overview
  'No letters yet': 'لا توجد خطابات بعد',
  'Salary, experience and employment certificates, warning letters and no objection certificates, filled from their record.':
    'شهادات الراتب والخبرة والعمل وخطابات الإنذار وشهادات عدم الممانعة، تُملأ من سجله.',
  'Signed copy of letter {number}': 'النسخة الموقّعة من الخطاب {number}',
  '{name} has letters issued to them, which keep their numbers, so they stay marked as left.':
    'صدرت خطابات لـ{name} تحتفظ بأرقامها، لذا يبقى مسجلًا كتارك للعمل.',
  'This employee has letters issued to them, which keep their numbers. Mark them as left instead.':
    'صدرت لهذا الموظف خطابات تحتفظ بأرقامها. سجّله كتارك للعمل بدلًا من ذلك.',
  'New employee letter': 'خطاب موظف جديد',

  // Printing
  'Ref.': 'الرقم',
  'This letter is void': 'هذا الخطاب ملغى',
  'Back to letters': 'العودة إلى الخطابات',
  'This letter could not be found.': 'تعذّر العثور على هذا الخطاب.',

  // Saving and the cloud (src/db/letters.ts, src/cloud/outbox.ts)
  'Employee letters are off for this company.': 'خطابات الموظفين متوقفة لهذه الشركة.',
  'Only the owner or an admin turns employee letters on or off.':
    'المالك أو المدير وحده يفعّل خطابات الموظفين أو يوقفها.',
  'Only the owner, an admin or an approver issues letters. Ask for approval instead.':
    'المالك أو المدير أو المعتمِد وحده يُصدر الخطابات. اطلب الاعتماد بدلًا من ذلك.',
  'Only the owner, an admin or an approver voids letters.':
    'المالك أو المدير أو المعتمِد وحده يُلغي الخطابات.',
  'This letter is already issued, so it stays issued.': 'صدر هذا الخطاب، لذا يبقى صادرًا.',
  'Issued letters are kept, so their numbers stay used. Void it instead.':
    'تُحفظ الخطابات الصادرة، فتبقى أرقامها مستخدمة. ألغِه بدلًا من ذلك.',
  'Your role can’t change letter templates.': 'لا يسمح دورك بتغيير قوالب الخطابات.',
  'Your role can’t make letters.': 'لا يسمح دورك بإعداد الخطابات.',
  'Give the template a name.': 'أعطِ القالب اسمًا.',
  'Write the letter’s Arabic text.': 'اكتب النص العربي للخطاب.',
  'Write the letter’s English text.': 'اكتب النص الإنجليزي للخطاب.',
  'Write the letter’s text.': 'اكتب نص الخطاب.',
  'This template has no default wording.': 'ليس لهذا القالب صياغة افتراضية.',
  'Letter template {name} saved': 'تم حفظ قالب الخطاب {name}',
  'Choose the employee the letter is for.': 'اختر الموظف الذي يخصه الخطاب.',
  'This letter is issued, so it can’t be changed.': 'صدر هذا الخطاب، لذا لا يمكن تغييره.',
  'This letter is waiting for approval. Take the request back to change it.':
    'هذا الخطاب بانتظار الاعتماد. اسحب الطلب لتغييره.',
  'This letter is waiting for approval. Take the request back to delete it.':
    'هذا الخطاب بانتظار الاعتماد. اسحب الطلب لحذفه.',
  'Letter draft made for {name}': 'أُعدّت مسودة خطاب لـ{name}',
  'Choose the letter’s date.': 'اختر تاريخ الخطاب.',
  'This letter is already issued.': 'صدر هذا الخطاب من قبل.',
  'The employee of this letter no longer exists.': 'موظف هذا الخطاب لم يعد موجودًا.',
  'Letter {number} voided': 'أُلغي الخطاب {number}',
  'Only an issued letter is voided.': 'لا يُلغى إلا خطاب صادر.',
  'Say why the letter is void.': 'اذكر سبب إلغاء الخطاب.',
  'Issue the letter first.': 'أصدر الخطاب أولًا.',
  'This letter is already waiting for approval.': 'هذا الخطاب بانتظار الاعتماد من قبل.',
  'This letter changed after it was sent for approval. Reject this request; it can be sent again.':
    'تغيّر هذا الخطاب بعد إرساله للاعتماد. ارفض هذا الطلب؛ ويمكن إرساله مرة أخرى.',
  'The letter of this request no longer exists.': 'خطاب هذا الطلب لم يعد موجودًا.',
  'This letter is void.': 'هذا الخطاب ملغى.',

  // Activity (src/db/approvals.ts)
  'Letter sent for approval': 'أُرسل خطاب للاعتماد',
  'Approval request for a letter cancelled': 'أُلغي طلب اعتماد خطاب',
  'Approval given to issue a letter': 'اعتُمد إصدار خطاب',
  'Approval refused to issue a letter': 'رُفض اعتماد إصدار خطاب',
  'Approval request for a letter expired': 'انتهت مدة طلب اعتماد خطاب',
} satisfies Dictionary;
