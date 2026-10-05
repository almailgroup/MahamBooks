import { describe, expect, it } from 'vitest';
import {
  documentKind,
  matchDocuments,
  MAX_DOCUMENT_BYTES,
  numberInFileName,
  numberKey,
} from './document-match';

const pdf = (name: string, size = 120_000) => ({ name, size, type: 'application/pdf' });

describe('employee numbers in file names', () => {
  it('reads the number at the end of the name, or its only number', () => {
    expect(numberInFileName('موظف تجريبي واحد 424.pdf')).toBe('424');
    expect(numberInFileName('Test Guard_0424.PDF')).toBe('0424');
    expect(numberInFileName('Test Guard 424 (2).pdf')).toBe('424');
    expect(numberInFileName('Test Guard 424 - Copy.pdf')).toBe('424');
    expect(numberInFileName('موظف تجريبي ٤٢٤.pdf')).toBe('424');
    expect(numberInFileName('EMP424 passport.jpg')).toBe('424');
    expect(numberInFileName('2024-05-01 contract 424.pdf')).toBe('424');
    // A photo's date and time are not an employee number.
    expect(numberInFileName('WhatsApp Image 2023-05-12 at 10.20.30.jpeg')).toBeNull();
    expect(numberInFileName('passport.pdf')).toBeNull();
    expect(numberKey('000424')).toBe('424');
    expect(numberKey('EMP-0424')).toBe('424');
    expect(numberKey('0')).toBe('0');
    expect(numberKey('ADMIN')).toBe('');
  });

  it('takes photos and PDF files only', () => {
    expect(documentKind(pdf('a.pdf'))).toBe('pdf');
    expect(documentKind({ name: 'a.jpg', size: 1, type: 'image/jpeg' })).toBe('image');
    expect(documentKind({ name: 'scan.PDF', size: 1, type: '' })).toBe('pdf');
    expect(documentKind({ name: 'scan.heic', size: 1, type: '' })).toBe('image');
    expect(documentKind({ name: 'a.docx', size: 1, type: 'application/msword' })).toBeNull();
    expect(documentKind({ name: 'notes.txt', size: 1, type: '' })).toBeNull();
  });
});

describe('matching documents to employees', () => {
  const employees = [
    { id: 'e424', number: '000424' },
    { id: 'e7', number: '7' },
    { id: 'e12a', number: '000012' },
    { id: 'e12b', number: 'EMP-012' },
    { id: 'admin', number: 'ADMIN' },
  ];

  it('matches by number without leading zeros and explains the rest', () => {
    const files = [
      pdf('موظف تجريبي واحد 424.pdf'),
      { name: 'Test Seven 007.jpg', size: 2_000_000, type: 'image/jpeg' },
      pdf('Somebody 999.pdf'),
      pdf('Twelve 12.pdf'),
      pdf('passport.pdf'),
      pdf('Too large 424.pdf', MAX_DOCUMENT_BYTES + 1),
      { name: 'Notes 424.txt', size: 10, type: 'text/plain' },
    ];
    expect(matchDocuments(files, employees).map(({ file, ...rest }) => [file.name, rest])).toEqual([
      ['موظف تجريبي واحد 424.pdf', { status: 'matched', employeeId: 'e424', number: '424' }],
      ['Test Seven 007.jpg', { status: 'matched', employeeId: 'e7', number: '007' }],
      ['Somebody 999.pdf', { status: 'unmatched', reason: 'unknown', number: '999' }],
      ['Twelve 12.pdf', { status: 'unmatched', reason: 'several', number: '12' }],
      ['passport.pdf', { status: 'unmatched', reason: 'none', number: null }],
      ['Too large 424.pdf', { status: 'refused', reason: 'size' }],
      ['Notes 424.txt', { status: 'refused', reason: 'type' }],
    ]);
  });

  it('allows a file of exactly 10 MB', () => {
    const [match] = matchDocuments([pdf('Limit 424.pdf', MAX_DOCUMENT_BYTES)], employees);
    expect(match.status).toBe('matched');
  });
});
