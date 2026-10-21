import type { ReactElement } from 'react';
import { Document, Page, type DocumentProps } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { APP_NAME } from '@/lib/brand';
import { textSafe } from '@/lib/color';
import { FONT_FAMILIES } from '../fonts';
import { DirectionProvider, Image, LRM, Text, View, sx } from '../templates/primitives';
import {
  VOUCHER_WORDS,
  type Bilingual,
  type VoucherLine,
  type VoucherModel,
  type VoucherSignature,
} from './model';

/**
 * A receipt or payment voucher on A4, US Letter or A5 (landscape), laid out
 * like the printed sheet: English on the left, Arabic on the right, the
 * value between them; the amount in figures and words; and the signature
 * lines, with the company's stamp and signature when they are switched on.
 */

const INK = '#0f172a';
const BODY = '#334155';
const MUTED = '#64748b';
const DOTS = '#cbd5e1';
const RULE = '#94a3b8';
const RED = '#ef4444';
const TNUM: Style = { fontFeatureSettings: ['tnum'] };

/** Fonts a voucher needs (the Arabic one is the fallback for Arabic letters). */
export const VOUCHER_FONTS = ['inter', 'plexarabic'] as const;

/**
 * Sizes on a full page, on half of one (A5), where everything is tighter,
 * and on a half page that is still too short for the voucher (long names,
 * many invoices): tighter again, so the signatures stay on the sheet.
 */
const SIZES = {
  page: {
    padding: 36,
    logo: 38,
    label: 8.5,
    labelWidth: 96,
    value: 9.5,
    rowPadding: 6,
    gap: 14,
    signatures: 36,
    signed: 52,
  },
  half: {
    padding: 20,
    logo: 22,
    label: 7,
    labelWidth: 80,
    value: 8,
    rowPadding: 1.5,
    gap: 5,
    signatures: 8,
    signed: 32,
  },
  compact: {
    padding: 14,
    logo: 16,
    label: 6.5,
    labelWidth: 74,
    value: 7.5,
    rowPadding: 0.5,
    gap: 3,
    signatures: 4,
    signed: 26,
  },
};
type Sizes = (typeof SIZES)['page'];

/**
 * "No. / رقم": a label in both languages. The mark after the Arabic keeps
 * what follows it (a colon, a date) on its left-to-right side.
 */
const pair = (words: Bilingual) => `${words.en} / ${words.ar}${LRM}`;

function Value({ line, size }: { line: VoucherLine; size: Sizes }) {
  // The line reads in the direction of its first part; the others keep theirs.
  const dir = line.parts[0]?.dir;
  return (
    <Text
      style={sx(
        { fontSize: size.value, color: INK, lineHeight: 1.3, textAlign: 'center' },
        line.strong && { fontWeight: 600 },
        (dir === 'ltr' || dir === 'rtl') && { direction: dir },
      )}
    >
      {line.parts.map((part) => part.text).join(' / ')}
    </Text>
  );
}

