// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, startDatabase, type Harness } from './sql-harness';
import { recordApp, type MemberPermissions, type MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';

/**
 * 20261116000000_super_admin_approvals.sql: the owner (the Super Admin) sets
 * limits per member and who else approves, and may keep admins and
 * accountants for themselves to make. Without any of it switched on, the team
 * works as before.
 */

const FILE = MIGRATIONS.find((file) => file.endsWith('_super_admin_approvals.sql'))!;

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
  const company = `sa-company-${String(companySeq).padStart(4, '0')}`;
  const tag = `sa-${companySeq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await db.user(`owner-${tag}@example.com`);
  const outsider = await db.user(`outsider-${tag}@example.com`);
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
  return { company, owner, admin, accountant, staff, viewer, outsider, tag };
}

type Team = Awaited<ReturnType<typeof team>>;
type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean };

function push(user: string, company: string, changes: Change[], db: Harness = h) {
  return db.rpc<{ tbl: string; id: string; rev: number }>(user, 'push_records', {
    p_company: company,
    p_changes: json(changes),
  });
}

function pull(user: string, company: string, db: Harness = h) {
  return db.rpc<{ tbl: string; id: string }>(user, 'pull_records', {
    p_company: company,
    p_since: 0,
    p_limit: 1000,
  });
}

const rec = (company: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  companyId: company,
  ...extra,
});

function limit(
  t: Team,
  user: string,
  apps: Record<string, string | undefined> | null,
  canApprove = false,
  db: Harness = h,
) {
  return db.rpc(t.owner, 'set_member_permissions', {
    p_company: t.company,
    p_user: user,
    p_permissions: json(apps ? { apps } : {}),
    p_can_approve: canApprove,
  });
}

async function invite(t: Team, by: string, role: string, db: Harness = h) {
  const email = `new-${role}-${Math.random().toString(36).slice(2, 8)}-${t.tag}@example.com`;
  const [made] = await db.rpc<{ id: string; token: string }>(by, 'create_invite', {
    p_company: t.company,
    p_email: email,
    p_role: role,
  });
  return { ...made, email };
}

async function roles(t: Team): Promise<Record<string, string>> {
  const people = await h.rpc<{ user_id: string; role: string }>(t.owner, 'company_team', {
    p_company: t.company,
  });
  return Object.fromEntries(people.map((p) => [p.user_id, p.role]));
}

describe('with nothing switched on', () => {
  it('lets admins invite, change and remove admins and accountants as before', async () => {
    const t = await team();
    const c = t.company;
    await invite(t, t.admin, 'admin');
    await invite(t, t.admin, 'accountant');
    await h.rpc(t.admin, 'set_member_role', { p_company: c, p_user: t.staff, p_role: 'admin' });
    await h.rpc(t.admin, 'set_member_role', {
      p_company: c,
      p_user: t.accountant,
      p_role: 'staff',
    });
    await h.rpc(t.admin, 'remove_member', { p_company: c, p_user: t.staff });
    expect(await roles(t)).toMatchObject({ [t.accountant]: 'staff' });
    expect((await roles(t))[t.staff]).toBeUndefined();
  });

  it('gives every member no limits and nobody but the owner approves', async () => {
    const t = await team();
    for (const user of [t.admin, t.accountant, t.staff, t.viewer]) {
      expect(await h.rpc(user, 'my_permissions', { p_company: t.company })).toEqual([
        {
          permissions: {},
          can_approve: false,
          is_owner: false,
          senior_roles_owner_only: false,
        },
      ]);
    }
    expect(await h.rpc(t.owner, 'my_permissions', { p_company: t.company })).toEqual([
      { permissions: {}, can_approve: true, is_owner: true, senior_roles_owner_only: false },
    ]);
    for (const [user, approves] of [
      [t.owner, true],
      [t.admin, false],
      [t.accountant, false],
      [t.staff, false],
      [t.viewer, false],
      [t.outsider, false],
    ] as const) {
      const [row] = await h.as(user, (q) =>
        q<{ yes: boolean }>('select almailbooks.is_approver($1) as yes', [t.company]),
      );
      expect(row.yes).toBe(approves);
    }
  });

  it('accepts the same pushes as before, an older app’s whole batch included', async () => {
    const t = await team();
    const c = t.company;
    const batch: Change[] = [
      { tbl: 'companies', id: c, data: { id: c, name: 'Acme', numbering: {} } },
      { tbl: 'clients', id: 'cl-1', data: rec(c, 'cl-1', { name: 'Gulf Pearl' }) },
      { tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1', { number: 'INV-1' }) },
      { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { name: 'Made-up Person' }) },
      { tbl: 'complianceDocuments', id: 'doc-1', data: rec(c, 'doc-1', { type: 'other' }) },
      { tbl: 'activities', id: 'act-1', data: rec(c, 'act-1', { entity: 'invoice' }) },
    ];
    expect(await push(t.accountant, c, batch)).toHaveLength(batch.length);
    // Again, as an upsert of rows that are there.
    expect(await push(t.admin, c, batch)).toHaveLength(batch.length);
    expect(
      await push(t.staff, c, [{ tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1') }]),
    ).toHaveLength(1);
    await push(t.accountant, c, [{ tbl: 'clients', id: 'cl-1', deleted: true }]);
    await expect(
      push(t.viewer, c, [{ tbl: 'clients', id: 'cl-2', data: rec(c, 'cl-2') }]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('the owner’s switch: only the owner makes admins and accountants', () => {
  it('is the owner’s alone to turn on and off', async () => {
    const t = await team();
    for (const user of [t.admin, t.accountant, t.staff, t.viewer, t.outsider]) {
      await expect(
        h.rpc(user, 'set_team_rules', { p_company: t.company, p_senior_roles_owner_only: true }),
      ).rejects.toThrow(/almail:permission/);
    }
    await h.rpc(t.owner, 'set_team_rules', {
      p_company: t.company,
      p_senior_roles_owner_only: true,
    });
    const [mine] = await h.rpc<{ senior_roles_owner_only: boolean }>(t.admin, 'my_permissions', {
      p_company: t.company,
    });
    expect(mine.senior_roles_owner_only).toBe(true);
    await h.rpc(t.owner, 'set_team_rules', {
      p_company: t.company,
      p_senior_roles_owner_only: false,
    });
    await invite(t, t.admin, 'accountant');
  });

  it('leaves admins inviting, changing and removing staff and viewers only', async () => {
    const t = await team();
    const c = t.company;
    const pending = await invite(t, t.owner, 'accountant');
    await h.rpc(t.owner, 'set_team_rules', { p_company: c, p_senior_roles_owner_only: true });

    for (const role of ['admin', 'accountant']) {
      await expect(invite(t, t.admin, role)).rejects.toThrow(/almail:permission/);
    }
    await invite(t, t.admin, 'staff');
    const viewerInvite = await invite(t, t.admin, 'viewer');
    await h.rpc(t.admin, 'revoke_invite', { p_invite: viewerInvite.id });
    await expect(h.rpc(t.admin, 'revoke_invite', { p_invite: pending.id })).rejects.toThrow(
      /almail:permission/,
    );

    for (const [user, role] of [
      [t.staff, 'accountant'],
      [t.staff, 'admin'],
      [t.accountant, 'staff'],
      [t.accountant, 'admin'],
    ]) {
      await expect(
        h.rpc(t.admin, 'set_member_role', { p_company: c, p_user: user, p_role: role }),
      ).rejects.toThrow(/almail:permission/);
    }
    await h.rpc(t.admin, 'set_member_role', { p_company: c, p_user: t.staff, p_role: 'viewer' });
    await h.rpc(t.admin, 'set_member_role', { p_company: c, p_user: t.staff, p_role: 'staff' });
    await expect(
      h.rpc(t.admin, 'remove_member', { p_company: c, p_user: t.accountant }),
    ).rejects.toThrow(/almail:permission/);
    await h.rpc(t.admin, 'remove_member', { p_company: c, p_user: t.viewer });

    // The owner does all of it.
    await invite(t, t.owner, 'admin');
    await h.rpc(t.owner, 'set_member_role', {
      p_company: c,
      p_user: t.staff,
      p_role: 'accountant',
    });
    await h.rpc(t.owner, 'remove_member', { p_company: c, p_user: t.staff });
    // An accountant may still leave by themselves.
    await h.rpc(t.accountant, 'remove_member', { p_company: c, p_user: t.accountant });
    expect(await roles(t)).toEqual({ [t.owner]: 'owner', [t.admin]: 'admin' });
  });

  it('cancels, once on, the invitations as admin or accountant someone else made', async () => {
    const t = await team();
    const byAdmin = await invite(t, t.admin, 'accountant');
    const staffByAdmin = await invite(t, t.admin, 'staff');
    const byOwner = await invite(t, t.owner, 'admin');
    await h.rpc(t.owner, 'set_team_rules', {
      p_company: t.company,
      p_senior_roles_owner_only: true,
    });
    const left = await h.rpc<{ id: string }>(t.owner, 'list_invites', { p_company: t.company });
    expect(left.map((i) => i.id).sort()).toEqual([staffByAdmin.id, byOwner.id].sort());
    expect(left.map((i) => i.id)).not.toContain(byAdmin.id);
  });

  it('moves with ownership: the new owner has the powers, the old one an admin’s', async () => {
    const t = await team();
    const c = t.company;
    await h.rpc(t.owner, 'set_team_rules', { p_company: c, p_senior_roles_owner_only: true });
    await limit(t, t.admin, { books: 'view' }, true);
    await h.rpc(t.owner, 'transfer_ownership', { p_company: c, p_user: t.admin });
    // The new owner has no limits, and approves as owner.
    expect(await h.rpc(t.admin, 'my_permissions', { p_company: c })).toEqual([
      { permissions: {}, can_approve: true, is_owner: true, senior_roles_owner_only: true },
    ]);
    await push(t.admin, c, [{ tbl: 'clients', id: 'cl-1', data: rec(c, 'cl-1') }]);
    await h.rpc(t.admin, 'set_member_permissions', {
      p_company: c,
      p_user: t.accountant,
      p_permissions: json({ apps: { people: 'none' } }),
      p_can_approve: false,
    });
    await expect(invite(t, t.owner, 'accountant')).rejects.toThrow(/almail:permission/);
    await expect(
      h.rpc(t.owner, 'set_member_permissions', {
        p_company: c,
        p_user: t.staff,
        p_permissions: '{}',
        p_can_approve: false,
      }),
    ).rejects.toThrow(/almail:permission/);
  });
});

describe('limits and approvers (set_member_permissions)', () => {
  it('are set by the owner alone, never on the owner', async () => {
    const t = await team();
    const c = t.company;
    for (const user of [t.admin, t.accountant, t.staff, t.viewer, t.outsider]) {
      await expect(
        h.rpc(user, 'set_member_permissions', {
          p_company: c,
          p_user: t.staff,
          p_permissions: json({ apps: { books: 'view' } }),
          p_can_approve: false,
        }),
      ).rejects.toThrow(/almail:permission/);
    }
    await expect(limit(t, t.owner, { books: 'view' })).rejects.toThrow(/almail:permission/);
    await expect(limit(t, t.outsider, { books: 'view' })).rejects.toThrow(/almail:invalid/);
    for (const bad of [
      { apps: { books: 'admin' } },
      { apps: { payroll: 'view' } },
      { apps: { books: 1 } },
      { apps: [] },
      { roles: {} },
      [],
    ]) {
      await expect(
        h.rpc(t.owner, 'set_member_permissions', {
          p_company: c,
          p_user: t.staff,
          p_permissions: json(bad),
          p_can_approve: false,
        }),
      ).rejects.toThrow(/almail:invalid/);
    }
    await limit(t, t.staff, { books: 'view', compliance: 'none' });
    expect(await h.rpc(t.staff, 'my_permissions', { p_company: c })).toEqual([
      {
        permissions: { apps: { books: 'view', compliance: 'none' } },
        can_approve: false,
        is_owner: false,
        senior_roles_owner_only: false,
      },
    ]);
    // Nothing limited is no limits.
    await limit(t, t.staff, {});
    const [row] = await h.rpc<{ permissions: unknown }>(t.staff, 'my_permissions', {
      p_company: c,
    });
    expect(row.permissions).toEqual({});
  });

  it('let up to two admins or accountants approve, and stop when their role changes', async () => {
    const t = await team();
    const c = t.company;
    await expect(limit(t, t.staff, null, true)).rejects.toThrow(/almail:invalid/);
    await expect(limit(t, t.viewer, null, true)).rejects.toThrow(/almail:invalid/);
    await limit(t, t.admin, null, true);
    await limit(t, t.accountant, null, true);
    const approves = async (user: string) =>
      (
        await h.as(user, (q) =>
          q<{ yes: boolean }>('select almailbooks.is_approver($1) as yes', [c]),
        )
      )[0].yes;
    expect(await approves(t.admin)).toBe(true);
    expect(await approves(t.accountant)).toBe(true);
    // A third one is too many.
    await h.rpc(t.owner, 'set_member_role', { p_company: c, p_user: t.staff, p_role: 'admin' });
    await expect(limit(t, t.staff, null, true)).rejects.toThrow(/almail:limit/);
    // Setting one again is not a third.
    await limit(t, t.admin, { books: 'view' }, true);
    // Made staff, the accountant no longer approves, even made accountant again.
    await h.rpc(t.owner, 'set_member_role', {
      p_company: c,
      p_user: t.accountant,
      p_role: 'staff',
    });
    expect(await approves(t.accountant)).toBe(false);
    await h.rpc(t.owner, 'set_member_role', {
      p_company: c,
      p_user: t.accountant,
      p_role: 'accountant',
    });
    expect(await approves(t.accountant)).toBe(false);
    await limit(t, t.staff, null, true);
  });

  it('are shown to the owner and admins for everyone, to the others for themselves', async () => {
    const t = await team();
    const c = t.company;
    await limit(t, t.accountant, { people: 'none' }, true);
    for (const user of [t.owner, t.admin]) {
      const rows = await h.rpc<{ user_id: string; permissions: unknown; can_approve: boolean }>(
        user,
        'team_permissions',
        { p_company: c },
      );
      expect(rows).toHaveLength(5);
      expect(rows.find((r) => r.user_id === t.accountant)).toEqual({
        user_id: t.accountant,
        permissions: { apps: { people: 'none' } },
        can_approve: true,
      });
    }
    for (const user of [t.accountant, t.staff, t.viewer]) {
      const rows = await h.rpc<{ user_id: string }>(user, 'team_permissions', { p_company: c });
      expect(rows.map((r) => r.user_id)).toEqual([user]);
    }
    await expect(h.rpc(t.outsider, 'team_permissions', { p_company: c })).rejects.toThrow(
      /almail:not_member/,
    );
    await expect(h.rpc(t.outsider, 'my_permissions', { p_company: c })).rejects.toThrow(
      /almail:not_member/,
    );
  });
});

describe('a member’s limits on the records', () => {
  it('stop staff with Books "view" from pushing documents, and nothing else', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      {
        tbl: 'companies',
        id: c,
        data: { id: c, name: 'Acme', numbering: { invoice: { pattern: 'I', next: 1 } } },
      },
      { tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1', { number: 'INV-1' }) },
    ]);
    await limit(t, t.staff, { books: 'view' });
    for (const change of [
      { tbl: 'documents', id: 'inv-2', data: rec(c, 'inv-2') },
      { tbl: 'documents', id: 'inv-1', data: rec(c, 'inv-1', { number: 'INV-9' }) },
      { tbl: 'payments', id: 'pay-1', data: rec(c, 'pay-1') },
      { tbl: 'journals', id: 'j-1', data: rec(c, 'j-1', { kind: 'transfer' }) },
      { tbl: 'documents', id: 'inv-1', deleted: true },
    ]) {
      await expect(push(t.staff, c, [change])).rejects.toThrow(/row-level security|permission/);
    }
    // A refused batch saves nothing, as before.
    await expect(
      push(t.staff, c, [
        { tbl: 'activities', id: 'act-1', data: rec(c, 'act-1', { entity: 'invoice' }) },
        { tbl: 'documents', id: 'inv-3', data: rec(c, 'inv-3') },
      ]),
    ).rejects.toThrow();
    // What every app shares stays theirs: activity, files and the counters.
    await push(t.staff, c, [
      { tbl: 'activities', id: 'act-1', data: rec(c, 'act-1', { entity: 'invoice' }) },
      { tbl: 'attachments', id: 'att-1', data: rec(c, 'att-1', { ownerId: 'inv-1' }) },
      {
        tbl: 'companies',
        id: c,
        data: { id: c, name: 'Acme', numbering: { invoice: { pattern: 'I', next: 2 } } },
      },
    ]);
    // Reading is unchanged.
    expect((await pull(t.staff, c)).map((r) => r.id)).toContain('inv-1');
    // Taken off, they work again.
    await limit(t, t.staff, null);
    await push(t.staff, c, [{ tbl: 'documents', id: 'inv-2', data: rec(c, 'inv-2') }]);
  });

  it('keep an accountant out of payroll with People "none", and an admin out of Compliance', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { name: 'Made-up Person' }) },
      { tbl: 'complianceDocuments', id: 'doc-co', data: rec(c, 'doc-co', { type: 'other' }) },
    ]);
    await limit(t, t.accountant, { people: 'none' });
    await limit(t, t.admin, { compliance: 'view' });
    for (const change of [
      { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { name: 'Changed' }) },
      { tbl: 'payRuns', id: 'run-1', data: rec(c, 'run-1') },
      { tbl: 'journals', id: 'j-pay', data: rec(c, 'j-pay', { kind: 'payroll' }) },
      // An employee's own paper is part of People.
      {
        tbl: 'complianceDocuments',
        id: 'doc-emp',
        data: rec(c, 'doc-emp', { employeeId: 'emp-1', type: 'passport' }),
      },
    ]) {
      await expect(push(t.accountant, c, [change])).rejects.toThrow(/row-level security/);
    }
    // Still in the books and the register, and still reading payroll.
    await push(t.accountant, c, [
      { tbl: 'journals', id: 'j-1', data: rec(c, 'j-1', { number: 'MJ-1' }) },
      { tbl: 'complianceDocuments', id: 'doc-2', data: rec(c, 'doc-2', { type: 'other' }) },
    ]);
    expect((await pull(t.accountant, c)).map((r) => r.id)).toContain('emp-1');

    await expect(
      push(t.admin, c, [{ tbl: 'complianceDocuments', id: 'doc-co', deleted: true }]),
    ).rejects.toThrow(/permission/);
    await expect(
      push(t.admin, c, [{ tbl: 'vehicles', id: 'veh-1', data: rec(c, 'veh-1', { plate: '1' }) }]),
    ).rejects.toThrow(/row-level security/);
    await push(t.admin, c, [
      { tbl: 'employees', id: 'emp-1', data: rec(c, 'emp-1', { name: 'Changed' }) },
    ]);
  });

  it('never apply to the owner', async () => {
    const t = await team();
    const c = t.company;
    // Even written straight into the table.
    await h.admin(
      `update public.company_members set permissions = '{"apps":{"books":"none"}}'
       where company_id = $1 and user_id = $2`,
      [c, t.owner],
    );
    await push(t.owner, c, [{ tbl: 'clients', id: 'cl-1', data: rec(c, 'cl-1') }]);
  });

  it('give the server the same app for each record as the app works out', async () => {
    const t = await team();
    const fixtures: [string, Record<string, unknown>][] = [
      ['companies', {}],
      ['activities', { entity: 'employee' }],
      ['attachments', { ownerId: 'emp-1' }],
      ['approvals', { subjectTbl: 'payRuns' }],
      ['clients', {}],
      ['documents', {}],
      ['journals', { kind: 'transfer' }],
      ['journals', { kind: 'payroll' }],
      ['journals', {}],
      ['chequeLayouts', {}],
      ['employees', {}],
      ['payRuns', {}],
      ['letterTemplates', {}],
      ['complianceDocuments', { employeeId: 'emp-1' }],
      ['complianceDocuments', { employeeId: null }],
      ['complianceDocuments', {}],
      ['renewals', { employeeId: 'emp-1' }],
      ['renewals', { employeeId: '' }],
      ['complianceMarks', {}],
      ['vehicles', {}],
      ['somethingNew', {}],
    ];
    for (const [tbl, data] of fixtures) {
      const [row] = await h.as(t.owner, (q) =>
        q<{ app: string | null }>('select almailbooks.record_app($1, $2::jsonb) as app', [
          tbl,
          json(data),
        ]),
      );
      expect(`${tbl} ${json(data)} ${row.app}`).toBe(
        `${tbl} ${json(data)} ${recordApp(tbl, data)}`,
      );
    }
  });
});

describe('the fake cloud of the app’s tests', () => {
  it('refuses and accepts the same changes as the server', async () => {
    const t = await team();
    const c = t.company;
    const fake = new FakeCloud();
    fake.features = ['tables_v16', 'super_admin'];
    fake.companies.set(c, { id: c, name: 'Same', purgedUntilRev: 0, createdAt: '' });
    const users: Record<MemberRole, string> = {
      owner: t.owner,
      admin: t.admin,
      accountant: t.accountant,
      staff: t.staff,
      viewer: t.viewer,
    };
    for (const [role, user] of Object.entries(users)) fake.addMember(c, user, role as MemberRole);
    const changes: [string, Record<string, unknown>][] = [
      ['clients', {}],
      ['documents', {}],
      ['journals', { kind: 'payroll' }],
      ['journals', { kind: 'transfer' }],
      ['employees', {}],
      ['complianceDocuments', { employeeId: 'emp-1' }],
      ['complianceDocuments', { employeeId: null }],
      ['vehicles', {}],
      ['activities', { entity: 'invoice' }],
      ['accounts', {}],
    ];
    const limits: NonNullable<MemberPermissions['apps']>[] = [
      {},
      { books: 'view' },
      { people: 'none' },
      { compliance: 'view' },
      { books: 'edit', crm: 'none' },
    ];
    let n = 0;
    const seen: string[] = [];
    for (const apps of limits) {
      for (const [role, user] of Object.entries(users)) {
        if (role !== 'owner') {
          await limit(t, user, apps);
          fake.setAccess(c, user, { apps });
        }
        for (const [tbl, data] of changes) {
          n += 1;
          const id = `parity-${n}`;
          const change = { tbl, id, data: rec(c, id, data) };
          const inSql = await push(user, c, [change]).then(
            () => true,
            () => false,
          );
          const inFake = await fake
            .client(user)
            .pushRecords(c, [change])
            .then(
              () => true,
              () => false,
            );
          const label = `${role} ${json(apps)} ${tbl} ${json(data)}`;
          expect(`${label} ${inFake}`).toBe(`${label} ${inSql}`);
          seen.push(`${inSql}`);
        }
      }
    }
    // Both answers came up.
    expect(new Set(seen)).toEqual(new Set(['true', 'false']));
  }, 60_000);
});

describe('companies you own (owned_companies_overview)', () => {
  it('lists the companies the caller owns, with members and waiting requests', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [
      { tbl: 'approvals', id: 'ap-1', data: rec(c, 'ap-1', { status: 'pending' }) },
      { tbl: 'approvals', id: 'ap-2', data: rec(c, 'ap-2', { status: 'approved' }) },
    ]);
    const rows = await h.rpc<{ company_id: string; members: number; pending_approvals: number }>(
      t.owner,
      'owned_companies_overview',
    );
    expect(rows).toEqual([
      { company_id: c, name: expect.any(String), members: 5, pending_approvals: 1 },
    ]);
    // An admin owns none of it.
    expect(await h.rpc(t.admin, 'owned_companies_overview')).toEqual([]);
    await expect(h.rpc(null, 'owned_companies_overview')).rejects.toThrow(/permission denied/);
  });
});

describe('the record of team changes', () => {
  it('does nothing until the change feed exists', async () => {
    const t = await team();
    await limit(t, t.admin, { books: 'view' }, true);
    const [found] = await h.admin<{ table: string | null }>(
      `select to_regclass('public.change_events')::text as table`,
    );
    expect(found.table).toBeNull();
  });

  it('records joins, roles, limits, leaving and a new owner, and never stops a change', async () => {
    const db = await startDatabase(1);
    // A stand-in for the feed of the next release, with its columns.
    await db.admin(`
      create table public.change_events (
        id bigint generated always as identity primary key,
        company_id text not null references public.companies (id) on delete cascade,
        at timestamptz not null default now(),
        actor uuid,
        op text not null,
        tbl text not null,
        record_id text not null,
        kind text not null,
        important boolean not null default false,
        private boolean not null default false,
        count integer not null default 1,
        fold_key text not null,
        summary jsonb not null default '{}'::jsonb,
        unique (company_id, fold_key)
      );
    `);
    const t = await team(db);
    const c = t.company;
    await limit(t, t.accountant, { people: 'none' }, true, db);
    await db.rpc(t.owner, 'set_member_role', { p_company: c, p_user: t.staff, p_role: 'viewer' });
    await db.rpc(t.owner, 'remove_member', { p_company: c, p_user: t.viewer });
    // The owner's account is deleted: the admin takes over.
    await db.admin('delete from auth.users where id = $1', [t.owner]);
    const events = await db.admin<{
      actor: string | null;
      record_id: string;
      kind: string;
      important: boolean;
      summary: { reason: string; role?: string; before?: string };
    }>(
      `select actor, record_id, kind, important, summary from public.change_events
        where company_id = $1 order by id`,
      [c],
    );
    expect(events.every((e) => e.kind === 'member' && e.important)).toBe(true);
    expect(
      events.map((e) => `${e.summary.reason} ${e.record_id === t.admin ? 'admin' : ''}`),
    ).toEqual([
      'joined ',
      'joined admin',
      'joined ',
      'joined ',
      'joined ',
      'permissions ',
      'role ',
      'left ',
      'succession admin',
      'left ',
    ]);
    expect(events[5]).toMatchObject({ actor: t.owner, record_id: t.accountant });
    expect(events[6].summary).toMatchObject({ role: 'viewer', before: 'staff' });
    expect(events[8].actor).toBeNull();
    // No salaries, names or emails in it.
    expect(JSON.stringify(events)).not.toMatch(/@example\.com/);

    // A feed that refuses every row doesn't stop the team.
    await db.admin(`alter table public.change_events add constraint never check (false) not valid`);
    await db.rpc(t.admin, 'set_member_role', {
      p_company: c,
      p_user: t.accountant,
      p_role: 'staff',
    });
    const people = await db.rpc<{ user_id: string; role: string }>(t.admin, 'company_team', {
      p_company: c,
    });
    expect(people.find((p) => p.user_id === t.accountant)?.role).toBe('staff');
  }, 60_000);
});

describe('server_features', () => {
  it('names super_admin once this file has run, and the app finds nothing before', async () => {
    const user = await h.user('sa-features@example.com');
    const [row] = await h.rpc<{ server_features: string[] }>(user, 'server_features');
    expect(row.server_features).toEqual(expect.arrayContaining(['tables_v16', 'super_admin']));

    const early = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    const someone = await early.user('sa-early@example.com');
    const [before] = await early.rpc<{ server_features: string[] }>(someone, 'server_features');
    expect(before.server_features).not.toContain('super_admin');
    await expect(early.rpc(someone, 'my_permissions', { p_company: 'x' })).rejects.toThrow(
      /does not exist/,
    );
  }, 60_000);
});
