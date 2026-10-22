import type {
  Company,
  ComplianceDocument,
  ComplianceMark,
  Department,
  Employee,
  InvoiceDocument,
  ISODate,
  PayLine,
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
import { renderAlertEmail, renderChangesEmail, safeAppUrl, type AlertEmailKind } from './email';
import { notifyDecision, type ChangeEmailKind } from './changes';
import { renderPayrollApprovalEmail } from './payroll-approval-email';
import type { ChangeEvent } from '@/cloud/api';
import { addPeriods, payrollBreakdown, payRunTotals } from '@/lib/hr/payroll';
import { normalizeDepartments } from '@/lib/hr/departments';
import { currencyPrecision } from '@/lib/money';

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
 *   - the 5-minute schedule of the change feed (POST {"action":"notify"},
 *     the same secret): emails the owner and the approvers who turned on
 *     "Changes by your team" what the rest of the team changed, important
 *     changes at once and the rest in the 8:00 summary, within the caps
 *     (see notifyDecision in changes.ts), and the approval emails of pay
 *     runs that haven't gone yet;
 *   - a pay run sent for the Super Admin's approval (POST
 *     {"action":"payroll_approval","companyId","approvalId"}, the same
 *     secret, from the trigger of 20261130000000_people_alerts.sql): emails
 *     the approvers its totals by department and position, never anyone's
 *     own pay (see payroll-approval-email.ts);
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
  /**
   * Where the app is, for the links in the payroll approval emails (the
   * function secret MAHAM_APP_URL). Empty: the address the person saved with
   * their email alerts or their changes by the team, if any.
   */
  appUrl?: string;
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
/* Changes by the team (20261123000000_change_feed.sql)                       */
/* -------------------------------------------------------------------------- */

export interface NotifySummary {
  /** People with new changes looked at. */
  checked: number;
  sent: number;
  /** Waiting: the caps, or the summary's hour. */
  skipped: number;
  failed: number;
}

interface ChangeSubscription {
  company_id: string;
  user_id: string;
  immediate_kinds: string[] | null;
  digest: string;
  app_url: string;
  emailed_upto: number | string;
  digest_on: string | null;
  sent_on: string | null;
  sent_count: number;
  last_sent_ms: number | null;
  send_key: string | null;
  send_upto: number | string | null;
}

/** Changes read for one email at most; the rest go in the next. */
const CHANGES_PER_EMAIL = 1000;

interface ChangeRow {
  id: number | string;
  at: string | Date;
  actor: string | null;
  actor_name: string | null;
  subject_name: string | null;
  kind: string;
  op: string;
  tbl: string;
  record_id: string;
  count: number;
  important: boolean;
  private: boolean;
  summary: Record<string, unknown> | null;
}

/** The changes after `after` (up to `upto`) that `user` hears about: never their own. */
async function waitingChanges(
  deps: AlertsDeps,
  sub: ChangeSubscription,
  upto: number | null,
): Promise<ChangeEvent[]> {
  const rows = await deps.sql<ChangeRow>(
    `select e.id, e.at, e.actor,
            coalesce(nullif(btrim(p.full_name), ''), p.email, '') as actor_name,
            case when e.kind = 'member'
              then coalesce(nullif(btrim(sp.full_name), ''), sp.email, '') else '' end as subject_name,
            e.kind, e.op, e.tbl, e.record_id, e.count, e.important, e.private, e.summary
     from public.change_events e
     left join public.profiles p on p.id = e.actor
     left join public.profiles sp on e.kind = 'member' and sp.id::text = e.summary ->> 'user'
     where e.company_id = $1 and e.id > $2::bigint
       and ($3::bigint is null or e.id <= $3::bigint)
       and e.actor is distinct from $4::uuid
     order by e.id
     limit ${CHANGES_PER_EMAIL}`,
    [sub.company_id, Number(sub.emailed_upto) || 0, upto, sub.user_id],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    actor: r.actor,
    actorName: r.actor_name ?? '',
    subjectName: r.subject_name ?? '',
    kind: r.kind,
    op: r.op,
    tbl: r.tbl,
    recordId: r.record_id,
    count: Number(r.count) || 1,
    important: Boolean(r.important),
    private: Boolean(r.private),
    summary: r.summary && typeof r.summary === 'object' ? r.summary : {},
    unread: true,
  }));
}

