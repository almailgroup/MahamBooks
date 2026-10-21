// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { startDatabase, type Harness } from './sql-harness';
import { INVOICE_CONTENT_FIELDS, invoiceContent, type MemberRole } from './roles';
import { FakeCloud } from './testing/fake-cloud';

/**
 * Approvals in 20261116000000_super_admin_approvals.sql: records_guard keeps
 * approval requests honest and issued invoices for approvers to change once
 * the owner turns the rules on; can_delete_record keeps requests and issued
 * documents. Without the rules everything is written and deleted as before.
 */

let h: Harness;
let companySeq = 0;

beforeAll(async () => {
  // Each file twice: running a script again must be safe.
  h = await startDatabase(2);
}, 60_000);

const json = (value: unknown) => JSON.stringify(value);

/** A fresh company with its record, an owner, and members in every other role. */
async function team(db: Harness = h) {
  companySeq += 1;
  const company = `ap-company-${String(companySeq).padStart(4, '0')}`;
  const tag = `ap-${companySeq}-${Math.random().toString(36).slice(2, 8)}`;
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
  await push(owner, company, [{ tbl: 'companies', id: company, data: companyRecord(company) }], db);
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

const companyRecord = (c: string, extra: Record<string, unknown> = {}) => ({
  id: c,
  name: 'Gulf Pearl Trading',
  numbering: { invoice: { pattern: 'INV-{counter}', next: 1, padding: 4, reset: 'never' } },
  ...extra,
});

const RULES = { documentTypes: ['invoice', 'credit'], voidInsteadOfDelete: true, expireDays: 14 };

/** The owner turns the rules on (or changes them). */
async function rulesOn(t: Team, rules: Record<string, unknown> = RULES, db: Harness = h) {
  await push(
    t.owner,
    t.company,
    [{ tbl: 'companies', id: t.company, data: companyRecord(t.company, { approvalRules: rules }) }],
    db,
  );
}

/** An issued invoice, as the app stores it. */
function invoice(c: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    companyId: c,
    type: 'invoice',
    number: `INV-${id}`,
    status: 'sent',
    clientId: 'cl-1',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    poNumber: '',
    currency: 'KWD',
    items: [
      {
        id: 'line-1',
        kind: 'item',
        productId: null,
        name: 'Guarding, October',
        description: '',
        quantity: 2,
        unit: '',
        unitPrice: 150,
        discount: 0,
        discountType: 'percent',
        taxes: [],
      },
    ],
    discount: 0,
    discountType: 'percent',
    taxes: [],
    charges: [],
    pricesIncludeTax: false,
    deposit: 0,
    depositDueDate: null,
    notes: '',
    terms: 'Payment within 30 days.',
    footer: '',
    privateNotes: '',
    templateId: null,
    totals: { subtotal: 300, discount: 0, taxTotal: 0, total: 300, paid: 0, balance: 300 },
    sentAt: '2026-10-01T08:00:00.000Z',
    paidAt: null,
    sourceId: null,
    convertedToId: null,
    recurringId: null,
    archived: false,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...extra,
  };
}

