import type { Company, CustomUnit, DocumentLanguage, ID } from '@/db/types';

/**
 * Units items are counted and sold in (D11): a fixed list with Arabic names,
 * plus the company's own (Company.items.customUnits). A line keeps the unit
 * as printed text (`unit`) and, when it was picked from the list, its id
 * (`unitId`), so Arabic documents can print the Arabic name. Units typed by
 * hand stay as they were typed.
 */

export interface ItemUnit {
  id: ID;
  /** Printed on English documents and stored as the line's unit. */
  name: string;
  nameAr: string;
  archived?: boolean;
}

interface BuiltInUnit extends ItemUnit {
  /** Other ways the unit is written, in English and Arabic. */
  aliases: string[];
}

/** The built-in units. Their ids never change: lines and items keep them. */
export const BUILT_IN_UNITS: readonly BuiltInUnit[] = [
  {
    id: 'pcs',
    name: 'pcs',
    nameAr: 'قطعة',
    aliases: ['pc', 'pce', 'piece', 'pieces', 'ea', 'each', 'nos', 'no', 'قطع', 'حبة', 'حبات'],
  },
  { id: 'box', name: 'box', nameAr: 'علبة', aliases: ['boxes', 'bx', 'علب'] },
  { id: 'carton', name: 'carton', nameAr: 'كرتون', aliases: ['cartons', 'ctn', 'ctns', 'كراتين'] },
  {
    id: 'kg',
    name: 'kg',
    nameAr: 'كغ',
    aliases: ['kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'كجم', 'كيلو', 'كيلوغرام'],
  },
  {
    id: 'l',
    name: 'litre',
    nameAr: 'لتر',
    aliases: ['l', 'ltr', 'ltrs', 'litres', 'liter', 'liters', 'لترات'],
  },
  {
    id: 'm',
    name: 'm',
    nameAr: 'متر',
    aliases: ['mtr', 'mtrs', 'metre', 'metres', 'meter', 'meters', 'أمتار'],
  },
  { id: 'hour', name: 'hour', nameAr: 'ساعة', aliases: ['h', 'hr', 'hrs', 'hours', 'ساعات'] },
  { id: 'day', name: 'day', nameAr: 'يوم', aliases: ['days', 'أيام'] },
  { id: 'month', name: 'month', nameAr: 'شهر', aliases: ['months', 'mo', 'أشهر', 'شهور'] },
  { id: 'trip', name: 'trip', nameAr: 'رحلة', aliases: ['trips', 'رحلات'] },
  { id: 'set', name: 'set', nameAr: 'طقم', aliases: ['sets', 'أطقم'] },
];

/**
 * Text folded for comparing: lower case, no dots or spaces at the ends, and
 * Arabic without diacritics, tatweel or the variants of alef, yaa and taa marbuta.
 */
function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
}

/** The company's own units, archived ones included. */
export function customUnits(company: Pick<Company, 'items'> | null | undefined): CustomUnit[] {
  return company?.items?.customUnits ?? [];
}

/** Units to pick from: the built-in ones, then the company's own that aren't archived. */
export function unitChoices(company: Pick<Company, 'items'> | null | undefined): ItemUnit[] {
  return [
    ...BUILT_IN_UNITS.map(({ id, name, nameAr }) => ({ id, name, nameAr })),
    ...customUnits(company).filter((u) => !u.archived),
  ];
}

/** The unit with this id, built-in or the company's (archived too); null when unknown. */
export function findUnit(
  company: Pick<Company, 'items'> | null | undefined,
  id: ID | null | undefined,
): ItemUnit | null {
  if (!id) return null;
  const builtIn = BUILT_IN_UNITS.find((u) => u.id === id);
  if (builtIn) return { id: builtIn.id, name: builtIn.name, nameAr: builtIn.nameAr };
  return customUnits(company).find((u) => u.id === id) ?? null;
}

/**
 * The unit a text stands for ("pc", "Pcs.", "قطعة" are all pieces), for
 * items saved before units came from a list. The company's own units first,
 * then the built-in ones. Null when nothing matches.
 */
export function matchUnit(
  text: string | null | undefined,
  company?: Pick<Company, 'items'> | null,
): ID | null {
  const folded = fold(text ?? '');
  if (!folded) return null;
  const own = customUnits(company).find(
    (u) => !u.archived && (fold(u.name) === folded || fold(u.nameAr) === folded),
  );
  if (own) return own.id;
  const builtIn = BUILT_IN_UNITS.find((u) =>
    [u.id, u.name, u.nameAr, ...u.aliases].some((alias) => fold(alias) === folded),
  );
  return builtIn?.id ?? null;
}

/** A unit's name in the app's (or a document's) language. */
export function unitName(unit: ItemUnit, language: DocumentLanguage): string {
  return language === 'ar' || language === 'ar-en' ? unit.nameAr.trim() || unit.name : unit.name;
}

/** Whether `text` is one of the unit's names (or, for a built-in unit, the ways it is written). */
export function namesUnit(text: string | null | undefined, unit: ItemUnit): boolean {
  const folded = fold(text ?? '');
  if (!folded) return false;
  const builtIn = BUILT_IN_UNITS.find((u) => u.id === unit.id);
  const names = [unit.name, unit.nameAr, ...(builtIn ? [builtIn.id, ...builtIn.aliases] : [])];
  return names.some((name) => fold(name) === folded);
}

/**
 * The unit of an item (or a line) picked from the list, while its text is
 * still that unit's: an older version may have typed another unit over it
 * and kept the id. Null otherwise.
 */
export function listedUnit(
  company: Pick<Company, 'items'> | null | undefined,
  item: { unit: string; unitId?: ID | null },
): ItemUnit | null {
  const unit = findUnit(company, item.unitId);
  return unit && namesUnit(item.unit, unit) ? unit : null;
}

/**
 * How an item's (or a line's) unit reads in `language`: on Arabic and
 * bilingual documents the Arabic name of a unit picked from the list; else
 * the unit as stored.
 */
export function unitText(
  company: Pick<Company, 'items'> | null | undefined,
  item: { unit: string; unitId?: ID | null },
  language: DocumentLanguage,
): string {
  if (language !== 'ar' && language !== 'ar-en') return item.unit;
  return listedUnit(company, item)?.nameAr.trim() || item.unit;
}
