import { useSyncExternalStore } from 'react';
import type { CloudErrorCode } from './api';
import type { SyncProgress } from './sync';

/**
 * What the sync is doing right now, per company, for this tab. What is
 * stored (last sync, unsent changes) lives in IndexedDB; this is the rest:
 * running, offline, the last error and progress.
 */

export interface RuntimeStatus {
  phase: 'idle' | 'syncing' | 'offline' | 'error';
  error?: CloudErrorCode;
  message?: string;
  progress?: SyncProgress;
  /** At least one sync finished since the app started. */
  syncedOnce?: boolean;
}

const IDLE: RuntimeStatus = { phase: 'idle' };
const statuses = new Map<string, RuntimeStatus>();
const listeners = new Set<() => void>();

export const syncStatus = {
  get(companyId: string): RuntimeStatus {
    return statuses.get(companyId) ?? IDLE;
  },
  set(companyId: string, patch: Partial<RuntimeStatus>) {
    statuses.set(companyId, { ...syncStatus.get(companyId), ...patch });
    for (const listener of listeners) listener();
  },
  clear() {
    statuses.clear();
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useRuntimeStatus(companyId: string | null | undefined): RuntimeStatus {
  return useSyncExternalStore(syncStatus.subscribe, () =>
    companyId ? syncStatus.get(companyId) : IDLE,
  );
}

/** Whether the browser thinks it is online, kept up to date. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('online', listener);
      window.addEventListener('offline', listener);
      return () => {
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
      };
    },
    () => navigator.onLine,
  );
}
