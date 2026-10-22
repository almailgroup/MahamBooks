import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import { contrast, over, parseColor, toHex } from './oklch';
import {
  activeThemeId,
  bootThemes,
  chooseDeviceTheme,
  chooseTheme,
  DARK_THEMES,
  DEFAULT_PREFERENCE,
  isLightTheme,
  LIGHT_THEMES,
  parseThemePreference,
  resolveTheme,
  serializeThemePreference,
  STATUS_PALETTES,
  STEPS,
  themeCss,
  allThemes,
  type ThemePreference,
} from './themes';
import { APP_TONES } from '@/suite/switcher';

const ROOT = join(__dirname, '..', '..');
const THEMES = allThemes();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'pdf' ? [] : sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Every colour variable the app's classes and styles read: `bg-slate-50`,
 * `hover:bg-primary-solid-hover`, `var(--color-chart-1)`… The PDF code
 * draws documents on white paper with its own colours.
 */
function colourVariablesInUse(): Set<string> {
  const utility =
    '(?:bg|text|border(?:-[xytrblse])?|ring-offset|ring|fill|stroke|divide|outline|shadow|accent|from|via|to|placeholder|decoration|caret)';
  const name =
    '(?:[a-z]+-(?:50|[1-9]00|950)|surface|page|shell|overlay|on-primary|primary-solid(?:-hover|-active)?|red-solid(?:-hover)?|chart-[a-z0-9]+|aging-\\d)';
  const classes = new RegExp(`(?<![\\w-])${utility}-(${name})(?![\\w-])`, 'g');
  const vars = /var\(--color-([a-z0-9-]+)\)/g;
  const found = new Set<string>();
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(classes)) found.add(m[1]);
    for (const m of text.matchAll(vars)) found.add(m[1]);
  }
  // Fixed colours are never themed.
  for (const fixed of ['white', 'black']) found.delete(fixed);
  return found;
}

describe('themes', () => {
  it('are ten light and ten dark, with unique ids', () => {
    expect(LIGHT_THEMES).toHaveLength(10);
    expect(DARK_THEMES).toHaveLength(10);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(20);
    for (const id of LIGHT_THEMES) expect(resolveTheme(id).scheme).toBe('light');
    for (const id of DARK_THEMES) expect(resolveTheme(id).scheme).toBe('dark');
  });

  it('each resolve every colour variable the app uses', () => {
    const used = colourVariablesInUse();
    // A sanity check that the scan finds the app's classes.
    expect(used).toContain('slate-500');
    expect(used).toContain('primary-solid-hover');
    expect(used).toContain('chart-grid');
    for (const theme of THEMES) {
      const missing = [...used].filter((name) => !theme.vars[`--color-${name}`]);
      expect(missing, theme.id).toEqual([]);
    }
  });

  it('write values a browser reads, never a variable they set themselves', () => {
    for (const theme of THEMES) {
      for (const [name, value] of Object.entries(theme.vars)) {
        expect(value, `${theme.id} ${name}`).not.toContain('var(');
        if (name.startsWith('--color-')) expect(() => parseColor(value)).not.toThrow();
      }
    }
  });

  it('look different from each other', () => {
    const accents = THEMES.map((theme) => toHex(theme.vars['--color-primary-solid']));
    const shells = THEMES.map((theme) => toHex(theme.vars['--color-shell']));
    const looks = new Set(THEMES.map((_, i) => `${accents[i]} ${shells[i]}`));
    expect(looks.size).toBe(20);
  });
});

