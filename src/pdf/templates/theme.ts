import { lightSafe, normalizeHex, readableOn, textSafe, tint } from '@/lib/color';
import { ARABIC_FONT, FONT_FAMILIES, type FontId } from '../fonts';
import type { RenderModel } from '../model';
import type { TemplateDefinition, TemplateTheme } from './types';

const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  LETTER: { width: 612, height: 792 },
} as const;

/** Font families a template needs, after applying the user's font override. */
export function templateFontIds(def: TemplateDefinition, override: FontId | null): FontId[] {
  const body = override ?? def.fonts.body;
  const heading = override && def.fonts.heading === def.fonts.body ? override : def.fonts.heading;
  return [...new Set<FontId>([body, heading, def.fonts.mono, ARABIC_FONT])];
}

/** A font family followed by the Arabic fallback. */
const withArabic = (id: FontId): string[] => [
  FONT_FAMILIES[id].family,
  FONT_FAMILIES[ARABIC_FONT].family,
];

export function buildTheme(def: TemplateDefinition, model: RenderModel): TemplateTheme {
  const accent = normalizeHex(model.accent, def.defaultAccent);
  const override = model.fontId && FONT_FAMILIES[model.fontId] ? model.fontId : null;
  const bodyId = override ?? def.fonts.body;
  const headingId = override && def.fonts.heading === def.fonts.body ? override : def.fonts.heading;
  const size = PAGE_SIZES[model.pageSize] ?? PAGE_SIZES.A4;
  return {
    accent,
    onAccent: readableOn(accent),
    accentInk: textSafe(accent),
    accentSoft: tint(accent, 0.93),
    accentLine: tint(accent, 0.75),
    accentBright: lightSafe(accent, '#0f172a'),
    ink: '#0f172a',
    body: '#334155',
    muted: '#64748b',
    faint: '#94a3b8',
    line: '#e2e8f0',
    surface: '#f8fafc',
    fonts: {
      body: withArabic(bodyId),
      heading: withArabic(headingId),
      mono: withArabic(def.fonts.mono),
    },
    pageWidth: size.width,
    pageHeight: size.height,
  };
}