/** What the changes email needs of the company: its names and how it writes amounts and dates. */
async function companyForChanges(deps: AlertsDeps, companyId: string): Promise<Company | null> {
  const [row] = await deps.sql<{ data: Record<string, unknown> | null; name: string }>(
    `select c.name,
            (select jsonb_build_object(
                'name', r.data -> 'name', 'nameAr', r.data -> 'nameAr', 'locale', r.data -> 'locale',
                'dateFormat', r.data -> 'dateFormat', 'currency', r.data -> 'currency',
                'currencyDisplay', r.data -> 'currencyDisplay')
               from public.records r
              where r.company_id = c.id and r.tbl = 'companies' and r.id = c.id) as data
     from public.companies c where c.id = $1`,
    [companyId],
  );
  if (!row) return null;
  const data = row.data ?? {};
  const text = (value: unknown, fallback = '') =>
    typeof value === 'string' && value ? value : fallback;
  return {
    id: companyId,
    name: text(data.name, row.name),
    nameAr: text(data.nameAr) || undefined,
    locale: text(data.locale, 'en-KW'),
    dateFormat: text(data.dateFormat, 'dd/MM/yyyy'),
    currency: text(data.currency, 'KWD'),
    currencyDisplay: data.currencyDisplay === 'code' ? 'code' : 'local',
  } as Company;
}

async function notifyDone(
  deps: AlertsDeps,
  sub: ChangeSubscription,
  done: {
    emailedUpto?: number;
    summaryOn?: ISODate;
    sentOn?: ISODate;
    problem?: string;
  },
): Promise<void> {
  await deps.sql(
    `update public.notification_settings
     set emailed_upto = greatest(emailed_upto, coalesce($3::bigint, emailed_upto)),
         digest_on = coalesce($4::date, digest_on),
         sent_count = case when $5::date is null then sent_count
                           when sent_on = $5::date then sent_count + 1 else 1 end,
         sent_on = coalesce($5::date, sent_on),
         last_sent_at = case when $5::date is null then last_sent_at else $7::timestamptz end,
         last_error = $6,
         last_error_at = case when $6 = '' then null else now() end,
         claimed_until = null,
         send_key = null,
         send_upto = null
     where company_id = $1 and user_id = $2`,
    [
      sub.company_id,
      sub.user_id,
      done.emailedUpto ?? null,
      done.summaryOn ?? null,
      done.sentOn ?? null,
      (done.problem ?? '').slice(0, 1000),
      // The function's own clock: the next run measures the 15 minutes with it.
      deps.now().toISOString(),
    ],
  );
}

async function notifyFailed(deps: AlertsDeps, sub: ChangeSubscription, error: unknown) {
  const problem = error instanceof Error ? error.message : String(error);
  await deps.sql(
    `update public.notification_settings
     set last_error = $3, last_error_at = now(), claimed_until = null,
         send_key = case when $4::boolean then null else send_key end,
         send_upto = case when $4::boolean then null else send_upto end
     where company_id = $1 and user_id = $2`,
    [
      sub.company_id,
      sub.user_id,
      problem.slice(0, 1000) || 'Unknown problem',
      error instanceof AlertsError && error.refused,
    ],
  );
}

/**
 * Emails the changes of the team to whoever has new ones due: the owner and
 * the approvers who turned them on, at their account's confirmed address.
 */
