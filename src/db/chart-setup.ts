import type { Dexie } from 'dexie';
import { CHART_TEMPLATES, chartTemplateFor } from '@/lib/accounting/charts';
import { emirateFromAddress, vatFormatFor } from '@/lib/accounting/vat';
import { newId } from '@/lib/ids';
import type {
  Account,
  AccountingSettings,
  ChartTemplateId,
  Company,
  ID,
  VatSettings,
} from './types';

export function defaultAccountingSettings(country: string): AccountingSettings {
  return {
    template: chartTemplateFor(country),
    fiscalYearEnd: { month: 12, day: 31 },
    lockDate: null,
  };
}

/** Settings of a company, with defaults for companies created before accounting. */
export function accountingSettings(company: Company): AccountingSettings {
  return company.accounting ?? defaultAccountingSettings(company.address?.country ?? '');
}

/** VAT return settings, with defaults from the company's country and tax number. */
export function vatSettings(company: Company): VatSettings {
  const saved = accountingSettings(company).vat;
  if (saved) return saved;
  const country = company.address?.country ?? '';
  return {
    // Kuwait has no VAT: a tax card or CR number doesn't make a company VAT-registered.
    registered: country.toUpperCase() !== 'KW' && Boolean(company.taxId?.trim()),
    format: vatFormatFor(country),
    frequency: 'quarterly',
    startMonth: 1,
    emirate: country.toUpperCase() === 'AE' ? (emirateFromAddress(company.address) ?? 'DU') : null,
  };
}

/** The accounts of a chart template, ready to store for a company. */
export function chartAccounts(companyId: ID, template: ChartTemplateId): Account[] {
  const stamp = new Date().toISOString();
  return CHART_TEMPLATES[template].accounts.map((a) => ({
    id: newId(),
    companyId,
    code: a.code,
    name: a.name,
    ...(a.nameAr ? { nameAr: a.nameAr } : {}),
    type: a.type,
    description: '',
    role: a.role ?? null,
    bank: null,
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
  }));
}

/**
 * Gives every company without a chart of accounts one, based on its country.
 * Covers companies created before accounting existed and restored backups.
 * Must run where the companies and accounts tables are writable.
 */
export async function seedMissingCharts(target: Dexie): Promise<void> {
  const companies = await target.table<Company, ID>('companies').toArray();
  for (const company of companies) {
    const count = await target.table('accounts').where('companyId').equals(company.id).count();
    const settings =
      company.accounting ?? defaultAccountingSettings(company.address?.country ?? '');
    if (count === 0) {
      await target.table('accounts').bulkAdd(chartAccounts(company.id, settings.template));
    }
    if (!company.accounting) {
      await target.table('companies').update(company.id, { accounting: settings });
    }
  }
}
