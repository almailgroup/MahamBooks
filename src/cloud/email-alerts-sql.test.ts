// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, startDatabase, type Harness } from './sql-harness';

const MIGRATION_COUNT = MIGRATIONS.length;

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

  it('are refused to staff, viewers and outsiders', async () => {
    const t = await team();
    for (const user of [t.staff, t.viewer]) {
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

  it('stop for people who are no longer an owner, admin or accountant', async () => {
    const t = await team();
    await save(t.owner, t.company, true);
    await save(t.admin, t.company, true);
    await save(t.accountant, t.company, true);
    // An admin made an accountant keeps them (#18).
    await h.rpc(t.owner, 'set_member_role', {
      p_company: t.company,
      p_user: t.admin,
      p_role: 'accountant',
    });
    expect(await stored(t.company, t.admin)).toHaveLength(1);
    await h.rpc(t.owner, 'set_member_role', {
      p_company: t.company,
      p_user: t.admin,
      p_role: 'staff',
    });
    await h.rpc(t.owner, 'set_member_role', {
      p_company: t.company,
      p_user: t.accountant,
      p_role: 'viewer',
    });
    expect(await stored(t.company, t.admin)).toEqual([]);
    expect(await stored(t.company, t.accountant)).toEqual([]);
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
    const script = MIGRATIONS.find((file) => file.endsWith('_email_alerts.sql'))!;
    await h.db.exec(readFileSync(script, 'utf8'));
    const rows = await h.admin<{ secret: string }>(
      'select secret from almailbooks.email_alerts_config',
    );
    expect(rows).toEqual([before]);
  });
});

/* -------------------------------------------------------------------------- */
/* Expiry alerts (#18, 20261130000000_people_alerts.sql)                      */
/* -------------------------------------------------------------------------- */

describe('expiry alerts (#18)', () => {
  let x: Harness;
  let before: Harness;

  beforeAll(async () => {
    // Every script twice, this one after the Phase 3 ones; and a database
    // without it, as production is until the owner runs it.
    [x, before] = await Promise.all([startDatabase(2), startDatabase(1, MIGRATION_COUNT - 1)]);
    for (const d of [x, before]) {
      await d.db.exec(`
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
    }
  }, 120_000);

  let n = 0;
  async function crew(d: Harness) {
    n += 1;
    const company = `expiry-co-${String(n).padStart(4, '0')}`;
    const tag = `x${n}-${Math.random().toString(36).slice(2, 8)}`;
    const owner = await d.user(`owner-${tag}@example.com`);
    await d.rpc(owner, 'create_company', { p_id: company, p_name: `Expiry ${n}` });
    const others: Record<string, string> = {};
    for (const role of ['admin', 'accountant', 'staff', 'viewer']) {
      const email = `${role}-${tag}@example.com`;
      others[role] = await d.user(email);
      const [invite] = await d.rpc<{ token: string }>(owner, 'create_invite', {
        p_company: company,
        p_email: email,
        p_role: role,
      });
      await d.rpc(others[role], 'accept_invite', { p_token: invite.token });
    }
    return { company, owner, ...others, outsider: await d.user(`out-${tag}@example.com`) } as {
      company: string;
      owner: string;
      admin: string;
      accountant: string;
      staff: string;
      viewer: string;
      outsider: string;
    };
  }
  const subscribe = (d: Harness, user: string, company: string, enabled = true) =>
    d.rpc<{ enabled: boolean; topics: string[] }>(user, 'set_email_alerts', {
      p_company: company,
      p_enabled: enabled,
      p_topics: ALL,
      p_app_url: 'https://app.example.com/',
    });
  const scope = async (d: Harness, user: string, company: string) =>
    (
      await d.rpc<{ document_kinds: string[] | null }>(user, 'email_alert_scope', {
        p_company: company,
      })
    )[0].document_kinds;
  const choose = (d: Harness, user: string, company: string, kinds: string[] | null) =>
    d.rpc(user, 'set_email_alert_scope', { p_company: company, p_kinds: kinds });
  const code = (promise: Promise<unknown>) =>
    promise.then(
      () => 'ok',
      (e: { code?: string }) => e.code ?? 'error',
    );

  it('let accountants get the morning email, as owners and admins', async () => {
    const t = await crew(x);
    expect(await subscribe(x, t.accountant, t.company)).toMatchObject([
      { enabled: true, topics: ALL },
    ]);
    for (const user of [t.staff, t.viewer, t.outsider]) {
      expect(await code(subscribe(x, user, t.company))).toBe('42501');
    }
  });

  it('are refused to accountants before the script runs', async () => {
    const t = await crew(before);
    expect(await code(subscribe(before, t.accountant, t.company))).toBe('42501');
    expect(await code(subscribe(before, t.admin, t.company))).toBe('ok');
    await expect(scope(before, t.owner, t.company)).rejects.toThrow(/email_alert_scope/);
    const [{ features }] = await before.admin<{ features: string[] }>(
      'select public.server_features() as features',
    );
    expect(features).not.toContain('document_alerts');
  });

  it('let owners, admins and accountants choose the kinds of paper', async () => {
    const t = await crew(x);
    // Every kind until chosen.
    expect(await scope(x, t.owner, t.company)).toBeNull();
    await choose(x, t.owner, t.company, ['staff', 'company', 'staff']);
    expect(await scope(x, t.owner, t.company)).toEqual(['company', 'staff']);
    // One person's choice is theirs alone.
    expect(await scope(x, t.admin, t.company)).toBeNull();
    await choose(x, t.accountant, t.company, ['vehicle']);
    expect(await scope(x, t.accountant, t.company)).toEqual(['vehicle']);
    // All four, or null, is every kind.
    await choose(x, t.owner, t.company, ['client', 'vehicle', 'staff', 'company']);
    expect(await scope(x, t.owner, t.company)).toBeNull();
    await choose(x, t.accountant, t.company, null);
    expect(await scope(x, t.accountant, t.company)).toBeNull();
    // Choosing before turning the email on keeps it off.
    const [row] = await x.admin<{ enabled: boolean; document_kinds: string[] | null }>(
      'select enabled, document_kinds from public.email_alerts where company_id = $1 and user_id = $2',
      [t.company, t.owner],
    );
    expect(row).toEqual({ enabled: false, document_kinds: null });
  });

  it('refuse staff, viewers, outsiders and unknown kinds with 42501', async () => {
    const t = await crew(x);
    for (const user of [t.staff, t.viewer, t.outsider]) {
      expect(await code(choose(x, user, t.company, ['company']))).toBe('42501');
    }
    expect(await code(choose(x, t.owner, t.company, ['company', 'payroll']))).toBe('42501');
    expect(await code(choose(x, t.owner, t.company, ['company', null as unknown as string]))).toBe(
      '42501',
    );
    expect(await code(choose(x, t.owner, t.company, []))).toBe('22023');
    expect(await code(scope(x, t.outsider, t.company))).toBe('42501');
    // The table itself stays closed, the new column too.
    await expect(
      x.as(t.owner, (q) => q('select document_kinds from public.email_alerts')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      x.admin(
        `insert into public.email_alerts (company_id, user_id, document_kinds) values ($1, $2, '{gossip}')`,
        [t.company, t.admin],
      ),
    ).rejects.toThrow(/document_kinds_check/);
  });

  it("keep the kinds when an older version of the app saves the email's settings", async () => {
    const t = await crew(x);
    await choose(x, t.admin, t.company, ['staff']);
    await subscribe(x, t.admin, t.company);
    await subscribe(x, t.admin, t.company, false);
    expect(await scope(x, t.admin, t.company)).toEqual(['staff']);
  });

  it('keep what was chosen when the script runs again', async () => {
    const t = await crew(x);
    await choose(x, t.owner, t.company, ['company']);
    const { readFileSync } = await import('node:fs');
    const { MIGRATIONS } = await import('./sql-harness');
    await x.db.exec(readFileSync(MIGRATIONS[MIGRATIONS.length - 1], 'utf8'));
    expect(await scope(x, t.owner, t.company)).toEqual(['company']);
    const [{ features }] = await x.admin<{ features: string[] }>(
      'select public.server_features() as features',
    );
    expect(features).toEqual([
      'tables_v16',
      'super_admin',
      'approvals',
      'cheque_approvals',
      'change_feed',
      'payroll_approvals',
      'document_alerts',
      'employee_letters',
    ]);
  });

  it('stop for an accountant who becomes staff, kinds and all', async () => {
    const t = await crew(x);
    await subscribe(x, t.accountant, t.company);
    await choose(x, t.accountant, t.company, ['staff']);
    await x.rpc(t.owner, 'set_member_role', {
      p_company: t.company,
      p_user: t.accountant,
      p_role: 'staff',
    });
    const rows = await x.admin(
      'select 1 from public.email_alerts where company_id = $1 and user_id = $2',
      [t.company, t.accountant],
    );
    expect(rows).toEqual([]);
  });

  it('wake the function every hour for the reminders in Updates, only where they are wanted', async () => {
    const url = 'https://project.supabase.co/functions/v1/email-alerts';
    await x.admin('update almailbooks.email_alerts_config set function_url = $1', [url]);
    await x.admin('update public.email_alerts set enabled = false');
    await x.admin('update public.notification_settings set enabled = false');
    const run = async () =>
      (await x.admin<{ id: string | null }>('select almailbooks.run_email_alerts()::text as id'))[0]
        .id;
    expect(await run()).toBeNull();
    const t = await crew(x);
    await x.rpc(t.owner, 'set_change_notifications', {
      p_company: t.company,
      p_enabled: true,
      p_immediate_kinds: ['document'],
      p_digest: 'daily',
      p_app_url: 'https://app.example.com/',
    });
    // The changes of the team alone wake nothing here.
    expect(await run()).toBeNull();
    const settings = (extra: Record<string, unknown>) =>
      x.rpc(t.owner, 'push_records', {
        p_company: t.company,
        p_changes: JSON.stringify([
          {
            tbl: 'peopleSettings',
            id: t.company,
            data: {
              id: t.company,
              companyId: t.company,
              reminderDays: [60, 30, 7],
              updatedAt: new Date().toISOString(),
              ...extra,
            },
          },
        ]),
      });
    await settings({});
    expect(await run()).toBeNull();
    await settings({ expiryUpdates: true });
    expect(await run()).toBe('1');
    // Nobody there gets the changes any more.
    await x.rpc(t.owner, 'set_change_notifications', {
      p_company: t.company,
      p_enabled: false,
      p_immediate_kinds: ['document'],
      p_digest: 'daily',
      p_app_url: '',
    });
    expect(await run()).toBeNull();
  });

  it("answer as the app's test cloud does, role by role, with and without the script", async () => {
    const { FakeCloud } = await import('./testing/fake-cloud');
    for (const [d, features] of [
      [x, ['tables_v16', 'change_feed', 'payroll_approvals', 'document_alerts']],
      [before, ['tables_v16', 'change_feed', 'payroll_approvals']],
    ] as const) {
      const t = await crew(d);
      const fake = new FakeCloud();
      fake.features = [...features];
      fake.companies.set(t.company, {
        id: t.company,
        name: 'Co',
        purgedUntilRev: 0,
        createdAt: '',
      });
      const roles = {
        owner: t.owner,
        admin: t.admin,
        accountant: t.accountant,
        staff: t.staff,
        viewer: t.viewer,
      } as const;
      for (const [role, user] of Object.entries(roles)) {
        fake.addMember(t.company, user, role as 'owner');
      }
      for (const [role, user] of Object.entries(roles)) {
        const inSql = await code(subscribe(d, user, t.company));
        const inFake = await fake
          .client(user)
          .setEmailAlerts(t.company, { enabled: true, topics: ['documents'], appUrl: '' })
          .then(
            () => 'ok',
            (e: { code?: string }) => (e.code === 'permission' ? '42501' : String(e.code)),
          );
        expect(`${role} ${inFake}`).toBe(`${role} ${inSql}`);
        const scoped = await code(choose(d, user, t.company, ['staff']));
        const scopedFake = await fake
          .client(user)
          .setEmailAlertScope(t.company, ['staff'])
          .then(
            (done) => (done ? 'ok' : 'missing'),
            (e: { code?: string }) => (e.code === 'permission' ? '42501' : String(e.code)),
          );
        expect(`${role} ${scopedFake}`).toBe(
          `${role} ${(features as readonly string[]).includes('document_alerts') ? scoped : 'missing'}`,
        );
      }
    }
  }, 60_000);

  it('leave the reminders in Updates out of the 5-minute emails of the changes', async () => {
    await x.admin('update public.notification_settings set enabled = false');
    await x.admin('update almailbooks.approval_emails set finished_at = now()');
    const run = async () =>
      (
        await x.admin<{ id: string | null }>(
          'select almailbooks.run_change_notifications()::text as id',
        )
      )[0].id;
    const t = await crew(x);
    await x.rpc(t.owner, 'set_change_notifications', {
      p_company: t.company,
      p_enabled: true,
      p_immediate_kinds: ['document'],
      p_digest: 'daily',
      p_app_url: 'https://app.example.com/',
    });
    expect(await run()).toBeNull();
    await x.admin(
      `insert into public.change_events (company_id, actor, op, tbl, record_id, kind, private, fold_key, summary)
       values ($1, null, 'update', 'complianceDocuments', 'licence', 'document_expiry', false, $2, '{}')`,
      [t.company, `expiry:${t.company}:licence`],
    );
    expect(await run()).toBeNull();
    // Any other change still wakes it.
    await x.rpc(t.admin, 'push_records', {
      p_company: t.company,
      p_changes: JSON.stringify([
        {
          tbl: 'clients',
          id: 'client-1',
          data: { id: 'client-1', companyId: t.company, name: 'Made-up Client' },
        },
      ]),
    });
    expect(await run()).toBe('1');
  });
});
