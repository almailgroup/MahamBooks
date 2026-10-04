import { db, setMeta, getMeta, DATA_TABLES } from './db';
import { createCompany, createTaxRate, nowStamp } from './defaults';
import { chartAccounts, defaultAccountingSettings } from './chart-setup';
import { logActivity } from './activity';
import type {
  Branding,
  Client,
  Company,
  DocumentDefaults,
  ID,
  KuwaitProfile,
  Product,
  TaxLine,
  TaxRate,
} from './types';
import { allocateNumber } from '@/lib/numbering';
import { taxKind } from '@/lib/calc';
import { kuwaitProfile } from '@/lib/kuwait-rules';
import { msg, t } from '@/i18n';

/* -------------------------------------------------------------------------- */
/* Companies                                                                  */
/* -------------------------------------------------------------------------- */

export const CURRENT_COMPANY_KEY = 'currentCompanyId';

export async function getCurrentCompanyId(): Promise<ID | null> {
  return getMeta<ID | null>(CURRENT_COMPANY_KEY, null);
}

export async function setCurrentCompanyId(id: ID): Promise<void> {
  await setMeta(CURRENT_COMPANY_KEY, id);
}

export async function saveCompany(company: Company): Promise<Company> {
  const updated = { ...company, updatedAt: nowStamp() };
  await db.companies.put(updated);
  return updated;
}

/**
 * What the welcome page (or "Add company") collects. Nested settings are
 * partial: anything not given keeps its default.
 */
export interface CompanySetup extends Partial<
  Omit<Company, 'branding' | 'defaults' | 'kuwait' | 'accounting'>
> {
  branding?: Partial<Branding>;
  defaults?: Partial<DocumentDefaults>;
  kuwait?: Partial<KuwaitProfile>;
}

/**
 * Creates a company and makes it current. Kuwait comes first: KWD, the
 * bilingual Kuwait chart of accounts and no taxes unless starter tax rates
 * are given (or `taxesEnabled` is set).
 */
export async function setupCompany(
  partial: CompanySetup,
  taxRates: TaxLine[] = [],
): Promise<Company> {
  return db.transaction(
    'rw',
    [db.companies, db.taxRates, db.accounts, db.meta, db.activities],
    async () => {
      const { branding, defaults, kuwait, ...rest } = partial;
      const company = createCompany(rest);
      company.name = company.name.trim();
      if (company.nameAr !== undefined) company.nameAr = company.nameAr.trim();
      company.branding = { ...company.branding, ...branding };
      const given = Object.entries(kuwait ?? {}).filter(([, v]) => v !== undefined);
      company.kuwait = { ...kuwaitProfile(company), ...Object.fromEntries(given) };
      company.accounting = defaultAccountingSettings(company.address.country);
      const rates = taxRates
        .filter((t) => t.name.trim())
        .map((t) =>
          createTaxRate(company.id, { name: t.name.trim(), rate: t.rate, kind: taxKind(t) }),
        );
      const charges = partial.taxesEnabled ?? rates.length > 0;
      company.taxesEnabled = charges;
      company.defaults = {
        ...company.defaults,
        ...defaults,
        defaultTaxRateIds: rates.slice(0, 1).map((r) => r.id),
      };
      if (!charges)
        company.defaults = { ...company.defaults, lineTaxes: false, documentTaxes: false };
      await db.companies.add(company);
      if (rates.length) await db.taxRates.bulkAdd(rates);
      await db.accounts.bulkAdd(chartAccounts(company.id, company.accounting.template));
      await setCurrentCompanyId(company.id);
      await logActivity(company.id, 'company', company.id, 'created', {
        text: msg('Company {name} created'),
        vars: { name: company.name },
        arabic: { name: company.nameAr },
      });
      return company;
    },
  );
}

