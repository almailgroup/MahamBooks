import { useEffect, useState, type CSSProperties } from 'react';
import type { ChequeBox, ChequeLayout } from '@/db/types';
import { MmBox, MmPage, type MmOffset } from '@/features/print/mm-page';
import { LAYOUT_FIELD_LABELS, LAYOUT_FIELDS } from '@/lib/cheque-layouts';
import {
  chequeFace,
  FIELD_PADDING,
  fieldTextSize,
  fitFace,
  type ChequeFace,
  type ChequeFit,
  type MeasureText,
} from '@/lib/cheque-print';
import { cn } from '@/lib/cn';
import { t } from '@/i18n';

/**
 * A cheque leaf at its real size, with the cheque's text in the layout's
 * fields. The same leaf is the print, the preview in the layout editor and
 * the test print (with `guides`, the fields' outlines).
 */

const PX_PER_MM = 96 / 25.4;
/** The app's font: the leaf prints with what it was measured with. */
const FONT = "'Inter Variable', 'IBM Plex Sans Arabic', ui-sans-serif, system-ui, sans-serif";
const WEIGHT = 500;
const BOLD = 700;

function canvasMeasure(): MeasureText {
  let context: CanvasRenderingContext2D | null = null;
  try {
    // jsdom (unit tests) has no canvas.
    if (!/jsdom/i.test(navigator.userAgent)) {
      context = document.createElement('canvas').getContext('2d');
    }
  } catch {
    context = null;
  }
  return (text, sizeMm, bold) => {
    if (!context) return text.length * sizeMm * 0.6;
    context.font = `${bold ? BOLD : WEIGHT} ${sizeMm * PX_PER_MM}px ${FONT}`;
    return context.measureText(text).width / PX_PER_MM;
  };
}

/**
 * Measures text as the leaf prints it; measured again once the fonts have
 * loaded (the Arabic one only loads when asked for).
 */
export function useMeasureText(): MeasureText {
  const [measure, setMeasure] = useState<MeasureText>(canvasMeasure);
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return;
    let live = true;
    const load = (weight: number, family: string, text?: string) =>
      fonts.load(`${weight} 16px ${family}`, text).catch(() => []);
    void Promise.all([
      load(WEIGHT, "'Inter Variable'"),
      load(BOLD, "'Inter Variable'"),
      load(WEIGHT, "'IBM Plex Sans Arabic'", 'عربي'),
      load(BOLD, "'IBM Plex Sans Arabic'", 'عربي'),
    ])
      .then(() => fonts.ready)
      .then(() => {
        if (live) setMeasure(() => canvasMeasure());
      });
    return () => {
      live = false;
    };
  }, []);
  return measure;
}

/** How the face prints on the leaf: the amount in words over two lines, and each field's size. */
export function useChequeFit(layout: ChequeLayout, face: ChequeFace): ChequeFit {
  const measure = useMeasureText();
  return fitFace(face, layout, measure);
}

/** Invented names for previews and test prints, in the layout's language. */
const SAMPLE_PAYEE = { ar: 'شركة المثال للتجارة العامة', en: 'Example General Trading Co.' };

/** A cheque to show a layout with: 1,250.750 dinars, dated `date`. */
export function sampleFace(layout: ChequeLayout, date: string, crossed = true): ChequeFace {
  return chequeFace({ amount: 1250.75, date, payee: SAMPLE_PAYEE[layout.wordsLanguage] }, layout, {
    crossed,
  });
}

const ink: CSSProperties = { color: '#000', fontFamily: FONT, fontWeight: WEIGHT };

function Text({
  box,
  text,
  size = fieldTextSize(box),
  dir,
  align = 'start',
  field,
  bold,
}: {
  box: ChequeBox;
  text: string;
  size?: number;
  dir: 'ltr' | 'rtl' | 'auto';
  align?: 'start' | 'center';
  field: string;
  bold?: boolean;
}) {
  return (
    <MmBox {...box} className="flex items-center">
      <p
        dir={dir}
        data-field={field}
        className={cn(
          'w-full overflow-hidden whitespace-nowrap',
          align === 'center' ? 'text-center' : 'text-start',
        )}
        style={{
          ...ink,
          fontSize: `${size}mm`,
          lineHeight: 1.15,
          padding: `0 ${FIELD_PADDING}mm`,
          ...(bold ? { fontWeight: BOLD } : {}),
        }}
      >
        {text}
      </p>
    </MmBox>
  );
}

