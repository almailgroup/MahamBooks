import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart as LineIcon, Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isRtl, t } from '@/i18n';

export interface LineSeries {
  key: string;
  label: string;
  /**
   * Validated categorical slot colour (see dataviz palette), usually a theme
   * variable such as `var(--color-chart-1)`.
   */
  color: string;
  values: number[];
}

/** Rounded "nice" axis bounds and step for ~4 gridlines, always including zero. */
export function niceRange(min: number, max: number): { bottom: number; top: number; step: number } {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi - lo <= 0) return { bottom: 0, top: 1, step: 0.25 };
  const rough = (hi - lo) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  return { bottom: Math.floor(lo / step) * step, top: Math.ceil(hi / step) * step, step };
}

/**
 * Line chart on one axis (a balance month by month, which can go below
 * zero). Like the column chart, time runs left to right in both languages;
 * a crosshair follows the pointer or the focused month and shows every
 * series' value, and a table view is one click away.
 */
export function LineChart({
  labels,
  series,
  formatValue,
  formatTick,
  height = 220,
  title,
}: {
  labels: string[];
  series: LineSeries[];
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
  }, [asTable]);

  const values = useMemo(() => series.flatMap((s) => s.values), [series]);
  const { bottom, top, step } = niceRange(Math.min(0, ...values), Math.max(0, ...values));
  const ticks = useMemo(() => {
    const list: number[] = [];
    const count = Math.round((top - bottom) / step);
    for (let i = 0; i <= count; i++) list.push(Number((bottom + i * step).toPrecision(12)));
    return list;
  }, [bottom, top, step]);

  // Room for the longest tick label (about 6.5px a character at 11px).
  const labelWidth = Math.max(...ticks.map((v) => formatTick(v).length)) * 6.5;
  const margin = { top: 12, right: 8, bottom: 26, left: Math.max(40, Math.ceil(labelWidth) + 12) };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const band = labels.length ? plotW / labels.length : 0;
  const x = (i: number) => margin.left + band * i + band / 2;
  const y = (v: number) => margin.top + plotH - ((v - bottom) / (top - bottom)) * plotH;
  const labelEvery = band < 34 ? 2 : 1;
  const last = labels.length - 1;

  const onRight = active !== null && active < labels.length / 2;
  const tooltipLeft = active === null ? 0 : x(active) + (onRight ? 12 : -12);

  return (
    <div className="viz-root">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {series.length > 1 ? (
          <ul
            className="flex flex-wrap items-center gap-4 text-sm text-slate-600"
            aria-label={t('Legend')}
          >
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  className="inline-block h-0.5 w-3 rounded"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {asTable ? <LineIcon className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? t('Show chart') : t('Show table')}
        </button>
      </div>

      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-slate-100 text-start text-xs text-slate-500">
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {t('Month')}
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-2 ps-3 text-end font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-slate-50">
              {labels.map((label, i) => (
                <tr key={`${label}-${i}`}>
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
              {ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={y(v)}
                    y2={y(v)}
                    stroke={v === 0 ? 'var(--color-chart-axis)' : 'var(--color-chart-grid)'}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                    data-zero={v === 0 ? '' : undefined}
                  />
                  <text
                    x={margin.left - 8}
                    y={y(v)}
                    dy="0.32em"
                    textAnchor="end"
                    className="tabular fill-slate-500 text-xs"
                  >
                    {formatTick(v)}
                  </text>
                </g>
              ))}
              {active !== null ? (
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={margin.top}
                  y2={margin.top + plotH}
                  stroke="var(--color-chart-axis)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              ) : null}
              {series.map((s) => (
                <path
                  key={s.key}
                  d={labels
                    .map((_, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.values[i] ?? 0)}`)
                    .join('')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {/* The end of each line, and every line at the month in focus. */}
              {series.map((s) =>
                [last, ...(active !== null && active !== last ? [active] : [])].map((i) =>
                  i >= 0 ? (
                    <circle
                      key={`${s.key}-${i}`}
                      cx={x(i)}
                      cy={y(s.values[i] ?? 0)}
                      r={4}
                      fill={s.color}
                      stroke="var(--color-surface)"
                      strokeWidth={2}
                      data-point={i}
                    />
                  ) : null,
                ),
              )}
              {labels.map((label, i) => (
                <g key={`${label}-${i}`}>
                  {i % labelEvery === 0 ? (
                    <text
                      x={x(i)}
                      y={height - 8}
                      textAnchor="middle"
                      className={cn('text-xs', active === i ? 'fill-slate-800' : 'fill-slate-500')}
                    >
                      {label}
                    </text>
                  ) : null}
                  {/* Hit target: the whole month, larger than the line. */}
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
              ))}
            </svg>
          ) : (
            <div style={{ height }} />
          )}

          {active !== null ? (
            // The month in focus already reads its values out (its label).
            <div
              aria-hidden
              data-tooltip=""
              className="bg-surface pointer-events-none absolute top-0 z-10 min-w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-lg"
              dir={isRtl() ? 'rtl' : 'ltr'}
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
