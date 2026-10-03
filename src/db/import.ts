import { db } from './db';
import {
  createClient,
  createDocument,
  createProduct,
  defaultNumbering,
  nowStamp,
} from './defaults';
import { logActivity } from './activity';
import { applyTotals } from './documents';
import {
  assertUnlocked,
  createAccount,
  createJournal,
  newJournalLine,
  saveJournal,
} from './accounting';
import { accountingSettings } from './chart-setup';
import type {
  Account,
  Address,
  Client,
  Company,
  DocumentType,
  ID,
  ISODate,
  InvoiceDocument,
  LineItem,
  Product,
} from './types';
import {
  IMPORT_COLUMNS,
  normalizeHeader,
  type ColumnMapping,
  type ImportKind,
} from '@/features/company/import-columns';
import {
  parseAmount,
  parseStatementDate,
  type DateFormat as CsvDateFormat,
} from '@/lib/banking/statement';
import { countryOptions, emptyAddress } from '@/lib/geo';
import { findArea, findGovernorate, isValidCivilId, normalizeKuwaitPhone } from '@/lib/kuwait';
import { currencyPrecision, dec, fromMinor, normalizeDigits, toMinor } from '@/lib/money';
import { allocateNumber } from '@/lib/numbering';
import { isValidEmail } from '@/lib/email';
import { addDaysISO, today } from '@/lib/dates';
import { shortId } from '@/lib/ids';
import { msg, t } from '@/i18n';
import { localName } from '@/i18n/names';

/**
 * Bringing a business's records over from a spreadsheet or another system:
 * customers and vendors, products and services, opening balances and the
 * invoices and bills still open on the day the business starts here.
 *
 * `planImport` checks every row without touching the database (the preview
 * and dry-run summary); `commitImport` plans again inside one transaction and
 * writes the rows that are ready, so the books never hold half an import.
 *
 * Opening balances keep the books right: account balances go into one posted
 * journal whose difference lands on Opening balance equity, and open invoices
 * and bills (and contacts' opening balances) become issued documents whose
 * only line is booked to Opening balance equity, so receivables and payables
 * are right per customer and vendor without counting old sales twice.
 */

export class ImportError extends Error {}

export interface ImportOptions {
  /** Contacts: who the rows are when the file has no Type column. */
  contactType: 'customer' | 'vendor';
  /** Open documents: invoices (customers owe you) or bills (you owe vendors). */
  documentType: 'invoice' | 'bill';
  /** Opening balances, and contacts' opening balances, are as at this date. */
  asOf: ISODate;
  /** How dates are written in the file. */
  dateFormat: CsvDateFormat;
  fileName: string;
  /** Shows a date in messages (defaults to yyyy-MM-dd). */
  formatDate?: (date: ISODate) => string;
}

export interface ImportContext {
  company: Company;
  clients: Client[];
  products: Product[];
  accounts: Account[];
  documents: Pick<InvoiceDocument, 'type' | 'number'>[];
}

export type RowStatus = 'ready' | 'skipped' | 'error';

export interface RowIssue {
  /** error: not imported; skip: left out on purpose; warning/info: imported. */
  level: 'error' | 'skip' | 'warning' | 'info';
  text: string;
}

export interface ContactRecord {
  client: Client;
  /** Positive: they owe you (customer) or you owe them (vendor). */
  openingBalance: number;
}

export interface OpeningRecord {
  accountId: ID;
  debit: number;
  credit: number;
  description: string;
}

export interface DocumentRecord {
  doc: InvoiceDocument;
  /** A contact to add first (shared by every row naming it). */
  newContact: Client | null;
  /** An existing contact that also needs the customer or vendor role. */
  promote: Client | null;
}

export type ImportRecord =
  | { kind: 'contacts'; value: ContactRecord }
  | { kind: 'products'; value: Product }
  | { kind: 'opening'; value: OpeningRecord }
  | { kind: 'documents'; value: DocumentRecord };

