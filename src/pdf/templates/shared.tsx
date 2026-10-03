import type { ReactNode } from 'react';
import { Document, Page } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import type { RenderModel, RenderTotal } from '../model';
import type { LabelKey } from '../labels';
import type { TemplateTheme } from './types';
import { APP_NAME } from '@/lib/brand';
import { DirectionProvider, Image, Link, Text, View, ltr, sx, useDirection } from './primitives';

export { sx, ltr } from './primitives';

/**
 * Wide gaps between parts of a line. Two plain spaces in a row would let
 * react-pdf break the line there with a stray hyphen, so the second one is a
 * non-breaking space.
 */
export const GAP = ' \u00a0';
/** "a  ·  b" separator (see GAP). */
export const DOT = ' \u00a0·\u00a0 ';

/** Tabular figures keep digits aligned in columns. */
export const TNUM: Style = { fontFeatureSettings: ['tnum'] };

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * Font size for a prominent amount, made smaller when the amount is longer
 * than the space the template has room for (`chars` characters).
 */
export function fitSize(value: string, size: number, chars: number): number {
  const length = value.replace(/[\u200e\u200f]/g, '').length;
  return length > chars ? Math.max(size * 0.6, (size * chars) / length) : size;
}

/** True when the document is laid out right to left (Arabic, bilingual). */
export const isRtl = (model: RenderModel) => model.dir === 'rtl';

/** English word for a label in bilingual documents, '' otherwise. */
export function en(model: RenderModel, key: LabelKey): string {
  return model.secondary?.[key] ?? '';
}

/* -------------------------------------------------------------------------- */
/* Direction helpers (for the few places a template sets sides by hand)       */
/* -------------------------------------------------------------------------- */

/** flexDirection for a row that starts on the reading side. */
export const rowDir = (model: RenderModel): Style['flexDirection'] =>
  isRtl(model) ? 'row-reverse' : 'row';

/** Text alignment at the start of the line (left in English, right in Arabic). */
export const alignStart = (model: RenderModel): Style['textAlign'] =>
  isRtl(model) ? 'right' : 'left';

/** Text alignment at the end of the line (right in English, left in Arabic). */
export const alignEnd = (model: RenderModel): Style['textAlign'] =>
  isRtl(model) ? 'left' : 'right';

/* -------------------------------------------------------------------------- */
/* Document shell                                                             */
/* -------------------------------------------------------------------------- */

export function DocShell({
  model,
  theme,
  pageStyle,
  children,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  pageStyle?: Style;
  children: ReactNode;
}) {
  const style = sx(
    {
      fontFamily: theme.fonts.body,
      fontSize: 9,
      color: theme.body,
      paddingTop: 40,
      paddingBottom: 64,
      paddingHorizontal: 40,
      // Inherited by all text, so text in either script lines up with the layout.
      textAlign: alignStart(model),
    },
    pageStyle,
  );
  return (
    <Document
      title={model.documentTitle}
      author={model.company.name}
      subject={model.documentTitle}
      creator={APP_NAME}
      producer={APP_NAME}
      language={isRtl(model) ? 'ar' : model.language}
    >
      <Page size={model.pageSize} style={style}>
        <DirectionProvider dir={model.dir} font={style.fontFamily}>
          {children}
        </DirectionProvider>
      </Page>
    </Document>
  );
}

/* -------------------------------------------------------------------------- */
/* Logo and images                                                            */
/* -------------------------------------------------------------------------- */

