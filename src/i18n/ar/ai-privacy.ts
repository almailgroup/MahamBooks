import type { Dictionary } from '../index';

/**
 * The AI assistant before it goes live: the note under a question when ID
 * numbers, IBANs and the like were hidden before sending (src/features/ai),
 * and what the app says when the AI service refuses an account or isn't set
 * up yet (errors.ts). The assistant is المساعد الذكي; IBAN is رقم الآيبان,
 * as in the glossary.
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
} satisfies Dictionary;
