import type { Company, Department } from '@/db/types';
import { suiteName } from '@/lib/brand';
import { formatMoney } from '@/lib/format';
import { formatPeriod, type PayGroupTotals, type PayrollBreakdown } from '@/lib/hr/payroll';
import { findDepartment } from '@/lib/hr/departments';
import { currentLanguage, interfaceLocale, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import {
  COLORS,
  escapeHtml,
  FONTS,
  LOGO_HEIGHT,
  LOGO_WIDTH,
  safeAppUrl,
  type AlertEmail,
} from './email';

/**
 * The email to an approver when a pay run is sent for the Super Admin's
 * approval (#10), in the interface language at the time it is rendered
 * (load the recipient's first), right to left in Arabic. It carries the
 * run's totals and its totals by department and position, with groups of
 * one person merged (payrollBreakdown with minGroup 2), and a link that
 * opens the pay run in the signed-in app, where the per-person breakdown is
 * (D14). Never a name of an employee, a Civil ID, an IBAN or anyone's own
 * pay; with fewer than two people in the run, no amounts at all. Opening
 * the link decides nothing.
 */

export interface PayrollApprovalEmailInput {
  company: Company;
  /** The month paid, yyyy-MM. */
  period: string;
  /** The run's lines added up with groups of one merged (minGroup 2). */
  breakdown: PayrollBreakdown;
  /** Last month's posted pay run, to compare; null when there is none. */
  previous: { period: string; employees: number; net: number } | null;
  /** The company's departments, for their Arabic names. */
  departments: readonly Department[];
  /** Who sent it, as the team knows them; empty when not known. */
  requestedBy: string;
  /** Whether the request has a note (read in the app, never emailed). */
  hasNote: boolean;
  /** Where the app is; empty for no link. */
  appUrl: string;
  runId: string;
  /** The recipient's address, named at the bottom. */
  to: string;
}

/** The fewest people a total in the email may stand for. */
export const MIN_PEOPLE_SHOWN = 2;

interface Row {
  label: string;
  totals: PayGroupTotals;
  /** A department's total (bold) or one of its positions. */
  strong: boolean;
}

/** The link that opens the pay run in that company, whichever is open on the device. */
export function payRunLink(appUrl: string, companyId: string, runId: string): string {
  const base = safeAppUrl(appUrl);
  if (!base) return '';
  return `${base}#/payroll/runs/${encodeURIComponent(runId)}?company=${encodeURIComponent(companyId)}`;
}

export function renderPayrollApprovalEmail(input: PayrollApprovalEmailInput): AlertEmail {
  const ar = currentLanguage() === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const start = ar ? 'right' : 'left';
  const end = ar ? 'left' : 'right';
  const font = ar ? FONTS.ar : FONTS.en;
  const locale = interfaceLocale(input.company.locale);
  const money = (amount: number) =>
    formatMoney(amount, input.company.currency, locale, input.company.currencyDisplay ?? 'local');
  const app = suiteName();
  const company = localName(input.company);
  const month = formatPeriod(input.period, locale);
  const { totals } = input.breakdown;
  // One person's pay is never shown: with fewer, no amounts at all.
  const amounts = totals.employees >= MIN_PEOPLE_SHOWN;

  const subject = t('{company}: the payroll for {month} is waiting for your approval', {
    company,
    month,
  });
  const intro = input.requestedBy
    ? t('{name} sent the payroll for {month} for your approval.', {
        name: input.requestedBy,
        month,
      })
    : t('The payroll for {month} was sent for your approval.', { month });
  const people = tp(totals.employees, '{count} employee', '{count} employees');
  const figures: [string, string][] = amounts
    ? [
        [t('Employees'), people],
        [t('Gross pay'), money(totals.gross)],
        [t('Deductions'), money(totals.deductions)],
        [t('Net pay'), money(totals.net)],
        [t('Employer PIFSS'), money(totals.pifssEmployer)],
        [t('Cost to the company'), money(totals.cost)],
      ]
    : [[t('Employees'), people]];

  // The change since last month: left out when exactly one person joined or
  // left, as it would then be about their pay.
  let change = '';
  const previous = input.previous;
  if (amounts && previous && Math.abs(previous.employees - totals.employees) !== 1) {
    const difference = Math.round((totals.net - previous.net) * 1000) / 1000;
    const before = formatPeriod(previous.period, locale);
    change =
      difference > 0
        ? t('Net pay is {amount} more than in {month}.', {
            amount: money(difference),
            month: before,
          })
        : difference < 0
          ? t('Net pay is {amount} less than in {month}.', {
              amount: money(-difference),
              month: before,
            })
          : t('Net pay is the same as in {month}.', { month: before });
  }

  const rows: Row[] = amounts
    ? input.breakdown.departments.flatMap((d) => {
        const listed = d.department ? findDepartment(input.departments, d.department) : null;
        const name =
          d.department === null
            ? t('Other departments')
            : d.department === ''
              ? t('No department')
              : listed
                ? localName(listed)
                : d.department;
        return [
          { label: name, totals: d, strong: true },
          ...d.positions.map((p) => ({
            label:
              p.jobTitle === null
                ? t('Other positions')
                : p.jobTitle === ''
                  ? t('No job title')
                  : (ar && p.jobTitleAr) || p.jobTitle,
            totals: p,
            strong: false,
          })),
        ];
      })
    : [];

  const url = payRunLink(input.appUrl, input.company.id, input.runId);
  const notes = [
    ...(amounts ? [] : [t('Open the pay run in the app to see the amounts.')]),
    ...(input.hasNote ? [t('There is a note with it in the app.')] : []),
    t('Each employee’s pay is in the app only, never in an email.'),
  ];
  const footer = [
    t(
      'You get this email because you approve pay runs for {company} in {app}. Opening the link decides nothing: approve or reject the pay run in the app.',
      { company, app },
    ),
    t('Sent to {email}.', { email: input.to }),
  ];

  // Text version.
  const head = [t('Department and position'), t('Employees'), t('Gross pay'), t('Net pay')];
  const text = [
    `${app} · ${company}`,
    '',
    intro,
    '',
    ...figures.map(([label, value]) => `${label}: ${value}`),
    ...(change ? ['', change] : []),
    ...(rows.length
      ? [
          '',
          head.join(' · '),
          ...rows.map(
            (r) =>
              `${r.strong ? '' : '  - '}${r.label} · ${r.totals.employees} · ${money(r.totals.gross)} · ${money(r.totals.net)}`,
          ),
        ]
      : []),
    '',
    ...notes,
    '',
    ...(url ? [`${t('Open the pay run')}: ${url}`, ''] : []),
    ...footer,
  ].join('\n');

  // HTML version.
  const e = escapeHtml;
  const cell = (style: string) => `font-family:${font};color:${COLORS.text};${style}`;
  const figure = ([label, value]: [string, string]) => `
              <tr>
                <td style="${cell(`padding:6px 0;border-top:1px solid ${COLORS.line};text-align:${start};font-size:14px;color:${COLORS.muted};`)}">${e(label)}</td>
                <td style="${cell(`padding:6px 0;border-top:1px solid ${COLORS.line};text-align:${end};font-size:14px;font-weight:600;white-space:nowrap;`)}">${e(value)}</td>
              </tr>`;
  const th = (label: string, align: string) =>
    `<th style="${cell(`padding:6px 0;padding-${start}:8px;text-align:${align};font-size:12px;font-weight:600;color:${COLORS.muted};`)}">${e(label)}</th>`;
  const row = (r: Row) => `
              <tr>
                <td style="${cell(`padding:6px 0;${r.strong ? '' : `padding-${start}:14px;`}border-top:1px solid ${COLORS.line};text-align:${start};font-size:13px;${r.strong ? 'font-weight:700;' : ''}`)}">${e(r.label)}</td>
                <td style="${cell(`padding:6px 0;padding-${start}:8px;border-top:1px solid ${COLORS.line};text-align:${end};font-size:13px;`)}">${r.totals.employees}</td>
                <td style="${cell(`padding:6px 0;padding-${start}:8px;border-top:1px solid ${COLORS.line};text-align:${end};font-size:13px;white-space:nowrap;`)}">${e(money(r.totals.gross))}</td>
                <td style="${cell(`padding:6px 0;padding-${start}:8px;border-top:1px solid ${COLORS.line};text-align:${end};font-size:13px;white-space:nowrap;${r.strong ? 'font-weight:700;' : ''}`)}">${e(money(r.totals.net))}</td>
              </tr>`;
  const table = rows.length
    ? `
        <tr>
          <td style="padding:16px 24px 0;">
            <div style="${cell(`text-align:${start};font-size:16px;font-weight:700;margin-bottom:6px;`)}">${e(t('By department and position'))}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>${th(head[0], start)}${th(head[1], end)}${th(head[2], end)}${th(head[3], end)}</tr>${rows.map(row).join('')}
            </table>
          </td>
        </tr>`
    : '';
  const button = url
    ? `
        <tr>
          <td style="padding:24px;text-align:${start};">
            <a href="${e(url)}" style="display:inline-block;background:${COLORS.brand};color:#ffffff;text-decoration:none;font-family:${font};font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${e(t('Open the pay run'))}</a>
          </td>
        </tr>`
    : `
        <tr>
          <td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td>
        </tr>`;
  const base = safeAppUrl(input.appUrl);
  const logoUrl = base ? new URL('brand/maham-one-logo-email.png', base).toString() : '';
  const logo = logoUrl
    ? `<img src="${e(logoUrl)}" alt="${e(app)}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="display:block;border:0;outline:none;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;color:${COLORS.brand};font-size:15px;font-weight:700;">`
    : `<div style="font-size:13px;font-weight:700;color:${COLORS.brand};">${e(app)}</div>`;
  const html = `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body dir="${dir}" style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};" dir="${dir}">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${COLORS.card};border-radius:12px;border:1px solid ${COLORS.line};" dir="${dir}">
        <tr>
          <td style="${cell(`padding:24px 24px 0;text-align:${start};`)}">
            ${logo}
            <div style="font-size:20px;font-weight:700;margin-top:4px;">${e(company)}</div>
            <p style="margin:12px 0 0;font-size:15px;line-height:22px;color:${COLORS.text};">${e(intro)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${figures.map(figure).join('')}
            </table>${change ? `\n            <p style="${cell(`margin:10px 0 0;font-size:13px;color:${COLORS.muted};text-align:${start};`)}">${e(change)}</p>` : ''}
          </td>
        </tr>${table}
        <tr>
          <td style="padding:16px 24px 0;">${notes.map((n) => `<p style="${cell(`margin:0 0 6px;font-size:13px;color:${COLORS.muted};text-align:${start};`)}">${e(n)}</p>`).join('')}</td>
        </tr>${button}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;" dir="${dir}">
        <tr>
          <td style="${cell(`padding:16px 24px;text-align:${start};font-size:12px;line-height:18px;color:${COLORS.muted};`)}">${footer.map((f) => `<p style="margin:0 0 6px;">${e(f)}</p>`).join('')}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
  return { subject, html, text };
}
