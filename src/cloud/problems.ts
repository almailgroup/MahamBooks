import { db } from '@/db/db';
import { defaultNumbering } from '@/db/defaults';
import type { Company, InvoiceDocument, Product } from '@/db/types';
import { writtenBy } from '@/lib/numbering';
import type { FileTask } from './types';

/**
 * Sync problems a person looks at in Settings → Cloud, besides the changes
 * the cloud refused (parked in the outbox).
 */

/**
 * Documents of the company that share a number with another document of the
 * same kind, found when another device's documents arrived (both numbered
 * without the cloud, offline): grouped by number, for the person to renumber
 * one. Nothing is renumbered by itself: the documents may have been sent.
 */
export async function numberProblems(companyId: string): Promise<InvoiceDocument[][]> {
  const link = await db.syncState.get(companyId);
  const groups = new Map<string, InvoiceDocument[]>();
  for (const id of link?.duplicates ?? []) {
    const doc = await db.documents.get(id);
    if (!doc || doc.companyId !== companyId) continue;
    const key = `${doc.type}/${doc.number}`;
    if (groups.has(key)) continue;
    const same = await db.documents
      .where('[companyId+type+number]')
      .equals([companyId, doc.type, doc.number])
      .toArray();
    if (same.length > 1) groups.set(key, same);
  }
  return [...groups.values()];
}

/**
 * Items of a company that gives item codes and that share a code it gives
 * (such as SKU-00004) with another item, grouped by SKU: codes given on two
 * devices at once without the cloud. SKUs typed in another way, which
 * items could always share, and groups of archived items only are left out.
 * Nothing is changed by itself: labels may have been printed.
 */
export function sharedItemCodes(
  company: Pick<Company, 'items' | 'numbering'> | null | undefined,
  products: Product[],
): Product[][] {
  if (!company?.items?.autoSku) return [];
  // As db/inventory reads them: the rule item codes are given with, and
  // SKUs compared trimmed and in lower case.
  const rule = company.numbering.product ?? defaultNumbering().product;
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.sku.trim().toLowerCase();
    if (!key || !writtenBy(rule, key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  return [...groups.values()].filter((group) => group.length > 1 && group.some((p) => !p.archived));
}

/** sharedItemCodes of the company stored on this device. */
export async function skuProblems(companyId: string): Promise<Product[][]> {
  const company = await db.companies.get(companyId);
  if (!company?.items?.autoSku) return [];
  return sharedItemCodes(company, await db.products.where('companyId').equals(companyId).toArray());
}

/** Removals of the company's files that kept failing: their records are deleted, the files not. */
export async function failedFileRemovals(companyId: string): Promise<FileTask[]> {
  return db.fileQueue
    .where('companyId')
    .equals(companyId)
    .filter((task) => task.failed === 1)
    .toArray();
}
