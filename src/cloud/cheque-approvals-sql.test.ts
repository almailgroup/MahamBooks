// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { startDatabase, type Harness } from './sql-harness';
import {
  chequeChangeNeedsApprover,
  chequeContent,
  securityChequeContent,
  type MemberRole,
} from './roles';
import { FakeCloud } from './testing/fake-cloud';

/**
 * Cheque confirmation in 20261116000000_super_admin_approvals.sql (#9 of
 * docs/requirements-plan.md): with the owner's cheque rules on, records_guard
 * and can_delete_record keep cheques the company writes (and, as the owner
 * chooses, security cheques it hands over and cheques it receives) for
 * approvers to record, change and delete; everyone else sends them for
 * confirmation. Their life (deposit, clearing, return, cancelling, prints),
 * notes and allocations stay open. Without the rules everything is as before.
 */

let h: Harness;
let companySeq = 0;

beforeAll(async () => {
  // Each file twice: running a script again must be safe.
  h = await startDatabase(2);
}, 60_000);

const json = (value: unknown) => JSON.stringify(value);

async function team() {
  companySeq += 1;
  const company = `cq-company-${String(companySeq).padStart(4, '0')}`;
  const tag = `cq-${companySeq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await h.user(`owner-${tag}@example.com`);
  await h.rpc(owner, 'create_company', { p_id: company, p_name: `Company ${companySeq}` });
  const members: Record<string, string> = {};
  for (const role of ['admin', 'accountant', 'staff', 'viewer']) {
    const email = `${role}-${tag}@example.com`;
    members[role] = await h.user(email);
    const [invite] = await h.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: company,
      p_email: email,
      p_role: role,
    });
    await h.rpc(members[role], 'accept_invite', { p_token: invite.token });
  }
  await push(owner, company, [{ tbl: 'companies', id: company, data: companyRecord(company) }]);
  const { admin, accountant, staff, viewer } = members;
  return { company, owner, admin, accountant, staff, viewer };
}

type Team = Awaited<ReturnType<typeof team>>;
type Change = { tbl: string; id: string; data?: unknown; deleted?: boolean };

function push(user: string, company: string, changes: Change[]) {
  return h.rpc<{ tbl: string; id: string; rev: number }>(user, 'push_records', {
    p_company: company,
    p_changes: json(changes),
  });
}

const companyRecord = (c: string, extra: Record<string, unknown> = {}) => ({
  id: c,
  name: 'Gulf Pearl Trading',
  ...extra,
});

/** The recommended rules: cheques issued and security cheques given; received ones off. */
const CHEQUES = { issued: true, securityOut: true, received: false };
const RULES = { documentTypes: ['invoice'], expireDays: 14, cheques: CHEQUES };

async function rulesOn(t: Team, rules: Record<string, unknown> = RULES) {
  await push(t.owner, t.company, [
    { tbl: 'companies', id: t.company, data: companyRecord(t.company, { approvalRules: rules }) },
  ]);
}

/** A cheque issued to a vendor, as the app stores it. */
function cheque(c: string, id: string, extra: Record<string, unknown> = {}) {
  const { cheque: details, ...rest } = extra as { cheque?: Record<string, unknown> };
  return {
    id,
    companyId: c,
    direction: 'out',
    clientId: 'vendor-1',
    number: `PAYM-${id}`,
    date: '2026-10-05',
    amount: 250,
    currency: 'KWD',
    accountId: 'acc-2150',
    method: 'cheque',
    reference: '000101',
    notes: '',
    allocations: [{ documentId: 'bill-1', amount: 250 }],
    documentIds: ['bill-1'],
    creditId: null,
    cheque: {
      number: '000101',
      bank: 'BRGN',
      date: '2026-10-20',
      drawer: 'Made-up Supplies Co.',
      status: 'held',
      ...details,
    },
    postingRules: 2,
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    ...rest,
  };
}

/** A security cheque the company handed over (a tender guarantee). */
function security(c: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyId: c,
    direction: 'out',
    clientId: null,
    number: '000555',
    bank: 'KFHO',
    date: null,
    amount: 1000,
    currency: 'KWD',
    drawer: 'Made-up Landlord',
    purpose: 'Rent deposit, office 4',
    notes: '',
    status: 'held',
    returnedOn: null,
    cashedOn: null,
    paymentId: null,
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    ...extra,
  };
}

const pay = (data: Record<string, unknown>): Change => ({
  tbl: 'payments',
  id: String(data.id),
  data,
});
const sec = (data: Record<string, unknown>): Change => ({
  tbl: 'securityCheques',
  id: String(data.id),
  data,
});

async function stored(c: string, tbl: string, id: string) {
  const [row] = await h.admin<{ data: Record<string, unknown> }>(
    'select data from public.records where company_id = $1 and tbl = $2 and id = $3',
    [c, tbl, id],
  );
  return row?.data;
}

/** Changes of what an approver confirms on a cheque. */
function edits(c: string, id: string): [string, Record<string, unknown>][] {
  const base = cheque(c, id);
  return [
    ['the amount', { ...base, amount: 2500 }],
    ['the currency', { ...base, currency: 'USD', exchangeRate: 0.307 }],
    ['the rate', { ...base, exchangeRate: 2 }],
    ['the date', { ...base, date: '2026-09-01' }],
    ['the vendor', { ...base, clientId: 'vendor-2' }],
    ['the payee', { ...base, cheque: { ...base.cheque, drawer: 'Someone Else' } }],
    ['the number', { ...base, cheque: { ...base.cheque, number: '000999' } }],
    ['the bank', { ...base, cheque: { ...base.cheque, bank: 'NBOK' } }],
    ['the cheque date', { ...base, cheque: { ...base.cheque, date: '2026-12-31' } }],
    ['the civil ID', { ...base, cheque: { ...base.cheque, drawerCivilId: '290010112345' } }],
    ['the direction', { ...base, direction: 'in' }],
    ['the method', { ...base, method: 'bank_transfer', cheque: null }],
  ];
}

/** What happens to a cheque in its life, done by anyone who may write payments. */
function lifecycle(c: string, id: string): [string, Record<string, unknown>][] {
  const base = cheque(c, id);
  return [
    ['notes', { ...base, notes: 'Handed to the courier' }],
    ['allocations', { ...base, allocations: [], documentIds: [] }],
    [
      'cleared',
      {
        ...base,
        cheque: {
          ...base.cheque,
          status: 'cleared',
          clearedOn: '2026-10-21',
          bankAccountId: 'acc-bank',
          clearingJournalId: 'jr-1',
        },
      },
    ],
    [
      'returned',
      {
        ...base,
        voided: true,
        voidReason: 'Insufficient funds',
        voidedOn: '2026-10-22',
        cheque: { ...base.cheque, status: 'returned', returnedOn: '2026-10-22' },
      },
    ],
    [
      'cancelled',
      {
        ...base,
        voided: true,
        voidReason: 'Given back',
        voidedOn: '2026-10-22',
        cheque: { ...base.cheque, status: 'cancelled' },
      },
    ],
    [
      'printed',
      {
        ...base,
        cheque: {
          ...base.cheque,
          printedAt: '2026-10-06T09:00:00.000Z',
          printCount: 1,
          printedLayoutId: 'preset-BRGN',
          crossed: true,
        },
      },
    ],
    [
      'moved to the next leaf',
      {
        ...base,
        reference: '000102',
        cheque: {
          ...base.cheque,
          number: '000102',
          printCount: 1,
          spoiledLeaves: [{ number: '000101', at: '2026-10-06T09:00:00.000Z', reason: 'Jammed' }],
        },
      },
    ],
    ['posting rules', { ...base, postingRules: 3, updatedAt: '2026-10-07T08:00:00.000Z' }],
    ['the rate written out', { ...base, exchangeRate: 1 }],
  ];
}

const approvalRequired = /almail:approval_required/;

describe('with the rules off', () => {
  it('lets every role that writes payments record, change and delete cheques as before', async () => {
    const t = await team();
    const c = t.company;
    for (const [n, user] of [t.owner, t.admin, t.accountant, t.staff].entries()) {
      const id = `off-${n}`;
      await push(user, c, [pay(cheque(c, id))]);
      for (const [, edited] of [...edits(c, id), ...lifecycle(c, id)]) {
        await push(user, c, [pay(edited)]);
        await push(user, c, [pay(cheque(c, id))]);
      }
      await push(user, c, [{ tbl: 'payments', id, deleted: true }]);
      expect(await stored(c, 'payments', id)).toBeUndefined();
      await push(user, c, [sec(security(c, `sec-${n}`))]);
      await push(user, c, [sec(security(c, `sec-${n}`, { amount: 2000 }))]);
      await push(user, c, [{ tbl: 'securityCheques', id: `sec-${n}`, deleted: true }]);
    }
    // Viewers still change nothing.
    await expect(push(t.viewer, c, [pay(cheque(c, 'v-1'))])).rejects.toThrow(/row-level security/);
  });

  it('changes nothing for cheques while the rules cover invoices only', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t, { documentTypes: ['invoice'], voidInsteadOfDelete: true });
    await push(t.staff, c, [pay(cheque(c, 'p-1'))]);
    await push(t.staff, c, [pay(cheque(c, 'p-1', { amount: 1 }))]);
    await push(t.staff, c, [{ tbl: 'payments', id: 'p-1', deleted: true }]);
    await push(t.staff, c, [sec(security(c, 's-1'))]);
    await push(t.staff, c, [{ tbl: 'securityCheques', id: 's-1', deleted: true }]);
    // Switched off again (all false): the same.
    await rulesOn(t, { cheques: { issued: false, securityOut: false, received: false } });
    await push(t.staff, c, [pay(cheque(c, 'p-2'))]);
    await push(t.staff, c, [{ tbl: 'payments', id: 'p-2', deleted: true }]);
  });
});

describe('with cheques issued covered', () => {
  it('refuses a new cheque issued by staff, accountants and admins, as approval_required', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    for (const [n, user] of [t.admin, t.accountant, t.staff].entries()) {
      const id = `new-${n}`;
      await expect(push(user, c, [pay(cheque(c, id))])).rejects.toThrow(approvalRequired);
      await expect(push(user, c, [pay(cheque(c, id))])).rejects.toMatchObject({ code: '42501' });
      expect(await stored(c, 'payments', id)).toBeUndefined();
    }
  });

  it('lets the owner and the approvers the owner chose record, change and delete them', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await h.rpc(t.owner, 'set_member_permissions', {
      p_company: c,
      p_user: t.admin,
      p_permissions: json({}),
      p_can_approve: true,
    });
    for (const [n, user] of [t.owner, t.admin].entries()) {
      const id = `ok-${n}`;
      await push(user, c, [pay(cheque(c, id))]);
      for (const [, edited] of edits(c, id)) {
        await push(user, c, [pay(edited)]);
        await push(user, c, [pay(cheque(c, id))]);
      }
      await push(user, c, [{ tbl: 'payments', id, deleted: true }]);
      expect(await stored(c, 'payments', id)).toBeUndefined();
    }
  });

  it('refuses changes of what was confirmed, and lets the cheque’s life, prints, notes and allocations go on', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    let n = 0;
    for (const user of [t.admin, t.accountant, t.staff]) {
      n += 1;
      const id = `life-${n}`;
      await push(t.owner, c, [pay(cheque(c, id))]);
      for (const [label, edited] of edits(c, id)) {
        await expect(push(user, c, [pay(edited)]), label).rejects.toThrow(approvalRequired);
      }
      for (const [label, changed] of lifecycle(c, id)) {
        await push(user, c, [pay(changed)]).catch((error: Error) => {
          throw new Error(`${label}: ${error.message}`);
        });
        // Back to the first leaf is a new number again: the owner's.
        await push(t.owner, c, [pay(cheque(c, id))]);
      }
      expect(await stored(c, 'payments', id)).toMatchObject({ amount: 250 });
    }
  });

  it('refuses a new number unless the old leaf is recorded as spoiled', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.owner, c, [pay(cheque(c, 'leaf-1'))]);
    const base = cheque(c, 'leaf-1');
    // Recorded as spoiled, but another leaf's number.
    await expect(
      push(t.staff, c, [
        pay({
          ...base,
          cheque: {
            ...base.cheque,
            number: '000102',
            spoiledLeaves: [{ number: '000777', at: '2026-10-06T09:00:00.000Z', reason: 'x' }],
          },
        }),
      ]),
    ).rejects.toThrow(approvalRequired);
    // Moving to the next leaf doesn't open the amount.
    await expect(
      push(t.staff, c, [
        pay({
          ...base,
          amount: 9999,
          cheque: {
            ...base.cheque,
            number: '000102',
            spoiledLeaves: [{ number: '000101', at: '2026-10-06T09:00:00.000Z', reason: 'x' }],
          },
        }),
      ]),
    ).rejects.toThrow(approvalRequired);
  });

  it('refuses turning a payment into a cheque, and a cheque into another payment', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    const transfer = cheque(c, 'tr-1', { method: 'bank_transfer', cheque: null });
    await push(t.staff, c, [pay(transfer)]);
    await push(t.staff, c, [pay({ ...transfer, amount: 300, notes: 'Changed' })]);
    await expect(push(t.staff, c, [pay(cheque(c, 'tr-1'))])).rejects.toThrow(approvalRequired);
    await push(t.owner, c, [pay(cheque(c, 'ch-1'))]);
    await expect(
      push(t.staff, c, [pay({ ...cheque(c, 'ch-1'), method: 'cash', cheque: null })]),
    ).rejects.toThrow(approvalRequired);
  });

  it('keeps payments other than cheques issued, and cheques received, as before', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    for (const method of ['bank_transfer', 'cash', 'knet', 'credit_note']) {
      const id = `m-${method}`;
      await push(t.staff, c, [pay(cheque(c, id, { method, cheque: null }))]);
      await push(t.staff, c, [pay(cheque(c, id, { method, cheque: null, amount: 1 }))]);
      await push(t.staff, c, [{ tbl: 'payments', id, deleted: true }]);
    }
    const received = cheque(c, 'in-1', { direction: 'in', clientId: 'cl-1' });
    await push(t.staff, c, [pay(received)]);
    await push(t.staff, c, [pay({ ...received, amount: 1 })]);
    await push(t.staff, c, [{ tbl: 'payments', id: 'in-1', deleted: true }]);
    // Without a direction a payment is received.
    const { direction: _unused, ...plain } = cheque(c, 'in-2');
    void _unused;
    await push(t.staff, c, [pay(plain)]);
  });

  it('keeps cheques issued from being deleted by anyone but an approver', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.owner, c, [pay(cheque(c, 'del-1'))]);
    for (const user of [t.admin, t.accountant, t.staff]) {
      await expect(
        push(user, c, [{ tbl: 'payments', id: 'del-1', deleted: true }]),
      ).rejects.toThrow(/permission/);
    }
    await push(t.owner, c, [{ tbl: 'payments', id: 'del-1', deleted: true }]);
    expect(await stored(c, 'payments', 'del-1')).toBeUndefined();
  });

  it('refuses an older app’s batch with a cheque in it as a whole, as a permission problem', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    const batch: Change[] = [
      { tbl: 'clients', id: 'vendor-9', data: { id: 'vendor-9', companyId: c, name: 'Made-up' } },
      pay(cheque(c, 'old-1')),
    ];
    await expect(push(t.staff, c, batch)).rejects.toMatchObject({ code: '42501' });
    expect(await stored(c, 'clients', 'vendor-9')).toBeUndefined();
    // The rest goes on its own (the app finds the refused change by halves).
    await push(t.staff, c, [batch[0]]);
    // An unchanged copy sent again (an upsert of what is there) goes through.
    await push(t.owner, c, [pay(cheque(c, 'old-2'))]);
    await push(t.staff, c, [pay(cheque(c, 'old-2'))]);
  });

  it('lets staff ask, and an approver record the cheque as confirmed', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    const proposal = cheque(c, 'pay-9', { number: '' });
    await push(t.staff, c, [
      {
        tbl: 'approvals',
        id: 'ap-1',
        data: {
          id: 'ap-1',
          companyId: c,
          kind: 'cheque_create',
          subjectTbl: 'payments',
          subjectId: 'pay-9',
          subjectNumber: '000101',
          before: null,
          after: proposal,
          reason: '',
          status: 'pending',
        },
      },
    ]);
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({
      status: 'pending',
      requestedBy: t.staff,
    });
    // The staff member can't decide it.
    await expect(
      push(t.staff, c, [
        {
          tbl: 'approvals',
          id: 'ap-1',
          data: { ...(await stored(c, 'approvals', 'ap-1')), status: 'approved' },
        },
      ]),
    ).rejects.toThrow(/almail:permission/);
    await push(t.owner, c, [
      {
        tbl: 'approvals',
        id: 'ap-1',
        data: { ...(await stored(c, 'approvals', 'ap-1')), status: 'approved' },
      },
      pay({ ...proposal, number: 'PAYM-0001' }),
    ]);
    expect(await stored(c, 'payments', 'pay-9')).toMatchObject({ number: 'PAYM-0001' });
    // Once it is there, staff deposit and clear it as usual.
    await push(t.staff, c, [pay(lifecycle(c, 'pay-9')[2][1])]);
  });
});

describe('with cheques received covered', () => {
  it('refuses a received cheque from anyone but an approver, when the owner covers them', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t, { cheques: { received: true } });
    const received = cheque(c, 'in-1', { direction: 'in', clientId: 'cl-1' });
    await expect(push(t.staff, c, [pay(received)])).rejects.toThrow(approvalRequired);
    await push(t.owner, c, [pay(received)]);
    await push(t.staff, c, [
      pay({
        ...received,
        cheque: { ...received.cheque, status: 'deposited', depositedOn: '2026-10-21' },
      }),
    ]);
    // Cheques issued are not covered now.
    await push(t.staff, c, [pay(cheque(c, 'out-1'))]);
  });
});

describe('with security cheques given covered', () => {
  it('keeps security cheques handed over for approvers, and those received free', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await expect(push(t.staff, c, [sec(security(c, 's-1'))])).rejects.toThrow(approvalRequired);
    await expect(push(t.accountant, c, [sec(security(c, 's-1'))])).rejects.toMatchObject({
      code: '42501',
    });
    await push(t.owner, c, [sec(security(c, 's-1'))]);
    for (const [label, edited] of [
      ['amount', { amount: 5 }],
      ['number', { number: '000556' }],
      ['bank', { bank: 'NBOK' }],
      ['date', { date: '2026-11-01' }],
      ['holder', { drawer: 'Someone Else' }],
      ['direction', { direction: 'in' }],
    ] as const) {
      await expect(push(t.staff, c, [sec(security(c, 's-1', edited))]), label).rejects.toThrow(
        approvalRequired,
      );
    }
    // Given back, cashed, its purpose and notes: as before.
    await push(t.staff, c, [sec(security(c, 's-1', { notes: 'In the safe', purpose: 'Tender' }))]);
    await push(t.staff, c, [
      sec(security(c, 's-1', { status: 'returned', returnedOn: '2026-10-30' })),
    ]);
    await push(t.staff, c, [
      sec(
        security(c, 's-1', {
          status: 'cashed',
          cashedOn: '2026-10-30',
          paymentId: 'pay-1',
          clientId: 'vendor-1',
        }),
      ),
    ]);
    await expect(
      push(t.staff, c, [{ tbl: 'securityCheques', id: 's-1', deleted: true }]),
    ).rejects.toThrow(/permission/);
    // Received ones are not covered.
    await push(t.staff, c, [sec(security(c, 's-in', { direction: 'in' }))]);
    await push(t.staff, c, [sec(security(c, 's-in', { direction: 'in', amount: 3 }))]);
    await push(t.staff, c, [{ tbl: 'securityCheques', id: 's-in', deleted: true }]);
    // Nor are security cheques given while the owner leaves them out.
    await rulesOn(t, { cheques: { issued: true } });
    await push(t.staff, c, [sec(security(c, 's-2'))]);
  });
});

describe('what a cheque says (cheque_content)', () => {
  it('is the same on the server and in the app', async () => {
    const c = 'parity';
    const base = cheque(c, 'p-1');
    const samples: Record<string, unknown>[] = [
      base,
      { ...base, exchangeRate: 1 },
      { ...base, exchangeRate: null, direction: undefined },
      { ...base, cheque: { ...base.cheque, drawerCivilId: '' } },
      { ...base, cheque: null, method: 'cash' },
      {},
    ];
    for (const sample of samples) {
      const [row] = await h.admin<{ content: Record<string, unknown> }>(
        'select almailbooks.cheque_content($1::jsonb) as content',
        [json(sample)],
      );
      expect(row.content).toEqual(JSON.parse(json(chequeContent(sample))));
    }
    for (const sample of [security(c, 's-1'), security(c, 's-2', { drawerCivilId: '' }), {}]) {
      const [row] = await h.admin<{ content: Record<string, unknown> }>(
        'select almailbooks.security_cheque_content($1::jsonb) as content',
        [json(sample)],
      );
      expect(row.content).toEqual(JSON.parse(json(securityChequeContent(sample))));
    }
  });

  it('decides like the app whether a change waits for an approver', async () => {
    const c = 'parity';
    const base = cheque(c, 'p-1');
    const rulesSets = [
      RULES,
      { cheques: { received: true } },
      { cheques: {} },
      { cheques: 'yes' },
      { documentTypes: ['invoice'] },
    ];
    const pairs: [string, unknown, unknown][] = [
      ...edits(c, 'p-1').map(([label, data]): [string, unknown, unknown] => [label, base, data]),
      ...lifecycle(c, 'p-1').map(([label, data]): [string, unknown, unknown] => [
        label,
        base,
        data,
      ]),
      ['new', null, base],
      ['deleted', base, null],
      ['new received', null, { ...base, direction: 'in' }],
      ['new transfer', null, { ...base, method: 'bank_transfer', cheque: null }],
    ];
    for (const rules of rulesSets) {
      for (const [label, before, after] of pairs) {
        const [row] = await h.admin<{ needs: boolean }>(
          'select almailbooks.cheque_change_needs_approver($1::jsonb, $2, $3::jsonb, $4::jsonb) as needs',
          [json(rules), 'payments', before ? json(before) : null, after ? json(after) : null],
        );
        expect(`${json(rules)} ${label}: ${row.needs}`).toBe(
          `${json(rules)} ${label}: ${chequeChangeNeedsApprover(rules, 'payments', before as object, after as object)}`,
        );
      }
      const given = security(c, 's-1');
      for (const [label, before, after] of [
        ['new', null, given],
        ['amount', given, { ...given, amount: 1 }],
        ['returned', given, { ...given, status: 'returned' }],
        ['received', null, { ...given, direction: 'in' }],
        ['deleted', given, null],
      ] as [string, unknown, unknown][]) {
        const [row] = await h.admin<{ needs: boolean }>(
          'select almailbooks.cheque_change_needs_approver($1::jsonb, $2, $3::jsonb, $4::jsonb) as needs',
          [
            json(rules),
            'securityCheques',
            before ? json(before) : null,
            after ? json(after) : null,
          ],
        );
        expect(`${json(rules)} security ${label}: ${row.needs}`).toBe(
          `${json(rules)} security ${label}: ${chequeChangeNeedsApprover(rules, 'securityCheques', before as object, after as object)}`,
        );
      }
    }
  });
});

describe('server_features', () => {
  it('says the server has cheque confirmation', async () => {
    const user = await h.user(`features-${Math.random().toString(36).slice(2)}@example.com`);
    const [row] = await h.rpc<{ server_features: string[] }>(user, 'server_features');
    expect(row.server_features).toEqual(
      expect.arrayContaining(['tables_v16', 'super_admin', 'approvals', 'cheque_approvals']),
    );
  });
});

describe('the app’s stand-in for the cloud', () => {
  it('answers cheque pushes as the server does', async () => {
    const t = await team();
    const c = t.company;
    const fake = new FakeCloud();
    fake.features = ['tables_v16', 'super_admin', 'approvals', 'cheque_approvals'];
    fake.companies.set(c, { id: c, name: 'Company', purgedUntilRev: 0, createdAt: '' });
    const users: Record<MemberRole, string> = {
      owner: t.owner,
      admin: t.admin,
      accountant: t.accountant,
      staff: t.staff,
      viewer: t.viewer,
    };
    for (const [role, user] of Object.entries(users)) fake.addMember(c, user, role as MemberRole);
    await fake
      .client(t.owner)
      .pushRecords(c, [{ tbl: 'companies', id: c, data: companyRecord(c) }]);
    const both = async (user: string, changes: Change[]) => {
      const inSql = await push(user, c, changes).then(
        () => 'ok',
        (e: Error) => (/approval_required/.test(e.message) ? 'approval' : 'refused'),
      );
      const inFake = await fake
        .client(user)
        .pushRecords(c, changes as never)
        .then(
          () => 'ok',
          (e: { code?: string }) => (e.code === 'approval_required' ? 'approval' : 'refused'),
        );
      return `${inFake} ${inSql}`;
    };
    const owner = async (changes: Change[]) => {
      await push(t.owner, c, changes);
      await fake.client(t.owner).pushRecords(c, changes as never);
    };
    const seen = new Set<string>();
    let n = 0;
    for (const rules of [null, RULES]) {
      if (rules) {
        const data = companyRecord(c, { approvalRules: rules });
        expect(await both(t.owner, [{ tbl: 'companies', id: c, data }])).toBe('ok ok');
      }
      for (const [role, user] of Object.entries(users)) {
        n += 1;
        const id = `fake-${n}`;
        const sid = `fake-sec-${n}`;
        await owner([pay(cheque(c, id)), sec(security(c, sid))]);
        const cases: [string, Change[], Change[]][] = [
          ...[...edits(c, id), ...lifecycle(c, id)].map(
            ([label, data]): [string, Change[], Change[]] => [
              label,
              [pay(data)],
              [pay(cheque(c, id))],
            ],
          ),
          [
            'new',
            [pay(cheque(c, `${id}-new`))],
            [{ tbl: 'payments', id: `${id}-new`, deleted: true }],
          ],
          ['delete', [{ tbl: 'payments', id, deleted: true }], [pay(cheque(c, id))]],
          ['security amount', [sec(security(c, sid, { amount: 7 }))], [sec(security(c, sid))]],
          [
            'security returned',
            [sec(security(c, sid, { status: 'returned' }))],
            [sec(security(c, sid))],
          ],
          [
            'security delete',
            [{ tbl: 'securityCheques', id: sid, deleted: true }],
            [sec(security(c, sid))],
          ],
        ];
        for (const [label, changes, back] of cases) {
          const answer = await both(user, changes);
          const [fakeAnswer, sqlAnswer] = answer.split(' ');
          expect(`${role} ${rules ? 'on' : 'off'} ${label}: ${fakeAnswer}`).toBe(
            `${role} ${rules ? 'on' : 'off'} ${label}: ${sqlAnswer}`,
          );
          seen.add(sqlAnswer);
          if (sqlAnswer === 'ok') await owner(back);
        }
      }
    }
    expect(seen).toEqual(new Set(['ok', 'approval', 'refused']));
  }, 120_000);
});
