import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { activityText, recentActivity } from './activity';
import { createClient } from './defaults';
import { createPayment, savePayment } from './payments';
import { saveClient, setupCompany } from './records';
import { formatDate, formatMoney, isolateAmount } from '@/lib/format';
import { setDictionaryForTests } from '@/i18n';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => setDictionaryForTests('en', {}));

const AR = 'ar-KW-u-nu-latn';
const arabic = {
  'Client {name} added': 'تمت إضافة العميل {name}',
  'Payment {number} of {amount} recorded': 'تم تسجيل الدفعة {number} بمبلغ {amount}',
};
const arabicFormat = {
  money: (amount: number, currency: string) =>
    isolateAmount(formatMoney(amount, currency, AR, 'local'), AR),
  date: (value: string) => formatDate(value, 'dd/MM/yyyy', AR),
};

describe('activity', () => {
  it('is shown in the reader’s language, amounts included', async () => {
    const company = await setupCompany({ name: 'Al Mail', currency: 'KWD', locale: 'en-KW' });
    const client = await saveClient(createClient(company.id, { name: 'Orbit' }));
    await savePayment(
      createPayment(company.id, {
        number: 'PAY-1',
        clientId: client.id,
        date: '2026-10-01',
        amount: 12.5,
        currency: 'KWD',
        method: 'cash',
      }),
    );
    const log = await recentActivity(company.id);
    const added = log.find((a) => a.entity === 'client')!;
    const payment = log.find((a) => a.entity === 'payment')!;
    // Stored in English, as logged.
    expect(added.message).toBe('Client Orbit added');
    expect(payment.message).toBe('Payment PAY-1 of KD 12.500 recorded');

    setDictionaryForTests('ar', arabic);
    expect(activityText(added)).toBe('تمت إضافة العميل Orbit');
    expect(activityText(payment, arabicFormat)).toBe(
      `تم تسجيل الدفعة PAY-1 بمبلغ ${arabicFormat.money(12.5, 'KWD')}`,
    );
    expect(activityText(payment, arabicFormat)).toContain('12.500⁩ د.ك');
  });

  it('names a client by their Arabic name for Arabic readers', async () => {
    const company = await setupCompany({ name: 'Al Mail', currency: 'KWD', locale: 'en-KW' });
    await saveClient(
      createClient(company.id, { name: 'Gulf Pearl Hotel', nameAr: 'فندق لؤلؤة الخليج' }),
    );
    const [added] = (await recentActivity(company.id)).filter((a) => a.entity === 'client');
    expect(added.message).toBe('Client Gulf Pearl Hotel added');
    expect(activityText(added)).toBe('Client Gulf Pearl Hotel added');
    setDictionaryForTests('ar', arabic);
    expect(activityText(added)).toBe('تمت إضافة العميل فندق لؤلؤة الخليج');
  });
});
