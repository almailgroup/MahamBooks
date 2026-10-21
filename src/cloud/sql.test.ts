// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, startDatabase, type Harness } from './sql-harness';

/**
 * The cloud migrations, run in order in an in-process Postgres with a
 * stand-in for Supabase's auth and storage schemas. Every check runs as a
 * signed-in account, so row-level security applies exactly as it does in
 * Supabase.
 */

let h: Harness;
let companySeq = 0;

beforeAll(async () => {
  // Each file twice: running a script again must be safe.
  h = await startDatabase(2);
}, 60_000);

const json = (value: unknown) => JSON.stringify(value);

/** A fresh company with an owner, and members in every other role. */
async function team() {
  companySeq += 1;
  const company = `company-${String(companySeq).padStart(4, '0')}`;
  const tag = `${companySeq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await h.user(`owner-${tag}@example.com`, { name: 'Owner' });
  const admin = await h.user(`admin-${tag}@example.com`, { name: 'Admin' });
  const accountant = await h.user(`accountant-${tag}@example.com`, { name: 'Accountant' });
  const staff = await h.user(`staff-${tag}@example.com`, { name: 'Staff' });
  const viewer = await h.user(`viewer-${tag}@example.com`, { name: 'Viewer' });
  const outsider = await h.user(`outsider-${tag}@example.com`, { name: 'Outsider' });
  await h.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${companySeq}` });
  const members: [string, string, string][] = [
    [admin, `admin-${tag}@example.com`, 'admin'],
    [accountant, `accountant-${tag}@example.com`, 'accountant'],
    [staff, `staff-${tag}@example.com`, 'staff'],
    [viewer, `viewer-${tag}@example.com`, 'viewer'],
  ];
  for (const [id, email, role] of members) {
    const [invite] = await h.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: company,
      p_email: email,
      p_role: role,
    });
    await h.rpc(id, 'accept_invite', { p_token: invite.token });
  }
  return { company, owner, admin, accountant, staff, viewer, outsider, tag };
}

type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean; base_rev?: number };

function push(user: string, company: string, changes: Change[]) {
  return h.rpc<{ tbl: string; id: string; rev: number; conflict: boolean }>(user, 'push_records', {
    p_company: company,
    p_changes: json(changes),
  });
}

function pull(user: string, company: string, since = 0, limit = 1000) {
  return h.rpc<{
    tbl: string;
    id: string;
    data: Record<string, unknown>;
    rev: number;
    deleted: boolean;
  }>(user, 'pull_records', { p_company: company, p_since: since, p_limit: limit });
}

const rec = (company: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  companyId: company,
  ...extra,
});

const rule = (next: number, period = '2026', reset = 'yearly', pattern = 'INV-{counter}') => ({
  pattern,
  next,
  padding: 4,
  reset,
  period,
});

