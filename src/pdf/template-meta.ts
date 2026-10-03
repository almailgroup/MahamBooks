/**
 * Template names and descriptions. Kept separate from the templates themselves
 * so pages can list templates without loading the PDF renderer. Translate
 * them where they are shown: `t(meta.name)`.
 */

/**
 * Marks text for translation, like `msg` from `@/i18n`. That module can't be
 * imported here: this file is also loaded by the PDF worker and Node scripts.
 */
const msg = <T extends string>(text: T): T => text;
export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Accent used in gallery previews before the user picks their own. */
  defaultAccent: string;
}

export const TEMPLATE_META: TemplateMeta[] = [
  {
    id: 'modern',
    name: msg('Modern'),
    description: msg('Crisp layout with an accent summary panel and a highlighted amount due.'),
    tags: [msg('Popular'), msg('Clean')],
    defaultAccent: '#4f46e5',
  },
  {
    id: 'minimal',
    name: msg('Minimal'),
    description: msg(
      'Quiet, typographic and spacious — hairline rules with a single touch of colour.',
    ),
    tags: [msg('Clean'), msg('Monochrome')],
    defaultAccent: '#0f766e',
  },
  {
    id: 'corporate',
    name: msg('Corporate'),
    description: msg('Structured and businesslike, with a bold title block and boxed details.'),
    tags: [msg('Business'), msg('Structured')],
    defaultAccent: '#1d4ed8',
  },
  {
    id: 'elegant',
    name: msg('Elegant'),
    description: msg(
      'Refined serif letterhead with fine double rules — ideal for premium services.',
    ),
    tags: [msg('Serif'), msg('Premium')],
    defaultAccent: '#a16207',
  },
  {
    id: 'bold',
    name: msg('Bold'),
    description: msg(
      'Big, confident type with a dark summary band — makes the amount due impossible to miss.',
    ),
    tags: [msg('Striking'), msg('Dark')],
    defaultAccent: '#f97316',
  },
  {
    id: 'classic',
    name: msg('Classic'),
    description: msg(
      'Traditional boxed layout with ruled tables — familiar to every accounts department.',
    ),
    tags: [msg('Traditional'), msg('Structured')],
    defaultAccent: '#0e7490',
  },
  {
    id: 'creative',
    name: msg('Creative'),
    description: msg(
      'Playful geometric accents and rounded cards — friendly but still professional.',
    ),
    tags: [msg('Colorful'), msg('Friendly')],
    defaultAccent: '#db2777',
  },
  {
    id: 'compact',
    name: msg('Compact'),
    description: msg(
      'Dense, efficient layout that fits many line items per page — great for itemised services.',
    ),
    tags: [msg('Many items'), msg('Efficient')],
    defaultAccent: '#2563eb',
  },
  {
    id: 'gradient',
    name: msg('Gradient'),
    description: msg(
      'Vibrant gradient header in your brand colour, with the logo on a clean white card.',
    ),
    tags: [msg('Colorful'), msg('Modern')],
    defaultAccent: '#7c3aed',
  },
  {
    id: 'mono',
    name: msg('Mono'),
    description: msg('Technical look with a dark header, grid lines and monospaced figures.'),
    tags: [msg('Technical'), msg('Dark')],
    defaultAccent: '#10b981',
  },
];

export const DEFAULT_TEMPLATE_ID = 'modern';

export function templateMeta(id: string): TemplateMeta {
  const meta = TEMPLATE_META.find((t) => t.id === id);
  if (!meta) throw new Error(`Unknown template ${id}`);
  return meta;
}
