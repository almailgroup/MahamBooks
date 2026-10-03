import { describe, expect, it } from 'vitest';
import {
  defaultLabels,
  documentLabels,
  getLabels,
  isRtlLanguage,
  LABEL_KEYS,
  overrideKey,
  type LabelLanguage,
} from './labels';

const ARABIC = /[؀-ۿ]/;
const LANGUAGES: LabelLanguage[] = ['en', 'ar', 'fr', 'es', 'de', 'pt', 'it', 'nl'];

describe('document labels', () => {
  it('have every word in every language', () => {
    for (const language of LANGUAGES) {
      const labels = defaultLabels(language);
      for (const key of LABEL_KEYS) expect(labels[key]?.trim(), `${language}.${key}`).toBeTruthy();
    }
  });

  it('have Arabic text for every key', () => {
    const ar = defaultLabels('ar');
    const missing = LABEL_KEYS.filter((key) => !ARABIC.test(ar[key]));
    expect(missing).toEqual([]);
  });

  it('use the Kuwaiti terms', () => {
    expect(defaultLabels('ar')).toMatchObject({
      invoice: 'فاتورة',
      quote: 'عرض سعر',
      credit: 'إشعار دائن',
      billTo: 'فاتورة إلى',
      amountDue: 'المبلغ المستحق',
      balanceDue: 'الرصيد المستحق',
      subtotal: 'المجموع الفرعي',
      total: 'الإجمالي',
      signature: 'التوقيع المعتمد',
      stamp: 'الختم',
      receivedBy: 'المستلم',
    });
  });

  it('name orders and delivery notes the Kuwaiti way', () => {
    expect(defaultLabels('ar')).toMatchObject({
      proforma: 'فاتورة مبدئية',
      salesOrder: 'أمر بيع',
      purchaseOrder: 'أمر شراء',
      deliveryNote: 'إذن تسليم',
      receivedBy: 'المستلم',
      civilId: 'الرقم المدني',
    });
    expect(defaultLabels('en')).toMatchObject({
      proforma: 'Proforma Invoice',
      deliveryNote: 'Delivery Note',
      receivedBy: 'Received by',
    });
  });

  it('print Arabic with English beside it in bilingual documents', () => {
    const { primary, secondary } = documentLabels('ar-en');
    expect(primary.invoice).toBe('فاتورة');
    expect(secondary?.invoice).toBe('Invoice');
    expect(documentLabels('ar').secondary).toBeNull();
    expect(documentLabels('en').primary.invoice).toBe('Invoice');
  });

  it('keep custom words per language', () => {
    const overrides = { invoice: 'Tax Invoice', [overrideKey('ar', 'invoice')]: 'فاتورة ضريبية' };
    expect(overrideKey('ar', 'invoice')).toBe('ar.invoice');
    expect(getLabels('en', overrides).invoice).toBe('Tax Invoice');
    expect(getLabels('ar', overrides).invoice).toBe('فاتورة ضريبية');
    expect(getLabels('ar-en', overrides).invoice).toBe('فاتورة ضريبية');
    expect(getLabels('ar', { invoice: 'Tax Invoice' }).invoice).toBe('فاتورة');
    expect(getLabels('en', { invoice: '  ' }).invoice).toBe('Invoice');
  });

  it('know which languages read right to left', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('ar-en')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage(null)).toBe(false);
  });
});
