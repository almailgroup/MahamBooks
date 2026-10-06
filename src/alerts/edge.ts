import postgres from 'postgres';
import { handleAlertsRequest } from './server';

/**
 * The email-alerts Supabase Edge Function. `npm run build:functions` bundles
 * this file with the app code it uses into
 * supabase/functions/email-alerts/index.js, which the deploy workflow sends
 * to Supabase.
 *
 * Supabase gives the function SUPABASE_URL, SUPABASE_DB_URL and the
 * project's keys. The owner adds two secrets (Edge Functions → Secrets):
 * RESEND_API_KEY, and ALERTS_FROM, the sender, such as
 * "Maham Books <alerts@example.com>".
 */

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const env = (name: string) => Deno.env.get(name)?.trim() ?? '';

/** A publishable key, to check sessions with Auth. */
function publishableKey(): string {
  try {
    const keys = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}') as Record<string, string>;
    const key = Object.values(keys).find((k) => typeof k === 'string' && k);
    if (key) return key;
  } catch {
    // Older projects: the anon key.
  }
  return env('SUPABASE_ANON_KEY');
}

// Connects on first use. prepare: false works through Supabase's pooler too.
const db = postgres(env('SUPABASE_DB_URL'), { prepare: false, max: 1, idle_timeout: 20 });

Deno.serve((request) =>
  handleAlertsRequest(request, {
    sql: (query, params = []) =>
      db.unsafe(query, params as postgres.ParameterOrJSON<never>[]) as unknown as Promise<never[]>,
    env: {
      supabaseUrl: env('SUPABASE_URL'),
      resendKey: env('RESEND_API_KEY'),
      from: env('ALERTS_FROM'),
      apiKey: publishableKey(),
    },
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    log: (message) => console.log(message),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }),
);
