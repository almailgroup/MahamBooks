import { describe, expect, it } from 'vitest';
import { amountQuery, compactSearch, normalizeSearch, textMatches } from './normalize';
import { makeEntry, searchEntries, type EntryInput } from './rank';

const contact = (id: string, name: string, nameAr?: string): EntryInput => ({
  key: `contact:${id}`,
  kind: 'client',
  title: name,
  to: `/clients/${id}`,
  names: [name, nameAr],
});

describe('normalizeSearch', () => {
  it('folds the forms of Arabic letters and drops vowel marks', () => {
    expect(normalizeSearch('أحمد')).toBe(normalizeSearch('احمد'));
    expect(normalizeSearch('إبراهيم')).toBe('ابراهيم');
    expect(normalizeSearch('آمنة')).toBe('امنه');
    expect(normalizeSearch('مستشفى')).toBe('مستشفي');
    expect(normalizeSearch('مُحَمَّد')).toBe('محمد');
    expect(normalizeSearch('شركـــة')).toBe('شركه');
    expect(normalizeSearch('مؤسسة')).toBe('موسسه');
  });

  it('lowercases, drops Latin accents and reads Arabic digits', () => {
    expect(normalizeSearch('  Café  DU   Golfe ')).toBe('cafe du golfe');
    expect(normalizeSearch('٢٠٢٦')).toBe('2026');
    expect(compactSearch('INV-2026-0001')).toBe('inv20260001');
  });

  it('matches every word typed against a list of fields', () => {
    const fields = ['Residency', 'أحمد التجريبي', '18/2024/55', null, undefined];
    expect(textMatches('', fields)).toBe(true);
    expect(textMatches('residency', fields)).toBe(true);
    expect(textMatches('احمد', fields)).toBe(true);
    expect(textMatches('RESIDENCY احمد', fields)).toBe(true);
    expect(textMatches('١٨/٢٠٢٤', fields)).toBe(true);
    expect(textMatches('18202455', fields)).toBe(true);
    expect(textMatches('residency passport', fields)).toBe(false);
    expect(textMatches('99', fields)).toBe(false);
  });

  it('reads typed amounts', () => {
    expect(amountQuery('1,250.750')).toBe('1250.750');
    expect(amountQuery('١٢٥٠٫٧٥')).toBe('1250.75');
    expect(amountQuery('KD 300')).toBe('300');
    expect(amountQuery('Noor')).toBeNull();
  });
});

describe('searchEntries', () => {
  const entries = [
    makeEntry(contact('1', 'Al Noor Trading', 'شركة النور للتجارة')),
    makeEntry(contact('2', 'Noorani Contracting')),
    makeEntry(contact('3', 'Gulf Bank Supplies', 'إمدادات الخليج')),
    makeEntry({
      key: 'document:1',
      kind: 'document',
      title: 'Invoice INV-2026-0001',
      to: '/invoices/1',
      names: ['INV-2026-0001'],
      terms: ['Al Noor Trading', 'شركة النور للتجارة', 'Invoice'],
      numbers: ['INV-2026-0001'],
      amounts: [1250.75],
      precision: 3,
    }),
    makeEntry({
      key: 'page:/invoices',
      kind: 'page',
      title: 'Invoices',
      to: '/invoices',
      names: ['Invoices', 'الفواتير'],
      boost: 30,
    }),
  ];

  it('puts names that start with the query first', () => {
    const found = searchEntries(entries, 'noor');
    expect(found.map((e) => e.key).slice(0, 2)).toEqual(['contact:2', 'contact:1']);
    expect(found.map((e) => e.key)).toContain('document:1');
    expect(searchEntries(entries, 'al noor')[0].key).toBe('contact:1');
  });

  it('finds Arabic names whatever the hamza or ta marbuta', () => {
    expect(searchEntries(entries, 'امدادات')[0].key).toBe('contact:3');
    expect(searchEntries(entries, 'النور')[0].key).toBe('contact:1');
    expect(searchEntries(entries, 'شركه النور')[0].key).toBe('contact:1');
    expect(searchEntries(entries, 'الفواتير')[0].key).toBe('page:/invoices');
  });

  it('finds documents by number with or without dashes, and by amount', () => {
    expect(searchEntries(entries, 'INV-2026-0001')[0].key).toBe('document:1');
    expect(searchEntries(entries, 'inv20260001')[0].key).toBe('document:1');
    expect(searchEntries(entries, '0001')[0].key).toBe('document:1');
    expect(searchEntries(entries, '1,250.750')[0].key).toBe('document:1');
    expect(searchEntries(entries, '1250.75')[0].key).toBe('document:1');
  });

  it('needs every word to match', () => {
    expect(searchEntries(entries, 'noor bank')).toEqual([]);
    expect(searchEntries(entries, '   ')).toEqual([]);
  });

  it('stays fast and capped on 5,000 records', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      makeEntry({
        key: `document:${i}`,
        kind: 'document',
        title: `Invoice INV-2026-${String(i).padStart(4, '0')}`,
        to: `/invoices/${i}`,
        names: [`INV-2026-${String(i).padStart(4, '0')}`],
        terms: [i % 2 ? 'Al Noor Trading' : 'شركة الخليج'],
        numbers: [`INV-2026-${String(i).padStart(4, '0')}`],
        amounts: [i * 1.5],
      }),
    );
    const started = performance.now();
    for (const q of ['noor', 'الخليج', 'inv-2026-4999', '1500', 'zzz']) {
      const found = searchEntries(many, q);
      expect(found.length).toBeLessThanOrEqual(50);
    }
    expect(searchEntries(many, 'INV-2026-4999')[0].key).toBe('document:4999');
    // Five searches over 5,000 records well within a frame budget each (generous for slow CI).
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
