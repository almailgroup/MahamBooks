import { cloudConfigured } from './config';
import { getSupabase, hasSavedSession } from './client';

/**
 * The signed-in person's access token (a JWT signed by Supabase), for a
 * service of ours that needs to know who is calling, such as the assistant's
 * server, which checks it with Supabase. Null when nobody is signed in.
 * Refreshed first when it is about to expire.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!cloudConfigured || !hasSavedSession()) return null;
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
