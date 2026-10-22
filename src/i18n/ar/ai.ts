import type { Dictionary } from '../index';

/**
 * The AI assistant (first version): the Ask AI button and its panel, the
 * starter questions, what can go wrong, and Settings → AI assistant. The
 * assistant is المساعد الذكي; "Ask AI" is اسأل المساعد. Civil ID is
 * البطاقة المدنية, IBAN رقم الآيبان, as in the glossary.
 */
export default {
  // The button, the palette and the panel (src/features/ai).
  'AI assistant': 'المساعد الذكي',
  'Ask AI': 'اسأل المساعد',
  'Ask AI…': 'اسأل المساعد…',
  'New chat': 'محادثة جديدة',
  Conversation: 'المحادثة',
  'Your question': 'سؤالك',
  'Ask how to do something in Maham One…': 'اسأل عن طريقة عمل أي شيء في مهام ون…',
  'Ask how to do something in Maham One.': 'اسأل عن طريقة عمل أي شيء في مهام ون.',
  'The assistant sees only what you type and the page you are on, not your records. Don’t type Civil IDs, IBANs or salaries.':
    'لا يرى المساعد إلا ما تكتبه والصفحة التي أنت فيها، ولا يرى سجلاتك. لا تكتب أرقام البطاقات المدنية أو أرقام الآيبان أو الرواتب.',
  'Suggested questions': 'أسئلة مقترحة',
  Stop: 'إيقاف',
  Stopped: 'تم الإيقاف',
  Copy: 'نسخ',
  'Could not copy the answer.': 'تعذّر نسخ الإجابة.',
  'Writing the answer…': 'جارٍ كتابة الإجابة…',
  'AI can make mistakes. Check important answers.':
    'قد يخطئ الذكاء الاصطناعي. تحقّق من الإجابات المهمة.',

  // Starter questions, by app.
  'How do I record annual leave?': 'كيف أسجّل إجازة سنوية؟',
  'How do I run this month’s payroll?': 'كيف أعدّ رواتب هذا الشهر؟',
  'How is end-of-service indemnity worked out in Kuwait?':
    'كيف تُحسب مكافأة نهاية الخدمة في الكويت؟',
  'How do I issue a salary certificate?': 'كيف أُصدر شهادة راتب؟',
  'How do I record a post-dated cheque?': 'كيف أسجّل شيكاً آجلاً؟',
  'How do I turn a quote into an invoice?': 'كيف أحوّل عرض سعر إلى فاتورة؟',
  'How do I send a customer a statement of account?': 'كيف أرسل كشف حساب إلى عميل؟',
  'How do I record an expense with its receipt?': 'كيف أسجّل مصروفاً مع إيصاله؟',
  'How do I record a payment received by KNET?': 'كيف أسجّل دفعة مقبوضة عن طريق كي نت؟',
  'How do I count the stock in a warehouse?': 'كيف أجرد المخزون في مستودع؟',
  'How do I print labels for my items?': 'كيف أطبع ملصقات لأصنافي؟',
  'How do I add the shipping costs to the items bought?':
    'كيف أضيف تكاليف الشحن إلى الأصناف المشتراة؟',
  'How do I follow up on a quote?': 'كيف أتابع عرض سعر؟',
  'How do I add a prospect?': 'كيف أضيف عميلاً محتملاً؟',
  'How do I turn a won quote into a sales order?': 'كيف أحوّل عرض سعر مقبولاً إلى أمر بيع؟',
  'How do I add a licence with its expiry date?': 'كيف أضيف رخصة مع تاريخ انتهائها؟',
  'How do I get reminders before papers expire?': 'كيف أتلقّى تذكيرات قبل انتهاء المستندات؟',
  'Which deadlines does the calendar show?': 'ما المواعيد التي يعرضها التقويم؟',
  'What can Maham One do for my company?': 'ماذا يمكن أن يقدّم مهام ون لشركتي؟',
  'How do I add someone to my team?': 'كيف أضيف شخصاً إلى فريقي؟',
  'How do I switch the app to Arabic?': 'كيف أحوّل لغة التطبيق إلى العربية؟',

  // What can go wrong (src/features/ai/errors.ts).
  'Sign in to use the AI assistant.': 'سجّل الدخول لاستخدام المساعد الذكي.',
  'Your sign-in has expired. Sign in again to use the AI assistant.':
    'انتهت صلاحية تسجيل دخولك. سجّل الدخول مرة أخرى لاستخدام المساعد الذكي.',
  'Your account may not use the AI assistant. Ask the owner of the company.':
    'لا يمكن لحسابك استخدام المساعد الذكي. اسأل مالك الشركة.',
  'The AI assistant works only in the app at mahamone.com.':
    'يعمل المساعد الذكي فقط في التطبيق على mahamone.com.',
  'The AI service could not use this question. Try asking it another way.':
    'تعذّر على خدمة الذكاء الاصطناعي التعامل مع هذا السؤال. جرّب صياغته بطريقة أخرى.',
  'This conversation is too long for the AI. Start a new chat.':
    'هذه المحادثة أطول مما يحتمله الذكاء الاصطناعي. ابدأ محادثة جديدة.',
  'The AI service is not set up for this version of the app. Try again later.':
    'خدمة الذكاء الاصطناعي غير مهيأة لهذا الإصدار من التطبيق. حاول مرة أخرى لاحقاً.',
  'Too many questions in a short time. Try again in {seconds} seconds.':
    'أسئلة كثيرة في وقت قصير. حاول مرة أخرى بعد {seconds} ثانية.',
  'The AI took too long to answer. Try again.':
    'استغرق الذكاء الاصطناعي وقتاً طويلاً للإجابة. حاول مرة أخرى.',
  'The AI service had a problem. Try again in a moment.':
    'حدثت مشكلة في خدمة الذكاء الاصطناعي. حاول مرة أخرى بعد قليل.',
  'The AI service could not be found. Try again later.':
    'تعذّر الوصول إلى خدمة الذكاء الاصطناعي. حاول مرة أخرى لاحقاً.',
  'The AI assistant needs an internet connection.': 'يحتاج المساعد الذكي إلى اتصال بالإنترنت.',
  'Could not reach the AI service. Check your connection and try again.':
    'تعذّر الاتصال بخدمة الذكاء الاصطناعي. تحقّق من اتصالك وحاول مرة أخرى.',
  'The AI gave no answer. Try asking another way.':
    'لم يقدّم الذكاء الاصطناعي إجابة. جرّب السؤال بطريقة أخرى.',
  'The AI could not answer this question. Try asking it another way.':
    'لم يستطع الذكاء الاصطناعي الإجابة عن هذا السؤال. جرّب صياغته بطريقة أخرى.',
  'Something went wrong with the AI assistant. Try again.':
    'حدث خطأ في المساعد الذكي. حاول مرة أخرى.',

  // Settings → AI assistant (src/pages/settings/ai.tsx).
  'Answers questions about using Maham One, on every page, for everyone in {company}.':
    'يجيب عن الأسئلة حول استخدام مهام ون، في كل صفحة، لكل من في {company}.',
  'The AI assistant needs a company kept in the cloud, and everyone using it signed in. Keep this company in the cloud first, in Settings → Team.':
    'يحتاج المساعد الذكي إلى شركة محفوظة في السحابة، وأن يكون كل من يستخدمه مسجّلاً دخوله. احفظ هذه الشركة في السحابة أولاً، من الإعدادات ← الفريق.',
  'AI assistant turned on': 'تم تشغيل المساعد الذكي',
  'AI assistant turned off': 'تم إيقاف المساعد الذكي',
  'Use the AI assistant': 'استخدام المساعد الذكي',
  'Everyone in {company} sees an Ask AI button at the bottom of every page (Ctrl J or ⌘J opens it too), on each device once it syncs. It explains how to do things in the app; it doesn’t do them.':
    'يرى كل من في {company} زر «اسأل المساعد» أسفل كل صفحة (ويفتحه أيضاً Ctrl J أو ⌘J)، على كل جهاز بعد مزامنته. يشرح المساعد طريقة عمل الأشياء في التطبيق، ولا يقوم بها بنفسه.',
  'Only the owner or an admin turns the AI assistant on or off.':
    'المالك أو المدير وحده يشغّل المساعد الذكي أو يوقفه.',
  'What the AI assistant sees': 'ما يراه المساعد الذكي',
  'Kept short on purpose, for this first version.': 'محدود عن قصد في هذا الإصدار الأول.',
  'Only what you type in the chat, with the name of the app and page you are on, your role and the app’s language. It doesn’t see your records, documents or what is in a form.':
    'ما تكتبه في المحادثة فقط، مع اسم التطبيق والصفحة التي أنت فيها، ودورك، ولغة التطبيق. لا يرى سجلاتك أو مستنداتك أو ما في النماذج.',
  'Questions go through Maham One’s own AI service to Google Gemini, under Google’s paid-tier terms: Google doesn’t use them to improve its products.':
    'تمر الأسئلة عبر خدمة الذكاء الاصطناعي الخاصة بمهام ون إلى Google Gemini، وفق شروط Google للخدمة المدفوعة: لا تستخدمها Google لتحسين منتجاتها.',
  'The conversation stays in that browser tab only: it is gone when the page is reloaded or New chat is pressed, and it is never synced.':
    'تبقى المحادثة في علامة تبويب المتصفح تلك فقط: تختفي عند إعادة تحميل الصفحة أو الضغط على «محادثة جديدة»، ولا تُزامن أبداً.',
  'Don’t paste Civil IDs, IBANs, salaries or other personal details into the chat. Describe the case instead.':
    'لا تلصق أرقام البطاقات المدنية أو أرقام الآيبان أو الرواتب أو أي بيانات شخصية أخرى في المحادثة. صِف الحالة بدلاً من ذلك.',
  Connection: 'الاتصال',
  'Checks that this device reaches the AI service.':
    'يتحقق من أن هذا الجهاز يصل إلى خدمة الذكاء الاصطناعي.',
  'Test the connection': 'اختبار الاتصال',
  'Nothing is asked of the AI: this only checks the service answers.':
    'لا يُرسل أي سؤال إلى الذكاء الاصطناعي: يتحقق هذا فقط من أن الخدمة تستجيب.',
  'Connected. The AI service answers with {model}.':
    'متصل. تستجيب خدمة الذكاء الاصطناعي بالنموذج {model}.',
  'Connected. The AI service answers.': 'متصل. خدمة الذكاء الاصطناعي تستجيب.',
} satisfies Dictionary;
