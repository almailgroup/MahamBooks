import type { Dictionary } from '../index';

/** Email alerts: the morning email and Settings → Email alerts. */
export default {
  // What the email covers.
  'Papers and licences': 'الوثائق والتراخيص',
  Deadlines: 'المواعيد النهائية',
  'Bills to pay': 'فواتير مشتريات للسداد',
  'Civil IDs, residencies, passports, contracts and company licences, at your reminder days and when they expire.':
    'البطاقات المدنية والإقامات وجوازات السفر والعقود وتراخيص الشركة، في أيام التذكير التي حددتها وعند انتهائها.',
  'PIFSS payments, filings and the other dates of the compliance calendar.':
    'اشتراكات التأمينات الاجتماعية والإقرارات وباقي مواعيد تقويم الالتزامات.',
  'Cheques to deposit this week or not deposited yet, and cheques you wrote that fall due.':
    'شيكات للإيداع هذا الأسبوع أو لم تُودَع بعد، والشيكات التي أصدرتها عند حلول موعدها.',
  'Bills due this week or late.': 'فواتير المشتريات المستحقة هذا الأسبوع أو المتأخرة.',
  'Invoices your customers have not paid by their due date.':
    'الفواتير التي لم يسددها عملاؤك حتى تاريخ استحقاقها.',

  // Lines of the email.
  'Expired on {date}': 'تاريخ الانتهاء {date}',
  'Expires on {date}': 'تاريخ الانتهاء {date}',
  'Cheque {number} from {name}': 'الشيك {number} من {name}',
  'Cheque {number} to {name}': 'الشيك {number} إلى {name}',
  'To deposit': 'للإيداع',
  'To be cashed': 'للصرف من حسابك',
  'Not deposited yet': 'لم يُودَع بعد',
  'Bill {number} · {vendor}': 'فاتورة مشتريات {number} · {vendor}',
  'Invoice {number} · {client}': 'فاتورة {number} · {client}',
  'Total {amount}': 'المجموع {amount}',
  'Open {app}': 'فتح {app}',
  'And {count} more in {app}.': {
    one: 'وواحد آخر في {app}.',
    two: 'واثنان آخران في {app}.',
    few: 'و{count} أخرى في {app}.',
    many: 'و{count} أخرى في {app}.',
    other: 'و{count} أخرى في {app}.',
  },

  // Subject and opening line.
  '{company}: nothing needs attention': '{company}: لا شيء يحتاج إلى متابعة',
  'Nothing needs attention in {company} right now.': 'لا شيء يحتاج إلى متابعة في {company} الآن.',
  '{company}: {count} new alerts': {
    one: '{company}: تنبيه جديد',
    two: '{company}: تنبيهان جديدان',
    few: '{company}: {count} تنبيهات جديدة',
    many: '{company}: {count} تنبيهاً جديداً',
    other: '{company}: {count} تنبيه جديد',
  },
  '{company}: {count} things need attention': {
    one: '{company}: أمر واحد يحتاج إلى متابعة',
    two: '{company}: أمران يحتاجان إلى متابعة',
    few: '{company}: {count} أمور تحتاج إلى متابعة',
    many: '{company}: {count} أمراً تحتاج إلى متابعة',
    other: '{company}: {count} أمر تحتاج إلى متابعة',
  },
  'Email alerts are on for {company}. This is everything that needs attention now.':
    'تنبيهات البريد مفعّلة لـ {company}. هذا كل ما يحتاج إلى متابعة الآن.',
  'Good morning. {count} new things need attention in {company}.': {
    one: 'صباح الخير. أمر جديد يحتاج إلى متابعة في {company}.',
    two: 'صباح الخير. أمران جديدان يحتاجان إلى متابعة في {company}.',
    few: 'صباح الخير. {count} أمور جديدة تحتاج إلى متابعة في {company}.',
    many: 'صباح الخير. {count} أمراً جديداً تحتاج إلى متابعة في {company}.',
    other: 'صباح الخير. {count} أمر جديد تحتاج إلى متابعة في {company}.',
  },
  'Good morning. Your weekly summary of what still needs attention in {company}.':
    'صباح الخير. هذا ملخصك الأسبوعي لما لا يزال يحتاج إلى متابعة في {company}.',
  'Everything that needs attention in {company} right now.':
    'كل ما يحتاج إلى متابعة في {company} الآن.',

  // Bottom of the email.
  'You get these emails because you turned on email alerts for {company} in {app}: at 8:00 in the morning (Kuwait time) when something new needs attention, and every Sunday with everything still open.':
    'تصلك هذه الرسائل لأنك فعّلت تنبيهات البريد لـ {company} في {app}: الساعة 8:00 صباحاً (بتوقيت الكويت) عندما يستجد ما يحتاج إلى متابعة، وكل يوم أحد بكل ما لا يزال مفتوحاً.',
  'To change or stop them, open Settings → Email alerts in {app}.':
    'لتغييرها أو إيقافها، افتح الإعدادات ← تنبيهات البريد في {app}.',
  'Sent to {email}.': 'أُرسلت إلى {email}.',

  // Settings → Email alerts.
  'Email alerts': 'تنبيهات البريد',
  'What needs attention, by email': 'ما يحتاج إلى متابعة، بالبريد الإلكتروني',
  'Email alerts work for companies kept in the cloud. Keep {company} in the cloud (Settings → Team), then turn them on here.':
    'تعمل تنبيهات البريد للشركات المحفوظة في السحابة. احفظ {company} في السحابة (الإعدادات ← الفريق)، ثم فعّلها من هنا.',
  'Open Team settings': 'فتح إعدادات الفريق',
  'For owners and admins': 'للمالكين والمديرين',
  'Only the owner and admins of a company can get its email alerts.':
    'تنبيهات البريد للشركة متاحة لمالكها ومديريها فقط.',
  'Email alerts could not be loaded': 'تعذّر تحميل تنبيهات البريد',
  'Not set up in the cloud yet': 'لم تُجهَّز في السحابة بعد',
  'The owner of the cloud runs the email alerts script in Supabase first (see the guide, docs/email-alerts.md).':
    'يشغّل مالك السحابة أولاً ملف تنبيهات البريد في Supabase (راجع الدليل docs/email-alerts.md).',
  'Every morning at 8:00 (Kuwait time) when something in {company} needs attention, and every Sunday a summary of everything still open.':
    'كل صباح الساعة 8:00 (بتوقيت الكويت) عندما يستجد في {company} ما يحتاج إلى متابعة، وكل يوم أحد ملخص بكل ما لا يزال مفتوحاً.',
  'Send me the email now': 'أرسل لي الرسالة الآن',
  'Email me alerts for {company}': 'أرسل لي تنبيهات {company} بالبريد',
  'Sent to {email}, the address of your account.': 'تُرسل إلى {email}، عنوان بريد حسابك.',
  'What to include': 'ما تشمله الرسالة',
  'The email sender is not set up in Supabase yet, so no email goes out. The guide docs/email-alerts.md shows how.':
    'لم يُجهَّز مُرسِل البريد في Supabase بعد، لذلك لا تُرسل أي رسالة. يشرح الدليل docs/email-alerts.md الطريقة.',
  'The last email could not be sent ({date}): {problem}':
    'تعذّر إرسال الرسالة الأخيرة ({date}): {problem}',
  'Last email: {date}': 'آخر رسالة: {date}',
  'The email covers {count} kinds of alert. Nothing is sent on days without anything new, except Sundays.':
    {
      one: 'تشمل الرسالة نوعاً واحداً من التنبيهات. لا يُرسل شيء في الأيام التي لا جديد فيها، عدا يوم الأحد.',
      two: 'تشمل الرسالة نوعين من التنبيهات. لا يُرسل شيء في الأيام التي لا جديد فيها، عدا يوم الأحد.',
      few: 'تشمل الرسالة {count} أنواع من التنبيهات. لا يُرسل شيء في الأيام التي لا جديد فيها، عدا يوم الأحد.',
      many: 'تشمل الرسالة {count} نوعاً من التنبيهات. لا يُرسل شيء في الأيام التي لا جديد فيها، عدا يوم الأحد.',
      other:
        'تشمل الرسالة {count} نوع من التنبيهات. لا يُرسل شيء في الأيام التي لا جديد فيها، عدا يوم الأحد.',
    },
  'Email alerts are on. The first email is on its way to {email}.':
    'تنبيهات البريد مفعّلة. الرسالة الأولى في طريقها إلى {email}.',
  'Email sent to {email}.': 'أُرسلت الرسالة إلى {email}.',
  'Choose at least one kind of alert.': 'اختر نوعاً واحداً على الأقل من التنبيهات.',
  'Email alerts saved': 'حُفظت تنبيهات البريد',
  'Email alerts are off': 'تنبيهات البريد متوقفة',

  // Sending problems.
  'No connection. Try again when you are online.': 'لا يوجد اتصال. حاول مجدداً عند عودة الاتصال.',
  'Only the owner and admins can get email alerts.': 'تنبيهات البريد متاحة للمالك والمديرين فقط.',
  'The email could not be sent.': 'تعذّر إرسال الرسالة.',
  'Turn email alerts on and save first.': 'فعّل تنبيهات البريد واحفظ أولاً.',
  'Wait a minute before sending another email.': 'انتظر دقيقة قبل إرسال رسالة أخرى.',
  'This company is not in the cloud yet.': 'هذه الشركة ليست في السحابة بعد.',
  'The email sender is not set up yet: add RESEND_API_KEY and ALERTS_FROM to the secrets of the email-alerts function in Supabase.':
    'لم يُجهَّز مُرسِل البريد بعد: أضف RESEND_API_KEY و ALERTS_FROM إلى أسرار دالة email-alerts في Supabase.',
  'The email alerts script has not been run in Supabase yet.':
    'لم يُشغَّل ملف تنبيهات البريد في Supabase بعد.',
  'The email-alerts function is not in Supabase yet.':
    'دالة email-alerts غير موجودة في Supabase بعد.',
  'The email service did not send it: {detail}': 'لم ترسلها خدمة البريد: {detail}',
} satisfies Dictionary;
