import { db } from './db';
import { logActivity } from './activity';
import { nowStamp } from './defaults';
import type { ID } from './types';
import { msg } from '@/i18n';

/** The company has the document finder: the Files page and search over files and papers (off until switched on). */
export function fileFinderOn(company: { fileFinder?: boolean } | null | undefined): boolean {
  return company?.fileFinder === true;
}

/** Switches the document finder on or off. */
export async function setFileFinder(companyId: ID, on: boolean): Promise<void> {
  await db.transaction('rw', [db.companies, db.activities], async () => {
    const company = await db.companies.get(companyId);
    if (!company || fileFinderOn(company) === on) return;
    await db.companies.put({ ...company, fileFinder: on, updatedAt: nowStamp() });
    await logActivity(companyId, 'company', companyId, 'updated', {
      text: on
        ? msg('Finding files and papers switched on')
        : msg('Finding files and papers switched off'),
    });
  });
}
