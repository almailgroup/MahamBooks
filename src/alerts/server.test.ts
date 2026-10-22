// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLanguage } from '@/i18n';
import { startDatabase, type Harness } from '@/cloud/sql-harness';
import { handleAlertsRequest, kuwaitClock, type AlertsDeps, type Sql } from './server';
import { sampleData } from './testing';

/**
 * The email-alerts function against the real database scripts (in an
 * in-process Postgres), with Resend and Supabase Auth faked.
 */

const PROJECT = 'https://project.supabase.co';
const FUNCTION_URL = `${PROJECT}/functions/v1/email-alerts`;
const ALL = ['documents', 'deadlines', 'cheques', 'bills', 'invoices'];

let h: Harness;
let sql: Sql;
let seq = 0;

interface Sent {
  headers: Record<string, string>;
  body: { from: string; to: string[]; subject: string; html: string; text: string };
}
let sent: Sent[];
let resendAnswer: () => Response;
let sessions: Map<string, string>;
let clock: Date;
let env: AlertsDeps['env'];
let logs: string[];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  if (url === 'https://api.resend.com/emails') {
    sent.push({ headers, body: JSON.parse(String(init?.body)) });
    return resendAnswer();
  }
  if (url === `${PROJECT}/auth/v1/user`) {
    const id = sessions.get((headers.authorization ?? '').replace(/^Bearer /, ''));
    return id ? Response.json({ id }) : Response.json({ msg: 'bad jwt' }, { status: 401 });
  }
  throw new Error(`Unexpected request to ${url}`);
};

const deps = (): AlertsDeps => ({
  sql,
  env,
  fetch: fakeFetch,
  now: () => clock,
  log: (m) => logs.push(m),
  sleep: async () => {},
});

beforeAll(async () => {
  h = await startDatabase();
  sql = async (query, params = []) => (await h.db.query(query, params)).rows as never[];
}, 60_000);

beforeEach(async () => {
  sent = [];
  logs = [];
  sessions = new Map();
  resendAnswer = () => Response.json({ id: 'email-1' });
  // Tuesday 6 October 2026, 08:07 in Kuwait.
  clock = new Date('2026-10-06T05:07:00Z');
  env = {
    supabaseUrl: PROJECT,
    resendKey: 're_test_key',
    from: 'Maham Books <alerts@example.com>',
    apiKey: 'sb_publishable_test',
  };
  // Each test starts with nobody wanting email.
  await h.admin('update public.email_alerts set enabled = false');
  await h.admin('update public.notification_settings set enabled = false');
});

afterEach(async () => {
  await loadLanguage('en');
});

/** The sample company in the cloud, with an owner, an admin and a staff member. */
async function company() {
  seq += 1;
  const data = sampleData();
  const id = `acme-${String(seq).padStart(4, '0')}`;
  const tag = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await h.user(`owner-${tag}@example.com`, { name: 'Owner' });
  const admin = await h.user(`admin-${tag}@example.com`, { name: 'Admin' });
  const staff = await h.user(`staff-${tag}@example.com`, { name: 'Staff' });
  await h.rpc(owner, 'create_company', { p_id: id, p_name: 'Acme Trading' });
  for (const [user, email, role] of [
    [admin, `admin-${tag}@example.com`, 'admin'],
    [staff, `staff-${tag}@example.com`, 'staff'],
  ]) {
    const [invite] = await h.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: id,
      p_email: email,
      p_role: role,
    });
    await h.rpc(user, 'accept_invite', { p_token: invite.token });
  }
  const own = <T extends object>(r: T) => ({ ...r, companyId: id });
  const changes = [
    { tbl: 'companies', id, data: { ...data.company, id } },
    ...data.employees.map((r) => ({ tbl: 'employees', id: r.id, data: own(r) })),
    ...data.complianceDocuments.map((r) => ({
      tbl: 'complianceDocuments',
      id: r.id,
      data: own(r),
    })),
    ...data.documents.map((r) => ({ tbl: 'documents', id: r.id, data: own(r) })),
    ...data.payments.map((r) => ({ tbl: 'payments', id: r.id, data: own(r) })),
    ...data.clients.map((r) => ({ tbl: 'clients', id: r.id, data: own(r) })),
  ];
  await h.rpc(owner, 'push_records', { p_company: id, p_changes: JSON.stringify(changes) });
  for (const [user, token] of [
    [owner, `token-owner-${tag}`],
    [admin, `token-admin-${tag}`],
    [staff, `token-staff-${tag}`],
  ]) {
    sessions.set(token, user);
  }
  return {
    id,
    owner,
    admin,
    staff,
    ownerEmail: `owner-${tag}@example.com`,
    adminEmail: `admin-${tag}@example.com`,
    tokens: {
      owner: `token-owner-${tag}`,
      admin: `token-admin-${tag}`,
      staff: `token-staff-${tag}`,
    },
  };
}

const turnOn = (user: string, companyId: string, topics = ALL) =>
  h.rpc(user, 'set_email_alerts', {
    p_company: companyId,
    p_enabled: true,
    p_topics: topics,
    p_app_url: 'https://books.example.com/',
  });

async function secret() {
  const [row] = await h.admin<{ secret: string }>(
    'select secret from almailbooks.email_alerts_config',
  );
  return row.secret;
}

