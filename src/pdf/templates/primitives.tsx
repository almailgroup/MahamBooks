/**
 * Layout primitives for the templates: react-pdf's View, Text, Image, Link
 * and Svg, made direction aware.
 *
 * Templates are written left to right. In Arabic and bilingual documents
 * every element mirrors its own layout, the way RTL style sheets are made
 * from LTR ones: rows run right to left, left and right margins, paddings,
 * borders, corners and positions swap, start/end alignment flips and
 * rotations turn the other way. Text gets the paragraph direction of its
 * first strong letter, so Arabic reads right to left while codes, emails and
 * amounts stay left to right inside it, and Arabic text puts the Arabic font
 * first in its stack (with no letter spacing, which would break the joined
 * letters).
 *
 * These read the direction from React context, so they can't be returned
 * from a `render` prop (react-pdf calls those outside React); use react-pdf's
 * own elements there.
 */
import { Children, createContext, isValidElement, useContext, type ReactNode } from 'react';
import {
  Defs,
  G,
  Image as PdfImage,
  Link as PdfLink,
  Svg as PdfSvg,
  Text as PdfText,
  View as PdfView,
  type ImageProps,
  type LinkProps,
  type SVGProps,
  type TextProps,
  type ViewProps,
} from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { ARABIC_FONT, FONT_FAMILIES } from '../fonts';
import { hasArabic, markLines, textDirection, type Direction } from '../bidi';

export { LRM, RLM, hasArabic, ltr, markLines, textDirection, type Direction } from '../bidi';

type StyleInput = Style | Style[] | undefined | null | false;

/** Flattens optional style fragments into one object (react-pdf accepts arrays too). */
export function sx(...styles: StyleInput[]): Style {
  const out: Style = {};
  for (const s of styles) {
    if (!s) continue;
    if (Array.isArray(s)) Object.assign(out, sx(...s));
    else Object.assign(out, s);
  }
  return out;
}

const ARABIC_FAMILY = FONT_FAMILIES[ARABIC_FONT].family;