export interface PlannedRow {
  /** Line number in the file (the header is line 1). */
  line: number;
  status: RowStatus;
  issues: RowIssue[];
  /** The row's values by column key, for the preview. */
  cells: Record<string, string>;
  record: ImportRecord | null;
}

export interface ImportPlan {
  kind: ImportKind;
  rows: PlannedRow[];
  ready: number;
  skipped: number;
  errors: number;
  /** Contacts the import adds on the way (open documents). */
  newContacts: number;
  /** Opening balances, in minor units of the company currency. */
  totals: { debit: number; credit: number; difference: number };
}

export interface ImportResult {
  kind: ImportKind;
  added: number;
  skipped: number;
  newContacts: number;
  /** Opening documents created for contacts' opening balances. */
  documents: number;
  journalNumber: string | null;
}

export const OPENING_ITEM = { name: 'Opening balance', nameAr: 'رصيد افتتاحي' };
const OPENING_ACCOUNT = { code: '3900', name: 'Opening balance equity', nameAr: 'أرصدة افتتاحية' };

const key = (text: string) => normalizeHeader(text);

function cellsOf(kind: ImportKind, row: string[], mapping: ColumnMapping): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const column of IMPORT_COLUMNS[kind]) {
    const index = mapping[column.key];
    cells[column.key] = index === null || index === undefined ? '' : (row[index] ?? '').trim();
  }
  return cells;
}

/** Amount in the company currency, or a message saying what is wrong with it. */
function readMoney(
  value: string,
  currency: string,
  places = currencyPrecision(currency),
): { amount: number } | { problem: string } {
  const amount = parseAmount(value);
  if (amount === null) return { problem: t('“{value}” is not an amount.', { value }) };
  if (dec(amount).decimalPlaces() > places) {
    return {
      problem: t('Amounts in {currency} have at most {places} decimals.', { currency, places }),
    };
  }
  return { amount };
}

function contactRole(value: string, fallback: 'customer' | 'vendor') {
  const v = key(value);
  if (!v) return { customer: fallback === 'customer', vendor: fallback === 'vendor', known: true };
  if (/^(both|كلاهما|عميل ومورد|customer and vendor|customer vendor)$/.test(v))
    return { customer: true, vendor: true, known: true };
  if (/^(customer|client|عميل|العميل|زبون)$/.test(v))
    return { customer: true, vendor: false, known: true };
  if (/^(vendor|supplier|مورد|المورد)$/.test(v))
    return { customer: false, vendor: true, known: true };
  return { customer: fallback === 'customer', vendor: fallback === 'vendor', known: false };
}

function countryCode(value: string): string | null {
  const v = value.trim();
  if (!v) return 'KW';
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  const wanted = key(v);
  for (const locale of ['en', 'ar']) {
    const found = countryOptions(locale).find((o) => key(o.label) === wanted);
    if (found) return found.value;
  }
  return null;
}

/** All the names a contact is known by, for matching rows to existing contacts. */
function contactKeys(c: Pick<Client, 'name' | 'nameAr' | 'number'>): string[] {
  return [c.name, c.nameAr ?? '', c.number].map(key).filter(Boolean);
}

function emptyPlan(kind: ImportKind): ImportPlan {
  return {
    kind,
    rows: [],
    ready: 0,
    skipped: 0,
    errors: 0,
    newContacts: 0,
    totals: { debit: 0, credit: 0, difference: 0 },
  };
}

function finish(plan: ImportPlan): ImportPlan {
  plan.ready = plan.rows.filter((r) => r.status === 'ready').length;
  plan.skipped = plan.rows.filter((r) => r.status === 'skipped').length;
  plan.errors = plan.rows.filter((r) => r.status === 'error').length;
  return plan;
}

function statusOf(issues: RowIssue[]): RowStatus {
  if (issues.some((i) => i.level === 'error')) return 'error';
  if (issues.some((i) => i.level === 'skip')) return 'skipped';
  return 'ready';
}

/**
 * Checks every row of a file (the first row holds the column names) and
 * prepares the records to add. Nothing is written.
 */
