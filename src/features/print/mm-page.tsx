import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Pages measured in millimetres, for paper that is already cut or printed:
 * label sheets and thermal labels (and cheques later). The browser prints
 * them at their real size: `@page` takes the paper size with no margins, and
 * every box is placed in mm from the top left corner of the paper, whatever
 * the language (the paper doesn't turn round in Arabic). A small offset
 * moves everything to make up for where a printer starts. On screen the
 * pages are shown one under the other, like the sheets they print on.
 */

export interface MmOffset {
  /** Millimetres to the right (negative: to the left). */
  x: number;
  /** Millimetres down (negative: up). */
  y: number;
}

const mm = (value: number) => `${Math.round(value * 100) / 100}mm`;

/** The paper size of the print, with no margins (only one per print), and no notifications on it. */
export function MmPageStyle({ width, height }: { width: number; height: number }) {
  return (
    <style>{`@page { size: ${mm(width)} ${mm(height)}; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  [data-sonner-toaster] { display: none !important; }
}`}</style>
  );
}

/** One sheet of paper. */
export function MmPage({
  width,
  height,
  offset,
  children,
  className,
  label,
}: {
  width: number;
  height: number;
  offset?: MmOffset;
  children: ReactNode;
  className?: string;
  /** Read out for the sheet on screen ("Sheet 2"). */
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      dir="ltr"
      className={cn(
        'paper relative mx-auto overflow-hidden bg-white text-slate-900 shadow-sm ring-1 ring-slate-300 print:mx-0 print:shadow-none print:ring-0',
        'not-last:break-after-page print:break-inside-avoid',
        className,
      )}
      style={{ width: mm(width), height: mm(height) }}
    >
      <div
        className="absolute inset-0"
        style={
          offset && (offset.x || offset.y)
            ? { transform: `translate(${mm(offset.x)}, ${mm(offset.y)})` }
            : undefined
        }
      >
        {children}
      </div>
    </section>
  );
}

/** A box placed on the page, in mm from its top left corner. */
export function MmBox({
  x,
  y,
  width,
  height,
  children,
  className,
  style,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn('absolute overflow-hidden', className)}
      style={{ left: mm(x), top: mm(y), width: mm(width), height: mm(height), ...style }}
    >
      {children}
    </div>
  );
}

/**
 * A grid every `step` mm with the distances written along the edges, to
 * print once and measure how far off the printer is.
 */
export function TestGrid({
  width,
  height,
  step = 10,
}: {
  width: number;
  height: number;
  step?: number;
}) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = step; x < width; x += step) xs.push(x);
  for (let y = step; y < height; y += step) ys.push(y);
  const small = Math.min(width, height) < 60;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={mm(width)}
      height={mm(height)}
      className="absolute inset-0"
      aria-hidden
    >
      <rect
        x={0.25}
        y={0.25}
        width={width - 0.5}
        height={height - 0.5}
        fill="none"
        stroke="#0f172a"
        strokeWidth={0.5}
      />
      {xs.map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} stroke="#94a3b8" strokeWidth={0.2} />
      ))}
      {ys.map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} stroke="#94a3b8" strokeWidth={0.2} />
      ))}
      {xs.map((x) => (
        <text key={`tx${x}`} x={x + 0.6} y={small ? 2.6 : 3.4} fontSize={small ? 2 : 2.8}>
          {x}
        </text>
      ))}
      {ys.map((y) => (
        <text key={`ty${y}`} x={0.8} y={y - 0.6} fontSize={small ? 2 : 2.8}>
          {y}
        </text>
      ))}
    </svg>
  );
}
