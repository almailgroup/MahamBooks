import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AUTH_STORAGE_KEY,
  cloudConfigured,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from './config';

/**
 * The Supabase client, created on first use. Its code is loaded only then,
 * so people who keep their books on this device only never download it and
 * the first screen doesn't wait for it.
 *
 * Sign-in links in emails come back with ?code=… (PKCE). The hash router
 * keeps its route in #/…, and the client puts its own parameters in front of
 * the hash, so a link like /?code=…#/auth/callback opens the right screen
 * and the client removes the code once it has been exchanged.
 */

let client: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new Error('The cloud is not set up.'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        detectSessionInUrl: true,
        autoRefreshToken: true,
        storageKey: AUTH_STORAGE_KEY,
      },
    }),
  );
  return client;
}

/** Whether this browser keeps a session, without loading the cloud code. */
export function hasSavedSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

const REDIRECT_ERROR_KEY = 'almailbooks.authRedirectError';

/**
 * Whether the page was opened from a link in an email (confirming an
 * account, resetting a password). Errors the link came back with (an
 * expired link) are kept for the callback screen, and a hash that holds
 * them is replaced by the callback route so the router can show it.
 */
export function readAuthRedirect(location: Location = window.location): boolean {
  const query = new URLSearchParams(location.search);
  const hash = location.hash.startsWith('#/') ? '' : location.hash.slice(1);
  const hashParams = new URLSearchParams(hash);
  const error =
    query.get('error_description') ??
    hashParams.get('error_description') ??
    query.get('error') ??
    hashParams.get('error');
  if (error) {
    try {
      sessionStorage.setItem(REDIRECT_ERROR_KEY, error);
    } catch {
      // Shown as a general problem instead.
    }
    const url = new URL(location.href);
    for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key);
    url.hash = '#/auth/callback';
    window.history.replaceState(window.history.state, '', url.toString());
    return true;
  }
  return query.has('code');
}

/** The error an email link came back with, once. */
export function takeAuthRedirectError(): string | null {
  try {
    const error = sessionStorage.getItem(REDIRECT_ERROR_KEY);
    sessionStorage.removeItem(REDIRECT_ERROR_KEY);
    return error;
  } catch {
    return null;
  }
}

/** Address of a screen of the app, for links in emails: the app's own URL with a route. */
export function appUrl(route: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${route.startsWith('/') ? route : `/${route}`}`;
}
