// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION, MIGRATIONS, startDatabase, type Harness } from './sql-harness';

/**
 * 20261102000000_tables_v16.sql: the five kinds of record of database
 * version 16, and which of them, with confidential register documents, stay
 * away from staff and viewers, even after the first file is run again.
 */

const V16 = MIGRATIONS.find((file) => file.endsWith('_tables_v16.sql'))!;

let h: Harness;
let companySeq = 0;

beforeAll(async () => {
  // Each file twice: running a script again must be safe.
  h = await startDatabase(2);
}, 60_000);

const json = (value: unknown) => JSON.stringify(value);

/** A fresh company with an owner, and members in every other role. */
async function team(db: Harness = h) {
  companySeq += 1;
  const company = `v16-company-${String(companySeq).padStart(4, '0')}`;
  const tag = `v16-${companySeq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await db.user(`owner-${tag}@example.com`);
  await db.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${companySeq}` });
  const members: Record<string, string> = {};
  for (const role of ['admin', 'accountant', 'staff', 'viewer']) {
    const email = `${role}-${tag}@example.com`;
    members[role] = await db.user(email);
    const [invite] = await db.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: company,
      p_email: email,
      p_role: role,
    });
    await db.rpc(members[role], 'accept_invite', { p_token: invite.token });
  }
  const { admin, accountant, staff, viewer } = members;
  return { company, owner, admin, accountant, staff, viewer };
}

type Team = Awaited<ReturnType<typeof team>>;
type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean };

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

/** Register documents, one confidential, with renewals, files and activity. */
function registerRecords(c: string): Change[] {
  return [
    {
      tbl: 'complianceDocuments',
      id: 'doc-secret',
      data: rec(c, 'doc-secret', { type: 'other', employeeId: null, confidential: true }),
    },
    {
      tbl: 'complianceDocuments',
      id: 'doc-open',
      data: rec(c, 'doc-open', { type: 'commercial_licence', employeeId: null }),
    },
    {
      tbl: 'renewals',
      id: 'ren-secret',
      data: rec(c, 'ren-secret', { documentKey: 'doc:doc-secret', documentId: 'doc-secret' }),
    },
    // Found by its key alone.
    {
      tbl: 'renewals',
      id: 'ren-secret-key',
      data: rec(c, 'ren-secret-key', { documentKey: 'doc:doc-secret', documentId: null }),
    },
    {
      tbl: 'renewals',
      id: 'ren-open',
      data: rec(c, 'ren-open', { documentKey: 'doc:doc-open', documentId: 'doc-open' }),
    },
  ];
}

