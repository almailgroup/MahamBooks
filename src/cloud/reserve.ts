import { db } from '@/db/db';
import type { CounterReserver } from '@/lib/numbering';
import type { CloudApi } from './api';
import { canEdit } from './roles';

/** How long saving a document waits for the cloud's number before numbering it here. */
export const RESERVE_TIMEOUT_MS = 3000;

/**
 * New document numbers for companies kept in the cloud are taken from the
 * company's counter in the cloud (reserve_number), atomically, so two devices
 * that number at the same time never give the same number. Offline, without
 * an answer in time, or on a server without the function, the device numbers
 * the document itself, as before (a duplicate is then listed as a problem
 * when the other device's document arrives).
 */
export function cloudCounterReserver(api: CloudApi, userId: string): CounterReserver {
  return async ({ companyId, kind, date, min }) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const link = await db.syncState.get(companyId);
    if (!link || link.userId !== userId || link.status !== 'ready' || !canEdit(link.role)) {
      return null;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), RESERVE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([api.reserveNumber(companyId, kind, date, min), late]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
