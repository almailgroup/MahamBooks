import { useState } from 'react';
import { Link } from 'react-router';
import { ChartBarBig, Table2 } from 'lucide-react';
import { t } from '@/i18n';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Where the row leads (the account's ledger); rows without one are plain text. */
  to?: string;
}

/**
 * Ranked horizontal bars of one measure (top expenses). Each bar grows from
 * the start of the line, so it mirrors in Arabic, and carries its value as
 * text beside it; the table view adds each row's share of the total.
 */
export function BarList({
  rows,
  formatValue,
  formatShare,
  title,
  color = 'var(--color-chart-1)',
  nameLabel,
}: {
  rows: BarRow[];
  formatValue: (value: number) => string;
  formatShare: (share: number) => string;
  title: string;
  /** Validated categorical slot colour (see dataviz palette). */
  color?: string;
  /** Heading of the names column in the table view. */
  nameLabel: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(0, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);

  return (
    <div className="viz-root">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {asTable ? <ChartBarBig className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? t('Show chart') : t('Show table')}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500">
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  {nameLabel}
                </th>
                <th scope="col" className="py-2 ps-3 text-end font-medium">
                  {t('Amount')}
                </th>
                <th scope="col" className="py-2 ps-3 text-end font-medium">
                  {t('Share')}
                </th>
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-slate-50">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td dir="auto" className="py-1.5 pe-3 text-start text-slate-600">
                    {row.label}
                  </td>
                  <td className="py-1.5 ps-3 text-end text-slate-900">{formatValue(row.value)}</td>
                  <td className="py-1.5 ps-3 text-end text-slate-600">
                    {formatShare(total > 0 ? Math.max(0, row.value) / total : 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label={title} className="space-y-1">
          {rows.map((row) => {
            const width = max > 0 ? (Math.max(0, row.value) / max) * 100 : 0;
            const body = (
              <>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span dir="auto" className="min-w-0 truncate text-slate-700">
                    {row.label}
                  </span>
                  <span className="tabular shrink-0 font-medium text-slate-900">
                    {formatValue(row.value)}
                  </span>
                </span>
                <span className="mt-1.5 block h-2">
                  {/* Rounded at the data end, square where it starts. */}
                  <span
                    className="block h-full rounded-e"
                    style={{ width: `${width}%`, backgroundColor: color }}
                    aria-hidden
                  />
                </span>
              </>
            );
            return (
              <li key={row.key}>
                {row.to ? (
                  <Link
                    to={row.to}
                    className="-mx-2 block rounded-md px-2 py-1.5 hover:bg-slate-50 pointer-coarse:min-h-11"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