const doc = (data: Record<string, unknown>): Change => ({
  tbl: 'documents',
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

/** The ways a member changes an issued invoice that need an approver. */
function edits(c: string, id: string): [string, Record<string, unknown>][] {
  const base = invoice(c, id);
  return [
    ['a line', { ...base, items: [{ ...base.items[0], unitPrice: 120 }] }],
    ['the customer', { ...base, clientId: 'cl-2' }],
    ['the number', { ...base, number: 'INV-9999' }],
    ['the date', { ...base, issueDate: '2026-09-01' }],
    ['the terms', { ...base, terms: 'Cash on delivery.' }],
    ['voided', { ...base, status: 'void' }],
    ['back to draft', { ...base, status: 'draft' }],
  ];
}

const approvalRequired = /almail:approval_required/;

describe('with the rules off', () => {
  it('lets every role that writes documents change, void and delete issued invoices as before', async () => {
    const t = await team();
    const c = t.company;
    let n = 0;
    for (const user of [t.owner, t.admin, t.accountant, t.staff]) {
      n += 1;
      const id = `off-${n}`;
      await push(user, c, [doc(invoice(c, id))]);
      for (const [, edited] of edits(c, id)) {
        await push(user, c, [doc({ ...edited })]);
        await push(user, c, [doc(invoice(c, id))]);
      }
      await push(user, c, [doc(invoice(c, id, { status: 'void' }))]);
      await push(user, c, [doc(invoice(c, id, { status: 'sent' }))]);
      await push(user, c, [{ tbl: 'documents', id, deleted: true }]);
      expect(await stored(c, 'documents', id)).toBeUndefined();
    }
  });

  it('accepts an older app’s whole batch as before', async () => {
    const t = await team();
    const c = t.company;
    await push(t.staff, c, [doc(invoice(c, 'old-1'))]);
    const batch: Change[] = [
      { tbl: 'clients', id: 'cl-1', data: { id: 'cl-1', companyId: c, name: 'Made-up Client' } },
      doc(invoice(c, 'old-1', { notes: 'Changed on an older version' })),
      doc(invoice(c, 'old-2', { status: 'draft', number: '' })),
      {
        tbl: 'payments',
        id: 'pay-1',
        data: { id: 'pay-1', companyId: c, amount: 300, allocations: [] },
      },
    ];
    expect(await push(t.staff, c, batch)).toHaveLength(4);
  });

  it('keeps approval requests as they are sent, and lets them be deleted as before', async () => {
    const t = await team();
    const c = t.company;
    const request = { id: 'ap-1', companyId: c, kind: 'invoice_edit', status: 'pending' };
    // Staff may ask now (approval requests were closed to them before).
    await push(t.staff, c, [{ tbl: 'approvals', id: 'ap-1', data: request }]);
    expect(await stored(c, 'approvals', 'ap-1')).toEqual(request);
    await push(t.admin, c, [{ tbl: 'approvals', id: 'ap-1', deleted: true }]);
    expect(await stored(c, 'approvals', 'ap-1')).toBeUndefined();
    // Viewers still change nothing.
    await expect(
      push(t.viewer, c, [{ tbl: 'approvals', id: 'ap-2', data: { ...request, id: 'ap-2' } }]),
    ).rejects.toThrow(/row-level security/);
  });

  it('leaves the approval rules to the owner, by a push or patch_company', async () => {
    const t = await team();
    const c = t.company;
    for (const user of [t.admin, t.accountant]) {
      await expect(
        push(user, c, [
          { tbl: 'companies', id: c, data: companyRecord(c, { approvalRules: RULES }) },
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        h.rpc(user, 'patch_company', {
          p_company: c,
          p_ops: json([{ path: ['approvalRules'], value: RULES }]),
        }),
      ).rejects.toThrow(/Only the owner changes the approval rules/);
    }
    // Their other settings go through.
    await h.rpc(t.admin, 'patch_company', {
      p_company: c,
      p_ops: json([{ path: ['phone'], value: '+965 0000 0000' }]),
    });
    await h.rpc(t.owner, 'patch_company', {
      p_company: c,
      p_ops: json([{ path: ['approvalRules'], value: RULES }]),
    });
    expect((await stored(c, 'companies', c))?.approvalRules).toEqual(RULES);
  });
});

describe('with the rules on: issued invoices', () => {
  it('refuses content changes, voids and drafts by staff, accountants and admins', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    let n = 0;
    for (const user of [t.admin, t.accountant, t.staff]) {
      n += 1;
      const id = `on-${n}`;
      await push(user, c, [doc(invoice(c, id))]);
      for (const [label, edited] of edits(c, id)) {
        await expect(push(user, c, [doc(edited)]), label).rejects.toThrow(approvalRequired);
        await expect(push(user, c, [doc(edited)]), label).rejects.toMatchObject({
          code: '42501',
        });
      }
      expect(await stored(c, 'documents', id)).toMatchObject({ status: 'sent' });
    }
  });

  it('lets the owner and the approvers the owner chose make them', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await h.rpc(t.owner, 'set_member_permissions', {
      p_company: c,
      p_user: t.accountant,
      p_permissions: json({}),
      p_can_approve: true,
    });
    for (const [n, user] of [t.owner, t.accountant].entries()) {
      const id = `approver-${n}`;
      await push(t.staff, c, [doc(invoice(c, id))]);
      for (const [, edited] of edits(c, id)) await push(user, c, [doc(edited)]);
      await push(user, c, [doc(invoice(c, id, { status: 'void' }))]);
      await push(user, c, [doc(invoice(c, id, { status: 'sent' }))]);
    }
  });

  it('lets payments move an invoice’s balance and status, and leaves drafts and new invoices free', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    const paid = (amount: number, status: string) =>
      invoice(c, 'inv-1', {
        status,
        totals: {
          subtotal: 300,
          discount: 0,
          taxTotal: 0,
          total: 300,
          paid: amount,
          balance: 300 - amount,
        },
        paidAt: status === 'paid' ? '2026-10-10T08:00:00.000Z' : null,
        // What the books and the app write by themselves.
        posting: { taxExempt: false, accounts: {} },
        paymentLink: { provider: 'other', url: 'https://pay.example.com/x', expiresAt: null },
        privateNotes: 'Called the customer.',
        updatedAt: '2026-10-10T08:00:00.000Z',
      });
    await push(t.staff, c, [doc(invoice(c, 'inv-1'))]);
    await push(t.staff, c, [doc(paid(100, 'partial'))]);
    await push(t.staff, c, [doc(paid(300, 'paid'))]);
    await push(t.staff, c, [doc(paid(0, 'sent'))]);
    // Drafts change freely and are issued by anyone.
    const draft = invoice(c, 'draft-1', { status: 'draft', number: '' });
    await push(t.staff, c, [doc(draft)]);
    await push(t.staff, c, [doc({ ...draft, notes: 'Changed', clientId: 'cl-3' })]);
    await push(t.staff, c, [doc({ ...draft, status: 'sent', number: 'INV-0007' })]);
    // A new invoice, saved as sent at once.
    await push(t.staff, c, [doc(invoice(c, 'new-1'))]);
    // Quotes are not covered.
    const quote = invoice(c, 'q-1', { type: 'quote', status: 'sent' });
    await push(t.staff, c, [doc(quote)]);
    await push(t.staff, c, [doc({ ...quote, terms: 'Changed', status: 'declined' })]);
  });

  it('covers credit notes, and a void invoice coming back', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    const credit = invoice(c, 'cr-1', { type: 'credit', number: 'CN-1' });
    await push(t.staff, c, [doc(credit)]);
    await expect(push(t.staff, c, [doc({ ...credit, items: [], status: 'sent' })])).rejects.toThrow(
      approvalRequired,
    );
    await push(t.owner, c, [doc(invoice(c, 'void-1', { status: 'void' }))]);
    await expect(push(t.staff, c, [doc(invoice(c, 'void-1'))])).rejects.toThrow(approvalRequired);
    await expect(
      push(t.staff, c, [doc(invoice(c, 'void-1', { status: 'draft' }))]),
    ).rejects.toThrow(approvalRequired);
  });

  it('refuses an older app’s batch with an edit in it as a whole, as a permission problem', async () => {
    const t = await team();
    const c = t.company;
    await push(t.staff, c, [doc(invoice(c, 'inv-1'))]);
    await rulesOn(t);
    const batch: Change[] = [
      { tbl: 'clients', id: 'cl-9', data: { id: 'cl-9', companyId: c, name: 'Made-up Client' } },
      doc(invoice(c, 'inv-1', { notes: 'Edited offline' })),
    ];
    // An upsert of a record that is there is checked as the change it is.
    await expect(push(t.staff, c, batch)).rejects.toMatchObject({ code: '42501' });
    expect(await stored(c, 'clients', 'cl-9')).toBeUndefined();
    // The rest goes on its own (the app finds the refused change by halves).
    await push(t.staff, c, [batch[0]]);
  });

  it('keeps issued invoices from being deleted by anyone, and lets drafts go', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    for (const [n, user] of [t.owner, t.admin, t.accountant, t.staff].entries()) {
      const id = `del-${n}`;
      await push(t.owner, c, [doc(invoice(c, id))]);
      await expect(push(user, c, [{ tbl: 'documents', id, deleted: true }])).rejects.toThrow(
        /permission/,
      );
      await push(t.owner, c, [doc(invoice(c, id, { status: 'void' }))]);
      await expect(push(user, c, [{ tbl: 'documents', id, deleted: true }])).rejects.toThrow(
        /permission/,
      );
      const draft = `draft-${n}`;
      await push(user, c, [doc(invoice(c, draft, { status: 'draft' }))]);
      await push(user, c, [{ tbl: 'documents', id: draft, deleted: true }]);
      expect(await stored(c, 'documents', draft)).toBeUndefined();
    }
    // Without Void instead of delete, issued invoices may be deleted again.
    await rulesOn(t, { documentTypes: ['invoice'] });
    await push(t.staff, c, [{ tbl: 'documents', id: 'del-0', deleted: true }]);
    expect(await stored(c, 'documents', 'del-0')).toBeUndefined();
  });

  it('turned off (no types left), changes nothing for documents', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t, { documentTypes: [], voidInsteadOfDelete: false });
    await push(t.staff, c, [doc(invoice(c, 'inv-1'))]);
    await push(t.staff, c, [doc(invoice(c, 'inv-1', { status: 'void' }))]);
    await push(t.staff, c, [{ tbl: 'documents', id: 'inv-1', deleted: true }]);
  });
});

