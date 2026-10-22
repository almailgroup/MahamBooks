// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, startDatabase, type Harness } from './sql-harness';
import type { MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';

/**
 * Employee letters (#19) in 20261130000000_people_alerts.sql: with the
 * company's letters on (its People settings record), records_guard lets
 * only the owner, an admin or an approver issue a letter, or change or void
 * one that is issued; a letter issued or void never goes back to a draft
 * and is never deleted; and only the owner or an admin changes the letters
 * switch (anyone else's copy keeps it). Off, every push is answered as
 * before the file. Made-up data only.
 */

const FILE = MIGRATIONS.find((file) => file.endsWith('_people_alerts.sql'))!;

let h: Harness;
let seq = 0;

beforeAll(async () => {
  // Each file twice, this one after the Phase 3 files: running it again must be safe.
  h = await startDatabase(2);
}, 90_000);

const json = (value: unknown) => JSON.stringify(value);
type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean };

/** A company with an owner, an admin, a deputy (an accountant allowed to approve), an accountant, staff and a viewer. */
async function team(db: Harness = h) {
  seq += 1;
  const company = `let-co-${String(seq).padStart(4, '0')}`;
  const tag = `let-${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await db.user(`owner-${tag}@example.com`);
  await db.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${seq}` });
  const members: Record<string, string> = {};
  for (const [key, role] of [
    ['admin', 'admin'],
    ['deputy', 'accountant'],
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
  if (db.db !== undefined && (await features(db)).includes('super_admin')) {
    await db.rpc(owner, 'set_member_permissions', {
      p_company: company,
      p_user: members.deputy,
      p_permissions: json({}),
      p_can_approve: true,
    });
  }
  const { admin, deputy, accountant, staff, viewer } = members;
  return { company, owner, admin, deputy, accountant, staff, viewer };
}

type Team = Awaited<ReturnType<typeof team>>;

async function features(db: Harness): Promise<string[]> {
  const someone = await db.user(`f-${Math.random().toString(36).slice(2)}@example.com`);
  const [row] = await db.rpc<{ server_features: string[] }>(someone, 'server_features');
  return row.server_features;
}

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

const STAMP = '2026-10-20T08:00:00.000Z';

function settings(c: string, extra: Record<string, unknown> = {}): Change {
  return {
    tbl: 'peopleSettings',
    id: c,
    data: { id: c, companyId: c, reminderDays: [60, 30, 7], updatedAt: STAMP, ...extra },
  };
}

function letter(c: string, id: string, extra: Record<string, unknown> = {}): Change {
  return {
    tbl: 'employeeLetters',
    id,
    data: {
      id,
      companyId: c,
      employeeId: 'emp-1',
      templateId: null,
      kind: 'salary_certificate',
      number: '',
      language: 'ar',
      addressee: '',
      purpose: '',
      subject: 'شهادة راتب',
      body: 'Made-up text {employee.name}',
      issuedOn: null,
      status: 'draft',
      trigger: null,
      createdAt: STAMP,
      updatedAt: STAMP,
      ...extra,
    },
  };
}

const ISSUED = { status: 'issued', number: 'HR-2026-0001', issuedOn: '2026-10-20', body: 'Done' };

/** The stored letter, changed. */
async function changed(t: Team, id: string, extra: Record<string, unknown>, db: Harness = h) {
  return {
    tbl: 'employeeLetters',
    id,
    data: { ...(await stored(t.company, 'employeeLetters', id, db)), ...extra },
  };
}

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; message?: string }) =>
      e.code === '42501'
        ? /almail:invalid/.test(e.message ?? '')
          ? 'stays'
          : 'refused'
        : String(e.message),
  );

async function lettersOn(t: Team, db: Harness = h) {
  expect(
    await outcome(push(t.owner, t.company, [settings(t.company, { letters: true })], db)),
  ).toBe('ok');
}

/* -------------------------------------------------------------------------- */

describe('the file', () => {
  it('names employee_letters with everything the earlier files name', async () => {
    expect(await features(h)).toContain('employee_letters');
    const early = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    expect(await features(early)).not.toContain('employee_letters');
  }, 60_000);
});