/** Records of every new kind, written by the owner. */
async function seed(t: Team) {
  const c = t.company;
  await push(t.owner, c, [
    { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { basicSalary: 450 }) },
    { tbl: 'payRuns', id: 'run-1', data: rec(c, 'run-1', { period: '2026-10' }) },
    { tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1', { number: 'INV-0001' }) },
    {
      tbl: 'letterTemplates',
      id: 'tpl-1',
      data: rec(c, 'tpl-1', { kind: 'salary_certificate', bodyEn: 'Salary {salary.total}' }),
    },
    {
      tbl: 'employeeLetters',
      id: 'let-1',
      data: rec(c, 'let-1', { employeeId: 'emp-1', body: 'Monthly salary 450.000' }),
    },
    {
      tbl: 'approvals',
      id: 'apr-pay',
      data: rec(c, 'apr-pay', { kind: 'payroll', subjectTbl: 'payRuns', subjectId: 'run-1' }),
    },
    {
      tbl: 'approvals',
      id: 'apr-letter',
      data: rec(c, 'apr-letter', { kind: 'letter', subjectTbl: 'employeeLetters' }),
    },
    {
      tbl: 'approvals',
      id: 'apr-inv',
      data: rec(c, 'apr-inv', {
        kind: 'invoice_void',
        subjectTbl: 'documents',
        subjectId: 'inv-1',
      }),
    },
    { tbl: 'vehicles', id: 'veh-1', data: rec(c, 'veh-1', { plate: 'TEST-1' }) },
    { tbl: 'chequeLayouts', id: 'lay-1', data: rec(c, 'lay-1', { bank: 'BRGN' }) },
    ...registerRecords(c),
    { tbl: 'attachments', id: 'att-secret', data: rec(c, 'att-secret', { ownerId: 'doc-secret' }) },
    { tbl: 'attachments', id: 'att-ren', data: rec(c, 'att-ren', { ownerId: 'ren-secret' }) },
    { tbl: 'attachments', id: 'att-tpl', data: rec(c, 'att-tpl', { ownerId: 'tpl-1' }) },
    { tbl: 'attachments', id: 'att-letter', data: rec(c, 'att-letter', { ownerId: 'let-1' }) },
    { tbl: 'attachments', id: 'att-open', data: rec(c, 'att-open', { ownerId: 'doc-open' }) },
    {
      tbl: 'activities',
      id: 'act-secret',
      data: rec(c, 'act-secret', { entity: 'compliance', entityId: 'doc-secret' }),
    },
    {
      tbl: 'activities',
      id: 'act-ren',
      data: rec(c, 'act-ren', { entity: 'compliance', entityId: 'ren-secret' }),
    },
    {
      tbl: 'activities',
      id: 'act-open',
      data: rec(c, 'act-open', { entity: 'compliance', entityId: 'doc-open' }),
    },
  ]);
}

const PRIVATE = [
  'tpl-1',
  'let-1',
  'apr-pay',
  'apr-letter',
  'doc-secret',
  'ren-secret',
  'ren-secret-key',
  'att-secret',
  'att-ren',
  'att-tpl',
  'att-letter',
  'act-secret',
  'act-ren',
];
const OPEN = ['inv-1', 'apr-inv', 'veh-1', 'lay-1', 'doc-open', 'ren-open', 'att-open', 'act-open'];

async function visibleIds(user: string, company: string, db: Harness = h): Promise<Set<string>> {
  return new Set((await pull(user, company, 0, db)).map((r) => r.id));
}

async function selectedIds(user: string, company: string, db: Harness = h): Promise<string[]> {
  const rows = await db.as(user, (q) =>
    q<{ id: string }>(`select id from public.records where company_id = $1`, [company]),
  );
  return rows.map((r) => r.id);
}

/** The first file's record_is_private, as running that file again would put it back. */
function firstRecordIsPrivate(): string {
  const source = readFileSync(MIGRATION, 'utf8');
  const start = source.indexOf('create or replace function almailbooks.record_is_private');
  const end = source.indexOf('$$;', source.indexOf('as $$', start)) + 3;
  return source.slice(start, end);
}

