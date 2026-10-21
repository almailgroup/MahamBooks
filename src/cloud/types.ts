import type { MemberPermissions, MemberRole } from './roles';

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
  /**
   * Bumped when the cursor goes back to 0 (a role that sees more): a page of
   * changes asked for before that is thrown away and asked for again.
   */
  epoch?: number;
  /** Documents that arrived with a number another document here already has. */
  duplicates?: string[];
  /**
   * The tables this device pulls the company with: those of the version that
   * linked it or caught up last. A link without it was made by a version
   * before database version 16, which pulled without that version's tables
   * (see catchUpTables in sync.ts).
   */
  tables?: string[];
  /** What the server has beyond the first migrations, as last asked (see features.ts). */
  features?: string[];
  /** When `features` was asked. */
  featuresAt?: string;
  /**
   * The owner's limits on this person, app by app (see roles.ts), as last
   * asked (my_permissions, once the server has 'super_admin'). Missing: the
   * role's access, as before. Kept on this device only: never synced or
   * backed up.
   */
  permissions?: MemberPermissions;
  /** The owner allowed this person to approve requests (an admin or accountant). */
  approver?: boolean;
  /** Only the owner makes admins and accountants (the owner's switch in Settings → Team). */
  seniorRolesOwnerOnly?: boolean;
  /** When `permissions` was asked. */
  permissionsAt?: string;
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
  /** 1 when it was the file of an attachment the cloud refused, not the record. */
  file?: 1;
  /** A refused file sent again by itself: refusals so far. */
  attempts?: number;
  /** A refused file sent again by itself: when (ms since 1970), unless "Try again" comes first. */
  retryAt?: number;
}

/** The server version of a record this device has (table `syncRevs`). */
export interface SyncRev {
  table: string;
  id: string;
  companyId: string;
  rev: number;
  /**
   * The company record only: the copy that rev stands for, so this device
   * knows which of its fields it changed since (see company-patch.ts).
   */
  base?: Record<string, unknown>;
}

/** A file to remove from Storage, kept until it is gone (table `fileQueue`). */
export interface FileTask {
  seq?: number;
  companyId: string;
  path: string;
  at: string;
  attempts: number;
  lastError?: string;
  /** Account that removed the file's record; only that account removes the file. */
  userId?: string;
  /** 1 once retrying stopped: shown as a problem until tried again. */
  failed?: 1;
}
