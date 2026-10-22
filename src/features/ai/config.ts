/**
 * Where the AI assistant's requests go: Maham One's AI service, a
 * Cloudflare Worker that passes them to Google Gemini with a key kept only
 * there (see docs/ai-assistant.md). It checks the signed-in person's Supabase
 * token and answers only the app's own web address. VITE_AI_PROXY_URL points
 * a build at another copy of the Worker.
 */

const DEFAULT_PROXY_URL = 'https://maham-ai-proxy.steep-band-c624.workers.dev';

const env = import.meta.env as Record<string, string | undefined>;

export const AI_PROXY_URL = ((env.VITE_AI_PROXY_URL ?? '').trim() || DEFAULT_PROXY_URL).replace(
  /\/+$/,
  '',
);

/** The most messages of a conversation sent with each question (the latest ones). */
export const MAX_TURNS = 20;

/** The longest question the box takes, in characters. */
export const MAX_QUESTION_LENGTH = 4000;
