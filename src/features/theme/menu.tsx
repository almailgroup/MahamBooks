import { useState } from 'react';
import { Link } from 'react-router';
import * as Popover from '@radix-ui/react-popover';
import { ArrowRight, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';
import { chooseTheme, DARK_THEMES, LIGHT_THEMES, type ThemeId } from '@/lib/themes';
import { THEME_NAMES } from './names';
import { ThemeSwatches } from './picker';
import { useTheme } from './provider';

/**
 * The palette button in the header (and the phone menu): every theme as a
 * swatch, light and dark, the one on screen marked. Choosing applies at once.
 */
export function ThemeMenu({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const { preference, theme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const following = preference.mode === 'system';
  const choose = (id: ThemeId) => setPreference(chooseTheme(preference, id));
  const row = (label: string, ids: readonly ThemeId[]) => (
    <div>
      <p className="mb-1 px-1 text-xs font-medium text-slate-500">{label}</p>
      <ThemeSwatches
        label={label}
        ids={ids}
        checked={ids.includes(theme.id) ? theme.id : null}
        onChoose={choose}
      />
    </div>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Theme')}
          title={t('Theme')}
          className={className}
        >
          <Palette />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={t('Theme')}
          className="data-[state=open]:animate-fade-in bg-surface z-50 w-max max-w-[calc(100vw-1.5rem)] rounded-2xl p-3 shadow-xl ring-1 ring-slate-900/5"
        >
          <div className="mb-2 flex items-baseline justify-between gap-4 px-1">
            <p className="text-sm font-semibold text-slate-900">{t('Theme')}</p>
            <p className="truncate text-xs text-slate-500">{t(THEME_NAMES[theme.id])}</p>
          </div>
          <div className="space-y-2">
            {row(t('Light themes'), LIGHT_THEMES)}
            {row(t('Dark themes'), DARK_THEMES)}
          </div>
          <div className="mt-3 space-y-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <Switch
              label={t('Match my device')}
              checked={following}
              onChange={(on) =>
                setPreference({ ...preference, mode: on ? 'system' : theme.scheme })
              }
            />
          </div>
          <Link
            to="/settings/appearance"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className={cn(
              'text-primary-700 mt-2 flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-sm font-medium hover:underline pointer-coarse:min-h-11',
            )}
          >
            {t('All appearance settings')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
