import type {
  ChequeBox,
  ChequeDetails,
  ChequeLayout,
  ChequePrintedText,
  ISODate,
  Payment,
} from '@/db/types';
import { msg } from '@/i18n';
import { amountInWords } from './words';
import { round, toMinor } from './money';

/**
 * Printing a cheque issued onto the bank's leaf: what goes in each field
 * (chequeFace), how the amount in words is split over the leaf's two lines
 * (fitWords), and which cheques may be printed (printRefusal). The amount is
 * rounded to the fils once, so the words and the figures always say the
 * same. Printing posts nothing: it only records the print on the cheque.
 */

/** Width of a text in millimetres, at a font size in millimetres (bold for the figures). */
export type MeasureText = (text: string, sizeMm: number, bold?: boolean) => number;

/** "A/C payee only", printed in both languages inside the crossing. */
export const CROSSING_LINES = ['يصرف للمستفيد الأول', 'A/C Payee Only'] as const;

export interface ChequeFace {
  /** The date as printed: 12/10/2026, or its eight digits when the leaf has date boxes. */
  date: string;
  /** One digit per date box (DDMMYYYY) when the layout writes the date in boxes. */
  dateDigits: string[] | null;
  payee: string;
  /** The amount in words, in the layout's language, on one line before it is split. */
  words: string;
  figures: string;
  /** The crossing's lines, when the cheque is crossed. */
  crossing: string[] | null;
  /** The amount printed, rounded to the fils. */
  amount: number;
}