describe('with the rules on: approval requests', () => {
  const request = (c: string, id: string, extra: Record<string, unknown> = {}) => ({
    id,
    companyId: c,
    kind: 'invoice_edit',
    subjectTbl: 'documents',
    subjectId: 'inv-1',
    subjectNumber: 'INV-1',
    before: { terms: 'Payment within 30 days.' },
    after: { terms: 'Cash on delivery.' },
    reason: 'The customer asked.',
    status: 'pending',
    requestedBy: 'someone-else',
    requestedByName: 'Made-up Staff',
    requestedAt: '2020-01-01T00:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionNote: '',
    createdAt: '2026-10-02T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    ...extra,
  });
  const ask = (data: Record<string, unknown>): Change => ({
    tbl: 'approvals',
    id: String(data.id),
    data,
  });

  it('stamps a new request with who asked and when, and it waits', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.staff, c, [
      ask(request(c, 'ap-1', { status: 'approved', decidedBy: t.owner, decidedAt: 'x' })),
    ]);
    const saved = await stored(c, 'approvals', 'ap-1');
    expect(saved).toMatchObject({
      status: 'pending',
      requestedBy: t.staff,
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      reason: 'The customer asked.',
    });
    expect(Date.now() - Date.parse(String(saved?.requestedAt))).toBeLessThan(60_000);
  });

  it('lets only an approver decide, and whoever asked take it back while it waits', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.staff, c, [ask(request(c, 'ap-1'))]);
    for (const user of [t.staff, t.accountant, t.admin]) {
      for (const status of ['approved', 'rejected', 'applied']) {
        await expect(push(user, c, [ask(request(c, 'ap-1', { status }))])).rejects.toThrow(
          /almail:permission/,
        );
      }
    }
    // Someone else's request isn't theirs to take back.
    await expect(
      push(t.accountant, c, [ask(request(c, 'ap-1', { status: 'cancelled' }))]),
    ).rejects.toThrow(/almail:permission/);
    await push(t.staff, c, [ask(request(c, 'ap-1', { status: 'cancelled' }))]);
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({
      status: 'cancelled',
      decidedBy: t.staff,
    });
  });

  it('stamps the approver’s decision, and keeps it whatever an older copy says', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.staff, c, [ask(request(c, 'ap-1'))]);
    await push(t.owner, c, [
      ask(request(c, 'ap-1', { status: 'approved', decidedBy: 'forged', decisionNote: 'Fine.' })),
    ]);
    const approved = await stored(c, 'approvals', 'ap-1');
    expect(approved).toMatchObject({
      status: 'approved',
      decidedBy: t.owner,
      decisionNote: 'Fine.',
    });
    // The request sent again from the device that asked (its first push answered late).
    await push(t.staff, c, [ask(request(c, 'ap-1'))]);
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({ status: 'approved' });
    await push(t.owner, c, [ask(request(c, 'ap-1', { status: 'applied' }))]);
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({
      status: 'applied',
      decidedBy: t.owner,
      decidedAt: approved?.decidedAt,
      decisionNote: 'Fine.',
    });
    // The requester's device sends its older copy: still applied.
    await push(t.staff, c, [ask(request(c, 'ap-1', { status: 'cancelled' }))]);
    await push(t.staff, c, [ask(request(c, 'ap-1'))]);
    // A second approver on an older copy can't undo it either.
    await push(t.owner, c, [ask(request(c, 'ap-1', { status: 'rejected' }))]);
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({
      status: 'applied',
      decidedBy: t.owner,
    });
  });

  it('never changes what was asked', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.staff, c, [ask(request(c, 'ap-1'))]);
    const first = await stored(c, 'approvals', 'ap-1');
    await push(t.staff, c, [
      ask(
        request(c, 'ap-1', {
          after: { terms: 'Free of charge.' },
          subjectId: 'inv-2',
          requestedBy: t.owner,
          requestedByName: 'Someone Else',
          reason: 'Changed',
        }),
      ),
    ]);
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({
      after: { terms: 'Cash on delivery.' },
      subjectId: 'inv-1',
      requestedBy: t.staff,
      requestedByName: 'Made-up Staff',
      requestedAt: first?.requestedAt,
      reason: 'The customer asked.',
    });
  });

  it('keeps requests from being deleted, even by the owner', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.staff, c, [ask(request(c, 'ap-1'))]);
    for (const user of [t.owner, t.admin, t.accountant, t.staff]) {
      await expect(
        push(user, c, [{ tbl: 'approvals', id: 'ap-1', deleted: true }]),
      ).rejects.toThrow(/permission/);
    }
  });

  it('keeps requests about payroll from staff, and lets staff not write them', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await expect(
      push(t.staff, c, [ask(request(c, 'ap-pay', { kind: 'payroll', subjectTbl: 'payRuns' }))]),
    ).rejects.toThrow(/row-level security/);
    await push(t.accountant, c, [
      ask(request(c, 'ap-pay', { kind: 'payroll', subjectTbl: 'payRuns' })),
    ]);
    await push(t.staff, c, [ask(request(c, 'ap-inv'))]);
    const seen = await h.rpc<{ id: string }>(t.staff, 'pull_records', {
      p_company: c,
      p_since: 0,
      p_limit: 1000,
    });
    const ids = seen.map((r) => r.id);
    expect(ids).toContain('ap-inv');
    expect(ids).not.toContain('ap-pay');
  });
});

