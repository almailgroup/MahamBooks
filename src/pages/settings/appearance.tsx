import { Switch } from '@/components/ui/form';
import { t } from '@/i18n';
import {
  chooseDeviceTheme,
  chooseTheme,
  DARK_THEMES,
  LIGHT_THEMES,
  type ThemeId,
  type ThemeScheme,
} from '@/lib/themes';
import { THEME_NAMES } from '@/features/theme/names';
import { ThemeCards } from '@/features/theme/picker';
import { useTheme } from '@/features/theme/provider';
import { SettingsSection } from './shared';

export default function AppearanceSettings() {
  const { preference, theme, setPreference } = useTheme();
  const following = preference.mode === 'system';
  const choose = (id: ThemeId) =>
    setPreference(following ? chooseDeviceTheme(preference, id) : chooseTheme(preference, id));
  // Following the device, each group has its own choice; otherwise one theme is chosen.
  const checked = (scheme: ThemeScheme) =>
    following ? preference[scheme] : theme.scheme === scheme ? theme.id : null;

  return (
    <SettingsSection
      id="appearance"
      title={t('Appearance')}
      description={t(
        'Choose how Maham One looks on this device. Documents always print on white paper.',
      )}
    >
      <Switch
        label={t('Match my device')}
        description={
          following
            ? t('Showing {theme}. Pick one light and one dark theme below.', {
                theme: t(THEME_NAMES[theme.id]),
              })
            : t('Use a light theme by day and a dark one when this device is set to dark.')
        }
        checked={following}
        onChange={(on) => setPreference({ ...preference, mode: on ? 'system' : theme.scheme })}
      />
      <ThemeGroup
        title={t('Light themes')}
        hint={following ? t('When your device is light') : undefined}
        ids={LIGHT_THEMES}
        checked={checked('light')}
        onChoose={choose}
      />
      <ThemeGroup
        title={t('Dark themes')}
        hint={following ? t('When your device is dark') : undefined}
        ids={DARK_THEMES}
        checked={checked('dark')}
        onChoose={choose}
      />
    </SettingsSection>
  );
}

function ThemeGroup({
  title,
  hint,
  ids,
  checked,
  onChoose,
}: {
  title: string;
  hint?: string;
  ids: readonly ThemeId[];
  checked: ThemeId | null;
  onChoose: (id: ThemeId) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
      </div>
      <ThemeCards label={title} ids={ids} checked={checked} onChoose={onChoose} />
    </section>
  );
}
