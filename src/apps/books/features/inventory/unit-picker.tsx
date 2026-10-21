import { useMemo } from 'react';
import type { Company, ID } from '@/db/types';
import { BUILT_IN_UNITS, findUnit, matchUnit, unitChoices } from '@/lib/units';
import { t } from '@/i18n';
import { localName } from '@/i18n/names';
import { Combobox, type ComboOption } from '@/components/ui/combobox';

/** The value of a unit typed by hand, which is in no list. */
const TYPED = '\u0000typed';

/**
 * Picks an item's unit from the list (built-in and the company's own), in
 * the app's language with the other name beside it. A unit that isn't in
 * the list can still be typed; one an older item had stays until changed.
 */
export function UnitPicker({
  id,
  company,
  unit,
  unitId,
  onChange,
}: {
  id?: string;
  company: Company;
  /** The unit as printed. */
  unit: string;
  unitId: ID | undefined;
  onChange: (next: { unit: string; unitId: ID | undefined }) => void;
}) {
  const options = useMemo(() => {
    const aliases = new Map(BUILT_IN_UNITS.map((u) => [u.id, u.aliases.join(' ')]));
    const list = unitChoices(company);
    // An archived unit the item still has.
    const current = findUnit(company, unitId);
    if (current && !list.some((u) => u.id === current.id)) list.push(current);
    const choices: ComboOption[] = [
      { value: '', label: t('None') },
      ...list.map((u) => {
        const label = localName(u);
        const other = label === u.name ? u.nameAr : u.name;
        return {
          value: u.id,
          label,
          detail: other && other !== label ? other : undefined,
          keywords: `${u.name} ${u.nameAr} ${aliases.get(u.id) ?? ''}`,
        };
      }),
    ];
    if (unit.trim() && !current) {
      choices.push({ value: TYPED, label: unit.trim(), detail: t('Typed by hand') });
    }
    return choices;
  }, [company, unit, unitId]);

  const value = findUnit(company, unitId) ? unitId! : unit.trim() ? TYPED : null;

  return (
    <Combobox
      id={id}
      value={value}
      options={options}
      placeholder={t('Choose a unit…')}
      searchPlaceholder={t('Search units…')}
      onChange={(next) => {
        if (next === TYPED) return;
        const found = findUnit(company, next);
        onChange(found ? { unit: found.name, unitId: found.id } : { unit: '', unitId: undefined });
      }}
      createLabel={t('Use')}
      onCreate={(text) => {
        if (!text) return;
        // Typed as one of the list's units: that unit.
        const found = findUnit(company, matchUnit(text, company));
        onChange(
          found ? { unit: found.name, unitId: found.id } : { unit: text, unitId: undefined },
        );
      }}
    />
  );
}
