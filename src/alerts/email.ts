import type { Client, Company, Employee, ID, ISODate } from '@/db/types';
import { suiteName } from '@/lib/brand';
import { bankName } from '@/lib/cheques';
import { formatDate, formatMoney } from '@/lib/format';
import { parseISODate } from '@/lib/dates';
import { daysLeftLabel, daysText, entryOwner, entryTitle } from '@/features/renewals/text';
import { currentLanguage, interfaceLocale, t, tp } from '@/i18n';
import { localName } from '@/i18n/names';
import { ALERT_TOPICS, TOPIC_LABELS, type Alert, type AlertTone, type AlertTopic } from './collect';

/**
 * The alerts email, in the interface language at the time it is rendered
 * (load the recipient's language first). Plain HTML with inline styles that
 * email programs show the same way, and a text version. Everything taken
 * from the company's records is escaped. Document numbers of employees'
 * papers (Civil ID, passport…) are left out: the email names the paper and
 * the person only.
 */

/** first: the first email after turning alerts on; new: something new since the last one;
 * weekly: Sunday's summary; now: asked for in the app. */
export type AlertEmailKind = 'first' | 'new' | 'weekly' | 'now';

/** Alerts listed per topic; the rest are counted. */
export const MAX_PER_TOPIC = 10;

export interface AlertEmailInput {
  kind: AlertEmailKind;
  company: Company;
  alerts: Alert[];
  /** Keys of the alerts that are new since the last email; null marks none as new. */
  newKeys: ReadonlySet<string> | null;
  /** Where the app is, for the button; empty for no button. */
  appUrl: string;
  /** The recipient's address, named at the bottom. */
  to: string;
  employees: Map<ID, Employee>;
  clients: Map<ID, Pick<Client, 'name' | 'nameAr'>>;
}

export interface AlertEmail {
  subject: string;
  html: string;
  text: string;
}

/** An alert in words: the email's lines, and the list on the app's home. */
export interface AlertLine {
  title: string;
  detail: string;
  status: string;
  tone: AlertTone;
  amount: string;
  isNew: boolean;
}
type Line = AlertLine;

/** Names of the company's people and clients, for the lines. */
export interface AlertLookups {
  company: Company;
  employees: Map<ID, Employee>;
  clients: Map<ID, Pick<Client, 'name' | 'nameAr'>>;
  newKeys?: ReadonlySet<string> | null;
}

const COLORS = {
  page: '#f1f5f9',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  brand: '#4f46e5',
  red: { bg: '#fee2e2', fg: '#b91c1c' },
  amber: { bg: '#fef3c7', fg: '#92400e' },
  new: { bg: '#e0e7ff', fg: '#3730a3' },
};

const FONTS = {
  en: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  ar: "Tahoma, 'Segoe UI', Arial, sans-serif",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only web addresses go in the button. */
export function safeAppUrl(url: string): string {
  const value = url.trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(value)) return '';
  try {
    return new URL(value).toString();
  } catch {
    return '';
  }
}

function formatter(company: Company) {
  const locale = interfaceLocale(company.locale);
  const months = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  return {
    date: (value: ISODate) => formatDate(value, company.dateFormat, locale),
    money: (amount: number, currency: string) =>
      formatMoney(amount, currency, locale, company.currencyDisplay ?? 'local'),
    month: (period: string) => months.format(parseISODate(`${period}-01`)),
  };
}

/** An alert's line, in the interface language. */
export function describeAlert(alert: Alert, lookups: AlertLookups): AlertLine {
  return describe(alert, lookups, formatter(lookups.company));
}

