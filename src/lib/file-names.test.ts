import { describe, expect, it } from 'vitest';
import { downloadName, fileName } from './file-names';

describe('download names', () => {
  it('are ASCII, so browsers keep them in Arabic too', () => {
    expect(fileName(['Invoice INV-2026-0001', 'شركة الميل للتجارة'], 'pdf')).toBe(
      'Invoice INV-2026-0001.pdf',
    );
    expect(fileName(['Invoice INV-2026-0001', 'Orbit Logistics Ltd.'], 'pdf')).toBe(
      'Invoice INV-2026-0001 - Orbit Logistics Ltd.pdf',
    );
    expect(fileName(['Statement', 'Café Nour – Salmiya'], '.PDF')).toBe(
      'Statement - Cafe Nour - Salmiya.pdf',
    );
    expect(fileName('الموظفون', 'csv', 'employees')).toBe('employees.csv');
  });

  it('keep the extension of a finished name', () => {
    expect(downloadName('salaries-2026-09.csv')).toBe('salaries-2026-09.csv');
    expect(downloadName('Statements 2026-01-01 to 2026-12-31.pdf')).toBe(
      'Statements 2026-01-01 to 2026-12-31.pdf',
    );
    expect(downloadName('كشف حساب.pdf', 'statement')).toBe('statement.pdf');
    expect(downloadName('a:b?c.csv')).toBe('a-b-c.csv');
  });
});
