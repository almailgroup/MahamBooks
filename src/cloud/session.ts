import { cloudConfigured } from './config';
import { getSupabase, hasSavedSession } from './client';

/**
 * The signed-in person's access token (a JWT signed by Supabase), for a
 * service of ours that needs to know who is calling, such as the AI
 * assistant's Worker, which checks it with Supabase. Null when nobody is
 * signed in. Refreshed first when it is about to expire (getSession() does
 * that); `refresh` asks Supabase for a new one anyway, when the service
 * refused the last one, and gives null when that fails.
 */
export async function getAccessToken({ refresh = false }: { refresh?: boolean } = {}): Promise<
  string | null
> {
  if (!cloudConfigured || !hasSavedSession()) return null;
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  if (!refresh) return data.session.access_token;
  const { data: renewed } = await supabase.auth.refreshSession();
  return renewed.session?.access_token ?? null;
}
