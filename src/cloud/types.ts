import type { MemberRole } from './roles';

/**
 * Local bookkeeping of the cloud copy, kept in IndexedDB next to the data
 * (Dexie version 14): which companies are in the cloud, what changed here
 * and has not reached the server yet, the server version of each record and
 * files waiting to be removed from Storage.
 */

/** A company kept in the cloud, as known on this device (table `syncState`). */
export interface CloudLink {
  companyId: string;
  /** Account the company was linked with; another account's companies don't sync. */
  userId: string;
  role: MemberRole;
  /**
   * uploading: being copied to the cloud (outbox holds every record);
   * downloading: being copied to this device (the company record comes last);
   * ready: in step; removed: no longer in the cloud or no longer a member.
   */
  status: 'uploading' | 'downloading' | 'ready' | 'removed';
  /** Highest server rev applied here. */
  cursor: number;
  /** Name in the cloud, shown before the company itself has arrived. */
  name: string;
  linkedAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Records to copy, for the progress bar. */
  total?: number;
  /** While downloading: the company record, stored once everything else is here. */
  pendingCompany?: Record<string, unknown> | null;
  /** Server version of the held company record. */
  pendingCompanyRev?: number;
  /** Why the company is removed: deleted by its owner or access withdrawn. */
  removedReason?: 'deleted' | 'access';
}

/** A change made here that the server has not confirmed yet (table `outbox`). */
export interface OutboxEntry {
  seq?: number;
  companyId: string;
  table: string;
  id: string;
  op: 'put' | 'delete';
  at: string;
  /** 1 when the server refused the change; it waits for a retry or an undo. */
  parked: 0 | 1;
  /** Error code (permission, too_large, invalid…) of a parked change. */
  error?: string;
  /** The server's own explanation. */
  detail?: string;
}

/** The server version of a record this device has (table `syncRevs`). */
export interface SyncRev {
  table: string;
  id: string;
  companyId: string;
  rev: number;
}

/** A file to remove from Storage, kept until it is gone (table `fileQueue`). */
export interface FileTask {
  seq?: number;
  companyId: string;
  path: string;
  at: string;
  attempts: number;
  lastError?: string;
}
