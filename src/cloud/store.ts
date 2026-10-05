import { useSyncExternalStore } from 'react';
import { liveQuery, type Subscription } from 'dexie';
import type { Session } from '@supabase/supabase-js';
import { db } from '@/db/db';
import { deleteCompany } from '@/db/records';
import type { CloudApi } from './api';
import { cloudConfigured } from './config';
import { getSupabase, hasSavedSession } from './client';
import { authRedirect } from './boot';
import { loadProfile, signOut as authSignOut, toCloudUser, type CloudUser } from './auth';
import { SyncManager } from './manager';
import { syncStatus } from './status';
import { supabaseApi } from './supabase-api';

/**
 * The account and the cloud, for the whole app (outside React, so a change
 * of language, which remounts the app, doesn't reconnect). Nothing is loaded
 * for people who never signed in on this device: the cloud code comes in
 * when someone signs in, opens a link from an email, or already has a
 * session here.
 */

export interface CloudSnapshot {
  /** The app has a cloud to talk to (a publishable key and an address). */
  configured: boolean;
  /** Whether someone is signed in is known. */
  ready: boolean;
  user: CloudUser | null;
  api: CloudApi | null;
  manager: SyncManager | null;
  /** Problem with the email link this page was opened from (expired…). */
  redirectError: string | null;
}

let snapshot: CloudSnapshot = {
  configured: cloudConfigured,
  ready: !cloudConfigured || !(hasSavedSession() || authRedirect),
  user: null,
  api: null,
  manager: null,
  redirectError: null,
};
const listeners = new Set<() => void>();

function update(patch: Partial<CloudSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cloudSnapshot(): CloudSnapshot {
  return snapshot;
}

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

let connecting: Promise<CloudApi> | null = null;

/** Loads the cloud code (once) and finds out who is signed in. */
export function connectCloud(): Promise<CloudApi> {
  connecting ??= (async () => {
    const supabase = await getSupabase();
    const api = supabaseApi(supabase);
    update({ api });
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') window.location.hash = '#/reset-password';
      // Supabase asks not to call it again from inside this callback.
      setTimeout(() => applySession(event === 'SIGNED_OUT' ? null : session), 0);
    });
    const { error } = await supabase.auth.initialize();
    if (error && authRedirect) update({ redirectError: error.message });
    const { data } = await supabase.auth.getSession();
    applySession(data.session);
    update({ ready: true });
    return api;
  })();
  connecting.catch(() => {
    connecting = null;
    update({ ready: true });
  });
  return connecting;
}

function applySession(session: Session | null) {
  const authUser = session?.user ?? null;
  if (!authUser) {
    if (snapshot.user) stopSync();
    update({ user: null });
    return;
  }
  const next = toCloudUser(authUser);
  const same = snapshot.user?.id === next.id;
  update({ user: same ? { ...next, fullName: snapshot.user!.fullName || next.fullName } : next });
  if (!same) startSync(next.id);
  void loadProfile(next.id).then((profile) => {
    if (profile && snapshot.user?.id === next.id) update({ user: toCloudUser(authUser, profile) });
  });
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                       */
/* -------------------------------------------------------------------------- */

let links: Subscription | null = null;

function startSync(userId: string) {
  stopSync();
  if (!snapshot.api) return;
  const manager = new SyncManager({ api: snapshot.api, userId });
  manager.start();
  update({ manager });
  links = liveQuery(() =>
    db.syncState.filter((l) => l.userId === userId && l.status !== 'removed').primaryKeys(),
  ).subscribe({
    next: (ids) => manager.setCompanies(ids),
    error: () => undefined,
  });
}

function stopSync() {
  links?.unsubscribe();
  links = null;
  snapshot.manager?.stop();
  syncStatus.clear();
  update({ manager: null });
}

/**
 * Signs out on this device. With `removeCompanies`, the account's cloud
 * companies are removed from this device too (they stay in the cloud).
 */
export async function signOutCloud({ removeCompanies }: { removeCompanies: boolean }) {
  const userId = snapshot.user?.id;
  stopSync();
  if (removeCompanies && userId) {
    const linked = await db.syncState.filter((l) => l.userId === userId).toArray();
    // The sign-out dialog counts the changes not sent yet before this.
    for (const link of linked) await deleteCompany(link.companyId, { force: true });
  }
  await authSignOut();
  update({ user: null });
}

export function updateCloudUser(patch: Partial<Pick<CloudUser, 'fullName' | 'language'>>) {
  if (snapshot.user) update({ user: { ...snapshot.user, ...patch } });
}

/** After an email link: the problem it had, once. */
export function clearRedirectError() {
  update({ redirectError: null });
}

/** The account and the cloud, kept up to date. */
export function useCloud() {
  return useSyncExternalStore(subscribe, cloudSnapshot);
}
