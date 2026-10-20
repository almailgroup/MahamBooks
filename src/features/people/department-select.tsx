import { useState } from 'react';
import type { Department } from '@/db/types';
import { departmentChoices, findDepartment } from '@/lib/hr/departments';
import { Input, Select } from '@/components/ui/form';
import { useLanguage } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';

/** The "Other…" choice: a name typed instead. */
const OTHER = '\u0000other';

/**
 * A department from the company's list (its English name is kept), or a
 * name typed with "Other…". A name that isn't in the list is shown as typed.
 */
export function DepartmentSelect({
  id,
  value,
  list,
  onChange,
}: {
  id: string;
  value: string;
  list: readonly Department[];
  onChange: (department: string) => void;
}) {
  const { language } = useLanguage();
  const choices = departmentChoices(list, language);
  const listed = findDepartment(list, value);
  const current = listed && listed.name === value.trim() ? listed : undefined;
  const [typing, setTyping] = useState(() => Boolean(value.trim()) && !current);
  return (
    <div className="space-y-2">
      <Select
        id={id}
        value={typing ? OTHER : (current?.name ?? '')}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(e.target.value);
        }}
      >
        <option value="">{t('No department')}</option>
        {current?.archived ? (
          <option value={current.name}>{localName(current, language)}</option>
        ) : null}
        {choices.map((d) => (
          <option key={d.id} value={d.name}>
            {localName(d, language)}
          </option>
        ))}
        <option value={OTHER}>{t('Other…')}</option>
      </Select>
      {typing ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            // A department of the list, typed in English or Arabic, is that department.
            const found = findDepartment(list, value);
            if (found && !found.archived) {
              onChange(found.name);
              setTyping(false);
            }
          }}
          aria-label={t('Department name')}
          placeholder={t('Department name')}
          dir="auto"
        />
      ) : null}
    </div>
  );
}
