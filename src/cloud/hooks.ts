import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { msg } from '@/i18n';
import type { CloudErrorCode } from './api';
import type { MemberRole } from './roles';
import { useCloud } from './store';
import { useOnline, useRuntimeStatus } from './status';
import type { SyncProgress } from './sync';
import type { CloudLink } from './types';

/** The company's link to the cloud: null when it is kept on this device only. */
export function useCloudLink(companyId: string | null | undefined): CloudLink | null | undefined {
  return useLiveQuery(
    async () => (companyId ? ((await db.syncState.get(companyId)) ?? null) : null),
    [companyId],
  );
}

/** The person's role in the company; null for a company kept on this device only. */
export function useCompanyRole(companyId: string | null | undefined): MemberRole | null {
  return useCloudLink(companyId)?.role ?? null;
}

export type CloudStatusKind =
  'local' | 'synced' | 'syncing' | 'offline' | 'problem' | 'signed-out' | 'removed';

/** English keys, translated where shown. */
export const STATUS_LABELS: Record<CloudStatusKind, string> = {
  local: msg('On this device only'),
  synced: msg('Synced'),
  syncing: msg('Syncing…'),
  offline: msg('Offline – changes will sync'),
  problem: msg('Sync problem'),
  'signed-out': msg('Sign in to sync'),
  removed: msg('No longer shared with you'),
};

export interface CloudStatusView {
  kind: CloudStatusKind;
  link: CloudLink | null;
  /** Changes waiting to be sent. */
  pending: number;
  /** Changes the cloud refused. */
  parked: number;
  error?: CloudErrorCode;
  message?: string;
  progress?: SyncProgress;
}

/** Where a company stands with the cloud, from what is stored and what is running. */
export function useCloudStatus(companyId: string | null | undefined): CloudStatusView {
  const { user } = useCloud();
  const online = useOnline();
  const link = useCloudLink(companyId) ?? null;
  const runtime = useRuntimeStatus(companyId);
  const counts = useLiveQuery(
    async () =>
      companyId
        ? Promise.all([
            db.outbox.where('[companyId+parked]').equals([companyId, 0]).count(),
            db.outbox.where('[companyId+parked]').equals([companyId, 1]).count(),
          ])
        : [0, 0],
    [companyId],
  ) ?? [0, 0];
  const [pending, parked] = counts;
  const base = { link, pending, parked, progress: runtime.progress };
  if (!link) return { ...base, kind: 'local' };
  if (link.status === 'removed') return { ...base, kind: 'removed' };
  if (!user || user.id !== link.userId) return { ...base, kind: 'signed-out' };
  if (!online || runtime.phase === 'offline') return { ...base, kind: 'offline' };
  if (runtime.phase === 'syncing') return { ...base, kind: 'syncing' };
  if (runtime.phase === 'error' || parked > 0) {
    return { ...base, kind: 'problem', error: runtime.error, message: runtime.message };
  }
  if (pending > 0 || link.status !== 'ready') return { ...base, kind: 'syncing' };
  return { ...base, kind: 'synced' };
}
