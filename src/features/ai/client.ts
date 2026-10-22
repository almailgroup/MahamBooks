import { getAccessToken } from '@/cloud/session';
import { AI_PROXY_URL, CHAT_MAX_OUTPUT_TOKENS, CHAT_THINKING_LEVEL, MAX_TURNS } from './config';
import { AiError, errorFromBody, isAiError } from './errors';
import { holdsPrivate, type KnownValue } from './scrub';
import { SseParser, type SseEvent } from './sse';

/**
 * The AI assistant's requests, through Maham One's AI service (a Cloudflare
 * Worker in front of Google Gemini, see config.ts): POST /v1/stream for an
 * answer while it is written, POST /v1/generate for a whole one, GET
 * /health to test the connection. Each request carries the signed-in
 * person's Supabase access token, refreshed once when the Worker refuses
 * it. Every failure is an AiError with a message for the person
 * (errors.ts). Nothing is stored: the conversation is the caller's.
 */

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/** Token counts of an answer (Gemini's usageMetadata). */
export interface AiUsage {
  promptTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
}

export interface ChatAnswer {
  text: string;
  /** Why the model stopped (STOP, MAX_TOKENS, SAFETY…), when it said. */
  finishReason?: string;
  usage?: AiUsage;
}

export interface AskOptions {
  /** The conversation, oldest first; only the latest MAX_TURNS are sent. */
  messages: ChatMessage[];
  /** What the assistant is told about itself and the page (context.ts). */
  system: string;
  /**
   * This company's never-send values on this device (known-values.ts), for
   * the last check of the person's messages before they are sent.
   */
  known?: readonly KnownValue[];
  signal?: AbortSignal;
}

export interface StreamOptions extends AskOptions {
  /** Each new piece of the answer, and the answer so far. */
  onText: (delta: string, text: string) => void;
}

export interface HealthResult {
  ok: true;
  /** The model the service answers with when a request names none. */
  model?: string;
}

/** How to reach the service: the real one by default, fakes in tests. */
export interface AiClientOptions {
  fetch?: typeof fetch;
  /** The access token; `refresh` asks for a new one. Null: nobody signed in. */
  getToken?: (options?: { refresh?: boolean }) => Promise<string | null>;
  baseUrl?: string;
  online?: () => boolean;
}

export interface AiClient {
  streamChat(options: StreamOptions): Promise<ChatAnswer>;
  generate(options: AskOptions): Promise<ChatAnswer>;
  checkHealth(signal?: AbortSignal): Promise<HealthResult>;
}

/** The answer was withheld (Gemini's finish reasons and block reasons). */
const WITHHELD = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'OTHER',
]);

/**
 * The messages sent: the latest MAX_TURNS with text, starting with one of
 * the person's (Gemini expects the conversation to open with the user).
 */
export function recentTurns(messages: ChatMessage[], max = MAX_TURNS): ChatMessage[] {
  const kept = messages.filter((m) => m.text.trim() !== '').slice(-max);
  const first = kept.findIndex((m) => m.role === 'user');
  return first === -1 ? [] : kept.slice(first);
}

/**
 * The request body both /v1 routes take: a chat answer's length and low
 * thinking every time, so an answer stays short and cheap whichever
 * version of the Worker passes it on. The last check first: a message of
 * the person's that still holds one of `known`, a Civil ID or an IBAN
 * (holdsPrivate) is not sent at all, whatever way it came in.
 */
export function requestBody({
  messages,
  system,
  known = [],
}: Pick<AskOptions, 'messages' | 'system' | 'known'>) {
  const turns = recentTurns(messages);
  if (turns.length === 0) throw new AiError('bad_request', { detail: 'Nothing to ask.' });
  if (turns.some((m) => m.role === 'user' && holdsPrivate(m.text, known))) {
    throw new AiError('kept_private');
  }
  return {
    contents: turns.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: {
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: CHAT_THINKING_LEVEL },
    },
  };
}

/** Collects an answer from Gemini's responses (one, or one per SSE event). */
class AnswerReader {
  text = '';
  finishReason?: string;
  blockReason?: string;
  usage?: AiUsage;

  /** Reads one response; returns the new text in it. */
  read(response: unknown): string {
    if (!response || typeof response !== 'object') return '';
    const r = response as Record<string, unknown>;
    if (r.error) throw errorFromBody(r, statusOf(r.error));
    const feedback = r.promptFeedback as { blockReason?: unknown } | undefined;
    if (typeof feedback?.blockReason === 'string') this.blockReason = feedback.blockReason;
    const usage = r.usageMetadata as Record<string, unknown> | undefined;
    if (usage && typeof usage === 'object') {
      const count = (key: string) =>
        typeof usage[key] === 'number' && Number.isFinite(usage[key])
          ? (usage[key] as number)
          : undefined;
      this.usage = {
        promptTokens: count('promptTokenCount'),
        outputTokens: count('candidatesTokenCount'),
        thoughtsTokens: count('thoughtsTokenCount'),
        totalTokens: count('totalTokenCount'),
      };
    }
    const candidate = Array.isArray(r.candidates)
      ? (r.candidates[0] as Record<string, unknown> | undefined)
      : undefined;
    if (!candidate || typeof candidate !== 'object') return '';
    if (typeof candidate.finishReason === 'string') this.finishReason = candidate.finishReason;
    const content = candidate.content as { parts?: unknown } | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    let delta = '';
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = part as { text?: unknown; thought?: unknown };
      // A model that thinks first may send its thoughts as parts: never shown.
      if (p.thought === true || typeof p.text !== 'string') continue;
      delta += p.text;
    }
    this.text += delta;
    return delta;
  }

  /** The whole answer, or why there is none. */
  finish(): ChatAnswer {
    if (this.text.trim() === '') {
      const withheld =
        this.blockReason !== undefined ||
        (this.finishReason !== undefined && WITHHELD.has(this.finishReason));
      throw new AiError(withheld ? 'blocked' : 'empty', {
        detail: this.blockReason ?? this.finishReason,
      });
    }
    return { text: this.text, finishReason: this.finishReason, usage: this.usage };
  }
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

const defaultOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function createAiClient(options: AiClientOptions = {}): AiClient {
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const getToken = options.getToken ?? getAccessToken;
  const baseUrl = (options.baseUrl ?? AI_PROXY_URL).replace(/\/+$/, '');
  const online = options.online ?? defaultOnline;

  /** What a failed fetch or read means: stopped by the person, no internet, or out of reach. */
  const failure = (error: unknown, signal?: AbortSignal): AiError => {
    if (isAiError(error)) return error;
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return new AiError('aborted');
    }
    return new AiError(online() ? 'network' : 'offline');
  };

  const httpError = async (response: Response): Promise<AiError> => {
    let body: unknown = null;
    try {
      body = JSON.parse(await response.text());
    } catch {
      // Not JSON (a proxy's page): the status says enough.
    }
    return errorFromBody(body, response.status, response.headers.get('Retry-After'));
  };

  const token = async (refresh = false): Promise<string | null> => {
    try {
      return await getToken(refresh ? { refresh } : undefined);
    } catch {
      return null;
    }
  };

  /** POSTs with the person's token; a refused token is refreshed once. */
  const post = async (path: string, body: unknown, signal?: AbortSignal): Promise<Response> => {
    if (signal?.aborted) throw new AiError('aborted');
    if (!online()) throw new AiError('offline');
    let bearer = await token();
    if (!bearer) throw new AiError('signed_out');
    const json = JSON.stringify(body);
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: json,
          signal,
          // The token is the only credential: no cookies to another site.
          credentials: 'omit',
        });
      } catch (error) {
        throw failure(error, signal);
      }
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel().catch(() => undefined);
        bearer = await token(true);
        if (!bearer) throw new AiError('unauthorized', { status: 401 });
        continue;
      }
      if (!response.ok) throw await httpError(response);
      return response;
    }
  };

  return {
    async streamChat({ messages, system, known, signal, onText }) {
      const body = requestBody({ messages, system, known });
      const response = await post('/v1/stream', body, signal);
      const answer = new AnswerReader();
      const parser = new SseParser();
      const handle = (events: SseEvent[]) => {
        for (const event of events) {
          if (event.event === 'error') {
            let data: unknown = null;
            try {
              data = JSON.parse(event.data);
            } catch {
              // An error without details is still an error.
            }
            throw errorFromBody(data, statusOf((data as { error?: unknown } | null)?.error) ?? 502);
          }
          let data: unknown;
          try {
            data = JSON.parse(event.data);
          } catch {
            continue;
          }
          const delta = answer.read(data);
          if (delta) onText(delta, answer.text);
        }
      };
      try {
        if (!response.body) {
          handle(parser.push(await response.text()));
        } else {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              handle(parser.push(value));
            }
          } catch (error) {
            reader.cancel().catch(() => undefined);
            throw error;
          }
        }
        handle(parser.end());
      } catch (error) {
        throw failure(error, signal);
      }
      return answer.finish();
    },

    async generate({ messages, system, known, signal }) {
      const body = requestBody({ messages, system, known });
      const response = await post('/v1/generate', body, signal);
      let data: unknown;
      try {
        data = JSON.parse(await response.text());
      } catch (error) {
        if (signal?.aborted) throw new AiError('aborted');
        throw isAiError(error) ? error : new AiError('upstream_error', { status: response.status });
      }
      const answer = new AnswerReader();
      answer.read(data);
      return answer.finish();
    },

    async checkHealth(signal) {
      if (!online()) throw new AiError('offline');
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/health`, {
          method: 'GET',
          signal,
          credentials: 'omit',
        });
      } catch (error) {
        throw failure(error, signal);
      }
      if (!response.ok) throw await httpError(response);
      let data: { ok?: unknown; model?: unknown } | null = null;
      try {
        data = JSON.parse(await response.text()) as { ok?: unknown; model?: unknown };
      } catch {
        // Not the service's answer.
      }
      if (data?.ok !== true) throw new AiError('upstream_error', { status: response.status });
      return { ok: true, model: typeof data.model === 'string' ? data.model : undefined };
    },
  };
}

let shared: AiClient | null = null;
const client = () => (shared ??= createAiClient());

/** Asks the assistant, with the answer streamed to `onText` as it is written. */
export const streamChat = (options: StreamOptions) => client().streamChat(options);

/** Asks the assistant and waits for the whole answer. */
export const generate = (options: AskOptions) => client().generate(options);

/** Whether the AI service answers (Settings → AI assistant → Test the connection). */
export const checkHealth = (signal?: AbortSignal) => client().checkHealth(signal);