export function planImport(
  kind: ImportKind,
  rows: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
  ctx: ImportContext,
): ImportPlan {
  const plan = emptyPlan(kind);
  const missing = IMPORT_COLUMNS[kind].filter((c) => c.required && mapping[c.key] == null);
  const body = rows.slice(1);
  if (missing.length || body.length === 0) return plan;
  const fmtDate = options.formatDate ?? ((d: ISODate) => d);
  const lock = accountingSettings(ctx.company).lockDate;
  const locked = (date: ISODate) => Boolean(lock && date <= lock);
  const lockText = () =>
    t('This is on or before the lock date ({date}).', { date: fmtDate(lock!) });
  const currency = ctx.company.currency;
  const precision = currencyPrecision(currency);

  if (kind === 'contacts') {
    const seen = new Set(ctx.clients.flatMap(contactKeys));
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      const name = cells.name || cells.nameAr;
      if (!name) issues.push({ level: 'error', text: t('Enter a name.') });
      const names = [cells.name, cells.nameAr].map(key).filter(Boolean);
      if (name && names.some((n) => seen.has(n))) {
        issues.push({ level: 'skip', text: t('{name} is already in your contacts.', { name }) });
      }
      const role = contactRole(cells.type, options.contactType);
      if (!role.known) {
        issues.push({
          level: 'warning',
          text: t('Type “{value}” not recognised; imported as set above.', { value: cells.type }),
        });
      }
      const country = countryCode(cells.country);
      if (country === null) {
        issues.push({
          level: 'warning',
          text: t('Country “{value}” not recognised; Kuwait is used.', { value: cells.country }),
        });
      }
      const inKuwait = (country ?? 'KW') === 'KW';
      let phone = normalizeDigits(cells.phone);
      if (phone && inKuwait) {
        const normalized = normalizeKuwaitPhone(phone);
        if (normalized) phone = normalized;
        else issues.push({ level: 'warning', text: t('Phone number kept as written.') });
      }
      if (cells.email && !isValidEmail(cells.email)) {
        issues.push({ level: 'warning', text: t('The email address looks wrong.') });
      }
      const civilId = normalizeDigits(cells.civilId).replace(/\s/g, '');
      if (civilId && !isValidCivilId(civilId)) {
        issues.push({ level: 'warning', text: t('The Civil ID looks wrong.') });
      }
      const governorate = cells.governorate ? findGovernorate(cells.governorate) : undefined;
      const area = cells.area ? findArea(cells.area) : undefined;
      let openingBalance = 0;
      if (cells.openingBalance) {
        const money = readMoney(cells.openingBalance, currency);
        if ('problem' in money) issues.push({ level: 'error', text: money.problem });
        else openingBalance = money.amount;
      }
      if (openingBalance !== 0 && locked(options.asOf)) {
        issues.push({ level: 'error', text: lockText() });
      }
      let paymentTermsDays: number | null = null;
      if (cells.paymentTerms) {
        const days = Number(normalizeDigits(cells.paymentTerms).replace(/[^\d.]/g, ''));
        if (Number.isInteger(days) && days >= 0 && days <= 3650) paymentTermsDays = days;
        else
          issues.push({ level: 'warning', text: t('Payment terms should be a number of days.') });
      }
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready') {
        names.forEach((n) => seen.add(n));
        const address: Address = {
          ...emptyAddress(country ?? 'KW'),
          line1: cells.line1,
          city: area?.en ?? cells.area,
          state: governorate?.name.en ?? cells.governorate,
          postalCode: cells.postalCode,
          ...(cells.block ? { block: cells.block } : {}),
          ...(cells.street ? { street: cells.street } : {}),
          ...(cells.avenue ? { avenue: cells.avenue } : {}),
          ...(cells.building ? { building: cells.building } : {}),
          ...(cells.floor ? { floor: cells.floor } : {}),
          ...(cells.unit ? { unit: cells.unit } : {}),
          ...(cells.paci ? { paci: cells.paci } : {}),
        };
        const notes = [
          cells.crNumber ? `${t('CR No.')}: ${cells.crNumber}` : '',
          cells.notes,
        ].filter(Boolean);
        const email = cells.email.trim();
        const contacts =
          cells.contactPerson || email
            ? [
                {
                  id: shortId(),
                  name: cells.contactPerson || cells.name || cells.nameAr,
                  email,
                  phone,
                  primary: true,
                },
              ]
            : [];
        const client = createClient(ctx.company.id, {
          name: (cells.name || cells.nameAr).trim(),
          ...(cells.nameAr ? { nameAr: cells.nameAr.trim() } : {}),
          ...(civilId ? { civilId } : {}),
          email,
          phone,
          taxId: cells.taxId,
          address,
          contacts,
          paymentTermsDays,
          notes: notes.join('\n'),
          isCustomer: role.customer,
          isVendor: role.vendor,
        });
        record = { kind: 'contacts', value: { client, openingBalance } };
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
  }

  if (kind === 'products') {
    const skus = new Set(ctx.products.map((p) => key(p.sku)).filter(Boolean));
    const names = new Set(ctx.products.map((p) => key(p.name)).filter(Boolean));
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      const name = cells.name || cells.nameAr;
      if (!name) issues.push({ level: 'error', text: t('Enter a name.') });
      if (cells.sku && skus.has(key(cells.sku))) {
        issues.push({ level: 'skip', text: t('SKU {sku} is already used.', { sku: cells.sku }) });
      } else if (name && names.has(key(name))) {
        issues.push({ level: 'skip', text: t('{name} is already in your items.', { name }) });
      }
      let price = 0;
      if (cells.price) {
        // Unit prices may be finer than the currency (e.g. 0.0375 a piece).
        const money = readMoney(cells.price, currency, 6);
        if ('problem' in money) issues.push({ level: 'error', text: money.problem });
        else if (money.amount < 0)
          issues.push({ level: 'error', text: t('The price cannot be negative.') });
        else price = money.amount;
      }
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready') {
        if (cells.sku) skus.add(key(cells.sku));
        names.add(key(name));
        record = {
          kind: 'products',
          value: createProduct(ctx.company.id, {
            name: name.trim(),
            ...(cells.nameAr ? { nameAr: cells.nameAr.trim() } : {}),
            sku: cells.sku,
            unit: cells.unit,
            unitPrice: price,
            description: cells.description,
            ...(cells.descriptionAr ? { descriptionAr: cells.descriptionAr } : {}),
          }),
        };
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
  }

  if (kind === 'opening') {
    const byCode = new Map(ctx.accounts.map((a) => [key(a.code), a]));
    const byName = new Map<string, Account | null>();
    for (const a of ctx.accounts) {
      for (const n of [a.name, a.nameAr ?? ''].map(key).filter(Boolean)) {
        // Two accounts with the same name can't be told apart.
        byName.set(n, byName.has(n) ? null : a);
      }
    }
    if (locked(options.asOf)) {
      plan.rows = body.map((row, i) => ({
        line: i + 2,
        status: 'error' as const,
        issues: [{ level: 'error' as const, text: lockText() }],
        cells: cellsOf(kind, row, mapping),
        record: null,
      }));
      return finish(plan);
    }
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      const account = cells.code
        ? byCode.get(key(cells.code))
        : cells.account
          ? (byName.get(key(cells.account)) ?? undefined)
          : undefined;
      if (!cells.code && !cells.account) {
        issues.push({ level: 'error', text: t('Enter the account code.') });
      } else if (!account) {
        issues.push({
          level: 'error',
          text: cells.code
            ? t('No account has the code {code}.', { code: cells.code })
            : t('No account is called {name}.', { name: cells.account }),
        });
      } else if (account.role === 'receivable' || account.role === 'payable') {
        issues.push({
          level: 'error',
          text:
            account.role === 'receivable'
              ? t('Receivables come from open invoices. Import them as open invoices instead.')
              : t('Payables come from open bills. Import them as open bills instead.'),
        });
      }
      let debit = 0;
      let credit = 0;
      const read = (value: string) => {
        if (!value) return 0;
        const money = readMoney(value, currency);
        if ('problem' in money) {
          issues.push({ level: 'error', text: money.problem });
          return 0;
        }
        return money.amount;
      };
      if (cells.debit || cells.credit) {
        debit = read(cells.debit);
        credit = read(cells.credit);
        // A negative debit is a credit and the other way round.
        if (debit < 0) [credit, debit] = [credit - debit, 0];
        if (credit < 0) [debit, credit] = [debit - credit, 0];
        if (debit !== 0 && credit !== 0) {
          issues.push({
            level: 'error',
            text: t('Give a debit or a credit on each row, not both.'),
          });
        }
      } else if (cells.balance) {
        const balance = read(cells.balance);
        if (balance > 0) debit = balance;
        else credit = -balance;
      }
      if (!issues.length && debit === 0 && credit === 0) {
        issues.push({ level: 'skip', text: t('No amount.') });
      }
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready' && account) {
        plan.totals.debit += toMinor(debit, precision);
        plan.totals.credit += toMinor(credit, precision);
        record = {
          kind: 'opening',
          value: { accountId: account.id, debit, credit, description: account.name },
        };
        cells.matched = localName(account);
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
    plan.totals.difference = plan.totals.debit - plan.totals.credit;
  }

  if (kind === 'documents') {
    const type = options.documentType;
    const sales = type === 'invoice';
    const taken = new Set(ctx.documents.filter((d) => d.type === type).map((d) => key(d.number)));
    const contacts = new Map<string, Client>();
    for (const c of ctx.clients)
      for (const k of contactKeys(c)) if (!contacts.has(k)) contacts.set(k, c);
    const created = new Map<string, Client>();
    const promoted = new Set<ID>();
    body.forEach((row, i) => {
      const cells = cellsOf(kind, row, mapping);
      const issues: RowIssue[] = [];
      if (!cells.number) issues.push({ level: 'error', text: t('Enter the document number.') });
      else if (taken.has(key(cells.number))) {
        issues.push({
          level: 'skip',
          text: t('Number {number} is already used.', { number: cells.number }),
        });
      }
      if (!cells.contact) {
        issues.push({
          level: 'error',
          text: sales ? t('Enter the customer.') : t('Enter the vendor.'),
        });
      }
      const date = cells.date ? parseStatementDate(cells.date, options.dateFormat) : null;
      if (!cells.date) issues.push({ level: 'error', text: t('Enter the date.') });
      else if (!date) {
        issues.push({ level: 'error', text: t('“{value}” is not a date.', { value: cells.date }) });
      } else if (locked(date)) issues.push({ level: 'error', text: lockText() });
      let dueDate: ISODate | null = null;
      if (cells.dueDate) {
        dueDate = parseStatementDate(cells.dueDate, options.dateFormat);
        if (!dueDate) {
          issues.push({
            level: 'error',
            text: t('“{value}” is not a date.', { value: cells.dueDate }),
          });
        } else if (date && dueDate < date) {
          issues.push({ level: 'error', text: t('The due date is before the date.') });
        }
      }
      let amount = 0;
      if (!cells.amount) issues.push({ level: 'error', text: t('Enter the amount due.') });
      else {
        const money = readMoney(cells.amount, currency);
        if ('problem' in money) issues.push({ level: 'error', text: money.problem });
        else if (money.amount <= 0) {
          issues.push({ level: 'error', text: t('The amount due must be more than zero.') });
        } else amount = money.amount;
      }
      const contactKey = key(cells.contact);
      const existing = contactKey ? contacts.get(contactKey) : undefined;
      const status = statusOf(issues);
      let record: ImportRecord | null = null;
      if (status === 'ready' && date) {
        taken.add(key(cells.number));
        let contact = existing ?? created.get(contactKey) ?? null;
        let newContact: Client | null = null;
        let promote: Client | null = null;
        if (!contact) {
          newContact = createClient(ctx.company.id, {
            name: cells.contact,
            address: emptyAddress('KW'),
            isCustomer: sales,
            isVendor: !sales,
          });
          created.set(contactKey, newContact);
          contact = newContact;
          issues.push({
            level: 'info',
            text: sales
              ? t('New customer {name} will be added.', { name: cells.contact })
              : t('New vendor {name} will be added.', { name: cells.contact }),
          });
        } else if (existing && !promoted.has(existing.id)) {
          const missingRole = sales ? existing.isCustomer === false : !existing.isVendor;
          if (missingRole) {
            promote = existing;
            promoted.add(existing.id);
          }
        }
        const terms = contact.paymentTermsDays ?? ctx.company.defaults.paymentTermsDays;
        const doc = openingDocument(ctx.company, type, {
          number: cells.number,
          clientId: contact.id,
          issueDate: date,
          dueDate: dueDate ?? addDaysISO(date, terms),
          amount,
          reference: cells.reference,
          notes: cells.notes,
          fileName: options.fileName,
        });
        record = { kind: 'documents', value: { doc, newContact, promote } };
      }
      plan.rows.push({ line: i + 2, status, issues, cells, record });
    });
    plan.newContacts = created.size;
  }

  return finish(plan);
}

