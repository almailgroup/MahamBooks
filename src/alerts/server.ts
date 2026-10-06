import type {
  Company,
  ComplianceDocument,
  ComplianceMark,
  Employee,
  InvoiceDocument,
  ISODate,
  Payment,
  PeopleSettings,
} from '@/db/types';
import { corsHeaders } from '@supabase/supabase-js/cors';
import { loadLanguage, type Language } from '@/i18n';
import {
  alertLookups,
  collectAlerts,
  isAlertTopic,
  type AlertData,
  type AlertTopic,
} from './collect';
import { renderAlertEmail, type AlertEmailKind } from './email';

/**
 * The email-alerts function (a Supabase Edge Function; see edge.ts for how
 * it is started). Three things reach it:
 *
 *   - the hourly schedule (POST {"action":"run"} with the secret from
 *     almailbooks.email_alerts_config): from 8:00 Kuwait time it emails each
 *     owner or admin who turned alerts on, at most once a day, when
 *     something new needs attention, and on Sundays a summary;
 *   - the app (POST {"action":"send","companyId"} with the person's
 *     session): emails that person what needs attention now;
 *   - anything else (a GET after deploying): it answers whether it is ready.
 *
 * Every call writes the function's own address to the config, where the
 * schedule reads it. It reads the company's records with the database's
 * own connection, so it checks itself who may get what: only owners and
 * admins, only for their companies, only at their account's address.
 */

export type Sql = <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;

export interface AlertsEnv {
  /** The project's address, e.g. https://abcd.supabase.co. */
  supabaseUrl: string;
  /** Resend API key (a function secret). */
  resendKey: string;
  /** The sender, e.g. "Maham Books <alerts@example.com>" (a function secret). */
  from: string;
  /** A publishable key, to check a person's session with Auth. */
  apiKey: string;
}

export interface AlertsDeps {
  sql: Sql;
  env: AlertsEnv;
  fetch: typeof fetch;
  now: () => Date;
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
}

/** Emails go out from this hour, Kuwait time. */
export const ALERT_HOUR = 8;
/** Kuwait is UTC+3 all year. */
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Resend takes a few emails a second. */
const PAUSE_BETWEEN_EMAILS_MS = 600;
const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 30_000;
const COMPANY_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Every header Supabase's client sends, kept up to date by supabase-js itself. */
export const CORS_HEADERS: Record<string, string> = { ...corsHeaders };

/** Today's date, hour and weekday (0 = Sunday) in Kuwait. */
export function kuwaitClock(now: Date): { date: ISODate; hour: number; weekday: number } {
  const local = new Date(now.getTime() + KUWAIT_OFFSET_MS);
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours(),
    weekday: local.getUTCDay(),
  };
}

/** Problems the app shows to the person, by code. */
export type AlertsErrorCode =
  | 'auth'
  | 'permission'
  | 'invalid'
  | 'not_enabled'
  | 'too_soon'
  | 'no_company'
  | 'not_configured'
  | 'not_ready'
  | 'send_failed';

