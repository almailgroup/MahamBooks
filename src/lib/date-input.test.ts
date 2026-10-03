import { describe, expect, it } from 'vitest';
import {
  dateOrder,
  endOfMonth,
  fieldPlaceholder,
  formatFieldDate,
  isCompleteDateText,
  monthGrid,
  parseFieldDate,
} from './date-input';

const today = '2026-10-03';
const dmy = { order: 'dmy' as const, today };

describe('formatFieldDate', () => {
  it('shows the company format, never the browser one', () => {
    expect(formatFieldDate('2026-10-03', 'dd/MM/yyyy', 'en-US')).toBe('03/10/2026');
    expect(formatFieldDate('2026-10-03', 'MM/dd/yyyy', 'en-KW')).toBe('10/03/2026');
    expect(formatFieldDate('2026-10-03', 'd MMM yyyy', 'en-KW')).toBe('3 Oct 2026');
    expect(formatFieldDate('', 'dd/MM/yyyy', 'en-KW')).toBe('');
  });

  it('uses Arabic month names in Arabic', () => {
    expect(formatFieldDate('2026-10-03', 'd MMM yyyy', 'ar-KW-u-nu-latn')).toBe('3 أكتوبر 2026');
    expect(formatFieldDate('2026-10-03', 'dd/MM/yyyy', 'ar-KW-u-nu-latn')).toBe('03/10/2026');
    expect(fieldPlaceholder('dd/MM/yyyy', 'ar-KW-u-nu-latn')).toBe('يوم/شهر/سنة');
    expect(fieldPlaceholder('dd/MM/yyyy', 'en-KW')).toBe('dd/mm/yyyy');
  });

  it('turns "based on locale" into a numeric order', () => {
    expect(dateOrder('locale', 'en-US')).toBe('mdy');
    expect(dateOrder('locale', 'en-GB')).toBe('dmy');
    expect(dateOrder('dd/MM/yyyy', 'en-US')).toBe('dmy');
    expect(formatFieldDate('2026-10-03', 'locale', 'en-GB')).toBe('03/10/2026');
  });
});

describe('parseFieldDate', () => {
  it('reads day first in dd/MM/yyyy', () => {
    expect(parseFieldDate('03/10/2026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('3/10/26', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('3.10.2026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('3-10-2026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('03102026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('3/10', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('15', dmy)).toBe('2026-10-15');
  });

  it('reads month first in MM/dd/yyyy and ISO everywhere', () => {
    expect(parseFieldDate('10/03/2026', { order: 'mdy', today })).toBe('2026-10-03');
    expect(parseFieldDate('2026-10-03', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('2026-10-03', { order: 'mdy', today })).toBe('2026-10-03');
  });

  it('reads month names in English and Arabic, with Arabic digits', () => {
    expect(parseFieldDate('3 Oct 2026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('Oct 3, 2026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('3 october', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('3 أكتوبر 2026', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('٣ اكتوبر ٢٠٢٦', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('٠٣/١٠/٢٠٢٦', dmy)).toBe('2026-10-03');
    expect(parseFieldDate('1 تشرين الثاني 2026', dmy)).toBe('2026-11-01');
    expect(parseFieldDate('1 كانون الثاني 2027', dmy)).toBe('2027-01-01');
  });

  it('understands today and +days', () => {
    expect(parseFieldDate('today', dmy)).toBe(today);
    expect(parseFieldDate('اليوم', dmy)).toBe(today);
    expect(parseFieldDate('+7', dmy)).toBe('2026-10-10');
    expect(parseFieldDate('+1m', dmy)).toBe('2026-11-03');
  });

  it('rejects what is not a date', () => {
    expect(parseFieldDate('31/02/2026', dmy)).toBeNull();
    expect(parseFieldDate('13/13/2026', dmy)).toBeNull();
    expect(parseFieldDate('hello', dmy)).toBeNull();
    expect(parseFieldDate('', dmy)).toBeNull();
  });

  it('knows when a typed date is complete', () => {
    expect(isCompleteDateText('2024-01-01')).toBe(true);
    expect(isCompleteDateText('03/10/2026')).toBe(true);
    expect(isCompleteDateText('3 Oct 2026')).toBe(true);
    expect(isCompleteDateText('3/10/20')).toBe(false);
    expect(isCompleteDateText('2026')).toBe(false);
  });
});

describe('calendar helpers', () => {
  it('starts weeks on Sunday and ends months on their last day', () => {
    const grid = monthGrid('2026-10-01');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-09-27');
    expect(grid[4]).toBe('2026-10-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });
});
