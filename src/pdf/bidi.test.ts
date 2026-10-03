import { describe, expect, it } from 'vitest';
import { hasArabic, LRM, ltr, markLines, RLM, textDirection } from './bidi';

describe('bidi helpers', () => {
  it('find the direction of the first strong letter', () => {
    expect(textDirection('فاتورة INV-1')).toBe('rtl');
    expect(textDirection('Invoice فاتورة')).toBe('ltr');
    expect(textDirection('+965 2575 0142')).toBeNull();
    expect(hasArabic('INV-2026-0001')).toBe(false);
    expect(hasArabic('رقم 5')).toBe(true);
  });

  it('mark only the ends that need it', () => {
    expect(ltr('Invoice')).toBe('Invoice');
    expect(ltr('Invoice no.')).toBe(`Invoice no.${LRM}`);
    expect(ltr('+965 2575 0142')).toBe(`${LRM}+965 2575 0142`);
    expect(ltr('')).toBe('');
  });

  it('keep each line of mixed text in its own direction', () => {
    expect(markLines('شكراً لكم.\nThank you.', 'rtl')).toBe(`شكراً لكم.\nThank you.${LRM}`);
    expect(markLines('Thank you.\nشكراً لكم.', 'ltr')).toBe(`Thank you.\nشكراً لكم.${RLM}`);
    expect(markLines('البنك\n+965 9876 5432', 'rtl')).toBe(`البنك\n${LRM}+965 9876 5432`);
    expect(markLines('One line.', 'rtl')).toBe('One line.');
  });
});