const companyRecord = (company: string, extra: Record<string, unknown> = {}) => ({
  id: company,
  name: 'Acme',
  currency: 'KWD',
  numbering: { invoice: rule(5), payment: rule(3) },
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

/** Records of every kind, written by the owner. */
async function seed(t: Awaited<ReturnType<typeof team>>) {
  const c = t.company;
  await push(t.owner, c, [
    { tbl: 'companies', id: c, data: companyRecord(c) },
    { tbl: 'clients', id: 'client-1', data: rec(c, 'client-1', { name: 'Gulf Pearl' }) },
    { tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1', { number: 'INV-0001' }) },
    { tbl: 'accounts', id: 'acc-1', data: rec(c, 'acc-1', { code: '1000' }) },
    { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { name: 'Rajesh', basicSalary: 450 }) },
    { tbl: 'payRuns', id: 'run-1', data: rec(c, 'run-1', { period: '2026-09' }) },
    { tbl: 'payrollSettings', id: `${c}-payroll`, data: rec(c, `${c}-payroll`) },
    { tbl: 'peopleSettings', id: `${c}-people`, data: rec(c, `${c}-people`) },
    { tbl: 'leaveRecords', id: 'leave-1', data: rec(c, 'leave-1', { employeeId: 'emp-1' }) },
    { tbl: 'staffLoans', id: 'loan-1', data: rec(c, 'loan-1', { employeeId: 'emp-1' }) },
    { tbl: 'finalSettlements', id: 'fs-1', data: rec(c, 'fs-1', { employeeId: 'emp-1' }) },
    {
      tbl: 'complianceDocuments',
      id: 'doc-emp',
      data: rec(c, 'doc-emp', { employeeId: 'emp-1', type: 'passport' }),
    },
    {
      tbl: 'complianceDocuments',
      id: 'doc-co',
      data: rec(c, 'doc-co', { employeeId: null, type: 'commercial_licence' }),
    },
    { tbl: 'renewals', id: 'ren-emp', data: rec(c, 'ren-emp', { employeeId: 'emp-1' }) },
    { tbl: 'renewals', id: 'ren-co', data: rec(c, 'ren-co', { employeeId: null }) },
    { tbl: 'journals', id: 'j-payroll', data: rec(c, 'j-payroll', { kind: 'payroll' }) },
    { tbl: 'journals', id: 'j-manual', data: rec(c, 'j-manual', { number: 'MJ-1' }) },
    { tbl: 'journals', id: 'j-transfer', data: rec(c, 'j-transfer', { kind: 'transfer' }) },
    { tbl: 'attachments', id: 'att-receipt', data: rec(c, 'att-receipt', { ownerId: 'inv-1' }) },
    { tbl: 'attachments', id: 'att-emp', data: rec(c, 'att-emp', { ownerId: 'emp-1' }) },
    { tbl: 'attachments', id: 'att-doc', data: rec(c, 'att-doc', { ownerId: 'doc-emp' }) },
    {
      tbl: 'attachments',
      id: 'att-marked',
      data: rec(c, 'att-marked', { ownerId: 'unknown', _private: true }),
    },
    {
      tbl: 'activities',
      id: 'act-inv',
      data: rec(c, 'act-inv', { entity: 'invoice', entityId: 'inv-1' }),
    },
    {
      tbl: 'activities',
      id: 'act-emp',
      data: rec(c, 'act-emp', { entity: 'employee', entityId: 'emp-1' }),
    },
    {
      tbl: 'activities',
      id: 'act-pay',
      data: rec(c, 'act-pay', { entity: 'payroll', entityId: 'run-1' }),
    },
    {
      tbl: 'activities',
      id: 'act-ren',
      data: rec(c, 'act-ren', { entity: 'compliance', entityId: 'ren-emp' }),
    },
    {
      tbl: 'activities',
      id: 'act-co',
      data: rec(c, 'act-co', { entity: 'compliance', entityId: 'doc-co' }),
    },
  ]);
}

const PRIVATE = [
  'emp-1',
  'run-1',
  'leave-1',
  'loan-1',
  'fs-1',
  'doc-emp',
  'ren-emp',
  'j-payroll',
  'att-emp',
  'att-doc',
  'att-marked',
  'act-emp',
  'act-pay',
  'act-ren',
];

async function visibleIds(user: string, company: string): Promise<Set<string>> {
  return new Set((await pull(user, company)).map((r) => r.id));
}

describe('accounts', () => {
  it('give every new account a profile it alone can read and change', async () => {
    const a = await h.user('profile-a@example.com', { name: 'Fatima' });
    const b = await h.user('profile-b@example.com', { name: 'Yousef' });
    const mine = await h.as(a, (q) => q('select full_name, email, language from public.profiles'));
    expect(mine).toEqual([{ full_name: 'Fatima', email: 'profile-a@example.com', language: 'en' }]);
    await h.as(a, (q) =>
      q(`update public.profiles set full_name = 'Fatima Al-Sabah', language = 'ar' where id = $1`, [
        a,
      ]),
    );
    const [updated] = await h.admin<{ full_name: string; language: string }>(
      'select full_name, language from public.profiles where id = $1',
      [a],
    );
    expect(updated).toEqual({ full_name: 'Fatima Al-Sabah', language: 'ar' });
    // Someone else's profile: invisible and unchanged.
    await h.as(a, (q) => q(`update public.profiles set full_name = 'X' where id = $1`, [b]));
    const [other] = await h.admin<{ full_name: string }>(
      'select full_name from public.profiles where id = $1',
      [b],
    );
    expect(other.full_name).toBe('Yousef');
    // The email follows the account; it can't be edited.
    await expect(
      h.as(a, (q) => q(`update public.profiles set email = 'x@example.com' where id = $1`, [a])),
    ).rejects.toThrow(/permission denied/);
  });

  it('keep anonymous visitors out of every table and function', async () => {
    for (const table of [
      'records',
      'companies',
      'company_members',
      'profiles',
      'company_invites',
    ]) {
      await expect(h.as(null, (q) => q(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
    await expect(h.rpc(null, 'my_companies')).rejects.toThrow(/permission denied/);
    await expect(
      h.rpc(null, 'pull_records', { p_company: 'company-0001', p_since: 0 }),
    ).rejects.toThrow(/permission denied/);
  });

  it('do not expose the helper functions or the change counter', async () => {
    const someone = await h.user('helper@example.com');
    await expect(
      h.as(someone, (q) => q(`select almailbooks.purge_all_deleted_records()`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(someone, (q) => q(`select nextval('public.records_rev_seq')`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.as(someone, (q) =>
        q(`insert into public.company_members values ('company-0001', $1, 'owner')`, [someone]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('companies', () => {
  it('are created with their creator as owner', async () => {
    const owner = await h.user('creator@example.com');
    const rows = await h.rpc(owner, 'create_company', {
      p_id: 'created-0001',
      p_name: ' Al Mail ',
    });
    expect(rows).toEqual([{ id: 'created-0001', name: 'Al Mail', role: 'owner' }]);
    const mine = await h.rpc(owner, 'my_companies');
    expect(mine).toEqual([
      expect.objectContaining({ id: 'created-0001', name: 'Al Mail', role: 'owner', members: 1 }),
    ]);
    // Again by the owner: only renames.
    await h.rpc(owner, 'create_company', { p_id: 'created-0001', p_name: 'Al Mail Group' });
    expect((await h.rpc(owner, 'my_companies'))[0]).toMatchObject({ name: 'Al Mail Group' });
  });

  it('cannot be taken over by creating the same id', async () => {
    const owner = await h.user('first@example.com');
    const thief = await h.user('second@example.com');
    await h.rpc(owner, 'create_company', { p_id: 'taken-00001', p_name: 'First' });
    await expect(
      h.rpc(thief, 'create_company', { p_id: 'taken-00001', p_name: 'Mine now' }),
    ).rejects.toThrow(/almail:company_taken/);
    expect(await h.rpc(thief, 'my_companies')).toEqual([]);
    await expect(h.rpc(thief, 'create_company', { p_id: 'bad id!', p_name: 'X' })).rejects.toThrow(
      /almail:invalid/,
    );
  });
});

describe('records', () => {
  it('get a new rev on every write, and a pull returns only what is newer', async () => {
    const t = await team();
    const c = t.company;
    const first = await push(t.owner, c, [
      { tbl: 'clients', id: 'a', data: rec(c, 'a', { name: 'A' }) },
      { tbl: 'clients', id: 'b', data: rec(c, 'b', { name: 'B' }) },
    ]);
    expect(first[1].rev).toBeGreaterThan(first[0].rev);
    const cursor = first[1].rev;
    const second = await push(t.admin, c, [
      { tbl: 'clients', id: 'a', data: rec(c, 'a', { name: 'A2' }), base_rev: first[0].rev },
    ]);
    expect(second[0].rev).toBeGreaterThan(cursor);
    expect(second[0].conflict).toBe(false);
    const newer = await pull(t.viewer, c, cursor);
    expect(newer.map((r) => [r.id, r.data.name])).toEqual([['a', 'A2']]);
    // The server sets who and when, whatever the app sends.
    const [row] = await h.admin<{ updated_by: string }>(
      `select updated_by from public.records where company_id = $1 and id = 'a'`,
      [c],
    );
    expect(row.updated_by).toBe(t.admin);
  });

  it('come in pages, oldest first', async () => {
    const t = await team();
    const c = t.company;
    await push(
      t.owner,
      c,
      Array.from({ length: 7 }, (_, i) => ({
        tbl: 'products',
        id: `p${i}`,
        data: rec(c, `p${i}`),
      })),
    );
    const page1 = await pull(t.owner, c, 0, 3);
    const page2 = await pull(t.owner, c, page1[2].rev, 3);
    const page3 = await pull(t.owner, c, page2[2].rev, 3);
    expect([...page1, ...page2, ...page3].map((r) => r.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => `p${i}`),
    );
    expect(page3).toHaveLength(1);
  });

  it('report a conflict when the server had a newer version, and the push still wins', async () => {
    const t = await team();
    const c = t.company;
    const [v1] = await push(t.owner, c, [
      { tbl: 'clients', id: 'x', data: rec(c, 'x', { name: 'One' }) },
    ]);
    const [v2] = await push(t.admin, c, [
      { tbl: 'clients', id: 'x', data: rec(c, 'x', { name: 'Two' }), base_rev: v1.rev },
    ]);
    expect(v2.conflict).toBe(false);
    // The owner still edits version one.
    const [v3] = await push(t.owner, c, [
      { tbl: 'clients', id: 'x', data: rec(c, 'x', { name: 'Three' }), base_rev: v1.rev },
    ]);
    expect(v3.conflict).toBe(true);
    const [now] = await pull(t.owner, c, v2.rev);
    expect(now.data.name).toBe('Three');
    // Sending what the server already has is not a conflict.
    const [same] = await push(t.admin, c, [
      { tbl: 'clients', id: 'x', data: rec(c, 'x', { name: 'Three' }), base_rev: v1.rev },
    ]);
    expect(same.conflict).toBe(false);
  });

  it('must belong to the company they are stored under', async () => {
    const t = await team();
    const c = t.company;
    await expect(
      push(t.owner, c, [{ tbl: 'clients', id: 'y', data: rec('another-company', 'y') }]),
    ).rejects.toThrow(/almail:invalid/);
    await expect(
      push(t.owner, c, [{ tbl: 'clients', id: 'y', data: rec(c, 'not-y') }]),
    ).rejects.toThrow(/almail:invalid/);
    await expect(
      push(t.owner, c, [{ tbl: 'secrets', id: 'y', data: rec(c, 'y') }]),
    ).rejects.toThrow(/records_tbl_check/);
  });

  it('larger than about 1 MB are refused, and a refused batch saves nothing', async () => {
    const t = await team();
    const c = t.company;
    await expect(
      push(t.owner, c, [
        { tbl: 'clients', id: 'small', data: rec(c, 'small') },
        { tbl: 'clients', id: 'big', data: rec(c, 'big', { notes: 'x'.repeat(1_100_000) }) },
      ]),
    ).rejects.toThrow(/almail:too_large/);
    expect(await pull(t.owner, c)).toEqual([]);
  });
});

describe('roles', () => {
  let t: Awaited<ReturnType<typeof team>>;
  beforeAll(async () => {
    t = await team();
    await seed(t);
  });

  it('let owners, admins and accountants read everything', async () => {
    for (const user of [t.owner, t.admin, t.accountant]) {
      const ids = await visibleIds(user, t.company);
      for (const id of PRIVATE) expect(ids, id).toContain(id);
      expect(ids).toContain('inv-1');
    }
  });

  it('never show staff or viewers payroll, people data or employee documents', async () => {
    for (const user of [t.staff, t.viewer]) {
      const ids = await visibleIds(user, t.company);
      for (const id of PRIVATE) expect(ids, id).not.toContain(id);
      for (const id of ['inv-1', 'client-1', 'acc-1', 'doc-co', 'ren-co', 'j-manual', 'j-transfer'])
        expect(ids, id).toContain(id);
      expect(ids).toContain('att-receipt');
      expect(ids).toContain('act-inv');
      expect(ids).toContain('act-co');
      expect(ids).not.toContain(`${t.company}-payroll`);
      expect(ids).not.toContain(`${t.company}-people`);
      // Not through a plain select either.
      const direct = await h.as(user, (q) =>
        q<{ id: string }>(`select id from public.records where company_id = $1`, [t.company]),
      );
      for (const id of PRIVATE) expect(direct.map((r) => r.id)).not.toContain(id);
    }
  });

  it('let staff work on sales, purchases, cheques, stock and files', async () => {
    const c = t.company;
    const rows = await push(t.staff, c, [
      { tbl: 'documents', id: 'inv-staff', data: rec(c, 'inv-staff') },
      { tbl: 'payments', id: 'pay-staff', data: rec(c, 'pay-staff') },
      { tbl: 'expenses', id: 'exp-staff', data: rec(c, 'exp-staff') },
      { tbl: 'securityCheques', id: 'chq-staff', data: rec(c, 'chq-staff') },
      { tbl: 'stockMovements', id: 'sm-staff', data: rec(c, 'sm-staff') },
      { tbl: 'attachments', id: 'att-staff', data: rec(c, 'att-staff', { ownerId: 'exp-staff' }) },
      { tbl: 'activities', id: 'act-staff', data: rec(c, 'act-staff', { entity: 'invoice' }) },
      { tbl: 'journals', id: 'j-staff', data: rec(c, 'j-staff', { kind: 'cheque_clearing' }) },
    ]);
    expect(rows).toHaveLength(8);
  });

  it('keep accounting setup, other journals and people data read only for staff', async () => {
    const c = t.company;
    const refused: Change[] = [
      { tbl: 'accounts', id: 'acc-1', data: rec(c, 'acc-1', { code: '9999' }) },
      { tbl: 'accounts', id: 'acc-new', data: rec(c, 'acc-new') },
      { tbl: 'taxRates', id: 'tax-new', data: rec(c, 'tax-new') },
      { tbl: 'journals', id: 'j-manual', data: rec(c, 'j-manual', { number: 'MJ-9' }) },
      { tbl: 'journals', id: 'j-new', data: rec(c, 'j-new', { kind: 'depreciation' }) },
      { tbl: 'journals', id: 'j-pay', data: rec(c, 'j-pay', { kind: 'payroll' }) },
      // A transfer can't be turned into another kind of journal.
      { tbl: 'journals', id: 'j-transfer', data: rec(c, 'j-transfer', { kind: 'year_end' }) },
      { tbl: 'employees', id: 'emp-2', data: rec(c, 'emp-2') },
      { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { basicSalary: 1 }) },
      { tbl: 'complianceDocuments', id: 'doc-x', data: rec(c, 'doc-x', { employeeId: 'emp-1' }) },
      { tbl: 'attachments', id: 'att-x', data: rec(c, 'att-x', { ownerId: 'emp-1' }) },
      { tbl: 'activities', id: 'act-x', data: rec(c, 'act-x', { entity: 'payroll' }) },
      { tbl: 'yearEnds', id: 'ye-1', data: rec(c, 'ye-1') },
      { tbl: 'bankTransactions', id: 'bt-1', data: rec(c, 'bt-1') },
    ];
    for (const change of refused) {
      await expect(push(t.staff, c, [change]), `${change.tbl} ${change.id}`).rejects.toThrow(
        /row-level security|almail:permission/,
      );
    }
    // Nothing changed.
    const [account] = await h.admin<{ data: { code: string } }>(
      `select data from public.records where company_id = $1 and id = 'acc-1'`,
      [c],
    );
    expect(account.data.code).toBe('1000');
  });

  it('let staff bump document numbers but not change company settings', async () => {
    const c = t.company;
    const bumped = companyRecord(c, { numbering: { invoice: rule(6), payment: rule(3) } });
    await push(t.staff, c, [{ tbl: 'companies', id: c, data: bumped }]);
    const [after] = await h.admin<{ data: { numbering: { invoice: { next: number } } } }>(
      `select data from public.records where company_id = $1 and tbl = 'companies'`,
      [c],
    );
    expect(after.data.numbering.invoice.next).toBe(6);
    await expect(
      push(t.staff, c, [{ tbl: 'companies', id: c, data: { ...bumped, currency: 'USD' } }]),
    ).rejects.toThrow(/almail:permission/);
    // Counters only: not the number format.
    await expect(
      push(t.staff, c, [
        {
          tbl: 'companies',
          id: c,
          data: companyRecord(c, {
            numbering: { invoice: rule(7, '2026', 'yearly', 'X-{counter}'), payment: rule(3) },
          }),
        },
      ]),
    ).rejects.toThrow(/almail:permission/);
    // A kind of document the company had no rule for yet can be numbered.
    await push(t.staff, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, {
          numbering: {
            invoice: rule(7),
            payment: rule(3),
            delivery_note: rule(2, '', 'never', 'DN-{counter}'),
          },
        }),
      },
    ]);
  });

  it('let viewers read but never write', async () => {
    const c = t.company;
    for (const change of [
      { tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1', { number: 'X' }) },
      { tbl: 'documents', id: 'inv-v', data: rec(c, 'inv-v') },
      { tbl: 'activities', id: 'act-v', data: rec(c, 'act-v', { entity: 'invoice' }) },
      { tbl: 'companies', id: c, data: companyRecord(c) },
      { tbl: 'documents', id: 'inv-1', deleted: true },
    ] satisfies Change[]) {
      await expect(push(t.viewer, c, [change])).rejects.toThrow(
        /row-level security|almail:permission/,
      );
    }
  });

  it('show non-members nothing', async () => {
    await expect(pull(t.outsider, t.company)).rejects.toThrow(/almail:not_member/);
    await expect(
      push(t.outsider, t.company, [{ tbl: 'clients', id: 'z', data: rec(t.company, 'z') }]),
    ).rejects.toThrow(/almail:not_member/);
    const direct = await h.as(t.outsider, (q) =>
      q(`select * from public.records where company_id = $1`, [t.company]),
    );
    expect(direct).toEqual([]);
    const companies = await h.as(t.outsider, (q) => q(`select * from public.companies`));
    expect(companies).toEqual([]);
    await expect(h.rpc(t.outsider, 'company_team', { p_company: t.company })).rejects.toThrow(
      /almail:not_member/,
    );
    // Writing straight into the table is refused too.
    await expect(
      h.as(t.outsider, (q) =>
        q(
          `insert into public.records (company_id, tbl, id, data) values ($1, 'clients', 'q', $2)`,
          [t.company, json(rec(t.company, 'q'))],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('document numbers', () => {
  it('never go down when two people number at once', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, { numbering: { invoice: rule(10), quote: rule(4) } }),
      },
    ]);
    // An admin whose copy is older sends a lower invoice counter and a newer quote counter.
    await push(t.admin, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, {
          name: 'Renamed',
          numbering: { invoice: rule(8), quote: rule(5) },
        }),
      },
    ]);
    const [row] = await h.admin<{
      data: { name: string; numbering: Record<string, { next: number; period: string }> };
    }>(`select data from public.records where company_id = $1 and tbl = 'companies'`, [c]);
    expect(row.data.name).toBe('Renamed');
    expect(row.data.numbering.invoice.next).toBe(10);
    expect(row.data.numbering.quote.next).toBe(5);
  });

  it('follow the later period, and keep counters the sender did not know about', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, {
          numbering: { invoice: rule(40, '2026'), employee: rule(12, '', 'never') },
        }),
      },
    ]);
    await push(t.admin, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, {
          numbering: { invoice: rule(2, '2027', 'yearly', 'S-{counter}') },
        }),
      },
    ]);
    let [row] = await h.admin<{ data: { numbering: Record<string, Record<string, unknown>> } }>(
      `select data from public.records where company_id = $1 and tbl = 'companies'`,
      [c],
    );
    expect(row.data.numbering.invoice).toMatchObject({
      next: 2,
      period: '2027',
      pattern: 'S-{counter}',
    });
    expect(row.data.numbering.employee).toMatchObject({ next: 12 });
    // A device still in last year can't take the counter back.
    await push(t.owner, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, { numbering: { invoice: rule(41, '2026') } }),
      },
    ]);
    [row] = await h.admin(
      `select data from public.records where company_id = $1 and tbl = 'companies'`,
      [c],
    );
    expect(row.data.numbering.invoice).toMatchObject({ next: 2, period: '2027' });
  });
});

describe('deletes', () => {
  it('remove the row and leave a marker without data', async () => {
    const t = await team();
    const c = t.company;
    const [created] = await push(t.owner, c, [
      { tbl: 'clients', id: 'gone', data: rec(c, 'gone', { name: 'Secret name' }) },
    ]);
    const [deleted] = await push(t.admin, c, [
      { tbl: 'clients', id: 'gone', deleted: true, base_rev: created.rev },
    ]);
    expect(deleted.conflict).toBe(false);
    expect(deleted.rev).toBeGreaterThan(created.rev);
    expect(
      await h.admin(`select * from public.records where company_id = $1 and id = 'gone'`, [c]),
    ).toEqual([]);
    const markers = await h.admin(`select * from public.deleted_records where company_id = $1`, [
      c,
    ]);
    expect(markers).toEqual([
      expect.objectContaining({ tbl: 'clients', id: 'gone', rev: deleted.rev, private: false }),
    ]);
    expect(JSON.stringify(markers)).not.toContain('Secret name');
    const pulled = await pull(t.viewer, c, created.rev);
    expect(pulled).toEqual([
      { tbl: 'clients', id: 'gone', data: null, rev: deleted.rev, deleted: true },
    ]);
  });

  it('need write permission for that kind of record', async () => {
    const t = await team();
    await seed(t);
    const c = t.company;
    await expect(
      push(t.staff, c, [{ tbl: 'accounts', id: 'acc-1', deleted: true }]),
    ).rejects.toThrow(/almail:permission/);
    await expect(
      push(t.viewer, c, [{ tbl: 'clients', id: 'client-1', deleted: true }]),
    ).rejects.toThrow(/almail:permission/);
    // Staff can't even see payroll rows, so their delete does nothing.
    await push(t.staff, c, [{ tbl: 'employees', id: 'emp-1', deleted: true }]);
    expect(
      await h.admin(`select id from public.records where company_id = $1 and id = 'emp-1'`, [c]),
    ).toHaveLength(1);
    // Nobody deletes the company record through sync.
    await expect(push(t.owner, c, [{ tbl: 'companies', id: c, deleted: true }])).rejects.toThrow(
      /almail:permission/,
    );
    // Staff can delete their own kind of work.
    await push(t.staff, c, [{ tbl: 'documents', id: 'inv-1', deleted: true }]);
    expect(
      await h.admin(`select id from public.records where company_id = $1 and id = 'inv-1'`, [c]),
    ).toEqual([]);
  });

  it('of payroll data leave markers staff and viewers cannot see', async () => {
    const t = await team();
    await seed(t);
    const c = t.company;
    const [marker] = await push(t.accountant, c, [
      { tbl: 'leaveRecords', id: 'leave-1', deleted: true },
    ]);
    expect((await pull(t.owner, c, marker.rev - 1)).map((r) => r.id)).toEqual(['leave-1']);
    expect(await pull(t.staff, c, marker.rev - 1)).toEqual([]);
    expect(await pull(t.viewer, c, marker.rev - 1)).toEqual([]);
  });

  it('are undone when another device saves the record again, with a conflict', async () => {
    const t = await team();
    const c = t.company;
    const [v1] = await push(t.owner, c, [{ tbl: 'clients', id: 'back', data: rec(c, 'back') }]);
    await push(t.admin, c, [{ tbl: 'clients', id: 'back', deleted: true, base_rev: v1.rev }]);
    const [again] = await push(t.owner, c, [
      {
        tbl: 'clients',
        id: 'back',
        data: rec(c, 'back', { name: 'Edited offline' }),
        base_rev: v1.rev,
      },
    ]);
    expect(again.conflict).toBe(true);
    expect(
      await h.admin(`select * from public.deleted_records where company_id = $1`, [c]),
    ).toEqual([]);
    expect((await pull(t.viewer, c, v1.rev)).map((r) => [r.id, r.deleted])).toEqual([
      ['back', false],
    ]);
  });

  it('of something never stored do nothing', async () => {
    const t = await team();
    const [row] = await push(t.owner, t.company, [{ tbl: 'clients', id: 'never', deleted: true }]);
    expect(row).toEqual({ tbl: 'clients', id: 'never', rev: null, conflict: false });
    expect(
      await h.admin(`select * from public.deleted_records where company_id = $1`, [t.company]),
    ).toEqual([]);
  });
});

describe('deletion markers', () => {
  it('are purged after 30 days, and devices that were away resync', async () => {
    const t = await team();
    const c = t.company;
    const [a] = await push(t.owner, c, [{ tbl: 'clients', id: 'old', data: rec(c, 'old') }]);
    const [keep] = await push(t.owner, c, [{ tbl: 'clients', id: 'keep', data: rec(c, 'keep') }]);
    const [gone] = await push(t.owner, c, [{ tbl: 'clients', id: 'old', deleted: true }]);
    await h.admin(
      `update public.deleted_records set deleted_at = now() - interval '31 days' where company_id = $1`,
      [c],
    );
    // A recent device is fine: nothing it needs was purged.
    expect(await pull(t.owner, c, gone.rev)).toEqual([]);
    const [info] = await h.rpc<{ purged_until_rev: number; record_count: number }>(
      t.owner,
      'company_sync_info',
      {
        p_company: c,
      },
    );
    expect(info.purged_until_rev).toBe(gone.rev);
    expect(info.record_count).toBe(1);
    expect(
      await h.admin(`select * from public.deleted_records where company_id = $1`, [c]),
    ).toEqual([]);
    // A device last seen before the delete must start over.
    await expect(pull(t.owner, c, a.rev)).rejects.toThrow(/almail:resync/);
    // Starting over: the ids that exist, then everything from the start.
    const ids = await h.rpc(t.owner, 'company_record_ids', { p_company: c });
    expect(ids).toEqual([{ tbl: 'clients', id: 'keep' }]);
    expect((await pull(t.owner, c, 0)).map((r) => r.rev)).toEqual([keep.rev]);
  });

  it('are also purged for every company by the daily job', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'clients', id: 'x', data: rec(c, 'x') }]);
    const [gone] = await push(t.owner, c, [{ tbl: 'clients', id: 'x', deleted: true }]);
    await h.admin(
      `update public.deleted_records set deleted_at = now() - interval '40 days' where company_id = $1`,
      [c],
    );
    await h.admin('select almailbooks.purge_all_deleted_records()');
    const [company] = await h.admin<{ purged_until_rev: number }>(
      'select purged_until_rev from public.companies where id = $1',
      [c],
    );
    expect(company.purged_until_rev).toBe(gone.rev);
  });

  it('list record ids page by page, and only those the caller may read', async () => {
    const t = await team();
    await seed(t);
    const c = t.company;
    const all: { tbl: string; id: string }[] = [];
    let after = { tbl: '', id: '' };
    for (;;) {
      const page = await h.rpc<{ tbl: string; id: string }>(t.staff, 'company_record_ids', {
        p_company: c,
        p_after_tbl: after.tbl,
        p_after_id: after.id,
        p_limit: 4,
      });
      all.push(...page);
      if (page.length < 4) break;
      after = page[page.length - 1];
    }
    expect(all.map((r) => r.id)).not.toContain('emp-1');
    expect(all.map((r) => r.id)).toContain('inv-1');
    expect(new Set(all.map((r) => `${r.tbl}/${r.id}`)).size).toBe(all.length);
    const files = await h.rpc(t.owner, 'company_record_ids', {
      p_company: c,
      p_tbl: 'attachments',
    });
    expect(files.map((r) => r.id).sort()).toEqual([
      'att-doc',
      'att-emp',
      'att-marked',
      'att-receipt',
    ]);
  });
});