function describe(alert: Alert, input: AlertLookups, fmt: ReturnType<typeof formatter>): Line {
  const isNew = Boolean(input.newKeys?.has(alert.key));
  const base = { tone: alert.tone, isNew, amount: '' };
  const party = (id: ID) => localName(input.clients.get(id) ?? null);
  switch (alert.topic) {
    case 'documents': {
      const { entry } = alert;
      const owner = entryOwner(entry, input.employees, input.company);
      return {
        ...base,
        title: [entryTitle(entry), owner].filter(Boolean).join(' · '),
        detail: alert.expired
          ? `${t('Expired on {date}', { date: fmt.date(alert.date) })} · ${daysText(alert.daysLeft)}`
          : t('Expires on {date}', { date: fmt.date(alert.date) }),
        status: alert.expired ? t('Expired') : daysLeftLabel(alert.daysLeft),
      };
    }
    case 'deadlines': {
      const d = alert.deadline;
      const period =
        d.periodKind === 'month'
          ? t('For {month}', { month: fmt.month(d.period) })
          : t('Year ended {date}', { date: fmt.date(d.period) });
      return {
        ...base,
        title: t(d.title, d.vars),
        detail: `${t('Due {date}', { date: fmt.date(alert.date) })} · ${period}`,
        status: alert.overdue ? t('Overdue') : daysText(alert.daysLeft),
      };
    }
    case 'cheques': {
      const { cheque } = alert.payment;
      const name = cheque.drawer.trim() || party(alert.payment.clientId);
      const number = cheque.number.trim() || '—';
      const title = !name
        ? t('Cheque {number}', { number })
        : alert.received
          ? t('Cheque {number} from {name}', { number, name })
          : t('Cheque {number} to {name}', { number, name });
      return {
        ...base,
        title,
        detail: [
          alert.late ? '' : alert.received ? t('To deposit') : t('To be cashed'),
          bankName(cheque.bank, currentLanguage()),
          t('Dated {date}', { date: fmt.date(cheque.date) }),
        ]
          .filter(Boolean)
          .join(' · '),
        status: alert.late ? t('Not deposited yet') : daysText(alert.daysLeft),
        amount: fmt.money(alert.payment.amount, alert.payment.currency),
      };
    }
    case 'bills': {
      const { doc } = alert;
      const number = doc.vendorReference?.trim() || doc.number;
      const vendor = party(doc.clientId);
      return {
        ...base,
        title: vendor
          ? t('Bill {number} · {vendor}', { number, vendor })
          : t('Bill {number}', { number }),
        detail: t('Due {date}', { date: fmt.date(alert.date) }),
        status: alert.overdue
          ? tp(-alert.daysLeft, '{count} day late', '{count} days late')
          : daysText(alert.daysLeft),
        amount: fmt.money(doc.totals.balance, doc.currency),
      };
    }
    case 'invoices': {
      const { doc } = alert;
      const client = party(doc.clientId);
      return {
        ...base,
        title: client
          ? t('Invoice {number} · {client}', { number: doc.number, client })
          : t('Invoice {number}', { number: doc.number }),
        detail: t('Due {date}', { date: fmt.date(alert.date) }),
        status: tp(-alert.daysLeft, '{count} day overdue', '{count} days overdue'),
        amount: fmt.money(doc.totals.balance, doc.currency),
      };
    }
  }
}

interface Section {
  topic: AlertTopic;
  label: string;
  count: number;
  /** Total of the amounts in the company's currency, for bills and invoices. */
  total: string;
  lines: Line[];
  more: number;
}

