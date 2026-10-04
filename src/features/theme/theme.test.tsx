import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setDictionaryForTests } from '@/i18n';
import { LanguageProvider } from '@/i18n/provider';
import { LIGHT_THEMES, THEME_STORAGE_KEY, type ThemeId } from '@/lib/themes';
import { ThemeCards } from './picker';
import { ThemeProvider, useTheme } from './provider';

afterEach(cleanup);

describe('ThemeCards', () => {
  afterEach(() => setDictionaryForTests('en', {}));

  function renderCards(checked: ThemeId | null) {
    const onChoose = vi.fn();
    render(
      <LanguageProvider>
        <ThemeCards label="Light themes" ids={LIGHT_THEMES} checked={checked} onChoose={onChoose} />
      </LanguageProvider>,
    );
    return onChoose;
  }

  it('is a radio group with one tab stop, on the checked theme', () => {
    renderCards('sand');
    const group = screen.getByRole('radiogroup', { name: 'Light themes' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeInTheDocument();
    expect(radios).toHaveLength(10);
    expect(screen.getByRole('radio', { name: 'Desert sand' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Desert sand' }).tabIndex).toBe(0);
  });

  it('starts at the first theme when none in the group is chosen', () => {
    renderCards(null);
    expect(screen.getByRole('radio', { name: 'Classic' }).tabIndex).toBe(0);
  });

  it('chooses with arrow keys, wrapping around, and with Home and End', () => {
    const onChoose = renderCards('classic');
    const classic = screen.getByRole('radio', { name: 'Classic' });
    classic.focus();
    fireEvent.keyDown(classic, { key: 'ArrowRight' });
    expect(onChoose).toHaveBeenLastCalledWith('gulf');
    expect(screen.getByRole('radio', { name: 'Gulf blue' })).toHaveFocus();
    fireEvent.keyDown(classic, { key: 'ArrowLeft' });
    expect(onChoose).toHaveBeenLastCalledWith('graphite');
    fireEvent.keyDown(classic, { key: 'End' });
    expect(onChoose).toHaveBeenLastCalledWith('graphite');
    fireEvent.keyDown(classic, { key: 'Home' });
    expect(onChoose).toHaveBeenLastCalledWith('classic');
    fireEvent.click(screen.getByRole('radio', { name: 'Lavender' }));
    expect(onChoose).toHaveBeenLastCalledWith('lavender');
  });

  it('follows the reading direction in Arabic', () => {
    setDictionaryForTests('ar', { Classic: 'كلاسيكي', 'Gulf blue': 'أزرق الخليج' });
    const onChoose = renderCards('classic');
    const classic = screen.getByRole('radio', { name: 'كلاسيكي' });
    fireEvent.keyDown(classic, { key: 'ArrowLeft' });
    expect(onChoose).toHaveBeenLastCalledWith('gulf');
    expect(screen.getByRole('radio', { name: 'أزرق الخليج' })).toHaveFocus();
  });
});

describe('ThemeProvider', () => {
  let dark = false;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  beforeEach(() => {
    localStorage.clear();
    document.getElementById('theme')?.remove();
    dark = false;
    listeners.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      get matches() {
        return dark;
      },
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  function Probe() {
    const { theme, preference, setPreference } = useTheme();
    return (
      <div>
        <p data-testid="theme">{theme.id}</p>
        <button onClick={() => setPreference({ ...preference, mode: 'dark', dark: 'ember' })}>
          ember
        </button>
      </div>
    );
  }

  it('applies the saved theme and saves a new choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'black');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('black');
    expect(document.documentElement.dataset.theme).toBe('black');
    expect(document.getElementById('theme')?.textContent).toContain('color-scheme:dark');
    fireEvent.click(screen.getByRole('button', { name: 'ember' }));
    expect(document.documentElement.dataset.theme).toBe('ember');
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      mode: 'dark',
      light: 'classic',
      dark: 'ember',
    });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content');
  });

  it('follows the device live when matching it', () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ mode: 'system', light: 'sand', dark: 'desert-night' }),
    );
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('sand');
    act(() => {
      dark = true;
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('desert-night');
    expect(document.documentElement.dataset.theme).toBe('desert-night');
  });

  it('shows Classic, with no stylesheet of its own, for a bad saved value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{"mode":"dark","dark":"sunshine"');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('classic');
    expect(document.getElementById('theme')?.textContent).toBe('');
  });
});