describe('Classic', () => {
  const classic = resolveTheme('classic');
  const v = classic.vars;

  it('is exactly today’s colours', () => {
    for (const step of STEPS) {
      expect(v[`--color-primary-${step}`]).toBe(colors.indigo[step]);
      expect(v[`--color-slate-${step}`]).toBe(colors.slate[step]);
      for (const name of STATUS_PALETTES)
        expect(v[`--color-${name}-${step}`]).toBe(colors[name][step]);
    }
    expect(v['--color-surface']).toBe('#ffffff');
    expect(v['--color-shell']).toBe('#eff1f6');
    expect(v['--color-page']).toBe(colors.slate[50]);
    expect(v['--color-overlay']).toBe(colors.slate[900]);
    expect(v['--color-primary-solid']).toBe(colors.indigo[600]);
    expect(v['--color-primary-solid-hover']).toBe(colors.indigo[700]);
    expect(v['--color-primary-solid-active']).toBe(colors.indigo[800]);
    expect(v['--color-on-primary']).toBe('#ffffff');
    expect(v['--color-red-solid']).toBe(colors.red[600]);
    expect(v['--color-red-solid-hover']).toBe(colors.red[700]);
    expect([1, 2, 3, 4, 5].map((i) => v[`--color-aging-${i}`])).toEqual(
      [400, 500, 700, 900, 950].map((step) => colors.indigo[step as 400]),
    );
    expect(classic.themeColor).toBe('#4f46e5');
  });

  it('matches the defaults in index.css, so it needs no stylesheet of its own', () => {
    expect(themeCss('classic')).toBe('');
    const css = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
    const declared = Object.fromEntries(
      [...css.matchAll(/^\s*(--color-[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
    );
    const resolve = (value: string): string => {
      const ref = /^var\(--color-([a-z]+)-(\d+)\)$/.exec(value);
      if (!ref) return toHex(value);
      return ref[1] === 'primary'
        ? toHex(colors.indigo[Number(ref[2]) as 600])
        : toHex((colors[ref[1] as 'slate'] as Record<number, string>)[Number(ref[2])]);
    };
    const tokens = Object.keys(declared).filter((name) => name in v);
    expect(tokens.length).toBeGreaterThan(25);
    for (const name of tokens) expect(resolve(declared[name]), name).toBe(toHex(v[name]));
    expect(css).toContain(`--scrollbar-thumb: ${v['--scrollbar-thumb']};`);
  });
});

describe('contrast in every theme', () => {
  const ratio = (theme: (typeof THEMES)[number], fg: string, bg: string) =>
    contrast(theme.vars[`--color-${fg}`], theme.vars[`--color-${bg}`]);

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s', (id, theme) => {
    const v = theme.vars;
    const check = (fg: string, bg: string, min: number) =>
      expect(ratio(theme, fg, bg), `${id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    // Body text, muted text and secondary text where they sit.
    check('slate-900', 'surface', 7);
    check('slate-500', 'surface', 4.5);
    check('slate-500', 'page', 4.5);
    check('slate-500', 'slate-50', 4.5);
    check('slate-600', 'shell', 4.5);
    check('slate-700', 'shell', 4.5);
    if (id === 'classic') {
      // Today's colours, kept as they were: no muted text sits on the backdrop.
      expect(ratio(theme, 'slate-500', 'shell')).toBeCloseTo(4.22, 2);
    } else {
      check('slate-500', 'shell', 4.5);
    }
    // Buttons, links and accent text.
    check('on-primary', 'primary-solid', 4.5);
    check('on-primary', 'primary-solid-hover', 4.5);
    check('on-primary', 'primary-solid-active', 4.5);
    expect(contrast('#ffffff', v['--color-red-solid'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', v['--color-red-solid-hover'])).toBeGreaterThanOrEqual(4.5);
    check('primary-700', 'surface', 4.5);
    check('primary-700', 'primary-50', 4.5);
    check('primary-700', 'shell', 4.5);
    check('primary-600', 'surface', 4.5);
    // Status text and badges.
    check('red-700', 'surface', 4.5);
    check('red-600', 'surface', 4.5);
    check('emerald-700', 'surface', 4.5);
    check('amber-700', 'surface', 4.5);
    check('red-700', 'red-50', 4.5);
    check('emerald-700', 'emerald-50', 4.5);
    check('amber-800', 'amber-50', 4.5);
    check('blue-700', 'blue-50', 4.5);
    check('violet-700', 'violet-50', 4.5);
    check('slate-700', 'slate-100', 4.5);
    // Status icons.
    check('emerald-600', 'surface', 3);
    check('amber-600', 'surface', 3);
    // Borders stand out from the surface.
    check('slate-200', 'surface', 1.2);
    // The header is translucent over the page.
    const header = over(v['--color-surface'], 0.85, v['--color-page']);
    expect(contrast(v['--color-slate-900'], header)).toBeGreaterThanOrEqual(7);
  });
});

describe('the apps’ colours in every theme', () => {
  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s', (id, theme) => {
    // Sales (violet) and Inventory (teal) of the split layout too.
    expect(Object.keys(APP_TONES)).toEqual(['indigo', 'emerald', 'sky', 'amber', 'violet', 'teal']);
    for (const [tone, classes] of Object.entries(APP_TONES)) {
      const [, bg] = /\bbg-([a-z]+-\d+)\b/.exec(classes)!;
      const [, fg] = /\btext-([a-z]+-\d+)\b/.exec(classes)!;
      const ratio = contrast(theme.vars[`--color-${fg}`], theme.vars[`--color-${bg}`]);
      expect(ratio, `${id}: ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('charts in every theme', () => {
  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s', (id, theme) => {
    const v = theme.vars;
    const surface = v['--color-surface'];
    // Categorical slots 1 and 2 of the dataviz palette, in the step for the surface.
    expect([v['--color-chart-1'], v['--color-chart-2']]).toEqual(
      theme.scheme === 'light' ? ['#2a78d6', '#eb6834'] : ['#3987e5', '#d95926'],
    );
    for (const series of [v['--color-chart-1'], v['--color-chart-2']]) {
      expect(contrast(series, surface), `${id} ${series}`).toBeGreaterThanOrEqual(3);
    }
    // The ordinal ramp for unpaid invoices by age (the dataviz ordinal checks).
    const ramp = [1, 2, 3, 4, 5].map((i) => v[`--color-aging-${i}`]);
    const light = ramp.map((c) => parseColor(c).l);
    const steps = light.slice(1).map((l, i) => l - light[i]);
    const direction = theme.scheme === 'light' ? -1 : 1;
    for (const step of steps) expect(step * direction, id).toBeGreaterThanOrEqual(0.06);
    expect(contrast(ramp[0], surface), id).toBeGreaterThanOrEqual(2);
    const hues = ramp.map((c) => parseColor(c).h);
    let spread = Math.max(...hues) - Math.min(...hues);
    if (spread > 180) spread = 360 - spread;
    expect(spread, id).toBeLessThanOrEqual(40);
    // Gridlines are visible but quiet; the axis is a step stronger.
    const grid = contrast(v['--color-chart-grid'], surface);
    expect(grid).toBeGreaterThan(1.05);
    expect(contrast(v['--color-chart-axis'], surface)).toBeGreaterThan(grid);
  });
});

describe('themeCss', () => {
  it('only applies on screen, so printing stays on white paper', () => {
    const css = themeCss('midnight');
    expect(css).toContain('@media screen{:root{color-scheme:dark;');
    expect(css.indexOf('--color-surface')).toBeGreaterThan(css.indexOf('@media screen'));
    expect(css).not.toContain('@media print');
  });

  it('keeps paper previews in Classic, text colour included', () => {
    const css = themeCss('black');
    expect(css).toContain(`.paper{color-scheme:light;`);
    expect(css).toContain(`--color-slate-900:${colors.slate[900]}`);
    expect(css).toContain('@layer base{.paper{color:var(--color-slate-900)}}');
    expect(css.startsWith('@layer properties,theme,base,components,utilities;')).toBe(true);
  });
});

describe('the theme preference', () => {
  const pref = (p: Partial<ThemePreference>): ThemePreference => ({ ...DEFAULT_PREFERENCE, ...p });

  it('falls back to Classic for missing or bad values', () => {
    for (const raw of [null, undefined, '', 'nope', '{', '[]', '42', 'null', '{"mode":5}']) {
      expect(parseThemePreference(raw), String(raw)).toEqual(DEFAULT_PREFERENCE);
    }
    expect(DEFAULT_PREFERENCE).toEqual({ mode: 'light', light: 'classic', dark: 'midnight' });
  });

  it('reads what it writes', () => {
    const saved = pref({ mode: 'system', light: 'sand', dark: 'ember' });
    expect(parseThemePreference(serializeThemePreference(saved))).toEqual(saved);
  });

  it('accepts a bare theme id', () => {
    expect(parseThemePreference('black')).toEqual(pref({ mode: 'dark', dark: 'black' }));
    expect(parseThemePreference('rose')).toEqual(pref({ mode: 'light', light: 'rose' }));
  });

  it('keeps each choice in its own scheme', () => {
    expect(parseThemePreference('{"mode":"dark","light":"midnight","dark":"sand"}')).toEqual(
      pref({ mode: 'dark' }),
    );
    expect(parseThemePreference('{"mode":"sideways","light":"gulf"}')).toEqual(
      pref({ light: 'gulf' }),
    );
  });

  it('shows the light or dark choice, or follows the device', () => {
    const p = pref({ light: 'sky', dark: 'lagoon' });
    expect(activeThemeId({ ...p, mode: 'light' }, true)).toBe('sky');
    expect(activeThemeId({ ...p, mode: 'dark' }, false)).toBe('lagoon');
    expect(activeThemeId({ ...p, mode: 'system' }, false)).toBe('sky');
    expect(activeThemeId({ ...p, mode: 'system' }, true)).toBe('lagoon');
  });

  it('picks a theme to show, or one for the device to use', () => {
    const p = pref({ mode: 'system', light: 'sky', dark: 'lagoon' });
    expect(chooseTheme(p, 'ember')).toEqual({ mode: 'dark', light: 'sky', dark: 'ember' });
    expect(chooseTheme(p, 'oasis')).toEqual({ mode: 'light', light: 'oasis', dark: 'lagoon' });
    expect(chooseDeviceTheme(p, 'ember')).toEqual({ mode: 'system', light: 'sky', dark: 'ember' });
    expect(chooseDeviceTheme(p, 'oasis')).toEqual({
      mode: 'system',
      light: 'oasis',
      dark: 'lagoon',
    });
    expect(isLightTheme('graphite')).toBe(true);
    expect(isLightTheme('charcoal')).toBe(false);
  });
});

describe('the boot script in index.html', () => {
  it('paints the same colours as the themes', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const literal = /var themes = (\{[\s\S]*?\});/.exec(html)?.[1];
    expect(literal, 'var themes = {…}; in index.html').toBeTruthy();
    const painted = new Function(`return ${literal};`)() as unknown;
    // When this fails after changing a theme, paste the expected value into index.html.
    expect(painted).toEqual(bootThemes());
  });
});