async function run(secretValue?: string) {
  const response = await handleAlertsRequest(
    new Request(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-alerts-secret': secretValue ?? (await secret()),
      },
      body: JSON.stringify({ action: 'run' }),
    }),
    deps(),
  );
  return { status: response.status, body: await response.json() };
}

async function sendNow(token: string | null, companyId: string) {
  const response = await handleAlertsRequest(
    new Request(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: 'send', companyId }),
    }),
    deps(),
  );
  return { status: response.status, body: await response.json() };
}

const row = async (companyId: string, user: string) =>
  (
    await h.admin<{
      checked_on: string | null;
      sent_keys: string[] | null;
      last_sent_at: string | null;
      last_error: string;
    }>(
      `select checked_on::text as checked_on, sent_keys, last_sent_at, last_error
       from public.email_alerts where company_id = $1 and user_id = $2`,
      [companyId, user],
    )
  )[0];

describe('kuwaitClock', () => {
  it('is three hours ahead of UTC', () => {
    expect(kuwaitClock(new Date('2026-10-06T04:59:00Z'))).toEqual({
      date: '2026-10-06',
      hour: 7,
      weekday: 2,
    });
    expect(kuwaitClock(new Date('2026-10-10T21:30:00Z'))).toEqual({
      date: '2026-10-11',
      hour: 0,
      weekday: 0,
    });
  });
});

