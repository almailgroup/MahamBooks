import { describe, expect, it } from 'vitest';
import {
  buildSalaryFile,
  formatSalaryPeriod,
  presetLayout,
  salaryFileCsv,
  type SalaryFileEntry,
} from './salary-file';

const entries: SalaryFileEntry[] = [
  {
    employeeId: 'a',
    employeeNumber: 'EMP-001',
    civilId: '289010112345',
    nameEn: 'Fatima Al-Sabah',
    nameAr: 'فاطمة الصباح',
    iban: 'kw81 cbku 0000 0000 0000 1234 5601 01',
    amount: 1234.5,
  },
  {
    employeeId: 'b',
    employeeNumber: 'EMP-002',
    civilId: '',
    nameEn: 'Ravi, Kumar',
    nameAr: '',
    iban: 'KW81CBKU0000000000001234560101',
    amount: 0.005,
  },
  {
    employeeId: 'c',
    employeeNumber: 'EMP-003',
    civilId: '',
    nameEn: 'Unpaid',
    nameAr: '',
    iban: '',
    amount: 0,
  },
];

const options = {
  layout: presetLayout('wps'),
  period: '2026-09',
  currency: 'KWD',
  precision: 3,
  pamFileNumber: '12345',
  reference: 'Salaries 2026-09',
};

describe('salary transfer file', () => {
  it('has a row per paid employee with 3-decimal amounts and the bank from the IBAN', () => {
    const file = buildSalaryFile(entries, options);
    expect(file.headers).toEqual([
      'Employee No',
      'Civil ID',
      'Employee Name',
      'Employee Name (Arabic)',
      'IBAN',
      'Bank Code',
      'Amount',
      'Salary Month',
      'PAM File No',
    ]);
    expect(file.rows[0]).toEqual([
      'EMP-001',
      '289010112345',
      'Fatima Al-Sabah',
      'فاطمة الصباح',
      'KW81CBKU0000000000001234560101',
      'CBKU',
      '1234.500',
      '202609',
      '12345',
    ]);
    expect(file.rows[1][3]).toBe('Ravi, Kumar');
    expect(file.rows[1][6]).toBe('0.005');
    expect(file.count).toBe(2);
    expect(file.totalMinor).toBe(1_234_505);
    expect(file.problems).toEqual([]);
  });

  it('lists employees whose IBAN is not valid', () => {
    const file = buildSalaryFile(
      [{ ...entries[0], iban: 'KW00CBKU0000000000001234560101' }],
      options,
    );
    expect(file.problems.map((p) => p.employeeId)).toEqual(['a']);
  });

  it('writes CSV with or without the header row and other layouts', () => {
    const file = buildSalaryFile(entries.slice(0, 2), {
      ...options,
      layout: { ...presetLayout('swift'), columns: ['iban', 'swift', 'amount', 'period'] },
    });
    expect(salaryFileCsv(file, true).split('\r\n')).toEqual([
      'IBAN,SWIFT,Amount,Salary Month',
      'KW81CBKU0000000000001234560101,,1234.500,09/2026',
      'KW81CBKU0000000000001234560101,,0.005,09/2026',
    ]);
    expect(salaryFileCsv(file, false).split('\r\n')).toHaveLength(2);
    const nbk = buildSalaryFile([{ ...entries[0], iban: 'KW26NBOK0000000000001000372151' }], {
      ...options,
      layout: { ...presetLayout('wps'), columns: ['swift', 'nameEn'] },
    });
    expect(salaryFileCsv(nbk, false)).toBe('NBOKKWKW,Fatima Al-Sabah');
    expect(formatSalaryPeriod('2026-09', 'yyyy-mm')).toBe('2026-09');
  });
});