describe('records of database version 16', () => {
  let t: Team;
  beforeAll(async () => {
    t = await team();
    await seed(t);
  });

  it('are taken of the five new kinds, and other unknown kinds are still refused', async () => {
    const counts = await h.admin<{ tbl: string; n: number }>(
      `select tbl, count(*)::int as n from public.records where company_id = $1 group by tbl`,
      [t.company],
    );
    const byTable = Object.fromEntries(counts.map((r) => [r.tbl, r.n]));
    expect(byTable).toMatchObject({
      letterTemplates: 1,
      employeeLetters: 1,
      approvals: 3,
      vehicles: 1,
      chequeLayouts: 1,
    });
    await expect(
      push(t.owner, t.company, [{ tbl: 'secrets', id: 'x', data: rec(t.company, 'x') }]),
    ).rejects.toThrow(/records_tbl_check/);
  });

  it('are all read by owners, admins and accountants', async () => {
    for (const user of [t.owner, t.admin, t.accountant]) {
      const ids = await visibleIds(user, t.company);
      for (const id of [...PRIVATE, ...OPEN]) expect(ids, id).toContain(id);
    }
  });

  it('keep letters, people approvals and confidential documents from staff and viewers', async () => {
    for (const user of [t.staff, t.viewer]) {
      const ids = await visibleIds(user, t.company);
      for (const id of PRIVATE) expect(ids, id).not.toContain(id);
      for (const id of OPEN) expect(ids, id).toContain(id);
      const direct = await selectedIds(user, t.company);
      for (const id of PRIVATE) expect(direct, id).not.toContain(id);
      const listed = await h.rpc<{ id: string }>(user, 'company_record_ids', {
        p_company: t.company,
      });
      for (const id of PRIVATE)
        expect(
          listed.map((r) => r.id),
          id,
        ).not.toContain(id);
    }
  });

  it('keep the files of letters and confidential documents from staff and viewers', async () => {
    const c = t.company;
    for (const id of ['att-secret', 'att-tpl', 'att-open']) {
      await h.as(t.owner, (q) =>
        q(
          `insert into storage.objects (bucket_id, name, owner, owner_id)
           values ('company-files', $1, $2::uuid, $2)`,
          [`${c}/${id}`, t.owner],
        ),
      );
    }
    const readable = async (user: string, id: string) =>
      (
        await h.as(user, (q) =>
          q(`select name from storage.objects where name = $1`, [`${c}/${id}`]),
        )
      ).length === 1;
    for (const user of [t.staff, t.viewer]) {
      expect(await readable(user, 'att-secret')).toBe(false);
      expect(await readable(user, 'att-tpl')).toBe(false);
      expect(await readable(user, 'att-open')).toBe(true);
    }
    expect(await readable(t.accountant, 'att-tpl')).toBe(true);
  });

  it('can’t be changed by staff or viewers, and can by owners, admins and accountants', async () => {
    const c = t.company;
    const kinds = ['chequeLayouts', 'vehicles', 'approvals', 'letterTemplates', 'employeeLetters'];
    for (const user of [t.staff, t.viewer]) {
      for (const tbl of kinds) {
        await expect(
          push(user, c, [{ tbl, id: `${tbl}-new`, data: rec(c, `${tbl}-new`) }]),
          tbl,
        ).rejects.toThrow(/row-level security|almail:permission/);
      }
      // Nor change or delete one that is there.
      await expect(
        push(user, c, [{ tbl: 'vehicles', id: 'veh-1', data: rec(c, 'veh-1', { plate: 'X' }) }]),
      ).rejects.toThrow(/row-level security|almail:permission/);
      await expect(
        push(user, c, [{ tbl: 'vehicles', id: 'veh-1', deleted: true }]),
      ).rejects.toThrow(/almail:permission/);
    }
    for (const [i, user] of [t.owner, t.admin, t.accountant].entries()) {
      const changes = kinds.map((tbl) => ({ tbl, id: `${tbl}-${i}`, data: rec(c, `${tbl}-${i}`) }));
      expect(await push(user, c, changes)).toHaveLength(kinds.length);
    }
  });

  it('leave deletion markers of private ones that staff and viewers can’t see', async () => {
    const t2 = await team();
    await seed(t2);
    const c = t2.company;
    const [first] = await push(t2.owner, c, [
      { tbl: 'employeeLetters', id: 'let-1', deleted: true },
      { tbl: 'approvals', id: 'apr-pay', deleted: true },
      { tbl: 'renewals', id: 'ren-secret', deleted: true },
      { tbl: 'vehicles', id: 'veh-1', deleted: true },
    ]);
    const since = first.rev - 1;
    expect((await pull(t2.owner, c, since)).map((r) => r.id).sort()).toEqual(
      ['apr-pay', 'let-1', 'ren-secret', 'veh-1'].sort(),
    );
    for (const user of [t2.staff, t2.viewer]) {
      expect((await pull(user, c, since)).map((r) => r.id)).toEqual(['veh-1']);
    }
  });

  it('stay as they are when this file runs again', async () => {
    const before = await visibleIds(t.staff, t.company);
    await h.db.exec(readFileSync(V16, 'utf8'));
    expect(await visibleIds(t.staff, t.company)).toEqual(before);
    expect((await visibleIds(t.owner, t.company)).size).toBeGreaterThan(before.size);
  });

  it('keep the first file from running again, without changing anything', async () => {
    await expect(h.db.exec(readFileSync(MIGRATION, 'utf8'))).rejects.toThrow(/records_tbl_check/);
    await expect(
      push(t.owner, t.company, [{ tbl: 'secrets', id: 'x', data: rec(t.company, 'x') }]),
    ).rejects.toThrow(/records_tbl_check/);
    const ids = await visibleIds(t.staff, t.company);
    for (const id of PRIVATE) expect(ids, id).not.toContain(id);
    await push(t.owner, t.company, [
      { tbl: 'vehicles', id: 'veh-2', data: rec(t.company, 'veh-2', { plate: 'TEST-2' }) },
    ]);
  });

  it('stay private under the first file’s record_is_private', async () => {
    await h.db.exec(firstRecordIsPrivate());
    try {
      for (const user of [t.staff, t.viewer]) {
        const ids = await visibleIds(user, t.company);
        // Their files and activity carry the app's private mark (see sync.ts).
        for (const id of [
          'tpl-1',
          'let-1',
          'apr-pay',
          'apr-letter',
          'doc-secret',
          'ren-secret',
          'ren-secret-key',
        ])
          expect(ids, id).not.toContain(id);
        expect(ids).toContain('doc-open');
        expect(ids).toContain('apr-inv');
        const direct = await selectedIds(user, t.company);
        expect(direct).not.toContain('let-1');
        expect(direct).not.toContain('doc-secret');
      }
      for (const user of [t.owner, t.accountant]) {
        const ids = await visibleIds(user, t.company);
        for (const id of PRIVATE) expect(ids, id).toContain(id);
      }
    } finally {
      await h.db.exec(readFileSync(V16, 'utf8'));
    }
  });
});

