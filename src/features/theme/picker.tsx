import { useRef, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { useLanguage } from '@/i18n/provider';
import { resolveTheme, type ThemeId } from '@/lib/themes';
import { THEME_NAMES } from './names';

/** A colour of a theme by role (`slate-900`, `surface`…), for drawing previews. */
function color(id: ThemeId, name: string): string {
  return resolveTheme(id).vars[`--color-${name}`];
}

/**
 * Arrow keys move between the radios of a group and choose as they go
 * (Home and End too), following the reading direction; Tab leaves the group.
 */
function useRadioKeys(onChoose: (id: ThemeId) => void) {
  const { dir } = useLanguage();
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const radios = [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
    const index = radios.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next: number;
    if (event.key === forward || event.key === 'ArrowDown') next = (index + 1) % radios.length;
    else if (event.key === backward || event.key === 'ArrowUp')
      next = (index - 1 + radios.length) % radios.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = radios.length - 1;
    else return;
    event.preventDefault();
    radios[next].focus();
    onChoose(radios[next].dataset.value as ThemeId);
  };
  return { group, onKeyDown };
}

/** The radio that takes focus when tabbing into a group: the checked one, else the first. */
function tabStop(ids: readonly ThemeId[], checked: ThemeId | null, id: ThemeId): 0 | -1 {
  return (checked && ids.includes(checked) ? checked : ids[0]) === id ? 0 : -1;
}

/**
 * A miniature of the app in a theme's colours: the tinted backdrop with the
 * menu, the page panel with two lines of text, a button and two status chips.
 */
export function ThemePreview({ id, className }: { id: ThemeId; className?: string }) {
  const c = (name: string) => color(id, name);
  return (
    <span
      aria-hidden
      className={cn('flex aspect-[16/10] gap-1.5 overflow-hidden rounded-lg p-1.5', className)}
      style={{ backgroundColor: c('shell') }}
    >
      <span className="flex w-[24%] flex-col gap-1 pt-0.5">
        <span className="h-2.5 rounded-[3px]" style={{ backgroundColor: c('surface') }}>
          <span
            className="ms-1 mt-[3px] block h-1 w-3/5 rounded-full"
            style={{ backgroundColor: c('primary-700') }}
          />
        </span>
        {[70, 85, 60, 75].map((width) => (
          <span
            key={width}
            className="ms-1 h-1 rounded-full"
            style={{ width: `${width}%`, backgroundColor: c('slate-300') }}
          />
        ))}
      </span>
      <span
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-md p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
        style={{ backgroundColor: c('surface') }}
      >
        <span className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: c('slate-900') }} />
        <span className="h-1 w-4/5 rounded-full" style={{ backgroundColor: c('slate-400') }} />
        <span className="mt-auto flex items-center gap-1">
          <span className="h-3 w-7 rounded-[3px]" style={{ backgroundColor: c('primary-solid') }} />
          <span
            className="ms-auto flex h-2.5 w-5 items-center justify-center rounded-full"
            style={{ backgroundColor: c('emerald-50') }}
          >
            <span className="h-1 w-3 rounded-full" style={{ backgroundColor: c('emerald-700') }} />
          </span>
          <span
            className="flex h-2.5 w-5 items-center justify-center rounded-full"
            style={{ backgroundColor: c('red-50') }}
          >
            <span className="h-1 w-3 rounded-full" style={{ backgroundColor: c('red-700') }} />
          </span>
        </span>
      </span>
    </span>
  );
}

/** Settings → Appearance: one group of themes as cards, a radio group. */
export function ThemeCards({
  label,
  ids,
  checked,
  onChoose,
}: {
  /** Names the group for screen readers, e.g. "Light themes". */
  label: string;
  ids: readonly ThemeId[];
  /** The chosen theme in this group, if any. */
  checked: ThemeId | null;
  onChoose: (id: ThemeId) => void;
}) {
  const { group, onKeyDown } = useRadioKeys(onChoose);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
    >
      {ids.map((id) => {
        const on = id === checked;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={id}
            tabIndex={tabStop(ids, checked, id)}
            onClick={() => onChoose(id)}
            className={cn(
              'bg-surface flex flex-col rounded-xl p-1.5 text-start transition-shadow',
              on
                ? 'ring-primary-600 ring-2'
                : 'ring-1 ring-slate-200 hover:ring-2 hover:ring-slate-300',
            )}
          >
            <ThemePreview id={id} className="ring-1 ring-slate-900/5" />
            <span className="flex min-h-9 items-center justify-between gap-2 px-1.5 pt-1.5 text-sm font-medium text-slate-900">
              {t(THEME_NAMES[id])}
              {on ? (
                <span className="bg-primary-solid text-on-primary flex size-5 shrink-0 items-center justify-center rounded-full">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A round swatch: the theme's backdrop with its accent in the middle. */
export function ThemeSwatch({ id, checked }: { id: ThemeId; checked?: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-7 items-center justify-center rounded-full ring-1 ring-slate-900/15"
      style={{ backgroundColor: color(id, 'shell') }}
    >
      <span
        className="flex size-4 items-center justify-center rounded-full"
        style={{ backgroundColor: color(id, 'primary-solid'), color: color(id, 'on-primary') }}
      >
        {checked ? <Check className="size-3" strokeWidth={3.5} /> : null}
      </span>
    </span>
  );
}

/** The header's quick switch: one row of round swatches, a radio group. */
export function ThemeSwatches({
  label,
  ids,
  checked,
  onChoose,
}: {
  label: string;
  ids: readonly ThemeId[];
  checked: ThemeId | null;
  onChoose: (id: ThemeId) => void;
}) {
  const { group, onKeyDown } = useRadioKeys(onChoose);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="grid grid-cols-5 gap-1 sm:flex sm:gap-0.5"
    >
      {ids.map((id) => {
        const on = id === checked;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t(THEME_NAMES[id])}
            title={t(THEME_NAMES[id])}
            data-value={id}
            tabIndex={tabStop(ids, checked, id)}
            onClick={() => onChoose(id)}
            className={cn(
              'flex size-9 items-center justify-center rounded-full transition-shadow pointer-coarse:size-11',
              on ? 'ring-primary-600 ring-2' : 'hover:ring-2 hover:ring-slate-300',
            )}
          >
            <ThemeSwatch id={id} checked={on} />
          </button>
        );
      })}
    </div>
  );
}
