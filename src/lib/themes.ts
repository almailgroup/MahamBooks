/**
 * Interface themes. The app is styled with Tailwind utilities that read CSS
 * colour variables (`bg-slate-50` → `var(--color-slate-50)`), so a theme is a
 * set of values for those variables: the accent (`primary-*`), the greys
 * (`slate-*`, the only grey palette the app uses), the status palettes and a
 * few role colours (`surface`, `shell`, `page`…). Classic is today's look
 * and sets nothing: the defaults in `src/index.css` are Classic.
 *
 * Dark themes keep what each shade means: text shades become light, tints
 * become dark (`red-50` → a deep red), and the solid fills behind white text
 * (`primary-solid`, `red-solid`) stay saturated.
 *
 * Pure functions only (no DOM, no translations), so tests and scripts can
 * use them; `src/app/theme.ts` applies a theme to the page.
 */
import colors from 'tailwindcss/colors';
import { adjust, contrast, formatOklch, mix, parseColor, toHex } from './oklch';

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Step = (typeof STEPS)[number];
export type Ramp = Record<Step, string>;

/**
 * Palettes besides `slate` and `primary` that the app uses for status,
 * charts and the apps' colours (teal: Maham Inventory).
 */
export const STATUS_PALETTES = [
  'red',
  'amber',
  'emerald',
  'blue',
  'violet',
  'indigo',
  'sky',
  'teal',
] as const;

type PaletteName =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'mauve'
  | 'taupe'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'pink'
  | 'rose';

function palette(name: PaletteName): Ramp {
  return colors[name] as Ramp;
}

export const LIGHT_THEMES = [
  'classic',
  'gulf',
  'sky',
  'turquoise',
  'oasis',
  'sand',
  'sunset',
  'rose',
  'lavender',
  'graphite',
] as const;

export const DARK_THEMES = [
  'midnight',
  'deep-sea',
  'lagoon',
  'oasis-night',
  'desert-night',
  'ember',
  'rose-night',
  'amethyst',
  'charcoal',
  'black',
] as const;

export type LightThemeId = (typeof LIGHT_THEMES)[number];
export type DarkThemeId = (typeof DARK_THEMES)[number];
export type ThemeId = LightThemeId | DarkThemeId;
export type ThemeScheme = 'light' | 'dark';

export const DEFAULT_LIGHT: LightThemeId = 'classic';
export const DEFAULT_DARK: DarkThemeId = 'midnight';

/* -------------------------------------------------------------------------- */
/* Recipes                                                                    */
/* -------------------------------------------------------------------------- */

interface LightRecipe {
  scheme: 'light';
  /** The accent: buttons, links, the selected page. */
  accent: PaletteName;
  /** Where the pale tints (50–200) come from, when not the accent. */
  tints?: PaletteName;
  /**
   * Accents too bright for white text (teal, yellow…) move one shade darker,
   * so `primary-600` (buttons) and `primary-700` (links) stay readable.
   */
  shift?: boolean;
  /** The greys. */
  neutral: PaletteName;
  /** Hue and chroma of the tinted backdrop behind the sidebar and the page. */
  shell: { h: number; c: number };
  /** An explicit accent ramp (monochrome themes). */
  ramp?: Ramp;
}

interface DarkRecipe {
  scheme: 'dark';
  /** The accent; its light shades become text and its deep shades tints. */
  accent: PaletteName;
  /** The palette and shade behind white text on buttons. */
  solid: [PaletteName, Step];
  /** The greys whose light end becomes the text. */
  neutral: PaletteName;
  /** Hue and chroma of the dark surfaces (the page panel, cards, the backdrop). */
  tint: { h: number; c: number };
  /** Lightness (OKLCH L) of the page panel and cards. */
  surface: number;
  /** An explicit accent ramp, already for a dark background (monochrome themes). */
  ramp?: Ramp;
  /** Text on accent buttons, when the buttons are light (monochrome themes). */
  onSolid?: string;
  /** Black: brighter greys and borders. */
  highContrast?: boolean;
}

type Recipe = LightRecipe | DarkRecipe;

const zinc = palette('zinc');
const neutral = palette('neutral');

