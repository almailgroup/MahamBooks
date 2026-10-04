import { db } from '@/db/db';
import type { CloudCompany } from './api';
import { startDownload, type SyncContext } from './sync';
import { keptOffDevice } from './kept-off';

/**
 * The account's companies come to every device it signs in on by
 * themselves. Two kinds stay put until the person decides: a company they
 * removed from this device (remembered in kept-off.ts), and one this device
 * already has a copy of that isn't linked to the cloud (it would be
 * replaced).
 */

/** How a company of the account reaches this device. */
export type Arrival =
  /** Already here (synced, or on its way). */
  | 'here'
  /** Comes by itself. */
  | 'auto'
  /** Removed from this device on purpose: downloaded only when asked. */
  | 'kept_off'
  /** This device has its own copy: replaced only when asked. */
  | 'replace';

export async function arrivals(
  companies: CloudCompany[],
  userId: string,
): Promise<Map<string, Arrival>> {
  const [linked, local, off] = await Promise.all([
    db.syncState.toCollection().primaryKeys(),
    db.companies.toCollection().primaryKeys(),
    keptOffDevice(userId),
  ]);
  const links = new Set<string>(linked);
  const here = new Set<string>(local);
  return new Map(
    companies.map((c): [string, Arrival] => [
      c.id,
      links.has(c.id) ? 'here' : off.has(c.id) ? 'kept_off' : here.has(c.id) ? 'replace' : 'auto',
    ]),
  );
}

function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(name, fn) : fn();
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Starts downloading every company of the account that comes by itself and
 * isn't here yet; returns their ids. One run at a time in this browser (tabs
 * included), and each company is checked again just before it starts, so
 * nothing is downloaded twice.
 */
export function downloadAccountCompanies(
  companies: CloudCompany[],
  ctx: SyncContext,
): Promise<string[]> {
  const run = queue.then(() =>
    webLock('almailbooks-auto-download', async () => {
      const started: string[] = [];
      for (const company of companies) {
        const arrival = (await arrivals([company], ctx.userId)).get(company.id);
        if (arrival !== 'auto') continue;
        await startDownload(company, ctx);
        started.push(company.id);
      }
      return started;
    }),
  );
  queue = run.catch(() => undefined);
  return run;
}
