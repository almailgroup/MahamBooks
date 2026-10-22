import { t } from '@/i18n';

/**
 * What can go wrong asking the AI assistant, each with a message for the
 * person in their language (`aiErrorMessage`). The Worker's own codes
 * (workers/ai-proxy: unauthorized … internal), and the app's: nobody signed
 * in, no internet, the service out of reach, an answer cut off, empty or
 * withheld, and a question stopped by the person.
 */
export type AiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'forbidden_origin'
  | 'bad_request'
  | 'payload_too_large'
  | 'model_not_allowed'
  | 'rate_limited'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'not_found'
  | 'internal'
  | 'signed_out'
  | 'offline'
  | 'network'
  | 'empty'
  | 'blocked'
  | 'aborted';

const WORKER_CODES = new Set<string>([
  'unauthorized',
  // Signed in, but not one of the people the service is for.
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
]);

/** Seconds to wait when the service asks to wait but doesn't say how long. */
const DEFAULT_WAIT_SECONDS = 60;

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** The HTTP status, when the service answered. */
  readonly status?: number;
  /** For rate_limited: how long to wait, in seconds. */
  readonly retryAfter?: number;
  /** The service's own message (English), for Settings → AI assistant. Never shown in the chat. */
  readonly detail?: string;

  constructor(
    code: AiErrorCode,
    options: { status?: number; retryAfter?: number; detail?: string } = {},
  ) {
    super(options.detail || code);
    this.name = 'AiError';
    this.code = code;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.detail = options.detail;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

/** Seconds from a Retry-After header ("37", or a date), or from "… in 37 seconds" in a message. */
export function retryAfterSeconds(header: string | null, message?: string): number {
  if (header && /^\s*\d+\s*$/.test(header)) return clampWait(Number(header));
  if (header) {
    const at = Date.parse(header);
    if (Number.isFinite(at)) return clampWait(Math.ceil((at - Date.now()) / 1000));
  }
  const said = message ? /\b(\d{1,4})\s*seconds?\b/i.exec(message) : null;
  return said ? clampWait(Number(said[1])) : DEFAULT_WAIT_SECONDS;
}

function clampWait(seconds: number): number {
  return Math.min(Math.max(Math.round(seconds), 1), 3600);
}

/**
 * The error a service's answer stands for: its JSON {error: {code, message,
 * status}}, else what the HTTP status means.
 */
export function errorFromBody(
  body: unknown,
  status: number | undefined,
  retryAfter: string | null = null,
): AiError {
  const error =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: unknown }).error
      : undefined;
  const fields = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const given = typeof fields.code === 'string' ? fields.code : '';
  const detail = typeof fields.message === 'string' ? fields.message.slice(0, 300) : undefined;
  const httpStatus =
    status ?? (typeof fields.status === 'number' ? fields.status : undefined) ?? undefined;
  const code: AiErrorCode = WORKER_CODES.has(given) ? (given as AiErrorCode) : byStatus(httpStatus);
  return new AiError(code, {
    status: httpStatus,
    detail,
    retryAfter: code === 'rate_limited' ? retryAfterSeconds(retryAfter, detail) : undefined,
  });
}

function byStatus(status: number | undefined): AiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'upstream_timeout';
  if (status !== undefined && status >= 400 && status < 500) return 'bad_request';
  if (status === 500) return 'internal';
  return 'upstream_error';
}

/** What to tell the person, in the interface language. */
export function aiErrorMessage(error: unknown): string {
  const code: AiErrorCode = isAiError(error) ? error.code : 'internal';
  switch (code) {
    case 'signed_out':
      return t('Sign in to use the AI assistant.');
    case 'unauthorized':
      return t('Your sign-in has expired. Sign in again to use the AI assistant.');
    case 'forbidden':
      return t('Your account may not use the AI assistant. Ask the owner of the company.');
    case 'forbidden_origin':
      return t('The AI assistant works only in the app at mahamone.com.');
    case 'bad_request':
      return t('The AI service could not use this question. Try asking it another way.');
    case 'payload_too_large':
      return t('This conversation is too long for the AI. Start a new chat.');
    case 'model_not_allowed':
      return t('The AI service is not set up for this version of the app. Try again later.');
    case 'rate_limited':
      return t('Too many questions in a short time. Try again in {seconds} seconds.', {
        seconds: (isAiError(error) && error.retryAfter) || DEFAULT_WAIT_SECONDS,
      });
    case 'upstream_timeout':
      return t('The AI took too long to answer. Try again.');
    case 'upstream_error':
      return t('The AI service had a problem. Try again in a moment.');
    case 'not_found':
      return t('The AI service could not be found. Try again later.');
    case 'offline':
      return t('The AI assistant needs an internet connection.');
    case 'network':
      return t('Could not reach the AI service. Check your connection and try again.');
    case 'empty':
      return t('The AI gave no answer. Try asking another way.');
    case 'blocked':
      return t('The AI could not answer this question. Try asking it another way.');
    case 'aborted':
      return t('Stopped');
    case 'internal':
    default:
      return t('Something went wrong with the AI assistant. Try again.');
  }
}
