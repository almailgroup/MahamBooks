import { db } from '@/db/db';
import type { InvoiceDocument, Product } from '@/db/types';
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
 * Items of a company that gives item codes and that share an SKU with
 * another item, grouped by SKU: codes given on two devices at once without
 * the cloud. Nothing is changed by itself: labels may have been printed.
 */
export async function skuProblems(companyId: string): Promise<Product[][]> {
  const company = await db.companies.get(companyId);
  if (!company?.items?.autoSku) return [];
  const groups = new Map<string, Product[]>();
  for (const product of await db.products.where('companyId').equals(companyId).toArray()) {
    const key = product.sku.trim().toLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Removals of the company's files that kept failing: their records are deleted, the files not. */
export async function failedFileRemovals(companyId: string): Promise<FileTask[]> {
  return db.fileQueue
    .where('companyId')
    .equals(companyId)
    .filter((task) => task.failed === 1)
    .toArray();
}
