// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, startDatabase, type Harness } from './sql-harness';
import type { MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';

/**
 * Salary approval by the Super Admin (#10) in
 * 20261130000000_people_alerts.sql: with the owner's switch on, records_guard
 * keeps a pay run's request honest (approved only as it was sent, never by an
 * approver who sent it unless they are the owner, marked done by whoever
 * posts the run) and a trigger asks the email-alerts function to email the
 * approvers. Without the switch every push is answered as before. pg_net is a
 * stand-in here that records the requests it would send. Made-up data only.
 */

const FILE = MIGRATIONS.find((file) => file.endsWith('_people_alerts.sql'))!;

const NET_STUB = `
  create schema if not exists net;
  create table if not exists net.sent (url text, body jsonb, headers jsonb, timeout_ms integer);
  create or replace function net.http_post(
    url text,
    body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb,
    timeout_milliseconds integer default 5000
  ) returns bigint language sql as $$
    insert into net.sent values (url, body, headers, timeout_milliseconds) returning 1::bigint
  $$;
`;

const FUNCTION_URL = 'https://project.supabase.co/functions/v1/email-alerts';

let h: Harness;
let seq = 0;

beforeAll(async () => {
  // Each file twice, this one after the Phase 3 files: running it again must be safe.
  h = await startDatabase(2);
  await h.db.exec(NET_STUB);
  await h.admin(`update almailbooks.email_alerts_config set function_url = $1 where id`, [
    FUNCTION_URL,
  ]);
}, 90_000);

const json = (value: unknown) => JSON.stringify(value);
type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean };

/** A company with an owner, two admins and an accountant (who may be made approvers), staff and a viewer. */
async function team(db: Harness = h) {
  seq += 1;
  const company = `pay-co-${String(seq).padStart(4, '0')}`;
  const tag = `pay-${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await db.user(`owner-${tag}@example.com`);
  await db.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${seq}` });
  const members: Record<string, string> = {};
  for (const [key, role] of [
    ['admin', 'admin'],
    ['deputy', 'admin'],
    ['accountant', 'accountant'],
    ['staff', 'staff'],
    ['viewer', 'viewer'],
  ]) {
    const email = `${key}-${tag}@example.com`;
    members[key] = await db.user(email);
    const [invite] = await db.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: company,
      p_email: email,
      p_role: role,
    });
    await db.rpc(members[key], 'accept_invite', { p_token: invite.token });
  }
  await push(
    owner,
    company,
    [{ tbl: 'companies', id: company, data: { id: company, name: 'Co' } }],
    db,
  );
  const { admin, deputy, accountant, staff, viewer } = members;
  return { company, owner, admin, deputy, accountant, staff, viewer };
}

type Team = Awaited<ReturnType<typeof team>>;

function push(user: string, company: string, changes: Change[], db: Harness = h) {
  return db.rpc<{ tbl: string; id: string; rev: number }>(user, 'push_records', {
    p_company: company,
    p_changes: json(changes),
  });
}

async function stored(company: string, tbl: string, id: string, db: Harness = h) {
  const [row] = await db.admin<{ data: Record<string, unknown> }>(
    'select data from public.records where company_id = $1 and tbl = $2 and id = $3',
    [company, tbl, id],
  );
  return row?.data;
}

async function allowToApprove(t: Team, user: string, db: Harness = h, permissions = {}) {
  await db.rpc(t.owner, 'set_member_permissions', {
    p_company: t.company,
    p_user: user,
    p_permissions: json(permissions),
    p_can_approve: true,
  });
}

async function rulesOn(t: Team, rules: Record<string, unknown> = { payroll: true }, db = h) {
  await push(
    t.owner,
    t.company,
    [
      {
        tbl: 'companies',
        id: t.company,
        data: { id: t.company, name: 'Co', approvalRules: rules },
      },
    ],
    db,
  );
}

const STAMP = '2026-10-20T08:00:00.000Z';

