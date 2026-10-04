import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { getCurrentCompanyId, setCurrentCompanyId } from '@/db/records';
import type { Company, DocumentType, ISODate } from '@/db/types';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatQuantity,
  isolateAmount,
} from '@/lib/format';
import { interfaceLocale, msg, t, tp } from '@/i18n';

interface CompanyContextValue {
  company: Company;
  companies: Company[];
  switchCompany: (id: string) => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

/**
 * Loads the companies and the active one. Renders `fallback` while loading and
 * `onboarding` when no company exists yet.
 */
export function CompanyProvider({
  children,
  fallback,
  onboarding,
}: {
  children: ReactNode;
  fallback: ReactNode;
  onboarding: ReactNode;
}) {
  const companies = useLiveQuery(() => db.companies.orderBy('name').toArray(), []);
  const currentId = useLiveQuery(() => getCurrentCompanyId(), []);

  const switchCompany = useCallback(async (id: string) => {
    await setCurrentCompanyId(id);
  }, []);

  const value = useMemo<CompanyContextValue | null>(() => {
    if (!companies || companies.length === 0) return null;
    const company = companies.find((c) => c.id === currentId) ?? companies[0];
    return { company, companies, switchCompany };
  }, [companies, currentId, switchCompany]);

  if (companies === undefined || currentId === undefined) return <>{fallback}</>;
  if (!value) return <>{onboarding}</>;
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompanyContext(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used inside CompanyProvider');
  return ctx;
}

export function useCompany(): Company {
  return useCompanyContext().company;
}

/**
 * Formatting helpers bound to the active company's currency and the
 * interface language (Arabic shows amounts as "1,234.500 د.ك", kept in one
 * piece and in order wherever they are shown, see `isolateAmount`).
 */
export function useFormat() {
  const company = useCompany();
  return useMemo(() => {
    const locale = interfaceLocale(company.locale);
    return {
      locale,
      currency: company.currency,
      money: (amount: number, currency: string = company.currency) =>
        isolateAmount(
          formatMoney(amount, currency, locale, company.currencyDisplay ?? 'local'),
          locale,
        ),
      date: (value: ISODate | null | undefined) => formatDate(value, company.dateFormat, locale),
      dateTime: (value: string | null | undefined) =>
        formatDateTime(value, locale, company.dateFormat),
      quantity: (value: number) => formatQuantity(value, locale),
      percent: (value: number) => formatPercent(value, locale),
    };
  }, [company]);
}

export const DOCUMENT_ROUTES: Record<DocumentType, string> = {
  invoice: '/invoices',
  quote: '/quotes',
  credit: '/credits',
  bill: '/bills',
  vendor_credit: '/vendor-credits',
  proforma: '/proformas',
  sales_order: '/sales-orders',
  purchase_order: '/purchase-orders',
  delivery_note: '/delivery-notes',
};

export interface DocumentLabels {
  singular: string;
  plural: string;
  /** Page title and button, e.g. "New invoice". */
  create: string;
  /** Label of the number field. */
  numberLabel: string;
  /** Empty list title. */
  empty: string;
  /** What the list is for, under its title. */
  description: string;
}

/** Names of each document type. English keys: show them with `t(...)`. */
export const DOCUMENT_LABELS: Record<DocumentType, DocumentLabels> = {
  invoice: {
    singular: msg('Invoice'),
    plural: msg('Invoices'),
    create: msg('New invoice'),
    numberLabel: msg('Invoice number'),
    empty: msg('No invoices yet'),
    description: msg('Bill your clients and track what is paid.'),
  },
  quote: {
    singular: msg('Quote'),
    plural: msg('Quotes'),
    create: msg('New quote'),
    numberLabel: msg('Quote number'),
    empty: msg('No quotes yet'),
    description: msg('Send estimates and convert accepted quotes into invoices.'),
  },
  credit: {
    singular: msg('Credit note'),
    plural: msg('Credit notes'),
    create: msg('New credit note'),
    numberLabel: msg('Credit note number'),
    empty: msg('No credit notes yet'),
    description: msg('Issue credit notes and apply them to invoices.'),
  },
  bill: {
    singular: msg('Bill'),
    plural: msg('Bills'),
    create: msg('New bill'),
    numberLabel: msg('Bill number'),
    empty: msg('No bills yet'),
    description: msg('Record bills from your suppliers and keep track of what you owe.'),
  },
  vendor_credit: {
    singular: msg('Vendor credit'),
    plural: msg('Vendor credits'),
    create: msg('New vendor credit'),
    numberLabel: msg('Vendor credit number'),
    empty: msg('No vendor credits yet'),
    description: msg('Credits from suppliers for returns or refunds, applied to their bills.'),
  },
  proforma: {
    singular: msg('Proforma invoice'),
    plural: msg('Proforma invoices'),
    create: msg('New proforma invoice'),
    numberLabel: msg('Proforma number'),
    empty: msg('No proforma invoices yet'),
    description: msg(
      'Ask for advance payment, open a letter of credit or get a purchase approved before you invoice.',
    ),
  },
  sales_order: {
    singular: msg('Sales order'),
    plural: msg('Sales orders'),
    create: msg('New sales order'),
    numberLabel: msg('Order number'),
    empty: msg('No sales orders yet'),
    description: msg('Confirm orders, then deliver and invoice them in one go or in parts.'),
  },
  purchase_order: {
    singular: msg('Purchase order'),
    plural: msg('Purchase orders'),
    create: msg('New purchase order'),
    numberLabel: msg('PO number'),
    empty: msg('No purchase orders yet'),
    description: msg('Send purchase orders (LPOs) to suppliers and turn them into bills.'),
  },
  delivery_note: {
    singular: msg('Delivery note'),
    plural: msg('Delivery notes'),
    create: msg('New delivery note'),
    numberLabel: msg('Delivery note number'),
    empty: msg('No delivery notes yet'),
    description: msg('Delivery notes for your customers to sign and stamp on receipt.'),
  },
};

/** "3 invoices", in the interface language. */
export function documentCount(type: DocumentType, count: number): string {
  switch (type) {
    case 'invoice':
      return tp(count, '{count} invoice', '{count} invoices');
    case 'quote':
      return tp(count, '{count} quote', '{count} quotes');
    case 'credit':
      return tp(count, '{count} credit note', '{count} credit notes');
    case 'bill':
      return tp(count, '{count} bill', '{count} bills');
    case 'vendor_credit':
      return tp(count, '{count} vendor credit', '{count} vendor credits');
    case 'proforma':
      return tp(count, '{count} proforma invoice', '{count} proforma invoices');
    case 'sales_order':
      return tp(count, '{count} sales order', '{count} sales orders');
    case 'purchase_order':
      return tp(count, '{count} purchase order', '{count} purchase orders');
    case 'delivery_note':
      return tp(count, '{count} delivery note', '{count} delivery notes');
  }
}

/** The type's name in running text: "invoice", "sales order" (Arabic as is). */
export function documentNoun(type: DocumentType): string {
  return t(DOCUMENT_LABELS[type].singular).toLowerCase();
}
