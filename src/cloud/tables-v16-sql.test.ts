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

/**
 * Register documents, one confidential, with renewals, files and activity
 * (without the app's private mark, as an earlier version sends them).
 */
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
    { tbl: 'attachments', id: 'att-secret', data: rec(c, 'att-secret', { ownerId: 'doc-secret' }) },
    { tbl: 'attachments', id: 'att-ren', data: rec(c, 'att-ren', { ownerId: 'ren-secret' }) },
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
    // About a confidential document that is gone: only its mark tells.
    {
      tbl: 'activities',
      id: 'act-gone',
      data: rec(c, 'act-gone', { entity: 'compliance', entityId: 'doc-gone', confidential: true }),
    },
    {
      tbl: 'activities',
      id: 'act-open',
      data: rec(c, 'act-open', { entity: 'compliance', entityId: 'doc-open' }),
    },
    { tbl: 'activities', id: 'act-inv', data: rec(c, 'act-inv', { entity: 'invoice' }) },
  ];
}

/** Ids of registerRecords that staff and viewers never read, and the others. */
const REGISTER_PRIVATE = [
  'doc-secret',
  'ren-secret',
  'ren-secret-key',
  'att-secret',
  'att-ren',
  'act-secret',
  'act-ren',
  'act-gone',
];
const REGISTER_OPEN = ['doc-open', 'ren-open', 'att-open', 'act-open', 'act-inv'];

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
    { tbl: 'attachments', id: 'att-tpl', data: rec(c, 'att-tpl', { ownerId: 'tpl-1' }) },
    { tbl: 'attachments', id: 'att-letter', data: rec(c, 'att-letter', { ownerId: 'let-1' }) },
  ]);
}

const PRIVATE = [
  'tpl-1',
  'let-1',
  'apr-pay',
  'apr-letter',
  'att-tpl',
  'att-letter',
  ...REGISTER_PRIVATE,
];
const OPEN = ['inv-1', 'apr-inv', 'veh-1', 'lay-1', ...REGISTER_OPEN];

/** Puts the files of these attachments in Storage, as their owner uploads them. */
async function storeFiles(owner: string, company: string, ids: string[], db: Harness = h) {
  for (const id of ids) {
    await db.as(owner, (q) =>
      q(
        `insert into storage.objects (bucket_id, name, owner, owner_id)
         values ('company-files', $1, $2::uuid, $2)`,
        [`${company}/${id}`, owner],
      ),
    );
  }
}

async function fileReadable(user: string, company: string, id: string, db: Harness = h) {
  const rows = await db.as(user, (q) =>
    q(`select name from storage.objects where name = $1`, [`${company}/${id}`]),
  );
  return rows.length === 1;
}

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
    await storeFiles(t.owner, c, ['att-secret', 'att-ren', 'att-tpl', 'att-open']);
    for (const user of [t.staff, t.viewer]) {
      expect(await fileReadable(user, c, 'att-secret')).toBe(false);
      expect(await fileReadable(user, c, 'att-ren')).toBe(false);
      expect(await fileReadable(user, c, 'att-tpl')).toBe(false);
      expect(await fileReadable(user, c, 'att-open')).toBe(true);
    }
    for (const user of [t.owner, t.admin, t.accountant]) {
      for (const id of ['att-secret', 'att-ren', 'att-tpl', 'att-open']) {
        expect(await fileReadable(user, c, id), id).toBe(true);
      }
    }
  });

  it('can’t be changed by staff or viewers, and can by owners, admins and accountants', async () => {
    const c = t.company;
    const kinds = ['chequeLayouts', 'vehicles', 'approvals', 'letterTemplates', 'employeeLetters'];
    for (const user of [t.staff, t.viewer]) {
      for (const tbl of kinds) {
        // Staff ask for approval since 20261116000000_super_admin_approvals.sql.
        if (tbl === 'approvals' && user === t.staff) continue;
        await expect(
          push(user, c, [{ tbl, id: `${tbl}-new`, data: rec(c, `${tbl}-new`) }]),
          tbl,
        ).rejects.toThrow(/row-level security|almail:permission/);
      }
      // Nor ask for approval of payroll.
      await expect(
        push(user, c, [
          {
            tbl: 'approvals',
            id: 'apr-new',
            data: rec(c, 'apr-new', { subjectTbl: 'payRuns' }),
          },
        ]),
      ).rejects.toThrow(/row-level security|almail:permission/);
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
      { tbl: 'renewals', id: 'ren-secret', deleted: true },
      { tbl: 'vehicles', id: 'veh-1', deleted: true },
    ]);
    // Approval requests are never deleted through sync (records_guard of
    // 20261116000000_super_admin_approvals.sql); the SQL editor still can.
    await h.admin(
      `delete from public.records where company_id = $1 and tbl = 'approvals' and id = 'apr-pay'`,
      [c],
    );
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

  it('stay private under the first file’s record_is_private, with their files and activity', async () => {
    await h.db.exec(firstRecordIsPrivate());
    try {
      for (const user of [t.staff, t.viewer]) {
        const ids = await visibleIds(user, t.company);
        for (const id of PRIVATE) expect(ids, id).not.toContain(id);
        for (const id of OPEN) expect(ids, id).toContain(id);
        const direct = await selectedIds(user, t.company);
        for (const id of PRIVATE) expect(direct, id).not.toContain(id);
        expect(await fileReadable(user, t.company, 'att-secret')).toBe(false);
        expect(await fileReadable(user, t.company, 'att-tpl')).toBe(false);
        expect(await fileReadable(user, t.company, 'att-open')).toBe(true);
      }
      for (const user of [t.owner, t.accountant]) {
        const ids = await visibleIds(user, t.company);
        for (const id of PRIVATE) expect(ids, id).toContain(id);
        expect(await fileReadable(user, t.company, 'att-secret')).toBe(true);
      }
    } finally {
      await h.db.exec(readFileSync(V16, 'utf8'));
    }
  });
});