/** A draft pay run, as the app stores it (lines left out: the server never reads them). */
function payRun(c: string, id: string, updatedAt = STAMP, extra: Record<string, unknown> = {}) {
  return {
    tbl: 'payRuns',
    id,
    data: { id, companyId: c, period: '2026-09', status: 'draft', lines: [], updatedAt, ...extra },
  };
}

/** A request for the pay run's approval, as the app makes it. */
function request(c: string, id: string, run: string, extra: Record<string, unknown> = {}) {
  return {
    tbl: 'approvals',
    id,
    data: {
      id,
      companyId: c,
      kind: 'payroll',
      subjectTbl: 'payRuns',
      subjectId: run,
      subjectNumber: '2026-09',
      before: null,
      after: {
        runUpdatedAt: STAMP,
        period: '2026-09',
        currency: 'KWD',
        totals: {
          employees: 3,
          gross: 1380,
          deductions: 0,
          net: 1380,
          pifssEmployer: 0,
          cost: 1380,
        },
        groups: [],
      },
      reason: '',
      status: 'pending',
      requestedBy: '',
      requestedAt: STAMP,
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      createdAt: STAMP,
      updatedAt: STAMP,
      ...extra,
    },
  };
}

/** The request as stored, changed. */
async function decide(t: Team, user: string, id: string, extra: Record<string, unknown>) {
  const data = await stored(t.company, 'approvals', id);
  return push(user, t.company, [{ tbl: 'approvals', id, data: { ...data, ...extra } }]);
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; message?: string }) =>
      e.code === '42501' ? (/invalid/.test(e.message ?? '') ? 'stale' : 'refused') : String(e),
  );

async function sent(company?: string) {
  const rows = await h.admin<{ url: string; body: Record<string, unknown> }>(
    'select * from net.sent',
  );
  return company ? rows.filter((r) => r.body.companyId === company) : rows;
}

async function emails(company: string, approval: string, db: Harness = h) {
  return db.admin<{ user_id: string; sent_at: string | null }>(
    `select user_id::text as user_id, sent_at
       from almailbooks.approval_emails where company_id = $1 and approval_id = $2
      order by user_id`,
    [company, approval],
  );
}

/* -------------------------------------------------------------------------- */

describe('the file', () => {
  it('stops at once, changing nothing, without the change feed file', async () => {
    const early = await startDatabase(1, MIGRATIONS.indexOf(FILE) - 1);
    await expect(early.db.exec(readFileSync(FILE, 'utf8'))).rejects.toThrow(
      /Run 20261123000000_change_feed\.sql first/,
    );
    const [row] = await early.admin<{ exists: boolean }>(
      `select to_regclass('almailbooks.approval_emails') is not null as exists`,
    );
    expect(row.exists).toBe(false);
  }, 60_000);

  it('names payroll_approvals with everything the earlier files name', async () => {
    const user = await h.user(`features-${Math.random().toString(36).slice(2)}@example.com`);
    const [row] = await h.rpc<{ server_features: string[] }>(user, 'server_features');
    expect(row.server_features).toEqual([
      'tables_v16',
      'super_admin',
      'approvals',
      'cheque_approvals',
      'change_feed',
      'payroll_approvals',
      'document_alerts',
    ]);
    const early = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    const someone = await early.user('people-early@example.com');
    const [before] = await early.rpc<{ server_features: string[] }>(someone, 'server_features');
    expect(before.server_features).not.toContain('payroll_approvals');
  }, 60_000);
});

