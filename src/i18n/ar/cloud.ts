import type { Dictionary } from '../index';

/** Accounts, teams and sync with the cloud. */
export default {
  // Roles
  Admin: 'مدير',
  Accountant: 'محاسب',
  Staff: 'موظف',
  Viewer: 'مُطّلع',
  'Everything, including the team and deleting the company.':
    'كل شيء، بما في ذلك إدارة الفريق وحذف الشركة.',
  'Everything except deleting the company. Manages the team.':
    'كل شيء ما عدا حذف الشركة. يدير الفريق.',
  'All books and payroll. No team management.': 'كل الحسابات والرواتب، دون إدارة الفريق.',
  'Sales, purchases, cheques and stock. No payroll or accounting setup.':
    'المبيعات والمشتريات والشيكات والمخزون، دون الرواتب أو إعدادات المحاسبة.',
  'Can look at everything except payroll, and change nothing.':
    'يطّلع على كل شيء ما عدا الرواتب، ولا يغيّر شيئاً.',
  Role: 'الدور',
  'Role of {name}': 'دور {name}',
  'Role changed': 'تم تغيير الدور',
  You: 'أنت',

  // Sign in, create an account, passwords
  'Sign in': 'تسجيل الدخول',
  'Sign out': 'تسجيل الخروج',
  'Sign out?': 'تسجيل الخروج؟',
  'Signed out': 'تم تسجيل الخروج',
  'Could not sign out.': 'تعذّر تسجيل الخروج.',
  'Create an account': 'إنشاء حساب',
  'Use on this device only': 'الاستخدام على هذا الجهاز فقط',
  'Your companies sync to every device you sign in on.':
    'تتم مزامنة شركاتك مع كل جهاز تسجّل الدخول عليه.',
  'New to {app}? {link}': 'جديد على {app}؟ {link}',
  'Already have an account? {link}': 'لديك حساب؟ {link}',
  Password: 'كلمة المرور',
  'Show password': 'إظهار كلمة المرور',
  'Hide password': 'إخفاء كلمة المرور',
  'Full name': 'الاسم الكامل',
  'Enter your name.': 'أدخل اسمك.',
  'Enter your password.': 'أدخل كلمة المرور.',
  'Forgot your password?': 'نسيت كلمة المرور؟',
  'Signed in as {email}': 'مسجّل الدخول باسم {email}',
  'Signed in as {email}.': 'مسجّل الدخول باسم {email}.',
  'We send a link to confirm it.': 'نرسل رابطاً لتأكيده.',
  'At least {count} characters.': '{count} أحرف على الأقل.',
  'Choose a password of at least {count} characters.': 'اختر كلمة مرور من {count} أحرف على الأقل.',
  'Keep your books safe in the cloud, use them on every device and work with your team. They still work offline.':
    'احفظ حساباتك بأمان في السحابة، واستخدمها على كل أجهزتك واعمل مع فريقك. وتبقى تعمل دون اتصال.',
  'Check your email': 'تحقق من بريدك الإلكتروني',
  'We sent a link to {email}. Open it to confirm your address and finish.':
    'أرسلنا رابطاً إلى {email}. افتحه لتأكيد عنوانك وإكمال التسجيل.',
  'Open the link on this device. Check the spam folder if it has not arrived.':
    'افتح الرابط على هذا الجهاز. تحقق من مجلد البريد غير المرغوب فيه إن لم يصلك.',
  'Send again in {seconds} s': 'إعادة الإرسال بعد {seconds} ث',
  'Send the link again': 'إعادة إرسال الرابط',
  'We sent the link again.': 'أعدنا إرسال الرابط.',
  'Send the confirmation link again': 'إعادة إرسال رابط التأكيد',
  'Wrong address? Start again': 'العنوان خاطئ؟ ابدأ من جديد',
  'Back to sign in': 'العودة إلى تسجيل الدخول',
  'Enter your email and we will send you a link to choose a new one.':
    'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لاختيار كلمة مرور جديدة.',
  'Send the link': 'إرسال الرابط',
  'If {email} has an account, we sent it a link to choose a new password.':
    'إن كان لدى {email} حساب، فقد أرسلنا إليه رابطاً لاختيار كلمة مرور جديدة.',
  'This link has expired': 'انتهت صلاحية هذا الرابط',
  'Links to reset a password work once, for a short time. Ask for a new one.':
    'روابط إعادة تعيين كلمة المرور تعمل مرة واحدة ولمدة قصيرة. اطلب رابطاً جديداً.',
  'Send a new link': 'إرسال رابط جديد',
  'Choose a new password': 'اختر كلمة مرور جديدة',
  'For {email}.': 'للحساب {email}.',
  'New password': 'كلمة المرور الجديدة',
  'Save the new password': 'حفظ كلمة المرور الجديدة',
  'Your new password is saved.': 'تم حفظ كلمة المرور الجديدة.',
  'Signing you in…': 'جارٍ تسجيل دخولك…',
  'You are signed in.': 'تم تسجيل دخولك.',
  'Sign in to continue': 'سجّل الدخول للمتابعة',
  'Links in emails work once, for a short time. Sign in, or ask for a new link.':
    'روابط البريد الإلكتروني تعمل مرة واحدة ولمدة قصيرة. سجّل الدخول أو اطلب رابطاً جديداً.',
  'If you confirmed your email on another device, your address is confirmed: sign in here.':
    'إن أكّدت بريدك الإلكتروني على جهاز آخر فقد تم تأكيد عنوانك: سجّل الدخول هنا.',

  // Sign-in problems
  'Wrong email or password.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'Confirm your email address first: open the link we sent you.':
    'أكّد بريدك الإلكتروني أولاً: افتح الرابط الذي أرسلناه إليك.',
  'There is already an account with this email. Sign in instead.':
    'يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بدلاً من ذلك.',
  'Choose a stronger password: at least 8 characters.': 'اختر كلمة مرور أقوى: 8 أحرف على الأقل.',
  'Choose a password you have not used here before.': 'اختر كلمة مرور لم تستخدمها هنا من قبل.',
  'Too many emails were sent. Wait a few minutes and try again.':
    'تم إرسال رسائل كثيرة. انتظر بضع دقائق ثم أعد المحاولة.',
  'Too many attempts. Wait a few minutes and try again.':
    'محاولات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.',
  'New accounts are not open right now.': 'إنشاء الحسابات الجديدة غير متاح حالياً.',
  'Check the email address and password.': 'تحقق من البريد الإلكتروني وكلمة المرور.',
  'Your session has ended. Sign in again.': 'انتهت جلستك. سجّل الدخول مرة أخرى.',
  'This link has expired. Ask for a new one.': 'انتهت صلاحية هذا الرابط. اطلب رابطاً جديداً.',
  'Open the link on the device where you asked for it, or sign in here.':
    'افتح الرابط على الجهاز الذي طلبته منه، أو سجّل الدخول هنا.',
  'No connection. Check your internet and try again.':
    'لا يوجد اتصال. تحقق من الإنترنت ثم أعد المحاولة.',
  'Something went wrong. Try again in a moment.': 'حدث خطأ ما. أعد المحاولة بعد قليل.',

  // Welcome
  'Invoices, payments and accounts for your business in Kuwait. Set up takes a minute, and nothing leaves this browser unless you choose the cloud.':
    'الفواتير والمدفوعات والحسابات لنشاطك التجاري في الكويت. الإعداد يستغرق دقيقة، ولا يغادر شيء هذا المتصفح إلا إذا اخترت السحابة.',
  'Work from any device, with your team': 'اعمل من أي جهاز ومع فريقك',
  'Create an account to keep your books safe in the cloud. They still work offline, and invited staff only see what their role allows.':
    'أنشئ حساباً لتحفظ حساباتك بأمان في السحابة. تبقى تعمل دون اتصال، ولا يرى المدعوون إلا ما يسمح به دورهم.',
  'Or use on this device only': 'أو استخدمه على هذا الجهاز فقط',
  'No account needed. Everything stays in this browser.':
    'لا حاجة إلى حساب. يبقى كل شيء في هذا المتصفح.',
  'Set up a new company': 'إعداد شركة جديدة',
  'It is kept in the cloud and on this device.': 'تُحفظ في السحابة وعلى هذا الجهاز.',
  'Download a company from your account, or set up a new one below.':
    'نزّل شركة من حسابك، أو أعدّ شركة جديدة أدناه.',
  'Companies you keep on this device only are not sent anywhere. Back them up from Settings.':
    'الشركات المحفوظة على هذا الجهاز فقط لا تُرسل إلى أي مكان. انسخها احتياطياً من الإعدادات.',
  'Keep this company in the cloud': 'حفظ هذه الشركة في السحابة',
  'Safe online, on all your devices and ready for your team.':
    'آمنة على الإنترنت، وعلى كل أجهزتك، وجاهزة لفريقك.',

  // Your companies
  'Your companies': 'شركاتك',
  'Continue to the app': 'المتابعة إلى التطبيق',
  'No companies yet': 'لا توجد شركات بعد',
  'Set up your company. It is kept in the cloud, ready for your team.':
    'أعدّ شركتك. تُحفظ في السحابة وتكون جاهزة لفريقك.',
  'Set up a company': 'إعداد شركة',
  'Loading your companies…': 'جارٍ تحميل شركاتك…',
  'In your account': 'في حسابك',
  'On this device': 'على هذا الجهاز',
  'Download to this device': 'تنزيل إلى هذا الجهاز',
  'Keep in the cloud': 'الحفظ في السحابة',
  'Demo: stays on this device': 'تجريبية: تبقى على هذا الجهاز',
  'Linked to another account': 'مرتبطة بحساب آخر',
  '{name} is going to the cloud.': 'جارٍ رفع {name} إلى السحابة.',
  'Replace the copy on this device?': 'استبدال النسخة الموجودة على هذا الجهاز؟',
  'This device has its own copy of {name}. It is replaced by the one in the cloud.':
    'على هذا الجهاز نسخة خاصة من {name}. ستُستبدل بالنسخة الموجودة في السحابة.',
  Progress: 'التقدم',
  'The demo company stays on this device.': 'تبقى الشركة التجريبية على هذا الجهاز.',

  // Sync status
  'On this device only': 'على هذا الجهاز فقط',
  Synced: 'تمت المزامنة',
  'Syncing…': 'جارٍ المزامنة…',
  'Offline – changes will sync': 'غير متصل – ستتم مزامنة التغييرات',
  'Sync problem': 'مشكلة في المزامنة',
  'Sign in to sync': 'سجّل الدخول للمزامنة',
  'No longer shared with you': 'لم تعد مشتركة معك',
  'Uploading {done} of {total}': 'جارٍ الرفع: {done} من {total}',
  'Downloading {done} of {total}': 'جارٍ التنزيل: {done} من {total}',
  '{count} changes waiting': {
    one: 'تغيير واحد بانتظار الإرسال',
    two: 'تغييران بانتظار الإرسال',
    few: '{count} تغييرات بانتظار الإرسال',
    many: '{count} تغييراً بانتظار الإرسال',
    other: '{count} تغيير بانتظار الإرسال',
  },
  'Not synced yet': 'لم تتم المزامنة بعد',
  'Last synced {time}': 'آخر مزامنة {time}',
  'Sync now': 'المزامنة الآن',
  'Sync finished': 'اكتملت المزامنة',
  'Sync status': 'حالة المزامنة',

  // Account menu and sign out
  'Account: {name}': 'الحساب: {name}',
  'Sign in to sync across devices': 'سجّل الدخول للمزامنة بين أجهزتك',
  'Cloud and sync': 'السحابة والمزامنة',
  Team: 'الفريق',
  'Account settings': 'إعدادات الحساب',
  'Keep my companies on this device': 'إبقاء شركاتي على هذا الجهاز',
  'They sync again the next time you sign in here.':
    'تُزامَن من جديد عند تسجيل دخولك هنا في المرة القادمة.',
  'Remove them from this device': 'إزالتها من هذا الجهاز',
  'For a shared computer. They stay safe in the cloud.': 'لجهاز مشترك. تبقى آمنة في السحابة.',
  'You can sign in again at any time.': 'يمكنك تسجيل الدخول مرة أخرى في أي وقت.',
  '{count} changes have not reached the cloud yet and would be lost. Sync first or keep the companies here.':
    'تغييرات لم تصل إلى السحابة بعد وستضيع: {count}. قم بالمزامنة أولاً أو أبقِ الشركات هنا.',
  '{count} changes have not reached the cloud yet. They are sent the next time you sign in here.':
    'تغييرات لم تصل إلى السحابة بعد: {count}. تُرسل عند تسجيل دخولك هنا في المرة القادمة.',

  // Settings: account
  'Account and team': 'الحساب والفريق',
  'Your account': 'حسابك',
  'Keep your books in the cloud': 'احفظ حساباتك في السحابة',
  'With an account your companies are safe online, on all your devices and with your team. They still work offline.':
    'مع الحساب تبقى شركاتك آمنة على الإنترنت، وعلى كل أجهزتك ومع فريقك، وتعمل دون اتصال أيضاً.',
  'The cloud is not available in this version of the app.':
    'السحابة غير متاحة في هذا الإصدار من التطبيق.',
  'Your name is shown to your team. Your language is used on every device.':
    'يظهر اسمك لفريقك، وتُستخدم لغتك على كل أجهزتك.',
  'Your account is saved.': 'تم حفظ حسابك.',
  'Change the password you sign in with.': 'غيّر كلمة المرور التي تسجّل الدخول بها.',
  'Change password': 'تغيير كلمة المرور',
  'Sign out on this device. Your other devices stay signed in.':
    'تسجيل الخروج من هذا الجهاز. تبقى أجهزتك الأخرى مسجّلة الدخول.',
  'On a shared computer you can also remove your companies from this device.':
    'على جهاز مشترك يمكنك أيضاً إزالة شركاتك من هذا الجهاز.',

  // Settings: team
  'Work on {company} together': 'اعملوا معاً على {company}',
  'The demo company stays on this device. Set up your own company to invite your team.':
    'تبقى الشركة التجريبية على هذا الجهاز. أعدّ شركتك لتدعو فريقك.',
  'Keep this company in the cloud to invite your accountant and staff, each with their own access.':
    'احفظ هذه الشركة في السحابة لتدعو محاسبك وموظفيك، لكلٍّ منهم صلاحياته.',
  'Everyone here works on {company} from their own device.':
    'يعمل كل من هنا على {company} من جهازه الخاص.',
  'Remove {name}?': 'إزالة {name}؟',
  'They lose access to {company} at once. What they recorded stays.':
    'يفقد الوصول إلى {company} فوراً. وتبقى السجلات التي أدخلها.',
  '{name} was removed': 'تمت إزالة {name}',
  'Invite someone': 'دعوة شخص',
  'You get a link to send them by WhatsApp or email. They sign in with this address to join.':
    'ستحصل على رابط ترسله عبر واتساب أو البريد الإلكتروني. يسجّل الدخول بهذا العنوان للانضمام.',
  'Create invitation link': 'إنشاء رابط الدعوة',
  'Invitation link ready': 'رابط الدعوة جاهز',
  'Send it to {email}. It works once, for 7 days.':
    'أرسله إلى {email}. يعمل مرة واحدة، لمدة 7 أيام.',
  'Invitation link': 'رابط الدعوة',
  'Copy link': 'نسخ الرابط',
  Copied: 'تم النسخ',
  'Link copied': 'تم نسخ الرابط',
  'Could not copy. Select the link and copy it.': 'تعذّر النسخ. حدّد الرابط وانسخه.',
  'Send by WhatsApp': 'إرسال عبر واتساب',
  'Join {company} on AlmailBooks as {role}:': 'انضم إلى {company} على AlmailBooks بدور {role}:',
  'Invitation to {company}': 'دعوة إلى {company}',
  'Pending invitations': 'الدعوات المعلّقة',
  'Links work once, for 7 days, and only for the address they were made for.':
    'تعمل الروابط مرة واحدة، لمدة 7 أيام، وللعنوان الذي أُنشئت له فقط.',
  'Until {date}': 'حتى {date}',
  'Cancel invitation': 'إلغاء الدعوة',
  'Invitation cancelled': 'تم إلغاء الدعوة',
  'Leave or delete': 'المغادرة أو الحذف',
  'Transfer ownership': 'نقل الملكية',
  'Make another member the owner. You become an admin.':
    'اجعل عضواً آخر هو المالك. وتصبح أنت مديراً.',
  'The new owner can delete the company and manage everyone. You become an admin.':
    'يستطيع المالك الجديد حذف الشركة وإدارة الجميع. وتصبح أنت مديراً.',
  'New owner': 'المالك الجديد',
  '{name} is now the owner': 'أصبح {name} هو المالك',
  'Deletes the company and everything in it from the cloud, for everyone.':
    'يحذف الشركة وكل ما فيها من السحابة، لدى الجميع.',
  'Delete {company} for everyone?': 'حذف {company} لدى الجميع؟',
  'The company, all its records and files are deleted from the cloud at once, for every member, and from this device. Download a backup first if you may need them. This cannot be undone.':
    'تُحذف الشركة وكل سجلاتها وملفاتها من السحابة فوراً لدى كل الأعضاء ومن هذا الجهاز. نزّل نسخة احتياطية أولاً إن احتجت إليها. لا يمكن التراجع عن ذلك.',
  'Leave company': 'مغادرة الشركة',
  'You stop seeing this company. It stays with the team.':
    'لن ترى هذه الشركة بعد الآن. وتبقى لدى الفريق.',
  'Leave {company}?': 'مغادرة {company}؟',
  'You will no longer see this company. Its copy is removed from this device; it stays in the cloud for the team.':
    'لن ترى هذه الشركة بعد الآن. تُزال نسختها من هذا الجهاز وتبقى في السحابة لدى الفريق.',
  'You left {company}.': 'غادرت {company}.',

  // Settings: cloud
  'Signed in as {email}. Companies in the cloud sync on their own.':
    'مسجّل الدخول باسم {email}. تتم مزامنة الشركات المحفوظة في السحابة تلقائياً.',
  'Sign in to keep your companies in the cloud and on all your devices.':
    'سجّل الدخول لتحفظ شركاتك في السحابة وعلى كل أجهزتك.',
  'Companies in your account': 'الشركات في حسابك',
  'Other companies on this device': 'شركات أخرى على هذا الجهاز',
  'It was deleted by its owner, or you were removed from it. The copy on this device is kept until you decide.':
    'حذفها مالكها أو أُزلت منها. وتبقى النسخة الموجودة على هذا الجهاز حتى تقرر.',
  'It syncs when the account it belongs to signs in on this device.':
    'تتم مزامنتها عندما يسجّل الحساب الذي تتبعه الدخول على هذا الجهاز.',
  'Clean up files': 'تنظيف الملفات',
  '{count} unused files removed': {
    one: 'تمت إزالة ملف واحد غير مستخدم',
    two: 'تمت إزالة ملفين غير مستخدمين',
    few: 'تمت إزالة {count} ملفات غير مستخدمة',
    many: 'تمت إزالة {count} ملفاً غير مستخدم',
    other: 'تمت إزالة {count} ملف غير مستخدم',
  },
  'No unused files': 'لا توجد ملفات غير مستخدمة',
  'Keep on this device': 'الإبقاء على هذا الجهاز',
  '{name} is now kept on this device only.': 'أصبحت {name} محفوظة على هذا الجهاز فقط.',
  'Remove from this device': 'إزالة من هذا الجهاز',
  'Remove {name} from this device?': 'إزالة {name} من هذا الجهاز؟',
  'It stays in the cloud. You can download it again at any time.':
    'تبقى في السحابة، ويمكنك تنزيلها مرة أخرى في أي وقت.',
  '{count} changes have not reached the cloud yet and will be lost. Sync first if you can.':
    'تغييرات لم تصل إلى السحابة بعد وستضيع: {count}. قم بالمزامنة أولاً إن أمكن.',
  '{name} was removed from this device.': 'تمت إزالة {name} من هذا الجهاز.',
  'It stays in the cloud for you and your team, and you can download it again. To delete it for everyone, the owner uses Settings → Team.':
    'تبقى في السحابة لك ولفريقك، ويمكنك تنزيلها مرة أخرى. لحذفها لدى الجميع يستخدم المالك الإعدادات ← الفريق.',
  '{count} changes were not accepted by the cloud': {
    one: 'لم تقبل السحابة تغييراً واحداً',
    two: 'لم تقبل السحابة تغييرين',
    few: 'لم تقبل السحابة {count} تغييرات',
    many: 'لم تقبل السحابة {count} تغييراً',
    other: 'لم تقبل السحابة {count} تغيير',
  },
  'Try again': 'إعادة المحاولة',
  'Undo my change': 'التراجع عن تغييري',
  'Your change was undone.': 'تم التراجع عن تغييرك.',
  Record: 'السجل',
  'The cloud did not accept it.': 'لم تقبله السحابة.',
  'Your role can’t make this change.': 'لا يسمح دورك بهذا التغيير.',
  'Too large to sync.': 'أكبر من أن تتم مزامنته.',

  // What was refused
  'Company settings': 'إعدادات الشركة',
  'Tax rate': 'نسبة ضريبة',
  'Activity entry': 'إدخال في سجل النشاط',
  File: 'ملف',
  'Tax return': 'إقرار ضريبي',
  'Bank statement line': 'حركة كشف الحساب البنكي',
  'Document in the register': 'وثيقة في السجل',
  Renewal: 'تجديد',
  'Compliance item': 'بند امتثال',
  'People settings': 'إعدادات شؤون الموظفين',
  'Security cheque': 'شيك ضمان',
  'Depreciation run': 'احتساب إهلاك',
  'Pay run': 'مسير رواتب',
  'Staff loan': 'قرض موظف',
  'Stock movement': 'حركة مخزون',

  // Errors from the cloud
  'No connection. Changes are kept on this device and sync when you are back online.':
    'لا يوجد اتصال. تبقى التغييرات على هذا الجهاز وتتم مزامنتها عند عودة الاتصال.',
  'Your session has ended. Sign in again to sync.': 'انتهت جلستك. سجّل الدخول مرة أخرى للمزامنة.',
  'Your role does not allow this change.': 'لا يسمح دورك بهذا التغيير.',
  'You are no longer a member of this company.': 'لم تعد عضواً في هذه الشركة.',
  'The cloud did not accept this change.': 'لم تقبل السحابة هذا التغيير.',
  'This record is too large to sync. Remove some images or attachments.':
    'هذا السجل أكبر من أن تتم مزامنته. احذف بعض الصور أو المرفقات.',
  'This device needs a full sync.': 'يحتاج هذا الجهاز إلى مزامنة كاملة.',
  'This company is already in the cloud under another account.':
    'هذه الشركة موجودة في السحابة تحت حساب آخر.',
  'You have reached the limit for this account.': 'وصلت إلى الحد المسموح لهذا الحساب.',
  'This person is already a member.': 'هذا الشخص عضو بالفعل.',
  'This invitation link is not valid.': 'رابط الدعوة هذا غير صالح.',
  'This invitation was cancelled. Ask for a new one.': 'تم إلغاء هذه الدعوة. اطلب دعوة جديدة.',
  'This invitation has already been used.': 'تم استخدام هذه الدعوة من قبل.',
  'This invitation has expired. Ask for a new one.': 'انتهت صلاحية هذه الدعوة. اطلب دعوة جديدة.',
  'This invitation is for another email address.': 'هذه الدعوة لعنوان بريد إلكتروني آخر.',
  'Confirm your email address first.': 'أكّد بريدك الإلكتروني أولاً.',
  'The cloud is not answering right now. We will try again.':
    'السحابة لا تستجيب حالياً. سنعيد المحاولة.',
  'This company is still being uploaded. Try again soon.':
    'لا يزال رفع هذه الشركة جارياً. أعد المحاولة قريباً.',
  'This file is not available.': 'هذا الملف غير متاح.',
  'Sign in to open files kept in the cloud.': 'سجّل الدخول لفتح الملفات المحفوظة في السحابة.',
  'Could not open the file.': 'تعذّر فتح الملف.',

  // On this device
  'You can view this company but not change it.': 'يمكنك الاطلاع على هذه الشركة دون تغييرها.',
  'Your role can’t make this change. Ask an owner, admin or accountant.':
    'لا يسمح دورك بهذا التغيير. اطلب ذلك من المالك أو المدير أو المحاسب.',
  'This company is no longer shared with you. Keep it as a company on this device or remove it.':
    'لم تعد هذه الشركة مشتركة معك. أبقِها شركةً على هذا الجهاز أو أزلها.',
  'View only': 'اطلاع فقط',
  'You can view this company but not change it. Ask an owner or admin for more access.':
    'يمكنك الاطلاع على هذه الشركة دون تغييرها. اطلب صلاحيات أكثر من المالك أو المدير.',
  'This company is no longer shared with you. Keep it as a company on this device or remove it in Settings → Cloud and sync.':
    'لم تعد هذه الشركة مشتركة معك. أبقِها شركةً على هذا الجهاز أو أزلها من الإعدادات ← السحابة والمزامنة.',
  'Payroll and people are private': 'الرواتب وشؤون الموظفين خاصة',
  'As {role} in this company you don’t see salaries, payroll or employee documents. Ask the owner if you need them.':
    'بدور {role} في هذه الشركة لا ترى الرواتب ولا مسيراتها ولا وثائق الموظفين. اطلبها من المالك إن احتجت إليها.',

  // Changes on two devices
  '{record} was also changed on another device. The version saved on this device was kept.':
    'تم تغيير {record} على جهاز آخر أيضاً. وتم الإبقاء على النسخة المحفوظة على هذا الجهاز.',
  '{record} was changed on another device while it was deleted here. It was deleted.':
    'تم تغيير {record} على جهاز آخر بينما حُذف هنا. وتم حذفه.',

  // Invitations
  'You are invited': 'أنت مدعو',
  '{person} invited you to join {company} as {role}.':
    'دعاك {person} للانضمام إلى {company} بدور {role}.',
  'You are invited to join {company} as {role}.': 'أنت مدعو للانضمام إلى {company} بدور {role}.',
  'You are invited to join a company on AlmailBooks.':
    'أنت مدعو للانضمام إلى شركة على AlmailBooks.',
  'Sign in or create an account with {email} to accept.':
    'سجّل الدخول أو أنشئ حساباً بالعنوان {email} لقبول الدعوة.',
  'Sign in or create an account with the address the invitation was sent to.':
    'سجّل الدخول أو أنشئ حساباً بالعنوان الذي أُرسلت إليه الدعوة.',
  'Check that the whole link was copied, or ask for a new one.':
    'تأكد من نسخ الرابط كاملاً، أو اطلب رابطاً جديداً.',
  'Ask for a new invitation link.': 'اطلب رابط دعوة جديداً.',
  'This invitation is for another address': 'هذه الدعوة لعنوان آخر',
  'It was sent to {email}, and you are signed in as {me}.':
    'أُرسلت إلى {email}، وأنت مسجّل الدخول باسم {me}.',
  'Sign out and use the invited address': 'تسجيل الخروج واستخدام العنوان المدعو',
  'Join {company}': 'الانضمام إلى {company}',
  'Accept and download': 'القبول والتنزيل',
  'You joined {company}.': 'انضممت إلى {company}.',

  // Deleting an employee
  'Everything about them is deleted:': 'يُحذف كل ما يخصه:',
  'their personnel file': 'ملفه الوظيفي',
  '{count} documents in the register': {
    zero: 'لا وثائق في السجل',
    one: 'وثيقة واحدة في السجل',
    two: 'وثيقتان في السجل',
    few: '{count} وثائق في السجل',
    many: '{count} وثيقة في السجل',
    other: '{count} وثيقة في السجل',
  },
  '{count} renewals': {
    zero: 'لا تجديدات',
    one: 'تجديد واحد',
    two: 'تجديدان',
    few: '{count} تجديدات',
    many: '{count} تجديداً',
    other: '{count} تجديد',
  },
  '{count} files': {
    zero: 'لا ملفات',
    one: 'ملف واحد',
    two: 'ملفان',
    few: '{count} ملفات',
    many: '{count} ملفاً',
    other: '{count} ملف',
  },
  'the activity entries about them': 'إدخالات سجل النشاط الخاصة به',
  'Only their employee number stays in the activity log. Renewal fees stay in the books. This cannot be undone.':
    'يبقى رقمه الوظيفي فقط في سجل النشاط، وتبقى رسوم التجديد في الحسابات. لا يمكن التراجع عن ذلك.',
  'Mark {name} as left?': 'تسجيل ترك {name} للعمل؟',
  '{name} has payroll records (pay runs, leave, loans or a final settlement). Payroll is part of the accounts, so the employee can’t be deleted. Marked as left, they stay in past payroll and reports.':
    'لدى {name} سجلات رواتب (مسيرات رواتب أو إجازات أو قروض أو مخالصة نهائية). الرواتب جزء من الحسابات، لذا لا يمكن حذف الموظف. وعند تسجيل تركه للعمل يبقى في الرواتب والتقارير السابقة.',
  'Mark as left': 'تسجيل ترك العمل',
  '{name} is marked as left.': 'تم تسجيل ترك {name} للعمل.',
  '{name} has payroll records, which are part of the accounts, so they stay marked as left.':
    'لدى {name} سجلات رواتب وهي جزء من الحسابات، لذا يبقى مسجّلاً كمن ترك العمل.',
  'This employee has payroll records, which are part of the accounts. Mark them as left instead.':
    'لدى هذا الموظف سجلات رواتب وهي جزء من الحسابات. سجّل تركه للعمل بدلاً من ذلك.',
  'Employee {number} deleted': 'تم حذف الموظف {number}',
} satisfies Dictionary;