describe('the email-alerts function', () => {
  it('writes its address for the schedule and says whether it is ready', async () => {
    await h.admin(`update almailbooks.email_alerts_config set function_url = ''`);
    const response = await handleAlertsRequest(new Request(FUNCTION_URL), deps());
    expect(await response.json()).toEqual({ ok: true, database: true, sender: true });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const [config] = await h.admin<{ function_url: string }>(
      'select function_url from almailbooks.email_alerts_config',
    );
    expect(config.function_url).toBe(FUNCTION_URL);

    env = { ...env, resendKey: '' };
    const missing = await handleAlertsRequest(new Request(FUNCTION_URL), deps());
    expect(await missing.json()).toMatchObject({ sender: false });
  });

  it('answers the browser before a request from the app', async () => {
    const response = await handleAlertsRequest(
      new Request(FUNCTION_URL, { method: 'OPTIONS' }),
      deps(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('runs for the schedule only, with its secret', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    expect((await run('wrong')).status).toBe(401);
    expect((await run('')).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await row(c.id, c.owner)).checked_on).toBeNull();
  });

  it('waits until 8:00 in Kuwait', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    clock = new Date('2026-10-06T04:59:00Z');
    expect((await run()).body).toMatchObject({ ok: true, waiting: true, sent: 0 });
    expect(sent).toEqual([]);
  });

  it('emails each owner and admin who turned alerts on, once a day, in their language', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    await turnOn(c.admin, c.id, ['invoices']);
    await h.admin(`update public.profiles set language = 'ar' where id = $1`, [c.admin]);

    expect((await run()).body).toMatchObject({ ok: true, waiting: false, sent: 2, failed: 0 });
    const toOwner = sent.find((s) => s.body.to[0] === c.ownerEmail)!;
    const toAdmin = sent.find((s) => s.body.to[0] === c.adminEmail)!;
    expect(toOwner.body.from).toBe('Maham Books <alerts@example.com>');
    expect(toOwner.body.subject).toBe('Acme Trading: 12 things need attention');
    expect(toOwner.body.text).toContain('Email alerts are on for Acme Trading.');
    expect(toOwner.headers['idempotency-key']).toMatch(/^alerts\/2026-10-06\/[0-9a-f-]{36}$/);
    expect(toOwner.headers.authorization).toBe('Bearer re_test_key');
    expect(toOwner.body.html).toContain('href="https://books.example.com/"');
    // The admin chose overdue invoices only, and reads Arabic.
    expect(toAdmin.body.subject).toBe('أكمي للتجارة: أمران يحتاجان إلى متابعة');
    expect(toAdmin.body.text).toContain('INV-LATE');
    expect(toAdmin.body.text).not.toContain('CHQ-LATE');

    expect(await row(c.id, c.owner)).toMatchObject({
      checked_on: '2026-10-06',
      last_error: '',
    });
    expect((await row(c.id, c.owner)).sent_keys).toHaveLength(12);
    expect((await row(c.id, c.owner)).last_sent_at).not.toBeNull();

    // The next hour: already done today.
    clock = new Date('2026-10-06T06:07:00Z');
    expect((await run()).body).toMatchObject({ sent: 0, checked: 0 });
    expect(sent).toHaveLength(2);
  });

  it('stays quiet when nothing is new, tells what is new, and sums up on Sundays', async () => {
    const c = await company();
    await turnOn(c.owner, c.id, ['invoices']);
    await run();
    expect(sent).toHaveLength(1);

    // Wednesday: the invoice due on Tuesday has become overdue.
    clock = new Date('2026-10-07T05:07:00Z');
    expect((await run()).body).toMatchObject({ sent: 1 });
    expect(sent[1].body.subject).toBe('Acme Trading: 1 new alert');
    expect(sent[1].body.text).toContain('- [New] Invoice INV-TODAY · Gulf Hotel');
    expect(sent[1].body.text.match(/\[New\]/g)).toHaveLength(1);

    // Thursday to Saturday: the same three invoices. Nothing new, no email.
    for (const day of ['2026-10-08', '2026-10-09', '2026-10-10']) {
      clock = new Date(`${day}T05:07:00Z`);
      expect((await run()).body).toMatchObject({ checked: 1, sent: 0 });
    }
    expect(sent).toHaveLength(2);
    expect((await row(c.id, c.owner)).checked_on).toBe('2026-10-10');

    // Sunday: everything still open.
    clock = new Date('2026-10-11T05:07:00Z');
    expect((await run()).body).toMatchObject({ sent: 1 });
    expect(sent[2].body.subject).toBe('Acme Trading: 3 things need attention');
    expect(sent[2].body.text).toContain('weekly summary');
  });

  it('never emails staff, people who left, or people whose alerts are off', async () => {
    const c = await company();
    await turnOn(c.admin, c.id);
    await h.rpc(c.owner, 'set_member_role', { p_company: c.id, p_user: c.admin, p_role: 'staff' });
    await turnOn(c.owner, c.id);
    await h.rpc(c.owner, 'set_email_alerts', {
      p_company: c.id,
      p_enabled: false,
      p_topics: ALL,
      p_app_url: '',
    });
    expect((await run()).body).toMatchObject({ sent: 0, checked: 0 });
    expect(sent).toEqual([]);
  });

  it('keeps a refused email as a problem and tries again the next hour', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    resendAnswer = () =>
      Response.json(
        {
          statusCode: 403,
          name: 'validation_error',
          message: 'The example.com domain is not verified.',
        },
        { status: 403 },
      );
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    expect(await row(c.id, c.owner)).toMatchObject({
      checked_on: null,
      last_error: 'The example.com domain is not verified.',
    });
    expect(
      (await h.rpc<{ last_error: string }>(c.owner, 'email_alert_settings', { p_company: c.id }))[0]
        .last_error,
    ).toBe('The example.com domain is not verified.');

    resendAnswer = () => Response.json({ id: 'email-2' });
    clock = new Date('2026-10-06T06:07:00Z');
    expect((await run()).body).toMatchObject({ sent: 1 });
    expect(await row(c.id, c.owner)).toMatchObject({ checked_on: '2026-10-06', last_error: '' });
  });

  it('sends again under the same key when the answer was lost, and a new one after a refusal', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    // No answer: Resend may have sent it, so the next try uses the same key.
    resendAnswer = () => {
      throw new TypeError('fetch failed');
    };
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    clock = new Date('2026-10-06T06:07:00Z');
    resendAnswer = () =>
      Response.json({ name: 'validation_error', message: 'Domain not verified.' }, { status: 403 });
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    expect(sent[1].headers['idempotency-key']).toBe(sent[0].headers['idempotency-key']);
    // Refused: not sent. The next try takes a new key.
    clock = new Date('2026-10-06T07:07:00Z');
    resendAnswer = () => Response.json({ id: 'email-3' });
    expect((await run()).body).toMatchObject({ sent: 1, failed: 0 });
    expect(sent[2].headers['idempotency-key']).not.toBe(sent[1].headers['idempotency-key']);
    const [after] = await h.admin<{ send_key: string | null }>(
      'select send_key from public.email_alerts where company_id = $1 and user_id = $2',
      [c.id, c.owner],
    );
    expect(after.send_key).toBeNull();
  });

  it('keeps trying while the sender is not set up', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    env = { ...env, from: '' };
    expect((await run()).body).toMatchObject({ sent: 0, failed: 1 });
    expect((await row(c.id, c.owner)).last_error).toContain('ALERTS_FROM');
    expect((await row(c.id, c.owner)).checked_on).toBeNull();
  });

  it('copes with records an older version of the app saved without some fields', async () => {
    const c = await company();
    await turnOn(c.owner, c.id, ['documents', 'cheques']);
    const old = {
      id: 'emp-old',
      companyId: c.id,
      name: 'Old Record',
      category: 'expat',
      status: 'active',
      residencyExpiry: '2026-10-02',
    };
    await h.rpc(c.owner, 'push_records', {
      p_company: c.id,
      p_changes: JSON.stringify([{ tbl: 'employees', id: old.id, data: old }]),
    });
    expect((await run()).body).toMatchObject({ sent: 1, failed: 0 });
    expect(sent[0].body.text).toContain('Residency · Old Record');
  });

  it('skips accounts without a confirmed address', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    await h.admin('update auth.users set email_confirmed_at = null where id = $1', [c.owner]);
    expect((await run()).body).toMatchObject({ sent: 0, checked: 1 });
    expect((await row(c.id, c.owner)).last_error).toContain('no confirmed email');
  });
});

