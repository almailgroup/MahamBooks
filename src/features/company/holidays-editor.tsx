import { useState } from 'react';
import { CalendarDays, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { CompanyHoliday } from '@/db/types';
import { useFormat } from '@/app/company';
import { formatHijri } from '@/lib/kuwait';
import { isISODate, parseISODate, today } from '@/lib/dates';
import { currentLanguage, t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Badge, Segmented } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { companyHolidays, hasOwnHolidays, replaceYear } from './holidays';

interface Editing {
  /** Position in the year's list, or null for a new holiday. */
  index: number | null;
  holiday: CompanyHoliday;
}

function HolidayDialog({
  editing,
  year,
  onSave,
  onClose,
}: {
  editing: Editing;
  year: number;
  onSave: (holiday: CompanyHoliday) => void;
  onClose: () => void;
}) {
  const [holiday, setHoliday] = useState(editing.holiday);
  const [submitted, setSubmitted] = useState(false);
  const dateProblem = !isISODate(holiday.date)
    ? t('Enter a date.')
    : !holiday.date.startsWith(`${year}-`)
      ? t('Choose a date in {year}.', { year })
      : null;
  const nameMissing = !holiday.name.trim() && !holiday.nameAr.trim();

  const save = () => {
    setSubmitted(true);
    if (dateProblem || nameMissing) return;
    onSave({
      date: holiday.date,
      name: holiday.name.trim() || holiday.nameAr.trim(),
      nameAr: holiday.nameAr.trim() || holiday.name.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={editing.index === null ? t('Add a holiday') : t('Edit holiday')}
        size="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogBody>
            <Field label={t('Date')} error={submitted ? dateProblem : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={holiday.date}
                  min={`${year}-01-01`}
                  max={`${year}-12-31`}
                  onChange={(e) => setHoliday({ ...holiday, date: e.target.value })}
                  aria-invalid={submitted && dateProblem !== null}
                />
              )}
            </Field>
            <Field
              label={t('Name in English')}
              error={submitted && nameMissing ? t('Enter a name.') : undefined}
            >
              {(id) => (
                <Input
                  id={id}
                  value={holiday.name}
                  dir="ltr"
                  lang="en"
                  onChange={(e) => setHoliday({ ...holiday, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('Name in Arabic')}>
              {(id) => (
                <Input
                  id={id}
                  value={holiday.nameAr}
                  dir="rtl"
                  lang="ar"
                  onChange={(e) => setHoliday({ ...holiday, nameAr: e.target.value })}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit">{t('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Public holidays of this year and next. Starts from the official estimates;
 * any change stores that year's list on the company.
 */
export function HolidaysEditor({
  holidays,
  onChange,
}: {
  holidays: CompanyHoliday[] | undefined;
  onChange: (holidays: CompanyHoliday[] | undefined) => void;
}) {
  const fmt = useFormat();
  const confirm = useConfirm();
  const language = currentLanguage();
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState<Editing | null>(null);
  const list = companyHolidays({ holidays }, year);
  const changed = hasOwnHolidays({ holidays }, year);
  const weekday = new Intl.DateTimeFormat(fmt.locale, { weekday: 'long' });

  const setList = (next: CompanyHoliday[]) => onChange(replaceYear(holidays, year, next));

  const reset = async () => {
    const ok = await confirm({
      title: t('Use the official estimates for {year}?', { year }),
      description: t('Your changes to the holidays of {year} are removed.', { year }),
      confirmLabel: t('Reset'),
    });
    if (ok) onChange(replaceYear(holidays, year, []));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={String(year)}
          onChange={(v) => setYear(Number(v))}
          options={[thisYear, thisYear + 1].map((y) => ({
            value: String(y),
            label: String(y),
          }))}
        />
        <div className="flex flex-wrap gap-2">
          {changed ? (
            <Button variant="ghost" size="sm" onClick={() => void reset()}>
              <RotateCcw /> {t('Reset to official estimates')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setEditing({
                index: null,
                holiday: { date: `${year}-01-01`, name: '', nameAr: '' },
              })
            }
          >
            <Plus /> {t('Add holiday')}
          </Button>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        {changed ? (
          <Badge tone="blue">{t('Changed by you')}</Badge>
        ) : (
          <Badge tone="gray">{t('Official estimate')}</Badge>
        )}
        {t('Islamic holidays can move by a day after the moon sighting.')}
      </p>

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          {t('No public holidays for {year}.', { year })}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.map((h, index) => (
            <li key={`${h.date}-${index}`} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <span className="bg-primary-50 text-primary-600 hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex">
                <CalendarDays className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {language === 'ar' ? h.nameAr || h.name : h.name || h.nameAr}
                </p>
                <p className="text-xs text-slate-500">
                  <span className="tabular">{fmt.date(h.date)}</span>
                  {' · '}
                  {weekday.format(parseISODate(h.date))}
                  <span className="hidden sm:inline">
                    {' · '}
                    {formatHijri(h.date, language)}
                  </span>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('Edit {name}', { name: language === 'ar' ? h.nameAr : h.name })}
                onClick={() => setEditing({ index, holiday: h })}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('Remove {name}', { name: language === 'ar' ? h.nameAr : h.name })}
                // A year with no holidays at all would fall back to the estimates.
                disabled={list.length === 1}
                onClick={() => setList(list.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <HolidayDialog
          editing={editing}
          year={year}
          onClose={() => setEditing(null)}
          onSave={(holiday) => {
            setList(
              editing.index === null
                ? [...list, holiday]
                : list.map((h, i) => (i === editing.index ? holiday : h)),
            );
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
