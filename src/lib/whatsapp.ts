import type { DateFormat, ISODate, PaymentLink } from '@/db/types';
import { formatDate, formatMoney, type CurrencyDisplay } from './format';
import { normalizeKuwaitPhone } from './kuwait';

/**
 * Sharing invoices and quotes on WhatsApp, the main channel for sending
 * them in Kuwait, and checks for online payment links.
 */

/** A link people can open: http(s) with a host name. */
export function isValidPaymentLink(value: string): boolean {
  const text = value.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const url = new URL(text);
    return /\./.test(url.hostname) || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

/** True once the link's last valid day has passed. */
export function isLinkExpired(
  link: Pick<PaymentLink, 'expiresAt'> | null | undefined,
  todayIso: ISODate,
): boolean {
  return Boolean(link?.expiresAt && link.expiresAt < todayIso);
}

/**
 * The number WhatsApp expects (country code and digits, no "+"): Kuwaiti
 * numbers get 965 in front; other international numbers are kept when
 * they start with + or 00. Null when there is no usable number.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const kuwaiti = normalizeKuwaitPhone(phone);
  if (kuwaiti) return kuwaiti.replace(/\D/g, '');
  const compact = phone.replace(/[\s().-]/g, '');
  const international = /^(?:\+|00)(\d{8,15})$/.exec(compact);
  return international ? international[1] : null;
}

/** A wa.me link that opens a chat with the message typed in (any chat when there is no number). */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}

export type MessageLanguage = 'en' | 'ar' | 'both';

export interface ShareMessageInput {
  type: 'invoice' | 'quote' | 'credit';
  number: string;
  total: number;
  /** What is still owed (invoices). */
  balance: number;
  currency: string;
  /** Due date (invoices) or valid-until date (quotes). */
  dueDate: ISODate | null;
  company: { name: string; nameAr?: string };
  client?: { name: string; nameAr?: string } | null;
  /** Online payment link, left out when empty. */
  paymentLink?: string | null;
  dateFormat: DateFormat;
  /** Locale of the English text (the company's). */
  locale?: string;
  currencyDisplay?: CurrencyDisplay;
  language: MessageLanguage;
}

const ARABIC_LOCALE = 'ar-KW-u-nu-latn';

function english(input: ShareMessageInput): string {
  const locale = input.locale || 'en-KW';
  const display = input.currencyDisplay ?? 'local';
  const money = (n: number) => formatMoney(n, input.currency, locale, display);
  const date = formatDate(input.dueDate, input.dateFormat, locale);
  const company = input.company.name;
  const lines = [input.client?.name ? `Hello ${input.client.name},` : 'Hello,'];
  const open = input.balance > 0;
  if (input.type === 'invoice') {
    if (!open) {
      lines.push(
        `Invoice ${input.number} from ${company} for ${money(input.total)}, paid in full.`,
      );
    } else {
      lines.push(
        date
          ? `Invoice ${input.number} from ${company}: ${money(input.balance)} due on ${date}.`
          : `Invoice ${input.number} from ${company}: ${money(input.balance)} due.`,
      );
    }
  } else if (input.type === 'quote') {
    lines.push(
      date
        ? `Quote ${input.number} from ${company} for ${money(input.total)}, valid until ${date}.`
        : `Quote ${input.number} from ${company} for ${money(input.total)}.`,
    );
  } else {
    lines.push(`Credit note ${input.number} from ${company} for ${money(input.total)}.`);
  }
  if (input.paymentLink && input.type === 'invoice' && open) {
    lines.push(`Pay online: ${input.paymentLink}`);
  }
  lines.push('Thank you.');
  return lines.join('\n');
}

function arabic(input: ShareMessageInput): string {
  const display = input.currencyDisplay ?? 'local';
  const money = (n: number) => formatMoney(n, input.currency, ARABIC_LOCALE, display);
  const date = formatDate(input.dueDate, input.dateFormat, ARABIC_LOCALE);
  const company = input.company.nameAr?.trim() || input.company.name;
  const client = input.client ? input.client.nameAr?.trim() || input.client.name : '';
  const lines = [client ? `مرحباً ${client}،` : 'مرحباً،'];
  const open = input.balance > 0;
  if (input.type === 'invoice') {
    if (!open) {
      lines.push(
        `فاتورة رقم ${input.number} من ${company} بمبلغ ${money(input.total)}، مدفوعة بالكامل.`,
      );
    } else {
      lines.push(
        date
          ? `فاتورة رقم ${input.number} من ${company}: المبلغ المستحق ${money(input.balance)}، تاريخ الاستحقاق ${date}.`
          : `فاتورة رقم ${input.number} من ${company}: المبلغ المستحق ${money(input.balance)}.`,
      );
    }
  } else if (input.type === 'quote') {
    lines.push(
      date
        ? `عرض سعر رقم ${input.number} من ${company} بمبلغ ${money(input.total)}، صالح حتى ${date}.`
        : `عرض سعر رقم ${input.number} من ${company} بمبلغ ${money(input.total)}.`,
    );
  } else {
    lines.push(`إشعار دائن رقم ${input.number} من ${company} بمبلغ ${money(input.total)}.`);
  }
  if (input.paymentLink && input.type === 'invoice' && open) {
    lines.push(`رابط الدفع: ${input.paymentLink}`);
  }
  lines.push('شكراً لكم.');
  return lines.join('\n');
}

/**
 * A short message to send with a document: its number, the amount in the
 * document currency (KD for dinars), the due date and the payment link.
 * "both" gives the English text followed by the Arabic.
 */
export function shareMessage(input: ShareMessageInput): string {
  if (input.language === 'en') return english(input);
  if (input.language === 'ar') return arabic(input);
  return `${english(input)}\n\n${arabic(input)}`;
}
