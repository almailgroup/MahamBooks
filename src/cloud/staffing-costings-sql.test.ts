// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION, MIGRATIONS, startDatabase, type Harness } from './sql-harness';
import { changeKind } from './change-feed';
import { isPrivateRecord, recordApp, type MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';

/**
 * 20261207000000_staffing_costings.sql: manpower costings (#3) are a kind of
 * record the cloud takes, private like payroll: staff and viewers never read
 * or store them or their activity, even when an earlier file is run again;
 * a member the owner kept out of Maham People doesn't store them; and every
 * push an older version of the app makes is answered as before. Made-up data
 * only.
 */

const FILE = MIGRATIONS.find((file) => file.endsWith('_staffing_costings.sql'))!;
const V16 = MIGRATIONS.find((file) => file.endsWith('_tables_v16.sql'))!;

let h: Harness;
let seq = 0;

beforeAll(async () => {
  // Each file twice, this one after every earlier one: running it again must be safe.
  h = await startDatabase(2);
}, 120_000);

const json = (value: unknown) => JSON.stringify(value);
type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean };

/** A company with an owner, an admin, two accountants, staff and a viewer. */
async function team(db: Harness = h) {
  seq += 1;
  const company = `cost-co-${String(seq).padStart(4, '0')}`;
  const tag = `cost-${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await db.user(`owner-${tag}@example.com`);
  await db.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${seq}` });
  const members: Record<string, string> = {};
  for (const [key, role] of [
    ['admin', 'admin'],
    ['accountant', 'accountant'],
    ['limited', 'accountant'],
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
  await push(owner, company, [{ tbl: 'companies', id: company, data: rec(company, company) }], db);
  const { admin, accountant, limited, staff, viewer } = members;
  return { company, owner, admin, accountant, limited, staff, viewer };
}

type Team = Awaited<ReturnType<typeof team>>;

function push(user: string, company: string, changes: Change[], db: Harness = h) {
  return db.rpc<{ tbl: string; id: string; rev: number }>(user, 'push_records', {
    p_company: company,
    p_changes: json(changes),
  });
}

function pull(user: string, company: string, since = 0, db: Harness = h) {
  return db.rpc<{ tbl: string; id: string; deleted: boolean }>(user, 'pull_records', {
    p_company: company,
    p_since: since,
    p_limit: 1000,
  });
}

const rec = (company: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  companyId: company,
  ...extra,
});

const STAMP = '2026-12-07T08:00:00.000Z';

/** A costing as the app saves it: invented posts, salaries and margin. */
function costing(c: string, id: string, extra: Record<string, unknown> = {}): Change {
  return {
    tbl: 'staffingCostings',
    id,
    data: rec(c, id, {
      name: 'Made-up tower, night shift',
      clientId: 'cl-1',
      quoteId: null,
      status: 'draft',
      posts: [
        {
          id: 'p1',
          jobTitle: 'Security Guard',
          category: 'expat',
          headcount: 6,
          hoursPerDay: 12,
          daysPerMonth: 26,
          basic: 137.25,
          allowances: 41.5,
          employerPifss: 0,
          eosiMonthly: 8.6,
          leaveMonthly: 17.188,
          otherCosts: 9.875,
          monthlyCost: 324.913,
          sellPrice: 420.476,
        },
      ],
      overheadPercent: 10,
      marginPercent: 15,
      notes: 'Internal',
      createdAt: STAMP,
      updatedAt: STAMP,
      ...extra,
    }),
  };
}

/** The activity of a costing, as an older server sees it (without the app's private mark). */
function costingActivity(c: string, id: string, entityId: string): Change {
  return {
    tbl: 'activities',
    id,
    data: rec(c, id, {
      entity: 'costing',
      entityId,
      action: 'created',
      message: 'Manpower costing created',
      at: STAMP,
    }),
  };
}