/** The text inside children, including nested Text elements. */
export function plainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (isValidElement(node)) {
    return plainText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

type FontFamily = string | string[] | undefined;

/** Moves the Arabic font to the front of a stack, or back behind the Latin font. */
export function fontStack(family: FontFamily, arabicFirst: boolean): string[] | undefined {
  if (family === undefined) return arabicFirst ? [ARABIC_FAMILY] : undefined;
  const list = (Array.isArray(family) ? family : [family]).filter((f) => f !== ARABIC_FAMILY);
  return arabicFirst ? [ARABIC_FAMILY, ...list] : [...list, ARABIC_FAMILY];
}

/* -------------------------------------------------------------------------- */
/* Mirroring                                                                  */
/* -------------------------------------------------------------------------- */

const SWAPS: [keyof Style, keyof Style][] = [
  ['marginLeft', 'marginRight'],
  ['paddingLeft', 'paddingRight'],
  ['left', 'right'],
  ['borderLeft', 'borderRight'],
  ['borderLeftWidth', 'borderRightWidth'],
  ['borderLeftColor', 'borderRightColor'],
  ['borderLeftStyle', 'borderRightStyle'],
  ['borderTopLeftRadius', 'borderTopRightRadius'],
  ['borderBottomLeftRadius', 'borderBottomRightRadius'],
];

const flipAlign = <T extends string | undefined>(value: T): T =>
  (value === 'flex-start' ? 'flex-end' : value === 'flex-end' ? 'flex-start' : value) as T;

const isRowDirection = (value: Style['flexDirection']) =>
  value === 'row' || value === 'row-reverse';

const flipPosition = (value: Style['objectPositionX']): Style['objectPositionX'] => {
  if (value === 0 || value === '0' || value === '0%' || value === 'left') return '100%';
  if (value === '100%' || value === 'right') return 0;
  return value;
};

/**
 * The right-to-left version of a style written for left-to-right documents.
 * `parentRow` tells whether the parent is a row, which decides whether
 * `alignSelf` is horizontal.
 */
export function mirrorStyle(style: Style, parentRow = false): Style {
  const out: Record<string, unknown> = { ...style };
  const src = style as Record<string, unknown>;
  for (const [a, b] of SWAPS) {
    delete out[a];
    delete out[b];
    if (src[a] !== undefined) out[b] = src[a];
    if (src[b] !== undefined) out[a] = src[b];
  }
  if (style.flexDirection === 'row') out.flexDirection = 'row-reverse';
  else if (style.flexDirection === 'row-reverse') out.flexDirection = 'row';
  // In a column the cross axis is horizontal; in a row it is vertical.
  if (style.alignItems && !isRowDirection(style.flexDirection)) {
    out.alignItems = flipAlign(style.alignItems);
  }
  if (style.alignSelf && !parentRow) out.alignSelf = flipAlign(style.alignSelf);
  if (style.textAlign === 'left') out.textAlign = 'right';
  else if (style.textAlign === 'right') out.textAlign = 'left';
  if (typeof style.transform === 'string') {
    out.transform = style.transform.replace(
      /rotate\((-?[\d.]+)deg\)/g,
      (_, deg: string) => `rotate(${-Number(deg)}deg)`,
    );
  }
  if (style.objectPositionX !== undefined)
    out.objectPositionX = flipPosition(style.objectPositionX);
  return out as Style;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

interface LayoutContext {
  dir: Direction;
  /** The parent lays its children out in a row. */
  row: boolean;
  /** The parent column keeps its children at the start (left in LTR). */
  startAligned: boolean;
  /** Font stack in effect, as written by the template. */
  font: FontFamily;
}

const Layout = createContext<LayoutContext>({
  dir: 'ltr',
  row: false,
  startAligned: true,
  font: undefined,
});

/** Sets the direction for a whole document (used by the page shell). */
export function DirectionProvider({
  dir,
  font,
  children,
}: {
  dir: Direction;
  font: FontFamily;
  children: ReactNode;
}) {
  return (
    <Layout.Provider value={{ dir, row: false, startAligned: true, font }}>
      {children}
    </Layout.Provider>
  );
}

export function useDirection(): Direction {
  return useContext(Layout).dir;
}

/**
 * Mirrors a style for right-to-left documents. A box narrower than its
 * column sits at the column's start, which is the right in Arabic.
 */
function placed(style: Style, ctx: LayoutContext, sized: boolean): Style {
  if (ctx.dir === 'ltr') return style;
  const out = mirrorStyle(style, ctx.row);
  const absolute = style.position === 'absolute';
  if (!ctx.row && ctx.startAligned && sized && !absolute && style.alignSelf === undefined) {
    out.alignSelf = 'flex-end';
  }
  return out;
}

const hasWidth = (style: Style) =>
  style.width !== undefined && style.width !== '100%' && style.width !== 'auto';

function childContext(style: Style, ctx: LayoutContext): LayoutContext {
  const row = isRowDirection(style.flexDirection);
  const align = style.alignItems;
  return {
    dir: ctx.dir,
    row,
    startAligned: !row && (align === undefined || align === 'stretch' || align === 'flex-start'),
    font: style.fontFamily ?? ctx.font,
  };
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

type WithChildren<P> = P & { children?: ReactNode };

/** Line-break penalty that rules out breaking inside a word (react-pdf's "infinity"). */
const NO_HYPHENS = 10000;

export function View({ style, children, ...props }: WithChildren<ViewProps>) {
  const ctx = useContext(Layout);
  const own = sx(style as StyleInput);
  return (
    <PdfView style={placed(own, ctx, hasWidth(own))} {...props}>
      <Layout.Provider value={childContext(own, ctx)}>{children}</Layout.Provider>
    </PdfView>
  );
}

/** Direction, font stack and spacing for a piece of text. */
function textStyle(own: Style, ctx: LayoutContext, content: string | null): Style {
  const out = placed(own, ctx, hasWidth(own));
  // Text drawn by a `render` prop (page numbers) is in the document language.
  const arabic = content === null ? ctx.dir === 'rtl' : hasArabic(content);
  const direction =
    own.direction ?? (content === null ? ctx.dir : (textDirection(content) ?? 'ltr'));
  const font = fontStack(own.fontFamily ?? ctx.font, arabic);
  if (font) out.fontFamily = font;
  out.direction = direction;
  if (arabic) {
    // Spacing would break the joined letters, and Arabic needs taller lines.
    out.letterSpacing = 0;
    if (typeof own.lineHeight === 'number' && own.lineHeight < 1.3) out.lineHeight = 1.3;
  }
  return out;
}

export function Text({ style, children, ...props }: WithChildren<TextProps>) {
  const ctx = useContext(Layout);
  const own = sx(style as StyleInput);
  const content = props.render ? null : plainText(children);
  const resolved = textStyle(own, ctx, content);
  const body =
    typeof children === 'string' ? markLines(children, resolved.direction ?? 'ltr') : children;
  return (
    // No breaks at the joins between scripts or fonts inside a word: react-pdf
    // would draw a hyphen there.
    <PdfText style={resolved} hyphenationPenalty={NO_HYPHENS} {...props}>
      <Layout.Provider value={{ ...ctx, row: false, font: own.fontFamily ?? ctx.font }}>
        {body}
      </Layout.Provider>
    </PdfText>
  );
}

export function Image({ style, ...props }: ImageProps) {
  const ctx = useContext(Layout);
  const own = sx(style as StyleInput);
  return <PdfImage style={placed(own, ctx, true)} {...props} />;
}

/**
 * A link. Text links in Arabic get an inner Text, because react-pdf's own
 * wrapper would drop the paragraph direction.
 */
export function Link({ style, children, ...props }: WithChildren<LinkProps>) {
  const ctx = useContext(Layout);
  const own = sx(style as StyleInput);
  const content = plainText(children);
  const textLike = typeof children === 'string' || typeof children === 'number';
  if (textLike && (hasArabic(content) || ctx.dir === 'rtl')) {
    const text = textStyle({}, { ...ctx, font: own.fontFamily ?? ctx.font }, content);
    return (
      <PdfLink style={placed(own, ctx, hasWidth(own))} {...props}>
        <PdfText style={text}>{children}</PdfText>
      </PdfLink>
    );
  }
  return (
    <PdfLink style={placed(own, ctx, hasWidth(own))} {...props}>
      {children}
    </PdfLink>
  );
}

/** Vector drawing; its contents are mirrored too in right-to-left documents. */
export function Svg({ style, children, ...props }: WithChildren<SVGProps>) {
  const ctx = useContext(Layout);
  const own = sx(style as StyleInput);
  const width = Number(props.width ?? own.width ?? 0);
  if (ctx.dir === 'ltr' || !width) {
    return (
      <PdfSvg style={placed(own, ctx, true)} {...props}>
        {children}
      </PdfSvg>
    );
  }
  // Definitions (gradients) must stay at the top level of the drawing.
  const all = Children.toArray(children);
  const defs = all.filter((c) => isValidElement(c) && c.type === Defs);
  const shapes = all.filter((c) => !(isValidElement(c) && c.type === Defs));
  return (
    <PdfSvg style={placed(own, ctx, true)} {...props}>
      {defs}
      <G transform={`translate(${width}, 0) scale(-1, 1)`}>{shapes}</G>
    </PdfSvg>
  );
}
