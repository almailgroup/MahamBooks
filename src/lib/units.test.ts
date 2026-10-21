import { describe, expect, it } from 'vitest';
import type { Company } from '@/db/types';
import {
  BUILT_IN_UNITS,
  findUnit,
  listedUnit,
  matchUnit,
  unitChoices,
  unitName,
  unitText,
} from './units';

const company = (customUnits: NonNullable<Company['items']>['customUnits']) =>
  ({ items: { units: true, customUnits } }) as Pick<Company, 'items'>;

describe('units', () => {
  it('read pieces however they were typed, in English or Arabic', () => {
    for (const text of ['pc', 'pcs', 'PCS', 'Pcs.', ' piece ', 'قطعة', 'قطعه', 'قطع', 'pcs']) {
      expect(matchUnit(text)).toBe('pcs');
    }
    expect(matchUnit('box')).toBe('box');
    expect(matchUnit('علبة')).toBe('box');
    expect(matchUnit('Ctn')).toBe('carton');
    expect(matchUnit('hrs')).toBe('hour');
    expect(matchUnit('ساعات')).toBe('hour');
    expect(matchUnit('Ltr')).toBe('l');
  });

  it('leave a unit they don’t know as it was typed', () => {
    expect(matchUnit('roll')).toBeNull();
    expect(matchUnit('')).toBeNull();
    expect(matchUnit(undefined)).toBeNull();
  });

  it('match the company’s own units first, and never an archived one', () => {
    const own = company([
      { id: 'u-roll', name: 'roll', nameAr: 'لفة' },
      { id: 'u-old', name: 'bag', nameAr: 'كيس', archived: true },
    ]);
    expect(matchUnit('Roll', own)).toBe('u-roll');
    expect(matchUnit('لفه', own)).toBe('u-roll');
    expect(matchUnit('bag', own)).toBeNull();
    expect(unitChoices(own).map((u) => u.id)).toEqual([
      ...BUILT_IN_UNITS.map((u) => u.id),
      'u-roll',
    ]);
    // A line that has an archived unit still finds it.
    expect(findUnit(own, 'u-old')?.nameAr).toBe('كيس');
    expect(findUnit(own, 'nothing')).toBeNull();
  });

  it('are named in Arabic on Arabic and bilingual documents', () => {
    const box = findUnit(null, 'box')!;
    expect(unitName(box, 'ar')).toBe('علبة');
    expect(unitName(box, 'ar-en')).toBe('علبة');
    expect(unitName(box, 'en')).toBe('box');
    expect(unitName({ id: 'u', name: 'roll', nameAr: '' }, 'ar')).toBe('roll');
  });

  it('have ids of their own', () => {
    const ids = BUILT_IN_UNITS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    // No alias stands for two units.
    for (const unit of BUILT_IN_UNITS) {
      for (const alias of [unit.name, unit.nameAr, ...unit.aliases]) {
        expect(matchUnit(alias), alias).toBe(unit.id);
      }
    }
  });

  it('print in Arabic only while the text is still the unit picked', () => {
    expect(unitText(null, { unit: 'box', unitId: 'box' }, 'ar')).toBe('علبة');
    expect(unitText(null, { unit: 'Boxes', unitId: 'box' }, 'ar-en')).toBe('علبة');
    expect(unitText(null, { unit: 'box', unitId: 'box' }, 'en')).toBe('box');
    // An older version typed another unit over it and kept the id.
    expect(listedUnit(null, { unit: 'carton', unitId: 'box' })).toBeNull();
    expect(unitText(null, { unit: 'carton', unitId: 'box' }, 'ar')).toBe('carton');
    expect(unitText(null, { unit: 'pcs' }, 'ar')).toBe('pcs');
  });

  it('store and print a company unit given only an Arabic name by that name', () => {
    const own = company([{ id: 'u-bag', name: '', nameAr: ' كيس ' }]);
    const bag = findUnit(own, 'u-bag')!;
    // What the unit picker stores on the item: never an empty unit.
    expect(bag.name).toBe('كيس');
    expect(unitChoices(own).find((u) => u.id === 'u-bag')?.name).toBe('كيس');
    const item = { unit: bag.name, unitId: bag.id };
    expect(unitText(own, item, 'ar')).toBe('كيس');
    expect(unitText(own, item, 'ar-en')).toBe('كيس');
    expect(unitText(own, item, 'en')).toBe('كيس');
    expect(listedUnit(own, item)?.id).toBe('u-bag');
    expect(matchUnit('كيس', own)).toBe('u-bag');
  });
});
