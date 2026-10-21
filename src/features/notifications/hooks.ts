import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ChangeFeedStatus, CloudApi } from '@/cloud/api';
import { linkHasFeature } from '@/cloud/features';
import { useCloudLink } from '@/cloud/hooks';
import { getsChangeFeed } from '@/cloud/roles';
import { useRuntimeStatus } from '@/cloud/status';
import { useCloud } from '@/cloud/store';

/**
 * The changes of the team (#7 of docs/requirements-plan.md) for the person
 * signed in: only in a company kept in the cloud with their account, once
 * its server has the change feed, and only for its owner (the Super Admin)
 * and the members the owner allowed to approve.
 */

export interface ChangeFeedAccess {
  api: CloudApi;
  companyId: string;
  userId: string;
}

export function useChangeFeedAccess(companyId: string | null | undefined): ChangeFeedAccess | null {
  const { api, user } = useCloud();
  const link = useCloudLink(companyId);
  const allowed = Boolean(
    api &&
    user &&
    companyId &&
    link &&
    link.status !== 'removed' &&
    link.userId === user.id &&
    linkHasFeature(link, 'change_feed') &&
    getsChangeFeed(link.role, link.approver),
  );
  const userId = user?.id ?? '';
  return useMemo(
    () => (allowed && api && companyId ? { api, companyId, userId } : null),
    [allowed, api, companyId, userId],
  );
}

/* -------------------------------------------------------------------------- */
/* What is unread, kept for every screen of this tab                          */
/* -------------------------------------------------------------------------- */

const statuses = new Map<string, ChangeFeedStatus | null>();
const listeners = new Set<() => void>();
const asking = new Map<string, Promise<void>>();

function emit() {
  for (const listener of listeners) listener();
}

/** Asks the cloud again how many changes are unread (after reading some, or saving the settings). */
export function refreshChangeStatus(access: ChangeFeedAccess): Promise<void> {
  const key = `${access.companyId} ${access.userId}`;
  const running = asking.get(key);
  if (running) return running;
  const run = access.api
    .changeFeedStatus(access.companyId)
    .then((status) => {
      statuses.set(key, status);
      emit();
    })
    // Offline or not answering: what was known stays.
    .catch(() => undefined)
    .finally(() => asking.delete(key));
  asking.set(key, run);
  return run;
}

/** Forgets what is known, so a company turned off disappears at once. */
export function setChangeStatus(access: ChangeFeedAccess, status: ChangeFeedStatus | null) {
  statuses.set(`${access.companyId} ${access.userId}`, status);
  emit();
}

const RECHECK_MS = 2 * 60 * 1000;

/**
 * Whether the person gets the changes and how many are unread, kept up to
 * date: asked when the screen opens, when the window comes back into view,
 * after each sync of the company (another device's change reaches this one
 * through the cloud's signal, then a sync) and every two minutes.
 */
export function useChangeFeedStatus(access: ChangeFeedAccess | null): ChangeFeedStatus | null {
  const key = access ? `${access.companyId} ${access.userId}` : '';
  const status = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (key ? (statuses.get(key) ?? null) : null),
  );
  const phase = useRuntimeStatus(access?.companyId).phase;

  useEffect(() => {
    if (!access) return;
    void refreshChangeStatus(access);
    const again = () => {
      if (document.visibilityState === 'visible') void refreshChangeStatus(access);
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    const timer = window.setInterval(again, RECHECK_MS);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
      window.clearInterval(timer);
    };
  }, [access]);

  // A sync just finished.
  useEffect(() => {
    if (access && phase === 'idle') void refreshChangeStatus(access);
  }, [access, phase]);

  return status;
}
