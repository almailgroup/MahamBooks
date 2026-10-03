import { Font } from '@react-pdf/renderer';

export type FontId =
  | 'inter'
  | 'manrope'
  | 'plexsans'
  | 'jetbrainsmono'
  | 'playfair'
  | 'lora'
  | 'spacegrotesk'
  | 'dmserif'
  | 'plexarabic';

interface FontFile {
  weight: number;
  style: 'normal' | 'italic';
  file: string;
}

export interface FontFamilyDefinition {
  id: FontId;
  /** Name registered with react-pdf. */
  family: string;
  label: string;
  category: 'sans' | 'serif' | 'mono' | 'display';
  files: FontFile[];
}

const files = (prefix: string, weights: number[], italic: number[] = []): FontFile[] => [
  ...weights.map((weight) => ({
    weight,
    style: 'normal' as const,
    file: `${prefix}-${weight}.ttf`,
  })),
  ...italic.map((weight) => ({
    weight,
    style: 'italic' as const,
    file: `${prefix}-${weight}-italic.ttf`,
  })),
];

export const FONT_FAMILIES: Record<FontId, FontFamilyDefinition> = {
  inter: {
    id: 'inter',
    family: 'Inter',
    label: 'Inter',
    category: 'sans',
    files: files('inter', [400, 500, 600, 700, 800], [400]),
  },
  manrope: {
    id: 'manrope',
    family: 'Manrope',
    label: 'Manrope',
    category: 'sans',
    files: files('manrope', [400, 500, 600, 700, 800]),
  },
  plexsans: {
    id: 'plexsans',
    family: 'IBM Plex Sans',
    label: 'IBM Plex Sans',
    category: 'sans',
    files: files('plexsans', [400, 500, 600, 700], [400]),
  },
  jetbrainsmono: {
    id: 'jetbrainsmono',
    family: 'JetBrains Mono',
    label: 'JetBrains Mono',
    category: 'mono',
    files: files('jetbrainsmono', [400, 500, 600]),
  },
  playfair: {
    id: 'playfair',
    family: 'Playfair Display',
    label: 'Playfair Display',
    category: 'display',
    files: files('playfair', [400, 600, 700], [400]),
  },
  lora: {
    id: 'lora',
    family: 'Lora',
    label: 'Lora',
    category: 'serif',
    files: files('lora', [400, 500, 600, 700], [400]),
  },
  spacegrotesk: {
    id: 'spacegrotesk',
    family: 'Space Grotesk',
    label: 'Space Grotesk',
    category: 'sans',
    files: files('spacegrotesk', [400, 500, 600, 700]),
  },
  dmserif: {
    id: 'dmserif',
    family: 'DM Serif Display',
    label: 'DM Serif Display',
    category: 'display',
    files: files('dmserif', [400], [400]),
  },
  plexarabic: {
    id: 'plexarabic',
    family: 'IBM Plex Sans Arabic',
    label: 'IBM Plex Sans Arabic',
    category: 'sans',
    // Arabic has no italics: italic text uses the upright letters.
    files: [400, 500, 600, 700].flatMap((weight) =>
      (['normal', 'italic'] as const).map((style) => ({
        weight,
        style,
        file: `plexarabic-${weight}.ttf`,
      })),
    ),
  },
};

/**
 * Every template falls back to this font for Arabic letters, so Arabic names,
 * addresses and descriptions print in any template.
 */
export const ARABIC_FONT: FontId = 'plexarabic';

/** Fonts a user can pick to override a template's body font. */
export const BODY_FONT_CHOICES: FontId[] = ['inter', 'manrope', 'plexsans', 'lora', 'spacegrotesk'];

const registered = new Set<FontId>();
let hyphenationDisabled = false;

/**
 * Registers font families with react-pdf. `resolve` maps a font file name
 * (e.g. "inter-400.ttf") to a URL (browser) or absolute path (Node).
 */
export function registerFonts(ids: Iterable<FontId>, resolve: (file: string) => string): void {
  if (!hyphenationDisabled) {
    // Never split words with hyphens; invoices read better with whole words.
    Font.registerHyphenationCallback((word) => [word]);
    hyphenationDisabled = true;
  }
  for (const id of ids) {
    if (registered.has(id)) continue;
    const def = FONT_FAMILIES[id];
    Font.register({
      family: def.family,
      fonts: def.files.map((f) => ({
        src: resolve(f.file),
        fontWeight: f.weight,
        fontStyle: f.style,
      })),
    });
    registered.add(id);
  }
}

export function fontFamily(id: FontId): string {
  return FONT_FAMILIES[id].family;
}