/** A quote made from a costing: an ordinary document, with sell prices only. */
function quote(c: string, id: string, costingId: string): Change {
  return {
    tbl: 'documents',
    id,
    data: rec(c, id, {
      type: 'quote',
      number: 'QT-0001',
      status: 'draft',
      clientId: 'cl-1',
      costingId,
      items: [{ id: 'l1', name: 'Security Guard', quantity: 6, unitPrice: 420.476 }],
    }),
  };
}

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; message?: string }) =>
      e.code === '42501'
        ? 'refused'
        : /records_tbl_check/.test(e.message ?? '')
          ? 'unknown kind'
          : String(e.message),
  );

async function visibleIds(user: string, company: string, db: Harness = h): Promise<Set<string>> {
  return new Set((await pull(user, company, 0, db)).map((r) => r.id));
}

async function selectedIds(user: string, company: string, db: Harness = h): Promise<string[]> {
  const rows = await db.as(user, (q) =>
    q<{ id: string }>(`select id from public.records where company_id = $1`, [company]),
  );
  return rows.map((r) => r.id);
}

async function listedIds(user: string, company: string, db: Harness = h): Promise<string[]> {
  const rows = await db.rpc<{ id: string }>(user, 'company_record_ids', { p_company: company });
  return rows.map((r) => r.id);
}

async function features(db: Harness): Promise<string[]> {
  const someone = await db.user(`f-${Math.random().toString(36).slice(2)}@example.com`);
  const [row] = await db.rpc<{ server_features: string[] }>(someone, 'server_features');
  return row.server_features;
}

/** The record_is_private an earlier file defines, as running it again would put it back. */
function recordIsPrivateOf(file: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf('create or replace function almailbooks.record_is_private');
  const end = source.indexOf('$$;', source.indexOf('as $$', start)) + 3;
  return source.slice(start, end);
}

/** A costing, its activity and a quote made from it, by the owner. */
async function seed(t: Team, db: Harness = h) {
  const c = t.company;
  await push(
    t.owner,
    c,
    [
      costing(c, 'cost-1', { quoteId: 'qt-1', status: 'quoted' }),
      costingActivity(c, 'act-cost', 'cost-1'),
      // About a costing that is gone: its entity alone says so.
      costingActivity(c, 'act-gone', 'cost-gone'),
      quote(c, 'qt-1', 'cost-1'),
      { tbl: 'activities', id: 'act-quote', data: rec(c, 'act-quote', { entity: 'quote' }) },
    ],
    db,
  );
}

const PRIVATE = ['cost-1', 'act-cost', 'act-gone'];
const OPEN = ['qt-1', 'act-quote'];

/* -------------------------------------------------------------------------- */

describe('the file', () => {
  it('stops at once, changing nothing, without the people alerts file', async () => {
    const early = await startDatabase(1, MIGRATIONS.indexOf(FILE) - 1);
    await expect(early.db.exec(readFileSync(FILE, 'utf8'))).rejects.toThrow(
      /Run 20261130000000_people_alerts\.sql first, then this file\./,
    );
    const t = await team(early);
    expect(await outcome(push(t.owner, t.company, [costing(t.company, 'x')], early))).toBe(
      'unknown kind',
    );
    expect(await features(early)).not.toContain('staffing_costings');
  }, 120_000);

  it('names staffing_costings with everything the earlier files name', async () => {
    expect(await features(h)).toEqual([
      'tables_v16',
      'super_admin',
      'approvals',
      'cheque_approvals',
      'change_feed',
      'payroll_approvals',
      'document_alerts',
      'employee_letters',
      'staffing_costings',
    ]);
  });

  it('is needed before the cloud takes a costing: until then it is refused, and nothing else', async () => {
    const before = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    const t = await team(before);
    const c = t.company;
    expect(await outcome(push(t.owner, c, [costing(c, 'cost-1')], before))).toBe('unknown kind');
    expect(await outcome(push(t.owner, c, [quote(c, 'qt-1', 'cost-1')], before))).toBe('ok');
    expect(await features(before)).not.toContain('staffing_costings');
    // Then the owner runs it, and the same costing goes through.
    await before.db.exec(readFileSync(FILE, 'utf8'));
    expect(await outcome(push(t.owner, c, [costing(c, 'cost-1')], before))).toBe('ok');
  }, 120_000);
});