const RECIPES: Record<ThemeId, Recipe> = {
  // Today's look; resolveLight returns today's values for it.
  classic: {
    scheme: 'light',
    accent: 'indigo',
    neutral: 'slate',
    shell: { h: 268.5, c: 0.0072 },
  },
  gulf: {
    scheme: 'light',
    accent: 'blue',
    neutral: 'slate',
    shell: { h: 255, c: 0.013 },
  },
  sky: {
    scheme: 'light',
    accent: 'sky',
    shift: true,
    neutral: 'slate',
    shell: { h: 232, c: 0.015 },
  },
  turquoise: {
    scheme: 'light',
    accent: 'teal',
    shift: true,
    neutral: 'slate',
    shell: { h: 195, c: 0.013 },
  },
  oasis: {
    scheme: 'light',
    accent: 'green',
    tints: 'emerald',
    shift: true,
    neutral: 'gray',
    shell: { h: 160, c: 0.013 },
  },
  sand: {
    scheme: 'light',
    accent: 'yellow',
    tints: 'amber',
    shift: true,
    neutral: 'stone',
    shell: { h: 80, c: 0.017 },
  },
  sunset: {
    scheme: 'light',
    accent: 'orange',
    shift: true,
    neutral: 'taupe',
    shell: { h: 45, c: 0.015 },
  },
  rose: {
    scheme: 'light',
    accent: 'pink',
    shift: true,
    neutral: 'zinc',
    shell: { h: 355, c: 0.011 },
  },
  lavender: {
    scheme: 'light',
    accent: 'violet',
    neutral: 'mauve',
    shell: { h: 305, c: 0.013 },
  },
  graphite: {
    scheme: 'light',
    accent: 'zinc',
    neutral: 'zinc',
    shell: { h: 286, c: 0.004 },
    ramp: {
      50: zinc[100],
      100: zinc[200],
      200: zinc[300],
      300: zinc[400],
      400: zinc[500],
      500: zinc[600],
      600: zinc[900],
      700: zinc[800],
      800: zinc[900],
      900: zinc[950],
      950: zinc[950],
    },
  },
  midnight: {
    scheme: 'dark',
    accent: 'indigo',
    solid: ['indigo', 600],
    neutral: 'slate',
    tint: { h: 268, c: 0.03 },
    surface: 0.225,
  },
  'deep-sea': {
    scheme: 'dark',
    accent: 'sky',
    solid: ['blue', 600],
    neutral: 'slate',
    tint: { h: 250, c: 0.045 },
    surface: 0.23,
  },
  lagoon: {
    scheme: 'dark',
    accent: 'teal',
    solid: ['teal', 700],
    neutral: 'slate',
    tint: { h: 205, c: 0.028 },
    surface: 0.225,
  },
  'oasis-night': {
    scheme: 'dark',
    accent: 'green',
    solid: ['green', 700],
    neutral: 'zinc',
    tint: { h: 160, c: 0.012 },
    surface: 0.22,
  },
  'desert-night': {
    scheme: 'dark',
    accent: 'amber',
    solid: ['yellow', 700],
    neutral: 'stone',
    tint: { h: 70, c: 0.012 },
    surface: 0.225,
  },
  ember: {
    scheme: 'dark',
    accent: 'orange',
    solid: ['orange', 700],
    neutral: 'neutral',
    tint: { h: 40, c: 0.008 },
    surface: 0.215,
  },
  'rose-night': {
    scheme: 'dark',
    accent: 'pink',
    solid: ['pink', 700],
    neutral: 'zinc',
    tint: { h: 355, c: 0.012 },
    surface: 0.22,
  },
  amethyst: {
    scheme: 'dark',
    accent: 'violet',
    solid: ['violet', 600],
    neutral: 'mauve',
    tint: { h: 300, c: 0.028 },
    surface: 0.225,
  },
  charcoal: {
    scheme: 'dark',
    accent: 'neutral',
    solid: ['neutral', 200],
    neutral: 'neutral',
    tint: { h: 0, c: 0 },
    surface: 0.22,
    ramp: {
      50: neutral[800],
      100: neutral[700],
      200: neutral[600],
      300: neutral[500],
      400: neutral[400],
      500: neutral[300],
      600: neutral[200],
      700: neutral[100],
      800: neutral[50],
      900: neutral[50],
      950: '#ffffff',
    },
    onSolid: neutral[900],
  },
  black: {
    scheme: 'dark',
    accent: 'sky',
    solid: ['sky', 700],
    neutral: 'neutral',
    tint: { h: 0, c: 0 },
    surface: 0.13,
    highContrast: true,
  },
};

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/** CSS custom properties, `--color-slate-50` → value. */
export type ThemeVars = Record<string, string>;

