// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDictionaryForTests } from '@/i18n';
import { createAiClient, recentTurns, requestBody, type ChatMessage } from './client';
import { AiError, aiErrorMessage, retryAfterSeconds } from './errors';

/**
 * The AI client over a fake Worker: the request it sends, the answer read
 * from Gemini's SSE events however they are split, Stop, and what each
 * failure becomes. No real service, token or person.
 */

const BASE = 'https://ai.example.test';
const TOKEN = 'header.payload.signature';

interface Seen {
  url: string;
  init: RequestInit;
  body: unknown;
}

/** A Worker that answers each request with the next response. */
function fakeFetch(...responses: (Response | (() => Response) | Error)[]) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push({
      url: String(input),
      init,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('No more responses');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
}

/** A fake session: a token, a new one when asked to refresh, or nobody signed in. */
function fakeSession(token: string | null = TOKEN, refreshed: string | null = 'new.token.here') {
  return vi.fn(async (options?: { refresh?: boolean }) => (options?.refresh ? refreshed : token));
}

const encoder = new TextEncoder();

/** An SSE answer sent in the given pieces. */
function sse(pieces: string[], { status = 200 } = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const chunk = (text: string, extra: Record<string, unknown> = {}) =>
  event({ candidates: [{ content: { role: 'model', parts: [{ text }] }, ...extra }] });

function workerError(code: string, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code, message: `Worker says ${code}`, status } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const QUESTION: ChatMessage[] = [{ role: 'user', text: 'How do I record annual leave?' }];
const SYSTEM = 'You are the Maham One assistant.';

function client(fetch: typeof globalThis.fetch, getToken = fakeSession(), online = () => true) {
  return createAiClient({ fetch, getToken, baseUrl: BASE, online });
}

afterEach(() => setDictionaryForTests('en', {}));

describe('asking with the answer streamed', () => {
  it('posts the conversation and the system instruction with the token, and reads the answer', async () => {
    const { fetch, seen } = fakeFetch(
      sse([
        chunk('Open '),
        chunk('Payroll → Leave.'),
        event({
          candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8, totalTokenCount: 128 },
        }),
      ]),
    );
    const pieces: string[] = [];
    const answer = await client(fetch).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      onText: (delta) => pieces.push(delta),
    });
    expect(answer).toEqual({
      text: 'Open Payroll → Leave.',
      finishReason: 'STOP',
      usage: { promptTokens: 120, outputTokens: 8, totalTokens: 128, thoughtsTokens: undefined },
    });
    expect(pieces).toEqual(['Open ', 'Payroll → Leave.']);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${BASE}/v1/stream`);
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.credentials).toBe('omit');
    expect(new Headers(seen[0].init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'How do I record annual leave?' }] }],
      systemInstruction: { parts: [{ text: SYSTEM }] },
      // A chat answer's length and low thinking, every time.
      generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } },
    });
  });

  it('sends only the headers the Worker allows (its preflight lists them)', async () => {
    const { fetch, seen } = fakeFetch(sse([chunk('Yes.')]));
    await client(fetch).streamChat({ messages: QUESTION, system: SYSTEM, onText: () => {} });
    const sent = [...new Headers(seen[0].init.headers).keys()].sort();
    expect(sent).toEqual(['authorization', 'content-type']);
    // workers/ai-proxy/src/worker.js, ALLOWED_REQUEST_HEADERS.
    const worker = (await import('node:fs')).readFileSync(
      new URL('../../../workers/ai-proxy/src/worker.js', import.meta.url),
      'utf8',
    );
    const allowed = /const ALLOWED_REQUEST_HEADERS = \[([\s\S]*?)\]/
      .exec(worker)![1]
      .match(/'([^']+)'/g)!
      .map((header) => header.slice(1, -1).toLowerCase());
    for (const header of sent) expect(allowed).toContain(header);
  });

  it('reads the same answer however the stream is split, in Arabic too', async () => {
    const whole = [chunk('سجّل '), chunk('الإجازة من الرواتب.'), chunk(' Done.')].join('');
    const bytes = encoder.encode(whole);
    for (const size of [1, 3, 17]) {
      const pieces: Uint8Array[] = [];
      for (let at = 0; at < bytes.length; at += size) pieces.push(bytes.slice(at, at + size));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const piece of pieces) controller.enqueue(piece);
          controller.close();
        },
      });
      const { fetch } = fakeFetch(new Response(stream, { status: 200 }));
      const answer = await client(fetch).streamChat({
        messages: QUESTION,
        system: SYSTEM,
        onText: () => undefined,
      });
      expect(answer.text).toBe('سجّل الإجازة من الرواتب. Done.');
    }
  });

  it('leaves out thought parts and reads several parts and data lines', async () => {
    const { fetch } = fakeFetch(
      sse([
        event({
          candidates: [
            {
              content: {
                parts: [{ text: 'Thinking about payroll…', thought: true }, { text: 'Use ' }],
              },
            },
          ],
        }),
        // One event over two data lines (JSON allows the line break).
        'data: {"candidates":[{"content":{"parts":[{"text":"Payroll"},\ndata: {"text":"."}]}}]}\n\n',
      ]),
    );
    const answer = await client(fetch).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      onText: () => undefined,
    });
    expect(answer.text).toBe('Use Payroll.');
  });

  it('turns an error event in the middle of the answer into an error, after the text so far', async () => {
    const { fetch } = fakeFetch(
      sse([
        chunk('Open Payroll'),
        '\n\nevent: error\ndata: {"error":{"code":"upstream_error","message":"The AI service stopped in the middle of the answer.","status":502}}\n\n',
      ]),
    );
    const pieces: string[] = [];
    const asked = client(fetch).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      onText: (_delta, text) => pieces.push(text),
    });
    await expect(asked).rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    expect(pieces).toEqual(['Open Payroll']);
  });

  it('says when the answer was empty or withheld', async () => {
    const empty = fakeFetch(sse([event({ candidates: [{ finishReason: 'STOP' }] })]));
    await expect(
      client(empty.fetch).streamChat({ messages: QUESTION, system: SYSTEM, onText: () => {} }),
    ).rejects.toMatchObject({ code: 'empty' });
    const blocked = fakeFetch(sse([event({ promptFeedback: { blockReason: 'SAFETY' } })]));
    await expect(
      client(blocked.fetch).streamChat({ messages: QUESTION, system: SYSTEM, onText: () => {} }),
    ).rejects.toMatchObject({ code: 'blocked' });
  });

  it('stops when the person presses Stop, keeping what was written', async () => {
    const controller = new AbortController();
    let push: ((text: string) => void) | null = null;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (text) => c.enqueue(encoder.encode(text));
          // As fetch does: once aborted, the body fails with an AbortError.
          init.signal?.addEventListener('abort', () =>
            c.error(new DOMException('Aborted', 'AbortError')),
          );
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const texts: string[] = [];
    const asked = client(fetch).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      signal: controller.signal,
      onText: (_delta, text) => texts.push(text),
    });
    await vi.waitFor(() => expect(push).not.toBeNull());
    push!(chunk('Open Payroll'));
    await vi.waitFor(() => expect(texts).toEqual(['Open Payroll']));
    controller.abort();
    await expect(asked).rejects.toMatchObject({ code: 'aborted' });
  });

  it('refreshes a refused token once and asks again', async () => {
    const { fetch, seen } = fakeFetch(workerError('unauthorized', 401), sse([chunk('Hello')]));
    const session = fakeSession();
    const answer = await client(fetch, session).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      onText: () => undefined,
    });
    expect(answer.text).toBe('Hello');
    expect(session).toHaveBeenLastCalledWith({ refresh: true });
    expect(new Headers(seen[1].init.headers).get('Authorization')).toBe('Bearer new.token.here');
  });

  it('asks to sign in again when the new token is refused too, or can’t be had', async () => {
    const twice = fakeFetch(workerError('unauthorized', 401), workerError('unauthorized', 401));
    await expect(
      client(twice.fetch).streamChat({ messages: QUESTION, system: SYSTEM, onText: () => {} }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(twice.seen).toHaveLength(2);
    const none = fakeFetch(workerError('unauthorized', 401));
    await expect(
      client(none.fetch, fakeSession(TOKEN, null)).streamChat({
        messages: QUESTION,
        system: SYSTEM,
        onText: () => {},
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('asks to sign in without sending anything when nobody is signed in', async () => {
    const { fetch, seen } = fakeFetch();
    await expect(
      client(fetch, fakeSession(null)).streamChat({
        messages: QUESTION,
        system: SYSTEM,
        onText: () => {},
      }),
    ).rejects.toMatchObject({ code: 'signed_out' });
    expect(seen).toEqual([]);
  });
});

describe('what each failure becomes', () => {
  const ask = (fetch: typeof globalThis.fetch, online = () => true) =>
    client(fetch, fakeSession(), online).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      onText: () => {},
    });

  it.each([
    ['forbidden', 403],
    ['forbidden_origin', 403],
    ['bad_request', 400],
    ['payload_too_large', 413],
    ['model_not_allowed', 400],
    ['upstream_error', 502],
    ['upstream_timeout', 504],
    ['not_found', 404],
    ['internal', 500],
    // The server check planned next (ai-plan R1).
    ['not_enabled', 403],
    ['budget_exceeded', 429],
    ['update_required', 426],
  ])('the Worker’s %s', async (code, status) => {
    const { fetch } = fakeFetch(workerError(code, status));
    const error = await ask(fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code, status, detail: `Worker says ${code}` });
    expect(aiErrorMessage(error)).not.toMatch(/Worker says/);
  });

  it('says what each refusal means, in both languages', async () => {
    const said = async (response: Response) =>
      aiErrorMessage(await ask(fakeFetch(response).fetch).catch((e: unknown) => e));
    const notMember =
      'Your account is not a member of the company the AI assistant is set up for. Ask the owner.';
    const notAvailable = 'The AI assistant is not available for this account.';
    const notSetUp = 'The AI assistant is not set up yet. Ask the owner.';
    const origin = 'The AI assistant works only in the app at mahamone.com.';
    // The Worker's own codes.
    expect(await said(workerError('forbidden', 403))).toBe(notMember);
    expect(await said(workerError('forbidden_origin', 403))).toBe(origin);
    // Any other 403: in general words, never the web address's.
    for (const response of [
      workerError('not_known_to_this_version', 403),
      workerError('some_later_code', 403),
      new Response('<html>Forbidden</html>', { status: 403 }),
      new Response('', { status: 403 }),
    ]) {
      const message = await said(response);
      expect(message).toBe(notAvailable);
      expect(message).not.toBe(origin);
    }
    // The Worker without its settings, and any other internal error.
    const internal = (message: string) =>
      new Response(JSON.stringify({ error: { code: 'internal', message, status: 500 } }), {
        status: 500,
      });
    expect(await said(internal('The AI service is not set up yet.'))).toBe(notSetUp);
    expect(await said(internal('Something broke.'))).toBe(
      'Something went wrong with the AI assistant. Try again.',
    );
    // The server check planned next: switched off there, today's limit, an old app.
    expect(await said(workerError('not_enabled', 403))).toBe(
      'The AI assistant is not switched on for this company. Ask the owner.',
    );
    expect(await said(workerError('budget_exceeded', 429))).toBe(
      'The AI assistant has reached today’s limit for this company. Try again tomorrow.',
    );
    expect(await said(workerError('update_required', 426))).toBe(
      'The AI assistant needs the latest version of the app. Reload the page and try again.',
    );
    setDictionaryForTests('ar', {
      [notMember]: 'حسابك ليس عضواً في الشركة التي هُيّئ لها المساعد الذكي. اسأل المالك.',
      [notAvailable]: 'المساعد الذكي غير متاح لهذا الحساب.',
      [notSetUp]: 'لم تكتمل تهيئة المساعد الذكي بعد. اسأل المالك.',
    });
    expect(await said(workerError('forbidden', 403))).toBe(
      'حسابك ليس عضواً في الشركة التي هُيّئ لها المساعد الذكي. اسأل المالك.',
    );
    expect(await said(new Response('', { status: 403 }))).toBe(
      'المساعد الذكي غير متاح لهذا الحساب.',
    );
    expect(await said(internal('The AI service is not set up yet.'))).toBe(
      'لم تكتمل تهيئة المساعد الذكي بعد. اسأل المالك.',
    );
  });

  it('a limit, with the wait in seconds from Retry-After', async () => {
    const { fetch } = fakeFetch(workerError('rate_limited', 429, { 'Retry-After': '42' }));
    const error = await ask(fetch).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'rate_limited', retryAfter: 42 });
    expect(aiErrorMessage(error)).toBe(
      'Too many questions in a short time. Try again in 42 seconds.',
    );
    setDictionaryForTests('ar', {
      'Too many questions in a short time. Try again in {seconds} seconds.':
        'أسئلة كثيرة في وقت قصير. حاول مرة أخرى بعد {seconds} ثانية.',
    });
    expect(aiErrorMessage(error)).toBe('أسئلة كثيرة في وقت قصير. حاول مرة أخرى بعد 42 ثانية.');
  });

  it('an answer that is not the Worker’s, by its status', async () => {
    const { fetch } = fakeFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(ask(fetch)).rejects.toMatchObject({ code: 'upstream_error', status: 502 });
    // A 403 without a code the app knows: not said to be about the company, nor the address.
    const refused = fakeFetch(new Response('Forbidden', { status: 403 }));
    await expect(ask(refused.fetch)).rejects.toMatchObject({ code: 'not_available', status: 403 });
    const limited = fakeFetch(new Response('', { status: 429 }));
    await expect(ask(limited.fetch)).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 60,
    });
  });

  it('no internet, before anything is sent', async () => {
    const { fetch, seen } = fakeFetch();
    const error = await ask(fetch, () => false).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'offline' });
    expect(aiErrorMessage(error)).toBe('The AI assistant needs an internet connection.');
    expect(seen).toEqual([]);
  });

  it('the service out of reach, or the connection lost', async () => {
    const { fetch } = fakeFetch(new TypeError('Failed to fetch'));
    await expect(ask(fetch)).rejects.toMatchObject({ code: 'network' });
    let online = true;
    const lost = fakeFetch(new TypeError('Failed to fetch'));
    const asked = client(lost.fetch, fakeSession(), () => online).streamChat({
      messages: QUESTION,
      system: SYSTEM,
      onText: () => {},
    });
    online = false;
    await expect(asked).rejects.toMatchObject({ code: 'offline' });
  });

  it('a stream cut off by the network', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk('Open')));
        controller.error(new TypeError('network error'));
      },
    });
    const { fetch } = fakeFetch(new Response(stream, { status: 200 }));
    await expect(ask(fetch)).rejects.toMatchObject({ code: 'network' });
  });

  it('every code has a message of its own', () => {
    const codes = [
      'unauthorized',
      'forbidden',
      'forbidden_origin',
      'bad_request',
      'payload_too_large',
      'model_not_allowed',
      'rate_limited',
      'upstream_error',
      'upstream_timeout',
      'not_found',
      'internal',
      'not_enabled',
      'budget_exceeded',
      'update_required',
      'kept_private',
      'signed_out',
      'offline',
      'network',
      'empty',
      'blocked',
      'aborted',
    ] as const;
    const messages = codes.map((code) => aiErrorMessage(new AiError(code)));
    expect(new Set(messages).size).toBe(codes.length);
    expect(aiErrorMessage(new Error('anything'))).toBe(aiErrorMessage(new AiError('internal')));
  });

  it('reads waits from a header, a date or the message', () => {
    expect(retryAfterSeconds('30')).toBe(30);
    expect(retryAfterSeconds(new Date(Date.now() + 90_000).toUTCString())).toBeGreaterThan(80);
    expect(retryAfterSeconds(null, 'Try again in 37 seconds.')).toBe(37);
    expect(retryAfterSeconds(null)).toBe(60);
    expect(retryAfterSeconds('0')).toBe(1);
  });
});

describe('the whole answer at once', () => {
  it('posts to /v1/generate and reads the answer', async () => {
    const { fetch, seen } = fakeFetch(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'Payroll → Leave.' }] }, finishReason: 'STOP' },
          ],
        }),
        { status: 200 },
      ),
    );
    const answer = await client(fetch).generate({ messages: QUESTION, system: SYSTEM });
    expect(answer.text).toBe('Payroll → Leave.');
    expect(seen[0].url).toBe(`${BASE}/v1/generate`);
  });
});

describe('testing the connection', () => {
  it('reads the health answer without a token', async () => {
    const { fetch, seen } = fakeFetch(
      new Response(JSON.stringify({ ok: true, model: 'gemini-test' }), { status: 200 }),
    );
    expect(await client(fetch).checkHealth()).toEqual({ ok: true, model: 'gemini-test' });
    expect(seen[0].url).toBe(`${BASE}/health`);
    expect(new Headers(seen[0].init.headers).get('Authorization')).toBeNull();
  });

  it('gives the error when the service refuses', async () => {
    const { fetch } = fakeFetch(workerError('forbidden_origin', 403));
    await expect(client(fetch).checkHealth()).rejects.toMatchObject({ code: 'forbidden_origin' });
  });
});

describe('the messages sent', () => {
  it('are the latest 20, starting with one of the person’s, without empty ones', () => {
    const many: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'model',
      text: `message ${i}`,
    }));
    const sent = recentTurns(many);
    expect(sent).toHaveLength(20);
    expect(sent[0]).toEqual({ role: 'user', text: 'message 10' });
    expect(sent.at(-1)).toEqual({ role: 'model', text: 'message 29' });
    // The window starting on an answer drops it.
    expect(recentTurns(many.slice(0, 21))[0]).toEqual({ role: 'user', text: 'message 2' });
    expect(
      recentTurns([
        { role: 'user', text: 'Hello' },
        { role: 'model', text: '' },
        { role: 'user', text: 'Again' },
      ]),
    ).toEqual([
      { role: 'user', text: 'Hello' },
      { role: 'user', text: 'Again' },
    ]);
    expect(() => requestBody({ messages: [], system: SYSTEM })).toThrow(AiError);
  });
});

describe('the last check before sending', () => {
  /** Made up to pass their checks; nobody's. */
  const CIVIL_ID = '287041512345';
  const IBAN = 'KW81CBKU0000000000001234560101';
  const known = [{ value: 'X98765', kind: 'id' as const }];

  it('sends nothing when a message of the person’s still holds a Civil ID, an IBAN or a known value', async () => {
    for (const text of [
      `My Civil ID is ${CIVIL_ID}`,
      `Pay to ${IBAN.replace(/(.{4})/g, '$1 ')}`,
      'Renew X98765',
      `رقمي ${CIVIL_ID.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)))}`,
    ]) {
      const { fetch, seen } = fakeFetch(sse([chunk('Should not be asked')]));
      const error = await client(fetch)
        .streamChat({
          messages: [
            { role: 'user', text: 'How do I add an employee?' },
            { role: 'model', text: 'Open Maham People.' },
            { role: 'user', text },
          ],
          system: SYSTEM,
          known,
          onText: () => {},
        })
        .catch((e: unknown) => e);
      expect(error, text).toMatchObject({ code: 'kept_private' });
      expect(seen, text).toEqual([]);
      expect(aiErrorMessage(error)).toBe(
        'This was not sent: it still holds an ID number, an IBAN or another private detail. Start a new chat and ask without it.',
      );
    }
    const { fetch, seen } = fakeFetch();
    await expect(
      client(fetch).generate({
        messages: [{ role: 'user', text: `IBAN ${IBAN}` }],
        system: SYSTEM,
      }),
    ).rejects.toMatchObject({ code: 'kept_private' });
    expect(seen).toEqual([]);
  });

  it('lets through what was hidden, the answers, and numbers that only look alike', () => {
    expect(() =>
      requestBody({
        messages: [
          { role: 'user', text: 'My Civil ID is [ID number hidden], passport 1234 5678' },
          // An answer may show the standard example IBAN: the answers are the model's.
          { role: 'model', text: `An IBAN looks like ${IBAN}.` },
          { role: 'user', text: 'Invoice 287041512346 and X987650' },
        ],
        system: SYSTEM,
        known,
      }),
    ).not.toThrow();
  });
});