describe('with salary approval off', () => {
  it('answers pay run requests exactly as before', async () => {
    const before = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    await before.db.exec(NET_STUB);
    const outcomes: string[][] = [];
    for (const db of [before, h]) {
      const t = await team(db);
      const c = t.company;
      await allowToApprove(t, t.deputy, db);
      // Invoice rules on, salary approval off.
      await rulesOn(t, { documentTypes: ['invoice'] }, db);
      const results: string[] = [];
      const r = (p: Promise<unknown>) =>
        p.then(
          () => 'ok',
          (e: { message?: string }) => e.message ?? 'refused',
        );
      await push(t.accountant, c, [payRun(c, 'run-1')], db);
      // A deputy approves their own; the run changes after it is sent.
      results.push(await r(push(t.deputy, c, [request(c, 'req-1', 'run-1')], db)));
      await push(t.accountant, c, [payRun(c, 'run-1', '2026-10-21T08:00:00.000Z')], db);
      const asked = await stored(c, 'approvals', 'req-1', db);
      results.push(
        await r(
          push(
            t.deputy,
            c,
            [{ tbl: 'approvals', id: 'req-1', data: { ...asked, status: 'approved' } }],
            db,
          ),
        ),
      );
      // Whoever isn't an approver doesn't mark it done.
      const approved = await stored(c, 'approvals', 'req-1', db);
      results.push(
        await r(
          push(
            t.accountant,
            c,
            [{ tbl: 'approvals', id: 'req-1', data: { ...approved, status: 'applied' } }],
            db,
          ),
        ),
      );
      // A deputy's request sent up approved is theirs, as decided by them.
      results.push(
        await r(push(t.deputy, c, [request(c, 'req-2', 'run-1', { status: 'approved' })], db)),
      );
      const kept = await stored(c, 'approvals', 'req-2', db);
      results.push(String(kept?.status), String(kept?.decidedBy === t.deputy));
      // A pay run posts as before.
      results.push(
        await r(push(t.accountant, c, [payRun(c, 'run-1', STAMP, { status: 'approved' })], db)),
      );
      outcomes.push(results);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[1]).toEqual([
      'ok',
      'ok',
      expect.stringMatching(/Only an approver decides/),
      'ok',
      'approved',
      'true',
      'ok',
    ]);
  }, 90_000);

  it('emails nobody', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t, { documentTypes: ['invoice'] });
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    expect(await sent(c)).toEqual([]);
    expect(await emails(c, 'req-1')).toEqual([]);
  });
});

