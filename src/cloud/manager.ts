import { cloudError, type CloudErrorCode } from './api';
import { onLocalChange } from './outbox';
import { syncStatus } from './status';
import { applyRole, downloadMissingFiles, syncCompany, type SyncContext } from './sync';
import { EAGER_DOWNLOAD_BYTES } from './files';
import { db } from '@/db/db';

/**
 * When to sync: soon after a change here (debounced), when the app starts,
 * comes back online or into view, every minute while it is open, and when
 * the cloud says a company changed. Failures are retried with growing
 * pauses (up to five minutes); changes are never dropped in between. Only
 * one tab syncs a company at a time.
 */

type Timer = ReturnType<typeof setTimeout>;

export interface ManagerOptions {
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (timer: Timer) => void;
  now?: () => number;
  random?: () => number;
  /** Runs `fn` while holding a lock shared by the tabs of this browser. */
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  intervalMs?: number;
}

const MINUTE = 60_000;

/** Pause before retry number `attempt` (1, 2, …): 2 s doubling up to 5 min, ±20 %. */
export function backoff(attempt: number, random = Math.random): number {
  const base = Math.min(2000 * 2 ** (attempt - 1), 5 * MINUTE);
  return Math.round(base * (0.8 + 0.4 * random()));
}

function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(name, fn) : fn();
}

export class SyncManager {
  private readonly timers = new Map<string, { at: number; timer: Timer }>();
  private readonly failures = new Map<string, number>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  private readonly watchers = new Map<string, () => void>();
  private readonly cleanup: (() => void)[] = [];
  private companies = new Set<string>();
  private stopped = true;
  private lastAll = 0;
  private lastMembership = 0;
  private readonly o: Required<ManagerOptions>;

  constructor(
    private readonly ctx: SyncContext,
    options: ManagerOptions = {},
  ) {
    this.o = {
      setTimeout: options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: options.clearTimeout ?? ((timer) => clearTimeout(timer)),
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
      lock: options.lock ?? webLock,
      intervalMs: options.intervalMs ?? MINUTE,
    };
  }

  get userId(): string {
    return this.ctx.userId;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.cleanup.push(
      onLocalChange((ids) => {
        for (const id of ids) if (this.companies.has(id)) this.schedule(id, 1000);
      }),
    );
    if (typeof window !== 'undefined') {
      const online = () => this.syncAll();
      const back = () => {
        if (document.visibilityState !== 'visible') return;
        this.syncAll(30_000);
        void this.refreshMembership(5 * MINUTE);
      };
      window.addEventListener('online', online);
      window.addEventListener('focus', back);
      document.addEventListener('visibilitychange', back);
      this.cleanup.push(() => {
        window.removeEventListener('online', online);
        window.removeEventListener('focus', back);
        document.removeEventListener('visibilitychange', back);
      });
    }
    const tick = () => {
      if (this.stopped) return;
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.syncAll();
      interval = this.o.setTimeout(tick, this.o.intervalMs);
    };
    let interval = this.o.setTimeout(tick, this.o.intervalMs);
    this.cleanup.push(() => this.o.clearTimeout(interval));
    void this.refreshMembership();
  }

  stop(): void {
    this.stopped = true;
    for (const fn of this.cleanup.splice(0)) fn();
    for (const { timer } of this.timers.values()) this.o.clearTimeout(timer);
    this.timers.clear();
    for (const stop of this.watchers.values()) stop();
    this.watchers.clear();
  }

  /** The companies this account syncs on this device. New ones sync right away. */
  setCompanies(ids: string[]): void {
    const next = new Set(ids);
    for (const id of next) {
      if (this.companies.has(id)) continue;
      this.companies.add(id);
      if (!this.stopped) {
        this.watchers.set(
          id,
          this.ctx.api.watch(id, () => this.schedule(id, 500)),
        );
        this.schedule(id, 0);
      }
    }
    for (const id of [...this.companies]) {
      if (next.has(id)) continue;
      this.companies.delete(id);
      this.watchers.get(id)?.();
      this.watchers.delete(id);
      const timer = this.timers.get(id);
      if (timer) this.o.clearTimeout(timer.timer);
      this.timers.delete(id);
    }
  }