describe('invitations', () => {
  it('are created by owners and admins, never as owner', async () => {
    const t = await team();
    const c = t.company;
    const [invite] = await h.rpc<{ token: string; email: string; role: string }>(
      t.admin,
      'create_invite',
      {
        p_company: c,
        p_email: ' New.Person@Example.com ',
        p_role: 'staff',
      },
    );
    expect(invite.email).toBe('new.person@example.com');
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    for (const user of [t.accountant, t.staff, t.viewer, t.outsider]) {
      await expect(
        h.rpc(user, 'create_invite', { p_company: c, p_email: 'x@example.com', p_role: 'viewer' }),
      ).rejects.toThrow(/almail:permission/);
    }
    await expect(
      h.rpc(t.admin, 'create_invite', { p_company: c, p_email: 'x@example.com', p_role: 'owner' }),
    ).rejects.toThrow(/almail:invalid/);
    await expect(
      h.rpc(t.owner, 'create_invite', { p_company: c, p_email: 'not-an-email', p_role: 'viewer' }),
    ).rejects.toThrow(/almail:invalid/);
    const pending = await h.rpc(t.owner, 'list_invites', { p_company: c });
    expect(pending).toEqual([
      expect.objectContaining({ email: 'new.person@example.com', role: 'staff' }),
    ]);
    await expect(h.rpc(t.staff, 'list_invites', { p_company: c })).rejects.toThrow(
      /almail:permission/,
    );
    // Only owners and admins can read invitations, even straight from the table.
    expect(await h.as(t.accountant, (q) => q('select * from public.company_invites'))).toEqual([]);
  });

  it('only let the invited, confirmed address join, once', async () => {
    const t = await team();
    const c = t.company;
    const invitee = await h.user(`invitee-${t.tag}@example.com`, { confirmed: false });
    const other = await h.user(`other-${t.tag}@example.com`);
    const [invite] = await h.rpc<{ token: string }>(t.owner, 'create_invite', {
      p_company: c,
      p_email: `Invitee-${t.tag}@example.com`,
      p_role: 'accountant',
    });
    // Someone else holding the link can't use it.
    await expect(h.rpc(other, 'accept_invite', { p_token: invite.token })).rejects.toThrow(
      /almail:invite_wrong_email/,
    );
    const [details] = await h.rpc<{ status: string; email_matches: boolean; company_name: string }>(
      other,
      'invite_details',
      { p_token: invite.token },
    );
    expect(details).toMatchObject({ status: 'pending', email_matches: false });
    // The right address, not confirmed yet.
    await expect(h.rpc(invitee, 'accept_invite', { p_token: invite.token })).rejects.toThrow(
      /almail:email_unconfirmed/,
    );
    await h.admin('update auth.users set email_confirmed_at = now() where id = $1', [invitee]);
    const [joined] = await h.rpc(invitee, 'accept_invite', { p_token: invite.token });
    expect(joined).toEqual({ company_id: c, company_name: expect.any(String), role: 'accountant' });
    // Used once.
    await expect(h.rpc(invitee, 'accept_invite', { p_token: invite.token })).rejects.toThrow(
      /almail:invite_used/,
    );
    await expect(h.rpc(invitee, 'accept_invite', { p_token: 'f'.repeat(64) })).rejects.toThrow(
      /almail:invite_invalid/,
    );
  });

  it('stop working when expired or cancelled', async () => {
    const t = await team();
    const c = t.company;
    const late = await h.user(`late-${t.tag}@example.com`);
    const [expired] = await h.rpc<{ token: string; id: string }>(t.owner, 'create_invite', {
      p_company: c,
      p_email: `late-${t.tag}@example.com`,
      p_role: 'viewer',
    });
    await h.admin(
      `update public.company_invites set expires_at = now() - interval '1 minute' where id = $1`,
      [expired.id],
    );
    await expect(h.rpc(late, 'accept_invite', { p_token: expired.token })).rejects.toThrow(
      /almail:invite_expired/,
    );
    const [cancelled] = await h.rpc<{ token: string; id: string }>(t.owner, 'create_invite', {
      p_company: c,
      p_email: `late-${t.tag}@example.com`,
      p_role: 'viewer',
    });
    await expect(h.rpc(t.staff, 'revoke_invite', { p_invite: cancelled.id })).rejects.toThrow(
      /almail:permission/,
    );
    await h.rpc(t.admin, 'revoke_invite', { p_invite: cancelled.id });
    await expect(h.rpc(late, 'accept_invite', { p_token: cancelled.token })).rejects.toThrow(
      /almail:invite_revoked/,
    );
    // A new link for the same person replaces the pending one.
    const [first] = await h.rpc<{ token: string }>(t.owner, 'create_invite', {
      p_company: c,
      p_email: `late-${t.tag}@example.com`,
      p_role: 'viewer',
    });
    await h.rpc(t.owner, 'create_invite', {
      p_company: c,
      p_email: `late-${t.tag}@example.com`,
      p_role: 'staff',
    });
    await expect(h.rpc(late, 'accept_invite', { p_token: first.token })).rejects.toThrow(
      /almail:invite_revoked/,
    );
    await expect(
      h.rpc(t.owner, 'create_invite', {
        p_company: c,
        p_email: `staff-${t.tag}@example.com`,
        p_role: 'viewer',
      }),
    ).rejects.toThrow(/almail:already_member/);
  });
});

