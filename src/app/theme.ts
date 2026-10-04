/**
 * Applies the interface theme to the page: one `<style id="theme">` with the
 * theme's colour variables (screen only, so printing stays on white paper),
 * `data-theme` on `<html>` and the browser's toolbar colour. The choice is
 * kept per device in localStorage, like the interface language.
 *
 * `index.html` paints the saved theme's background before the app loads,
 * and `main.tsx` calls `applyTheme` before the first render, so the page
 * never flashes in the wrong theme.
 */
import {
  activeThemeId,
  DEFAULT_PREFERENCE,
  parseThemePreference,
  resolveTheme,
  serializeThemePreference,
  THEME_STORAGE_KEY,
  themeCss,
  type ThemeId,
  type ThemePreference,
} from '@/lib/themes';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function storedThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked (private windows).
    return DEFAULT_PREFERENCE;
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, serializeThemePreference(preference));
  } catch {
    // Not saved; the theme still applies to this visit.
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY)
    : null;
}

/** Whether the device is set to dark. */
export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/** Calls `onChange` when the device switches between light and dark. */
export function watchSystemScheme(onChange: (dark: boolean) => void): () => void {
  const query = darkQuery();
  if (!query) return () => {};
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Shows a theme on this page. */
export function applyTheme(id: ThemeId): void {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme(id);
  const root = document.documentElement;
  let style = document.getElementById('theme') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'theme';
    document.head.appendChild(style);
  }
  const css = themeCss(id);
  if (style.textContent !== css) style.textContent = css;
  root.dataset.theme = id;
  root.dataset.scheme = theme.scheme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme.themeColor;
}

/** Applies the saved theme; called once before the app renders. */
export function applyStoredTheme(): ThemeId {
  const id = activeThemeId(storedThemePreference(), systemPrefersDark());
  applyTheme(id);
  return id;
}
