import { describe, expect, it } from 'vitest';
import {
  isLinkExpired,
  isValidPaymentLink,
  shareMessage,
  whatsappNumber,
  whatsappUrl,
  type ShareMessageInput,
} from './whatsapp';

// Intl wraps Arabic amounts in right-to-left marks and keeps the amount and
// the currency together with a no-break space.
const RLM = String.fromCharCode(0x200f);
const NBSP = String.fromCharCode(0x00a0);

const invoice: ShareMessageInput = {
  type: 'invoice',
  number: 'INV-2026-0007',
  total: 1500,
  balance: 1234.5,
  currency: 'KWD',
  dueDate: '2026-10-15',
  company: { name: 'Al Mail Trading', nameAr: 'المال للتجارة' },
  client: { name: 'Gulf Contracting', nameAr: 'الخليج للمقاولات' },
  paymentLink: 'https://pay.myfatoorah.com/inv7',
  dateFormat: 'dd/MM/yyyy',
  language: 'en',
};

describe('share messages', () => {
  it('give the number, the amount due in KD, the due date and the link', () => {
    expect(shareMessage(invoice)).toBe(
      [
        'Hello Gulf Contracting,',
        `Invoice INV-2026-0007 from Al Mail Trading: KD${NBSP}1,234.500 due on 15/10/2026.`,
        'Pay online: https://pay.myfatoorah.com/inv7',
        'Thank you.',
      ].join('\n'),
    );
  });

  it('are written in Arabic with the Arabic names', () => {
    expect(shareMessage({ ...invoice, language: 'ar' })).toBe(
      [
        'مرحباً الخليج للمقاولات،',
        `فاتورة رقم INV-2026-0007 من المال للتجارة: المبلغ المستحق ${RLM}1,234.500${NBSP}د.ك${RLM}، تاريخ الاستحقاق 15/10/2026.`,
        'رابط الدفع: https://pay.myfatoorah.com/inv7',
        'شكراً لكم.',
      ].join('\n'),
    );
  });

  it('can carry both languages, English first', () => {
    const both = shareMessage({ ...invoice, language: 'both' });
    expect(both).toBe(
      `${shareMessage(invoice)}\n\n${shareMessage({ ...invoice, language: 'ar' })}`,
    );
  });

  it('leave out the link once the invoice is paid, and fall back to English names', () => {
    const paid = shareMessage({
      ...invoice,
      balance: 0,
      client: { name: 'Gulf Contracting' },
      company: { name: 'Al Mail Trading' },
      language: 'both',
    });
    expect(paid).toContain(
      `Invoice INV-2026-0007 from Al Mail Trading for KD${NBSP}1,500.000, paid in full.`,
    );
    expect(paid).toContain('مرحباً Gulf Contracting،');
    expect(paid).not.toContain('https://');
  });

  it('describe quotes with their validity and work without a client or date', () => {
    expect(
      shareMessage({
        ...invoice,
        type: 'quote',
        number: 'QUO-2026-0002',
        total: 89.25,
        client: null,
        paymentLink: null,
      }),
    ).toBe(
      [
        'Hello,',
        `Quote QUO-2026-0002 from Al Mail Trading for KD${NBSP}89.250, valid until 15/10/2026.`,
        'Thank you.',
      ].join('\n'),
    );
    expect(
      shareMessage({ ...invoice, dueDate: null, paymentLink: '', language: 'ar' }).split('\n')[1],
    ).toBe(
      `فاتورة رقم INV-2026-0007 من المال للتجارة: المبلغ المستحق ${RLM}1,234.500${NBSP}د.ك${RLM}.`,
    );
  });
});

describe('WhatsApp links', () => {
  it('use the Kuwaiti number with 965 in front', () => {
    expect(whatsappNumber('9999 1234')).toBe('96599991234');
    expect(whatsappNumber('+965 6555-0101')).toBe('96565550101');
    expect(whatsappNumber('00965 5123 4567')).toBe('96551234567');
    expect(whatsappUrl('9999 1234', 'Invoice 1 – KD 5.000')).toBe(
      'https://wa.me/96599991234?text=Invoice%201%20%E2%80%93%20KD%205.000',
    );
  });

  it('keep other international numbers and open any chat without one', () => {
    expect(whatsappNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber('1234')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappUrl(null, 'Hi')).toBe('https://wa.me/?text=Hi');
    expect(whatsappUrl('12', 'Hi')).toBe('https://wa.me/?text=Hi');
  });
});

describe('payment links', () => {
  it('must be full web addresses', () => {
    expect(isValidPaymentLink('https://pay.myfatoorah.com/abc')).toBe(true);
    expect(isValidPaymentLink('http://tap.company/x?y=1')).toBe(true);
    expect(isValidPaymentLink('pay.myfatoorah.com/abc')).toBe(false);
    expect(isValidPaymentLink('https://nohost')).toBe(false);
    expect(isValidPaymentLink('javascript:alert(1)')).toBe(false);
    expect(isValidPaymentLink('https://pay me.com')).toBe(false);
  });

  it('expire after their last day', () => {
    expect(isLinkExpired({ expiresAt: '2026-10-03' }, '2026-10-03')).toBe(false);
    expect(isLinkExpired({ expiresAt: '2026-10-02' }, '2026-10-03')).toBe(true);
    expect(isLinkExpired({ expiresAt: null }, '2026-10-03')).toBe(false);
    expect(isLinkExpired(null, '2026-10-03')).toBe(false);
  });
});