function SignatureLine({
  line,
  height,
  oneLine,
}: {
  line: VoucherSignature;
  height: number;
  /** Both languages on one line (half pages). */
  oneLine: boolean;
}) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 8 }}>
      <View
        style={{ height, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end' }}
      >
        {line.signature ? (
          <Image
            src={line.signature}
            style={{
              height: height - 8,
              width: 96,
              objectFit: 'contain',
              objectPositionX: '50%',
            }}
          />
        ) : null}
        {line.stamp ? (
          <Image
            src={line.stamp}
            style={{
              height,
              width: 60,
              objectFit: 'contain',
              objectPositionX: '50%',
              marginLeft: line.signature ? 4 : 0,
            }}
          />
        ) : null}
      </View>
      <View style={{ borderTopWidth: 0.75, borderTopColor: RULE, marginTop: 3, paddingTop: 3 }}>
        {oneLine && line.label.en && line.label.ar ? (
          <Text style={{ fontSize: 7.5, color: BODY, textAlign: 'center' }}>
            {pair(line.label)}
          </Text>
        ) : (
          <>
            {line.label.en ? (
              <Text style={{ fontSize: 8, color: BODY, textAlign: 'center' }}>{line.label.en}</Text>
            ) : null}
            {line.label.ar ? (
              <Text style={{ fontSize: 8, color: BODY, textAlign: 'center' }}>{line.label.ar}</Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function VoucherPage({ model, compact }: { model: VoucherModel; compact: boolean }) {
  const accent = model.accent;
  const accentText = textSafe(accent);
  const font = FONT_FAMILIES.inter.family;
  const half = model.paper === 'A5';
  const size = half ? (compact ? SIZES.compact : SIZES.half) : SIZES.page;
  const signed = model.signatures.some((s) => s.signature || s.stamp);
  const small: Style = { fontSize: half ? 7 : 7.5, color: MUTED, marginTop: 1.5, lineHeight: 1.3 };
  const meta: Style = { fontSize: size.label, color: MUTED, textAlign: 'left' };
  const strong: Style = sx(TNUM, { fontSize: size.value + 0.5, fontWeight: 700, color: INK });
  const label: Style = {
    width: size.labelWidth,
    fontSize: size.label,
    color: MUTED,
    fontWeight: 500,
  };
  return (
    <Page
      size={model.paper}
      orientation={half ? 'landscape' : 'portrait'}
      style={{
        fontFamily: font,
        fontSize: 9,
        color: BODY,
        paddingVertical: size.padding,
        paddingHorizontal: 36,
      }}
    >
      <DirectionProvider dir="ltr" font={font}>
        {/* Letterhead: English on the left, the title in the middle, Arabic on the right. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            borderBottomWidth: 2,
            borderBottomColor: accent,
            paddingBottom: half ? 6 : 10,
          }}
        >
          <View style={{ width: '34%' }}>
            {model.company.logo ? (
              <Image
                src={model.company.logo}
                style={{
                  height: size.logo,
                  width: 130,
                  objectFit: 'contain',
                  objectPositionX: 0,
                  marginBottom: 4,
                }}
              />
            ) : null}
            <Text style={{ fontSize: 10.5, fontWeight: 700, color: INK }}>
              {model.company.name}
            </Text>
            {model.company.registration ? (
              <Text style={small}>{model.company.registration}</Text>
            ) : null}
            {model.company.address?.en ? (
              <Text style={small}>{model.company.address.en}</Text>
            ) : null}
            {/* On half a page the email goes with the phone, on the other side. */}
            {model.company.email && !half ? <Text style={small}>{model.company.email}</Text> : null}
          </View>
          <View style={{ flex: 1, alignItems: 'center', paddingTop: 4 }}>
            <Text
              style={{
                fontSize: half ? 15 : 17,
                fontWeight: 700,
                color: accentText,
                textAlign: 'center',
              }}
            >
              {model.title.ar}
            </Text>
            <Text
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: MUTED,
                letterSpacing: 1,
                textTransform: 'uppercase',
                textAlign: 'center',
                marginTop: 2,
              }}
            >
              {model.title.en}
            </Text>
          </View>
          <View style={{ width: '34%', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 10.5, fontWeight: 700, color: INK, textAlign: 'right' }}>
              {model.company.nameAr}
            </Text>
            {model.company.phone ? (
              <Text style={sx(small, { direction: 'ltr', textAlign: 'right' })}>
                {model.company.phone}
              </Text>
            ) : null}
            {model.company.email && half ? (
              <Text style={sx(small, { direction: 'ltr', textAlign: 'right' })}>
                {model.company.email}
              </Text>
            ) : null}
            {model.company.address?.ar ? (
              <Text style={sx(small, { textAlign: 'right' })}>{model.company.address.ar}</Text>
            ) : null}
          </View>
        </View>

        {/* Number, date and amount */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: size.gap,
            marginBottom: size.gap / 2,
          }}
        >
          <View>
            <Text style={meta}>
              {`${pair(VOUCHER_WORDS.number)}:  `}
              <Text style={strong}>{model.number}</Text>
            </Text>
            <Text style={sx(meta, { marginTop: 3 })}>
              {`${pair(VOUCHER_WORDS.date)}:  `}
              <Text style={strong}>{model.date}</Text>
            </Text>
            <Text style={sx(meta, { marginTop: 2 })}>{model.hijri}</Text>
          </View>
          <View
            style={{
              borderWidth: 1.5,
              borderColor: accent,
              borderRadius: 6,
              paddingHorizontal: 14,
              paddingVertical: half ? 3 : 5,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 7.5, color: MUTED, textAlign: 'center' }}>
              {pair(VOUCHER_WORDS.amount)}
            </Text>
            <Text
              style={sx(TNUM, {
                fontSize: half ? 12 : 13,
                fontWeight: 700,
                color: INK,
                marginTop: 1,
                textAlign: 'center',
              })}
            >
              {model.amount.en}
            </Text>
            <Text
              style={sx(TNUM, { fontSize: 10, fontWeight: 600, color: BODY, textAlign: 'center' })}
            >
              {model.amount.ar}
            </Text>
          </View>
        </View>

        {/* The details, labelled in both languages */}
        {model.rows.map((row) => (
          <View
            key={row.key}
            wrap={false}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              borderBottomWidth: 0.75,
              borderBottomColor: DOTS,
              borderBottomStyle: 'dotted',
              paddingVertical: size.rowPadding,
            }}
          >
            <Text style={label}>{row.label.en}</Text>
            <View style={{ flex: 1, paddingHorizontal: 8 }}>
              {row.lines.map((line, i) => (
                <Value key={i} line={line} size={size} />
              ))}
            </View>
            <Text style={sx(label, { textAlign: 'right' })}>{row.label.ar}</Text>
          </View>
        ))}

        {/* Signatures */}
        <View wrap={false} style={{ flexDirection: 'row', marginTop: size.signatures }}>
          {model.signatures.map((line, i) => (
            <SignatureLine
              key={i}
              line={line}
              height={signed ? size.signed : half ? 22 : 28}
              oneLine={half}
            />
          ))}
        </View>

        {model.voided ? (
          <View
            fixed
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                borderWidth: 3,
                borderColor: RED,
                borderRadius: 8,
                paddingHorizontal: 18,
                paddingVertical: 4,
                transform: 'rotate(-12deg)',
                opacity: 0.6,
              }}
            >
              <Text style={{ fontSize: 40, fontWeight: 700, color: RED, direction: 'ltr' }}>
                {`${VOUCHER_WORDS.void.en} · ${VOUCHER_WORDS.void.ar}`}
              </Text>
            </View>
          </View>
        ) : null}
      </DirectionProvider>
    </Page>
  );
}

