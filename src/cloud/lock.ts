import { db } from '@/db/db';
import { t } from '@/i18n';
import { CloudError } from './api';

/**
 * One sync of a company at a time, across the tabs of this browser
 * (navigator.locks), and the same lock for whatever takes a company off this
 * device (removing it, erasing everything, restoring a backup over it): that
 * waits for a sync under way to finish, so a sync never sees the company's
 * records disappear half way through.
 *
 * Taking a company off the device never waits for long: a sync of it under
 * way in this tab stops bringing in changes at once (what it is sending still
 * goes), and when a sync still holds the lock after LOCK_WAIT_MS (another
 * tab's, a slow upload) the removal stops with "A sync is still running. Try
 * again in a moment." instead of waiting.
 *
 * Browsers without navigator.locks (and tests) get a lock for this tab only.
 * Locks are not re-entrant: code holding one must not ask for it again.
 */

/** How long taking a company off this device waits for a sync under way. */
export const LOCK_WAIT_MS = 30_000;

function stillSyncing(): CloudError {
  return new CloudError('server', t('A sync is still running. Try again in a moment.'));
}

/** Settles with `before`, or rejects with stillSyncing() after `ms`. */
function waitAtMost(before: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(stillSyncing()), ms);
    void before.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Each lock's queue in this tab: settles once everyone in it is done (never rejects). */
const queues = new Map<string, Promise<void>>();

function inThisTab<T>(name: string, fn: () => Promise<T>, waitMs?: number): Promise<T> {
  const before = queues.get(name) ?? Promise.resolve();
  const turn = waitMs === undefined ? before : waitAtMost(before, waitMs);
  const run = turn.then(fn);
  // Whoever comes next waits for this caller and for everyone before it: a
  // caller that stopped waiting never runs, but those before it still do.
  const done = Promise.all([before, run.catch(() => undefined)]).then(() => undefined);
  queues.set(name, done);
  void done.then(() => {
    if (queues.get(name) === done) queues.delete(name);
  });
  return run;
}

/**
 * Runs `fn` while holding the lock `name`, shared by the tabs of this
 * browser. With `waitMs`, gives up waiting for it after that long (`fn` then
 * doesn't run) with "A sync is still running. Try again in a moment."
 */
export function withLock<T>(name: string, fn: () => Promise<T>, waitMs?: number): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return inThisTab(name, fn, waitMs);
  if (waitMs === undefined) return locks.request(name, fn);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  let granted = false;
  return locks
    .request(name, { signal: controller.signal }, () => {
      granted = true;
      clearTimeout(timer);
      return fn();
    })
    .catch((error: unknown) => {
      // Not granted in time: the request left the queue without running.
      if (!granted && controller.signal.aborted) throw stillSyncing();
      throw error;
    })
    .finally(() => clearTimeout(timer));
}

export function syncLockName(companyId: string): string {
  return `almailbooks-sync-${companyId}`;
}

/* -------------------------------------------------------------------------- */
/* Syncs under way in this tab                                                */
/* -------------------------------------------------------------------------- */

const running = new Map<string, Set<AbortController>>();

/**
 * Notes a sync of the company starting in this tab; `end` when it is over.
 * Its `stop` signal fires when the company is about to be taken off this
 * device (or replaced): the sync then stops bringing in changes.
 */
export function syncStarted(companyId: string): { stop: AbortSignal; end: () => void } {
  const controller = new AbortController();
  let syncs = running.get(companyId);
  if (!syncs) running.set(companyId, (syncs = new Set()));
  syncs.add(controller);
  return {
    stop: controller.signal,
    end: () => {
      syncs.delete(controller);
      if (syncs.size === 0 && running.get(companyId) === syncs) running.delete(companyId);
    },
  };
}

/** Tells the syncs of the company under way in this tab to stop bringing in changes. */
function stopReceiving(companyId: string): void {
  for (const controller of running.get(companyId) ?? []) controller.abort();
}

export interface SyncLockOptions {
  /**
   * Whether a sync of the company in this tab stops bringing in changes
   * (the default, for taking the company off this device or replacing it).
   * Changes made to the company's records (a merged backup) wait for the
   * sync to finish instead: what it brings in must be here first.
   */
  stop?: boolean;
}

/**
 * Runs `fn` while no sync of the company runs, here or in another tab, to
 * take the company off this device or change it under the sync's feet. A
 * sync of it in this tab stops bringing in changes (unless `stop` is false);
 * one that still holds the lock after LOCK_WAIT_MS makes this fail with "A
 * sync is still running."
 */
export function withSyncLock<T>(
  companyId: string,
  fn: () => Promise<T>,
  options: SyncLockOptions = {},
): Promise<T> {
  if (options.stop !== false) stopReceiving(companyId);
  return withLock(syncLockName(companyId), fn, LOCK_WAIT_MS);
}

/** The sync locks of several companies, taken in a fixed order so callers never wait on each other. */
export function withSyncLocks<T>(
  companyIds: string[],
  fn: () => Promise<T>,
  options: SyncLockOptions = {},
): Promise<T> {
  const ids = [...new Set(companyIds)].sort();
  if (options.stop !== false) for (const id of ids) stopReceiving(id);
  const take = (i: number): Promise<T> =>
    i === ids.length ? fn() : withSyncLock(ids[i], () => take(i + 1), options);
  return take(0);
}

/** Runs `fn` while no company kept in the cloud on this device is syncing. */
export async function withAllSyncLocks<T>(
  fn: () => Promise<T>,
  options: SyncLockOptions = {},
): Promise<T> {
  const ids = (await db.syncState.toCollection().primaryKeys()).map(String);
  return withSyncLocks(ids, fn, options);
}