/** An issued document for money owed before the books start here. */
function openingDocument(
  company: Company,
  type: DocumentType,
  input: {
    number: string;
    clientId: ID;
    issueDate: ISODate;
    dueDate: ISODate | null;
    amount: number;
    reference?: string;
    notes?: string;
    fileName: string;
    accountId?: ID | null;
  },
): InvoiceDocument {
  const item: LineItem = {
    id: shortId(),
    kind: 'item',
    productId: null,
    name: OPENING_ITEM.name,
    nameAr: OPENING_ITEM.nameAr,
    description: '',
    quantity: 1,
    unit: '',
    unitPrice: input.amount,
    discount: 0,
    discountType: 'percent',
    taxes: [],
    accountId: input.accountId ?? null,
  };
  const purchase = type === 'bill' || type === 'vendor_credit';
  const privateNotes = [
    t('Opening balance imported from {file}.', { file: input.fileName || 'CSV' }),
    input.notes ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return createDocument(company.id, type, {
    number: input.number,
    status: 'sent',
    clientId: input.clientId,
    issueDate: input.issueDate,
    dueDate: type === 'invoice' || type === 'bill' ? input.dueDate : null,
    currency: company.currency,
    items: [item],
    pricesIncludeTax: false,
    ...(purchase
      ? { vendorReference: input.reference ?? '' }
      : { poNumber: input.reference ?? '' }),
    privateNotes,
    sentAt: nowStamp(),
  });
}

/** Everything a plan needs to know about the company's existing records. */
export async function loadImportContext(companyId: ID): Promise<ImportContext> {
  const company = await db.companies.get(companyId);
  if (!company) throw new ImportError(t('Company not found.'));
  const [clients, products, accounts, documents] = await Promise.all([
    db.clients.where('companyId').equals(companyId).toArray(),
    db.products.where('companyId').equals(companyId).toArray(),
    db.accounts.where('companyId').equals(companyId).toArray(),
    db.documents.where('companyId').equals(companyId).toArray(),
  ]);
  return { company, clients, products, accounts, documents };
}

/** The Opening balance equity account, added when the chart has none. */
async function openingAccount(company: Company): Promise<Account> {
  const accounts = await db.accounts.where('companyId').equals(company.id).toArray();
  const found =
    accounts.find((a) => a.role === 'opening_balance' && !a.archived) ??
    accounts.find((a) => a.role === 'opening_balance');
  if (found) return found;
  const codes = new Set(accounts.map((a) => a.code));
  let code = Number(OPENING_ACCOUNT.code);
  while (codes.has(String(code))) code += 1;
  const account = createAccount(company.id, {
    code: String(code),
    name: OPENING_ACCOUNT.name,
    nameAr: OPENING_ACCOUNT.nameAr,
    type: 'equity',
    role: 'opening_balance',
  });
  await db.accounts.add(account);
  await logActivity(company.id, 'account', account.id, 'created', {
    text: msg('Account {code} {name} created'),
    vars: { code: account.code, name: account.name },
  });
  return account;
}

/** Gives new contacts their numbers (C-0001…), skipping numbers already used. */
function numberContacts(company: Company, existing: Client[], fresh: Client[]): Company {
  const taken = new Set(existing.map((c) => c.number.toLowerCase()));
  let rule = company.numbering.client ?? defaultNumbering().client;
  const date = today();
  for (const client of fresh) {
    const allocated = allocateNumber(rule, date, (n) => taken.has(n.toLowerCase()));
    client.number = allocated.number;
    taken.add(allocated.number.toLowerCase());
    rule = allocated.rule;
  }
  return { ...company, numbering: { ...company.numbering, client: rule } };
}

/**
 * Imports the ready rows of a file in one transaction: either everything is
 * added or nothing is. Opening balances are only imported when every row is
 * right, because a partial trial balance would leave the books wrong.
 */
export async function commitImport(
  companyId: ID,
  kind: ImportKind,
  rows: string[][],
  mapping: ColumnMapping,
  options: ImportOptions,
): Promise<ImportResult> {
  return db.transaction(
    'rw',
    [
      db.companies,
      db.clients,
      db.products,
      db.documents,
      db.journals,
      db.accounts,
      db.payments,
      db.activities,
    ],
    async () => {
      const ctx = await loadImportContext(companyId);
      const plan = planImport(kind, rows, mapping, options, ctx);
      if (kind === 'opening' && plan.errors > 0) {
        throw new ImportError(t('Fix the rows with problems first. Nothing was imported.'));
      }
      if (plan.ready === 0) throw new ImportError(t('There is nothing to import.'));
      let company = ctx.company;
      const records = plan.rows.flatMap((r) => (r.record ? [r.record] : []));
      const result: ImportResult = {
        kind,
        added: plan.ready,
        skipped: plan.skipped + plan.errors,
        newContacts: 0,
        documents: 0,
        journalNumber: null,
      };
      const takenNumbers = (type: DocumentType) =>
        new Set(ctx.documents.filter((d) => d.type === type).map((d) => key(d.number)));

      if (kind === 'contacts') {
        const items = records.flatMap((r) => (r.kind === 'contacts' ? [r.value] : []));
        company = numberContacts(
          company,
          ctx.clients,
          items.map((i) => i.client),
        );
        await db.clients.bulkAdd(items.map((i) => i.client));
        for (const { client } of items) {
          await logActivity(
            company.id,
            'client',
            client.id,
            'created',
            {
              text:
                client.isCustomer === false
                  ? msg('Vendor {name} imported')
                  : msg('Client {name} imported'),
              vars: { name: client.name },
            },
            { clientId: client.id },
          );
        }
        const withBalance = items.filter((i) => i.openingBalance !== 0);
        if (withBalance.length) {
          assertUnlocked(company, options.asOf);
          const account = await openingAccount(company);
          const docs: InvoiceDocument[] = [];
          const taken = new Map<DocumentType, Set<string>>();
          for (const { client, openingBalance } of withBalance) {
            const customer = client.isCustomer !== false;
            const type: DocumentType = customer
              ? openingBalance > 0
                ? 'invoice'
                : 'credit'
              : openingBalance > 0
                ? 'bill'
                : 'vendor_credit';
            if (!taken.has(type)) taken.set(type, takenNumbers(type));
            const used = taken.get(type)!;
            let number = `OB-${client.number}`;
            for (let n = 2; used.has(key(number)); n++) number = `OB-${client.number}-${n}`;
            used.add(key(number));
            const doc = openingDocument(company, type, {
              number,
              clientId: client.id,
              issueDate: options.asOf,
              dueDate: options.asOf,
              amount: Math.abs(openingBalance),
              fileName: options.fileName,
              accountId: account.id,
            });
            docs.push(applyTotals(doc, 0, client));
          }
          await db.documents.bulkAdd(docs);
          for (const doc of docs) {
            await logActivity(
              company.id,
              doc.type,
              doc.id,
              'created',
              { text: msg('Opening balance {number} added'), vars: { number: doc.number } },
              { clientId: doc.clientId, documentId: doc.id },
            );
          }
          result.documents = docs.length;
        }
        await db.companies.put({ ...company, updatedAt: nowStamp() });
      }

      if (kind === 'products') {
        const products = records.flatMap((r) => (r.kind === 'products' ? [r.value] : []));
        await db.products.bulkAdd(products);
        for (const p of products) {
          await logActivity(company.id, 'product', p.id, 'created', {
            text: msg('Item {name} imported'),
            vars: { name: p.name },
          });
        }
      }

      if (kind === 'opening') {
        const lines = records.flatMap((r) => (r.kind === 'opening' ? [r.value] : []));
        const precision = currencyPrecision(company.currency);
        const account = await openingAccount(company);
        const journalLines = lines.map((l) =>
          newJournalLine({
            accountId: l.accountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          }),
        );
        const difference = plan.totals.difference;
        if (difference !== 0) {
          journalLines.push(
            newJournalLine({
              accountId: account.id,
              description: OPENING_ACCOUNT.name,
              debit: difference < 0 ? fromMinor(-difference, precision) : 0,
              credit: difference > 0 ? fromMinor(difference, precision) : 0,
            }),
          );
        }
        if (journalLines.length < 2) {
          // One account against itself: nothing moves.
          throw new ImportError(t('There is nothing to import.'));
        }
        const journal = await saveJournal(
          createJournal(company.id, {
            date: options.asOf,
            reference: t('Opening balances'),
            notes: t('Imported from {file}.', { file: options.fileName || 'CSV' }),
            lines: journalLines,
          }),
        );
        // saveJournal may have advanced the journal numbering.
        company = (await db.companies.get(company.id)) ?? company;
        const before = company.openingBalances;
        await db.companies.put({
          ...company,
          openingBalances: {
            date: options.asOf,
            journalIds: [...(before?.journalIds ?? []), journal.id],
          },
          updatedAt: nowStamp(),
        });
        result.journalNumber = journal.number;
      }

      if (kind === 'documents') {
        const items = records.flatMap((r) => (r.kind === 'documents' ? [r.value] : []));
        const fresh = items.flatMap((i) => (i.newContact ? [i.newContact] : []));
        if (fresh.length) {
          company = numberContacts(company, ctx.clients, fresh);
          await db.clients.bulkAdd(fresh);
          await db.companies.put({ ...company, updatedAt: nowStamp() });
          for (const client of fresh) {
            await logActivity(
              company.id,
              'client',
              client.id,
              'created',
              {
                text:
                  client.isCustomer === false
                    ? msg('Vendor {name} imported')
                    : msg('Client {name} imported'),
                vars: { name: client.name },
              },
              { clientId: client.id },
            );
          }
        }
        for (const { promote } of items) {
          if (!promote) continue;
          await db.clients.update(promote.id, {
            ...(options.documentType === 'invoice' ? { isCustomer: true } : { isVendor: true }),
            updatedAt: nowStamp(),
          });
        }
        const account = await openingAccount(company);
        const clients = new Map([...ctx.clients, ...fresh].map((c) => [c.id, c]));
        const docs = items.map(({ doc }) =>
          applyTotals(
            { ...doc, items: doc.items.map((i) => ({ ...i, accountId: account.id })) },
            0,
            clients.get(doc.clientId) ?? null,
          ),
        );
        await db.documents.bulkAdd(docs);
        for (const doc of docs) {
          await logActivity(
            company.id,
            doc.type,
            doc.id,
            'created',
            { text: msg('Opening balance {number} added'), vars: { number: doc.number } },
            { clientId: doc.clientId, documentId: doc.id },
          );
        }
        result.newContacts = fresh.length;
        result.documents = docs.length;
      }

      return result;
    },
  );
}
