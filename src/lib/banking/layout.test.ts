import { describe, expect, it } from 'vitest';
import { guessLayout, rememberedFormat, statementLayout, statementTable } from './layout';
import { csvStatement, parseCsvRows } from './statement';
import type { StatementFormat } from '@/db/types';
import { STATEMENT_RESULT, statementCsv, statementRows } from '@/test/bank-statements';

const lines = (rows: string[][], format?: StatementFormat) => {
  const layout = statementLayout(rows, format);
  return { layout, ...csvStatement(statementTable(rows, layout.start), layout.mapping) };
};

describe('statement layouts', () => {
  it('are guessed when the account remembers none', () => {
    const rows = parseCsvRows(statementCsv());
    const { layout, lines: read } = lines(rows);
    expect(layout).toMatchObject({ start: 5, remembered: false });
    expect(read).toEqual(STATEMENT_RESULT);
  });

  it('are remembered with their column names and found again under more rows', () => {
    const rows = parseCsvRows(statementCsv());
    // The guess took the posting date; this account's lines go by the value date.
    const chosen = { ...guessLayout(rows, 5).mapping, date: 1, valueDate: 0 };
    const format = rememberedFormat('csv', rows, 5, chosen);
    expect(format).toEqual({
      kind: 'csv',
      headerRow: 5,
      mapping: chosen,
      preset: 'debit-credit',
      columns: [
        'Posting Date',
        'Value Date',
        'Description',
        'Reference',
        'Debit',
        'Credit',
        'Balance',
      ],
    });
    // The next statement has a second address line above the table.
    const next = [...rows.slice(0, 2), ['', 'BLOCK 1, STREET 2'], ...rows.slice(2)];
    const { layout, lines: read } = lines(next, format);
    expect(layout).toMatchObject({ start: 6, remembered: true });
    expect(read.map((l) => l.date)).toEqual(['2026-10-01', '2026-10-03', '2026-10-05']);
  });

  it('read the dates again when the same bank writes them another way', () => {
    const rows = parseCsvRows(statementCsv());
    const format = rememberedFormat('csv', rows, 5, guessLayout(rows, 5).mapping);
    // Excel files have real dates, which come out as yyyy-MM-dd.
    const excel = statementRows().map((row, i) =>
      i > 5 && i < 9 ? row.map((v, c) => (c < 2 ? v.split('/').reverse().join('-') : v)) : row,
    );
    const { layout, lines: read } = lines(excel, format);
    expect(layout.remembered).toBe(true);
    expect(layout.mapping.dateFormat).toBe('yyyy-MM-dd');
    expect(read).toEqual(STATEMENT_RESULT);
  });

  it('are guessed again when the remembered one doesn’t fit', () => {
    const rows = parseCsvRows(statementCsv());
    const format = rememberedFormat('csv', rows, 5, guessLayout(rows, 5).mapping);
    const other = parseCsvRows('Date,Details,Amount\n01/10/2026,Fee,-1.250\n');
    expect(lines(other, format).layout).toMatchObject({ start: 0, remembered: false });
    // What another version stored, or nothing usable.
    for (const stored of [
      { ...format, mapping: { ...format.mapping, date: 'A' } },
      { ...format, mapping: { ...format.mapping, amount: null, moneyIn: null, moneyOut: null } },
      { ...format, mapping: null },
      { ...format, kind: 'pdf' },
      { ...format, columns: undefined, headerRow: 99 },
    ] as unknown as StatementFormat[]) {
      const { layout, lines: read } = lines(rows, stored);
      expect(read).toHaveLength(3);
      if (stored.kind === 'pdf' || !stored.mapping) expect(layout.remembered).toBe(false);
    }
  });

  it('of tables without column names start where they started', () => {
    const rows = parseCsvRows('Statement\n2026-10-01,Coffee,-3.20\n2026-10-02,Lunch,-6.50\n');
    const guessed = guessLayout(rows, 1);
    expect(guessed.mapping.header).toBe(false);
    const format = rememberedFormat('csv', rows, 1, guessed.mapping);
    expect(format).not.toHaveProperty('columns');
    expect(lines(rows, format)).toMatchObject({ layout: { start: 1, remembered: true } });
    expect(lines(rows, format).lines).toHaveLength(2);
  });

  it('of tables without column names lose no line when fewer rows are above them', () => {
    const october = parseCsvRows(
      'Statement\nAccount,TEST-0001\nPeriod,October 2026\n' +
        '2026-10-01,Coffee,-3.200\n2026-10-02,Lunch,-6.500\n',
    );
    const guessed = guessLayout(october, 3);
    expect(guessed.mapping.header).toBe(false);
    const format = rememberedFormat('csv', october, 3, guessed.mapping);
    expect(format.headerRow).toBe(3);
    // November's statement has no Period line.
    const november = parseCsvRows(
      'Statement\nAccount,TEST-0001\n' +
        '2026-11-01,Rent,-300.000\n2026-11-02,Fee,-1.250\n2026-11-03,Salary,850.000\n',
    );
    const read = lines(november, format);
    expect(read.layout).toMatchObject({ start: 2, remembered: true });
    expect(read.lines.map((l) => [l.description, l.amount])).toEqual([
      ['Rent', -300],
      ['Fee', -1.25],
      ['Salary', 850],
    ]);
    // And with more rows above them, the lines are all read too.
    const december = parseCsvRows(
      'Statement\nAccount,TEST-0001\nPeriod,December 2026\nBranch,Main\n' +
        '2026-12-01,Rent,-300.000\n2026-12-02,Fee,-1.250\n',
    );
    expect(lines(december, format).lines.map((l) => l.description)).toEqual(['Rent', 'Fee']);
  });
});