export interface Theme {
  id: ThemeId;
  scheme: ThemeScheme;
  vars: ThemeVars;
  /** `<meta name="theme-color">`: the browser's toolbar on phones. */
  themeColor: string;
}

const MIRROR: Record<Step, Step> = {
  50: 950,
  100: 900,
  200: 800,
  300: 700,
  400: 600,
  500: 500,
  600: 400,
  700: 300,
  800: 200,
  900: 100,
  950: 50,
};

function rampVars(name: string, ramp: Ramp): ThemeVars {
  return Object.fromEntries(STEPS.map((s) => [`--color-${name}-${s}`, ramp[s]]));
}

const darker = (color: string, by: number) => adjust(color, { l: parseColor(color).l - by });

/** The light accent ramp: tints from `tints`, one shade darker for bright accents. */
function lightRamp(recipe: LightRecipe): Ramp {
  if (recipe.ramp) return recipe.ramp;
  const a = palette(recipe.accent);
  const t = palette(recipe.tints ?? recipe.accent);
  if (!recipe.shift) return { ...a, 50: t[50], 100: t[100], 200: t[200] };
  return {
    50: t[50],
    100: t[100],
    200: t[200],
    300: a[400],
    400: a[500],
    500: a[600],
    600: a[700],
    700: a[800],
    800: a[900],
    900: a[950],
    950: darker(a[950], 0.08),
  };
}

const mirror = (ramp: Ramp): Ramp =>
  Object.fromEntries(STEPS.map((s) => [s, ramp[MIRROR[s]]])) as Ramp;

/**
 * The colour with its OKLCH lightness moved towards `target` (0 darker,
 * 1 lighter) just enough to reach `ratio` against `background`; as far as it
 * goes when it never does.
 */
function shiftTo(color: string, background: string, ratio: number, target: 0 | 1): string {
  const c = parseColor(color);
  const at = (l: number) => formatOklch({ ...c, l });
  if (contrast(color, background) >= ratio) return color;
  if (contrast(at(target), background) < ratio) return at(target);
  let [near, far] = [c.l, target as number];
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (contrast(at(mid), background) >= ratio) far = mid;
    else near = mid;
  }
  return at(far);
}

/** Darkens `color` until it has `ratio` against `background`. */
const darkenTo = (color: string, background: string, ratio: number) =>
  shiftTo(color, background, ratio, 0);

/** Lightens `color` until it has `ratio` against `background`. */
const lightenTo = (color: string, background: string, ratio: number) =>
  shiftTo(color, background, ratio, 1);

// The chart colours are the validated categorical slots 1 and 2 of the
// dataviz palette, with its own steps for dark surfaces.
const CHART_LIGHT = { series1: '#2a78d6', series2: '#eb6834' };
const CHART_DARK = { series1: '#3987e5', series2: '#d95926' };

// Classic's chart chrome: exactly today's values (see `src/index.css`).
const CHART_CHROME_LIGHT = {
  '--color-chart-grid': '#ecebe8',
  '--color-chart-axis': '#d6d4cf',
  '--color-chart-hover': '#f5f5f3',
};

/** Classic's ramp for unpaid invoices by age, as it was before themes. */
const CLASSIC_AGING: Step[] = [400, 500, 700, 900, 950];

/** How far apart the hues of a set of colours are, in degrees. */
function hueSpread(shades: string[]): number {
  const hues = shades.map((c) => parseColor(c).h);
  const spread = Math.max(...hues) - Math.min(...hues);
  return spread > 180 ? 360 - spread : spread;
}

/**
 * Five shades of one hue for an ordered scale (unpaid invoices by age),
 * picked from `candidates`, which run from the end nearest the surface
 * outwards. As the dataviz ordinal checks ask: the nearest shade keeps 2.2:1
 * against the surface, the hues stay within 40°, and neighbours differ in
 * lightness (OKLCH L) by at least 0.065, as evenly as the candidates allow.
 */
