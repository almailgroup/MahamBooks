import { db } from '@/db/db';

/**
 * One sync of a company at a time, across the tabs of this browser
 * (navigator.locks), and the same lock for whatever takes a company off this
 * device (removing it, erasing everything, restoring a backup over it): that
 * waits for a sync under way to finish, so a sync never sees the company's
 * records disappear half way through.
 *
 * Browsers without navigator.locks (and tests) get a lock for this tab only.
 * Locks are not re-entrant: code holding one must not ask for it again.
 */

const queues = new Map<string, Promise<unknown>>();

function inThisTab<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const before = queues.get(name) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const done = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(name, done);
  void done.then(() => {
    if (queues.get(name) === done) queues.delete(name);
  });
  return run;
}

/** Runs `fn` while holding the lock `name`, shared by the tabs of this browser. */
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(name, fn) : inThisTab(name, fn);
}

export function syncLockName(companyId: string): string {
  return `almailbooks-sync-${companyId}`;
}

/** Runs `fn` while no sync of the company runs, here or in another tab. */
export function withSyncLock<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return withLock(syncLockName(companyId), fn);
}

/** The sync locks of several companies, taken in a fixed order so callers never wait on each other. */
export function withSyncLocks<T>(companyIds: string[], fn: () => Promise<T>): Promise<T> {
  const ids = [...new Set(companyIds)].sort();
  const take = (i: number): Promise<T> =>
    i === ids.length ? fn() : withSyncLock(ids[i], () => take(i + 1));
  return take(0);
}

/** Runs `fn` while no company kept in the cloud on this device is syncing. */
export async function withAllSyncLocks<T>(fn: () => Promise<T>): Promise<T> {
  const ids = (await db.syncState.toCollection().primaryKeys()).map(String);
  return withSyncLocks(ids, fn);
}