describe('members', () => {
  it('see their team with names and emails', async () => {
    const t = await team();
    const people = await h.rpc<{ role: string; email: string; full_name: string }>(
      t.viewer,
      'company_team',
      {
        p_company: t.company,
      },
    );
    expect(people.map((p) => p.role)).toEqual(['owner', 'admin', 'accountant', 'staff', 'viewer']);
    expect(people[0]).toMatchObject({ full_name: 'Owner', email: `owner-${t.tag}@example.com` });
    // But not each other's profiles directly.
    expect(
      await h.as(t.viewer, (q) => q('select * from public.profiles where id = $1', [t.owner])),
    ).toEqual([]);
  });

  it('are managed by owners and admins, never touching the owner', async () => {
    const t = await team();
    const c = t.company;
    await h.rpc(t.admin, 'set_member_role', {
      p_company: c,
      p_user: t.staff,
      p_role: 'accountant',
    });
    await expect(
      h.rpc(t.admin, 'set_member_role', { p_company: c, p_user: t.owner, p_role: 'viewer' }),
    ).rejects.toThrow(/almail:permission/);
    await expect(
      h.rpc(t.admin, 'remove_member', { p_company: c, p_user: t.owner }),
    ).rejects.toThrow(/almail:permission/);
    await expect(
      h.rpc(t.admin, 'set_member_role', { p_company: c, p_user: t.viewer, p_role: 'owner' }),
    ).rejects.toThrow(/almail:invalid/);
    await expect(
      h.rpc(t.accountant, 'set_member_role', { p_company: c, p_user: t.viewer, p_role: 'admin' }),
    ).rejects.toThrow(/almail:permission/);
    await expect(
      h.rpc(t.staff, 'remove_member', { p_company: c, p_user: t.viewer }),
    ).rejects.toThrow(/almail:permission/);
    await h.rpc(t.admin, 'remove_member', { p_company: c, p_user: t.viewer });
    expect(await h.rpc(t.viewer, 'my_companies')).toEqual([]);
    await expect(pull(t.viewer, c)).rejects.toThrow(/almail:not_member/);
  });

  it('can leave, except the owner', async () => {
    const t = await team();
    const c = t.company;
    await h.rpc(t.staff, 'remove_member', { p_company: c, p_user: t.staff });
    expect(await h.rpc(t.staff, 'my_companies')).toEqual([]);
    await expect(
      h.rpc(t.owner, 'remove_member', { p_company: c, p_user: t.owner }),
    ).rejects.toThrow(/almail:permission/);
  });

  it('get a new owner only through a transfer by the owner', async () => {
    const t = await team();
    const c = t.company;
    await expect(
      h.rpc(t.admin, 'transfer_ownership', { p_company: c, p_user: t.admin }),
    ).rejects.toThrow(/almail:permission/);
    await h.rpc(t.owner, 'transfer_ownership', { p_company: c, p_user: t.accountant });
    const roles = Object.fromEntries(
      (
        await h.rpc<{ user_id: string; role: string }>(t.owner, 'company_team', { p_company: c })
      ).map((m) => [m.user_id, m.role]),
    );
    expect(roles[t.accountant]).toBe('owner');
    expect(roles[t.owner]).toBe('admin');
    // Still exactly one owner, even straight in the table.
    await expect(
      h.admin(
        `update public.company_members set role = 'owner' where company_id = $1 and user_id = $2`,
        [c, t.staff],
      ),
    ).rejects.toThrow(/company_members_one_owner/);
  });

  it('keep the company owned when the owner account is deleted', async () => {
    const t = await team();
    await h.admin('delete from auth.users where id = $1', [t.owner]);
    const people = await h.rpc<{ user_id: string; role: string }>(t.admin, 'company_team', {
      p_company: t.company,
    });
    expect(people.find((p) => p.user_id === t.admin)?.role).toBe('owner');
  });
});