describe('what a document says (invoice_content)', () => {
  it('is the same on the server and in the app', async () => {
    const c = 'parity';
    const base = invoice(c, 'inv-1', {
      exchangeRate: 1,
      accentColor: '#1d4ed8',
      intro: undefined,
      retentionPercent: 5,
      retentionKind: 'contract',
      deliveryPlace: null,
      replacesNumber: 'INV-0001',
      posting: { taxExempt: false, accounts: { 'line-1': 'acc-1' } },
    });
    const samples: Record<string, unknown>[] = [
      base,
      { ...base, items: [{ ...base.items[0], sku: null, nameAr: 'حراسة' }] },
      { ...base, totals: { ...base.totals, paid: 300 }, status: 'paid' },
      {},
      { type: 'credit', number: 'CN-1', notes: null },
    ];
    for (const sample of samples) {
      const [row] = await h.admin<{ content: Record<string, unknown> }>(
        'select almailbooks.invoice_content($1::jsonb) as content',
        [json(sample)],
      );
      expect(row.content).toEqual(JSON.parse(json(invoiceContent(sample))));
    }
    // The fields themselves, as the function lists them.
    const [fn] = await h.admin<{ body: string }>(
      `select prosrc as body from pg_proc where proname = 'invoice_content'`,
    );
    const listed = [...fn.body.matchAll(/'(\w+)', p -> '\1'/g)].map((m) => m[1]);
    expect(listed).toEqual([...INVOICE_CONTENT_FIELDS]);
  });
});

