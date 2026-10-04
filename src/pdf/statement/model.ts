import type { Client, Company } from '@/db/types';
import type { Statement, StatementEntry } from '@/lib/statements';
import { bankName } from '@/lib/cheques';
import { normalizeHex } from '@/lib/color';
import { formatAmount, formatDate, formatMoney, formatPercent } from '@/lib/format';
import { formatAddressLines } from '@/lib/geo';
import { fromMinor } from '@/lib/money';
import { amountInWords } from '@/lib/words';
import { isISODate } from '@/lib/dates';
import { ltr } from '../bidi';
import { ARABIC_LOCALE, relabelBankDetails } from '../model';
import { documentLabels } from '../labels';
import { STATEMENT_WORDS, type StatementLanguage, type StatementWords } from './words';

/** A printed phrase: the main language, and English under it on bilingual statements. */
export interface Phrase {
  text: string;
  /** Empty unless the statement is bilingual. */
  secondary: string;
}

export interface StatementRow {
  key: string;
  date: string;
  title: Phrase;
  reference: string;
  dueDate: string;
  debit: string;
  credit: string;
  balance: string;
  /** Lines that are not money changing hands: retentions, reversals. */
  muted: boolean;
}

export interface StatementRenderModel {
  language: StatementLanguage;
  dir: 'rtl' | 'ltr';
  documentTitle: string;
  accent: string;
  title: Phrase;
  company: {
    name: string;
    nameSecondary: string;
    lines: string[];
    logo: string | null;
    stamp: string | null;
    signature: string | null;
  };
  contact: { label: Phrase; name: string; nameSecondary: string; lines: string[] };
  meta: { label: Phrase; value: string }[];
  summaryTitle: Phrase;
  summary: { label: Phrase; value: string; strong?: boolean }[];
  columns: Record<
    'date' | 'description' | 'reference' | 'dueDate' | 'debit' | 'credit' | 'balance',
    Phrase
  >;
  opening: { label: Phrase; balance: string };
  rows: StatementRow[];
  closing: { label: Phrase; debit: string; credit: string; balance: string };
  empty: Phrase | null;
  aging: {
    title: Phrase;
    headers: Phrase[];
    values: string[];
    unapplied: { label: Phrase; value: string } | null;
  };
  cheques: {
    title: Phrase;
    note: Phrase;
    headers: Phrase[];
    rows: { key: string; cells: string[] }[];
    total: { label: Phrase; value: string };
  } | null;
  retention: { label: Phrase; value: string } | null;
  /** Balance due in words (Arabic first on bilingual statements). */
  words: string[];
  note: Phrase;
  signatures: { company: Phrase; contact: Phrase };
  bankDetails: { label: Phrase; text: string } | null;
  page: Phrase;
  of: Phrase;
  footer: string;
}