describe('the first file run again', () => {
  it('keeps confidential documents and their renewals from staff and viewers', async () => {
    const db = await startDatabase(1);
    const t = await team(db);
    const c = t.company;
    await push(t.owner, c, registerRecords(c), db);
    // No records of the new kinds yet: the first file runs through.
    await db.db.exec(readFileSync(MIGRATION, 'utf8'));
    for (const user of [t.staff, t.viewer]) {
      const ids = await visibleIds(user, c, db);
      for (const id of ['doc-secret', 'ren-secret', 'ren-secret-key']) {
        expect(ids, id).not.toContain(id);
      }
      expect(ids).toContain('doc-open');
      expect(ids).toContain('ren-open');
    }
    expect(await visibleIds(t.admin, c, db)).toContain('doc-secret');
    // Running this file after it brings back the new kinds.
    await db.db.exec(readFileSync(V16, 'utf8'));
    await push(t.owner, c, [{ tbl: 'vehicles', id: 'veh-1', data: rec(c, 'veh-1') }], db);
  }, 60_000);
});

describe('server_features', () => {
  it('tells signed-in people what the server has, and nobody else', async () => {
    const user = await h.user('features@example.com');
    expect(await h.rpc(user, 'server_features')).toEqual([{ server_features: ['tables_v16'] }]);
    await expect(h.rpc(null, 'server_features')).rejects.toThrow(/permission denied/);
  });

  it('is missing on a server that hasn’t run this file', async () => {
    const early = await startDatabase(1, MIGRATIONS.indexOf(V16));
    const user = await early.user('early@example.com');
    await expect(early.rpc(user, 'server_features')).rejects.toThrow(/does not exist/);
  }, 60_000);
});
