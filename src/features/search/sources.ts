import { db } from '@/db/db';
import type { Company, DocumentType, Employee, ID } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES } from '@/app/company';
import { displayStatus, statusMeta } from '@/lib/status';
import { currencyPrecision } from '@/lib/money';
import { isCurrent } from '@/lib/hr/employees';
import {
  DEFAULT_REMINDER_DAYS,
  documentTypeInfo,
  employeeDocuments,
  registerExtrasOn,
} from '@/lib/compliance';
import { entryOwner, entryTitle, purposeName } from '@/features/renewals/text';
import { fileFinderOn } from '@/db/files';
import { loadFileIndex } from '@/features/files/file-index';
import { today } from '@/lib/dates';
import { isCustomer, isVendor } from '@/db/purchases';
import { visibleNav } from '@/features/shell/nav';
import { APPS, appTitle, canOpen, createGroups, type AccessMap } from '@/suite/apps';
import type { AppId } from '@/suite/types';
import { currentLanguage, msg, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { makeEntry, type SearchEntry } from './rank';
import { isPeopleItem } from './recent';

/** Formatting bound to the company and language (`useFormat()`). */
export interface SearchFormat {
  money: (amount: number, currency?: string) => string;
  date: (value: string | null | undefined) => string;
}

/** Shortcuts that open a page with a filter, found by what people ask for. */
const SHORTCUTS: { key: string; label: string; to: string; keywords?: string; app?: AppId }[] = [
  {
    key: 'cheques-week',
    label: msg('Cheques due this week'),
    to: '/cheques?filter=week',
    keywords: 'pdc maturing',
  },
  {
    key: 'cheques-issued-week',
    label: msg('Issued cheques due this week'),
    to: '/cheques?tab=issued&filter=week',
  },
  { key: 'overdue-invoices', label: msg('Overdue invoices'), to: '/invoices?status=overdue' },
  { key: 'low-stock', label: msg('Low stock'), to: '/products?filter=low', keywords: 'reorder' },
  {
    key: 'expiring',
    label: msg('Expiring documents'),
    to: '/compliance/documents',
    app: 'compliance',
  },
  { key: 'payroll-leave', label: msg('Leave'), to: '/payroll/leave', app: 'people' },
  { key: 'payroll-loans', label: msg('Staff loans'), to: '/payroll/loans', app: 'people' },
  { key: 'stock-count', label: msg('Stock count'), to: '/inventory/count' },
];

/** Reports and settings pages, so they can be reached in two keystrokes. */
const SUB_PAGES: {
  label: string;
  to: string;
  keywords?: string;
  app?: AppId;
  /** Offered only once the company prints cheques (D1). */
  chequePrinting?: boolean;
}[] = [
  { label: msg('Balance sheet'), to: '/reports/balance-sheet' },
  { label: msg('Profit and loss'), to: '/reports/profit-and-loss', keywords: 'income statement' },
  { label: msg('Cash flow'), to: '/reports/cash-flow' },
  { label: msg('Trial balance'), to: '/reports/trial-balance' },
  { label: msg('General ledger'), to: '/reports/general-ledger' },
  { label: msg('Receivables aging'), to: '/reports/aging', keywords: 'who owes' },
  { label: msg('Payables aging'), to: '/reports/payables' },
  { label: msg('Sales by client'), to: '/reports/sales' },
  { label: msg('Stock valuation'), to: '/reports/stock-valuation' },
  { label: msg('Auditor pack'), to: '/reports/auditor-pack' },
  { label: msg('Company profile'), to: '/settings/company', keywords: 'logo stamp address' },
  { label: msg('Payment details'), to: '/settings/payments', keywords: 'bank iban' },
  { label: msg('Numbering'), to: '/settings/numbering' },
  { label: msg('Items and units'), to: '/settings/items', keywords: 'sku codes units' },
  {
    label: msg('Cheque layouts'),
    to: '/cheques/layouts',
    keywords: 'print cheque burgan kfh',
    chequePrinting: true,
  },
  { label: msg('Email templates'), to: '/settings/emails' },
  { label: msg('Import data'), to: '/settings/import', keywords: 'csv excel' },
  { label: msg('Backup & data'), to: '/settings/data', keywords: 'export restore' },
  { label: msg('Payroll settings'), to: '/payroll/settings', app: 'people' },
  { label: msg('Your account'), to: '/settings/account', keywords: 'profile password sign out' },
  { label: msg('Team'), to: '/settings/team', keywords: 'members invite users roles' },
  {
    label: msg('Cloud and sync'),
    to: '/settings/cloud',
    keywords: 'sync status offline cloud devices',
  },
];

/** Every app open to everyone: for tests and for companies kept on this device. */
const FULL_ACCESS = Object.fromEntries(APPS.map((app) => [app.id, 'manage'])) as AccessMap;

/**
 * Pages and actions: the same for every company, in the interface language.
 * Only the apps the person may open (`current` first), and only the things
 * they may create; nothing at all without `create` (view-only, or no longer
 * shared), like the New menus.
 */
export function staticEntries(
  taxesOn: boolean,
  {
    access = FULL_ACCESS,
    current = 'books',
    create = true,
    registerExtras = false,
    fileFinder = false,
    chequePrinting = false,
  }: {
    access?: AccessMap;
    current?: AppId;
    create?: boolean;
    registerExtras?: boolean;
    fileFinder?: boolean;
    chequePrinting?: boolean;
  } = {},
): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const seen = new Set<string>();
  const page = (to: string, label: string, boost: number, keywords?: string, group?: string) => {
    if (seen.has(`page:${to}`)) return;
    seen.add(`page:${to}`);
    entries.push(
      makeEntry({
        key: `page:${to}`,
        kind: 'page',
        title: t(label),
        subtitle: group,
        to,
        names: [t(label), label],
        terms: [keywords, group],
        boost,
      }),
    );
  };
  const language = currentLanguage();
  const apps = APPS.filter((app) => canOpen(access[app.id]));
  // The open app's pages first, so a shared page shows under it.
  apps.sort((a, b) => Number(b.id === current) - Number(a.id === current));
  for (const app of apps) {
    const name = appTitle(app, language);
    // The app itself: "people" opens Maham People. Its own entry, so the
    // page at the same address (Books' Dashboard) is still found by its name.
    entries.push(
      makeEntry({
        key: `app:${app.id}`,
        kind: 'page',
        title: name,
        subtitle: t(app.description),
        to: app.home,
        names: [name, app.name, app.nameAr],
        terms: [t(app.description)],
        boost: 35,
      }),
    );
    for (const entry of visibleNav(app.nav, taxesOn, registerExtras, fileFinder)) {
      if (entry.kind === 'link') {
        page(entry.to, entry.label, 30, entry.keywords, app.id === 'books' ? undefined : name);
      } else {
        for (const child of entry.children) {
          const where = app.id === 'books' ? t(entry.label) : `${name} · ${t(entry.label)}`;
          page(child.to, child.label, 30, child.keywords, where);
        }
      }
    }
    for (const link of app.footer) page(link.to, link.label, 20);
  }
  for (const sub of SUB_PAGES) {
    if (sub.app && !canOpen(access[sub.app])) continue;
    if (sub.chequePrinting && !chequePrinting) continue;
    page(sub.to, sub.label, 10, sub.keywords);
  }

  for (const group of create ? createGroups(current, access) : []) {
    for (const action of group.actions) {
      entries.push(
        makeEntry({
          key: `action:${action.id}`,
          kind: 'action',
          title: t(action.command),
          to: action.to,
          names: [t(action.command), action.command],
          terms: [t(action.label), action.label, action.keywords, 'new create add'],
          boost: 25,
        }),
      );
    }
  }
  for (const shortcut of SHORTCUTS) {
    if (shortcut.app && !canOpen(access[shortcut.app])) continue;
    entries.push(
      makeEntry({
        key: `action:${shortcut.key}`,
        kind: 'action',
        title: t(shortcut.label),
        to: shortcut.to,
        names: [t(shortcut.label), shortcut.label],
        terms: [shortcut.keywords],
        boost: 20,
      }),
    );
  }
  return entries;
}