describe('with letters off', () => {
  it('answers every letter and People settings push exactly as before', async () => {
    const before = await startDatabase(1, MIGRATIONS.indexOf(FILE));
    const outcomes: string[][] = [];
    for (const db of [before, h]) {
      const t = await team(db);
      const c = t.company;
      const results: string[] = [];
      const run = async (user: string, changes: Change[]) =>
        results.push(await outcome(push(user, c, changes, db)));
      // An accountant's settings, as every version of the app sends them.
      await run(t.accountant, [settings(c, { reminderDays: [30] })]);
      const kept = { ...(await stored(c, 'peopleSettings', c, db)) };
      delete kept.id;
      delete kept.companyId;
      results.push(json(kept));
      await run(t.accountant, [letter(c, 'let-1')]);
      await run(t.accountant, [await changed(t, 'let-1', ISSUED, db)]);
      await run(t.accountant, [await changed(t, 'let-1', { body: 'Changed' }, db)]);
      await run(t.accountant, [await changed(t, 'let-1', { status: 'draft' }, db)]);
      await run(t.accountant, [{ tbl: 'employeeLetters', id: 'let-1', deleted: true }]);
      await run(t.accountant, [letter(c, 'let-2', ISSUED)]);
      await run(t.staff, [letter(c, 'let-3')]);
      await run(t.viewer, [letter(c, 'let-4')]);
      outcomes.push(results);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[1]).toEqual([
      'ok',
      expect.stringContaining('"reminderDays":[30]'),
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'refused',
      'refused',
    ]);
  }, 90_000);
});