describe('with salary approval on', () => {
  it('stamps a new request as waiting, from whoever sends it, and emails the approvers but them', async () => {
    const t = await team();
    const c = t.company;
    await allowToApprove(t, t.deputy);
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1')]);
    await push(t.accountant, c, [
      request(c, 'req-1', 'run-1', { status: 'approved', requestedBy: t.owner }),
    ]);
    expect(await stored(c, 'approvals', 'req-1')).toMatchObject({
      status: 'pending',
      requestedBy: t.accountant,
      decidedBy: null,
    });
    // The owner and the deputy: not the accountant who sent it, nor the other admin.
    expect((await emails(c, 'req-1')).map((e) => e.user_id).sort()).toEqual(
      [t.owner, t.deputy].sort(),
    );
    // One call per request, with the secret, naming the request only.
    const [{ secret }] = await h.admin<{ secret: string }>(
      'select secret from almailbooks.email_alerts_config',
    );
    const calls = await h.admin<{ url: string; body: unknown; headers: Record<string, string> }>(
      `select * from net.sent where body ->> 'approvalId' = 'req-1' and body ->> 'companyId' = $1`,
      [c],
    );
    expect(calls).toEqual([
      {
        url: FUNCTION_URL,
        body: { action: 'payroll_approval', companyId: c, approvalId: 'req-1' },
        headers: { 'Content-Type': 'application/json', 'x-alerts-secret': secret },
        timeout_ms: 60000,
      },
    ]);
    // Sent again (an upsert of the same request): no second email.
    const again = await stored(c, 'approvals', 'req-1');
    await push(t.accountant, c, [{ tbl: 'approvals', id: 'req-1', data: again }]);
    expect(await sent(c)).toHaveLength(1);
  });

  it('a deputy’s request emails the owner and the other approvers, and one the owner gave no access to People is left out', async () => {
    const t = await team();
    const c = t.company;
    await allowToApprove(t, t.deputy);
    await allowToApprove(t, t.accountant, h, { apps: { people: 'none' } });
    await rulesOn(t);
    await push(t.deputy, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    expect((await emails(c, 'req-1')).map((e) => e.user_id)).toEqual([t.owner]);
  });

  it('approves a pay run only as it was sent', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    // Changed after it was sent: the owner's approval is refused.
    await push(t.accountant, c, [payRun(c, 'run-1', '2026-10-21T08:00:00.000Z')]);
    expect(await refusal(decide(t, t.owner, 'req-1', { status: 'approved' }))).toBe('stale');
    // Rejecting it is fine.
    expect(await refusal(decide(t, t.owner, 'req-1', { status: 'rejected' }))).toBe('ok');
    // Sent again for the run as it is: approved.
    await push(t.accountant, c, [
      request(c, 'req-2', 'run-1', {
        after: { runUpdatedAt: '2026-10-21T08:00:00.000Z', totals: {}, groups: [] },
      }),
    ]);
    expect(await refusal(decide(t, t.owner, 'req-2', { status: 'approved' }))).toBe('ok');
    expect(await stored(c, 'approvals', 'req-2')).toMatchObject({
      status: 'approved',
      decidedBy: t.owner,
    });
    // A request for a pay run the cloud doesn't have isn't approved either.
    await push(t.accountant, c, [request(c, 'req-3', 'run-missing')]);
    expect(await refusal(decide(t, t.owner, 'req-3', { status: 'approved' }))).toBe('stale');
  });

  it('a deputy never approves their own; another approver or the owner does, and the owner their own', async () => {
    const t = await team();
    const c = t.company;
    await allowToApprove(t, t.deputy);
    await allowToApprove(t, t.accountant);
    await rulesOn(t);
    await push(t.deputy, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    expect(await refusal(decide(t, t.deputy, 'req-1', { status: 'approved' }))).toBe('refused');
    // Nor straight to done.
    expect(await refusal(decide(t, t.deputy, 'req-1', { status: 'applied' }))).toBe('refused');
    // Sent up already approved by them: it waits.
    await push(t.deputy, c, [request(c, 'req-2', 'run-1', { status: 'approved' })]);
    expect(await stored(c, 'approvals', 'req-2')).toMatchObject({
      status: 'pending',
      requestedBy: t.deputy,
    });
    // The other approver may.
    expect(await refusal(decide(t, t.accountant, 'req-1', { status: 'approved' }))).toBe('ok');
    // They may still turn down their own.
    expect(await refusal(decide(t, t.deputy, 'req-2', { status: 'rejected' }))).toBe('ok');
    // The owner approves their own.
    await push(t.owner, c, [request(c, 'req-3', 'run-1')]);
    expect(await refusal(decide(t, t.owner, 'req-3', { status: 'approved' }))).toBe('ok');
  });

  it('whoever may post the pay run marks its approved request done; nobody else', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    // Not before it is approved.
    expect(await refusal(decide(t, t.accountant, 'req-1', { status: 'applied' }))).toBe('refused');
    await decide(t, t.owner, 'req-1', { status: 'approved', decisionNote: 'Fine.' });
    // Posted: the run changed since, which no longer matters.
    await push(t.accountant, c, [
      payRun(c, 'run-1', '2026-10-22T08:00:00.000Z', { status: 'approved' }),
    ]);
    for (const user of [t.staff, t.viewer]) {
      expect(await refusal(decide(t, user, 'req-1', { status: 'applied' }))).toBe('refused');
    }
    expect(
      await refusal(decide(t, t.accountant, 'req-1', { status: 'applied', decisionNote: 'Mine' })),
    ).toBe('ok');
    expect(await stored(c, 'approvals', 'req-1')).toMatchObject({
      status: 'applied',
      decidedBy: t.owner,
      decisionNote: 'Fine.',
    });
    // Done stays done, whatever an older copy says.
    await decide(t, t.accountant, 'req-1', { status: 'approved' });
    expect(await stored(c, 'approvals', 'req-1')).toMatchObject({ status: 'applied' });
  });

  it('the owner who posts the pay run carries out a waiting request as it is', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    await push(t.owner, c, [
      payRun(c, 'run-1', '2026-10-22T08:00:00.000Z', { status: 'approved' }),
    ]);
    expect(await refusal(decide(t, t.owner, 'req-1', { status: 'applied' }))).toBe('ok');
    expect(await stored(c, 'approvals', 'req-1')).toMatchObject({
      status: 'applied',
      decidedBy: t.owner,
    });
  });

  it('keeps the request private: staff and viewers never read it, nor send one', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    for (const user of [t.staff, t.viewer]) {
      const rows = await h.rpc<{ tbl: string; id: string }>(user, 'pull_records', {
        p_company: c,
        p_since: 0,
      });
      expect(rows.filter((r) => r.tbl === 'approvals' || r.tbl === 'payRuns')).toEqual([]);
    }
    expect(await refusal(push(t.staff, c, [request(c, 'req-2', 'run-1')]))).toBe('refused');
    expect(await refusal(push(t.viewer, c, [request(c, 'req-3', 'run-1')]))).toBe('refused');
    const rows = await h.rpc<{ tbl: string; id: string }>(t.accountant, 'pull_records', {
      p_company: c,
      p_since: 0,
    });
    expect(rows.some((r) => r.tbl === 'approvals' && r.id === 'req-1')).toBe(true);
  });

  it('never deletes a request', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    for (const user of [t.owner, t.accountant]) {
      expect(await refusal(push(user, c, [{ tbl: 'approvals', id: 'req-1', deleted: true }]))).toBe(
        'refused',
      );
    }
  });

  it('takes an older version’s pushes: an older copy can’t undo a decision, and a pay run posts as it always did', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    const waiting = await stored(c, 'approvals', 'req-1');
    await decide(t, t.owner, 'req-1', { status: 'approved' });
    // The accountant's older copy, still waiting, sent again.
    await push(t.accountant, c, [{ tbl: 'approvals', id: 'req-1', data: waiting }]);
    expect(await stored(c, 'approvals', 'req-1')).toMatchObject({ status: 'approved' });
    // An older version posts a pay run without asking: the cloud takes it
    // (the app asks first; its entries would come anyway).
    expect(
      await refusal(push(t.accountant, c, [payRun(c, 'run-2', STAMP, { status: 'approved' })])),
    ).toBe('ok');
  });

  it('never stops a push without pg_net or the email function', async () => {
    const bare = await startDatabase(1);
    const t = await team(bare);
    const c = t.company;
    await rulesOn(t, { payroll: true }, bare);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')], bare);
    expect(await stored(c, 'approvals', 'req-1', bare)).toMatchObject({ status: 'pending' });
    // Noted for the schedule, which asks once the function is there.
    expect((await emails(c, 'req-1', bare)).map((e) => e.user_id)).toEqual([t.owner]);
  }, 60_000);
});