class AlertsError extends Error {
  constructor(
    readonly status: number,
    readonly code: AlertsErrorCode,
    message: string,
    /** Resend answered: the email was not sent, whatever key it had. */
    readonly refused = false,
  ) {
    super(message);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* The database                                                               */
/* -------------------------------------------------------------------------- */

/** Writes where the function is, for the schedule; false when the script hasn't run. */
async function register(deps: AlertsDeps): Promise<boolean> {
  const base = deps.env.supabaseUrl.replace(/\/+$/, '');
  try {
    if (/^https?:\/\/[^\s/]+$/.test(base)) {
      const url = `${base}/functions/v1/email-alerts`;
      await deps.sql(
        `update almailbooks.email_alerts_config
         set function_url = $1, updated_at = now()
         where id and function_url is distinct from $1`,
        [url],
      );
    } else {
      await deps.sql('select 1 from almailbooks.email_alerts_config where id');
    }
    return true;
  } catch (error) {
    deps.log(`email-alerts: the database is not ready (${String(error)})`);
    return false;
  }
}

async function schedulerSecret(deps: AlertsDeps): Promise<string | null> {
  const [row] = await deps.sql<{ secret: string }>(
    'select secret from almailbooks.email_alerts_config where id',
  );
  return row?.secret ?? null;
}

interface Subscription {
  company_id: string;
  user_id: string;
  topics: string[];
  app_url: string;
  sent_keys: unknown;
  send_key: string | null;
}

interface Person {
  email: string;
  language: Language;
  confirmed: boolean;
}

async function person(deps: AlertsDeps, userId: string): Promise<Person | null> {
  const [row] = await deps.sql<{
    email: string | null;
    language: string | null;
    confirmed: boolean;
  }>(
    `select u.email::text as email, p.language, u.email_confirmed_at is not null as confirmed
     from auth.users u
     left join public.profiles p on p.id = u.id
     where u.id = $1`,
    [userId],
  );
  if (!row?.email) return null;
  return {
    email: row.email,
    language: row.language === 'en' ? 'en' : 'ar',
    confirmed: row.confirmed,
  };
}

/** A company's records as the alerts need them, or null when it isn't in the cloud. */
export async function loadAlertData(sql: Sql, companyId: string): Promise<AlertData | null> {
  const rows = await sql<{ tbl: string; data: Record<string, unknown> }>(
    `select tbl, data from public.records
     where company_id = $1
       and (
         tbl in ('companies', 'employees', 'complianceDocuments', 'complianceMarks', 'peopleSettings')
         or (tbl = 'documents' and data->>'type' in ('invoice', 'bill')
             and data->>'status' in ('sent', 'partial'))
         or (tbl = 'payments' and data->>'method' = 'cheque'
             and data->'cheque'->>'status' in ('held', 'deposited')
             and data->>'voided' is distinct from 'true')
       )
     union all
     select 'clients', jsonb_build_object('id', id, 'name', coalesce(data->>'name', ''), 'nameAr', data->>'nameAr')
     from public.records
     where company_id = $1 and tbl = 'clients'`,
    [companyId],
  );
  const of = <T>(tbl: string) => rows.filter((r) => r.tbl === tbl).map((r) => r.data as T);
  const company = of<Company>('companies').find((c) => c.id === companyId);
  if (!company) return null;
  // Records saved by older versions of the app may miss a text field: blanks, not a crash.
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    company: { ...company, name: text(company.name), createdAt: text(company.createdAt) },
    employees: of<Employee>('employees').map((e) => ({
      ...e,
      name: text(e.name),
      civilId: text(e.civilId),
      passportNumber: text(e.passportNumber),
      residencyNumber: text(e.residencyNumber),
      workPermitNumber: text(e.workPermitNumber),
    })),
    complianceDocuments: of<ComplianceDocument>('complianceDocuments').map((d) => ({
      ...d,
      title: text(d.title),
      ownerName: text(d.ownerName),
    })),
    complianceMarks: of<ComplianceMark>('complianceMarks'),
    peopleSettings: of<PeopleSettings>('peopleSettings')[0] ?? null,
    documents: of<InvoiceDocument>('documents').filter(
      (d) => typeof d.totals?.balance === 'number',
    ),
    payments: of<Payment>('payments').map((p) =>
      p.cheque
        ? {
            ...p,
            cheque: { ...p.cheque, number: text(p.cheque.number), drawer: text(p.cheque.drawer) },
          }
        : p,
    ),
    clients: of<{ id: string; name: string; nameAr?: string }>('clients'),
  };
}

async function finish(
  deps: AlertsDeps,
  sub: Pick<Subscription, 'company_id' | 'user_id'>,
  result: { checkedOn: ISODate; keys: string[] | null; sent: boolean; problem?: string },
): Promise<void> {
  await deps.sql(
    `update public.email_alerts
     set checked_on = $3::date,
         sent_keys = coalesce($4::jsonb, sent_keys),
         last_sent_at = case when $5::boolean then now() else last_sent_at end,
         last_error = $6,
         last_error_at = case when $6 = '' then null else now() end,
         claimed_until = null,
         send_key = null
     where company_id = $1 and user_id = $2`,
    [
      sub.company_id,
      sub.user_id,
      result.checkedOn,
      result.keys ? JSON.stringify(result.keys) : null,
      result.sent,
      (result.problem ?? '').slice(0, 1000),
    ],
  );
}

/**
 * Keeps a problem and lets the next hour try again. An email Resend refused
 * was not sent: the next try takes a new key (Resend would answer a key it
 * has seen with the same refusal for a day).
 */
async function failed(
  deps: AlertsDeps,
  sub: Pick<Subscription, 'company_id' | 'user_id'>,
  error: unknown,
): Promise<void> {
  const problem = error instanceof Error ? error.message : String(error);
  await deps.sql(
    `update public.email_alerts
     set last_error = $3, last_error_at = now(), claimed_until = null,
         send_key = case when $4::boolean then null else send_key end
     where company_id = $1 and user_id = $2`,
    [
      sub.company_id,
      sub.user_id,
      problem.slice(0, 1000) || 'Unknown problem',
      error instanceof AlertsError && error.refused,
    ],
  );
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

let languageQueue: Promise<unknown> = Promise.resolve();

/** Runs `fn` with the interface in `language`, one at a time (the language is global). */
function inLanguage<T>(language: Language, fn: () => T): Promise<T> {
  const run = languageQueue.then(async () => {
    await loadLanguage(language);
    return fn();
  });
  languageQueue = run.catch(() => undefined);
  return run;
}

function senderProblem(env: AlertsEnv): string {
  const missing = [!env.resendKey && 'RESEND_API_KEY', !env.from && 'ALERTS_FROM'].filter(Boolean);
  return missing.length
    ? `The email sender is not set up: add ${missing.join(' and ')} to the function's secrets.`
    : '';
}

async function sendEmail(
  deps: AlertsDeps,
  message: { to: string; subject: string; html: string; text: string; idempotencyKey?: string },
): Promise<void> {
  const problem = senderProblem(deps.env);
  if (problem) throw new AlertsError(503, 'not_configured', problem);
  let response: Response;
  try {
    response = await deps.fetch(RESEND_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${deps.env.resendKey}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: deps.env.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
  } catch (error) {
    throw new AlertsError(502, 'send_failed', `Resend could not be reached (${String(error)}).`);
  }
  if (response.ok) return;
  let detail = '';
  try {
    detail = ((await response.json()) as { message?: string }).message ?? '';
  } catch {
    // No details.
  }
  throw new AlertsError(502, 'send_failed', detail || `Resend answered ${response.status}.`, true);
}

/* -------------------------------------------------------------------------- */
/* The schedule                                                               */
/* -------------------------------------------------------------------------- */

export interface RunSummary {
  /** It is before 8:00 in Kuwait: nothing is due yet. */
  waiting: boolean;
  checked: number;
  sent: number;
  failed: number;
}

/** Emails everyone whose alerts are due now. */
export async function runDueAlerts(deps: AlertsDeps): Promise<RunSummary> {
  const clock = kuwaitClock(deps.now());
  const summary: RunSummary = { waiting: false, checked: 0, sent: 0, failed: 0 };
  if (clock.hour < ALERT_HOUR) return { ...summary, waiting: true };

  // Owners and admins with alerts on, not checked today, that no other run is working on.
  const due = await deps.sql<Subscription>(
    `update public.email_alerts a
     set claimed_until = now() + interval '10 minutes'
     from public.company_members m
     where m.company_id = a.company_id and m.user_id = a.user_id
       and m.role in ('owner', 'admin')
       and a.enabled
       and (a.checked_on is null or a.checked_on < $1::date)
       and (a.claimed_until is null or a.claimed_until < now())
     returning a.company_id, a.user_id, a.topics, a.app_url, a.sent_keys, a.send_key`,
    [clock.date],
  );

  const byCompany = new Map<string, Subscription[]>();
  for (const sub of due) {
    byCompany.set(sub.company_id, [...(byCompany.get(sub.company_id) ?? []), sub]);
  }

  let first = true;
  for (const [companyId, subs] of byCompany) {
    let data: AlertData | null;
    try {
      data = await loadAlertData(deps.sql, companyId);
    } catch (error) {
      for (const sub of subs) {
        await failed(deps, sub, new Error(`Could not read the company: ${String(error)}`));
      }
      summary.failed += subs.length;
      continue;
    }
    for (const sub of subs) {
      try {
        if (!data) {
          await finish(deps, sub, {
            checkedOn: clock.date,
            keys: null,
            sent: false,
            problem: 'The company is not in the cloud.',
          });
          summary.checked += 1;
          continue;
        }
        const who = await person(deps, sub.user_id);
        if (!who?.confirmed) {
          await finish(deps, sub, {
            checkedOn: clock.date,
            keys: null,
            sent: false,
            problem: 'The account has no confirmed email address.',
          });
          summary.checked += 1;
          continue;
        }
        const topics = sub.topics.filter(isAlertTopic);
        const alerts = collectAlerts(data, clock.date, topics);
        const keys = alerts.map((a) => a.key);
        const before = Array.isArray(sub.sent_keys) ? new Set(sub.sent_keys as string[]) : null;
        const fresh = before ? keys.filter((k) => !before.has(k)) : keys;
        const kind: AlertEmailKind | null = !alerts.length
          ? null
          : !before
            ? 'first'
            : fresh.length
              ? 'new'
              : clock.weekday === 0
                ? 'weekly'
                : null;
        if (!kind) {
          await finish(deps, sub, { checkedOn: clock.date, keys, sent: false });
          summary.checked += 1;
          continue;
        }
        const email = await inLanguage(who.language, () =>
          renderAlertEmail({
            kind,
            company: data!.company,
            alerts,
            newKeys: kind === 'new' ? new Set(fresh) : null,
            appUrl: sub.app_url,
            to: who.email,
            ...alertLookups(data!),
          }),
        );
        // The key of an email whose answer was lost, or a new one, saved first.
        const key = sub.send_key ?? `alerts/${clock.date}/${crypto.randomUUID()}`;
        if (!sub.send_key) {
          await deps.sql(
            'update public.email_alerts set send_key = $3 where company_id = $1 and user_id = $2',
            [sub.company_id, sub.user_id, key],
          );
        }
        if (!first) await deps.sleep(PAUSE_BETWEEN_EMAILS_MS);
        first = false;
        await sendEmail(deps, { to: who.email, ...email, idempotencyKey: key });
        await finish(deps, sub, { checkedOn: clock.date, keys, sent: true });
        summary.checked += 1;
        summary.sent += 1;
      } catch (error) {
        deps.log(`email-alerts: ${sub.company_id}/${sub.user_id}: ${String(error)}`);
        await failed(deps, sub, error);
        summary.failed += 1;
      }
    }
  }
  return summary;
}

/* -------------------------------------------------------------------------- */
/* "Send it now" from the app                                                 */
/* -------------------------------------------------------------------------- */

async function signedIn(deps: AlertsDeps, request: Request): Promise<{ id: string }> {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new AlertsError(401, 'auth', 'Sign in again.');
  const apiKey = request.headers.get('apikey') || deps.env.apiKey;
  let response: Response;
  try {
    response = await deps.fetch(`${deps.env.supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, ...(apiKey ? { apikey: apiKey } : {}) },
    });
  } catch {
    throw new AlertsError(502, 'auth', 'The session could not be checked.');
  }
  if (!response.ok) throw new AlertsError(401, 'auth', 'Sign in again.');
  const user = (await response.json()) as { id?: string };
  if (!user.id) throw new AlertsError(401, 'auth', 'Sign in again.');
  return { id: user.id };
}

export async function sendNow(
  deps: AlertsDeps,
  request: Request,
  companyId: unknown,
): Promise<{ to: string; count: number }> {
  const user = await signedIn(deps, request);
  if (typeof companyId !== 'string' || !COMPANY_ID.test(companyId)) {
    throw new AlertsError(400, 'invalid', 'Which company?');
  }
  const [member] = await deps.sql<{ role: string }>(
    'select role::text as role from public.company_members where company_id = $1 and user_id = $2',
    [companyId, user.id],
  );
  if (member?.role !== 'owner' && member?.role !== 'admin') {
    throw new AlertsError(403, 'permission', 'Only the owner and admins can get email alerts.');
  }
  const problem = senderProblem(deps.env);
  if (problem) throw new AlertsError(503, 'not_configured', problem);
  // One a minute.
  const [sub] = await deps.sql<Subscription>(
    `update public.email_alerts
     set last_test_at = now()
     where company_id = $1 and user_id = $2 and enabled
       and (last_test_at is null or last_test_at < now() - interval '1 minute')
     returning company_id, user_id, topics, app_url, sent_keys, send_key`,
    [companyId, user.id],
  );
  if (!sub) {
    const [row] = await deps.sql<{ enabled: boolean }>(
      'select enabled from public.email_alerts where company_id = $1 and user_id = $2',
      [companyId, user.id],
    );
    if (!row?.enabled) {
      throw new AlertsError(409, 'not_enabled', 'Turn email alerts on and save first.');
    }
    throw new AlertsError(429, 'too_soon', 'Wait a minute before sending another email.');
  }
  const who = await person(deps, user.id);
  if (!who?.confirmed)
    throw new AlertsError(403, 'auth', 'The account has no confirmed email address.');
  const data = await loadAlertData(deps.sql, companyId);
  if (!data) throw new AlertsError(404, 'no_company', 'The company is not in the cloud yet.');
  const clock = kuwaitClock(deps.now());
  const topics = sub.topics.filter(isAlertTopic) as AlertTopic[];
  const alerts = collectAlerts(data, clock.date, topics);
  const email = await inLanguage(who.language, () =>
    renderAlertEmail({
      kind: 'now',
      company: data.company,
      alerts,
      newKeys: null,
      appUrl: sub.app_url,
      to: who.email,
      ...alertLookups(data),
    }),
  );
  try {
    await sendEmail(deps, { to: who.email, ...email });
  } catch (error) {
    if (error instanceof AlertsError) await failed(deps, sub, error);
    throw error;
  }
  // What it listed counts as seen: tomorrow's email tells only what is new.
  await finish(deps, sub, { checkedOn: clock.date, keys: alerts.map((a) => a.key), sent: true });
  return { to: who.email, count: alerts.length };
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export async function handleAlertsRequest(request: Request, deps: AlertsDeps): Promise<Response> {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  const ready = await register(deps);
  if (request.method === 'GET') {
    return json(200, {
      ok: true,
      database: ready,
      sender: !senderProblem(deps.env),
    });
  }
  if (request.method !== 'POST') return json(405, { ok: false, error: 'invalid' });
  if (!ready) {
    return json(503, {
      ok: false,
      error: 'not_ready',
      message: 'Run supabase/migrations/20261007000000_email_alerts.sql in the SQL editor first.',
    });
  }
  let body: { action?: unknown; companyId?: unknown };
  try {
    const text = await request.text();
    if (text.length > 10_000) throw new Error('too large');
    body = JSON.parse(text || '{}') as typeof body;
  } catch {
    return json(400, { ok: false, error: 'invalid', message: 'Send JSON.' });
  }
  try {
    if (body.action === 'run') {
      const secret = await schedulerSecret(deps);
      const given = request.headers.get('x-alerts-secret') ?? '';
      if (!secret || !sameText(given, secret)) {
        return json(401, { ok: false, error: 'auth', message: 'Only the schedule runs this.' });
      }
      const summary = await runDueAlerts(deps);
      deps.log(`email-alerts: ${JSON.stringify(summary)}`);
      return json(200, { ok: true, ...summary });
    }
    if (body.action === 'send') {
      return json(200, { ok: true, ...(await sendNow(deps, request, body.companyId)) });
    }
    return json(400, { ok: false, error: 'invalid', message: 'Unknown action.' });
  } catch (error) {
    if (error instanceof AlertsError) {
      return json(error.status, { ok: false, error: error.code, message: error.message });
    }
    deps.log(
      `email-alerts: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return json(500, { ok: false, error: 'failed', message: 'Something went wrong.' });
  }
}
