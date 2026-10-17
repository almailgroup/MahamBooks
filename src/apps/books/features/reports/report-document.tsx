import { Link } from 'react-router';
import type { ID } from '@/db/types';
import { useCompany } from '@/app/company';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { msg } from '@/i18n';
import { columnHeading, rowLabel, subtitleText, type ReportModel, type ReportRow } from './model';
import { useReportText, type ReportText } from './report-language';

const ROW_STYLE: Record<ReportRow['kind'], string> = {
  heading: 'pt-6 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase',
  section: 'pt-4 pb-1 font-semibold text-slate-900',
  caption: 'py-1.5 text-slate-800',
  detail: 'py-1 text-[13px] text-slate-600',
  subtotal: 'border-t border-slate-200 py-2 font-medium text-slate-900',
  total: 'border-t border-slate-300 py-2 font-semibold text-slate-900',
  grand: 'border-y-2 border-slate-300 bg-slate-50 py-2.5 font-semibold text-slate-900',
};

/** A figure as statements show it: brackets for negatives, a dash for nothing. */
export function statementFigure(
  value: number | null | undefined,
  style: ReportModel['style'],
  text: ReportText,
): string {
  if (value === null || value === undefined) return '';
  if (value === 0) return style === 'ledger' ? '' : '–';
  return value < 0 ? `(${text.amount(-value)})` : text.amount(value);
}

function Label({ row, text, link }: { row: ReportRow; text: ReportText; link: string | null }) {
  const content = (
    <>
      {row.record?.code ? (
        <span className="tabular me-2 text-slate-500">{row.record.code}</span>
      ) : null}
      {/* Isolated: an English name would run into the code in Arabic. */}
      <bdi>{rowLabel(row, text)}</bdi>
    </>
  );
  return link ? (
    <Link to={link} className="hover:text-primary-700 hover:underline">
      {content}
    </Link>
  ) : (
    content
  );
}

function Row({
  row,
  model,
  primary,
  secondary,
  link,
  hover,
}: {
  row: ReportRow;
  model: ReportModel;
  primary: ReportText;
  secondary: ReportText | null;
  link: string | null;
  hover: boolean;
}) {
  const indent = row.kind === 'detail' ? 'ps-8' : 'ps-5';
  return (
    <tr
      className={cn(ROW_STYLE[row.kind], hover && row.kind !== 'heading' && 'hover:bg-slate-50/80')}
    >
      <td className={cn(indent, 'pe-3 align-top')}>
        <Label row={row} text={primary} link={link} />
      </td>
      {model.columns.map((_, i) => (
        <td key={i} className="tabular px-3 text-end align-top whitespace-nowrap last:pe-5">
          {statementFigure(row.values[i], model.style, primary)}
        </td>
      ))}
      {secondary ? (
        <td dir="rtl" lang="ar" className={cn(indent, 'pe-3 text-start align-top')}>
          <Label row={row} text={secondary} link={null} />
        </td>
      ) : null}
    </tr>
  );
}

/**
 * A report laid out as a financial statement: company, title and period,
 * then the rows. In the bilingual layout English is on the left, the figures
 * in the middle and Arabic on the right.
 */
export function ReportDocument({
  model,
  mode = 'screen',
  accountLink,
}: {
  model: ReportModel;
  mode?: 'screen' | 'print';
  accountLink?: (accountId: ID) => string;
}) {
  const company = useCompany();
  const { primary, secondary } = useReportText();
  const texts = secondary ? [primary, secondary] : [primary];
  const wide = model.columns.length > 3;
  // The final total goes in the table footer, so it repeats nowhere and reads as the result.
  const last = model.rows.at(-1);
  const footer = last?.kind === 'grand' ? last : null;
  const body = footer ? model.rows.slice(0, -1) : model.rows;
  const link = (row: ReportRow) =>
    mode === 'screen' && accountLink && row.accountId ? accountLink(row.accountId) : null;

  return (
    <div
      dir={secondary ? 'ltr' : primary.dir}
      lang={secondary ? 'en' : primary.language}
      className={cn(mode === 'print' && 'print-page text-[12px]')}
    >
      <header className="px-5 pt-6 pb-4 text-center">
        {texts.map((text, i) => (
          <div key={text.language} dir={text.dir} lang={text.language} className="space-y-0.5">
            {i === 0 ||
            localName(company, text.language) !== localName(company, primary.language) ? (
              <p className="text-sm text-slate-500">{localName(company, text.language)}</p>
            ) : null}
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              {text.t(model.title)}
            </h2>
            <p className="text-sm text-slate-600">{subtitleText(model.subtitle, text)}</p>
          </div>
        ))}
        <p className="mt-1 text-xs text-slate-500">
          {texts
            .map((text) => text.t(msg('Amounts in {currency}'), { currency: text.currencyName }))
            .join(' · ')}
        </p>
      </header>
      <div className={cn(mode === 'screen' && 'overflow-x-auto')}>
        <table className={cn('w-full text-sm', wide && mode === 'screen' && 'min-w-[880px]')}>
          <thead>
            <tr className="border-y border-slate-200 text-xs text-slate-500">
              <th className="px-5 py-2 text-start font-medium">
                <span className="sr-only">{primary.t(msg('Description'))}</span>
              </th>
              {model.columns.map((column, i) => (
                <th
                  key={i}
                  className={cn(
                    'px-3 py-2 text-end font-medium last:pe-5',
                    wide ? 'w-24 align-bottom' : 'w-32 whitespace-nowrap sm:w-40',
                  )}
                >
                  {columnHeading(column, primary)}
                  {secondary && column.kind === 'label' ? (
                    <span className="block" dir="rtl" lang="ar">
                      {columnHeading(column, secondary)}
                    </span>
                  ) : null}
                </th>
              ))}
              {secondary ? (
                <th className="px-5 py-2 text-end font-medium" dir="rtl" lang="ar">
                  <span className="sr-only">{secondary.t(msg('Description'))}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {body.map((row) => (
              <Row
                key={row.key}
                row={row}
                model={model}
                primary={primary}
                secondary={secondary}
                link={link(row)}
                hover={mode === 'screen'}
              />
            ))}
          </tbody>
          {footer ? (
            <tfoot>
              <Row
                row={footer}
                model={model}
                primary={primary}
                secondary={secondary}
                link={null}
                hover={false}
              />
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