export async function runChangeNotifications(deps: AlertsDeps): Promise<NotifySummary> {
  const now = deps.now();
  const clock = kuwaitClock(now);
  const summary: NotifySummary = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  // Only people who are still the owner or an approver, with something new, not being worked on.
  const due = await deps.sql<ChangeSubscription>(
    `update public.notification_settings s
     set claimed_until = now() + interval '5 minutes'
     from public.company_members m
     where m.company_id = s.company_id and m.user_id = s.user_id
       and (m.role = 'owner' or (m.can_approve and m.role in ('admin', 'accountant')))
       and s.enabled
       and (s.claimed_until is null or s.claimed_until < now())
       and exists (
         select 1 from public.change_events e
         where e.company_id = s.company_id and e.id > s.emailed_upto
           and e.actor is distinct from s.user_id
       )
     returning s.company_id, s.user_id, s.immediate_kinds, s.digest, s.app_url, s.emailed_upto,
       s.digest_on::text as digest_on, s.sent_on::text as sent_on, s.sent_count,
       (extract(epoch from s.last_sent_at) * 1000)::float8 as last_sent_ms,
       s.send_key, s.send_upto`,
  );
  let first = true;
  for (const sub of due) {
    summary.checked += 1;
    try {
      // An email whose answer was lost goes again as it was, with its key.
      const retry = sub.send_key && sub.send_upto !== null ? Number(sub.send_upto) : null;
      const waiting = await waitingChanges(deps, sub, retry);
      if (!waiting.length) {
        await notifyDone(deps, sub, {});
        continue;
      }
      const newest = waiting[waiting.length - 1].id;
      let kind: ChangeEmailKind | null;
      let summaryDone = false;
      const immediateKinds = sub.immediate_kinds ?? [];
      if (retry !== null) {
        kind = waiting.some((e) => e.important && immediateKinds.includes(e.kind))
          ? 'immediate'
          : 'daily';
        summaryDone = kind === 'daily';
      } else {
        const decision = notifyDecision(
          waiting,
          {
            immediateKinds,
            digest: sub.digest === 'off' ? 'off' : 'daily',
            digestOn: sub.digest_on,
            sentOn: sub.sent_on,
            sentCount: Number(sub.sent_count) || 0,
            lastSentMs: sub.last_sent_ms === null ? null : Number(sub.last_sent_ms),
          },
          clock,
          now.getTime(),
        );
        kind = decision.send;
        summaryDone = decision.summaryDone;
        if (!kind) {
          await notifyDone(deps, sub, {
            emailedUpto: decision.letGo ? newest : undefined,
            summaryOn: summaryDone ? clock.date : undefined,
          });
          summary.skipped += 1;
          continue;
        }
      }
      const who = await person(deps, sub.user_id);
      if (!who?.confirmed) {
        await notifyDone(deps, sub, { problem: 'The account has no confirmed email address.' });
        summary.skipped += 1;
        continue;
      }
      const company = await companyForChanges(deps, sub.company_id);
      if (!company) {
        await notifyDone(deps, sub, { problem: 'The company is not in the cloud.' });
        summary.skipped += 1;
        continue;
      }
      const email = await inLanguage(who.language, () =>
        renderChangesEmail({
          kind: kind!,
          company,
          events: waiting,
          appUrl: sub.app_url,
          to: who.email,
        }),
      );
      // The key, and what the email covers, saved first.
      const key = sub.send_key ?? `changes/${clock.date}/${crypto.randomUUID()}`;
      if (!sub.send_key) {
        await deps.sql(
          `update public.notification_settings set send_key = $3, send_upto = $4::bigint
           where company_id = $1 and user_id = $2`,
          [sub.company_id, sub.user_id, key, newest],
        );
      }
      if (!first) await deps.sleep(PAUSE_BETWEEN_EMAILS_MS);
      first = false;
      await sendEmail(deps, { to: who.email, ...email, idempotencyKey: key });
      await notifyDone(deps, sub, {
        emailedUpto: newest,
        summaryOn: summaryDone ? clock.date : undefined,
        sentOn: clock.date,
      });
      summary.sent += 1;
    } catch (error) {
      deps.log(`email-alerts: changes ${sub.company_id}/${sub.user_id}: ${String(error)}`);
      await notifyFailed(deps, sub, error);
      summary.failed += 1;
    }
  }
  return summary;
}

