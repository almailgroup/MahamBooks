import { useEffect, useMemo, useRef, useState } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isRtl, t } from '@/i18n';

export interface ColumnSeries {
  key: string;
  label: string;
  /** Validated categorical slot colour (see dataviz palette). */
  color: string;
  values: number[];
}

/** Rounded "nice" axis maximum and step for ~4 gridlines. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  return { top: Math.ceil(max / step) * step, step };
}

/** Column with a 4px rounded data-end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Grouped column chart (one axis, shared currency). Hovering or focusing a
 * period shows every series' value; a table view is always one click away.
 */
export function ColumnChart({
  labels,
  series,
  formatValue,
  formatTick,
  height = 260,
  title,
}: {
  labels: string[];
  series: ColumnSeries[];
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  height?: number;
  title: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values)), [series]);
  const { top, step } = niceScale(max);
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let v = 0; v <= top + step / 2; v += step) list.push(v);
    return list;
  }, [top, step]);

  // Room for the longest tick label (about 6.5px a character at 11px).
  const labelWidth = Math.max(...ticks.map((t) => formatTick(t).length)) * 6.5;
  const margin = { top: 12, right: 8, bottom: 26, left: Math.max(40, Math.ceil(labelWidth) + 12) };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const band = labels.length ? plotW / labels.length : 0;
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => margin.top + plotH - (v / top) * plotH;
  // Thin out x labels when space is tight.
  const labelEvery = band < 34 ? 2 : 1;

  // Place the readout beside the active period so it never covers its columns.
  const onRight = active !== null && active < labels.length / 2;
  const tooltipLeft = active === null ? 0 : margin.left + band * active + (onRight ? band + 8 : -8);

  return (
    <div className="viz-root" style={{ ['--series-gridline' as string]: '#ecebe8' }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul
          className="flex flex-wrap items-center gap-4 text-sm text-slate-600"
          aria-label={t('Legend')}
        >
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 rounded-[3px]"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              {s.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setAsTable((t) => !t)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? t('Show chart') : t('Show table')}
        </button>
      </div>

      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-slate-100 text-start text-xs text-slate-500">
                <th className="py-2 pe-3 font-medium">{t('Month')}</th>
                {series.map((s) => (
                  <th key={s.key} className="py-2 ps-3 text-end font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-slate-50">
              {labels.map((label, i) => (
                <tr key={label}>
                  <td className="py-1.5 pe-3 text-slate-600">{label}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1.5 ps-3 text-end text-slate-900">
                      {formatValue(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapper} className="relative" dir="ltr" onPointerLeave={() => setActive(null)}>
          {width > 0 ? (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={title}
              className="block overflow-visible"
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="var(--series-gridline)"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={margin.left - 8}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="tabular fill-slate-500 text-xs"
                  >
                    {formatTick(t)}
                  </text>
                </g>
              ))}
              {labels.map((label, i) => {
                const gx = margin.left + band * i + (band - groupW) / 2;
                const isActive = active === i;
                return (
                  <g key={label}>
                    {isActive ? (
                      <rect
                        x={margin.left + band * i}
                        y={margin.top}
                        width={band}
                        height={plotH}
                        fill="#f5f5f3"
                      />
                    ) : null}
                    {series.map((s, si) => {
                      const v = s.values[i] ?? 0;
                      const bx = gx + si * (barW + gap);
                      return (
                        <path
                          key={s.key}
                          d={columnPath(bx, y(v), barW, y(0) - y(v))}
                          fill={s.color}
                          opacity={active === null || isActive ? 1 : 0.55}
                        />
                      );
                    })}
                    {i % labelEvery === 0 ? (
                      <text
                        x={margin.left + band * i + band / 2}
                        y={height - 8}
                        textAnchor="middle"
                        className={cn('text-xs', isActive ? 'fill-slate-800' : 'fill-slate-500')}
                      >
                        {label}
                      </text>
                    ) : null}
                    {/* Hit target: the whole band, larger than the marks. */}
                    <rect
                      x={margin.left + band * i}
                      y={margin.top}
                      width={band}
                      height={plotH}
                      fill="transparent"
                      tabIndex={0}
                      role="button"
                      aria-label={t('{label}: {values}', {
                        label,
                        values: series
                          .map((s) => `${s.label} ${formatValue(s.values[i] ?? 0)}`)
                          .join(isRtl() ? '، ' : ', '),
                      })}
                      onPointerEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      className="cursor-default outline-none"
                    />
                  </g>
                );
              })}
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(0)}
                y2={y(0)}
                stroke="#d6d4cf"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            </svg>
          ) : (
            <div style={{ height }} />
          )}

          {active !== null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg"
              style={{
                left: tooltipLeft,
                top: margin.top,
                transform: onRight ? undefined : 'translateX(-100%)',
              }}
            >
              <p className="mb-1 text-xs text-slate-500">{labels[active]}</p>
              {series.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <span
                      className="inline-block h-0.5 w-3 rounded"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </span>
                  <span className="font-semibold text-slate-900">
                    {formatValue(s.values[active] ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
