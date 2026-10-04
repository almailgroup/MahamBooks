import type { Client, InvoiceDocument, Payment } from '@/db/types';
import { msg, type Dictionary } from '@/i18n';
import { toCsv } from '@/lib/csv';
import { downloadName } from '@/lib/file-names';
import { currencyPrecision, fromMinor, toMinor } from '@/lib/money';
import { agingAt, AGING_BUCKETS } from '@/lib/reports';
import { ACCOUNT_TYPES } from '@/lib/accounting/account-types';
import { generalLedger, type DateRange } from '@/lib/accounting/statements';
import { lineDescription, type LedgerLine } from '@/lib/accounting/ledger';
import { accumulatedAt } from '@/lib/accounting/depreciation';
import { assetTerms } from '@/db/assets';
import {
  buildStatement,
  modelToCsv,
  statementContext,
  type StatementData,
  type StatementId,
} from './model';
import { reportText, type ReportLanguage, type ReportText } from './report-language';
import { createZip } from './zip';

/**
 * The auditor pack: the financial statements, trial balance, general ledger,
 * receivables and payables aging, fixed asset schedule and register, and the
 * chart of accounts for one financial year, as CSV files in a ZIP. Words are
 * in the chosen language (or both); file names are always English.
 */

export interface PackData extends StatementData {
  documents: InvoiceDocument[];
  payments: Payment[];
  clients: Client[];
}

export interface PackFile {
  name: string;
  /** Shown in the list of what the pack holds. */
  label: string;
  text: string;
}

const STATEMENTS: { id: StatementId; label: string }[] = [
  { id: 'balance-sheet', label: msg('Statement of financial position') },
  { id: 'profit-and-loss', label: msg('Statement of profit or loss') },
  { id: 'changes-in-equity', label: msg('Statement of changes in equity') },
  { id: 'cash-flow', label: msg('Statement of cash flows') },
  { id: 'trial-balance', label: msg('Trial balance') },
  { id: 'asset-schedule', label: msg('Fixed asset schedule') },
];

/** What the pack holds, in order (file names are those the models and pack give). */
export const PACK_FILES: { name: string; label: string }[] = [
  { name: 'statement-of-financial-position.csv', label: msg('Statement of financial position') },
  { name: 'statement-of-profit-or-loss.csv', label: msg('Statement of profit or loss') },
  { name: 'statement-of-changes-in-equity.csv', label: msg('Statement of changes in equity') },
  { name: 'statement-of-cash-flows.csv', label: msg('Statement of cash flows') },
  { name: 'trial-balance.csv', label: msg('Trial balance') },
  { name: 'fixed-asset-schedule.csv', label: msg('Fixed asset schedule') },
  { name: 'general-ledger.csv', label: msg('General ledger') },
  { name: 'receivables-aging.csv', label: msg('Receivables aging') },
  { name: 'payables-aging.csv', label: msg('Payables aging') },
  { name: 'fixed-asset-register.csv', label: msg('Fixed asset register') },
  { name: 'chart-of-accounts.csv', label: msg('Chart of accounts') },
];

/** Headings in one language, or "English / Arabic" for both. */
function heading(texts: ReportText[], key: string): string {
  return texts.map((text) => text.t(key)).join(' / ');
}

/** CSV with a byte-order mark, so spreadsheet apps read Arabic correctly. */
const csv = (headers: string[], rows: unknown[][]) => `\uFEFF${toCsv(headers, rows)}`;