export function ordinalRamp(candidates: string[], surface: string): string[] {
  const light = candidates.map((c) => parseColor(c).l);
  const visible = candidates.map((c) => contrast(c, surface) >= 2.2);
  const n = candidates.length;
  let best: number[] = [];
  let bestGap = -1;
  const pick = (chosen: number[], from: number) => {
    if (chosen.length === 5) {
      if (!visible[chosen[0]]) return;
      const gap = Math.min(...chosen.slice(1).map((p, i) => Math.abs(light[p] - light[chosen[i]])));
      if (gap < 0.065 || gap <= bestGap) return;
      if (hueSpread(chosen.map((i) => candidates[i])) > 40) return;
      bestGap = gap;
      best = chosen;
      return;
    }
    for (let i = from; i < n; i++) pick([...chosen, i], i + 1);
  };
  pick([], 0);
  if (!best.length) throw new Error(`No ordered ramp fits ${candidates.join(' ')}`);
  return best.map((i) => candidates[i]);
}

function agingVars(shades: string[]): ThemeVars {
  return Object.fromEntries(shades.map((c, i) => [`--color-aging-${i + 1}`, c]));
}

function resolveLight(recipe: LightRecipe, id: ThemeId): ThemeVars {
  const primary = lightRamp(recipe);
  const greys = { ...palette(recipe.neutral) };
  const surface = '#ffffff';
  const classic = id === 'classic';
  // Classic keeps today's backdrop; the others get a hint of their accent.
  const shell = classic
    ? '#eff1f6'
    : formatOklch({ l: 0.958, c: recipe.shell.c, h: recipe.shell.h });
  if (!classic) {
    // Muted text stays readable on the tinted backdrop (Classic: see the tests).
    greys[500] = darkenTo(greys[500], shell, 4.6);
    greys[600] = darkenTo(greys[600], shell, 6);
  }
  const aging = classic
    ? CLASSIC_AGING.map((s) => primary[s])
    : ordinalRamp(
        ([300, 400, 500, 600, 700, 800, 900, 950] as Step[]).map((s) => primary[s]),
        surface,
      );
  // Status colours are the same in every light theme.
  const status = Object.assign({}, ...STATUS_PALETTES.map((name) => rampVars(name, palette(name))));
  return {
    ...rampVars('primary', primary),
    ...rampVars('slate', greys),
    ...status,
    '--color-surface': surface,
    '--color-page': greys[50],
    '--color-shell': shell,
    '--color-overlay': palette(recipe.neutral)[900],
    '--color-primary-solid': primary[600],
    '--color-primary-solid-hover': primary[700],
    '--color-primary-solid-active': primary[800],
    '--color-on-primary': '#ffffff',
    '--color-red-solid': colors.red[600],
    '--color-red-solid-hover': colors.red[700],
    '--color-chart-1': CHART_LIGHT.series1,
    '--color-chart-2': CHART_LIGHT.series2,
    ...CHART_CHROME_LIGHT,
    ...agingVars(aging),
    '--scrollbar-thumb': classic
      ? 'rgb(203 213 225 / 0.55)'
      : `color-mix(in oklab, ${greys[300]} 55%, transparent)`,
  };
}