describe('deleting a company', () => {
  it('is for the owner only and removes everything at once', async () => {
    const t = await team();
    await seed(t);
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'clients', id: 'client-1', deleted: true }]);
    for (const user of [t.admin, t.accountant, t.staff, t.outsider]) {
      await expect(h.rpc(user, 'delete_company', { p_company: c })).rejects.toThrow(
        /almail:permission/,
      );
    }
    await h.rpc(t.owner, 'create_invite', {
      p_company: c,
      p_email: 'later@example.com',
      p_role: 'viewer',
    });
    await h.rpc(t.owner, 'delete_company', { p_company: c });
    for (const table of [
      'records',
      'deleted_records',
      'company_members',
      'company_invites',
      'sync_signals',
    ]) {
      expect(
        await h.admin(`select * from public.${table} where company_id = $1`, [c]),
        table,
      ).toEqual([]);
    }
    expect(await h.admin('select * from public.companies where id = $1', [c])).toEqual([]);
    expect(await h.rpc(t.admin, 'my_companies')).toEqual([]);
  });
});

describe('files', () => {
  let t: Awaited<ReturnType<typeof team>>;
  beforeAll(async () => {
    t = await team();
    await seed(t);
  });

  // The statements Supabase Storage runs as the signed-in account: an upload
  // with upsert saves the row and reads it back, a removal deletes and reads
  // back what it removed, a download or listing selects.
  const upload = (user: string, name: string) =>
    h.as(user, (q) =>
      q(
        `insert into storage.objects as o (bucket_id, name, owner, owner_id, metadata, version)
         values ('company-files', $1, $2::uuid, $2, '{}', gen_random_uuid()::text)
         on conflict (name, bucket_id) do update
           set metadata = excluded.metadata, version = excluded.version,
               owner = excluded.owner, owner_id = excluded.owner_id
         returning o.name`,
        [name, user],
      ),
    );
  const remove = async (user: string, ...names: string[]) =>
    (
      await h.as(user, (q) =>
        q<{ name: string }>(
          `delete from storage.objects
           where bucket_id = 'company-files' and name = any($1::text[])
           returning name`,
          [names],
        ),
      )
    ).map((r) => r.name);
  const readable = async (user: string, name: string) =>
    (
      await h.as(user, (q) =>
        q(`select name from storage.objects where bucket_id = 'company-files' and name = $1`, [
          name,
        ]),
      )
    ).length === 1;
  const exists = async (name: string) =>
    (await h.admin('select 1 from storage.objects where name = $1', [name])).length === 1;

  it('are stored in a private bucket', async () => {
    const [bucket] = await h.admin<{ public: boolean }>(
      `select public from storage.buckets where id = 'company-files'`,
    );
    expect(bucket.public).toBe(false);
  });

  it('follow the attachment record they belong to', async () => {
    const c = t.company;
    await upload(t.staff, `${c}/att-receipt`);
    await upload(t.owner, `${c}/att-emp`);
    await upload(t.owner, `${c}/att-doc`);
    expect(await readable(t.viewer, `${c}/att-receipt`)).toBe(true);
    expect(await readable(t.staff, `${c}/att-receipt`)).toBe(true);
    for (const user of [t.staff, t.viewer]) {
      expect(await readable(user, `${c}/att-emp`)).toBe(false);
      expect(await readable(user, `${c}/att-doc`)).toBe(false);
    }
    expect(await readable(t.accountant, `${c}/att-emp`)).toBe(true);
    expect(await readable(t.outsider, `${c}/att-receipt`)).toBe(false);
  });

  it('can only be written by members who may change the record', async () => {
    const c = t.company;
    await expect(upload(t.viewer, `${c}/new-file`)).rejects.toThrow(/row-level security/);
    await expect(upload(t.outsider, `${c}/new-file`)).rejects.toThrow(/row-level security/);
    await expect(upload(t.staff, `${c}/att-emp`)).rejects.toThrow(/row-level security/);
    await expect(upload(t.staff, `${c}/nested/path/file`)).rejects.toThrow(/row-level security/);
    await expect(upload(t.staff, `file-at-root`)).rejects.toThrow(/row-level security/);
    // Staff can remove a receipt's file, not an employee's.
    expect(await remove(t.staff, `${c}/att-receipt`, `${c}/att-emp`)).toEqual([`${c}/att-receipt`]);
    expect(await remove(t.viewer, `${c}/att-doc`)).toEqual([]);
    expect(await exists(`${c}/att-emp`)).toBe(true);
  });

  it('let staff upload before the record is synced, and nobody else see it meanwhile', async () => {
    const t2 = await team();
    const c = t2.company;
    const staff2 = await h.user(`staff2-${t2.tag}@example.com`);
    const [invite] = await h.rpc<{ token: string }>(t2.owner, 'create_invite', {
      p_company: c,
      p_email: `staff2-${t2.tag}@example.com`,
      p_role: 'staff',
    });
    await h.rpc(staff2, 'accept_invite', { p_token: invite.token });

    // The app uploads the file first, then sends the attachment record.
    expect(await upload(t2.staff, `${c}/att-new`)).toEqual([{ name: `${c}/att-new` }]);
    expect(await upload(t2.staff, `${c}/att-new`)).toEqual([{ name: `${c}/att-new` }]);
    expect(await readable(t2.staff, `${c}/att-new`)).toBe(true);
    expect(await readable(staff2, `${c}/att-new`)).toBe(false);
    expect(await readable(t2.viewer, `${c}/att-new`)).toBe(false);
    expect(await readable(t2.accountant, `${c}/att-new`)).toBe(true);
    await expect(upload(staff2, `${c}/att-new`)).rejects.toThrow(/row-level security/);
    expect(await remove(staff2, `${c}/att-new`)).toEqual([]);

    // The owner's upload on its way (it may be an employee's passport).
    await upload(t2.owner, `${c}/att-passport`);
    expect(await readable(t2.staff, `${c}/att-passport`)).toBe(false);
    await expect(upload(t2.staff, `${c}/att-passport`)).rejects.toThrow(/row-level security/);
    expect(await remove(t2.staff, `${c}/att-passport`)).toEqual([]);

    await push(t2.staff, c, [
      { tbl: 'attachments', id: 'att-new', data: rec(c, 'att-new', { ownerId: 'bill-1' }) },
    ]);
    expect(await readable(staff2, `${c}/att-new`)).toBe(true);
    expect(await readable(t2.viewer, `${c}/att-new`)).toBe(true);
  });

  it('of a payment are uploaded by staff, and only seen by viewers', async () => {
    const t2 = await team();
    const c = t2.company;
    await push(t2.staff, c, [
      { tbl: 'payments', id: 'pay-1', data: rec(c, 'pay-1', { method: 'cheque', amount: 120 }) },
    ]);
    // A scan of the cheque: the file first, then its record (can_use_file).
    expect(await upload(t2.staff, `${c}/att-pay`)).toEqual([{ name: `${c}/att-pay` }]);
    await push(t2.staff, c, [
      { tbl: 'attachments', id: 'att-pay', data: rec(c, 'att-pay', { ownerId: 'pay-1' }) },
    ]);
    for (const user of [t2.owner, t2.accountant, t2.staff, t2.viewer]) {
      expect(await readable(user, `${c}/att-pay`)).toBe(true);
      expect(await visibleIds(user, c)).toContain('att-pay');
    }
    expect(await readable(t2.outsider, `${c}/att-pay`)).toBe(false);
    // Viewers can't add a scan, replace one or remove one.
    await expect(upload(t2.viewer, `${c}/att-pay-2`)).rejects.toThrow(/row-level security/);
    await expect(upload(t2.viewer, `${c}/att-pay`)).rejects.toThrow(/row-level security/);
    expect(await remove(t2.viewer, `${c}/att-pay`)).toEqual([]);
    await expect(
      push(t2.viewer, c, [
        { tbl: 'attachments', id: 'att-pay-2', data: rec(c, 'att-pay-2', { ownerId: 'pay-1' }) },
      ]),
    ).rejects.toThrow(/row-level security|almail:permission/);
    // Staff delete the payment with its scan: the records, then the file.
    await push(t2.staff, c, [
      { tbl: 'payments', id: 'pay-1', deleted: true },
      { tbl: 'attachments', id: 'att-pay', deleted: true },
    ]);
    expect(await remove(t2.staff, `${c}/att-pay`)).toEqual([`${c}/att-pay`]);
    expect(await exists(`${c}/att-pay`)).toBe(false);
  });

  it('can be removed after their record is deleted, private ones only by those who saw them', async () => {
    const t2 = await team();
    const c = t2.company;
    await seed(t2);
    await upload(t2.staff, `${c}/att-receipt`);
    await upload(t2.owner, `${c}/att-emp`);

    // Staff delete a receipt: its record goes first, then its file.
    await push(t2.staff, c, [{ tbl: 'attachments', id: 'att-receipt', deleted: true }]);
    expect(await remove(t2.staff, `${c}/att-receipt`)).toEqual([`${c}/att-receipt`]);
    expect(await exists(`${c}/att-receipt`)).toBe(false);

    // An employee's scan stays out of reach of staff even once its record is gone.
    await push(t2.owner, c, [{ tbl: 'attachments', id: 'att-emp', deleted: true }]);
    expect(await readable(t2.staff, `${c}/att-emp`)).toBe(false);
    await expect(upload(t2.staff, `${c}/att-emp`)).rejects.toThrow(/row-level security/);
    expect(await remove(t2.staff, `${c}/att-emp`)).toEqual([]);
    expect(await remove(t2.viewer, `${c}/att-emp`)).toEqual([]);
    expect(await remove(t2.owner, `${c}/att-emp`)).toEqual([`${c}/att-emp`]);
  });
});