export function buildAuditorPack(
  data: PackData,
  year: DateRange,
  language: ReportLanguage,
  arabic: Dictionary | null,
): PackFile[] {
  const { company, ledger } = data;
  const p = currencyPrecision(company.currency);
  const primary = reportText(language === 'ar' ? 'ar' : 'en', arabic, company);
  const secondary = language === 'both' ? reportText('ar', arabic, company) : null;
  const texts = secondary ? [primary, secondary] : [primary];
  const names = (record: { name: string; nameAr?: string }) => texts.map((t) => t.name(record));
  const nameHeadings = texts.map((t) => t.t(msg('Name')));
  // Wording the ledger wrote follows the pack's language; people's own text stays as typed.
  const describe = (l: LedgerLine) =>
    l.label ? texts.map((t) => lineDescription(l, t.t)).join(' / ') : l.description;
  const major = (minor: number) => fromMinor(minor, p);
  const { yearEnd } = statementContext(data);
  const files: PackFile[] = [];

  for (const { id, label } of STATEMENTS) {
    const model = buildStatement(id, data, {
      range: year,
      asOf: year.to,
      compare: id !== 'trial-balance' && id !== 'asset-schedule',
      detail: true,
    });
    const { headers, rows } = modelToCsv(model, p, primary, secondary);
    files.push({ name: `${model.file}.csv`, label, text: csv(headers, rows) });
  }

  // General ledger: every account's movements in the year, with balances.
  const activity = generalLedger(ledger.lines, ledger.accounts, year, yearEnd);
  files.push({
    name: 'general-ledger.csv',
    label: msg('General ledger'),
    text: csv(
      [
        heading(texts, msg('Code')),
        ...texts.map((t) => t.t(msg('Account'))),
        heading(texts, msg('Date')),
        heading(texts, msg('Number')),
        heading(texts, msg('Description')),
        heading(texts, msg('Debit')),
        heading(texts, msg('Credit')),
        heading(texts, msg('Balance')),
      ],
      activity.flatMap((a) => [
        [
          a.account.code,
          ...names(a.account),
          year.from,
          '',
          heading(texts, msg('Opening balance')),
          '',
          '',
          major(a.opening),
        ],
        ...a.lines.map((l) => [
          a.account.code,
          ...names(a.account),
          l.date,
          l.number,
          describe(l),
          l.amount > 0 ? major(l.amount) : '',
          l.amount < 0 ? major(-l.amount) : '',
          major(l.balance),
        ]),
        [
          a.account.code,
          ...names(a.account),
          year.to,
          '',
          heading(texts, msg('Closing balance')),
          major(a.debit),
          major(a.credit),
          major(a.closing),
        ],
      ]),
    ),
  });

  // Receivables and payables at the year end.
  for (const [type, file, label, party] of [
    ['invoice', 'receivables-aging.csv', msg('Receivables aging'), msg('Client')],
    ['bill', 'payables-aging.csv', msg('Payables aging'), msg('Vendor')],
  ] as const) {
    const aging = agingAt(
      data.documents,
      data.payments.filter((x) => (type === 'bill') === (x.direction === 'out')),
      data.clients,
      year.to,
      type,
      company.currency,
    );
    const contacts = new Map(data.clients.map((c) => [c.id, c]));
    files.push({
      name: file,
      label,
      text: csv(
        [
          ...texts.map((t) => t.t(party)),
          ...AGING_BUCKETS.map((b) => heading(texts, b)),
          heading(texts, msg('Total')),
        ],
        [
          ...aging.rows.map((r) => [
            ...names(contacts.get(r.clientId) ?? { name: r.clientName }),
            ...r.buckets.map(major),
            major(r.total),
          ]),
          [...texts.map((t) => t.t(msg('Total'))), ...aging.totals.map(major), major(aging.total)],
        ],
      ),
    });
  }

  // Fixed asset register at the year end.
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a]));
  const register = data.assets
    .filter((a) => a.status !== 'void' && a.purchaseDate <= year.to)
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  files.push({
    name: 'fixed-asset-register.csv',
    label: msg('Fixed asset register'),
    text: csv(
      [
        heading(texts, msg('Number')),
        ...nameHeadings,
        ...texts.map((t) => t.t(msg('Category'))),
        heading(texts, msg('Purchase date')),
        heading(texts, msg('Cost')),
        heading(texts, msg('Salvage value')),
        heading(texts, msg('Useful life (months)')),
        heading(texts, msg('Depreciation method')),
        heading(texts, msg('Accumulated depreciation')),
        heading(texts, msg('Book value')),
        heading(texts, msg('Location')),
        heading(texts, msg('Custodian')),
        heading(texts, msg('Serial number')),
        heading(texts, msg('Status')),
      ],
      register.map((asset) => {
        const disposed = asset.disposal && asset.disposal.date <= year.to;
        const accumulated = disposed
          ? 0
          : Math.min(
              accumulatedAt(assetTerms(asset), year.to, p),
              toMinor(asset.cost - asset.salvageValue, p),
            );
        const category = accounts.get(asset.assetAccountId);
        return [
          asset.number,
          ...names(asset),
          ...(category ? names(category) : texts.map(() => '')),
          asset.purchaseDate,
          asset.cost,
          asset.salvageValue,
          asset.usefulLifeMonths,
          heading(
            texts,
            asset.method === 'straight_line' ? msg('Straight line') : msg('Declining balance'),
          ),
          major(accumulated),
          disposed ? 0 : major(toMinor(asset.cost, p) - accumulated),
          asset.location,
          asset.custodian,
          asset.serialNumber,
          heading(texts, disposed ? msg('Disposed of') : msg('In use')),
        ];
      }),
    ),
  });

  // Chart of accounts with the balance at the year end: the mapping auditors start from.
  const balances = new Map<string, number>();
  for (const l of ledger.lines) {
    if (l.date <= year.to) balances.set(l.accountId, (balances.get(l.accountId) ?? 0) + l.amount);
  }
  files.push({
    name: 'chart-of-accounts.csv',
    label: msg('Chart of accounts'),
    text: csv(
      [
        heading(texts, msg('Code')),
        primary.t(msg('Name in English')),
        primary.t(msg('Name in Arabic')),
        heading(texts, msg('Type')),
        heading(texts, msg('Balance (debit positive)')),
      ],
      [...ledger.accounts]
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map((a) => [
          a.code,
          a.name,
          a.nameAr ?? '',
          heading(texts, ACCOUNT_TYPES[a.type].label),
          major(balances.get(a.id) ?? 0),
        ]),
    ),
  });
  return files;
}

/** The pack as a ZIP file. */
export function auditorPackZip(files: PackFile[]): Blob {
  const zip = createZip(files.map((f) => ({ name: f.name, data: f.text })));
  return new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
}

/** Saves a file the app made, under an ASCII name (see `downloadName`). */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A name safe for files: lower case, dashes, English letters and digits. */
export function fileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
