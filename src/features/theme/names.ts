import { msg } from '@/i18n';
import type { ThemeId } from '@/lib/themes';

/** Theme names in English; show them with `t(THEME_NAMES[id])`. */
export const THEME_NAMES: Record<ThemeId, string> = {
  classic: msg('Classic'),
  gulf: msg('Gulf blue'),
  sky: msg('Sky'),
  turquoise: msg('Turquoise'),
  oasis: msg('Oasis'),
  sand: msg('Desert sand'),
  sunset: msg('Sunset'),
  rose: msg('Rose'),
  lavender: msg('Lavender'),
  graphite: msg('Graphite'),
  midnight: msg('Midnight'),
  'deep-sea': msg('Deep sea'),
  lagoon: msg('Lagoon'),
  'oasis-night': msg('Oasis night'),
  'desert-night': msg('Desert night'),
  ember: msg('Ember'),
  'rose-night': msg('Rose night'),
  amethyst: msg('Amethyst'),
  charcoal: msg('Charcoal'),
  black: msg('Black (high contrast)'),
};
