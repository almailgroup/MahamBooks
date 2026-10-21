import { describe, expect, it } from 'vitest';
import { applyPreset, presetOf } from './presets';
import { csvStatement, guessMapping, parseCsvRows } from './statement';

describe('ways of showing amounts', () => {
  it('find money in and money out by their names, English or Arabic', () => {
    for (const header of [
      'Date,Narration,Withdrawal,Deposit,Balance',
      'التاريخ,البيان,سحب,إيداع,الرصيد',
    ]) {
      const table = parseCsvRows(
        `${header}\n01/10/2026,Fee,1.250,,98.750\n02/10/2026,Transfer in,,50.000,148.750\n`,
      );
      const signed = applyPreset(table, guessMapping(table), 'signed');
      expect(presetOf(signed)).toBe('signed');
      const split = applyPreset(table, signed, 'debit-credit');
      expect(split).toMatchObject({ amount: null, moneyOut: 2, moneyIn: 3, balance: 4 });
      expect(presetOf(split)).toBe('debit-credit');
      expect(csvStatement(table, split).lines.map((l) => l.amount)).toEqual([-1.25, 50]);
    }
  });

  it('find an amount and the column that says debit or credit', () => {
    const table = parseCsvRows(
      'Value Date,Details,Amount,Type,Balance\n01/10/2026,Fee,1.250,D,98.750\n02/10/2026,Deposit,50.000,C,148.750\n',
    );
    const guess = guessMapping(table);
    // The guess reads every amount as money in.
    expect(csvStatement(table, guess).lines.map((l) => l.amount)).toEqual([1.25, 50]);
    const typed = applyPreset(table, guess, 'amount-type');
    expect(typed).toMatchObject({ amount: 2, debitCredit: 3, moneyIn: null, moneyOut: null });
    expect(presetOf(typed)).toBe('amount-type');
    expect(csvStatement(table, typed).lines.map((l) => l.amount)).toEqual([-1.25, 50]);
    // Back to one signed column.
    expect(applyPreset(table, typed, 'signed')).toMatchObject({ amount: 2, debitCredit: null });
  });

  it('find the debit or credit column taken as the description, and its other words', () => {
    const table = parseCsvRows(
      'Date,Amount,Dr/Cr,Balance\n01/10/2026,1.250,DR,98.750\n02/10/2026,50.000,CR,148.750\n',
    );
    const guess = guessMapping(table);
    expect(guess.description).toBe(2);
    const typed = applyPreset(table, guess, 'amount-type');
    expect(typed).toMatchObject({ amount: 1, debitCredit: 2 });
    expect(csvStatement(table, typed).lines.map((l) => l.amount)).toEqual([-1.25, 50]);
    for (const [out, into] of [
      ['DB', 'CR'],
      ['صادر', 'وارد'],
    ]) {
      const other = parseCsvRows(
        `Date,Details,Amount,Type,Balance\n01/10/2026,Fee,1.250,${out},98.750\n02/10/2026,Deposit,50.000,${into},148.750\n`,
      );
      const read = applyPreset(other, guessMapping(other), 'amount-type');
      expect(read.debitCredit).toBe(3);
      expect(csvStatement(other, read).lines.map((l) => l.amount)).toEqual([-1.25, 50]);
    }
  });

  it('leave the debit or credit column to be chosen when none is found', () => {
    const table = parseCsvRows(
      'Date,Details,Amount,Balance\n01/10/2026,Fee,1.250,98.750\n02/10/2026,Deposit,50.000,148.750\n',
    );
    const typed = applyPreset(table, guessMapping(table), 'amount-type');
    expect(typed).toMatchObject({ amount: 2, debitCredit: null });
    // Read as one column until it is chosen (the import keeps the choice).
    expect(presetOf(typed)).toBe('signed');
  });

  it('take unnamed numeric columns in order, never the dates', () => {
    const table = parseCsvRows('01/10/2026,02/10/2026,Fee,1.250,,98.750\n');
    const split = applyPreset(table, guessMapping(table), 'debit-credit');
    expect(split.moneyOut).toBe(3);
    expect([0, 1]).not.toContain(split.moneyIn);
  });
});