function sections(input: AlertEmailInput, fmt: ReturnType<typeof formatter>): Section[] {
  return ALERT_TOPICS.flatMap((topic): Section[] => {
    const alerts = input.alerts.filter((a) => a.topic === topic);
    if (!alerts.length) return [];
    // New ones first, then the most urgent, then the soonest.
    const rank = (a: Alert) => (input.newKeys?.has(a.key) ? 0 : 2) + (a.tone === 'red' ? 0 : 1);
    const sorted = [...alerts].sort(
      (a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
    );
    let total = '';
    if (topic === 'bills' || topic === 'invoices') {
      const sum = alerts.reduce(
        (s, a) =>
          'doc' in a && a.doc.currency === input.company.currency ? s + a.doc.totals.balance : s,
        0,
      );
      if (sum > 0) total = fmt.money(sum, input.company.currency);
    }
    return [
      {
        topic,
        label: t(TOPIC_LABELS[topic]),
        count: alerts.length,
        total,
        lines: sorted.slice(0, MAX_PER_TOPIC).map((a) => describe(a, input, fmt)),
        more: Math.max(0, sorted.length - MAX_PER_TOPIC),
      },
    ];
  });
}

function wording(input: AlertEmailInput) {
  const company = localName(input.company);
  const total = input.alerts.length;
  const fresh = input.newKeys ? input.alerts.filter((a) => input.newKeys!.has(a.key)).length : 0;
  if (total === 0) {
    return {
      subject: t('{company}: nothing needs attention', { company }),
      intro: t('Nothing needs attention in {company} right now.', { company }),
    };
  }
  const subject =
    input.kind === 'new' && fresh > 0
      ? tp(fresh, '{company}: {count} new alert', '{company}: {count} new alerts', { company })
      : tp(
          total,
          '{company}: {count} thing needs attention',
          '{company}: {count} things need attention',
          { company },
        );
  const intro =
    input.kind === 'first'
      ? t('Email alerts are on for {company}. This is everything that needs attention now.', {
          company,
        })
      : input.kind === 'new'
        ? tp(
            fresh,
            'Good morning. {count} new thing needs attention in {company}.',
            'Good morning. {count} new things need attention in {company}.',
            { company },
          )
        : input.kind === 'weekly'
          ? t('Good morning. Your weekly summary of what still needs attention in {company}.', {
              company,
            })
          : t('Everything that needs attention in {company} right now.', { company });
  return { subject, intro };
}

/** The email for these alerts. */
export function renderAlertEmail(input: AlertEmailInput): AlertEmail {
  const ar = currentLanguage() === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const start = ar ? 'right' : 'left';
  const end = ar ? 'left' : 'right';
  const font = ar ? FONTS.ar : FONTS.en;
  const fmt = formatter(input.company);
  const app = suiteName();
  const company = localName(input.company);
  const { subject, intro } = wording(input);
  const list = sections(input, fmt);
  const url = safeAppUrl(input.appUrl);
  const footer = [
    t(
      'You get these emails because you turned on email alerts for {company} in {app}: at 8:00 in the morning (Kuwait time) when something new needs attention, and every Sunday with everything still open.',
      { company, app },
    ),
    t('To change or stop them, open Settings → Email alerts in {app}.', { app }),
    t('Sent to {email}.', { email: input.to }),
  ];
  const more = (n: number) =>
    tp(n, 'And {count} more in {app}.', 'And {count} more in {app}.', { app });

  // Text version.
  const text = [
    `${app} · ${company}`,
    '',
    intro,
    ...list.flatMap((s) => [
      '',
      `${s.label} (${s.count})${s.total ? ` · ${s.total}` : ''}`,
      ...s.lines.flatMap((l) => [
        `- ${l.isNew ? `[${t('New')}] ` : ''}${l.title} · ${l.status}${l.amount ? ` · ${l.amount}` : ''}`,
        `  ${l.detail}`,
      ]),
      ...(s.more ? [more(s.more)] : []),
    ]),
    '',
    ...(url ? [`${t('Open {app}', { app })}: ${url}`, ''] : []),
    ...footer,
  ].join('\n');

  // HTML version.
  const e = escapeHtml;
  const cell = (style: string) => `font-family:${font};color:${COLORS.text};${style}`;
  const pill = (label: string, colors: { bg: string; fg: string }) =>
    `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${colors.bg};color:${colors.fg};font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;">${e(label)}</span>`;
  const row = (l: Line) => `
              <tr>
                <td style="${cell(`padding:10px 0;border-top:1px solid ${COLORS.line};vertical-align:top;text-align:${start};font-size:14px;line-height:20px;`)}">
                  <div style="font-weight:600;">${e(l.title)}${l.isNew ? ` ${pill(t('New'), COLORS.new)}` : ''}</div>
                  <div style="color:${COLORS.muted};font-size:13px;">${e(l.detail)}</div>
                </td>
                <td style="${cell(`padding:10px 0;padding-${start}:12px;border-top:1px solid ${COLORS.line};vertical-align:top;text-align:${end};font-size:13px;line-height:20px;`)}">
                  ${pill(l.status, l.tone === 'red' ? COLORS.red : COLORS.amber)}
                  ${l.amount ? `<div style="font-weight:600;white-space:nowrap;margin-top:4px;">${e(l.amount)}</div>` : ''}
                </td>
              </tr>`;
  const section = (s: Section) => `
        <tr>
          <td style="padding:20px 24px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="${cell(`text-align:${start};font-size:16px;font-weight:700;`)}">${e(s.label)} <span style="color:${COLORS.muted};font-weight:400;">(${s.count})</span></td>
                <td style="${cell(`text-align:${end};font-size:13px;color:${COLORS.muted};white-space:nowrap;`)}">${s.total ? e(t('Total {amount}', { amount: s.total })) : ''}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${s.lines.map(row).join('')}
            </table>${s.more ? `\n            <p style="${cell(`margin:8px 0 0;font-size:13px;color:${COLORS.muted};text-align:${start};`)}">${e(more(s.more))}</p>` : ''}
          </td>
        </tr>`;
  const button = url
    ? `
        <tr>
          <td style="padding:24px;text-align:${start};">
            <a href="${e(url)}" style="display:inline-block;background:${COLORS.brand};color:#ffffff;text-decoration:none;font-family:${font};font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${e(t('Open {app}', { app }))}</a>
          </td>
        </tr>`
    : '';
  const spacer = `
        <tr>
          <td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td>
        </tr>`;
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
            <div style="font-size:13px;font-weight:700;color:${COLORS.brand};">${e(app)}</div>
            <div style="font-size:20px;font-weight:700;margin-top:4px;">${e(company)}</div>
            <p style="margin:12px 0 0;font-size:15px;line-height:22px;color:${COLORS.text};">${e(intro)}</p>
          </td>
        </tr>${list.map(section).join('')}${button || spacer}
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
