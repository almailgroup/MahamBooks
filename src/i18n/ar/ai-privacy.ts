import type { Dictionary } from '../index';

/**
 * The AI assistant before it goes live: the note under a question when ID
 * numbers, IBANs and the like were hidden before sending (src/features/ai),
 * and what the app says when the AI service refuses an account, isn't set
 * up or switched on, has reached its limit or needs a newer app, and when a
 * question is kept on the device (errors.ts). The assistant is المساعد
 * الذكي; IBAN is رقم الآيبان, as in the glossary.
 */
export default {
  // Under a question (assistant-panel.tsx): "Hidden before sending: …".
  '{count} ID numbers were hidden before sending': {
    one: 'أُخفي قبل الإرسال: رقم هوية واحد',
    two: 'أُخفي قبل الإرسال: رقما هوية',
    few: 'أُخفي قبل الإرسال: {count} أرقام هوية',
    many: 'أُخفي قبل الإرسال: {count} رقم هوية',
    other: 'أُخفي قبل الإرسال: {count} رقم هوية',
  },
  '{count} IBANs were hidden before sending': {
    one: 'أُخفي قبل الإرسال: رقم آيبان واحد',
    two: 'أُخفي قبل الإرسال: رقما آيبان',
    few: 'أُخفي قبل الإرسال: {count} أرقام آيبان',
    many: 'أُخفي قبل الإرسال: {count} رقم آيبان',
    other: 'أُخفي قبل الإرسال: {count} رقم آيبان',
  },
  '{count} account numbers were hidden before sending': {
    one: 'أُخفي قبل الإرسال: رقم حساب واحد',
    two: 'أُخفي قبل الإرسال: رقما حساب',
    few: 'أُخفي قبل الإرسال: {count} أرقام حسابات',
    many: 'أُخفي قبل الإرسال: {count} رقم حساب',
    other: 'أُخفي قبل الإرسال: {count} رقم حساب',
  },
  '{count} phone numbers were hidden before sending': {
    one: 'أُخفي قبل الإرسال: رقم هاتف واحد',
    two: 'أُخفي قبل الإرسال: رقما هاتف',
    few: 'أُخفي قبل الإرسال: {count} أرقام هواتف',
    many: 'أُخفي قبل الإرسال: {count} رقم هاتف',
    other: 'أُخفي قبل الإرسال: {count} رقم هاتف',
  },
  '{count} email addresses were hidden before sending': {
    one: 'أُخفي قبل الإرسال: عنوان بريد إلكتروني واحد',
    two: 'أُخفي قبل الإرسال: عنوانا بريد إلكتروني',
    few: 'أُخفي قبل الإرسال: {count} عناوين بريد إلكتروني',
    many: 'أُخفي قبل الإرسال: {count} عنوان بريد إلكتروني',
    other: 'أُخفي قبل الإرسال: {count} عنوان بريد إلكتروني',
  },
  '{count} long numbers were hidden before sending': {
    one: 'أُخفي قبل الإرسال: رقم طويل واحد',
    two: 'أُخفي قبل الإرسال: رقمان طويلان',
    few: 'أُخفي قبل الإرسال: {count} أرقام طويلة',
    many: 'أُخفي قبل الإرسال: {count} رقماً طويلاً',
    other: 'أُخفي قبل الإرسال: {count} رقم طويل',
  },

  // When the AI service refuses or isn't ready (errors.ts).
  'Your account is not a member of the company the AI assistant is set up for. Ask the owner.':
    'حسابك ليس عضواً في الشركة التي هُيّئ لها المساعد الذكي. اسأل المالك.',
  'The AI assistant is not available for this account.': 'المساعد الذكي غير متاح لهذا الحساب.',
  'The AI assistant is not set up yet. Ask the owner.':
    'لم تكتمل تهيئة المساعد الذكي بعد. اسأل المالك.',
  'The AI assistant is not switched on for this company. Ask the owner.':
    'المساعد الذكي غير مفعّل لهذه الشركة. اسأل المالك.',
  'The AI assistant has reached today’s limit for this company. Try again tomorrow.':
    'بلغ المساعد الذكي حدّ اليوم لهذه الشركة. حاول مرة أخرى غداً.',
  'The AI assistant needs the latest version of the app. Reload the page and try again.':
    'يحتاج المساعد الذكي إلى أحدث إصدار من التطبيق. أعد تحميل الصفحة وحاول مرة أخرى.',
  // The last check before sending (client.ts) found what should have been hidden.
  'This was not sent: it still holds an ID number, an IBAN or another private detail. Start a new chat and ask without it.':
    'لم يُرسَل: ما زال فيه رقم هوية أو رقم آيبان أو بيان خاص آخر. ابدأ محادثة جديدة واسأل من دونه.',
} satisfies Dictionary;