describe('with letters on', () => {
  it('lets the owner, an admin or an approver issue; an accountant drafts and is refused', async () => {
    const t = await team();
    const c = t.company;
    await lettersOn(t);
    const cases: [string, string][] = [
      ['owner', t.owner],
      ['admin', t.admin],
      ['deputy', t.deputy],
      ['accountant', t.accountant],
    ];
    const results: string[] = [];
    for (const [key, user] of cases) {
      // New, straight as issued.
      results.push(`${key} new ${await outcome(push(user, c, [letter(c, `new-${key}`, ISSUED)]))}`);
      // A draft, then issued.
      results.push(`${key} draft ${await outcome(push(user, c, [letter(c, `d-${key}`)]))}`);
      const draft = await changed(t, `d-${key}`, { purpose: 'a visa' });
      results.push(`${key} edit ${await outcome(push(user, c, [draft]))}`);
      const issue = await changed(t, `d-${key}`, ISSUED);
      results.push(`${key} issue ${await outcome(push(user, c, [issue]))}`);
    }
    expect(results).toEqual([
      'owner new ok',
      'owner draft ok',
      'owner edit ok',
      'owner issue ok',
      'admin new ok',
      'admin draft ok',
      'admin edit ok',
      'admin issue ok',
      'deputy new ok',
      'deputy draft ok',
      'deputy edit ok',
      'deputy issue ok',
      'accountant new refused',
      'accountant draft ok',
      'accountant edit ok',
      'accountant issue refused',
    ]);
    expect(await stored(c, 'employeeLetters', 'd-accountant')).toMatchObject({ status: 'draft' });
  });

  it('keeps an issued letter: only issuers change or void it, it never goes back, it is never deleted', async () => {
    const t = await team();
    const c = t.company;
    await lettersOn(t);
    await push(t.owner, c, [letter(c, 'let-1', ISSUED)]);
    // Marked printed by anyone who may write letters: nothing of it changes.
    expect(
      await outcome(push(t.accountant, c, [await changed(t, 'let-1', { printedAt: STAMP })])),
    ).toBe('ok');
    // The same copy sent again (an upsert of what is stored) passes.
    expect(await outcome(push(t.accountant, c, [await changed(t, 'let-1', {})]))).toBe('ok');
    // A changed copy is kept as it was issued (the app refuses it before it is sent).
    expect(
      await outcome(push(t.accountant, c, [await changed(t, 'let-1', { body: 'Other' })])),
    ).toBe('ok');
    expect(await stored(c, 'employeeLetters', 'let-1')).toMatchObject({ body: 'Done' });
    expect(
      await outcome(
        push(t.accountant, c, [await changed(t, 'let-1', { status: 'void', voidReason: 'x' })]),
      ),
    ).toBe('refused');
    for (const user of [t.owner, t.accountant]) {
      expect(
        await outcome(push(user, c, [await changed(t, 'let-1', { status: 'draft', number: '' })])),
      ).toBe('stays');
      expect(
        await outcome(push(user, c, [{ tbl: 'employeeLetters', id: 'let-1', deleted: true }])),
      ).toBe('refused');
    }
    expect(
      await outcome(
        push(t.admin, c, [await changed(t, 'let-1', { status: 'void', voidReason: 'Mistake' })]),
      ),
    ).toBe('ok');
    expect(await outcome(push(t.owner, c, [await changed(t, 'let-1', { status: 'draft' })]))).toBe(
      'stays',
    );
    expect(
      await outcome(push(t.owner, c, [{ tbl: 'employeeLetters', id: 'let-1', deleted: true }])),
    ).toBe('refused');
    expect(await stored(c, 'employeeLetters', 'let-1')).toMatchObject({
      status: 'void',
      number: 'HR-2026-0001',
    });
    // Drafts may go.
    await push(t.accountant, c, [letter(c, 'let-2')]);
    expect(
      await outcome(
        push(t.accountant, c, [{ tbl: 'employeeLetters', id: 'let-2', deleted: true }]),
      ),
    ).toBe('ok');
  });

  it('keeps an issued letter as issued and a void one void when an older copy comes again', async () => {
    const t = await team();
    const c = t.company;
    await lettersOn(t);
    await push(t.owner, c, [letter(c, 'let-1', ISSUED), letter(c, 'let-2')]);
    const issuedCopy = await stored(c, 'employeeLetters', 'let-1');
    const draftCopy = await stored(c, 'employeeLetters', 'let-2');
    // Voided by an admin, with why.
    expect(
      await outcome(
        push(t.admin, c, [
          await changed(t, 'let-1', {
            status: 'void',
            voidReason: 'Wrong',
            voidedOn: '2026-10-21',
            updatedAt: '2026-10-21T08:00:00.000Z',
          }),
        ]),
      ),
    ).toBe('ok');
    // The owner's device, which hasn't heard of the void, prints its copy:
    // the letter stays void, with why and when, and the print is noted.
    for (const user of [t.owner, t.deputy, t.accountant]) {
      const printedAt = `2026-10-22T0${user === t.owner ? 8 : user === t.deputy ? 7 : 6}:00:00.000Z`;
      expect(
        await outcome(
          push(user, c, [
            {
              tbl: 'employeeLetters',
              id: 'let-1',
              data: { ...issuedCopy, printedAt, updatedAt: printedAt },
            },
          ]),
        ),
      ).toBe('ok');
    }
    expect(await stored(c, 'employeeLetters', 'let-1')).toEqual({
      ...issuedCopy,
      status: 'void',
      voidReason: 'Wrong',
      voidedOn: '2026-10-21',
      // The latest print, and when it was last saved.
      printedAt: '2026-10-22T08:00:00.000Z',
      updatedAt: '2026-10-22T06:00:00.000Z',
    });
    // A void letter voided again from an older copy keeps why it was voided first.
    await push(t.owner, c, [
      {
        tbl: 'employeeLetters',
        id: 'let-1',
        data: { ...issuedCopy, status: 'void', voidReason: 'Other', voidedOn: '2026-10-23' },
      },
    ]);
    expect(await stored(c, 'employeeLetters', 'let-1')).toMatchObject({
      status: 'void',
      voidReason: 'Wrong',
      voidedOn: '2026-10-21',
    });

    // Issued on one device; another, which still has the draft, issues it
    // again with the next number, its own date and signatory: the first stays.
    const first = { ...draftCopy, ...ISSUED, number: 'HR-2026-0003', subject: 'First' };
    await push(t.admin, c, [{ tbl: 'employeeLetters', id: 'let-2', data: first }]);
    const second = {
      ...draftCopy,
      ...ISSUED,
      number: 'HR-2026-0004',
      issuedOn: '2026-10-22',
      subject: 'Second',
      signatoryName: 'Someone else',
    };
    expect(
      await outcome(push(t.owner, c, [{ tbl: 'employeeLetters', id: 'let-2', data: second }])),
    ).toBe('ok');
    expect(await stored(c, 'employeeLetters', 'let-2')).toEqual(first);
    // Voided from that second copy, it is the first that is voided.
    expect(
      await outcome(
        push(t.deputy, c, [
          {
            tbl: 'employeeLetters',
            id: 'let-2',
            data: { ...second, status: 'void', voidReason: 'Twice', voidedOn: '2026-10-22' },
          },
        ]),
      ),
    ).toBe('ok');
    expect(await stored(c, 'employeeLetters', 'let-2')).toEqual({
      ...first,
      status: 'void',
      voidReason: 'Twice',
      voidedOn: '2026-10-22',
    });
  });

  it('keeps the People settings with the letters on: only the owner or an admin deletes them', async () => {
    const t = await team();
    const c = t.company;
    // Off, an accountant's delete goes through as before.
    await push(t.accountant, c, [settings(c)]);
    expect(
      await outcome(push(t.accountant, c, [{ tbl: 'peopleSettings', id: c, deleted: true }])),
    ).toBe('ok');
    await lettersOn(t);
    await push(t.owner, c, [letter(c, 'let-1', ISSUED)]);
    for (const user of [t.accountant, t.deputy]) {
      expect(await outcome(push(user, c, [{ tbl: 'peopleSettings', id: c, deleted: true }]))).toBe(
        'refused',
      );
      // Nor straight through the Data API.
      await h.as(user, (q) =>
        q('delete from public.records where company_id = $1 and tbl = $2 and id = $3', [
          c,
          'peopleSettings',
          c,
        ]),
      );
    }
    expect((await stored(c, 'peopleSettings', c))?.letters).toBe(true);
    // So the letter rules still hold for the accountant.
    expect(await outcome(push(t.accountant, c, [letter(c, 'let-2', ISSUED)]))).toBe('refused');
    expect(
      await outcome(
        push(t.accountant, c, [{ tbl: 'employeeLetters', id: 'let-1', deleted: true }]),
      ),
    ).toBe('refused');
    // Staff and viewers never see them, so they delete nothing.
    for (const user of [t.staff, t.viewer]) {
      await push(user, c, [{ tbl: 'peopleSettings', id: c, deleted: true }]).catch(() => null);
    }
    expect((await stored(c, 'peopleSettings', c))?.letters).toBe(true);
    // The owner or an admin may (it turns the letters off, as switching them off does).
    expect(await outcome(push(t.admin, c, [{ tbl: 'peopleSettings', id: c, deleted: true }]))).toBe(
      'ok',
    );
    expect(await stored(c, 'peopleSettings', c)).toBeUndefined();
    await lettersOn(t);
    expect(await outcome(push(t.owner, c, [{ tbl: 'peopleSettings', id: c, deleted: true }]))).toBe(
      'ok',
    );
  });

  it('keeps letters private: staff and viewers read none, nor write any', async () => {
    const t = await team();
    const c = t.company;
    await lettersOn(t);
    await push(t.owner, c, [letter(c, 'let-1', ISSUED)]);
    for (const user of [t.staff, t.viewer]) {
      const rows = await h.rpc<{ tbl: string }>(user, 'pull_records', { p_company: c, p_since: 0 });
      expect(rows.filter((r) => ['employeeLetters', 'peopleSettings'].includes(r.tbl))).toEqual([]);
      expect(await outcome(push(user, c, [letter(c, `x-${user}`)]))).toBe('refused');
    }
  });

  it('keeps the switch for the owner and admins; anyone else’s copy, older ones too, keeps it', async () => {
    const t = await team();
    const c = t.company;
    // An accountant can't turn it on.
    await push(t.accountant, c, [settings(c, { letters: true })]);
    expect((await stored(c, 'peopleSettings', c))?.letters).toBeUndefined();
    await lettersOn(t);
    // An older version's copy, which has never heard of the switch, keeps it on.
    await push(t.accountant, c, [settings(c, { reminderDays: [30] })]);
    expect(await stored(c, 'peopleSettings', c)).toMatchObject({
      letters: true,
      reminderDays: [30],
    });
    await push(t.accountant, c, [settings(c, { letters: false })]);
    expect((await stored(c, 'peopleSettings', c))?.letters).toBe(true);
    // An admin turns it off; the owner on again.
    await push(t.admin, c, [settings(c)]);
    expect((await stored(c, 'peopleSettings', c))?.letters).toBeUndefined();
    await lettersOn(t);
  });

  it('takes an accountant’s company sent up again, with the letters as they are', async () => {
    const t = await team();
    const c = t.company;
    await lettersOn(t);
    await push(t.owner, c, [letter(c, 'let-1', ISSUED), letter(c, 'let-2')]);
    const copies = await Promise.all(
      ['let-1', 'let-2'].map(async (id) => ({
        tbl: 'employeeLetters',
        id,
        data: await stored(c, 'employeeLetters', id),
      })),
    );
    expect(await outcome(push(t.accountant, c, [settings(c, { letters: true }), ...copies]))).toBe(
      'ok',
    );
  });

  it('asks an approver through a request of kind letter, private like the letter', async () => {
    const t = await team();
    const c = t.company;
    await lettersOn(t);
    await push(t.accountant, c, [letter(c, 'let-1')]);
    const request = {
      tbl: 'approvals',
      id: 'req-1',
      data: {
        id: 'req-1',
        companyId: c,
        kind: 'letter',
        subjectTbl: 'employeeLetters',
        subjectId: 'let-1',
        subjectNumber: 'EMP-001',
        before: null,
        after: { letterUpdatedAt: STAMP, kind: 'salary_certificate', employeeId: 'emp-1' },
        reason: '',
        status: 'approved',
        requestedBy: '',
        requestedAt: STAMP,
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    };
    await push(t.accountant, c, [request]);
    expect(await stored(c, 'approvals', 'req-1')).toMatchObject({
      status: 'pending',
      requestedBy: t.accountant,
    });
    const asked = await stored(c, 'approvals', 'req-1');
    expect(
      await outcome(
        push(t.accountant, c, [
          { tbl: 'approvals', id: 'req-1', data: { ...asked, status: 'approved' } },
        ]),
      ),
    ).toBe('refused');
    expect(
      await outcome(
        push(t.deputy, c, [
          { tbl: 'approvals', id: 'req-1', data: { ...asked, status: 'approved' } },
        ]),
      ),
    ).toBe('ok');
    // The approver's device issues it, and marks the request done.
    expect(await outcome(push(t.deputy, c, [await changed(t, 'let-1', ISSUED)]))).toBe('ok');
    const approved = await stored(c, 'approvals', 'req-1');
    expect(
      await outcome(
        push(t.deputy, c, [
          { tbl: 'approvals', id: 'req-1', data: { ...approved, status: 'applied' } },
        ]),
      ),
    ).toBe('ok');
    for (const user of [t.staff, t.viewer]) {
      const rows = await h.rpc<{ tbl: string }>(user, 'pull_records', { p_company: c, p_since: 0 });
      expect(rows.filter((r) => r.tbl === 'approvals')).toEqual([]);
    }
  });
});

describe('the app’s stand-ins for the cloud', () => {
  it('answer letter pushes as the server does', async () => {
    const t = await team();
    const c = t.company;
    const fake = new FakeCloud();
    fake.features = [
      'tables_v16',
      'super_admin',
      'approvals',
      'cheque_approvals',
      'change_feed',
      'payroll_approvals',
      'document_alerts',
      'employee_letters',
    ];
    fake.companies.set(c, { id: c, name: 'Company', purgedUntilRev: 0, createdAt: '' });
    const users: Record<string, [string, MemberRole]> = {
      owner: [t.owner, 'owner'],
      admin: [t.admin, 'admin'],
      deputy: [t.deputy, 'accountant'],
      accountant: [t.accountant, 'accountant'],
    };
    for (const [user, role] of Object.values(users)) fake.addMember(c, user, role);
    fake.setAccess(c, t.deputy, {}, true);
    const both = async (user: string, changes: Change[]) => {
      const inSql = await outcome(push(user, c, changes));
      const inFake = await fake
        .client(user)
        .pushRecords(c, changes as never)
        .then(
          () => 'ok',
          (e: { code?: string }) =>
            e.code === 'invalid' ? 'stays' : e.code === 'permission' ? 'refused' : String(e.code),
        );
      return `${inFake} ${inSql}`;
    };
    const asStored = async (id: string, extra: Record<string, unknown>) => ({
      tbl: 'employeeLetters',
      id,
      data: { ...(await stored(c, 'employeeLetters', id)), ...extra },
    });
    const seen = new Set<string>();
    let n = 0;
    for (const on of [false, true]) {
      expect(await both(t.owner, [settings(c, on ? { letters: true } : {})])).toBe('ok ok');
      for (const [key, [user]] of Object.entries(users)) {
        const steps: [string, () => Promise<Change[]>][] = [
          ['new issued', async () => [letter(c, `n-${++n}`, ISSUED)]],
          ['draft', async () => [letter(c, `d-${n}`)]],
          ['issue', async () => [await asStored(`d-${n}`, ISSUED)]],
          ['printed', async () => [await asStored(`n-${n}`, { printedAt: STAMP })]],
          ['change', async () => [await asStored(`n-${n}`, { body: 'Other' })]],
          ['back', async () => [await asStored(`n-${n}`, { status: 'draft' })]],
          ['void', async () => [await asStored(`n-${n}`, { status: 'void' })]],
          [
            'older copy',
            async () => [
              await asStored(`n-${n}`, {
                status: 'issued',
                number: 'HR-2026-0999',
                printedAt: STAMP,
              }),
            ],
          ],
          ['delete', async () => [{ tbl: 'employeeLetters', id: `n-${n}`, deleted: true }]],
        ];
        for (const [step, changes] of steps) {
          // Each step from what the server stores, so both start alike.
          if (step !== 'new issued' && step !== 'draft') {
            const id = step === 'issue' ? `d-${n}` : `n-${n}`;
            if (!(await stored(c, 'employeeLetters', id))) continue;
          }
          const sent = await changes();
          const result = await both(user, sent);
          const [inFake, inSql] = result.split(' ');
          expect(`${on} ${key} ${step} ${inFake}`).toBe(`${on} ${key} ${step} ${inSql}`);
          seen.add(`${on ? 'on' : 'off'} ${inSql}`);
          // And both store the same.
          const id = sent[0].id;
          expect(fake.record(c, 'employeeLetters', id) ?? null).toEqual(
            (await stored(c, 'employeeLetters', id)) ?? null,
          );
        }
      }
      // The People settings: deleted by the owner or an admin only, with the letters on.
      for (const user of [t.accountant, t.deputy]) {
        const result = await both(user, [{ tbl: 'peopleSettings', id: c, deleted: true }]);
        expect(`${on} ${result}`).toBe(on ? 'true refused refused' : 'false ok ok');
        if (!on) await both(t.owner, [settings(c)]);
      }
      // The switch: an accountant's copy keeps it in both.
      await both(t.accountant, [settings(c, { letters: !on })]);
      expect(Boolean(fake.record(c, 'peopleSettings', c)?.letters)).toBe(
        Boolean((await stored(c, 'peopleSettings', c))?.letters),
      );
    }
    expect([...seen].sort()).toEqual(['off ok', 'on ok', 'on refused', 'on stays']);
  }, 120_000);
});
