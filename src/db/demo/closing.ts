import { db } from '../db';
import { closeYear, loadLedger } from '../accounting';
import { importStatement, matchTransaction } from '../banking';
import { accountingSettings } from '../chart-setup';
import type { BankMatch, ISODate } from '../types';
import { bookEntries } from '@/lib/banking/match';
import type { StatementLine } from '@/lib/banking/statement';
import { specialAccounts } from '@/lib/accounting/statements';
import { levyRates, yearEndFigures } from '@/lib/accounting/year-end';
import { fiscalYearEndIn } from '@/lib/compliance';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import { fromMinor, toMinor } from '@/lib/money';
import { addDaysISO } from '@/lib/dates';
import type { DemoBooks } from './books';
import { Calendar } from './calendar';

const P = 3;

/**
 * The NBK e-statement for the last six weeks, imported and matched to the
 * books, except three lines still to deal with: a customer's transfer for
 * an open invoice, the bank's SWIFT charges and a transfer to KFH.
 */
export async function importNbkStatement(books: DemoBooks): Promise<void> {
  const cal = books.calendar;
  const company = await books.refresh();
  const nbk = books.money('nbk');
  const { lines } = await loadLedger(company);
  const from = cal.ago(42);
  const to = cal.ago(1);
  const entries = bookEntries(lines, nbk)
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));

  const [payments, expenses, journals, clients] = await Promise.all([
    db.payments.where('companyId').equals(books.id).toArray(),
    db.expenses.where('companyId').equals(books.id).toArray(),
    db.journals.where('companyId').equals(books.id).toArray(),
    db.clients.where('companyId').equals(books.id).toArray(),
  ]);
  const name = (id: string | null | undefined) =>
    (clients.find((c) => c.id === id)?.name ?? '').toUpperCase();
  const statement: (StatementLine & { match?: BankMatch })[] = entries.map((entry) => {
    let description = entry.description.toUpperCase();
    let reference = '';
    if (entry.source === 'payment') {
      const p = payments.find((x) => x.id === entry.id);
      description = `${entry.amount > 0 ? 'TRF FROM' : 'TRF TO'} ${name(p?.clientId)}`.trim();
      reference = p?.reference ?? '';
    } else if (entry.source === 'expense') {
      const e = expenses.find((x) => x.id === entry.id);
      description = (e?.description ?? description).toUpperCase();
      reference = e?.reference ?? '';
    } else {
      const j = journals.find((x) => x.id === entry.id);
      description = (j?.reference ?? description).toUpperCase();
    }
    return {
      date: entry.date,
      description,
      reference,
      amount: fromMinor(entry.amount, P),
      balance: null,
      match: { source: entry.source as BankMatch['source'], id: entry.id },
    };
  });

  // Still to match: Sadu's transfer for its latest invoice, SWIFT charges, a transfer to KFH.
  const sadu = (await db.documents.where('clientId').equals(books.customers.sadu.id).toArray())
    .filter((d) => d.type === 'invoice' && d.status === 'sent')
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];
  const banked = (date: ISODate) => (date > to ? to : date);
  if (sadu) {
    statement.push({
      date: banked(cal.workday(cal.ago(2))),
      description: `TRF FROM SADU INTERIORS CO. ${sadu.number}`,
      reference: 'IBAN KW71 GULB',
      amount: sadu.totals.balance,
      balance: null,
    });
  }
  statement.push(
    {
      date: banked(cal.workday(cal.ago(5))),
      description: 'SWIFT CHARGES',
      reference: 'FT2219874',
      amount: -6.5,
      balance: null,
    },
    {
      date: banked(cal.workday(cal.ago(3))),
      description: 'TRANSFER TO KFH ACCOUNT 0731005248',
      reference: 'IB-TRF',
      amount: -1500,
      balance: null,
    },
  );
  statement.sort((a, b) => a.date.localeCompare(b.date));

  // Running balance, from the books on the day before the statement starts.
  let balance = lines
    .filter((l) => l.accountId === nbk && l.date < from)
    .reduce((s, l) => s + l.amount, 0);
  for (const line of statement) {
    balance += toMinor(line.amount, P);
    line.balance = fromMinor(balance, P);
  }
  const { transactions } = await importStatement(
    books.id,
    nbk,
    statement.map(({ match: _match, ...line }) => line),
    'NBK e-statement.csv',
  );
  for (const tx of transactions) {
    const match = statement[tx.position].match;
    if (match) await matchTransaction(tx.id, match);
  }
}

/**
 * Closes last year: the statutory reserve takes 10% of the profit (a W.L.L.
 * pays no KFAS, Zakat or NLST, and has no foreign partners for income tax),
 * and the year is locked.
 */
export async function closeLastYear(books: DemoBooks): Promise<void> {
  const company = await books.refresh();
  const settings = accountingSettings(company);
  const yearEnd = fiscalYearEndIn(Calendar.year(books.calendar.today) - 1, settings.fiscalYearEnd);
  const { accounts, lines } = await loadLedger(company);
  if (!lines.some((l) => l.date <= yearEnd)) return;
  const figures = yearEndFigures({
    lines,
    accounts,
    special: specialAccounts(accounts, settings.template),
    fiscalYearEnd: settings.fiscalYearEnd,
    date: yearEnd,
    profile: kuwaitProfile(company),
    precision: P,
    rates: levyRates(settings),
  });
  await closeYear(company.id, {
    yearStart: figures.yearStart,
    yearEnd: figures.yearEnd,
    profitBeforeLevies: fromMinor(figures.profitBeforeLevies, P),
    lines: figures.proposals
      .filter((x) => x.applies)
      .map((x) => ({
        kind: x.kind,
        base: fromMinor(x.base, P),
        rate: x.rate,
        amount: fromMinor(x.amount, P),
      })),
    lock: true,
  });
}

/** When last year was closed: after the audit, in February (or today, early in the year). */
export function closingDate(calendar: Calendar): ISODate {
  const year = Calendar.year(calendar.today);
  const date = calendar.workday(`${year}-02-18`);
  return date <= calendar.today ? date : addDaysISO(calendar.today, 0);
}
