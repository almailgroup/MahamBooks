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

  it('take unnamed numeric columns in order, never the dates', () => {
    const table = parseCsvRows('01/10/2026,02/10/2026,Fee,1.250,,98.750\n');
    const split = applyPreset(table, guessMapping(table), 'debit-credit');
    expect(split.moneyOut).toBe(3);
    expect([0, 1]).not.toContain(split.moneyIn);
  });
});