describe('"Send it now" from the app', () => {
  it('needs a session of an owner or admin with alerts on', async () => {
    const c = await company();
    expect(await sendNow(null, c.id)).toMatchObject({ status: 401, body: { error: 'auth' } });
    expect(await sendNow('made-up', c.id)).toMatchObject({ status: 401 });
    expect(await sendNow(c.tokens.staff, c.id)).toMatchObject({
      status: 403,
      body: { error: 'permission' },
    });
    expect(await sendNow(c.tokens.owner, c.id)).toMatchObject({
      status: 409,
      body: { error: 'not_enabled' },
    });
    expect(await sendNow(c.tokens.owner, 'not a company')).toMatchObject({ status: 400 });
    expect(sent).toEqual([]);
  });

  it('emails the person what needs attention now, at most once a minute', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    expect(await sendNow(c.tokens.owner, c.id)).toEqual({
      status: 200,
      body: { ok: true, to: c.ownerEmail, count: 12 },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.to).toEqual([c.ownerEmail]);
    expect(sent[0].body.text).toContain(
      'Everything that needs attention in Acme Trading right now.',
    );
    // What it listed counts as seen: the morning run has nothing new to say.
    expect((await row(c.id, c.owner)).sent_keys).toHaveLength(12);
    expect((await run()).body).toMatchObject({ sent: 0 });

    expect(await sendNow(c.tokens.owner, c.id)).toMatchObject({
      status: 429,
      body: { error: 'too_soon' },
    });
    await h.admin(
      `update public.email_alerts set last_test_at = now() - interval '2 minutes'
       where company_id = $1`,
      [c.id],
    );
    expect((await sendNow(c.tokens.owner, c.id)).status).toBe(200);
  });

  it('says what is wrong with the sender', async () => {
    const c = await company();
    await turnOn(c.owner, c.id);
    env = { ...env, resendKey: '' };
    expect(await sendNow(c.tokens.owner, c.id)).toMatchObject({
      status: 503,
      body: { error: 'not_configured' },
    });
    env = { ...env, resendKey: 're_test_key' };
    resendAnswer = () =>
      Response.json({ name: 'validation_error', message: 'Domain not verified.' }, { status: 403 });
    expect(await sendNow(c.tokens.owner, c.id)).toMatchObject({
      status: 502,
      body: { error: 'send_failed', message: 'Domain not verified.' },
    });
    expect((await row(c.id, c.owner)).last_error).toBe('Domain not verified.');
  });
});

