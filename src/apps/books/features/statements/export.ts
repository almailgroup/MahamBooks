import type { Client, Company } from '@/db/types';
import type { Statement, StatementEntry, StatementEntryKind } from '@/lib/statements';
import { formatDate, formatMoney, formatPercent } from '@/lib/format';
import { fromMinor } from '@/lib/money';
import { interfaceLocale, msg, t } from '@/i18n';
import { ARABIC_LOCALE } from '@/pdf/model';
import { STATEMENT_WORDS, type StatementLanguage } from '@/pdf/statement/words';

/** What each kind of statement line is called in the interface. */
const ENTRY_LABELS: Record<Exclude<StatementEntryKind, 'payment' | 'payment_void'>, string> = {
  invoice: msg('Invoice'),
  bill: msg('Bill'),
  opening: msg('Opening balance'),
  credit: msg('Credit note'),
  vendor_credit: msg('Vendor credit'),
  retention: msg('Retention held'),
  release: msg('Retention released'),
  release_undone: msg('Retention release undone'),
};

const VOID_LABELS = {
  returned: msg('Cheque returned'),
  cancelled: msg('Cheque cancelled'),
  voided: msg('Payment voided'),
};

/** What a statement line is, without its number: "Invoice", "Retention held (5%)"… */
export function entryKindLabel(entry: StatementEntry, side: Statement['side']): string {
  if (entry.kind === 'payment') {
    return side === 'vendor' ? t('Payment made') : t('Payment received');
  }
  if (entry.kind === 'payment_void') return t(VOID_LABELS[entry.voidKind ?? 'voided']);
  const label = t(ENTRY_LABELS[entry.kind]);
  // Intl keeps "5%" in order inside Arabic text.
  return entry.kind === 'retention' && entry.percent
    ? `${label} (${formatPercent(entry.percent, interfaceLocale(undefined))})`
    : label;
}

/** "Invoice INV-2026-0001", "Payment received PAY-0003"… in the interface language. */
export function entryLabel(entry: StatementEntry, side: Statement['side']): string {
  return `${entryKindLabel(entry, side)} ${entry.number}`;
}

/**
 * Aging columns of a statement. Written out ("1 to 30 days") because a
 * range like "1–30" reads backwards inside Arabic text.
 */
export const STATEMENT_AGING = [
  msg('Not yet due'),
  msg('1 to 30 days'),
  msg('31 to 60 days'),
  msg('61 to 90 days'),
  msg('Over 90 days'),
] as const;

/** The statement as CSV rows, amounts with the currency's decimals. */
export function statementCsv(
  statement: Statement,
  date: (value: string | null) => string,
): { headers: string[]; rows: (string | number)[][] } {
  const p = statement.precision;
  const amount = (minor: number) => (minor === 0 ? '' : fromMinor(minor, p).toFixed(p));
  const balance = (minor: number) => fromMinor(minor, p).toFixed(p);
  return {
    headers: [
      t('Date'),
      t('Description'),
      t('Reference'),
      t('Due date'),
      t('Debit'),
      t('Credit'),
      t('Balance'),
    ],
    rows: [
      [
        date(statement.from),
        t('Balance brought forward'),
        '',
        '',
        '',
        '',
        balance(statement.opening),
      ],
      ...statement.entries.map((e) => [
        date(e.date),
        entryLabel(e, statement.side),
        e.reference,
        date(e.dueDate),
        amount(e.debit),
        amount(e.credit),
        balance(e.balance),
      ]),
      [
        date(statement.to),
        t('Closing balance'),
        '',
        '',
        balance(statement.debits),
        balance(statement.credits),
        balance(statement.closing),
      ],
    ],
  };
}

/**
 * A file name, e.g. "Statement CL-0007 2026-08-01 to 2026-08-31". Kept to
 * plain ASCII: browsers drop download names with other letters.
 */
export function statementFileName(contact: Pick<Client, 'number' | 'id'>, statement: Statement) {
  const id = contact.number.replace(/[^\w.-]+/g, '') || contact.id.slice(0, 8);
  return `Statement ${id} ${statement.from} to ${statement.to}`;
}

/**
 * The WhatsApp message sent with a statement, in the statement's language
 * (both on bilingual statements): period, balance due, retention and
 * cheques not yet cleared.
 */
export function statementMessage(
  statement: Statement,
  company: Pick<Company, 'name' | 'nameAr' | 'dateFormat' | 'locale' | 'currencyDisplay'>,
  contact: Pick<Client, 'name' | 'nameAr'>,
  language: StatementLanguage,
): string {
  const part = (lang: 'ar' | 'en') => {
    const words = STATEMENT_WORDS[lang];
    const locale = lang === 'ar' ? ARABIC_LOCALE : company.locale || 'en-KW';
    const money = (minor: number) =>
      formatMoney(
        fromMinor(minor, statement.precision),
        statement.currency,
        locale,
        company.currencyDisplay ?? 'local',
      );
    const date = (d: string) => formatDate(d, company.dateFormat, locale);
    const companyName = lang === 'ar' && company.nameAr?.trim() ? company.nameAr : company.name;
    const contactName = lang === 'ar' && contact.nameAr?.trim() ? contact.nameAr : contact.name;
    const due = statement.closing < 0 ? words.inCredit : words.balanceDue;
    return [
      `${words.title} – ${companyName}`,
      contactName,
      `${words.period}: ${date(statement.from)} – ${date(statement.to)}`,
      `${due}: ${money(Math.abs(statement.closing))}`,
      statement.retentionHeld ? `${words.retentionHeld}: ${money(statement.retentionHeld)}` : '',
      statement.chequesTotal ? `${words.cheques}: ${money(statement.chequesTotal)}` : '',
      words.note,
    ]
      .filter(Boolean)
      .join('\n');
  };
  if (language === 'ar') return part('ar');
  if (language === 'en') return part('en');
  return `${part('ar')}\n\n${part('en')}`;
}
