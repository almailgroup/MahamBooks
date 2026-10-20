import { debitOrCredit, detectDateFormats, parseAmount, type CsvMapping } from './statement';
import { msg } from '@/i18n';

/**
 * The ways statements show money in and out, as the import offers them
 * under "Amounts". Choosing one finds its columns by their names (English or
 * Arabic), then by what they hold. They are generic: no bank's own export
 * was available to measure, so none is described here as a bank's layout.
 * Each account remembers its own layout after an import instead.
 */

export type StatementPreset = 'signed' | 'debit-credit' | 'amount-type';

/** Translate the label where it is shown: `t(preset.label)`. */
export const STATEMENT_PRESETS: { value: StatementPreset; label: string }[] = [
  { value: 'signed', label: msg('One column (minus for money out)') },
  { value: 'debit-credit', label: msg('Money in and money out columns') },
  { value: 'amount-type', label: msg('One column and a debit or credit column') },
];

const MONEY_OUT = /debit|withdrawal|paid out|money out|^out$|مدين|سحب|صادر/i;
const MONEY_IN = /credit|deposit|paid in|money in|^in$|دائن|إيداع|ايداع|وارد/i;
const AMOUNT = /amount|value|sum|المبلغ|مبلغ|القيمة/i;
const SIDE =
  /dr\s*\/\s*cr|cr\s*\/\s*dr|^d\s*\/\s*c$|^c\s*\/\s*d$|type|indicator|نوع|مدين\s*\/\s*دائن/i;

/** The way a mapping shows amounts. */
export function presetOf(mapping: CsvMapping): StatementPreset {
  if (mapping.amount === null) return 'debit-credit';
  return mapping.debitCredit != null ? 'amount-type' : 'signed';
}

/** The mapping with its amount columns found again for `preset`; the other columns stay. */
export function applyPreset(
  table: string[][],
  mapping: CsvMapping,
  preset: StatementPreset,
): CsvMapping {
  const names = mapping.header ? (table[0] ?? []) : [];
  const body = (mapping.header ? table.slice(1) : table).slice(0, 50);
  const width = Math.max(0, ...table.slice(0, 20).map((r) => r.length));
  const values = (i: number) => body.map((r) => r[i] ?? '').filter((v) => v.trim() !== '');
  const other = [
    mapping.date,
    mapping.description,
    mapping.reference,
    mapping.balance,
    mapping.valueDate,
  ];
  const free = Array.from({ length: width }, (_, i) => i).filter((i) => !other.includes(i));
  // A money column may be empty in a short statement (no money out that month).
  const money = (i: number) => {
    const filled = values(i);
    const dates = filled.length > 0 && detectDateFormats(filled).length > 0;
    return !dates && filled.every((v) => parseAmount(v) !== null);
  };
  const named = (hint: RegExp, not?: RegExp, test = money) =>
    free.find((i) => hint.test(names[i] ?? '') && !not?.test(names[i] ?? '') && test(i)) ?? null;
  const numeric = free.filter((i) => values(i).length > 0 && money(i));

  if (preset === 'debit-credit') {
    let moneyOut = named(MONEY_OUT, MONEY_IN) ?? mapping.moneyOut;
    let moneyIn = named(MONEY_IN, MONEY_OUT) ?? mapping.moneyIn;
    const rest = numeric.filter((i) => i !== moneyOut && i !== moneyIn);
    moneyOut ??= rest.shift() ?? mapping.amount ?? 0;
    moneyIn ??= rest.shift() ?? mapping.amount ?? 0;
    return { ...mapping, amount: null, moneyIn, moneyOut, debitCredit: null };
  }
  const amount = named(AMOUNT, MONEY_IN) ?? mapping.amount ?? numeric[0] ?? mapping.moneyIn ?? 0;
  if (preset === 'signed') {
    return { ...mapping, amount, moneyIn: null, moneyOut: null, debitCredit: null };
  }
  // Most of its cells say debit or credit.
  const sides = (i: number) => {
    const filled = values(i);
    return (
      filled.length > 0 && filled.filter((v) => debitOrCredit(v)).length >= filled.length * 0.8
    );
  };
  const side = named(SIDE, undefined, sides) ?? free.find((i) => i !== amount && sides(i)) ?? null;
  return { ...mapping, amount, moneyIn: null, moneyOut: null, debitCredit: side };
}
