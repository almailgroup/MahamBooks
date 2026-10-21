import type { ChequeBox, ChequeLayout } from '@/db/types';
import { msg } from '@/i18n';
import { KUWAIT_BANKS } from './kuwait';

/**
 * Where a bank's cheque leaf takes each field, in millimetres from the top
 * left corner of the leaf (it doesn't turn round in Arabic). The built-in
 * layouts are a starting point for Burgan Bank and KFH: they are not yet
 * measured on real leaves (calibrated: false). The owner adjusts them in
 * Cheques → Cheque layouts and checks them with a test print on the office
 * printer; the company's own layout of a bank then replaces the built-in one.
 */

/** Banks that have a built-in layout. */
export const PRESET_BANKS = ['BRGN', 'KFHO'] as const;

export type PresetBank = (typeof PRESET_BANKS)[number];

const PRESET_PREFIX = 'preset-';
const STAMP = '2026-10-21T00:00:00.000Z';

const box = (x: number, y: number, width: number, height: number): ChequeBox => ({
  x,
  y,
  width,
  height,
});

function bankNames(code: string) {
  const bank = KUWAIT_BANKS.find((b) => b.code === code);
  return { name: bank?.name.en ?? code, nameAr: bank?.name.ar ?? code };
}

const PRESETS: Record<PresetBank, Omit<ChequeLayout, 'companyId'>> = {
  BRGN: {
    id: `${PRESET_PREFIX}BRGN`,
    bank: 'BRGN',
    ...bankNames('BRGN'),
    version: 1,
    size: { width: 178, height: 82 },
    offset: { x: 0, y: 0 },
    fields: {
      date: box(128, 8, 44, 7),
      payee: box(24, 22, 112, 7),
      wordsLine1: box(30, 31, 106, 7),
      wordsLine2: box(8, 39, 128, 7),
      figures: box(138, 31, 34, 8),
      crossing: box(6, 4, 42, 9),
    },
    dateStyle: 'boxes',
    wordsLanguage: 'ar',
    figures: { prefix: '', guard: '**' },
    calibrated: false,
    archived: false,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  KFHO: {
    id: `${PRESET_PREFIX}KFHO`,
    bank: 'KFHO',
    ...bankNames('KFHO'),
    version: 1,
    size: { width: 175, height: 80 },
    offset: { x: 0, y: 0 },
    fields: {
      date: box(130, 9, 38, 7),
      payee: box(22, 23, 112, 7),
      wordsLine1: box(28, 32, 106, 7),
      wordsLine2: box(8, 40, 126, 7),
      figures: box(136, 32, 33, 8),
      crossing: box(6, 4, 42, 9),
    },
    dateStyle: 'slashes',
    wordsLanguage: 'ar',
    figures: { prefix: '', guard: '**' },
    calibrated: false,
    archived: false,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
};

export function isPresetBank(bank: string): bank is PresetBank {
  return (PRESET_BANKS as readonly string[]).includes(bank);
}

/** A built-in layout's id ("preset-BRGN"); company layouts have ids of their own. */
export function isPresetLayoutId(id: string): boolean {
  return id.startsWith(PRESET_PREFIX);
}

export function presetLayoutId(bank: string): string {
  return `${PRESET_PREFIX}${bank}`;
}

/** The built-in layout of a bank, for a company; null for banks without one. */
export function presetLayout(bank: string, companyId: string): ChequeLayout | null {
  const code = bank.trim().toUpperCase();
  if (!isPresetBank(code)) return null;
  const preset = PRESETS[code];
  return {
    ...preset,
    companyId,
    size: { ...preset.size },
    offset: { ...preset.offset },
    fields: Object.fromEntries(
      Object.entries(preset.fields).map(([key, b]) => [key, { ...b }]),
    ) as ChequeLayout['fields'],
    figures: { ...preset.figures },
  };
}

/**
 * The layout a cheque on `bank` prints with: the company's own (the one
 * changed last, should two devices have made one), else the built-in one.
 */
export function layoutFor(
  bank: string,
  saved: readonly ChequeLayout[],
  companyId = saved[0]?.companyId ?? '',
): ChequeLayout | null {
  const code = bank.trim().toUpperCase();
  const own = saved
    .filter((l) => !l.archived && l.bank.trim().toUpperCase() === code)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return own ?? presetLayout(code, companyId);
}

/** Banks with a layout: the built-in ones, then any other the company made one for. */
export function layoutBanks(saved: readonly ChequeLayout[]): string[] {
  const banks: string[] = [...PRESET_BANKS];
  for (const l of saved) {
    const code = l.bank.trim().toUpperCase();
    if (!l.archived && !banks.includes(code)) banks.push(code);
  }
  return banks;
}

/** The fields of a layout, in the order they are shown. */
export const LAYOUT_FIELDS = [
  'date',
  'payee',
  'wordsLine1',
  'wordsLine2',
  'figures',
  'crossing',
] as const satisfies readonly (keyof ChequeLayout['fields'])[];

export type LayoutField = (typeof LAYOUT_FIELDS)[number];

/** English keys, translated where shown. */
export const LAYOUT_FIELD_LABELS: Record<LayoutField, string> = {
  date: msg('Date'),
  payee: msg('Pay to'),
  wordsLine1: msg('Amount in words, line 1'),
  wordsLine2: msg('Amount in words, line 2'),
  figures: msg('Amount in figures'),
  crossing: msg('A/C payee only'),
};

/** A leaf no bank prints is refused: a typing slip, not a cheque. */
const LEAF = { minWidth: 100, maxWidth: 250, minHeight: 50, maxHeight: 120 };
/** How far a whole layout may be moved, in millimetres. */
export const MAX_OFFSET = 15;

/**
 * What is wrong with a layout (an English key to translate), or null: the
 * leaf must be a cheque's size and every field inside it.
 */
export function layoutProblem(layout: ChequeLayout): string | null {
  const { width, height } = layout.size;
  if (!layout.name.trim()) return msg('Give the layout a name.');
  if (
    !(width >= LEAF.minWidth && width <= LEAF.maxWidth) ||
    !(height >= LEAF.minHeight && height <= LEAF.maxHeight)
  ) {
    return msg('A cheque leaf is between 100 and 250 mm wide and 50 and 120 mm high.');
  }
  if (Math.abs(layout.offset.x) > MAX_OFFSET || Math.abs(layout.offset.y) > MAX_OFFSET) {
    return msg('The layout can be moved by up to 15 mm.');
  }
  for (const key of LAYOUT_FIELDS) {
    const b = layout.fields[key];
    if (!b) {
      if (key === 'crossing') continue;
      return msg('Every field needs a place on the leaf.');
    }
    const numbers = [b.x, b.y, b.width, b.height];
    if (
      !numbers.every(Number.isFinite) ||
      b.width <= 0 ||
      b.height <= 0 ||
      b.x < 0 ||
      b.y < 0 ||
      b.x + b.width > width + 0.001 ||
      b.y + b.height > height + 0.001
    ) {
      return msg('Every field must be inside the leaf.');
    }
  }
  return null;
}

/** Whether two layouts put the fields in the same places (names and the calibrated mark aside). */
export function sameMeasurements(a: ChequeLayout, b: ChequeLayout): boolean {
  const measured = (l: ChequeLayout) =>
    JSON.stringify([
      l.size.width,
      l.size.height,
      l.offset.x,
      l.offset.y,
      LAYOUT_FIELDS.map((key) => {
        const b = l.fields[key];
        return b ? [b.x, b.y, b.width, b.height] : null;
      }),
      l.dateStyle,
      l.wordsLanguage,
      l.figures.prefix,
      l.figures.guard,
    ]);
  return measured(a) === measured(b);
}