function resolveDark(recipe: DarkRecipe): ThemeVars {
  const { h, c } = recipe.tint;
  const hc = recipe.highContrast ?? false;
  const at = (l: number) => formatOklch({ l, c, h });
  const s = recipe.surface;
  const n = palette(recipe.neutral);
  // Text shades take the neutral palette's light end, tinted like the surfaces.
  const ink = (step: Step) => {
    const base = parseColor(n[step]);
    return formatOklch({ l: base.l, c: Math.max(base.c, c * 0.5), h: c > 0 ? h : base.h });
  };
  // Each grey keeps its job: 50 a raised hover, 100 a recessed track or
  // divider, 200–300 borders, 400 icons, 500 muted text, 600–900 text.
  const greys: Ramp = hc
    ? {
        50: at(s + 0.06),
        100: at(s + 0.1),
        200: at(0.5),
        300: at(0.6),
        400: at(0.72),
        500: at(0.84),
        600: at(0.92),
        700: at(0.95),
        800: at(0.98),
        900: '#ffffff',
        950: '#ffffff',
      }
    : {
        50: at(s + 0.03),
        100: at(s - 0.045),
        200: at(s + 0.085),
        300: at(s + 0.16),
        400: ink(500),
        500: ink(400),
        600: ink(300),
        700: ink(200),
        800: ink(100),
        900: ink(50),
        950: '#ffffff',
      };
  const surface = at(s);
  const shell = hc ? '#000000' : at(s - 0.07);
  const page = hc ? '#000000' : at(s - 0.04);
  // Muted text keeps AA on every dark background it sits on.
  greys[500] = lightenTo(greys[500], greys[50], hc ? 7 : 4.6);
  greys[400] = lightenTo(greys[400], surface, 3);

  const accent = palette(recipe.accent);
  const primary = { ...(recipe.ramp ?? mirror(accent)) };
  const [solidPalette, solidStep] = recipe.solid;
  const solids = palette(solidPalette);
  // The ordered scale brightens with age on a dark surface.
  const aging = ordinalRamp(
    ([800, 700, 600, 500, 400, 300, 200, 100] as Step[]).map((step) => solids[step]),
    surface,
  );
  // Accent tints (selected rows, subtle buttons) stay calm on a dark surface.
  if (!recipe.ramp) {
    primary[50] = mix(primary[50], surface, 0.3);
    primary[100] = mix(primary[100], surface, 0.15);
  }
  // Links and accent text stay readable on the dark surfaces.
  primary[700] = lightenTo(primary[700], greys[50], hc ? 7 : 4.6);
  primary[600] = lightenTo(primary[600], greys[50], 4.6);

  const step = (by: number) => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(solidStep) + by)];

  const status: ThemeVars = {};
  for (const name of STATUS_PALETTES) {
    const ramp = mirror(palette(name));
    ramp[700] = lightenTo(ramp[700], greys[50], hc ? 7 : 4.6);
    ramp[600] = lightenTo(ramp[600], greys[50], 4.6);
    Object.assign(status, rampVars(name, ramp));
  }

  return {
    ...rampVars('primary', primary),
    ...rampVars('slate', greys),
    ...status,
    '--color-surface': surface,
    '--color-page': page,
    '--color-shell': shell,
    '--color-overlay': '#000000',
    // Pressing darkens the fill, so its text keeps (or gains) contrast.
    '--color-primary-solid': solids[solidStep],
    '--color-primary-solid-hover': solids[step(1)],
    '--color-primary-solid-active': solids[step(2)],
    '--color-on-primary': recipe.onSolid ?? '#ffffff',
    '--color-red-solid': colors.red[600],
    '--color-red-solid-hover': colors.red[700],
    '--color-chart-1': CHART_DARK.series1,
    '--color-chart-2': CHART_DARK.series2,
    '--color-chart-grid': hc ? at(0.3) : mix(surface, greys[300], 0.45),
    '--color-chart-axis': hc ? at(0.45) : greys[300],
    '--color-chart-hover': greys[50],
    ...agingVars(aging),
    '--scrollbar-thumb': `color-mix(in oklab, ${greys[300]} 70%, transparent)`,
  };
}

const cache = new Map<ThemeId, Theme>();

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && Object.hasOwn(RECIPES, value);
}

export function isLightTheme(id: ThemeId): id is LightThemeId {
  return RECIPES[id].scheme === 'light';
}

/** Every colour a theme sets, ready to write into CSS. */
export function resolveTheme(id: ThemeId): Theme {
  const found = cache.get(id);
  if (found) return found;
  const recipe = RECIPES[id];
  const vars = recipe.scheme === 'light' ? resolveLight(recipe, id) : resolveDark(recipe);
  const theme: Theme = {
    id,
    scheme: recipe.scheme,
    vars,
    themeColor:
      id === 'classic'
        ? '#4f46e5'
        : recipe.scheme === 'light'
          ? toHex(vars['--color-primary-solid'])
          : toHex(vars['--color-page']),
  };
  cache.set(id, theme);
  return theme;
}

