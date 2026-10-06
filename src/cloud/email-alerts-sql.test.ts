// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { startDatabase, type Harness } from './sql-harness';

/**
 * The email alerts script (20261007000000_email_alerts.sql): who may turn
 * the morning email on, what is kept, and the hourly call to the function.
 * pg_net is a stand-in here that records the requests it would send.
 */

let h: Harness;
let seq = 0;

beforeAll(async () => {
  // Each file twice: running a script again must be safe.
  h = await startDatabase(2);
  await h.db.exec(`
    create schema net;
    create table net.sent (url text, body jsonb, headers jsonb, timeout_ms integer);
    create function net.http_post(
      url text,
      body jsonb default '{}'::jsonb,
      params jsonb default '{}'::jsonb,
      headers jsonb default '{}'::jsonb,
      timeout_milliseconds integer default 5000
    ) returns bigint language sql as $$
      insert into net.sent values (url, body, headers, timeout_milliseconds) returning 1::bigint
    $$;
  `);
}, 60_000);

const ALL = ['documents', 'deadlines', 'cheques', 'bills', 'invoices'];

/** A company with an owner, and members in every other role. */
async function team() {
  seq += 1;
  const company = `alerts-co-${String(seq).padStart(4, '0')}`;
  const tag = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await h.user(`owner-${tag}@example.com`, { name: 'Owner' });
  const others: Record<string, string> = {};
  await h.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${seq}` });
  for (const role of ['admin', 'accountant', 'staff', 'viewer']) {
    const email = `${role}-${tag}@example.com`;
    others[role] = await h.user(email, { name: role });
    const [invite] = await h.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: company,
      p_email: email,
      p_role: role,
    });
    await h.rpc(others[role], 'accept_invite', { p_token: invite.token });
  }
  const outsider = await h.user(`outsider-${tag}@example.com`);
  return {
    company,
    owner,
    admin: others.admin,
    accountant: others.accountant,
    staff: others.staff,
    viewer: others.viewer,
    outsider,
  };
}

interface Settings {
  enabled: boolean;
  topics: string[];
  last_sent_at: string | null;
  last_error: string;
  last_error_at: string | null;
  function_ready: boolean;
}

const settings = async (user: string, company: string) =>
  (await h.rpc<Settings>(user, 'email_alert_settings', { p_company: company }))[0];

const save = async (
  user: string,
  company: string,
  enabled: boolean,
  topics: string[] = ALL,
  appUrl = 'https://books.example.com/',
) =>
  (
    await h.rpc<Settings>(user, 'set_email_alerts', {
      p_company: company,
      p_enabled: enabled,
      p_topics: topics,
      p_app_url: appUrl,
    })
  )[0];

const stored = (company: string, user: string) =>
  h.admin<{
    enabled: boolean;
    topics: string[];
    app_url: string;
    sent_keys: unknown;
    checked_on: string | null;
  }>(
    `select enabled, topics, app_url, sent_keys, checked_on::text as checked_on
     from public.email_alerts where company_id = $1 and user_id = $2`,
    [company, user],
  );

describe('email alerts', () => {
  it('are off until an owner or admin turns their own on', async () => {
    const t = await team();
    expect(await settings(t.owner, t.company)).toMatchObject({
      enabled: false,
      topics: ALL,
      last_sent_at: null,
      last_error: '',
    });
    expect(
      await save(t.owner, t.company, true, ['invoices', 'documents', 'invoices']),
    ).toMatchObject({ enabled: true, topics: ['documents', 'invoices'] });
    expect(await save(t.admin, t.company, true)).toMatchObject({ enabled: true, topics: ALL });
    // One person's choice is theirs alone.
    expect(await settings(t.accountant, t.company)).toMatchObject({ enabled: false });
    expect(await stored(t.company, t.owner)).toEqual([
      {
        enabled: true,
        topics: ['documents', 'invoices'],
        app_url: 'https://books.example.com/',
        sent_keys: null,
        checked_on: null,
      },
    ]);
  });

  it('are refused to accountants, staff, viewers and outsiders', async () => {
    const t = await team();
    for (const user of [t.accountant, t.staff, t.viewer]) {
      await expect(save(user, t.company, true)).rejects.toThrow(/almail:permission/);
    }
    await expect(save(t.outsider, t.company, true)).rejects.toThrow(/almail:permission/);
    await expect(settings(t.outsider, t.company)).rejects.toThrow(/almail:not_member/);
    await expect(h.rpc(null, 'email_alert_settings', { p_company: t.company })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('are only reached through the functions, never the table', async () => {
    const t = await team();
    await save(t.owner, t.company, true);
    for (const user of [t.owner, t.staff, null]) {
      await expect(h.as(user, (q) => q('select * from public.email_alerts'))).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(
      h.as(t.owner, (q) =>
        q(`insert into public.email_alerts (company_id, user_id, enabled) values ($1, $2, true)`, [
          t.company,
          t.staff,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(t.owner, (q) => q('select * from almailbooks.email_alerts_config')),
    ).rejects.toThrow(/permission denied/);
    await expect(h.as(t.owner, (q) => q('select almailbooks.run_email_alerts()'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('need a known kind of alert, and at least one to be on', async () => {
    const t = await team();
    await expect(save(t.owner, t.company, true, ['documents', 'gossip'])).rejects.toThrow(
      /almail:invalid/,
    );
    await expect(save(t.owner, t.company, true, [])).rejects.toThrow(/almail:invalid/);
    expect(await save(t.owner, t.company, false, [])).toMatchObject({ enabled: false, topics: [] });
  });

  it('keep the address of the app only when it is a web address', async () => {
    const t = await team();
    await save(t.owner, t.company, true, ALL, 'javascript:alert(1)');
    expect((await stored(t.company, t.owner))[0].app_url).toBe('');
    await save(t.owner, t.company, true, ALL, 'https://maham.example.com/');
    // Saved again from somewhere unknown: the address stays.
    await save(t.owner, t.company, true, ALL, '');
    expect((await stored(t.company, t.owner))[0].app_url).toBe('https://maham.example.com/');
  });

  it('start afresh when turned on again', async () => {
    const t = await team();
    await save(t.owner, t.company, true);
    await h.admin(
      `update public.email_alerts set sent_keys = '["invoice:1:overdue"]', checked_on = '2026-10-05',
         last_error = 'Domain not verified', last_error_at = now()
       where company_id = $1 and user_id = $2`,
      [t.company, t.owner],
    );
    // Saving while on keeps what was sent.
    await save(t.owner, t.company, true, ['invoices']);
    expect((await stored(t.company, t.owner))[0]).toMatchObject({
      sent_keys: ['invoice:1:overdue'],
      checked_on: '2026-10-05',
    });
    expect((await settings(t.owner, t.company)).last_error).toBe('Domain not verified');
    // Off clears the problem; on again starts from the beginning.
    expect(await save(t.owner, t.company, false)).toMatchObject({ last_error: '' });
    await save(t.owner, t.company, true);
    expect((await stored(t.company, t.owner))[0]).toMatchObject({
      sent_keys: null,
      checked_on: null,
    });
  });

  it('stop for people who are no longer an owner or admin', async () => {
    const t = await team();
    await save(t.owner, t.company, true);
    await save(t.admin, t.company, true);
    await h.rpc(t.owner, 'set_member_role', {
      p_company: t.company,
      p_user: t.admin,
      p_role: 'staff',
    });
    expect(await stored(t.company, t.admin)).toEqual([]);
    expect(await stored(t.company, t.owner)).toHaveLength(1);

    const u = await team();
    await save(u.admin, u.company, true);
    await h.rpc(u.owner, 'remove_member', { p_company: u.company, p_user: u.admin });
    expect(await stored(u.company, u.admin)).toEqual([]);
    // An owner who hands the company over stays an admin, and keeps the email.
    await save(u.owner, u.company, true);
    const [invite] = await h.rpc<{ token: string }>(u.owner, 'create_invite', {
      p_company: u.company,
      p_email: 'new-admin-' + u.company + '@example.com',
      p_role: 'admin',
    });
    const next = await h.user('new-admin-' + u.company + '@example.com');
    await h.rpc(next, 'accept_invite', { p_token: invite.token });
    await h.rpc(u.owner, 'transfer_ownership', { p_company: u.company, p_user: next });
    expect(await stored(u.company, u.owner)).toHaveLength(1);
  });

  it('go when the company is deleted', async () => {
    const t = await team();
    await save(t.owner, t.company, true);
    await h.rpc(t.owner, 'delete_company', { p_company: t.company });
    expect(await stored(t.company, t.owner)).toEqual([]);
  });
});

describe('the hourly schedule', () => {
  const sent = () =>
    h.admin<{ url: string; body: unknown; headers: Record<string, string>; timeout_ms: number }>(
      'select * from net.sent',
    );
  const run = async () =>
    (await h.admin<{ id: string | null }>('select almailbooks.run_email_alerts()::text as id'))[0]
      .id;

  it('calls the function with the secret once the function is known and someone wants email', async () => {
    await h.admin(`update almailbooks.email_alerts_config set function_url = ''`);
    await h.admin(`update public.email_alerts set enabled = false`);
    await h.admin('delete from net.sent');
    const t = await team();

    // The function hasn't run yet: its address isn't known.
    await save(t.owner, t.company, true);
    expect(await run()).toBeNull();
    expect((await settings(t.owner, t.company)).function_ready).toBe(false);

    const url = 'https://project.supabase.co/functions/v1/email-alerts';
    await h.admin('update almailbooks.email_alerts_config set function_url = $1', [url]);
    expect((await settings(t.owner, t.company)).function_ready).toBe(true);
    expect(await run()).toBe('1');
    const [config] = await h.admin<{ secret: string }>(
      'select secret from almailbooks.email_alerts_config',
    );
    expect(config.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await sent()).toEqual([
      {
        url,
        body: { action: 'run' },
        headers: { 'Content-Type': 'application/json', 'x-alerts-secret': config.secret },
        timeout_ms: 120000,
      },
    ]);

    // Nobody wants email: the function isn't woken.
    await save(t.owner, t.company, false);
    await h.admin('delete from net.sent');
    expect(await run()).toBeNull();
    expect(await sent()).toEqual([]);
  });

  it('keeps the secret when the script runs again', async () => {
    const [before] = await h.admin<{ secret: string }>(
      'select secret from almailbooks.email_alerts_config',
    );
    const { readFileSync } = await import('node:fs');
    const { MIGRATIONS } = await import('./sql-harness');
    await h.db.exec(readFileSync(MIGRATIONS[MIGRATIONS.length - 1], 'utf8'));
    const rows = await h.admin<{ secret: string }>(
      'select secret from almailbooks.email_alerts_config',
    );
    expect(rows).toEqual([before]);
  });
});