describe('realtime', () => {
  it('tells members that something changed, without broadcasting records', async () => {
    const tables = await h.admin<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
    );
    expect(tables.map((r) => r.tablename)).toEqual(['sync_signals']);
    const t = await team();
    const [row] = await push(t.owner, t.company, [
      { tbl: 'clients', id: 's', data: rec(t.company, 's') },
    ]);
    const signal = await h.as(t.viewer, (q) =>
      q<{ rev: number }>('select rev from public.sync_signals where company_id = $1', [t.company]),
    );
    expect(signal).toEqual([{ rev: row.rev }]);
    expect(
      await h.as(t.outsider, (q) =>
        q('select * from public.sync_signals where company_id = $1', [t.company]),
      ),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 20261006000000_sync_fixes.sql                                              */
/* -------------------------------------------------------------------------- */

const putFile = (user: string, name: string) =>
  h.as(user, (q) =>
    q(
      `insert into storage.objects as o (bucket_id, name, owner, owner_id, metadata, version)
       values ('company-files', $1, $2::uuid, $2, '{}', gen_random_uuid()::text)
       on conflict (name, bucket_id) do update set version = excluded.version
       returning o.name`,
      [name, user],
    ),
  );

const dropFiles = async (user: string, ...names: string[]) =>
  (
    await h.as(user, (q) =>
      q<{ name: string }>(
        `delete from storage.objects
         where bucket_id = 'company-files' and name = any($1::text[])
         returning name`,
        [names],
      ),
    )
  ).map((r) => r.name);

async function companyRow(company: string) {
  const [row] = await h.admin<{ data: Record<string, unknown>; rev: number }>(
    `select data, rev from public.records where company_id = $1 and tbl = 'companies'`,
    [company],
  );
  return row;
}

function patch(user: string, company: string, ops: unknown[]) {
  return h.rpc<{ rev: number; conflicts: string[][] }>(user, 'patch_company', {
    p_company: company,
    p_ops: json(ops),
  });
}

const counters = (next: number, before: number, period = '2026') => [
  { path: ['numbering', 'invoice', 'next'], value: next, base: before },
  { path: ['numbering', 'invoice', 'period'], value: period, base: period },
];

describe('company settings sent by field (patch_company)', () => {
  it('lay a device’s changes over the cloud’s copy, keeping what others changed', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, { phone: '', accounting: { lockDate: null } }),
      },
    ]);
    // The accountant locks the books on their device.
    await patch(t.accountant, c, [
      { path: ['accounting', 'lockDate'], value: '2026-09-30', base: null },
    ]);
    // An admin's device, not yet in step, changes the phone and numbers an invoice.
    const [row] = await patch(t.admin, c, [
      { path: ['phone'], value: '+965 2222 0000', base: '' },
      ...counters(6, 5),
    ]);
    expect(row.conflicts).toEqual([]);
    const { data, rev } = await companyRow(c);
    expect(Number(rev)).toBe(Number(row.rev));
    expect(data).toMatchObject({
      phone: '+965 2222 0000',
      accounting: { lockDate: '2026-09-30' },
      numbering: { invoice: { next: 6 }, payment: { next: 3 } },
    });
  });

  it('report the fields both sides changed, and never take a counter back', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      {
        tbl: 'companies',
        id: c,
        data: companyRecord(c, { phone: '+965 1111 0000', numbering: { invoice: rule(9) } }),
      },
    ]);
    const [row] = await patch(t.admin, c, [
      { path: ['phone'], value: '+965 3333 0000', base: '' },
      ...counters(6, 5),
    ]);
    expect(row.conflicts).toEqual([['phone']]);
    const { data } = await companyRow(c);
    expect(data).toMatchObject({ phone: '+965 3333 0000', numbering: { invoice: { next: 9 } } });
    // A field removed here goes; setting a field to what it is changes nothing.
    await patch(t.owner, c, [{ path: ['phone'], remove: true, base: '+965 3333 0000' }]);
    expect((await companyRow(c)).data).not.toHaveProperty('phone');
    const before = (await companyRow(c)).rev;
    const [same] = await patch(t.owner, c, [{ path: ['name'], value: 'Acme', base: 'Acme' }]);
    expect(Number(same.rev)).toBe(Number(before));
  });

  it('let staff move counters on an older copy, and nothing else', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: companyRecord(c, { phone: '' }) }]);
    await patch(t.owner, c, [{ path: ['phone'], value: '+965 2222 0000', base: '' }]);
    const [row] = await patch(t.staff, c, counters(6, 5));
    expect(row.conflicts).toEqual([]);
    expect((await companyRow(c)).data).toMatchObject({
      phone: '+965 2222 0000',
      numbering: { invoice: { next: 6 } },
    });
    await expect(
      patch(t.staff, c, [{ path: ['phone'], value: '+965 9999 0000', base: '+965 2222 0000' }]),
    ).rejects.toThrow(/almail:permission/);
    await expect(patch(t.viewer, c, counters(7, 6))).rejects.toThrow(/almail:permission/);
    await expect(patch(t.outsider, c, counters(7, 6))).rejects.toThrow(/almail:not_member/);
    await expect(patch(t.owner, c, [{ path: ['id'], value: 'other-id' }])).rejects.toThrow(
      /almail:invalid/,
    );
  });

  it('answer nothing when the company record is not in the cloud yet', async () => {
    const t = await team();
    expect(await patch(t.owner, t.company, counters(6, 5))).toEqual([]);
  });
});

