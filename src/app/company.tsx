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
} from '@/lib/format';
import { interfaceLocale } from '@/i18n';

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
 * interface language (Arabic shows amounts as "1,234.500 د.ك.").
 */
export function useFormat() {
  const company = useCompany();
  return useMemo(() => {
    const locale = interfaceLocale(company.locale);
    return {
      locale,
      currency: company.currency,
      money: (amount: number, currency: string = company.currency) =>
        formatMoney(amount, currency, locale, company.currencyDisplay ?? 'local'),
      date: (value: ISODate | null | undefined) => formatDate(value, company.dateFormat, locale),
      dateTime: (value: string | null | undefined) => formatDateTime(value, locale),
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
};

export const DOCUMENT_LABELS: Record<DocumentType, { singular: string; plural: string }> = {
  invoice: { singular: 'Invoice', plural: 'Invoices' },
  quote: { singular: 'Quote', plural: 'Quotes' },
  credit: { singular: 'Credit note', plural: 'Credit notes' },
  bill: { singular: 'Bill', plural: 'Bills' },
  vendor_credit: { singular: 'Vendor credit', plural: 'Vendor credits' },
};