describe('the app’s stand-in for the cloud', () => {
  it('answers pushes as the server does', async () => {
    const t = await team();
    const c = t.company;
    const fake = new FakeCloud();
    fake.features = ['tables_v16', 'super_admin', 'approvals'];
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
        await push(t.owner, c, [doc(invoice(c, id))]);
        await fake.client(t.owner).pushRecords(c, [doc(invoice(c, id))] as never);
        const cases: [string, Change[]][] = [
          ...edits(c, id).map(([label, data]): [string, Change[]] => [label, [doc(data)]]),
          ['paid', [doc(invoice(c, id, { status: 'paid', paidAt: '2026-10-09T00:00:00.000Z' }))]],
          ['delete', [{ tbl: 'documents', id, deleted: true }]],
          [
            'rules',
            [
              {
                tbl: 'companies',
                id: c,
                data: companyRecord(c, { approvalRules: { documentTypes: ['quote'] } }),
              },
            ],
          ],
        ];
        for (const [label, changes] of cases) {
          const answer = await both(user, changes);
          const [fakeAnswer, sqlAnswer] = answer.split(' ');
          expect(`${role} ${rules ? 'on' : 'off'} ${label}: ${fakeAnswer}`).toBe(
            `${role} ${rules ? 'on' : 'off'} ${label}: ${sqlAnswer}`,
          );
          seen.add(sqlAnswer);
          // Back as it was, for the next case.
          if (sqlAnswer === 'ok') {
            const back =
              label === 'rules'
                ? {
                    tbl: 'companies',
                    id: c,
                    data: companyRecord(c, rules ? { approvalRules: rules } : {}),
                  }
                : doc(invoice(c, id));
            await push(t.owner, c, [back]);
            await fake.client(t.owner).pushRecords(c, [back] as never);
          }
        }
      }
    }
    expect(seen).toEqual(new Set(['ok', 'approval', 'refused']));
  }, 60_000);
});