export function Logo({
  src,
  width,
  height,
  align = 'left',
  style,
}: {
  src: string | null;
  width: number;
  height: number;
  align?: 'left' | 'center' | 'right';
  style?: Style;
}) {
  if (!src) return null;
  return (
    <Image
      src={src}
      style={sx(
        {
          width,
          height,
          objectFit: 'contain',
          objectPositionX: align === 'left' ? 0 : align === 'right' ? '100%' : '50%',
          objectPositionY: '50%',
        },
        style,
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

const TEXT_KEYS = new Set<string>([
  'color',
  'direction',
  'fontFamily',
  'fontFeatureSettings',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'opacity',
  'textAlign',
  'textDecoration',
  'textTransform',
]);

/** Splits a text style into what styles the words and what styles their box. */
function splitTextStyle(style: Style): { text: Style; box: Style } {
  const text: Record<string, unknown> = {};
  const box: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    (TEXT_KEYS.has(key) ? text : box)[key] = value;
  }
  return { text: text as Style, box: box as Style };
}

/**
 * A printed label with, in bilingual documents, its English version: after
 * it on the same line (smaller and lighter), or under it with `stack`.
 */
export function Label({
  text,
  secondary,
  style,
  secondaryStyle,
  stack = false,
}: {
  text: string;
  secondary?: string;
  style?: Style;
  secondaryStyle?: Style;
  stack?: boolean;
}) {
  const base = sx(style);
  if (!secondary || secondary === text) return <Text style={base}>{text}</Text>;
  const size = typeof base.fontSize === 'number' ? base.fontSize : 9;
  const english = sx(
    { fontSize: Math.max(5.5, size * 0.84), letterSpacing: base.letterSpacing, opacity: 0.78 },
    secondaryStyle,
  );
  if (stack) {
    // The box (background, padding, borders, width) holds both lines.
    const { text: words, box } = splitTextStyle(base);
    return (
      <View style={box}>
        <Text style={words}>{text}</Text>
        <Text style={sx(words, english, { marginTop: 0.5 })}>{secondary}</Text>
      </View>
    );
  }
  return (
    <Text style={base}>
      {text}
      <Text style={english}>{`${GAP}${ltr(secondary)}`}</Text>
    </Text>
  );
}

/** Label of a party: "Bill to", "Ship to"… with its English in bilingual documents. */
export function labelOf(model: RenderModel, key: LabelKey): { text: string; secondary: string } {
  return { text: model.labels[key], secondary: en(model, key) };
}

/**
 * Lines of text. In right-to-left documents each line is its own paragraph,
 * so an Arabic address line, an email and a phone number each read in their
 * own direction.
 */
export function Lines({ lines, style }: { lines: (string | null | undefined)[]; style?: Style }) {
  const rtl = useDirection() === 'rtl';
  const visible = lines.filter((l): l is string => Boolean(l && l.trim()));
  if (visible.length === 0) return null;
  if (!rtl || visible.length === 1) return <Text style={style}>{visible.join('\n')}</Text>;
  const { marginTop, marginBottom, ...text } = sx(style);
  return (
    <View style={{ marginTop, marginBottom }}>
      {visible.map((line, i) => (
        <Text key={i} style={text}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const joinParts = (parts: string[], sep = DOT) => parts.filter(Boolean).join(sep);

/** Email, phone and website, joined on as few lines as possible. */
export function companyContactLines(model: RenderModel, compact = true): string[] {
  const c = model.company;
  const parts = [c.email, c.phone, c.website ? displayUrl(c.website) : ''].filter(Boolean);
  if (!compact) return parts;
  return parts.length > 2 ? [joinParts(parts.slice(0, 2)), parts[2]] : [joinParts(parts)];
}

/** Address lines on one line, with the Arabic comma in Arabic documents. */
export function joinAddress(model: RenderModel, lines: string[]): string {
  return lines.filter(Boolean).join(isRtl(model) ? '، ' : ', ');
}

/** Tax, registration (CR) and licence numbers on one line. */
export function companyIdLine(model: RenderModel): string {
  return joinParts([
    model.company.taxLine,
    model.company.registrationLine,
    model.company.licenceLine,
  ]);
}

export function clientLines(model: RenderModel, compact = true): string[] {
  const c = model.client;
  const contact = compact ? [joinParts([c.email, c.phone])] : [c.email, c.phone];
  return [c.contactName, ...c.addressLines, ...contact, c.taxLine].filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Items table                                                                */
/* -------------------------------------------------------------------------- */

export interface ItemsTableStyles {
  fontSize?: number;
  container?: Style;
  header?: Style;
  headerText?: Style;
  row?: Style;
  lastRow?: Style;
  zebra?: string | null;
  title?: Style;
  detail?: Style;
  cell?: Style;
  amount?: Style;
  headingRow?: Style;
  headingText?: Style;
  cellPaddingX?: number;
  rowPaddingY?: number;
  /** Color of vertical lines between columns (null = none). */
  columnLines?: string | null;
  widths?: Partial<Record<ColumnKey, number>>;
}

type ColumnKey = 'condition' | 'qty' | 'price' | 'discount' | 'tax' | 'amount';

const MIN_WIDTHS: Record<ColumnKey, number> = {
  condition: 44,
  qty: 44,
  price: 62,
  discount: 50,
  tax: 44,
  amount: 70,
};
const MAX_WIDTHS: Record<ColumnKey, number> = {
  condition: 90,
  qty: 96,
  price: 104,
  discount: 70,
  tax: 80,
  amount: 120,
};

const COLUMN_LABELS: Record<ColumnKey, LabelKey> = {
  condition: 'condition',
  qty: 'quantity',
  price: 'unitPrice',
  discount: 'discount',
  tax: 'tax',
  amount: 'amount',
};

/** Estimates column widths from their content so numbers never wrap. */
function columnWidths(
  model: RenderModel,
  fontSize: number,
  paddingX: number,
  overrides: Partial<Record<ColumnKey, number>> = {},
): Record<ColumnKey, number> {
  const keys = Object.keys(COLUMN_LABELS) as ColumnKey[];
  const values = Object.fromEntries(
    keys.map((key) => [key, [model.labels[COLUMN_LABELS[key]], en(model, COLUMN_LABELS[key])]]),
  ) as Record<ColumnKey, string[]>;
  for (const item of model.items) {
    if (item.kind !== 'item') continue;
    values.condition.push(item.condition);
    values.qty.push(item.quantityWithUnit);
    values.price.push(item.unitPrice);
    values.discount.push(item.discount);
    values.tax.push(item.tax);
    values.amount.push(item.amount);
  }
  const result = {} as Record<ColumnKey, number>;
  keys.forEach((key) => {
    // Bidi marks take no space.
    const longest = Math.max(...values[key].map((v) => v.replace(/[\u200e\u200f]/g, '').length));
    const estimate = longest * fontSize * 0.56 + paddingX * 2 + 4;
    result[key] =
      overrides[key] ?? Math.round(Math.min(MAX_WIDTHS[key], Math.max(MIN_WIDTHS[key], estimate)));
  });
  return result;
}

export function ItemsTable({
  model,
  theme,
  styles = {},
}: {
  model: RenderModel;
  theme: TemplateTheme;
  styles?: ItemsTableStyles;
}) {
  const { columns } = model;
  const fontSize = styles.fontSize ?? 9;
  const px = styles.cellPaddingX ?? 8;
  const py = styles.rowPaddingY ?? 7;
  const w = columnWidths(model, fontSize, px, styles.widths);
  const divider = styles.columnLines
    ? { borderLeftWidth: 0.75, borderLeftColor: styles.columnLines }
    : undefined;

  const cols: ColumnKey[] = [
    ...(columns.condition ? (['condition'] as const) : []),
    'qty',
    'price',
    ...(columns.discount ? (['discount'] as const) : []),
    ...(columns.tax ? (['tax'] as const) : []),
    'amount',
  ];

  const headerText = sx(
    { fontSize: fontSize - 1, fontWeight: 600, color: theme.muted },
    styles.headerText,
  );
  const cell = sx({ fontSize, color: theme.body, textAlign: 'right' }, TNUM, styles.cell);
  const detailStyle = sx(
    { fontSize: fontSize - 1, color: theme.muted, marginTop: 2, lineHeight: 1.35 },
    styles.detail,
  );
  const itemRows = model.items;
  // Zebra striping counts item rows only, so headings don't shift the pattern.
  const stripe: number[] = [];
  let itemCount = 0;
  for (const row of itemRows) {
    stripe.push(itemCount);
    if (row.kind === 'item') itemCount += 1;
  }
  const valueOf = (item: RenderModel['items'][number], key: ColumnKey) =>
    key === 'condition'
      ? item.condition
      : key === 'qty'
        ? item.quantityWithUnit
        : key === 'price'
          ? item.unitPrice
          : key === 'discount'
            ? item.discount
            : key === 'tax'
              ? item.tax
              : item.amount;

  return (
    <View style={sx({ width: '100%' }, styles.container)}>
      <View
        fixed
        style={sx(
          { flexDirection: 'row', alignItems: 'center', paddingVertical: py - 1 },
          styles.header,
        )}
      >
        <View style={{ flex: 1, paddingHorizontal: px }}>
          <Label
            text={model.labels.description}
            secondary={en(model, 'description')}
            style={headerText}
            stack
          />
        </View>
        {cols.map((key) => (
          <View key={key} style={sx({ width: w[key], paddingHorizontal: px }, divider)}>
            <Label
              text={model.labels[COLUMN_LABELS[key]]}
              secondary={en(model, COLUMN_LABELS[key])}
              style={sx(headerText, { textAlign: key === 'condition' ? 'left' : 'right' })}
              stack
            />
          </View>
        ))}
      </View>

      {itemRows.map((item, i) => {
        const isLast = i === itemRows.length - 1;
        if (item.kind === 'heading') {
          return (
            <View
              key={i}
              wrap={false}
              minPresenceAhead={30}
              style={sx(
                { paddingHorizontal: px, paddingTop: py + 4, paddingBottom: py - 2 },
                styles.headingRow,
              )}
            >
              <Text
                style={sx(
                  { fontSize: fontSize + 0.5, fontWeight: 700, color: theme.ink },
                  styles.headingText,
                )}
              >
                {item.title}
              </Text>
              {item.titleSecondary ? (
                <Text style={sx(detailStyle, { marginTop: 1 })}>{item.titleSecondary}</Text>
              ) : null}
              {item.detail ? (
                <Text
                  style={sx(
                    { fontSize: fontSize - 1, color: theme.muted, marginTop: 1 },
                    styles.detail,
                  )}
                >
                  {item.detail}
                </Text>
              ) : null}
            </View>
          );
        }
        const zebra =
          styles.zebra && stripe[i] % 2 === 1 ? { backgroundColor: styles.zebra } : undefined;
        return (
          <View
            key={i}
            wrap={false}
            style={sx(
              { flexDirection: 'row', paddingVertical: py },
              styles.row,
              zebra,
              isLast ? styles.lastRow : undefined,
            )}
          >
            <View style={{ flex: 1, paddingHorizontal: px }}>
              <Text style={sx({ fontSize, fontWeight: 600, color: theme.ink }, styles.title)}>
                {item.title}
              </Text>
              {item.titleSecondary ? (
                <Text
                  style={sx(
                    { fontSize: fontSize - 0.5, color: theme.body, marginTop: 1 },
                    styles.title,
                    { fontWeight: 400 },
                  )}
                >
                  {item.titleSecondary}
                </Text>
              ) : null}
              {item.detail ? <Text style={detailStyle}>{item.detail}</Text> : null}
              {item.serial ? <Text style={detailStyle}>{item.serial}</Text> : null}
            </View>
            {cols.map((key) => (
              <View key={key} style={sx({ width: w[key], paddingHorizontal: px }, divider)}>
                <Text
                  style={
                    key === 'amount'
                      ? sx(cell, { fontWeight: 600, color: theme.ink }, styles.amount)
                      : key === 'condition'
                        ? sx(cell, { textAlign: 'left' })
                        : cell
                  }
                >
                  {valueOf(item, key)}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                     */
/* -------------------------------------------------------------------------- */

export interface TotalsStyles {
  width?: number | string;
  container?: Style;
  row?: Style;
  label?: Style;
  value?: Style;
  /** Final emphasised row (balance due, or total when nothing was paid). */
  grandRow?: Style;
  grandLabel?: Style;
  grandValue?: Style;
  /** The "Total" row when it is not the emphasised one. */
  strongRow?: Style;
  strongLabel?: Style;
  strongValue?: Style;
  note?: Style;
  /** The amount in words under the totals. */
  words?: Style;
  wordsText?: Style;
}

export function emphasizedKind(model: RenderModel): RenderTotal['kind'] {
  return model.totals.some((t) => t.kind === 'balance') ? 'balance' : 'total';
}

/** The total in words (Arabic, English or both), with its label. */
export function AmountInWords({
  model,
  theme,
  style,
  textStyle,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  style?: Style;
  textStyle?: Style;
}) {
  if (model.amountInWords.length === 0) return null;
  return (
    <View style={sx({ paddingTop: 7 }, style)}>
      <Label
        text={model.labels.amountInWords}
        secondary={en(model, 'amountInWords')}
        style={{ fontSize: 6.5, color: theme.faint, marginBottom: 2 }}
      />
      {model.amountInWords.map((words) => (
        <Text
          key={words}
          style={sx({ fontSize: 7.5, color: theme.body, lineHeight: 1.4 }, textStyle)}
        >
          {words}
        </Text>
      ))}
    </View>
  );
}

export function TotalsTable({
  model,
  theme,
  styles = {},
  grandBackground,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  styles?: TotalsStyles;
  /** Drawn behind the emphasised row (e.g. a gradient). */
  grandBackground?: ReactNode;
}) {
  const emphasized = emphasizedKind(model);
  const row = sx(
    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    styles.row,
  );
  const label = sx({ fontSize: 9, color: theme.muted }, styles.label);
  const value = sx({ fontSize: 9, color: theme.ink, textAlign: 'right' }, TNUM, styles.value);
  const rowPadding = sx(styles.row).paddingHorizontal;

  return (
    <View
      wrap={false}
      style={sx({ width: styles.width ?? 230, alignSelf: 'flex-start' }, styles.container)}
    >
      {model.totals.map((t, i) => {
        if (t.kind === emphasized) {
          return (
            <View key={i} style={sx(row, { paddingVertical: 7 }, styles.grandRow)}>
              {grandBackground}
              <Label
                text={t.label}
                secondary={t.secondary}
                style={sx(
                  label,
                  { fontSize: 10, fontWeight: 700, color: theme.ink },
                  styles.grandLabel,
                )}
              />
              <Text style={sx(value, { fontSize: 12, fontWeight: 700 }, styles.grandValue)}>
                {t.value}
              </Text>
            </View>
          );
        }
        if (t.kind === 'total') {
          return (
            <View key={i} style={sx(row, styles.strongRow)}>
              <Label
                text={t.label}
                secondary={t.secondary}
                style={sx(label, { fontWeight: 700, color: theme.ink }, styles.strongLabel)}
              />
              <Text style={sx(value, { fontWeight: 700 }, styles.strongValue)}>{t.value}</Text>
            </View>
          );
        }
        if (t.kind === 'included-tax') {
          return (
            <View key={i} style={sx(row, { paddingVertical: 2 })}>
              <Text style={sx(label, { fontSize: 8 }, styles.note)}>{t.label}</Text>
              <Text style={sx(value, { fontSize: 8, color: theme.muted }, styles.note)}>
                {t.value}
              </Text>
            </View>
          );
        }
        return (
          <View key={i} style={row}>
            <Label text={t.label} secondary={t.secondary} style={label} />
            <Text style={value}>{t.value}</Text>
          </View>
        );
      })}
      <AmountInWords
        model={model}
        theme={theme}
        style={sx({ paddingHorizontal: rowPadding }, styles.words)}
        textStyle={styles.wordsText}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

export function Section({
  title,
  children,
  titleStyle,
  style,
}: {
  title: string;
  children: ReactNode;
  titleStyle?: Style;
  style?: Style;
}) {
  return (
    <View style={style}>
      <Text style={titleStyle}>{title}</Text>
      {children}
    </View>
  );
}

export function PaymentInfo({
  model,
  theme,
  titleStyle,
  textStyle,
  linkColor,
  qrSize = 62,
  showTitle = true,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  titleStyle?: Style;
  textStyle?: Style;
  linkColor?: string;
  qrSize?: number;
  showTitle?: boolean;
}) {
  const p = model.payment;
  if (!p) return null;
  const text = sx({ fontSize: 8.5, color: theme.body, lineHeight: 1.45 }, textStyle);
  const linkText = isRtl(model) ? ltr(displayUrl(p.link)) : displayUrl(p.link);
  return (
    <View wrap={false} style={{ flexDirection: 'row' }}>
      <View style={{ flex: 1, paddingRight: p.qr ? 12 : 0 }}>
        {showTitle ? (
          <Label
            text={model.labels.paymentDetails}
            secondary={en(model, 'paymentDetails')}
            style={titleStyle}
          />
        ) : null}
        {p.details ? <Lines lines={p.details.split('\n')} style={text} /> : null}
        {p.instructions ? (
          <Text style={sx(text, { marginTop: p.details ? 4 : 0 })}>{p.instructions}</Text>
        ) : null}
        {p.link ? (
          <Link
            src={p.link}
            style={sx(text, {
              marginTop: p.details || p.instructions ? 4 : 0,
              color: linkColor ?? theme.accentInk,
              textDecoration: 'none',
              fontWeight: 600,
            })}
          >
            {`${model.labels.payOnline}: ${linkText}`}
          </Link>
        ) : null}
      </View>
      {p.qr ? (
        <View style={{ alignItems: 'center' }}>
          <Image src={p.qr} style={{ width: qrSize, height: qrSize }} />
          <Text style={{ fontSize: 6.5, color: theme.muted, marginTop: 3, textAlign: 'center' }}>
            {model.labels.scanToPay}
          </Text>
          {model.secondary ? (
            <Text style={{ fontSize: 6, color: theme.faint, textAlign: 'center' }}>
              {model.secondary.scanToPay}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function Stamp({
  model,
  theme,
  style,
  size = 20,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  style?: Style;
  size?: number;
}) {
  if (!model.stamp) return null;
  const color =
    model.stamp.tone === 'green' ? '#15803d' : model.stamp.tone === 'red' ? '#b91c1c' : '#475569';
  const text: Style = {
    color,
    fontSize: size,
    fontWeight: 700,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    fontFamily: theme.fonts.heading,
    textAlign: 'center',
  };
  return (
    <View
      style={sx(
        {
          position: 'absolute',
          transform: 'rotate(-10deg)',
          borderWidth: 2.2,
          borderColor: color,
          borderRadius: 6,
          paddingVertical: 3,
          paddingHorizontal: 12,
          opacity: 0.8,
        },
        style,
      )}
    >
      <Text style={text}>{model.stamp.text}</Text>
      {model.stamp.secondary ? (
        <Text style={sx(text, { fontSize: size * 0.45, letterSpacing: 1.5, marginTop: -1 })}>
          {model.stamp.secondary}
        </Text>
      ) : null}
    </View>
  );
}

/** Compact status badge, an alternative to the rotated stamp. */
export function StatusPill({
  model,
  color,
  style,
}: {
  model: RenderModel;
  color: string;
  style?: Style;
}) {
  if (!model.stamp) return null;
  return (
    <View
      style={sx(
        {
          alignSelf: 'flex-start',
          borderWidth: 1,
          borderColor: color,
          borderRadius: 9,
          paddingVertical: 2,
          paddingHorizontal: 8,
        },
        style,
      )}
    >
      <Label
        text={model.stamp.text}
        secondary={model.stamp.secondary}
        style={{
          fontSize: 7,
          fontWeight: 700,
          color,
          textTransform: 'uppercase',
          letterSpacing: 1.2,
        }}
        secondaryStyle={{ opacity: 1 }}
      />
    </View>
  );
}

/** "Page 2 of 3", with the English after it in bilingual documents. */
function pageText(model: RenderModel, page: number, total: number): string {
  const main = `${model.labels.page} ${page} ${model.labels.of} ${total}`;
  const s = model.secondary;
  return s ? `${main}${DOT}${ltr(`${s.page} ${page} ${s.of} ${total}`)}` : main;
}

export function PageFooter({
  model,
  theme,
  style,
  textStyle,
  marginX = 40,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  style?: Style;
  textStyle?: Style;
  marginX?: number;
}) {
  const text = sx({ fontSize: 7.5, color: theme.faint, lineHeight: 1.4 }, textStyle);
  const box = sx(
    {
      position: 'absolute',
      left: marginX,
      right: marginX,
      bottom: 22,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    style,
  );
  const numberWidth = model.secondary ? 190 : 110;
  return (
    <>
      <View fixed style={box}>
        <Text style={sx(text, { flex: 1, paddingRight: numberWidth + 16 })}>{model.footer}</Text>
      </View>
      {/* react-pdf drops text drawn by `render` when it has a line height,
          so the page number is a fixed text of its own without one. */}
      <Text
        fixed
        style={sx(text, {
          position: 'absolute',
          right: box.right,
          bottom: box.bottom,
          width: numberWidth,
          textAlign: 'right',
          lineHeight: undefined,
        })}
        render={({ pageNumber, totalPages }) =>
          totalPages > 1 ? pageText(model, pageNumber, totalPages) : ''
        }
      />
    </>
  );
}

/** Small "Invoice INV-001 · Client" line at the top of pages 2+. */
export function RunningHeader({
  model,
  theme,
  style,
  marginX = 40,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  style?: Style;
  marginX?: number;
}) {
  const text = [`${model.title} ${model.number}`.trim(), model.client.name]
    .filter(Boolean)
    .join(DOT);
  return (
    <Text
      fixed
      style={sx(
        {
          position: 'absolute',
          top: 20,
          left: marginX,
          right: marginX,
          fontSize: 7.5,
          color: theme.faint,
          textAlign: 'right',
        },
        style,
      )}
      render={({ pageNumber }) => (pageNumber > 1 ? text : '')}
    />
  );
}

/**
 * Payment details and terms side by side under a divider. When the terms are
 * long they are stacked instead, so the band can break across pages.
 */
export function ClosingBand({
  model,
  theme,
  titleStyle,
  textStyle,
  style,
  linkColor,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  titleStyle: Style;
  textStyle?: Style;
  style?: Style;
  linkColor?: string;
}) {
  if (!model.payment && !model.terms) return null;
  const terms = model.terms ? (
    <View style={{ flex: 1 }}>
      <Label text={model.labels.terms} secondary={en(model, 'terms')} style={titleStyle} />
      <Text style={sx({ fontSize: 8, color: theme.muted, lineHeight: 1.5 }, textStyle)}>
        {model.terms}
      </Text>
    </View>
  ) : null;
  const payment = model.payment ? (
    <PaymentInfo
      model={model}
      theme={theme}
      titleStyle={titleStyle}
      textStyle={textStyle}
      linkColor={linkColor}
    />
  ) : null;
  const container = sx(
    { marginTop: 22, paddingTop: 16, borderTopWidth: 0.75, borderTopColor: theme.line },
    style,
  );
  if (model.terms.length <= 700) {
    return (
      <View wrap={false} style={sx(container, { flexDirection: 'row' })}>
        {payment ? (
          <View style={{ flex: 1.15, paddingRight: terms ? 26 : 0 }}>{payment}</View>
        ) : null}
        {terms}
      </View>
    );
  }
  return (
    <View style={container}>
      {payment ? <View style={{ marginBottom: 14 }}>{payment}</View> : null}
      {terms}
    </View>
  );
}

/**
 * Notes and terms side by side (stacked when the terms are long, so they can
 * break across pages). Set `includeNotes` to false when notes are shown elsewhere.
 */
export function NotesAndTerms({
  model,
  theme,
  titleStyle,
  textStyle,
  style,
  includeNotes = true,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  titleStyle: Style;
  textStyle?: Style;
  style?: Style;
  includeNotes?: boolean;
}) {
  const notes = includeNotes && model.notes ? model.notes : '';
  if (!notes && !model.terms) return null;
  const text = sx({ fontSize: 8.5, color: theme.body, lineHeight: 1.5 }, textStyle);
  const notesBlock = notes ? (
    <View style={{ flex: 1, paddingRight: model.terms ? 26 : 0 }}>
      <Label text={model.labels.notes} secondary={en(model, 'notes')} style={titleStyle} />
      <Text style={text}>{notes}</Text>
    </View>
  ) : null;
  const termsBlock = model.terms ? (
    <View style={{ flex: 1 }}>
      <Label text={model.labels.terms} secondary={en(model, 'terms')} style={titleStyle} />
      <Text style={sx(text, { fontSize: 8, color: theme.muted })}>{model.terms}</Text>
    </View>
  ) : null;
  if (notes.length + model.terms.length <= 900) {
    return (
      <View wrap={false} style={sx({ flexDirection: 'row' }, style)}>
        {notesBlock}
        {termsBlock}
      </View>
    );
  }
  return (
    <View style={style}>
      {notesBlock ? <View style={{ marginBottom: 12 }}>{notesBlock}</View> : null}
      {termsBlock}
    </View>
  );
}

/**
 * Boxes for the authorised signature and the company stamp (with their
 * images when uploaded) and a line for the customer to sign on receipt.
 */
export function SignatureBlock({
  model,
  theme,
  labelStyle,
  lineColor,
  style,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  labelStyle?: Style;
  lineColor?: string;
  style?: Style;
}) {
  const s = model.signatures;
  if (!s) return null;
  const caption = sx({ fontSize: 7.5, color: theme.muted }, labelStyle, { marginBottom: 0 });
  const box = (key: LabelKey, image: string | null, last: boolean) => (
    <View style={{ flex: 1, paddingRight: last ? 0 : 22 }}>
      <View style={{ height: 40, justifyContent: 'flex-end' }}>
        {image ? (
          <Image
            src={image}
            style={{ height: 40, width: 120, objectFit: 'contain', objectPositionX: 0 }}
          />
        ) : null}
      </View>
      <View
        style={{
          borderTopWidth: 0.75,
          borderTopColor: lineColor ?? theme.faint,
          marginTop: 4,
          paddingTop: 4,
        }}
      >
        <Label text={model.labels[key]} secondary={en(model, key)} style={caption} />
      </View>
    </View>
  );
  return (
    <View wrap={false} style={sx({ flexDirection: 'row', marginTop: 18 }, style)}>
      {box('signature', s.signature, false)}
      {box('stamp', s.stamp, !s.receivedBy)}
      {s.receivedBy ? box('receivedBy', null, true) : null}
    </View>
  );
}

/**
 * The block after the items: payment details (or notes) beside the totals,
 * then notes and terms, and the signature boxes. Shared so every template
 * behaves the same.
 */
export function TotalsSection({
  model,
  theme,
  titleStyle,
  textStyle,
  totals,
  grandBackground,
  style,
  bandStyle,
  linkColor,
  gap = 28,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  titleStyle: Style;
  textStyle?: Style;
  totals: TotalsStyles;
  grandBackground?: ReactNode;
  style?: Style;
  bandStyle?: Style;
  linkColor?: string;
  gap?: number;
}) {
  const text = sx({ fontSize: 8.5, color: theme.body, lineHeight: 1.5 }, textStyle);
  return (
    <>
      <View wrap={false} style={sx({ flexDirection: 'row', marginTop: 14 }, style)}>
        <View style={{ flex: 1, paddingRight: gap }}>
          {model.payment ? (
            <PaymentInfo
              model={model}
              theme={theme}
              titleStyle={titleStyle}
              textStyle={textStyle}
              linkColor={linkColor}
            />
          ) : model.notes ? (
            <View>
              <Label text={model.labels.notes} secondary={en(model, 'notes')} style={titleStyle} />
              <Text style={text}>{model.notes}</Text>
            </View>
          ) : null}
        </View>
        <TotalsTable
          model={model}
          theme={theme}
          styles={totals}
          grandBackground={grandBackground}
        />
      </View>
      <NotesAndTerms
        model={model}
        theme={theme}
        titleStyle={titleStyle}
        textStyle={textStyle}
        includeNotes={Boolean(model.payment)}
        style={sx(
          { marginTop: 16, paddingTop: 12, borderTopWidth: 0.75, borderTopColor: theme.line },
          bandStyle,
        )}
      />
      <SignatureBlock model={model} theme={theme} labelStyle={titleStyle} />
    </>
  );
}

/** Label, name and address lines of a party (bill to, ship to, from). */
export function Party({
  label,
  labelSecondary,
  name,
  nameSecondary,
  lines,
  labelStyle,
  nameStyle,
  linesStyle,
  style,
}: {
  label?: string;
  labelSecondary?: string;
  name: string;
  nameSecondary?: string;
  lines: string[];
  labelStyle?: Style;
  nameStyle?: Style;
  linesStyle?: Style;
  style?: Style;
}) {
  const nameText = sx({ fontSize: 10, fontWeight: 700, marginBottom: 2 }, nameStyle);
  return (
    <View style={style}>
      {label ? <Label text={label} secondary={labelSecondary} style={labelStyle} /> : null}
      <Text style={nameText}>{name || '—'}</Text>
      {nameSecondary ? (
        <Text style={sx(nameText, { fontSize: 8.5, fontWeight: 500, marginTop: -1 })}>
          {nameSecondary}
        </Text>
      ) : null}
      <Lines lines={lines} style={sx({ fontSize: 8.5, lineHeight: 1.5 }, linesStyle)} />
    </View>
  );
}

/** Label / value rows, e.g. issue date and due date. */
export function MetaRows({
  rows,
  labelStyle,
  valueStyle,
  rowStyle,
  labelWidth,
}: {
  rows: { label: string; secondary?: string; value: string }[];
  labelStyle?: Style;
  valueStyle?: Style;
  rowStyle?: Style;
  labelWidth?: number;
}) {
  return (
    <View>
      {rows.map((r) => (
        <View
          key={r.label}
          style={sx(
            { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
            rowStyle,
          )}
        >
          <Label
            text={r.label}
            secondary={r.secondary}
            style={sx(
              labelWidth ? { width: labelWidth } : { flexShrink: 1, paddingRight: 6 },
              labelStyle,
            )}
            stack
          />
          <Text
            style={sx({ textAlign: 'right', flexShrink: 1, maxWidth: '70%' }, TNUM, valueStyle)}
          >
            {r.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Notes, terms and payment details in a consistent order. */
export function ClosingSections({
  model,
  theme,
  titleStyle,
  textStyle,
  gap = 14,
  linkColor,
}: {
  model: RenderModel;
  theme: TemplateTheme;
  titleStyle: Style;
  textStyle?: Style;
  gap?: number;
  linkColor?: string;
}) {
  const text = sx({ fontSize: 8.5, color: theme.body, lineHeight: 1.5 }, textStyle);
  return (
    <View>
      {model.notes ? (
        <View wrap={false} style={{ marginBottom: gap }}>
          <Label text={model.labels.notes} secondary={en(model, 'notes')} style={titleStyle} />
          <Text style={text}>{model.notes}</Text>
        </View>
      ) : null}
      {model.payment ? (
        <View style={{ marginBottom: gap }}>
          <PaymentInfo
            model={model}
            theme={theme}
            titleStyle={titleStyle}
            textStyle={textStyle}
            linkColor={linkColor}
          />
        </View>
      ) : null}
      {model.terms ? (
        <View style={{ marginBottom: gap }}>
          <Label text={model.labels.terms} secondary={en(model, 'terms')} style={titleStyle} />
          <Text style={sx(text, { color: theme.muted, fontSize: 8 })}>{model.terms}</Text>
        </View>
      ) : null}
    </View>
  );
}
