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

/**
 * The longest answer the chat asks for, in tokens (the model's thinking
 * counts in it too). The Worker caps it again (MAX_OUTPUT_TOKENS).
 */
export const CHAT_MAX_OUTPUT_TOKENS = 2048;

/**
 * How much the model thinks before it answers a chat question
 * (generationConfig.thinkingConfig.thinkingLevel). gemini-3.6-flash thinks
 * at "medium" unless told, billed as output; "low" is the cheapest level
 * that works in a conversation sent back as text (Google's "minimal" needs
 * the model's thought signatures sent back, which the chat doesn't keep).
 */
export const CHAT_THINKING_LEVEL = 'low';
