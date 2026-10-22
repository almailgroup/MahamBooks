import type { ApprovalRequest, Employee, EmployeeLetter, ID } from '@/db/types';
import { useFormat } from '@/app/company';
import { letterKindLabel, letterStatusLabel, letterTriggerNote } from '@/lib/hr/letters';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import { Badge } from '@/components/ui/misc';
import { letterStatusTone } from './letter-dialog';

/**
 * Letters in a list (People → Letters, an employee's Letters tab): the
 * number once issued, who it is for, the kind and where it stands. A row
 * opens the letter; with `selected`, rows can be ticked to print together.
 */
export function LettersTable({
  letters,
  employees,
  pending,
  onOpen,
  showEmployee = true,
  selected,
  onSelect,
}: {
  letters: EmployeeLetter[];
  employees: Map<ID, Employee>;
  pending: Map<ID, ApprovalRequest>;
  onOpen: (letter: EmployeeLetter) => void;
  showEmployee?: boolean;
  selected?: Set<ID>;
  onSelect?: (ids: Set<ID>) => void;
}) {
  const fmt = useFormat();
  const all =
    selected !== undefined && letters.length > 0 && letters.every((l) => selected.has(l.id));
  const toggle = (id: ID) => {
    if (!selected || !onSelect) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs text-slate-500">
            {selected ? (
              <th className="w-10 px-5 py-2 text-start font-medium">
                <input
                  type="checkbox"
                  className="accent-primary-600 size-4"
                  checked={all}
                  aria-label={t('Select all')}
                  onChange={() => onSelect?.(all ? new Set() : new Set(letters.map((l) => l.id)))}
                />
              </th>
            ) : null}
            <th className="px-5 py-2 text-start font-medium">{t('Number')}</th>
            {showEmployee ? (
              <th className="px-3 py-2 text-start font-medium">{t('Employee')}</th>
            ) : null}
            <th className="px-3 py-2 text-start font-medium">{t('Letter')}</th>
            <th className="px-3 py-2 text-start font-medium">{t('Date')}</th>
            <th className="px-5 py-2 text-end font-medium">{t('Status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {letters.map((letter) => {
            const employee = employees.get(letter.employeeId);
            const request = pending.get(letter.id);
            return (
              <tr key={letter.id} className="hover:bg-slate-50">
                {selected ? (
                  <td className="px-5 py-2.5">
                    <input
                      type="checkbox"
                      className="accent-primary-600 size-4"
                      checked={selected.has(letter.id)}
                      aria-label={t('Select {name}', {
                        name: letter.number || t(letterKindLabel(letter.kind)),
                      })}
                      onChange={() => toggle(letter.id)}
                    />
                  </td>
                ) : null}
                <td className="px-5 py-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onOpen(letter)}
                    className="text-primary-700 font-medium hover:underline"
                    dir="ltr"
                  >
                    {letter.number || t('Draft')}
                  </button>
                </td>
                {showEmployee ? (
                  <td className="px-3 py-2.5">
                    <span dir="auto" className="block text-slate-900">
                      {employee ? localName(employee) : t('An employee no longer here')}
                    </span>
                    {employee ? (
                      <span className="text-xs text-slate-500">{employee.number}</span>
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onOpen(letter)}
                    className="text-start text-slate-800 hover:underline"
                  >
                    {t(letterKindLabel(letter.kind))}
                  </button>
                  {letter.trigger && letter.status === 'draft' ? (
                    <span className="block text-xs text-slate-500">
                      {t(letterTriggerNote(letter.trigger))}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                  {fmt.date(letter.issuedOn ?? letter.createdAt.slice(0, 10))}
                </td>
                <td className="px-5 py-2.5 text-end">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {request ? (
                      <Badge tone="amber">{t('Waiting for approval')}</Badge>
                    ) : (
                      <Badge tone={letterStatusTone(letter.status)}>
                        {t(letterStatusLabel(letter.status))}
                      </Badge>
                    )}
                    {letter.status === 'issued' && !letter.printedAt ? (
                      <Badge tone="violet">{t('To print')}</Badge>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
