import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { interfaceLocale, loadLanguage, setDictionaryForTests, t, tp } from './index';
import { tr } from './provider';

afterEach(() => setDictionaryForTests('en', {}));

describe('t', () => {
  it('returns English when there is no translation', () => {
    expect(t('Save')).toBe('Save');
    expect(t('Invoice {number} sent', { number: 'INV-1' })).toBe('Invoice INV-1 sent');
  });

  it('translates and fills placeholders', () => {
    setDictionaryForTests('ar', { 'Invoice {number} sent': 'تم إرسال الفاتورة {number}' });
    expect(t('Invoice {number} sent', { number: 'INV-1' })).toBe('تم إرسال الفاتورة INV-1');
  });
});

describe('tp', () => {
  it('uses one and other in English', () => {
    expect(tp(1, '{count} invoice', '{count} invoices')).toBe('1 invoice');
    expect(tp(1200, '{count} invoice', '{count} invoices')).toBe('1,200 invoices');
  });

  it('picks the Arabic plural form', () => {
    setDictionaryForTests('ar', {
      '{count} invoices': {
        zero: 'لا توجد فواتير',
        one: 'فاتورة واحدة',
        two: 'فاتورتان',
        few: '{count} فواتير',
        many: '{count} فاتورة',
        other: '{count} فاتورة',
      },
    });
    const n = (count: number) => tp(count, '{count} invoice', '{count} invoices');
    expect(n(0)).toBe('لا توجد فواتير');
    expect(n(1)).toBe('فاتورة واحدة');
    expect(n(2)).toBe('فاتورتان');
    expect(n(5)).toBe('5 فواتير');
    expect(n(11)).toBe('11 فاتورة');
    expect(n(100)).toBe('100 فاتورة');
  });
});

it('fills placeholders with elements', () => {
  setDictionaryForTests('ar', { 'Signed in as {name}': 'مسجّل باسم {name}' });
  render(<p>{tr('Signed in as {name}', { name: <strong>Sara</strong> })}</p>);
  expect(screen.getByText('Sara').tagName).toBe('STRONG');
  expect(screen.getByText(/مسجّل باسم/)).toBeInTheDocument();
});

it('switches the page direction and number locale', async () => {
  await loadLanguage('ar');
  expect(document.documentElement.dir).toBe('rtl');
  expect(document.documentElement.lang).toBe('ar-KW');
  expect(interfaceLocale('en-KW')).toBe('ar-KW-u-nu-latn');
  expect(t('Governorate')).toBe('المحافظة');
  await loadLanguage('en');
  expect(document.documentElement.dir).toBe('ltr');
  expect(interfaceLocale('en-KW')).toBe('en-KW');
});