const SEARCHED_DOCUMENTS: DocumentType[] = [
  'invoice',
  'quote',
  'credit',
  'proforma',
  'sales_order',
  'delivery_note',
  'bill',
  'vendor_credit',
  'purchase_order',
];

/**
 * Contacts, items, employees, documents and payments of a company; with the
 * register's extras its papers in the register; and with the document
 * finder the papers on employees' records too, expenses, fixed assets,
 * security cheques and stored files. Without `people` (staff and viewers),
 * files of payroll and people data are not even listed.
 */
export async function recordEntries(
  company: Company,
  fmt: SearchFormat,
  { people = true }: { people?: boolean } = {},
): Promise<SearchEntry[]> {
  const extras = registerExtrasOn(company);
  const finder = fileFinderOn(company);
  const withPapers = extras || finder;
  const [clients, products, employees, documents, payments, papers, vehicles] = await Promise.all([
    db.clients.where('companyId').equals(company.id).toArray(),
    db.products.where('companyId').equals(company.id).toArray(),
    db.employees.where('companyId').equals(company.id).toArray(),
    db.documents.where('companyId').equals(company.id).toArray(),
    db.payments.where('companyId').equals(company.id).toArray(),
    withPapers ? db.complianceDocuments.where('companyId').equals(company.id).toArray() : [],
    withPapers ? db.vehicles.where('companyId').equals(company.id).toArray() : [],
  ]);
  const [expenses, assets, cheques, files] = await Promise.all([
    finder ? db.expenses.where('companyId').equals(company.id).toArray() : [],
    finder ? db.assets.where('companyId').equals(company.id).toArray() : [],
    finder ? db.securityCheques.where('companyId').equals(company.id).toArray() : [],
    finder ? loadFileIndex(company, { people }) : [],
  ]);
  const now = today();
  const ar = (record: { nameAr?: string }) => record.nameAr?.trim() || undefined;
  const names = new Map(clients.map((c) => [c.id, c]));
  const entries: SearchEntry[] = [];

  for (const c of clients) {
    const vendorOnly = isVendor(c) && !isCustomer(c);
    entries.push(
      makeEntry({
        key: `contact:${c.id}`,
        kind: vendorOnly ? 'vendor' : 'client',
        title: localName(c),
        subtitle: [vendorOnly ? t('Vendor') : t('Client'), c.email || c.phone]
          .filter(Boolean)
          .join(' · '),
        to: vendorOnly ? `/vendors/${c.id}` : `/clients/${c.id}`,
        names: [c.name, ar(c)],
        terms: [c.email, ...c.contacts.flatMap((p) => [p.name, p.email])],
        numbers: [c.phone, c.civilId],
        boost: c.archived ? -5 : 2,
      }),
    );
  }

  for (const p of products) {
    entries.push(
      makeEntry({
        key: `item:${p.id}`,
        kind: 'item',
        title: localName(p),
        subtitle: [t('Item'), p.sku].filter(Boolean).join(' · '),
        amount: fmt.money(p.unitPrice),
        to: '/products',
        names: [p.name, ar(p)],
        // A scanner types the SKU (the label's QR code) or the barcode.
        numbers: [p.sku, p.barcode],
        boost: p.archived ? -5 : 1,
      }),
    );
  }

  for (const e of employees) {
    entries.push(
      makeEntry({
        key: `employee:${e.id}`,
        kind: 'employee',
        title: localName(e),
        subtitle: [t('Employee'), e.jobTitle].filter(Boolean).join(' · '),
        to: `/employees/${e.id}`,
        names: [e.name, ar(e)],
        terms: [e.jobTitle, e.jobTitleAr],
        numbers: [e.number, e.civilId],
        boost: 1,
      }),
    );
  }

  for (const d of documents) {
    if (!SEARCHED_DOCUMENTS.includes(d.type)) continue;
    const client = names.get(d.clientId);
    const label = DOCUMENT_LABELS[d.type].singular;
    const status = statusMeta(displayStatus(d, now));
    entries.push(
      makeEntry({
        key: `document:${d.id}`,
        kind: 'document',
        title: `${t(label)} ${d.number}`.trim(),
        subtitle: [client ? localName(client) : '', fmt.date(d.issueDate), t(status.label)]
          .filter(Boolean)
          .join(' · '),
        amount: fmt.money(d.totals.total, d.currency),
        to: `${DOCUMENT_ROUTES[d.type]}/${d.id}`,
        names: [d.number],
        terms: [client?.name, client && ar(client), t(label), label, d.poNumber],
        numbers: [d.number, d.poNumber, d.vendorReference],
        amounts: [d.totals.total, d.totals.balance].filter((a, i, all) => all.indexOf(a) === i),
        precision: currencyPrecision(d.currency),
        // Newer documents first when the match is as good (a fraction of a point).
        boost: recency(d.issueDate),
      }),
    );
  }

  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const owners = { clients: names, vehicles: new Map(vehicles.map((v) => [v.id, v])) };
  for (const paper of papers) {
    // Confidential ones are found in the register only: the palette keeps
    // what was opened on this browser, which someone else may use.
    if (paper.archived || paper.confidential) continue;
    const type = t(documentTypeInfo(paper.type).label);
    const owner = entryOwner(paper, byEmployee, company, owners);
    entries.push(
      makeEntry({
        key: `paper:${paper.id}`,
        kind: 'paper',
        title: entryTitle(paper),
        subtitle: [
          paper.title ? type : '',
          owner,
          paper.expiryDate ? t('Expires {date}', { date: fmt.date(paper.expiryDate) }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
        // An employee's paper opens with them, as People keeps it.
        to: paper.employeeId
          ? `/employees/${paper.employeeId}`
          : `/compliance/documents?doc=${paper.id}`,
        names: [paper.title, type],
        terms: [
          type,
          documentTypeInfo(paper.type).label,
          owner,
          paper.ownerName,
          paper.issuer,
          purposeName(company.documentPurposes, paper.purposeId),
        ],
        numbers: [paper.number],
      }),
    );
  }

  if (finder) {
    // The papers on current employees' own records (Civil ID, residency…).
    for (const e of employees) {
      if (!isCurrent(e)) continue;
      for (const entry of employeeDocuments(e, DEFAULT_REMINDER_DAYS)) {
        const type = documentTypeInfo(entry.type).label;
        entries.push(
          makeEntry({
            key: `paper:${entry.key}`,
            kind: 'paper',
            title: t(type),
            subtitle: [
              localName(e),
              entry.expiryDate ? t('Expires {date}', { date: fmt.date(entry.expiryDate) }) : '',
            ]
              .filter(Boolean)
              .join(' · '),
            to: `/employees/${e.id}`,
            names: [t(type), type],
            terms: [e.name, ar(e), e.number],
            numbers: [entry.number],
          }),
        );
      }
    }
  }

  for (const e of expenses) {
    const vendor = e.vendorId ? names.get(e.vendorId) : undefined;
    entries.push(
      makeEntry({
        key: `expense:${e.id}`,
        kind: 'document',
        title: `${t('Expense')} ${e.number}`.trim(),
        subtitle: [e.description, vendor ? localName(vendor) : '', fmt.date(e.date)]
          .filter(Boolean)
          .join(' · '),
        amount: fmt.money(e.amount, e.currency),
        to: `/expenses?open=${e.id}`,
        names: [e.number, e.description],
        terms: [vendor?.name, vendor && ar(vendor), t('Expense'), 'Expense'],
        numbers: [e.number, e.reference],
        amounts: [e.amount],
        precision: currencyPrecision(e.currency),
        boost: recency(e.date),
      }),
    );
  }

  for (const a of assets) {
    entries.push(
      makeEntry({
        key: `asset:${a.id}`,
        kind: 'document',
        title: localName(a) || a.number,
        subtitle: [t('Fixed asset'), a.number, a.location].filter(Boolean).join(' · '),
        amount: fmt.money(a.cost),
        to: `/assets/${a.id}`,
        names: [a.name, ar(a)],
        terms: [t('Fixed asset'), 'Fixed asset', a.location, a.custodian],
        numbers: [a.number, a.serialNumber],
        amounts: [a.cost],
        precision: currencyPrecision(company.currency),
        boost: a.status === 'active' ? 1 : -5,
      }),
    );
  }

  for (const c of cheques) {
    const client = c.clientId ? names.get(c.clientId) : undefined;
    entries.push(
      makeEntry({
        key: `security:${c.id}`,
        kind: 'document',
        title: `${t('Security cheque')} ${c.number}`.trim(),
        subtitle: [client ? localName(client) : c.drawer, c.purpose].filter(Boolean).join(' · '),
        amount: fmt.money(c.amount, c.currency),
        // The register's tab, searched for it (returned and cashed ones too).
        to: `/cheques?tab=security&q=${encodeURIComponent(c.number)}${c.status === 'held' ? '' : '&all=1'}`,
        names: [c.number],
        terms: [client?.name, client && ar(client), c.drawer, c.purpose, t('Security cheque')],
        numbers: [c.number],
        amounts: [c.amount],
        precision: currencyPrecision(c.currency),
        boost: c.status === 'held' ? 1 : -5,
      }),
    );
  }

  for (const f of files) {
    // A confidential paper's files are found on the Files page only, as the
    // paper is; an employee's open with them (staff never get these).
    if (f.private && !isPeopleItem({ kind: 'file', to: f.to ?? '' })) continue;
    entries.push(
      makeEntry({
        key: `file:${f.id}`,
        kind: 'file',
        title: f.name,
        subtitle: [f.owner, f.detail].filter(Boolean).join(' · '),
        to: f.to ?? '',
        names: [f.name, f.name.replace(/\.[a-z0-9]{1,5}$/i, '')],
        terms: [f.owner, f.detail, ...f.terms],
        numbers: f.numbers,
        boost: f.date ? recency(f.date) : 0,
      }),
    );
  }

  for (const p of payments) {
    const client = names.get(p.clientId);
    const out = p.direction === 'out';
    entries.push(
      makeEntry({
        key: `payment:${p.id}`,
        kind: 'document',
        title: `${out ? t('Payment made') : t('Payment received')} ${p.number}`.trim(),
        subtitle: [client ? localName(client) : '', fmt.date(p.date)].filter(Boolean).join(' · '),
        amount: fmt.money(p.amount, p.currency),
        to: `${out ? '/payments-made' : '/payments'}/${p.id}`,
        names: [p.number],
        terms: [client?.name, client && ar(client)],
        numbers: [p.number, p.reference, p.cheque?.number],
        amounts: [p.amount],
        precision: currencyPrecision(p.currency),
        boost: recency(p.date),
      }),
    );
  }
  return entries;
}

/**
 * Current employees of the other companies switched on for the search
 * across companies (`companies`, see features/people/all-companies.ts),
 * their company's name under each. Never one of the open company or of a
 * company not given, whatever `employees` holds.
 */
export function otherCompanyEmployeeEntries(
  employees: readonly Employee[],
  companies: readonly Company[],
  openId: ID,
): SearchEntry[] {
  const byId = new Map(companies.filter((c) => c.id !== openId).map((c) => [c.id, c]));
  return employees.flatMap((e) => {
    const company = byId.get(e.companyId);
    if (!company || !isCurrent(e)) return [];
    const job = localName({ name: e.jobTitle, nameAr: e.jobTitleAr });
    return [
      makeEntry({
        key: `elsewhere:${e.id}`,
        kind: 'elsewhere',
        title: localName(e),
        subtitle: [localName(company), job].filter(Boolean).join(' · '),
        to: `/employees/${e.id}`,
        companyId: company.id,
        names: [e.name, e.nameAr],
        terms: [e.jobTitle, e.jobTitleAr, e.department, company.name, company.nameAr],
        numbers: [e.number, e.civilId, e.phone],
      }),
    ];
  });
}

/** 0 to 1 by date, so a later document wins a tie without beating a better match. */
function recency(date: string): number {
  const days = Date.parse(date) / 86_400_000;
  return Number.isFinite(days) ? Math.min(1, Math.max(0, (days - 10_000) / 20_000)) : 0;
}