const arabicLongDate = new Intl.DateTimeFormat(ARABIC_LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const clean = (s: string | null | undefined) => (s ?? '').trim();

export interface StatementModelOptions {
  language: StatementLanguage;
  /** The day the statement is printed. */
  printedOn: string;
}

/** Everything a statement PDF prints, worked out once in its language. */
export function buildStatementModel(
  statement: Statement,
  company: Company,
  contact: Client,
  options: StatementModelOptions,
): StatementRenderModel {
  const { language } = options;
  const rtl = language !== 'en';
  const words: StatementWords = STATEMENT_WORDS[rtl ? 'ar' : 'en'];
  const english: StatementWords | null = language === 'ar-en' ? STATEMENT_WORDS.en : null;
  const phrase = (key: keyof StatementWords): Phrase => ({
    text: words[key],
    secondary: english ? english[key] : '',
  });
  // Arabic statements write amounts the Arabic way ("1,234.500 د.ك"); bilingual
  // ones keep "KD 1,234.500", which both readers know.
  const locale = language === 'ar' ? ARABIC_LOCALE : company.locale || 'en-KW';
  const display = company.currencyDisplay ?? 'local';
  const { currency, precision } = statement;
  const major = (minor: number) => fromMinor(minor, precision);
  const money = (minor: number) => formatMoney(major(minor), currency, locale, display);
  const amount = (minor: number) =>
    minor === 0 ? '' : formatAmount(major(minor), currency, locale);
  const balance = (minor: number) => formatAmount(major(minor), currency, locale);
  const date = (d: string | null | undefined) => {
    if (!d) return '';
    if (language === 'ar' && company.dateFormat.includes('MMM') && isISODate(d)) {
      return arabicLongDate.format(new Date(`${d}T00:00:00Z`));
    }
    return formatDate(d, company.dateFormat, locale);
  };
  const vendor = statement.side === 'vendor';

  const name = (record: { name: string; nameAr?: string }) => {
    const ar = clean(record.nameAr);
    if (rtl && ar) {
      return {
        name: ar,
        nameSecondary: language === 'ar-en' && ar !== record.name ? record.name : '',
      };
    }
    return { name: record.name, nameSecondary: '' };
  };

  const entryTitle = (e: StatementEntry): Phrase => {
    const key: keyof StatementWords =
      e.kind === 'invoice'
        ? 'invoice'
        : e.kind === 'bill'
          ? 'bill'
          : e.kind === 'opening'
            ? 'opening_doc'
            : e.kind === 'credit'
              ? 'credit_note'
              : e.kind === 'vendor_credit'
                ? 'vendor_credit'
                : e.kind === 'retention'
                  ? 'retention'
                  : e.kind === 'release'
                    ? 'release'
                    : e.kind === 'release_undone'
                      ? 'release_undone'
                      : e.kind === 'payment'
                        ? vendor
                          ? 'payment_out'
                          : 'payment_in'
                        : (e.voidKind ?? 'voided');
    // Intl keeps "5%" in order inside Arabic text (it adds direction marks).
    const percent = (lang: string) =>
      e.kind === 'retention' && e.percent ? ` ${formatPercent(e.percent, lang)}` : '';
    return {
      text: `${words[key]}${percent(rtl ? ARABIC_LOCALE : locale)} ${ltr(e.number)}`,
      secondary: english ? `${english[key]}${percent('en')}` : '',
    };
  };

  const chequeRef = (e: StatementEntry) =>
    e.cheque
      ? [e.cheque.number, bankName(e.cheque.bank, rtl ? 'ar' : 'en')].filter(Boolean).join(' · ')
      : e.reference;

  const rows: StatementRow[] = statement.entries.map((e) => ({
    key: e.key,
    date: date(e.date),
    title: entryTitle(e),
    reference: chequeRef(e),
    dueDate: date(e.dueDate),
    debit: amount(e.debit),
    credit: amount(e.credit),
    balance: balance(e.balance),
    muted: e.kind === 'retention' || e.kind === 'release_undone' || e.voided,
  }));

  const companyName = name({ name: company.name, nameAr: company.nameAr });
  const addressLocale = rtl ? 'ar-KW' : locale;
  const companyLines = [
    formatAddressLines(company.address, addressLocale, false).join(rtl ? '، ' : ', '),
    [clean(company.phone) && ltr(clean(company.phone)), clean(company.email)]
      .filter(Boolean)
      .join('  ·  '),
    clean(company.registrationNumber)
      ? `${words.cr} ${ltr(clean(company.registrationNumber))}`
      : '',
  ].filter(Boolean);

  const contactName = name(contact);
  const primary = contact.contacts.find((c) => c.primary) ?? contact.contacts[0];
  const contactLines = [
    ...formatAddressLines(
      contact.address,
      addressLocale,
      contact.address.country !== company.address.country,
    ),
    [
      clean(contact.phone || primary?.phone) && ltr(clean(contact.phone || primary?.phone)),
      clean(contact.email || primary?.email),
    ]
      .filter(Boolean)
      .join('  ·  '),
    clean(contact.civilId) ? `${words.civilId} ${ltr(clean(contact.civilId))}` : '',
  ].filter(Boolean);

  const closingLabel = statement.closing < 0 ? phrase('inCredit') : phrase('balanceDue');
  const summary: StatementRenderModel['summary'] = [
    { label: phrase('opening'), value: money(statement.opening) },
    { label: phrase('debits'), value: money(statement.debits) },
    { label: phrase('credits'), value: money(statement.credits) },
    { label: closingLabel, value: money(Math.abs(statement.closing)), strong: true },
  ];

  const agingHeaders: (keyof StatementWords)[] = [
    'agingCurrent',
    'aging30',
    'aging60',
    'aging90',
    'agingOver',
    'total',
  ];
  const openTotal = statement.aging.buckets.reduce((a, b) => a + b, 0);

  const cheques = statement.cheques.length
    ? {
        title: phrase('cheques'),
        note: phrase('chequesNote'),
        headers: (['chequeNumber', 'bank', 'chequeDate', 'amount'] as const).map(phrase),
        rows: statement.cheques.map((c) => ({
          key: c.paymentId,
          cells: [
            ltr(c.chequeNumber),
            bankName(c.bank, rtl ? 'ar' : 'en'),
            date(c.date),
            balance(c.amount),
          ],
        })),
        total: { label: phrase('total'), value: money(statement.chequesTotal) },
      }
    : null;

  const due = major(Math.max(statement.closing, 0));
  const amountWords: string[] = [];
  if (due > 0 && currency) {
    if (rtl) amountWords.push(amountInWords(due, currency, 'ar'));
    if (language !== 'ar') amountWords.push(amountInWords(due, currency, 'en'));
  }

  const period = `${date(statement.from)} – ${date(statement.to)}`;
  const printed = documentLabels(language, company.labels);
  const bankText = relabelBankDetails(
    clean(company.payment?.bankDetails),
    printed.primary,
    printed.secondary,
    [],
    rtl,
  );
  const title = phrase('title');
  return {
    language,
    dir: rtl ? 'rtl' : 'ltr',
    documentTitle: `${english ? english.title : words.title} – ${contact.name}`,
    accent: normalizeHex(company.branding.accentColor),
    title,
    company: {
      ...companyName,
      lines: companyLines,
      logo: company.branding.logo,
      stamp: company.branding.stamp ?? null,
      signature: company.branding.signature ?? null,
    },
    contact: {
      label: phrase(vendor ? 'vendor' : 'customer'),
      ...contactName,
      lines: contactLines,
    },
    meta: [
      { label: phrase('statementDate'), value: date(options.printedOn) },
      { label: phrase('period'), value: period },
      { label: phrase('accountNumber'), value: ltr(contact.number) },
      { label: phrase('currency'), value: currency },
    ].filter((m) => m.value),
    summaryTitle: phrase('summary'),
    summary,
    columns: {
      date: phrase('date'),
      description: phrase('description'),
      reference: phrase('reference'),
      dueDate: phrase('dueDate'),
      debit: phrase('debit'),
      credit: phrase('credit'),
      balance: phrase('balance'),
    },
    opening: { label: phrase('broughtForward'), balance: balance(statement.opening) },
    rows,
    closing: {
      label: phrase('carriedForward'),
      debit: balance(statement.debits),
      credit: balance(statement.credits),
      balance: balance(statement.closing),
    },
    empty: rows.length === 0 ? phrase('noTransactions') : null,
    aging: {
      title: phrase('aging'),
      headers: agingHeaders.map(phrase),
      values: [...statement.aging.buckets.map(balance), balance(openTotal)],
      unapplied:
        statement.aging.unapplied !== 0
          ? { label: phrase('unapplied'), value: balance(-statement.aging.unapplied) }
          : null,
    },
    cheques,
    retention:
      statement.retentionHeld !== 0
        ? { label: phrase('retentionHeld'), value: money(statement.retentionHeld) }
        : null,
    words: amountWords,
    note: phrase('note'),
    signatures: {
      company: phrase('companySignature'),
      contact: phrase(vendor ? 'vendorConfirmation' : 'customerConfirmation'),
    },
    bankDetails: bankText && !vendor ? { label: phrase('bankDetails'), text: bankText } : null,
    page: phrase('page'),
    of: phrase('of'),
    footer: [clean(company.legalName) || company.name, clean(company.website)]
      .filter(Boolean)
      .join('  ·  '),
  };
}