describe('changes by the team ("notify")', () => {
  async function notify(secretValue?: string) {
    const response = await handleAlertsRequest(
      new Request(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-alerts-secret': secretValue ?? (await secret()),
        },
        body: JSON.stringify({ action: 'notify' }),
      }),
      deps(),
    );
    return { status: response.status, body: await response.json() };
  }

  const changesOn = (
    user: string,
    companyId: string,
    options: { kinds?: string[]; digest?: 'daily' | 'off' } = {},
  ) =>
    h.rpc(user, 'set_change_notifications', {
      p_company: companyId,
      p_enabled: true,
      p_immediate_kinds: options.kinds ?? [
        'document',
        'cheque',
        'approval',
        'member',
        'settings',
        'people',
      ],
      p_digest: options.digest ?? 'daily',
      p_app_url: 'https://books.example.com/',
    });

  const push = (user: string, companyId: string, changes: unknown[]) =>
    h.rpc(user, 'push_records', { p_company: companyId, p_changes: JSON.stringify(changes) });

  /** The sample company's overdue invoice, voided. */
  const voidInvoice = (companyId: string, id = 'inv-late') => {
    const doc = sampleData().documents.find((d) => d.id === id)!;
    return { tbl: 'documents', id, data: { ...doc, companyId, status: 'void' } };
  };
  const newClient = (companyId: string, id: string) => ({
    tbl: 'clients',
    id,
    data: { id, companyId, name: `Made-up Client ${id}` },
  });

  const state = async (companyId: string, user: string) =>
    (
      await h.admin<{
        emailed_upto: number;
        sent_count: number;
        sent_on: string | null;
        digest_on: string | null;
        last_error: string;
        send_key: string | null;
      }>(
        `select emailed_upto::float8 as emailed_upto, sent_count, sent_on::text as sent_on,
                digest_on::text as digest_on, last_error, send_key
         from public.notification_settings where company_id = $1 and user_id = $2`,
        [companyId, user],
      )
    )[0];

  const newest = async (companyId: string) =>
    (
      await h.admin<{ id: number }>(
        'select max(id)::float8 as id from public.change_events where company_id = $1',
        [companyId],
      )
    )[0].id;

  beforeEach(() => {
    // Tuesday 6 October 2026, 10:07 in Kuwait.
    clock = new Date('2026-10-06T07:07:00Z');
  });

  it('runs for the schedule only, with its secret', async () => {
    expect((await notify('wrong')).status).toBe(401);
    expect((await notify('')).status).toBe(401);
    expect((await notify()).body).toMatchObject({ ok: true, sent: 0 });
  });

  it('emails an important change at once, naming who made it, never the reader’s own', async () => {
    const c = await company();
    await changesOn(c.owner, c.id);
    await push(c.owner, c.id, [newClient(c.id, 'by-the-owner')]);
    await push(c.staff, c.id, [voidInvoice(c.id)]);
    expect((await notify()).body).toMatchObject({ ok: true, sent: 1, failed: 0 });
    const [email] = sent;
    expect(email.body.to).toEqual([c.ownerEmail]);
    expect(email.body.subject).toBe('Acme Trading: 1 important change by your team');
    expect(email.body.text).toContain('Staff (1)');
    expect(email.body.text).toContain('Voided invoice INV-LATE · Gulf Hotel');
    expect(email.body.text).not.toContain('by-the-owner');
    expect(email.body.html).toContain(
      `href="https://books.example.com/#/notifications?company=${encodeURIComponent(c.id)}"`,
    );
    expect(email.headers['idempotency-key']).toMatch(/^changes\/2026-10-06\/[0-9a-f-]{36}$/);
    expect(await state(c.id, c.owner)).toMatchObject({
      emailed_upto: await newest(c.id),
      sent_count: 1,
      sent_on: '2026-10-06',
      send_key: null,
      last_error: '',
    });
    // Nothing new: nothing to do, the next run included.
    clock = new Date('2026-10-06T07:30:00Z');
    expect((await notify()).body).toMatchObject({ checked: 0, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it('keeps ordinary changes for the 8:00 summary, once a day', async () => {
    const c = await company();
    // 7:30 in Kuwait.
    clock = new Date('2026-10-06T04:30:00Z');
    await changesOn(c.owner, c.id);
    await push(c.staff, c.id, [newClient(c.id, 'early-1'), newClient(c.id, 'early-2')]);
    expect((await notify()).body).toMatchObject({ checked: 1, sent: 0, skipped: 1 });
    clock = new Date('2026-10-06T05:02:00Z');
    expect((await notify()).body).toMatchObject({ sent: 1 });
    expect(sent[0].body.subject).toBe('Acme Trading: 2 changes by your team');
    expect(sent[0].body.text).toContain('Good morning.');
    expect(sent[0].body.text).toContain('- 2 changes to customers and vendors');
    expect((await state(c.id, c.owner)).digest_on).toBe('2026-10-06');
    // Later the same day: tomorrow's summary.
    await push(c.staff, c.id, [newClient(c.id, 'later')]);
    clock = new Date('2026-10-06T09:00:00Z');
    expect((await notify()).body).toMatchObject({ sent: 0 });
    clock = new Date('2026-10-07T05:05:00Z');
    expect((await notify()).body).toMatchObject({ sent: 1 });
    expect(sent[1].body.subject).toBe('Acme Trading: 1 change by your team');
  });

  it('sends at most one email every 15 minutes and 20 a day', async () => {
    const c = await company();
    await changesOn(c.owner, c.id);
    await push(c.staff, c.id, [voidInvoice(c.id, 'inv-late')]);
    expect((await notify()).body).toMatchObject({ sent: 1 });
    clock = new Date('2026-10-06T07:12:00Z');
    await push(c.staff, c.id, [voidInvoice(c.id, 'inv-partial')]);
    expect((await notify()).body).toMatchObject({ sent: 0, skipped: 1 });
    clock = new Date('2026-10-06T07:23:00Z');
    expect((await notify()).body).toMatchObject({ sent: 1 });
    expect(sent[1].body.text).toContain('INV-PARTIAL');
    expect(sent[1].body.text).not.toContain('INV-LATE');

    // The day's twenty are gone: the next waits for tomorrow.
    await h.admin('update public.notification_settings set sent_count = 20 where company_id = $1', [
      c.id,
    ]);
    await push(c.staff, c.id, [voidInvoice(c.id, 'inv-today')]);
    clock = new Date('2026-10-06T09:00:00Z');
    expect((await notify()).body).toMatchObject({ sent: 0, skipped: 1 });
    // 00:30 in Kuwait the next day.
    clock = new Date('2026-10-06T21:30:00Z');
    expect((await notify()).body).toMatchObject({ sent: 1 });
    expect((await state(c.id, c.owner)).sent_count).toBe(1);
  });

  it('emails at once only the kinds chosen, and lets the rest go with the summary off', async () => {
    const c = await company();
    await changesOn(c.owner, c.id, { kinds: ['cheque'], digest: 'off' });
    await push(c.staff, c.id, [voidInvoice(c.id), newClient(c.id, 'quiet')]);
    expect((await notify()).body).toMatchObject({ sent: 0 });
    expect(sent).toEqual([]);
    // Nothing waits any more: it stays in the bell only.
    expect((await state(c.id, c.owner)).emailed_upto).toBe(await newest(c.id));
  });

  it('writes to each approver in their language, payroll without names or amounts', async () => {
    const c = await company();
    await h.rpc(c.owner, 'set_member_permissions', {
      p_company: c.id,
      p_user: c.admin,
      p_permissions: '{}',
      p_can_approve: true,
    });
    await changesOn(c.admin, c.id);
    await h.admin(`update public.profiles set language = 'ar' where id = $1`, [c.admin]);
    await push(c.owner, c.id, [
      {
        tbl: 'payRuns',
        id: 'run-1',
        data: { id: 'run-1', companyId: c.id, period: '2026-09', status: 'paid', lines: [] },
      },
      {
        tbl: 'employees',
        id: 'emp-new',
        data: { id: 'emp-new', companyId: c.id, name: 'Made-up Newcomer', civilId: '299999999999' },
      },
    ]);
    expect((await notify()).body).toMatchObject({ sent: 1 });
    const [email] = sent;
    expect(email.body.to).toEqual([c.adminEmail]);
    expect(email.body.subject).toBe('أكمي للتجارة: تغيير مهم واحد من فريقك');
    expect(email.body.text).toContain('مسير رواتب');
    expect(email.body.text).toContain('2026-09');
    for (const secret of ['Made-up Newcomer', '299999999999']) {
      expect(email.body.text).not.toContain(secret);
      expect(email.body.html).not.toContain(secret);
    }
  });

  it('never emails who stopped being an approver, or twice while a run is at it', async () => {
    const c = await company();
    await h.rpc(c.owner, 'set_member_permissions', {
      p_company: c.id,
      p_user: c.admin,
      p_permissions: '{}',
      p_can_approve: true,
    });
    await changesOn(c.admin, c.id);
    await changesOn(c.owner, c.id);
    await h.rpc(c.owner, 'set_member_permissions', {
      p_company: c.id,
      p_user: c.admin,
      p_permissions: '{}',
      p_can_approve: false,
    });
    // Another run is working on the owner's.
    await h.admin(
      `update public.notification_settings set claimed_until = now() + interval '5 minutes'
       where company_id = $1 and user_id = $2`,
      [c.id, c.owner],
    );
    await push(c.staff, c.id, [voidInvoice(c.id)]);
    expect((await notify()).body).toMatchObject({ checked: 0, sent: 0 });
    expect(sent).toEqual([]);
  });

  it('sends again under the same key when the answer was lost, and a new one after a refusal', async () => {
    const c = await company();
    await changesOn(c.owner, c.id);
    await push(c.staff, c.id, [voidInvoice(c.id)]);
    resendAnswer = () => {
      throw new TypeError('fetch failed');
    };
    expect((await notify()).body).toMatchObject({ sent: 0, failed: 1 });
    expect((await state(c.id, c.owner)).send_key).not.toBeNull();
    // Meanwhile more changes come; the same email goes again first, as it was.
    await push(c.staff, c.id, [voidInvoice(c.id, 'inv-partial')]);
    resendAnswer = () =>
      Response.json({ name: 'validation_error', message: 'Domain not verified.' }, { status: 403 });
    clock = new Date('2026-10-06T07:12:00Z');
    expect((await notify()).body).toMatchObject({ failed: 1 });
    expect(sent[1].headers['idempotency-key']).toBe(sent[0].headers['idempotency-key']);
    expect(sent[1].body.text).toBe(sent[0].body.text);
    expect(await state(c.id, c.owner)).toMatchObject({
      send_key: null,
      last_error: 'Domain not verified.',
    });
    expect(
      (
        await h.rpc<{ last_error: string }>(c.owner, 'change_notification_settings', {
          p_company: c.id,
        })
      )[0].last_error,
    ).toBe('Domain not verified.');
    resendAnswer = () => Response.json({ id: 'email-3' });
    clock = new Date('2026-10-06T07:17:00Z');
    expect((await notify()).body).toMatchObject({ sent: 1 });
    expect(sent[2].headers['idempotency-key']).not.toBe(sent[1].headers['idempotency-key']);
    expect(sent[2].body.text).toContain('INV-PARTIAL');
    expect(await state(c.id, c.owner)).toMatchObject({ last_error: '', send_key: null });
  });

  it('skips accounts without a confirmed address', async () => {
    const c = await company();
    await changesOn(c.owner, c.id);
    await push(c.staff, c.id, [voidInvoice(c.id)]);
    await h.admin('update auth.users set email_confirmed_at = null where id = $1', [c.owner]);
    expect((await notify()).body).toMatchObject({ sent: 0, skipped: 1 });
    expect((await state(c.id, c.owner)).last_error).toContain('no confirmed email');
  });
});

/* -------------------------------------------------------------------------- */
/* Expiry alerts with lead times and re-upload reminders (#18)                */
/* -------------------------------------------------------------------------- */

describe('expiry alerts (#18)', () => {
  const push = (user: string, companyId: string, changes: unknown[]) =>
    h.rpc(user, 'push_records', { p_company: companyId, p_changes: JSON.stringify(changes) });

  /** An accountant of the company, signed in with a session. */
  async function accountant(companyId: string, owner: string) {
    const email = `accountant-${companyId}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const user = await h.user(email, { name: 'Accountant' });
    const [invite] = await h.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: companyId,
      p_email: email,
      p_role: 'accountant',
    });
    await h.rpc(user, 'accept_invite', { p_token: invite.token });
    sessions.set(`token-${user}`, user);
    return { user, email, token: `token-${user}` };
  }

  const peopleSettings = (companyId: string, extra: Record<string, unknown>) => ({
    tbl: 'peopleSettings',
    id: companyId,
    data: {
      id: companyId,
      companyId,
      reminderDays: [60, 30, 7],
      eosDailyDivisor: 26,
      auditFilingMonths: 3,
      pifssDueDay: 15,
      kuwaitizationTarget: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...extra,
    },
  });

  it('emails accountants who turn alerts on, as owners and admins', async () => {
    const c = await company();
    const a = await accountant(c.id, c.owner);
    await turnOn(a.user, c.id);
    expect((await run()).body).toMatchObject({ sent: 1, failed: 0 });
    expect(sent[0].body.to).toEqual([a.email]);
    expect(sent[0].body.subject).toBe('Acme Trading: 12 things need attention');
    // "Send me the email now" too.
    expect((await sendNow(a.token, c.id)).status).toBe(200);
  });

  it('sends each person the kinds of paper they chose', async () => {
    const c = await company();
    await turnOn(c.owner, c.id, ['documents']);
    await turnOn(c.admin, c.id, ['documents']);
    await h.rpc(c.admin, 'set_email_alert_scope', { p_company: c.id, p_kinds: ['company'] });
    await run();
    const toOwner = sent.find((s) => s.body.to[0] === c.ownerEmail)!;
    const toAdmin = sent.find((s) => s.body.to[0] === c.adminEmail)!;
    expect(toOwner.body.text).toContain('Residency · Ravi Kumar');
    expect(toOwner.body.text).toContain('Commercial licence');
    expect(toAdmin.body.text).not.toContain('Ravi Kumar');
    expect(toAdmin.body.text).toContain('Commercial licence');
    expect((await row(c.id, c.admin)).sent_keys).toEqual(['documents:doc:licence:2026-12-01:60d']);
  });

  it("leaves employees' papers out for whoever the owner gave no access to People", async () => {
    const c = await company();
    await turnOn(c.admin, c.id, ['documents', 'deadlines']);
    await h.rpc(c.owner, 'set_member_permissions', {
      p_company: c.id,
      p_user: c.admin,
      p_permissions: JSON.stringify({ apps: { people: 'none' } }),
      p_can_approve: false,
    });
    await run();
    expect(sent[0].body.text).not.toContain('Ravi Kumar');
    expect(sent[0].body.text).not.toContain('Noura');
    expect(sent[0].body.text).toContain('Commercial licence');
    expect(sent[0].body.text).toContain('PIFSS');
    // And no Compliance: neither the register nor the deadlines.
    const d = await company();
    await turnOn(d.admin, d.id, ['documents', 'deadlines', 'invoices']);
    await h.rpc(d.owner, 'set_member_permissions', {
      p_company: d.id,
      p_user: d.admin,
      p_permissions: JSON.stringify({ apps: { compliance: 'none' } }),
      p_can_approve: false,
    });
    sent = [];
    await run();
    expect(sent[0].body.text).toContain('Ravi Kumar');
    expect(sent[0].body.text).not.toContain('Commercial licence');
    expect(sent[0].body.text).not.toContain('PIFSS');
    expect(sent[0].body.text).toContain('INV-LATE');
  });

  it('never emails anyone who is no longer an owner, admin or accountant', async () => {
    const c = await company();
    const a = await accountant(c.id, c.owner);
    await turnOn(a.user, c.id);
    await h.rpc(c.owner, 'set_member_role', { p_company: c.id, p_user: a.user, p_role: 'staff' });
    expect((await run()).body).toMatchObject({ checked: 0, sent: 0 });
    expect((await sendNow(a.token, c.id)).body).toMatchObject({ error: 'permission' });
  });

  it("uses the company's lead times by type, and reminds again after expiry", async () => {
    const c = await company();
    await turnOn(c.owner, c.id, ['documents']);
    await push(c.owner, c.id, [
      peopleSettings(c.id, {
        reminderDaysByType: { residency: [90, 60, 30, 7], passport: [180, 90, 30] },
        expiredRepeatDays: 7,
      }),
    ]);
    await run();
    expect((await row(c.id, c.owner)).sent_keys).toEqual([
      'documents:emp:emp-noura:civil_id:2026-10-01:expired',
      'documents:emp:emp-omar:civil_id:2026-10-11:7d',
      'documents:emp:emp-ravi:residency:2026-10-31:30d',
      'documents:doc:licence:2026-12-01:60d',
      'documents:emp:emp-maria:passport:2027-01-04:90d',
    ]);
    // A week and a day after it expired, the Civil ID is new again.
    clock = new Date('2026-10-09T05:07:00Z');
    sent = [];
    await run();
    expect(sent[0].body.subject).toBe('Acme Trading: 1 new alert');
    expect(sent[0].body.text).toContain('- [New] Civil ID · Noura Salem');
  });

  it('asks for the new copy of a renewed paper until a file is marked as it', async () => {
    const c = await company();
    await turnOn(c.owner, c.id, ['documents']);
    const licence = sampleData().complianceDocuments[0];
    await push(c.owner, c.id, [
      peopleSettings(c.id, { newCopyGraceDays: 14, newCopySince: '2026-09-01' }),
      {
        tbl: 'complianceDocuments',
        id: 'licence',
        data: { ...licence, companyId: c.id, expiryDate: '2027-12-01' },
      },
      {
        tbl: 'renewals',
        id: 'renewal-licence',
        data: {
          id: 'renewal-licence',
          companyId: c.id,
          documentKey: 'doc:licence',
          documentId: 'licence',
          employeeId: null,
          type: 'commercial_licence',
          renewedOn: '2026-09-20',
          previousExpiry: '2026-12-01',
          newExpiry: '2027-12-01',
          fee: 0,
          expenseId: null,
          note: '',
          createdAt: '2026-09-20T09:00:00.000Z',
        },
      },
    ]);
    await run();
    expect(sent[0].body.text).toContain('Commercial licence · Acme Trading · New copy missing');
    expect((await row(c.id, c.owner)).sent_keys).toContain(
      'documents:doc:licence:2027-12-01:noscan',
    );
    // The new copy, marked as the licence's valid until its new expiry.
    await push(c.owner, c.id, [
      {
        tbl: 'attachments',
        id: 'scan-1',
        data: {
          id: 'scan-1',
          companyId: c.id,
          ownerId: 'licence',
          name: 'licence.pdf',
          type: 'application/pdf',
          size: 10,
          dataUrl: '',
          docKey: 'doc:licence',
          validUntil: '2027-12-01',
          createdAt: '2026-10-06T09:00:00.000Z',
        },
      },
    ]);
    sent = [];
    expect((await sendNow(c.tokens.owner, c.id)).status).toBe(200);
    expect(sent[0].body.text).not.toContain('New copy missing');
  });

  it("keeps an older server's email as it was: every kind, owners and admins", async () => {
    // A database without 20261130000000_people_alerts.sql.
    const { MIGRATIONS } = await import('@/cloud/sql-harness');
    const older = await startDatabase(1, MIGRATIONS.length - 1);
    const olderSql: Sql = async (query, params = []) =>
      (await older.db.query(query, params)).rows as never[];
    const owner = await older.user('older-owner@example.com');
    await older.rpc(owner, 'create_company', { p_id: 'older-co-1', p_name: 'Acme Trading' });
    const data = sampleData();
    await older.rpc(owner, 'push_records', {
      p_company: 'older-co-1',
      p_changes: JSON.stringify([
        { tbl: 'companies', id: 'older-co-1', data: { ...data.company, id: 'older-co-1' } },
        ...data.employees.map((r) => ({
          tbl: 'employees',
          id: r.id,
          data: { ...r, companyId: 'older-co-1' },
        })),
      ]),
    });
    await older.rpc(owner, 'set_email_alerts', {
      p_company: 'older-co-1',
      p_enabled: true,
      p_topics: ['documents'],
      p_app_url: '',
    });
    const [config] = await older.admin<{ secret: string }>(
      'select secret from almailbooks.email_alerts_config',
    );
    const response = await handleAlertsRequest(
      new Request(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-alerts-secret': config.secret },
        body: JSON.stringify({ action: 'run' }),
      }),
      { ...deps(), sql: olderSql },
    );
    expect(await response.json()).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(sent[0].body.text).toContain('Residency · Ravi Kumar');
    // Listed as before, without headings by kind.
    expect(sent[0].body.text).not.toContain('Employees’ papers:');
    // An owner's limits on a member leave the email as it was too (#6's
    // limits cut it only once the script has run).
    const admin = await older.user('older-admin@example.com');
    const [invite] = await older.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: 'older-co-1',
      p_email: 'older-admin@example.com',
      p_role: 'admin',
    });
    await older.rpc(admin, 'accept_invite', { p_token: invite.token });
    await older.rpc(owner, 'set_member_permissions', {
      p_company: 'older-co-1',
      p_user: admin,
      p_permissions: JSON.stringify({ apps: { people: 'none' } }),
      p_can_approve: false,
    });
    await older.rpc(admin, 'set_email_alerts', {
      p_company: 'older-co-1',
      p_enabled: true,
      p_topics: ['documents'],
      p_app_url: '',
    });
    sent = [];
    const again = await handleAlertsRequest(
      new Request(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-alerts-secret': config.secret },
        body: JSON.stringify({ action: 'run' }),
      }),
      { ...deps(), sql: olderSql },
    );
    expect(await again.json()).toMatchObject({ sent: 1 });
    expect(sent[0].body.text).toContain('Residency · Ravi Kumar');
  }, 60_000);

  it('writes the new reminders to Updates once, where the company wants them, and never emails them', async () => {
    const c = await company();
    await h.rpc(c.owner, 'set_change_notifications', {
      p_company: c.id,
      p_enabled: true,
      p_immediate_kinds: ['document', 'cheque', 'approval', 'member', 'settings', 'people'],
      p_digest: 'daily',
      p_app_url: 'https://books.example.com/',
    });
    const events = () =>
      h.admin<{
        kind: string;
        tbl: string;
        record_id: string;
        private: boolean;
        actor: string | null;
        summary: Record<string, unknown>;
      }>(
        `select kind, tbl, record_id, private, actor, summary from public.change_events
         where company_id = $1 and kind = 'document_expiry' order by record_id`,
        [c.id],
      );
    // Not asked for: nothing written.
    await run();
    expect(await events()).toEqual([]);
    await push(c.owner, c.id, [peopleSettings(c.id, { expiryUpdates: true })]);
    expect((await run()).body.updates).toMatchObject({ written: 4, failed: 0 });
    const written = await events();
    expect(written.map((e) => [e.tbl, e.record_id, e.private, e.summary.what])).toEqual([
      ['employees', 'emp-noura', true, 'expired'],
      ['employees', 'emp-omar', true, 'expiring'],
      ['employees', 'emp-ravi', true, 'expiring'],
      ['complianceDocuments', 'licence', false, 'expiring'],
    ]);
    expect(written.every((e) => e.actor === null)).toBe(true);
    // Employees' papers carry no names.
    expect(JSON.stringify(written.filter((e) => e.private))).not.toMatch(/Ravi|Noura|Omar|R-1/);
    // The next hour: nothing new.
    clock = new Date('2026-10-06T06:07:00Z');
    expect((await run()).body.updates).toMatchObject({ written: 0 });
    // The owner sees them in the feed; the 5-minute emails leave them out.
    const feed = await h.rpc<{ kind: string; actor_name: string }>(c.owner, 'notification_feed', {
      p_company: c.id,
    });
    expect(feed.filter((e) => e.kind === 'document_expiry')).toHaveLength(4);
    const [owner] = await h.rpc<{ unread: number }>(c.owner, 'notification_status', {
      p_company: c.id,
    });
    expect(Number(owner.unread)).toBeGreaterThanOrEqual(4);
    // Anyone else still gets no feed at all.
    await expect(h.rpc(c.admin, 'notification_feed', { p_company: c.id })).rejects.toThrow(
      /almail:permission/,
    );
    const response = await handleAlertsRequest(
      new Request(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-alerts-secret': await secret() },
        body: JSON.stringify({ action: 'notify' }),
      }),
      deps(),
    );
    expect(await response.json()).toMatchObject({ ok: true });
    expect(sent.filter((s) => s.body.to[0] === c.ownerEmail)).toEqual([]);
  });
});
