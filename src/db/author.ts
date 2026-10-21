import type { ID } from './types';

/**
 * Who is making changes on this device, for the activity log (D8 of
 * docs/requirements-plan.md): the signed-in account, in the companies kept
 * in the cloud with it. A company kept on this device only has nobody to
 * tell apart, so its activity names nobody, as before. The cloud store sets
 * it; nothing here is saved.
 */

export interface ActivityAuthor {
  /** The account's id, as the server knows it. */
  id: string;
  /** The name the team knows them by (or their email). */
  name: string;
}

let author: ActivityAuthor | null = null;
let companies: ReadonlySet<ID> = new Set();

/** The signed-in person, or null once nobody is. */
export function setActivityAuthor(next: ActivityAuthor | null): void {
  author = next && next.id ? { id: next.id, name: next.name.trim().slice(0, 200) } : null;
  if (!author) companies = new Set();
}

/** The companies kept in the cloud with the signed-in account. */
export function setAuthorCompanies(ids: Iterable<ID>): void {
  companies = new Set(ids);
}

/** Who to name on a change of this company, or null. */
export function activityAuthor(companyId: ID): ActivityAuthor | null {
  return author && companies.has(companyId) ? author : null;
}
