import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  activeThemeId,
  DEFAULT_PREFERENCE,
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from '@/lib/themes';
import {
  applyTheme,
  saveThemePreference,
  storedThemePreference,
  systemPrefersDark,
  watchSystemScheme,
} from '@/app/theme';

interface ThemeContextValue {
  preference: ThemePreference;
  /** The theme on screen now. */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: DEFAULT_PREFERENCE,
  theme: resolveTheme('classic'),
  setPreference: () => {},
});

/**
 * Holds the theme preference for this device. Choosing applies at once;
 * "Match my device" follows the system's light or dark setting live, and
 * other tabs of the app pick up a change too.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setState] = useState<ThemePreference>(storedThemePreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const id = activeThemeId(preference, systemDark);

  // Before the browser paints, so a choice never shows in the old colours.
  useLayoutEffect(() => applyTheme(id), [id]);

  useEffect(() => watchSystemScheme(setSystemDark), []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setState(parseThemePreference(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    saveThemePreference(next);
    setState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, theme: resolveTheme(id), setPreference }),
    [preference, id, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
