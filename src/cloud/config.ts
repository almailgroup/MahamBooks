/**
 * Where the cloud lives. The publishable key is public by design: it only
 * identifies the project, and every request runs as the signed-in person
 * under the database's row-level security. A secret (service) key must never
 * be in the app; one given here by mistake is refused.
 */

const DEFAULT_URL = 'https://gagdyhintrxdkiqhahzh.supabase.co';
const DEFAULT_KEY = 'sb_publishable_KyVAkWtemw_XDnNK8ZKRpA_-5x4pk8d';

const env = import.meta.env as Record<string, string | undefined>;

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').trim() || DEFAULT_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim() || DEFAULT_KEY;

/** Private bucket for receipts and scans, at {companyId}/{attachmentId}. */
export const FILES_BUCKET = 'company-files';

/** Where the session is kept in this browser. */
export const AUTH_STORAGE_KEY = 'almailbooks.auth';

/** Whether a key may be used in the browser: publishable keys only. */
export function isPublishableKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) return false;
  // Older projects use JWT keys: only the anon one is public.
  const [, payload] = key.split('.');
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: string;
    };
    return claims.role === 'anon';
  } catch {
    return false;
  }
}

export const cloudConfigured =
  /^https:\/\/[\w.-]+$/.test(SUPABASE_URL) && isPublishableKey(SUPABASE_PUBLISHABLE_KEY);