describe('the first file run again', () => {
  it('keeps confidential documents, their renewals, files and activity from staff and viewers', async () => {
    const db = await startDatabase(1);
    const t = await team(db);
    const c = t.company;
    await push(t.owner, c, registerRecords(c), db);
    await storeFiles(t.owner, c, ['att-secret', 'att-ren', 'att-open'], db);
    // No records of the new kinds yet: the first file runs through.
    await db.db.exec(readFileSync(MIGRATION, 'utf8'));
    for (const user of [t.staff, t.viewer]) {
      const ids = await visibleIds(user, c, db);
      for (const id of REGISTER_PRIVATE) expect(ids, id).not.toContain(id);
      for (const id of REGISTER_OPEN) expect(ids, id).toContain(id);
      for (const id of ['att-secret', 'att-ren']) {
        expect(await fileReadable(user, c, id, db), id).toBe(false);
      }
      expect(await fileReadable(user, c, 'att-open', db)).toBe(true);
    }
    const all = await visibleIds(t.admin, c, db);
    for (const id of [...REGISTER_PRIVATE, ...REGISTER_OPEN]) expect(all, id).toContain(id);
    expect(await fileReadable(t.admin, c, 'att-secret', db)).toBe(true);
    // Running this file after it brings back the new kinds.
    await db.db.exec(readFileSync(V16, 'utf8'));
    await push(t.owner, c, [{ tbl: 'vehicles', id: 'veh-1', data: rec(c, 'veh-1') }], db);
  }, 60_000);
});

describe('a register document made confidential under new ids', () => {
  it('reaches staff and viewers as the deletion of the old records, and nothing else', async () => {
    const t = await team();
    const c = t.company;
    const first = await push(t.owner, c, [
      {
        tbl: 'complianceDocuments',
        id: 'doc-old',
        data: rec(c, 'doc-old', { type: 'other', employeeId: null }),
      },
      {
        tbl: 'renewals',
        id: 'ren-old',
        data: rec(c, 'ren-old', { documentKey: 'doc:doc-old', documentId: 'doc-old' }),
      },
      { tbl: 'attachments', id: 'att-old', data: rec(c, 'att-old', { ownerId: 'doc-old' }) },
      {
        tbl: 'activities',
        id: 'act-old',
        data: rec(c, 'act-old', { entity: 'compliance', entityId: 'doc-old' }),
      },
    ]);
    const held = Math.max(...first.map((r) => r.rev));
    // As the app sends it: the document first, its files and activity marked private.
    await push(t.owner, c, [
      {
        tbl: 'complianceDocuments',
        id: 'doc-new',
        data: rec(c, 'doc-new', { type: 'other', employeeId: null, confidential: true }),
      },
      { tbl: 'complianceDocuments', id: 'doc-old', deleted: true },
      {
        tbl: 'renewals',
        id: 'ren-new',
        data: rec(c, 'ren-new', { documentKey: 'doc:doc-new', documentId: 'doc-new' }),
      },
      { tbl: 'renewals', id: 'ren-old', deleted: true },
      {
        tbl: 'attachments',
        id: 'att-new',
        data: rec(c, 'att-new', { ownerId: 'doc-new', _private: true }),
      },
      { tbl: 'attachments', id: 'att-old', deleted: true },
      {
        tbl: 'activities',
        id: 'act-new',
        data: rec(c, 'act-new', {
          entity: 'compliance',
          entityId: 'doc-new',
          confidential: true,
          _private: true,
        }),
      },
      { tbl: 'activities', id: 'act-old', deleted: true },
    ]);
    for (const user of [t.staff, t.viewer]) {
      const rows = await pull(user, c, held);
      expect(rows.map((r) => `${r.id} ${r.deleted}`).sort()).toEqual([
        'act-old true',
        'att-old true',
        'doc-old true',
        'ren-old true',
      ]);
    }
    const owner = await pull(t.owner, c, held);
    expect(owner.map((r) => `${r.id} ${r.deleted}`).sort()).toEqual([
      'act-new false',
      'act-old true',
      'att-new false',
      'att-old true',
      'doc-new false',
      'doc-old true',
      'ren-new false',
      'ren-old true',
    ]);
  });
});

describe('server_features', () => {
  it('tells signed-in people what the server has, and nobody else', async () => {
    const user = await h.user('features@example.com');
    // Later files add their own names to it.
    const [row] = await h.rpc<{ server_features: string[] }>(user, 'server_features');
    expect(row.server_features).toContain('tables_v16');
    await expect(h.rpc(null, 'server_features')).rejects.toThrow(/permission denied/);
  });

  it('is missing on a server that hasn’t run this file', async () => {
    const early = await startDatabase(1, MIGRATIONS.indexOf(V16));
    const user = await early.user('early@example.com');
    await expect(early.rpc(user, 'server_features')).rejects.toThrow(/does not exist/);
  }, 60_000);
});