function DateBoxes({ box, digits }: { box: ChequeBox; digits: readonly string[] }) {
  const cell = box.width / digits.length;
  return (
    <MmBox {...box}>
      <p data-field="date" className="sr-only">
        {digits.join('')}
      </p>
      {digits.map((digit, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-0 flex h-full items-center justify-center"
          style={{
            ...ink,
            left: `${i * cell}mm`,
            width: `${cell}mm`,
            fontSize: `${fieldTextSize(box)}mm`,
          }}
        >
          {digit}
        </span>
      ))}
    </MmBox>
  );
}

function Crossing({ box, lines }: { box: ChequeBox; lines: string[] }) {
  return (
    <MmBox
      {...box}
      className="flex flex-col items-center justify-center"
      style={{ borderTop: '0.35mm solid #000', borderBottom: '0.35mm solid #000' }}
    >
      {lines.map((line) => (
        <p
          key={line}
          dir="auto"
          data-field="crossing"
          className="whitespace-nowrap"
          style={{ ...ink, fontSize: `${Math.min(3, box.height * 0.32)}mm`, lineHeight: 1.1 }}
        >
          {line}
        </p>
      ))}
    </MmBox>
  );
}

/** The fields' outlines and names; `print` keeps them on paper (a test print). */
function Guides({ layout, print }: { layout: ChequeLayout; print: boolean }) {
  return (
    <>
      {LAYOUT_FIELDS.map((key) => {
        const box = layout.fields[key];
        if (!box) return null;
        return (
          <MmBox
            key={key}
            {...box}
            className={cn(
              'overflow-visible border border-dashed border-sky-500/80',
              !print && 'print:hidden',
            )}
          >
            <span
              className="absolute start-0 -top-[2.6mm] whitespace-nowrap text-sky-700"
              style={{ fontSize: '1.9mm', lineHeight: 1 }}
            >
              {t(LAYOUT_FIELD_LABELS[key])}
            </span>
          </MmBox>
        );
      })}
    </>
  );
}

/** Millimetre ticks along the top and left edges, for the test print. */
export function LeafRulers({ width, height }: { width: number; height: number }) {
  const along = (length: number) => Array.from({ length: Math.floor(length) }, (_, i) => i + 1);
  const tick = (n: number) => (n % 10 === 0 ? 3.5 : n % 5 === 0 ? 2.2 : 1.2);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={`${width}mm`}
      height={`${height}mm`}
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      {along(width).map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={tick(x)} stroke="#0f172a" strokeWidth={0.15} />
      ))}
      {along(height).map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={tick(y)} y2={y} stroke="#0f172a" strokeWidth={0.15} />
      ))}
    </svg>
  );
}

/** One cheque leaf: the face of the cheque in the layout's fields. */
export function ChequeLeaf({
  layout,
  face,
  fit,
  offset,
  guides,
  label,
  children,
}: {
  layout: ChequeLayout;
  face: ChequeFace;
  /** How the face fits the fields (useChequeFit). */
  fit: ChequeFit;
  offset?: MmOffset;
  /** Show the fields' outlines: on screen only, or printed too. */
  guides?: 'screen' | 'print';
  label?: string;
  /** Drawn under the fields (a test print's grid). */
  children?: React.ReactNode;
}) {
  const { fields } = layout;
  const wordsDir = layout.wordsLanguage === 'ar' ? 'rtl' : 'ltr';
  return (
    <MmPage
      width={layout.size.width}
      height={layout.size.height}
      offset={offset}
      label={label}
      className="print:ring-0"
    >
      {children}
      {guides ? <Guides layout={layout} print={guides === 'print'} /> : null}
      {face.dateDigits ? (
        <DateBoxes box={fields.date} digits={face.dateDigits} />
      ) : (
        <Text
          box={fields.date}
          text={face.date}
          size={fit.date.size}
          dir="ltr"
          align="center"
          field="date"
        />
      )}
      <Text box={fields.payee} text={face.payee} size={fit.payee.size} dir="auto" field="payee" />
      <Text
        box={fields.wordsLine1}
        text={fit.words.lines[0]}
        size={fit.words.size}
        dir={wordsDir}
        field="words-1"
      />
      <Text
        box={fields.wordsLine2}
        text={fit.words.lines[1]}
        size={fit.words.size}
        dir={wordsDir}
        field="words-2"
      />
      <Text
        box={fields.figures}
        text={face.figures}
        size={fit.figures.size}
        dir="ltr"
        align="center"
        field="figures"
        bold
      />
      {face.crossing && fields.crossing ? (
        <Crossing box={fields.crossing} lines={face.crossing} />
      ) : null}
    </MmPage>
  );
}