/**
 * The voucher as a PDF document. `compact` draws a half page (A5) tighter,
 * for a voucher that doesn't fit on one otherwise (see fitVoucher).
 */
export function voucherDocument(
  model: VoucherModel,
  { compact = false }: { compact?: boolean } = {},
): ReactElement<DocumentProps> {
  return (
    <Document
      title={model.documentTitle}
      author={model.company.name}
      creator={APP_NAME}
      producer={APP_NAME}
      language="en"
    >
      <VoucherPage model={model} compact={compact} />
    </Document>
  );
}

/** How many pages a PDF made here has (react-pdf leaves its page objects uncompressed). */
export function pdfPageCount(bytes: Uint8Array): number {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

/**
 * The voucher rendered by `render`: a half page (A5) that runs onto a second
 * one is drawn again, tighter, so the voucher and its signatures stay on one
 * sheet.
 */
export async function fitVoucher<T>(
  model: VoucherModel,
  render: (document: ReactElement<DocumentProps>) => Promise<T>,
  bytes: (file: T) => Promise<Uint8Array> | Uint8Array,
): Promise<T> {
  const file = await render(voucherDocument(model));
  if (model.paper !== 'A5' || pdfPageCount(await bytes(file)) <= 1) return file;
  return render(voucherDocument(model, { compact: true }));
}