/** Deletes a company and everything that belongs to it. */
export async function deleteCompany(id: ID): Promise<void> {
  await db.transaction('rw', [...DATA_TABLES.map((t) => db[t]), db.meta], async () => {
    for (const table of DATA_TABLES) {
      if (table === 'companies') continue;
      await db[table].where('companyId').equals(id).delete();
    }
    await db.companies.delete(id);
    const current = await getCurrentCompanyId();
    if (current === id) {
      const next = await db.companies.toCollection().first();
      if (next) await setCurrentCompanyId(next.id);
      else await db.meta.delete(CURRENT_COMPANY_KEY);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Clients                                                                    */
/* -------------------------------------------------------------------------- */

export async function saveClient(input: Client): Promise<Client> {
  return db.transaction('rw', [db.clients, db.companies, db.activities], async () => {
    const existing = await db.clients.get(input.id);
    let client: Client = { ...input, name: input.name.trim(), updatedAt: nowStamp() };
    if (!client.number.trim()) {
      const company = await db.companies.get(client.companyId);
      if (company) {
        const taken = new Set(
          (await db.clients.where('companyId').equals(company.id).toArray()).map((c) =>
            c.number.toLowerCase(),
          ),
        );
        const allocated = allocateNumber(
          company.numbering.client,
          client.createdAt.slice(0, 10),
          (n) => taken.has(n.toLowerCase()),
        );
        client = { ...client, number: allocated.number };
        await db.companies.put({
          ...company,
          numbering: { ...company.numbering, client: allocated.rule },
        });
      }
    }
    // Keep the contact flagged as primary first and make sure one exists.
    if (client.contacts.length && !client.contacts.some((c) => c.primary)) {
      client.contacts = client.contacts.map((c, i) => ({ ...c, primary: i === 0 }));
    }
    const primary = client.contacts.find((c) => c.primary);
    if (!client.email && primary?.email) client.email = primary.email;
    await db.clients.put(client);
    if (!existing) {
      await logActivity(
        client.companyId,
        'client',
        client.id,
        'created',
        {
          text:
            client.isCustomer === false ? msg('Vendor {name} added') : msg('Client {name} added'),
          vars: { name: client.name },
          arabic: { name: client.nameAr },
        },
        { clientId: client.id },
      );
    }
    return client;
  });
}

export async function clientHasRecords(id: ID): Promise<boolean> {
  const [docs, payments, recurring, expenses] = await Promise.all([
    db.documents.where('clientId').equals(id).count(),
    db.payments.where('clientId').equals(id).count(),
    db.recurring.where('clientId').equals(id).count(),
    db.expenses.where('vendorId').equals(id).count(),
  ]);
  return docs + payments + recurring + expenses > 0;
}

export async function deleteClient(id: ID): Promise<void> {
  if (await clientHasRecords(id)) {
    throw new Error(t('This contact has documents, payments or expenses. Archive it instead.'));
  }
  const client = await db.clients.get(id);
  await db.clients.delete(id);
  if (client) {
    await logActivity(client.companyId, 'client', id, 'deleted', {
      text:
        client.isCustomer === false ? msg('Vendor {name} deleted') : msg('Client {name} deleted'),
      vars: { name: client.name },
      arabic: { name: client.nameAr },
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

export async function saveProduct(product: Product): Promise<Product> {
  const updated = { ...product, name: product.name.trim(), updatedAt: nowStamp() };
  await db.products.put(updated);
  return updated;
}

export async function deleteProduct(id: ID): Promise<void> {
  await db.products.delete(id);
}

/* -------------------------------------------------------------------------- */
/* Tax rates                                                                  */
/* -------------------------------------------------------------------------- */

export async function saveTaxRate(rate: TaxRate): Promise<TaxRate> {
  const updated = { ...rate, name: rate.name.trim(), updatedAt: nowStamp() };
  await db.taxRates.put(updated);
  return updated;
}

/** Deletes a tax rate. Existing documents keep their own copy of the rate. */
export async function deleteTaxRate(id: ID): Promise<void> {
  await db.transaction('rw', [db.taxRates, db.companies, db.products], async () => {
    const rate = await db.taxRates.get(id);
    if (!rate) return;
    await db.taxRates.delete(id);
    const company = await db.companies.get(rate.companyId);
    if (company?.defaults.defaultTaxRateIds.includes(id)) {
      await db.companies.put({
        ...company,
        defaults: {
          ...company.defaults,
          defaultTaxRateIds: company.defaults.defaultTaxRateIds.filter((t) => t !== id),
        },
      });
    }
    const products = await db.products.where('companyId').equals(rate.companyId).toArray();
    for (const p of products) {
      if (p.taxRateIds.includes(id)) {
        await db.products.put({ ...p, taxRateIds: p.taxRateIds.filter((t) => t !== id) });
      }
    }
  });
}