/* -------------------------------------------------------------------------- */
/* A pay run sent for approval (#10, 20261130000000_people_alerts.sql)        */
/* -------------------------------------------------------------------------- */

export interface PayrollApprovalSummary {
  sent: number;
  /** Nothing more to do: decided meanwhile, not an approver any more, no address. */
  finished: number;
  /** Tried again by the next run. */
  failed: number;
}

interface ApprovalEmailRow {
  company_id: string;
  approval_id: string;
  user_id: string;
}

/** Records of a company by table and id. */
async function recordData(
  deps: AlertsDeps,
  companyId: string,
  tbl: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await deps.sql<{ data: Record<string, unknown> }>(
    'select data from public.records where company_id = $1 and tbl = $2 and id = $3',
    [companyId, tbl, id],
  );
  return row?.data ?? null;
}

async function approvalEmailDone(
  deps: AlertsDeps,
  row: ApprovalEmailRow,
  result: { sent?: boolean; finished?: boolean; problem?: string },
): Promise<void> {
  await deps.sql(
    `update almailbooks.approval_emails
     set sent_at = case when $4::boolean then now() else sent_at end,
         finished_at = case when $5::boolean then now() else finished_at end,
         claimed_until = null,
         last_error = $6,
         last_error_at = case when $6 = '' then null else now() end
     where company_id = $1 and approval_id = $2 and user_id = $3::uuid`,
    [
      row.company_id,
      row.approval_id,
      row.user_id,
      Boolean(result.sent),
      Boolean(result.finished || result.sent),
      (result.problem ?? '').slice(0, 1000),
    ],
  );
}

/** Where the app is for this person: the function's secret, or what they saved. */
async function appUrlFor(deps: AlertsDeps, companyId: string, userId: string): Promise<string> {
  const configured = safeAppUrl(deps.env.appUrl ?? '');
  if (configured) return configured;
  const rows = await deps.sql<{ app_url: string }>(
    `select app_url from public.email_alerts where company_id = $1 and user_id = $2::uuid
     union all
     select app_url from public.notification_settings where company_id = $1 and user_id = $2::uuid`,
    [companyId, userId],
  );
  return rows.map((r) => safeAppUrl(r.app_url ?? '')).find(Boolean) ?? '';
}

/**
 * Emails the approvers of pay runs sent for approval (the rows the trigger of
 * 20261130000000_people_alerts.sql noted), one request (`only`) or every one
 * not sent yet: the owner and the members allowed to approve, at their
 * account's confirmed address, in their language, once each (Resend's
 * idempotency key is the request and the person). Only while the request
 * waits, for the pay run as it was sent, with the owner's switch on. The
 * totals come from the pay run as the cloud keeps it, with groups of one
 * merged; never names, Civil IDs, IBANs or anyone's own pay.
 */