/** 2026-10-12 → 12/10/2026. */
export function chequeDate(date: ISODate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** The amount in figures with the leaf's prefix and guards: "**1,250.750**". */
export function chequeFigures(amount: number, figures: ChequeLayout['figures']): string {
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(round(amount, 3));
  const guarded = `${figures.guard}${number}${figures.guard}`;
  return figures.prefix.trim() ? `${figures.prefix.trim()} ${guarded}` : guarded;
}

/** What prints in each field of the leaf. */
export function chequeFace(
  cheque: { amount: number; date: ISODate; payee: string },
  layout: ChequeLayout,
  options: { crossed?: boolean } = {},
): ChequeFace {
  const amount = round(cheque.amount, 3);
  const date = chequeDate(cheque.date);
  return {
    date,
    dateDigits: layout.dateStyle === 'boxes' ? date.replace(/\//g, '').split('') : null,
    payee: cheque.payee.trim(),
    words: amountInWords(amount, 'KWD', layout.wordsLanguage),
    figures: chequeFigures(amount, layout.figures),
    crossing: options.crossed ? [...CROSSING_LINES] : null,
    amount,
  };
}

/**
 * Splits the amount in words over two lines of the given widths (mm): as
 * many words as fit on the first, the rest on the second. Every word is
 * kept, in order; `fits` is false when the second line is too long.
 */
export function splitWords(
  text: string,
  widthsMm: readonly [number, number],
  measure: (text: string) => number,
): { lines: [string, string]; fits: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const first: string[] = [];
  let i = 0;
  for (; i < words.length; i++) {
    if (measure([...first, words[i]].join(' ')) > widthsMm[0]) break;
    first.push(words[i]);
  }
  const second = words.slice(i).join(' ');
  return { lines: [first.join(' '), second], fits: measure(second) <= widthsMm[1] };
}

/** Space left free on each side of a field's text, in millimetres. */
export const FIELD_PADDING = 0.8;

/** The font size (mm) for a field: a little over half its height, at most 4.2 mm (about 12 pt). */
export function fieldTextSize(box: ChequeBox): number {
  return Math.min(4.2, box.height * 0.55);
}

/**
 * The amount in words on the leaf's two lines, at the largest size that
 * fits (down to 70% of the usual size). `fits` is false when even the
 * smallest doesn't: the layout's lines are too short for this amount.
 */
export function fitWords(
  text: string,
  lines: readonly [ChequeBox, ChequeBox],
  measure: MeasureText,
): { lines: [string, string]; size: number; fits: boolean } {
  const base = Math.min(fieldTextSize(lines[0]), fieldTextSize(lines[1]));
  const widths = [lines[0].width - 2 * FIELD_PADDING, lines[1].width - 2 * FIELD_PADDING] as const;
  let last: { lines: [string, string]; size: number; fits: boolean } | null = null;
  for (let scale = 1; scale >= 0.7 - 1e-9; scale -= 0.05) {
    const size = Math.round(base * scale * 100) / 100;
    const split = splitWords(text, widths, (t) => measure(t, size));
    last = { ...split, size };
    if (split.fits) return last;
  }
  return last!;
}

/**
 * The size (mm) a one-line field prints at: its usual size, or smaller (down
 * to 60%) for a long name or a large amount. `fits` is false when even that
 * is too wide for the field.
 */
export function fitLine(
  text: string,
  box: ChequeBox,
  measure: MeasureText,
  bold = false,
): { size: number; fits: boolean } {
  const base = fieldTextSize(box);
  const width = box.width - 2 * FIELD_PADDING;
  let size = base;
  for (let scale = 1; scale >= 0.6 - 1e-9; scale -= 0.05) {
    size = Math.round(base * scale * 100) / 100;
    if (measure(text, size, bold) <= width) return { size, fits: true };
  }
  return { size, fits: false };
}

export interface ChequeFit {
  date: { size: number; fits: boolean };
  payee: { size: number; fits: boolean };
  words: { lines: [string, string]; size: number; fits: boolean };
  figures: { size: number; fits: boolean };
  /** Everything fits in its field. */
  fits: boolean;
}

/** How each field of the face is printed on the layout's leaf. */
export function fitFace(face: ChequeFace, layout: ChequeLayout, measure: MeasureText): ChequeFit {
  const { fields } = layout;
  const date = face.dateDigits
    ? { size: fieldTextSize(fields.date), fits: true }
    : fitLine(face.date, fields.date, measure);
  const payee = fitLine(face.payee, fields.payee, measure);
  const words = fitWords(face.words, [fields.wordsLine1, fields.wordsLine2], measure);
  const figures = fitLine(face.figures, fields.figures, measure, true);
  return {
    date,
    payee,
    words,
    figures,
    fits: date.fits && payee.fits && words.fits && figures.fits,
  };
}

/** The text of a print, kept on the cheque. */
export function printedText(
  face: ChequeFace,
  words: readonly string[],
  layout: ChequeLayout,
): ChequePrintedText {
  return {
    date: face.date,
    payee: face.payee,
    words: words.filter(Boolean),
    figures: face.figures,
    ...(face.crossing ? { crossing: face.crossing.join(' / ') } : {}),
    layoutVersion: layout.version,
  };
}

/** Who the cheque is payable to: the name typed on it, else the vendor's. */
export function chequePayee(
  cheque: Pick<ChequeDetails, 'drawer'>,
  vendor: { name: string; nameAr?: string } | null | undefined,
  language: 'ar' | 'en',
): string {
  const typed = cheque.drawer.trim();
  if (typed) return typed;
  if (!vendor) return '';
  return (language === 'ar' && vendor.nameAr?.trim()) || vendor.name.trim();
}

export type PrintRefusal =
  | 'not_cheque'
  | 'received'
  | 'void'
  | 'cancelled'
  | 'cleared'
  | 'returned'
  | 'presented'
  | 'currency'
  | 'amount'
  | 'printed'
  | 'leaf_spoiled';

/** English keys, translated where shown. */
export const REFUSAL_TEXT: Record<PrintRefusal, string> = {
  not_cheque: msg('This payment has no cheque.'),
  received: msg('Only cheques the company issues are printed.'),
  void: msg('This cheque is void.'),
  cancelled: msg('This cheque was cancelled.'),
  cleared: msg('This cheque has cleared.'),
  returned: msg('This cheque came back unpaid.'),
  presented: msg('Only a cheque not yet presented can be printed.'),
  currency: msg('Only cheques in Kuwaiti dinars are printed.'),
  amount: msg('The cheque has no amount.'),
  printed: msg('This cheque was printed. To print it again, mark its leaf spoiled first.'),
  leaf_spoiled: msg('The leaf with this number is spoiled. Enter the number of the next leaf.'),
};

/** Refusals that the person can clear from the print page: by marking a leaf spoiled or taking the next one. */
export function printableAfterLeaf(refusal: PrintRefusal | null): boolean {
  return refusal === null || refusal === 'printed' || refusal === 'leaf_spoiled';
}

/** Whether the cheque's number is that of one of its spoiled leaves (it changed after printing). */
export function onSpoiledLeaf(cheque: Pick<ChequeDetails, 'number' | 'spoiledLeaves'>): boolean {
  const number = cheque.number.trim();
  return (cheque.spoiledLeaves ?? []).some((leaf) => leaf.number.trim() === number);
}

/**
 * Why a payment's cheque can't be printed now, or null when it can: a
 * cheque issued, in dinars, not void, still waiting to be presented, not
 * printed yet (printing it again first marks the printed leaf spoiled) and
 * not on a leaf that is spoiled.
 */
export function printRefusal(
  payment: Pick<Payment, 'method' | 'cheque' | 'direction' | 'voided' | 'currency' | 'amount'>,
): PrintRefusal | null {
  const cheque = payment.cheque;
  if (payment.method !== 'cheque' || !cheque) return 'not_cheque';
  if (payment.direction !== 'out') return 'received';
  if (cheque.status === 'cancelled') return 'cancelled';
  if (cheque.status === 'returned') return 'returned';
  if (cheque.status === 'cleared') return 'cleared';
  if (payment.voided) return 'void';
  if (cheque.status !== 'held') return 'presented';
  if (payment.currency.trim().toUpperCase() !== 'KWD') return 'currency';
  if (!(round(payment.amount, 3) > 0)) return 'amount';
  if (cheque.printedAt) return 'printed';
  if (onSpoiledLeaf(cheque)) return 'leaf_spoiled';
  return null;
}

/** Whether the cheque can be printed now. */
export function canPrint(payment: Parameters<typeof printRefusal>[0]): boolean {
  return printRefusal(payment) === null;
}

/** The number of the next leaf in the cheque book: 000123 → 000124; '' when it has no number at the end. */
export function nextLeafNumber(number: string): string {
  const match = /^(.*?)(\d+)$/.exec(number.trim());
  if (!match) return '';
  const [, head, digits] = match;
  const next = String(BigInt(digits) + 1n).padStart(digits.length, '0');
  return `${head}${next}`;
}

/**
 * Whether a change to a printed cheque makes its leaf wrong: another
 * number, bank, date, payee or amount.
 */
export function printedFaceChanged(
  before: Pick<Payment, 'cheque' | 'amount' | 'currency' | 'clientId'>,
  after: Pick<Payment, 'cheque' | 'amount' | 'currency' | 'clientId'>,
): boolean {
  const a = before.cheque;
  const b = after.cheque;
  if (!a?.printedAt) return false;
  if (!b) return true;
  return (
    a.number.trim() !== b.number.trim() ||
    a.bank.trim().toUpperCase() !== b.bank.trim().toUpperCase() ||
    a.date !== b.date ||
    a.drawer.trim() !== b.drawer.trim() ||
    // Printed with the vendor's name.
    (!a.drawer.trim() && before.clientId !== after.clientId) ||
    toMinor(before.amount, 3) !== toMinor(after.amount, 3) ||
    before.currency !== after.currency
  );
}

/**
 * `next` with the print of `printed` taken off and its leaf added to the
 * spoiled ones (the leaf is destroyed; the cheque prints again on another).
 */
export function spoilPrintedLeaf(
  printed: ChequeDetails,
  next: ChequeDetails,
  reason: string,
  at: string,
): ChequeDetails {
  const rest: ChequeDetails = { ...next };
  delete rest.printedAt;
  delete rest.printedLayoutId;
  delete rest.printedText;
  delete rest.crossed;
  return {
    ...rest,
    spoiledLeaves: [
      ...(printed.spoiledLeaves ?? []),
      {
        number: printed.number,
        at,
        reason: reason.trim(),
        ...(printed.printedText ? { printedText: printed.printedText } : {}),
      },
    ],
  };
}