describe('the 5-minute schedule', () => {
  const run = async () =>
    (
      await h.admin<{ id: string | null }>(
        'select almailbooks.run_change_notifications()::text as id',
      )
    )[0].id;

  it('asks the function again while a pay run’s approval email hasn’t gone', async () => {
    await h.admin('update public.notification_settings set enabled = false');
    await h.admin('update almailbooks.approval_emails set finished_at = now()');
    expect(await run()).toBeNull();
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [payRun(c, 'run-1'), request(c, 'req-1', 'run-1')]);
    await h.admin('delete from net.sent');
    expect(await run()).toBe('1');
    const [call] = await sent();
    expect(call.body).toEqual({ action: 'notify' });
    // Sent, or tried five times, or three days old: nothing more to do.
    await h.admin(`update almailbooks.approval_emails set attempts = 5 where company_id = $1`, [c]);
    expect(await run()).toBeNull();
    await h.admin(
      `update almailbooks.approval_emails set attempts = 0, created_at = now() - interval '4 days'
        where company_id = $1`,
      [c],
    );
    expect(await run()).toBeNull();
    await expect(
      h.as(t.owner, (q) => q('select almailbooks.run_change_notifications()')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(t.owner, (q) => q('select * from almailbooks.approval_emails')),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the app’s stand-ins for the cloud', () => {
  it('answer pay run requests as the server does', async () => {
    const t = await team();
    const c = t.company;
    await allowToApprove(t, t.deputy);
    const fake = new FakeCloud();
    fake.features = [
      'tables_v16',
      'super_admin',
      'approvals',
      'cheque_approvals',
      'change_feed',
      'payroll_approvals',
    ];
    fake.companies.set(c, { id: c, name: 'Company', purgedUntilRev: 0, createdAt: '' });
    const users: Record<string, [string, MemberRole]> = {
      owner: [t.owner, 'owner'],
      admin: [t.admin, 'admin'],
      deputy: [t.deputy, 'admin'],
      accountant: [t.accountant, 'accountant'],
      staff: [t.staff, 'staff'],
      viewer: [t.viewer, 'viewer'],
    };
    for (const [user, role] of Object.values(users)) fake.addMember(c, user, role);
    fake.setAccess(c, t.deputy, {}, true);
    const both = async (user: string, changes: Change[]) => {
      const inSql = await refusal(push(user, c, changes));
      const inFake = await fake
        .client(user)
        .pushRecords(c, changes as never)
        .then(
          () => 'ok',
          (e: { code?: string }) =>
            e.code === 'invalid' ? 'stale' : e.code === 'permission' ? 'refused' : String(e.code),
        );
      return `${inFake} ${inSql}`;
    };
    const asStored = async (id: string, extra: Record<string, unknown>) => ({
      tbl: 'approvals',
      id,
      data: { ...(await stored(c, 'approvals', id)), ...extra },
    });
    const sameStatus = async (id: string) =>
      expect(fake.record(c, 'approvals', id)?.status).toBe(
        (await stored(c, 'approvals', id))?.status,
      );
    const seen = new Set<string>();
    let n = 0;
    for (const rules of [{ documentTypes: ['invoice'] }, { payroll: true }]) {
      const company = {
        tbl: 'companies',
        id: c,
        data: { id: c, name: 'Co', approvalRules: rules },
      };
      expect(await both(t.owner, [company])).toBe('ok ok');
      for (const [sender] of [users.accountant, users.deputy, users.owner]) {
        for (const [key, [decider]] of Object.entries(users)) {
          for (const changed of [false, true]) {
            n += 1;
            const run = `run-${n}`;
            expect(await both(t.accountant, [payRun(c, run)])).toBe('ok ok');
            expect(await both(sender, [request(c, `req-${n}`, run)])).toBe('ok ok');
            await sameStatus(`req-${n}`);
            // Approved as sent, or after the run changed.
            if (changed) {
              expect(await both(t.accountant, [payRun(c, run, '2026-10-21T08:00:00.000Z')])).toBe(
                'ok ok',
              );
            }
            const decided = await both(decider, [
              await asStored(`req-${n}`, { status: 'approved' }),
            ]);
            const [inFake, inSql] = decided.split(' ');
            expect(`${key} ${changed} ${inFake}`).toBe(`${key} ${changed} ${inSql}`);
            seen.add(`${rules.payroll ? 'on' : 'off'} ${inSql}`);
            await sameStatus(`req-${n}`);
            // Marked done by whoever may post it.
            const done = await both(t.accountant, [
              await asStored(`req-${n}`, { status: 'applied' }),
            ]);
            expect(done.split(' ')[0]).toBe(done.split(' ')[1]);
            await sameStatus(`req-${n}`);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['off ok', 'off refused', 'on ok', 'on refused', 'on stale']);
  }, 120_000);
});