  /** Syncs a company after `delay` ms (an earlier request wins). */
  schedule(companyId: string, delay: number): void {
    if (this.stopped || !this.companies.has(companyId)) return;
    const at = this.o.now() + delay;
    const current = this.timers.get(companyId);
    if (current && current.at <= at) return;
    if (current) this.o.clearTimeout(current.timer);
    const timer = this.o.setTimeout(() => {
      this.timers.delete(companyId);
      void this.run(companyId);
    }, delay);
    this.timers.set(companyId, { at, timer });
  }

  /** Syncs every company now, at most once per `throttle` ms. */
  syncAll(throttle = 0): void {
    const now = this.o.now();
    if (throttle && now - this.lastAll < throttle) return;
    this.lastAll = now;
    for (const id of this.companies) this.schedule(id, 0);
  }

  /** Syncs a company (or all) now and waits for it. */
  async syncNow(companyId?: string): Promise<void> {
    const ids = companyId ? [companyId] : [...this.companies];
    await Promise.all(ids.map((id) => this.run(id)));
  }

  /** Brings roles up to date and notices companies this account has left. */
  async refreshMembership(throttle = 0): Promise<void> {
    const now = this.o.now();
    if (throttle && now - this.lastMembership < throttle) return;
    this.lastMembership = now;
    try {
      const cloud = new Map((await this.ctx.api.myCompanies()).map((c) => [c.id, c]));
      const links = await db.syncState
        .where('companyId')
        .anyOf([...this.companies])
        .toArray();
      for (const link of links) {
        if (link.userId !== this.ctx.userId || link.status === 'removed') continue;
        const company = cloud.get(link.companyId);
        if (!company) {
          // Still being created by this device's upload, or really gone.
          if (link.status === 'uploading' && link.lastSyncAt === null) continue;
          await db.syncState.update(link.companyId, { status: 'removed', removedReason: 'access' });
          continue;
        }
        if (company.name !== link.name)
          await db.syncState.update(link.companyId, { name: company.name });
        if (company.role !== link.role) {
          await applyRole(link.companyId, company.role);
          this.schedule(link.companyId, 0);
        }
      }
    } catch {
      // Offline: roles are checked again later.
    }
  }

  private run(companyId: string): Promise<void> {
    const current = this.running.get(companyId);
    if (current) {
      this.again.add(companyId);
      return current;
    }
    syncStatus.set(companyId, { phase: 'syncing' });
    const job = (async () => {
      try {
        await this.o.lock(`almailbooks-sync-${companyId}`, () =>
          syncCompany(companyId, {
            ...this.ctx,
            onProgress: (progress) => syncStatus.set(companyId, { progress }),
          }),
        );
        this.failures.delete(companyId);
        syncStatus.set(companyId, {
          phase: 'idle',
          error: undefined,
          message: undefined,
          progress: undefined,
          syncedOnce: true,
        });
        void downloadMissingFiles(companyId, this.ctx, EAGER_DOWNLOAD_BYTES).catch(() => undefined);
      } catch (error) {
        const e = cloudError(error);
        const code: CloudErrorCode = e.code;
        syncStatus.set(companyId, {
          phase: code === 'offline' ? 'offline' : 'error',
          error: code,
          message: e.message,
          progress: undefined,
        });
        if (code === 'not_member') {
          void this.refreshMembership();
        } else if (e.retryable) {
          const attempt = (this.failures.get(companyId) ?? 0) + 1;
          this.failures.set(companyId, attempt);
          this.schedule(companyId, backoff(attempt, this.o.random));
        }
      } finally {
        this.running.delete(companyId);
        if (this.again.delete(companyId)) this.schedule(companyId, 0);
      }
    })();
    this.running.set(companyId, job);
    return job;
  }
}