describe('document numbers taken in the cloud (reserve_number)', () => {
  const reserve = (user: string, company: string, date: string, min = 1, kind = 'invoice') =>
    h.rpc<{ counter: number; period: string }>(user, 'reserve_number', {
      p_company: company,
      p_kind: kind,
      p_date: date,
      p_min: min,
    });

  it('are given once each, never below the device’s own counter, and follow the period', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: companyRecord(c) }]);
    const taken = async (user: string, date: string, min = 1) =>
      (await reserve(user, c, date, min)).map((r) => [Number(r.counter), r.period]);
    expect(await taken(t.staff, '2026-10-05')).toEqual([[5, '2026']]);
    expect(await taken(t.owner, '2026-10-05')).toEqual([[6, '2026']]);
    // The device skips numbers it has used itself (typed by hand, say).
    expect(await taken(t.accountant, '2026-10-06', 20)).toEqual([[20, '2026']]);
    expect(await taken(t.staff, '2026-10-06')).toEqual([[21, '2026']]);
    // A new year starts again; a document of the year before is numbered on the device.
    expect(await taken(t.staff, '2027-01-02')).toEqual([[1, '2027']]);
    expect(await taken(t.staff, '2026-12-30')).toEqual([]);
    expect((await companyRow(c)).data).toMatchObject({
      numbering: { invoice: { next: 2, period: '2027' } },
    });
    // No rule for this kind yet: numbered on the device.
    expect(await reserve(t.owner, c, '2027-01-02', 1, 'delivery_note')).toEqual([]);
    await expect(reserve(t.viewer, c, '2027-01-02')).rejects.toThrow(/almail:permission/);
    await expect(reserve(t.owner, c, 'tomorrow')).rejects.toThrow(/almail:invalid/);
  });

  it('give item codes (product) once the company has their rule, staff’s too', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: companyRecord(c) }]);
    const codes = async (user: string, min = 1) =>
      (await reserve(user, c, '2026-10-05', min, 'product')).map((r) => Number(r.counter));
    // No rule yet (codes are off, or switched on by an older copy): given on the device.
    expect(await codes(t.staff)).toEqual([]);
    // Staff giving the first code add its rule: a counter, which staff may change.
    const sku = { pattern: 'SKU-{counter}', next: 2, padding: 5, reset: 'never', period: '' };
    const [{ data }] = await pull(t.staff, c).then((rows) =>
      rows.filter((r) => r.tbl === 'companies'),
    );
    await push(t.staff, c, [
      {
        tbl: 'companies',
        id: c,
        data: { ...data, numbering: { ...(data.numbering as object), product: sku } },
      },
    ]);
    expect((await companyRow(c)).data).toMatchObject({ numbering: { product: { next: 2 } } });
    // From then on the cloud gives them, to anyone who may add items.
    expect(await codes(t.staff)).toEqual([2]);
    expect(await codes(t.owner)).toEqual([3]);
    expect(await codes(t.accountant, 10)).toEqual([10]);
    expect(await codes(t.staff)).toEqual([11]);
    expect((await companyRow(c)).data).toMatchObject({
      numbering: { product: { next: 12, period: '' }, invoice: { next: 5 } },
    });
    await expect(reserve(t.viewer, c, '2026-10-05', 1, 'product')).rejects.toThrow(
      /almail:permission/,
    );
  });
});

