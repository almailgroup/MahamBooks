/**
 * Colour maths for the interface themes. Tailwind's palettes are written in
 * OKLCH (`oklch(55.4% 0.046 257.417)`); this converts them to sRGB for WCAG
 * contrast checks, mixes colours in OKLab and writes them back as CSS.
 *
 * Colours outside sRGB (some saturated Tailwind shades) are clipped to it,
 * which is what a browser shows on an ordinary screen.
 */

export interface Oklch {
  /** Lightness, 0–1. */
  l: number;
  /** Chroma, 0–~0.4. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

type Vector = [number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function hexToSrgb(hex: string): Vector | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vector;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function linearSrgbToOklab([r, g, b]: Vector): Vector {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearSrgb([L, a, b]: Vector): Vector {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function lchToLab({ l, c, h }: Oklch): Vector {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

function labToLch([l, a, b]: Vector): Oklch {
  const c = Math.hypot(a, b);
  const h = c < 1e-6 ? 0 : ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
  return { l, c, h };
}

const OKLCH =
  /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+|none)\s+([\d.]+|none)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)$/i;

/**
 * Reads `oklch(L% C H)`, `oklch(L C H)` (a hue or chroma may be `none`, as in
 * Tailwind's greys) or a hex colour. Throws on anything else.
 */
export function parseColor(input: string): Oklch {
  const text = input.trim();
  const match = OKLCH.exec(text);
  if (match) {
    const l = Number(match[1]) / (match[2] ? 100 : 1);
    const num = (v: string) => (v === 'none' ? 0 : Number(v));
    return { l, c: num(match[3]), h: num(match[4]) };
  }
  const rgb = hexToSrgb(text);
  if (rgb) return labToLch(linearSrgbToOklab(rgb.map(toLinear) as Vector));
  throw new Error(`Not a colour: ${input}`);
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Writes a colour the way Tailwind does: `oklch(55.4% 0.046 257.417)`. */
export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${round(l * 100, 2)}% ${round(c, 4)} ${round(c < 1e-4 ? 0 : h, 3)})`;
}

/** sRGB channels 0–1, clipped to the sRGB gamut. */
export function toSrgb(color: string): Vector {
  const hex = hexToSrgb(color);
  if (hex) return hex;
  const linear = oklabToLinearSrgb(lchToLab(parseColor(color)));
  return linear.map((v) => clamp01(toGamma(clamp01(v)))) as Vector;
}

export function toHex(color: string): string {
  return `#${toSrgb(color)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** WCAG relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = toSrgb(color).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Mixes two colours in OKLab: `amount` 0 gives `a`, 1 gives `b`. Hue and
 * chroma blend smoothly, without the grey middle of an sRGB mix.
 */
export function mix(a: string, b: string, amount: number): string {
  const [l1, a1, b1] = lchToLab(parseColor(a));
  const [l2, a2, b2] = lchToLab(parseColor(b));
  const t = clamp01(amount);
  return formatOklch(labToLch([l1 + (l2 - l1) * t, a1 + (a2 - a1) * t, b1 + (b2 - b1) * t]));
}

/** The same colour with some of its OKLCH parts replaced. */
export function adjust(color: string, change: Partial<Oklch>): string {
  return formatOklch({ ...parseColor(color), ...change });
}

/**
 * What a translucent colour looks like over an opaque one (`bg-x/40` on a
 * panel). Browsers blend in gamma-encoded sRGB; so does this.
 */
export function over(color: string, alpha: number, background: string): string {
  const fg = toSrgb(color);
  const bg = toSrgb(background);
  const a = clamp01(alpha);
  return `#${fg
    .map((v, i) =>
      Math.round((bg[i] + (v - bg[i]) * a) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