/**
 * All twenty themes, light then dark. Resolved on first use: at start-up the
 * app only resolves the theme it shows.
 */
export function allThemes(): Theme[] {
  return [...LIGHT_THEMES, ...DARK_THEMES].map((id) => resolveTheme(id));
}

/* -------------------------------------------------------------------------- */
/* CSS                                                                        */
/* -------------------------------------------------------------------------- */

function declarations(vars: ThemeVars): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/**
 * The stylesheet for a theme. It only applies on screen: printing always
 * uses Classic on white paper. Paper previews inside the app (payslips,
 * vouchers, PDF pages) are marked `.paper` and keep Classic too, including
 * the text colour they would otherwise inherit from the page; that one sits
 * in the base layer, so a text colour utility on the paper still wins.
 * Classic itself needs nothing: it is the app's own stylesheet.
 */
export function themeCss(id: ThemeId): string {
  if (id === 'classic') return '';
  const theme = resolveTheme(id);
  const paper = resolveTheme('classic').vars;
  return (
    // This sheet can come before Tailwind's: keep Tailwind's layer order.
    `@layer properties,theme,base,components,utilities;` +
    `@media screen{` +
    `:root{color-scheme:${theme.scheme};${declarations(theme.vars)}}` +
    `.paper{color-scheme:light;${declarations(paper)}}` +
    `@layer base{.paper{color:var(--color-slate-900)}}` +
    `}`
  );
}

/* -------------------------------------------------------------------------- */
/* Preference                                                                 */
/* -------------------------------------------------------------------------- */

export const THEME_STORAGE_KEY = 'almailbooks.theme';

/**
 * Light or dark use the chosen light or dark theme; `system` follows the
 * device's setting. Both choices are kept, so switching between light and
 * dark returns to the theme picked before.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemePreference {
  mode: ThemeMode;
  light: LightThemeId;
  dark: DarkThemeId;
}

export const DEFAULT_PREFERENCE: ThemePreference = {
  mode: 'light',
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
};

/**
 * Reads the saved preference. Accepts the stored JSON or a bare theme id
 * (`"midnight"`); anything else falls back to Classic.
 */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  if (!raw) return DEFAULT_PREFERENCE;
  if (isThemeId(raw)) return chooseTheme(DEFAULT_PREFERENCE, raw);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCE;
  }
  if (typeof data !== 'object' || data === null) return DEFAULT_PREFERENCE;
  const { mode, light, dark } = data as Record<string, unknown>;
  return {
    mode: mode === 'dark' || mode === 'system' ? mode : 'light',
    light: isThemeId(light) && isLightTheme(light) ? light : DEFAULT_LIGHT,
    dark: isThemeId(dark) && !isLightTheme(dark) ? dark : DEFAULT_DARK,
  };
}

export function serializeThemePreference(preference: ThemePreference): string {
  return JSON.stringify(preference);
}

/** The theme a preference shows, given whether the device is set to dark. */
export function activeThemeId(preference: ThemePreference, systemDark: boolean): ThemeId {
  const dark = preference.mode === 'dark' || (preference.mode === 'system' && systemDark);
  return dark ? preference.dark : preference.light;
}

/** Shows a theme: the device's light or dark setting stops deciding. */
export function chooseTheme(preference: ThemePreference, id: ThemeId): ThemePreference {
  return isLightTheme(id)
    ? { ...preference, mode: 'light', light: id }
    : { ...preference, mode: 'dark', dark: id };
}

/** While following the device: the theme to use when it is light, or dark. */
export function chooseDeviceTheme(preference: ThemePreference, id: ThemeId): ThemePreference {
  return isLightTheme(id)
    ? { ...preference, mode: 'system', light: id }
    : { ...preference, mode: 'system', dark: id };
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What `index.html` paints before the app loads, per theme other than
 * Classic: its scheme, page background and toolbar colour. The boot script
 * there holds a copy (a test keeps the two the same).
 */
export function bootThemes(): Record<string, [ThemeScheme, string, string]> {
  return Object.fromEntries(
    allThemes()
      .filter((theme) => theme.id !== 'classic')
      .map((theme) => [
        theme.id,
        [theme.scheme, toHex(theme.vars['--color-page']), theme.themeColor],
      ]),
  );
}