describe('deleting a company, files first (begin_delete_company)', () => {
  it('checks the owner before any file is removed, and stops new uploads meanwhile', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      { tbl: 'companies', id: c, data: companyRecord(c) },
      { tbl: 'attachments', id: 'att-receipt', data: rec(c, 'att-receipt', { ownerId: 'inv-1' }) },
    ]);
    await putFile(t.owner, `${c}/att-receipt`);
    // Ownership moved on; the former owner's device still says "owner".
    await h.rpc(t.owner, 'transfer_ownership', { p_company: c, p_user: t.admin });
    await expect(h.rpc(t.owner, 'begin_delete_company', { p_company: c })).rejects.toThrow(
      /almail:permission/,
    );
    expect(await h.rpc(t.admin, 'begin_delete_company', { p_company: c })).toEqual([
      { begin_delete_company: true },
    ]);
    // Meanwhile nobody uploads; removing still works.
    await expect(putFile(t.staff, `${c}/att-new`)).rejects.toThrow(/row-level security/);
    expect(await dropFiles(t.admin, `${c}/att-receipt`)).toEqual([`${c}/att-receipt`]);
    await h.rpc(t.admin, 'delete_company', { p_company: c });
    expect(await h.admin('select 1 from public.companies where id = $1', [c])).toEqual([]);
  });

  it('lets uploads in again when a deletion was started and not finished', async () => {
    const t = await team();
    const c = t.company;
    await h.rpc(t.owner, 'begin_delete_company', { p_company: c });
    await h.admin(
      `update public.companies set deleting_until = now() - interval '1 minute' where id = $1`,
      [c],
    );
    expect(await putFile(t.owner, `${c}/att-later`)).toEqual([{ name: `${c}/att-later` }]);
  });
});

describe('creating a company that is already in the cloud', () => {
  it('is refused, except an empty one of the owner’s own', async () => {
    const t = await team();
    const c = t.company;
    // Empty (an upload that stopped before its first record): taken up again.
    await h.rpc(t.owner, 'create_company', { p_id: c, p_name: 'Acme again' });
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: companyRecord(c) }]);
    for (const user of [t.owner, t.admin, t.viewer]) {
      await expect(h.rpc(user, 'create_company', { p_id: c, p_name: 'Old copy' })).rejects.toThrow(
        /almail:company_exists/,
      );
    }
    await expect(h.rpc(t.outsider, 'create_company', { p_id: c, p_name: 'Mine' })).rejects.toThrow(
      /almail:company_taken/,
    );
    expect((await h.rpc<{ name: string }>(t.owner, 'my_companies'))[0].name).toBe('Acme again');
  });
});

describe('files still stored (stored_files)', () => {
  it('tell members which files are still there, whatever they may see', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1') },
      { tbl: 'attachments', id: 'att-emp', data: rec(c, 'att-emp', { ownerId: 'emp-1' }) },
    ]);
    await putFile(t.owner, `${c}/att-emp`);
    const stored = await h.rpc<{ stored_files: string }>(t.staff, 'stored_files', {
      p_company: c,
      p_names: [`${c}/att-emp`, `${c}/gone`, `other-company/att-emp`],
    });
    expect(stored.map((r) => r.stored_files)).toEqual([`${c}/att-emp`]);
    await expect(
      h.rpc(t.outsider, 'stored_files', { p_company: c, p_names: [`${c}/att-emp`] }),
    ).rejects.toThrow(/almail:not_member/);
  });
});

describe('cheque printing', () => {
  const layout = (c: string, id: string, extra: Record<string, unknown> = {}) =>
    rec(c, id, {
      bank: 'BRGN',
      name: 'Burgan Bank',
      version: 2,
      size: { width: 178, height: 82 },
      offset: { x: 0, y: 0 },
      fields: { date: { x: 128, y: 8, width: 44, height: 7 } },
      dateStyle: 'boxes',
      wordsLanguage: 'ar',
      figures: { prefix: '', guard: '**' },
      calibrated: false,
      archived: false,
      ...extra,
    });

  it('lets accountants save cheque layouts, and staff and viewers only read them', async () => {
    const t = await team();
    const c = t.company;
    await push(t.accountant, c, [
      { tbl: 'chequeLayouts', id: 'lay-acc', data: layout(c, 'lay-acc') },
    ]);
    for (const user of [t.staff, t.viewer]) {
      expect(await visibleIds(user, c)).toContain('lay-acc');
      await expect(
        push(user, c, [
          { tbl: 'chequeLayouts', id: 'lay-acc', data: layout(c, 'lay-acc', { version: 3 }) },
        ]),
      ).rejects.toThrow(/row-level security|almail:permission/);
      await expect(
        push(user, c, [{ tbl: 'chequeLayouts', id: 'lay-new', data: layout(c, 'lay-new') }]),
      ).rejects.toThrow(/row-level security|almail:permission/);
    }
  });

  it('lets staff record a print on a cheque issued, but not switch printing on', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: companyRecord(c) }]);
    const cheque = {
      number: '100046',
      bank: 'BRGN',
      date: '2026-11-15',
      drawer: 'Example Supplies Co.',
      status: 'held',
      printedAt: '2026-10-21T08:00:00.000Z',
      printCount: 2,
      printedLayoutId: 'preset-BRGN',
      printedText: {
        date: '15/11/2026',
        payee: 'Example Supplies Co.',
        words: ['x'],
        figures: '**5.000**',
        layoutVersion: 1,
      },
      spoiledLeaves: [{ number: '100045', at: '2026-10-21T07:55:00.000Z', reason: 'Paper jam' }],
    };
    const rows = await push(t.staff, c, [
      {
        tbl: 'payments',
        id: 'pay-printed',
        data: rec(c, 'pay-printed', { direction: 'out', method: 'cheque', amount: 5, cheque }),
      },
    ]);
    expect(rows).toHaveLength(1);
    await expect(
      push(t.staff, c, [
        { tbl: 'companies', id: c, data: companyRecord(c, { chequePrinting: true }) },
      ]),
    ).rejects.toThrow(/almail:permission/);
    await push(t.accountant, c, [
      { tbl: 'companies', id: c, data: companyRecord(c, { chequePrinting: true }) },
    ]);
  });
});

describe('an app before the second migration', () => {
  it('finds none of the new functions, and works with the first file alone', async () => {
    const early = await startDatabase(1, 1);
    const owner = await early.user('early@example.com');
    await early.rpc(owner, 'create_company', { p_id: 'early-00001', p_name: 'Early' });
    for (const name of [
      'patch_company',
      'reserve_number',
      'begin_delete_company',
      'stored_files',
    ]) {
      await expect(early.rpc(owner, name, { p_company: 'early-00001' })).rejects.toThrow(
        /does not exist/,
      );
    }
    // Running the second file over it later keeps everything.
    await early.db.exec(readFileSync(MIGRATIONS[1], 'utf8'));
    expect(await early.rpc(owner, 'my_companies')).toEqual([
      expect.objectContaining({ id: 'early-00001', role: 'owner' }),
    ]);
  }, 60_000);
});