describe('manpower costings', () => {
  let t: Team;
  beforeAll(async () => {
    t = await team();
    await seed(t);
  });

  it('are stored and read by owners, admins and accountants, with their activity', async () => {
    for (const [i, user] of [t.owner, t.admin, t.accountant].entries()) {
      const c = t.company;
      expect(
        await outcome(
          push(user, c, [costing(c, `cost-by-${i}`), costingActivity(c, `act-by-${i}`, 'x')]),
        ),
      ).toBe('ok');
      const ids = await visibleIds(user, c);
      for (const id of [...PRIVATE, ...OPEN]) expect(ids, id).toContain(id);
    }
  });

  it('are never read by staff or viewers, nor their activity', async () => {
    for (const user of [t.staff, t.viewer]) {
      const ids = await visibleIds(user, t.company);
      for (const id of PRIVATE) expect(ids, id).not.toContain(id);
      for (const id of OPEN) expect(ids, id).toContain(id);
      const direct = await selectedIds(user, t.company);
      for (const id of PRIVATE) expect(direct, id).not.toContain(id);
      const listed = await listedIds(user, t.company);
      for (const id of PRIVATE) expect(listed, id).not.toContain(id);
    }
  });

  it('are never stored by staff or viewers, nor their activity', async () => {
    const c = t.company;
    for (const user of [t.staff, t.viewer]) {
      expect(await outcome(push(user, c, [costing(c, 'cost-staff')]))).toBe('refused');
      expect(await outcome(push(user, c, [costingActivity(c, 'act-staff', 'cost-1')]))).toBe(
        'refused',
      );
      // Nor changed or deleted where they are.
      expect(await outcome(push(user, c, [costing(c, 'cost-1', { status: 'won' })]))).toBe(
        'refused',
      );
      expect(
        await outcome(push(user, c, [{ tbl: 'staffingCostings', id: 'cost-1', deleted: true }])),
      ).toMatch(/ok|refused/);
    }
    // A deletion by someone who can't see it changes nothing.
    expect(await visibleIds(t.owner, c)).toContain('cost-1');
  });

  it('keep the quote made from them an ordinary document staff read and change', async () => {
    const c = t.company;
    const [row] = await h.admin<{ data: Record<string, unknown> }>(
      `select data from public.records where company_id = $1 and tbl = 'documents' and id = 'qt-1'`,
      [c],
    );
    expect(row.data.costingId).toBe('cost-1');
    expect(
      await outcome(
        push(t.staff, c, [
          { tbl: 'documents', id: 'qt-1', data: { ...row.data, poNumber: 'PO-7' } },
        ]),
      ),
    ).toBe('ok');
  });

  it('leave deletion markers staff and viewers never see', async () => {
    const t2 = await team();
    await seed(t2);
    const c = t2.company;
    const [first] = await push(t2.owner, c, [
      { tbl: 'staffingCostings', id: 'cost-1', deleted: true },
      { tbl: 'activities', id: 'act-quote', deleted: true },
    ]);
    const since = first.rev - 1;
    expect((await pull(t2.owner, c, since)).map((r) => r.id).sort()).toEqual([
      'act-quote',
      'cost-1',
    ]);
    for (const user of [t2.staff, t2.viewer]) {
      expect((await pull(user, c, since)).map((r) => r.id)).toEqual(['act-quote']);
    }
  });

  it('are People’s for the owner’s limits: kept from a member with People view only or none', async () => {
    const c = t.company;
    const limit = (apps: Record<string, string>) =>
      h.rpc(t.owner, 'set_member_permissions', {
        p_company: c,
        p_user: t.limited,
        p_permissions: json({ apps }),
        p_can_approve: false,
      });
    for (const people of ['view', 'none']) {
      await limit({ people });
      expect(await outcome(push(t.limited, c, [costing(c, `cost-${people}`)]))).toBe('refused');
      // Their quotes are Maham Books' documents.
      expect(await outcome(push(t.limited, c, [quote(c, `qt-${people}`, 'cost-1')]))).toBe('ok');
    }
    await limit({ books: 'view' });
    expect(await outcome(push(t.limited, c, [costing(c, 'cost-books-view')]))).toBe('ok');
    await limit({});
  });

  it('stay as they are when this file runs again', async () => {
    const before = await visibleIds(t.staff, t.company);
    const owner = await visibleIds(t.owner, t.company);
    await h.db.exec(readFileSync(FILE, 'utf8'));
    expect(await visibleIds(t.staff, t.company)).toEqual(before);
    expect(await visibleIds(t.owner, t.company)).toEqual(owner);
  });

  it('stay private when an earlier file puts back a record_is_private that doesn’t know them', async () => {
    for (const earlier of [recordIsPrivateOf(MIGRATION), recordIsPrivateOf(V16)]) {
      await h.db.exec(earlier);
      try {
        for (const user of [t.staff, t.viewer]) {
          const ids = await visibleIds(user, t.company);
          for (const id of PRIVATE) expect(ids, id).not.toContain(id);
          for (const id of OPEN) expect(ids, id).toContain(id);
          const direct = await selectedIds(user, t.company);
          for (const id of PRIVATE) expect(direct, id).not.toContain(id);
        }
        for (const user of [t.owner, t.accountant]) {
          const ids = await visibleIds(user, t.company);
          for (const id of PRIVATE) expect(ids, id).toContain(id);
        }
      } finally {
        await h.db.exec(readFileSync(FILE, 'utf8'));
      }
    }
  });

  it('keep the earlier files that list the kinds of record from running again, changing nothing', async () => {
    for (const earlier of [MIGRATION, V16]) {
      await expect(h.db.exec(readFileSync(earlier, 'utf8'))).rejects.toThrow(/records_tbl_check/);
    }
    expect(await features(h)).toContain('staffing_costings');
    const ids = await visibleIds(t.staff, t.company);
    for (const id of PRIVATE) expect(ids, id).not.toContain(id);
    expect(await outcome(push(t.owner, t.company, [costing(t.company, 'cost-after')]))).toBe('ok');
  });

  it('schedule the daily clean-up of deletion markers as the fourth file does, which can’t run again', () => {
    // PGlite has no pg_cron: the block is compared with the fourth file's.
    const schedule = (file: string) =>
      /if exists \(select 1 from pg_catalog\.pg_extension where extname = 'pg_cron'\) then\s+perform cron\.schedule\([^;]*\);\s+end if;/.exec(
        readFileSync(file, 'utf8'),
      )?.[0];
    expect(schedule(FILE)).toBeDefined();
    expect(schedule(FILE)).toBe(schedule(V16));
    expect(schedule(FILE)).toContain("'almailbooks-purge-deleted-records'");
  });
});