export async function sendPayrollApprovalEmails(
  deps: AlertsDeps,
  only?: { companyId: string; approvalId: string },
): Promise<PayrollApprovalSummary> {
  const summary: PayrollApprovalSummary = { sent: 0, finished: 0, failed: 0 };
  let due: ApprovalEmailRow[];
  try {
    due = await deps.sql<ApprovalEmailRow>(
      `update almailbooks.approval_emails a
       set claimed_until = now() + interval '5 minutes', attempts = a.attempts + 1
       where a.finished_at is null and a.attempts < 5
         and a.created_at > now() - interval '3 days'
         and (a.claimed_until is null or a.claimed_until < now())
         and ($1::text is null or (a.company_id = $1 and a.approval_id = $2))
       returning a.company_id, a.approval_id, a.user_id::text as user_id`,
      [only?.companyId ?? null, only?.approvalId ?? null],
    );
  } catch (error) {
    // 20261130000000_people_alerts.sql hasn't run: nothing to send.
    if (!/does not exist/i.test(String(error))) {
      deps.log(`email-alerts: payroll approvals not ready (${String(error)})`);
    }
    return summary;
  }
  const byRequest = new Map<string, ApprovalEmailRow[]>();
  for (const row of due) {
    const key = `${row.company_id} ${row.approval_id}`;
    byRequest.set(key, [...(byRequest.get(key) ?? []), row]);
  }
  let first = true;
  for (const rows of byRequest.values()) {
    const { company_id: companyId, approval_id: approvalId } = rows[0];
    const finishAll = async (problem: string) => {
      for (const row of rows) await approvalEmailDone(deps, row, { finished: true, problem });
      summary.finished += rows.length;
    };
    try {
      const request = await recordData(deps, companyId, 'approvals', approvalId);
      if (
        !request ||
        request.kind !== 'payroll' ||
        request.subjectTbl !== 'payRuns' ||
        (request.status ?? 'pending') !== 'pending'
      ) {
        await finishAll('The request is no longer waiting.');
        continue;
      }
      const companyRecord = await recordData(deps, companyId, 'companies', companyId);
      const rules = companyRecord?.approvalRules as Record<string, unknown> | undefined;
      if (rules?.payroll !== true) {
        await finishAll('Salary approval is off.');
        continue;
      }
      const runId = String(request.subjectId ?? '');
      const run = await recordData(deps, companyId, 'payRuns', runId);
      const asked = (request.after as Record<string, unknown> | null)?.runUpdatedAt;
      if (!run) {
        // Not in the cloud yet: the next run tries again.
        for (const row of rows) {
          await approvalEmailDone(deps, row, { problem: 'The pay run is not in the cloud yet.' });
        }
        summary.failed += rows.length;
        continue;
      }
      if (run.updatedAt !== asked) {
        await finishAll('The pay run changed after it was sent for approval.');
        continue;
      }
      const company = await companyForChanges(deps, companyId);
      if (!company) {
        await finishAll('The company is not in the cloud.');
        continue;
      }
      const precision = currencyPrecision(company.currency);
      const lines = (Array.isArray(run.lines) ? run.lines : []) as PayLine[];
      const breakdown = payrollBreakdown(lines, precision, { minGroup: 2 });
      const period = typeof run.period === 'string' ? run.period : String(request.subjectNumber);
      // Last month's posted pay run, to compare.
      const [last] = await deps.sql<{ data: Record<string, unknown> }>(
        `select data from public.records
         where company_id = $1 and tbl = 'payRuns' and data ->> 'period' = $2
           and data ->> 'status' in ('approved', 'paid')
         limit 1`,
        [companyId, addPeriods(period, -1)],
      );
      const lastLines = (Array.isArray(last?.data.lines) ? last.data.lines : []) as PayLine[];
      const lastTotals = last ? payRunTotals(lastLines, precision) : null;
      // The company's departments, for their Arabic names (kept by company id).
      const settings = await recordData(deps, companyId, 'peopleSettings', companyId);
      const departments: Department[] = normalizeDepartments(settings?.departments);
      const [asker] = await deps.sql<{ name: string | null }>(
        `select coalesce(nullif(btrim(p.full_name), ''), p.email) as name
         from public.profiles p where p.id::text = $1`,
        [String(request.requestedBy ?? '')],
      );
      // Who may decide it, as the trigger noted them.
      const approvers = new Set(
        (
          await deps.sql<{ user_id: string }>(
            `select m.user_id::text as user_id from public.company_members m
             where m.company_id = $1
               and (m.role = 'owner' or (m.can_approve and m.role in ('admin', 'accountant')))
               and coalesce(m.permissions -> 'apps' ->> 'people', '') <> 'none'`,
            [companyId],
          )
        ).map((m) => m.user_id),
      );
      for (const row of rows) {
        try {
          if (!approvers.has(row.user_id) || row.user_id === request.requestedBy) {
            await approvalEmailDone(deps, row, { finished: true, problem: 'Not an approver.' });
            summary.finished += 1;
            continue;
          }
          const who = await person(deps, row.user_id);
          if (!who?.confirmed) {
            await approvalEmailDone(deps, row, {
              finished: true,
              problem: 'The account has no confirmed email address.',
            });
            summary.finished += 1;
            continue;
          }
          const appUrl = await appUrlFor(deps, companyId, row.user_id);
          const email = await inLanguage(who.language, () =>
            renderPayrollApprovalEmail({
              company,
              period,
              breakdown,
              previous:
                last && lastTotals
                  ? {
                      period: String(last.data.period),
                      employees: lastTotals.employees,
                      net: lastTotals.net,
                    }
                  : null,
              departments,
              requestedBy: asker?.name ?? '',
              hasNote: typeof request.reason === 'string' && request.reason.trim() !== '',
              appUrl,
              runId,
              to: who.email,
            }),
          );
          if (!first) await deps.sleep(PAUSE_BETWEEN_EMAILS_MS);
          first = false;
          await sendEmail(deps, {
            to: who.email,
            ...email,
            idempotencyKey: `payroll-approval/${approvalId}/${row.user_id}`,
          });
          await approvalEmailDone(deps, row, { sent: true });
          summary.sent += 1;
        } catch (error) {
          deps.log(`email-alerts: payroll approval ${approvalId}/${row.user_id}: ${String(error)}`);
          const problem = error instanceof Error ? error.message : String(error);
          await approvalEmailDone(deps, row, { problem: problem || 'Unknown problem' });
          summary.failed += 1;
        }
      }
    } catch (error) {
      deps.log(`email-alerts: payroll approval ${approvalId}: ${String(error)}`);
      for (const row of rows) {
        await approvalEmailDone(deps, row, { problem: String(error) }).catch(() => undefined);
      }
      summary.failed += rows.length;
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
  let body: { action?: unknown; companyId?: unknown; approvalId?: unknown };
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
    if (body.action === 'notify') {
      const secret = await schedulerSecret(deps);
      const given = request.headers.get('x-alerts-secret') ?? '';
      if (!secret || !sameText(given, secret)) {
        return json(401, { ok: false, error: 'auth', message: 'Only the schedule runs this.' });
      }
      const summary = await runChangeNotifications(deps);
      deps.log(`email-alerts: changes ${JSON.stringify(summary)}`);
      // Pay runs' approval emails that haven't gone yet.
      const payroll = await sendPayrollApprovalEmails(deps);
      if (payroll.sent || payroll.failed) {
        deps.log(`email-alerts: payroll approvals ${JSON.stringify(payroll)}`);
      }
      return json(200, { ok: true, ...summary, payroll });
    }
    if (body.action === 'payroll_approval') {
      const secret = await schedulerSecret(deps);
      const given = request.headers.get('x-alerts-secret') ?? '';
      if (!secret || !sameText(given, secret)) {
        return json(401, { ok: false, error: 'auth', message: 'Only the database runs this.' });
      }
      const companyId = typeof body.companyId === 'string' ? body.companyId : '';
      const approvalId = typeof body.approvalId === 'string' ? body.approvalId : '';
      if (!COMPANY_ID.test(companyId) || !/^[A-Za-z0-9_:-]{1,100}$/.test(approvalId)) {
        return json(400, { ok: false, error: 'invalid', message: 'Which request?' });
      }
      const summary = await sendPayrollApprovalEmails(deps, { companyId, approvalId });
      deps.log(`email-alerts: payroll approval ${JSON.stringify(summary)}`);
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
