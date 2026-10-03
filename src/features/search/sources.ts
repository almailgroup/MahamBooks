import { db } from '@/db/db';
import type { Company, DocumentType } from '@/db/types';
import { DOCUMENT_LABELS, DOCUMENT_ROUTES } from '@/app/company';
import { displayStatus, STATUS_META } from '@/lib/status';
import { currencyPrecision } from '@/lib/money';
import { today } from '@/lib/dates';
import { isCustomer, isVendor } from '@/db/purchases';
import { NAV, NAV_FOOTER } from '@/features/shell/nav';
import { CREATE_GROUPS } from '@/features/shell/create';
import { msg, t } from '@/i18n';
import { localName } from '@/i18n/names';
import { makeEntry, type SearchEntry } from './rank';

/** Formatting bound to the company and language (`useFormat()`). */
export interface SearchFormat {
  money: (amount: number, currency?: string) => string;
  date: (value: string | null | undefined) => string;
}

/** Shortcuts that open a page with a filter, found by what people ask for. */
const SHORTCUTS: { key: string; label: string; to: string; keywords?: string }[] = [
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
  { key: 'expiring', label: msg('Expiring documents'), to: '/compliance/documents' },
  { key: 'payroll-leave', label: msg('Leave'), to: '/payroll/leave' },
  { key: 'payroll-loans', label: msg('Staff loans'), to: '/payroll/loans' },
  { key: 'stock-count', label: msg('Stock count'), to: '/inventory/count' },
];

/** Reports and settings pages, so they can be reached in two keystrokes. */
const SUB_PAGES: { label: string; to: string; keywords?: string }[] = [
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
  { label: msg('Email templates'), to: '/settings/emails' },
  { label: msg('Import data'), to: '/settings/import', keywords: 'csv excel' },
  { label: msg('Backup & data'), to: '/settings/data', keywords: 'export restore' },
  { label: msg('Payroll settings'), to: '/payroll/settings' },
];

/** Pages and actions: the same for every company, in the interface language. */
export function staticEntries(taxesOn: boolean): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const page = (to: string, label: string, boost: number, keywords?: string, group?: string) =>
    entries.push(
      makeEntry({
        key: `page:${to}`,
        kind: 'page',
        title: t(label),
        subtitle: group ? t(group) : undefined,
        to,
        names: [t(label), label],
        terms: [keywords, group ? t(group) : undefined],
        boost,
      }),
    );
  for (const entry of NAV) {
    if (entry.kind === 'link') page(entry.to, entry.label, 30, entry.keywords);
    else
      for (const child of entry.children) {
        if (child.taxesOnly && !taxesOn) continue;
        page(child.to, child.label, 30, child.keywords, entry.label);
      }
  }
  for (const link of NAV_FOOTER) page(link.to, link.label, 20);
  for (const sub of SUB_PAGES) page(sub.to, sub.label, 10, sub.keywords);

  for (const group of CREATE_GROUPS) {
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

/** Contacts, items, employees, documents and payments of a company. */
export async function recordEntries(company: Company, fmt: SearchFormat): Promise<SearchEntry[]> {
  const [clients, products, employees, documents, payments] = await Promise.all([
    db.clients.where('companyId').equals(company.id).toArray(),
    db.products.where('companyId').equals(company.id).toArray(),
    db.employees.where('companyId').equals(company.id).toArray(),
    db.documents.where('companyId').equals(company.id).toArray(),
    db.payments.where('companyId').equals(company.id).toArray(),
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
        numbers: [p.sku],
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
    const status = STATUS_META[displayStatus(d, now)];
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

/** 0 to 1 by date, so a later document wins a tie without beating a better match. */
function recency(date: string): number {
  const days = Date.parse(date) / 86_400_000;
  return Number.isFinite(days) ? Math.min(1, Math.max(0, (days - 10_000) / 20_000)) : 0;
}