describe('an older version of the app', () => {
  it('gets every push it makes answered exactly as before the file', async () => {
    const before = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    const outcomes: string[][] = [];
    for (const db of [before, h]) {
      const t = await team(db);
      const c = t.company;
      const results: string[] = [];
      const run = async (who: string, user: string, changes: Change[]) =>
        results.push(`${who} ${await outcome(push(user, c, changes, db))}`);
      const users = Object.entries({
        owner: t.owner,
        admin: t.admin,
        accountant: t.accountant,
        staff: t.staff,
        viewer: t.viewer,
      });
      for (const [who, user] of users) {
        await run(who, user, [
          { tbl: 'clients', id: `cl-${who}`, data: rec(c, `cl-${who}`, { name: 'Made-up' }) },
        ]);
        await run(who, user, [
          {
            tbl: 'documents',
            id: `inv-${who}`,
            data: rec(c, `inv-${who}`, { type: 'invoice', number: `INV-${who}`, status: 'draft' }),
          },
        ]);
        await run(who, user, [
          {
            tbl: 'activities',
            id: `act-${who}`,
            data: rec(c, `act-${who}`, { entity: 'invoice', entityId: `inv-${who}` }),
          },
        ]);
        await run(who, user, [
          {
            tbl: 'activities',
            id: `act-emp-${who}`,
            data: rec(c, `act-emp-${who}`, { entity: 'employee', entityId: 'emp-1' }),
          },
        ]);
        await run(who, user, [
          { tbl: 'employees', id: `emp-${who}`, data: rec(c, `emp-${who}`, { basicSalary: 300 }) },
        ]);
        await run(who, user, [
          { tbl: 'vehicles', id: `veh-${who}`, data: rec(c, `veh-${who}`, { plate: 'TEST' }) },
        ]);
        await run(who, user, [
          {
            tbl: 'peopleSettings',
            id: c,
            data: rec(c, c, { reminderDays: [60, 30, 7], updatedAt: STAMP }),
          },
        ]);
        await run(who, user, [{ tbl: 'clients', id: `cl-${who}`, deleted: true }]);
      }
      const seen: string[] = [];
      for (const [who, user] of users) {
        const ids = [...(await visibleIds(user, c, db))].map((id) => id.replace(c, 'CO')).sort();
        seen.push(`${who} sees ${ids.join(',')}`);
      }
      outcomes.push([...results, ...seen]);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toContain('staff refused');
    expect(outcomes[0]).toContain('owner ok');
  }, 120_000);
});

describe('the device and the app’s stand-ins for the cloud', () => {
  it('give a costing and its activity the same app, kind and privacy as the server', async () => {
    const c = 'no-such-company';
    const fixtures: [string, Record<string, unknown>][] = [
      ['staffingCostings', {}],
      ['staffingCostings', costing(c, 'x').data as Record<string, unknown>],
      ['activities', { entity: 'costing', entityId: 'x' }],
      ['activities', { entity: 'quote', entityId: 'x' }],
      ['documents', { type: 'quote', costingId: 'x' }],
    ];
    for (const [tbl, data] of fixtures) {
      const [row] = await h.admin<{ app: string | null; kind: string; private: boolean }>(
        `select almailbooks.record_app($1, $2::jsonb) as app,
                almailbooks.change_kind($1, $2::jsonb) as kind,
                almailbooks.record_is_private($3, $1, $2::jsonb) as private`,
        [tbl, json(data), c],
      );
      expect(`${tbl} ${json(data)} ${row.app} ${row.kind} ${row.private}`).toBe(
        `${tbl} ${json(data)} ${recordApp(tbl, data)} ${changeKind(tbl, data)} ${isPrivateRecord(tbl, data)}`,
      );
    }
  });

  it('answer costing pushes as the server does, before the file and after it', async () => {
    const before = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    for (const [db, list] of [
      [before, await features(before)],
      [h, await features(h)],
    ] as const) {
      const t = await team(db);
      const c = t.company;
      const fake = new FakeCloud();
      fake.features = [...list];
      fake.companies.set(c, { id: c, name: 'Same', purgedUntilRev: 0, createdAt: '' });
      const users: [string, string, MemberRole][] = [
        ['owner', t.owner, 'owner'],
        ['admin', t.admin, 'admin'],
        ['accountant', t.accountant, 'accountant'],
        ['staff', t.staff, 'staff'],
        ['viewer', t.viewer, 'viewer'],
      ];
      for (const [, user, role] of users) fake.addMember(c, user, role);
      const after = list.includes('staffing_costings');
      for (const [who, user] of users) {
        for (const changes of [
          [costing(c, `cost-${who}`)],
          // Before the file the device holds a costing's activity back (see
          // heldForServer in sync.ts): the server never gets one.
          ...(after ? [[costingActivity(c, `act-${who}`, `cost-${who}`)]] : []),
          [quote(c, `qt-${who}`, `cost-${who}`)],
        ]) {
          const inSql = await outcome(push(user, c, changes, db));
          const inFake = await fake
            .client(user)
            .pushRecords(c, changes as never)
            .then(
              () => 'ok',
              (e: { code?: string }) =>
                e.code === 'permission'
                  ? 'refused'
                  : e.code === 'invalid'
                    ? 'unknown kind'
                    : String(e.code),
            );
          expect(`${list.length} ${who} ${changes[0].id} ${inFake}`).toBe(
            `${list.length} ${who} ${changes[0].id} ${inSql}`,
          );
        }
      }
    }
  }, 120_000);
});
