import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCompany, useFormat } from '@/app/company';
import { addDaysISO, isISODate, parseISODate, today as todayIso } from '@/lib/dates';
import {
  addMonthsISO,
  dateOrder,
  endOfMonth,
  fieldPlaceholder,
  formatFieldDate,
  isCompleteDateText,
  monthGrid,
  parseFieldDate,
} from '@/lib/date-input';
import { KUWAIT_WEEKEND } from '@/lib/kuwait';
import { currentLanguage, t, tp } from '@/i18n';

const control =
  'h-9 w-full rounded-lg border border-slate-300 bg-white ps-3 pe-10 text-sm pointer-coarse:h-11 pointer-coarse:text-base text-slate-900 shadow-xs transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-3 focus:ring-primary-500/15 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 aria-invalid:border-red-400 aria-invalid:ring-red-500/15';

export interface DateFieldProps {
  id?: string;
  /** yyyy-MM-dd, or empty. */
  value: string | null | undefined;
  /** Gets yyyy-MM-dd, or '' when the field is cleared. */
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  /** A required date can't be cleared; clearing it puts the date back. */
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  name?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
}

/**
 * A date in the company's format (31/12/2026 for Kuwait) that can be typed
 * ("3/10", "3 Oct", "+7", "today") or picked from a calendar with quick
 * picks. Month names follow the interface language. Stores yyyy-MM-dd.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  placeholder,
  className,
  name,
  autoFocus,
  ...aria
}: DateFieldProps) {
  const company = useCompany();
  const fmt = useFormat();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const order = dateOrder(company.dateFormat, fmt.locale);
  const valid = value && isISODate(value) ? value : '';
  const shown = draft ?? formatFieldDate(valid, company.dateFormat, fmt.locale);

  const commit = (next: string) => {
    if (next !== valid) onChange(next);
  };

  const settle = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (!text) {
      if (!required) commit('');
    } else {
      const parsed = parseFieldDate(text, { order, today: todayIso() });
      if (parsed) commit(parsed);
    }
    setDraft(null);
  };

  const step = (days: number) => {
    const base = parseFieldDate(draft ?? '', { order, today: todayIso() }) || valid || todayIso();
    setDraft(null);
    commit(addDaysISO(base, days));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') settle();
    else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === 'ArrowUp' && !e.altKey) {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Escape' && draft !== null) {
      e.stopPropagation();
      setDraft(null);
    }
  };

  const outOfRange = Boolean(valid && ((min && valid < min) || (max && valid > max)));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn('relative w-full', className)}>
          <input
            ref={inputRef}
            id={id}
            name={name}
            type="text"
            autoComplete="off"
            autoFocus={autoFocus}
            disabled={disabled}
            required={required}
            value={shown}
            placeholder={placeholder ?? fieldPlaceholder(company.dateFormat, fmt.locale)}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              // A full date is used at once; anything shorter when leaving the field.
              if (isCompleteDateText(text)) {
                const parsed = parseFieldDate(text, { order, today: todayIso() });
                if (parsed) commit(parsed);
              }
            }}
            onBlur={settle}
            onKeyDown={onKeyDown}
            className={control}
            {...aria}
            aria-invalid={aria['aria-invalid'] ?? (outOfRange || undefined)}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('Choose a date')}
              className="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-lg text-slate-500 hover:text-slate-700 disabled:opacity-50 pointer-coarse:w-11"
            >
              <CalendarDays className="size-4" aria-hidden />
            </button>
          </Popover.Trigger>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            // Start on the chosen day (or today), ready for the arrow keys.
            e.preventDefault();
            const content = e.currentTarget as HTMLElement;
            requestAnimationFrame(() =>
              content.querySelector<HTMLButtonElement>('[data-day][tabindex="0"]')?.focus(),
            );
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="data-[state=open]:animate-fade-in z-50 w-[19rem] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <Calendar
            value={valid}
            min={min}
            max={max}
            locale={fmt.locale}
            onSelect={(iso) => {
              setDraft(null);
              commit(iso);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Calendar({
  value,
  min,
  max,
  locale,
  onSelect,
}: {
  value: string;
  min?: string;
  max?: string;
  locale: string;
  onSelect: (iso: string) => void;
}) {
  const now = todayIso();
  const [month, setMonth] = useState(() => (value || now).slice(0, 7));
  const [focused, setFocused] = useState(value || now);
  const gridRef = useRef<HTMLDivElement>(null);
  const days = monthGrid(`${month}-01`);
  // One day of the shown month takes the Tab stop.
  const tabbable = focused.slice(0, 7) === month ? focused : `${month}-01`;
  const rtl = currentLanguage() === 'ar';

  const formats = useMemo(
    () => ({
      title: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: rtl ? 'narrow' : 'short' }),
      full: new Intl.DateTimeFormat(locale, { dateStyle: 'full' }),
    }),
    [locale, rtl],
  );

  const disabled = (iso: string) => Boolean((min && iso < min) || (max && iso > max));
  const moveTo = (iso: string) => {
    setFocused(iso);
    setMonth(iso.slice(0, 7));
    // Focus follows once the new day is drawn.
    requestAnimationFrame(() =>
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)?.focus(),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const forward = rtl ? -1 : 1;
    const moves: Record<string, () => string> = {
      ArrowRight: () => addDaysISO(tabbable, forward),
      ArrowLeft: () => addDaysISO(tabbable, -forward),
      ArrowDown: () => addDaysISO(tabbable, 7),
      ArrowUp: () => addDaysISO(tabbable, -7),
      PageDown: () => addMonthsISO(tabbable, e.shiftKey ? 12 : 1),
      PageUp: () => addMonthsISO(tabbable, e.shiftKey ? -12 : -1),
      Home: () => addDaysISO(tabbable, -parseISODate(tabbable).getDay()),
      End: () => addDaysISO(tabbable, 6 - parseISODate(tabbable).getDay()),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      moveTo(move());
    }
  };

  const picks: { label: string; date: string }[] = [
    { label: t('Today'), date: now },
    { label: tp(7, 'In {count} day', 'In {count} days'), date: addDaysISO(now, 7) },
    { label: tp(30, 'In {count} day', 'In {count} days'), date: addDaysISO(now, 30) },
    { label: t('End of month'), date: endOfMonth(now) },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 pb-2">
        <button
          type="button"
          onClick={() => setMonth(addMonthsISO(`${month}-01`, -1).slice(0, 7))}
          aria-label={t('Previous month')}
          className="flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 pointer-coarse:size-10"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <p className="text-sm font-semibold text-slate-900" aria-live="polite">
          {formats.title.format(parseISODate(`${month}-01`))}
        </p>
        <button
          type="button"
          onClick={() => setMonth(addMonthsISO(`${month}-01`, 1).slice(0, 7))}
          aria-label={t('Next month')}
          className="flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 pointer-coarse:size-10"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <div ref={gridRef} role="grid" onKeyDown={onKeyDown} className="text-center">
        <div role="row" className="grid grid-cols-7">
          {days.slice(0, 7).map((d) => (
            <span
              key={d}
              role="columnheader"
              className="py-1 text-xs font-medium text-slate-500"
              aria-label={new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(
                parseISODate(d),
              )}
            >
              {formats.weekday.format(parseISODate(d))}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div role="row" key={week} className="grid grid-cols-7 gap-y-0.5">
            {days.slice(week * 7, week * 7 + 7).map((d) => {
              const inMonth = d.slice(0, 7) === month;
              const selected = d === value;
              const weekend = KUWAIT_WEEKEND.includes(parseISODate(d).getDay());
              const off = disabled(d);
              return (
                <span role="gridcell" key={d} aria-selected={selected}>
                  <button
                    type="button"
                    data-day={d}
                    tabIndex={d === tabbable ? 0 : -1}
                    disabled={off}
                    onClick={() => onSelect(d)}
                    aria-label={formats.full.format(parseISODate(d))}
                    aria-current={d === now ? 'date' : undefined}
                    className={cn(
                      'tabular mx-auto flex size-9 items-center justify-center rounded-full text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                      selected
                        ? 'bg-primary-600 font-semibold text-white'
                        : d === now
                          ? 'text-primary-700 ring-primary-300 font-semibold ring-1 ring-inset hover:bg-slate-100'
                          : inMonth
                            ? cn(
                                'hover:bg-slate-100',
                                weekend ? 'text-slate-500' : 'text-slate-800',
                              )
                            : 'text-slate-500 hover:bg-slate-50',
                    )}
                  >
                    {Number(d.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-3">
        {picks.map((pick) => (
          <button
            key={pick.label}
            type="button"
            disabled={disabled(pick.date)}
            onClick={() => onSelect(pick.date)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 pointer-coarse:py-2.5"
          >
            {pick.label}
          </button>
        ))}
      </div>
    </div>
  );
}
