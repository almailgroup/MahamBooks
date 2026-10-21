// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { startDatabase, type Harness } from './sql-harness';
import {
  guardApprovalWrite,
  INVOICE_CONTENT_FIELDS,
  invoiceContent,
  type MemberRole,
} from './roles';
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

  it('keeps approval requests honest and kept even before the rules are on', async () => {
    const t = await team();
    const c = t.company;
    // A request made up as decided: asked by the accountant, approved by the owner.
    const forged = {
      id: 'ap-1',
      companyId: c,
      kind: 'cheque_create',
      subjectTbl: 'payments',
      subjectId: 'pay-1',
      after: { method: 'cheque', direction: 'out', amount: 9000 },
      status: 'approved',
      requestedBy: t.accountant,
      decidedBy: t.owner,
      decidedAt: '2026-10-01T08:00:00.000Z',
      decisionNote: 'Fine.',
      resultId: 'pay-1',
    };
    // Staff may ask now (approval requests were closed to them before)…
    await push(t.staff, c, [{ tbl: 'approvals', id: 'ap-1', data: forged }]);
    // …but only ask: the server stamps it as theirs, waiting.
    const saved = await stored(c, 'approvals', 'ap-1');
    expect(saved).toMatchObject({
      status: 'pending',
      requestedBy: t.staff,
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
    });
    expect(saved).not.toHaveProperty('resultId');
    // Nobody but an approver decides it, and nobody deletes it, the owner included.
    await expect(
      push(t.staff, c, [{ tbl: 'approvals', id: 'ap-1', data: forged }]),
    ).rejects.toThrow(/almail:permission/);
    for (const user of [t.owner, t.admin, t.accountant, t.staff]) {
      await expect(
        push(user, c, [{ tbl: 'approvals', id: 'ap-1', deleted: true }]),
      ).rejects.toThrow(/permission/);
    }
    // The owner turns the rules on: it still waits for a decision.
    await rulesOn(t, { cheques: { issued: true } });
    expect(await stored(c, 'approvals', 'ap-1')).toMatchObject({ status: 'pending' });
    // Viewers still change nothing.
    await expect(
      push(t.viewer, c, [{ tbl: 'approvals', id: 'ap-2', data: { ...forged, id: 'ap-2' } }]),
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
    // Without Void instead of delete, approvers may delete issued invoices,
    // and nobody else: they ask for a void instead.
    await rulesOn(t, { documentTypes: ['invoice'] });
    for (const user of [t.admin, t.accountant, t.staff]) {
      await expect(
        push(user, c, [{ tbl: 'documents', id: 'del-0', deleted: true }]),
      ).rejects.toThrow(/permission/);
    }
    await push(t.owner, c, [{ tbl: 'documents', id: 'del-0', deleted: true }]);
    expect(await stored(c, 'documents', 'del-0')).toBeUndefined();
  });

  it('refuses deleting an issued invoice and sending it again changed, in one push', async () => {
    const t = await team();
    const c = t.company;
    for (const voidInsteadOfDelete of [false, true]) {
      await rulesOn(t, { documentTypes: ['invoice', 'credit'], voidInsteadOfDelete });
      const id = `inv-${voidInsteadOfDelete}`;
      await push(t.staff, c, [doc(invoice(c, id))]);
      const cheaper = invoice(c, id, { items: [{ ...invoice(c, id).items[0], unitPrice: 15 }] });
      await expect(push(t.staff, c, [doc(cheaper)])).rejects.toThrow(approvalRequired);
      await expect(
        push(t.staff, c, [{ tbl: 'documents', id, deleted: true }, doc(cheaper)]),
      ).rejects.toThrow(/permission/);
      expect(await stored(c, 'documents', id)).toMatchObject({
        items: [expect.objectContaining({ unitPrice: 150 })],
      });
    }
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

  it('stamps a decided request sent up new by a deputy as theirs, and keeps the owner’s', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await h.rpc(t.owner, 'set_member_permissions', {
      p_company: c,
      p_user: t.admin,
      p_permissions: json({}),
      p_can_approve: true,
    });
    // The admin makes up a request the staff member asked for and the owner approved.
    await push(t.admin, c, [
      ask(
        request(c, 'ap-2', {
          status: 'applied',
          requestedBy: t.staff,
          requestedAt: '2026-10-01T08:00:00.000Z',
          decidedBy: t.owner,
          decidedAt: '2026-10-01T09:00:00.000Z',
          decisionNote: 'Owner approved',
        }),
      ),
    ]);
    const saved = await stored(c, 'approvals', 'ap-2');
    expect(saved).toMatchObject({
      status: 'applied',
      requestedBy: t.admin,
      decidedBy: t.admin,
    });
    expect(saved).not.toHaveProperty('requestedByName');
    expect(Date.now() - Date.parse(String(saved?.decidedAt))).toBeLessThan(60_000);
    // The owner sending their company up again keeps their copy as it is.
    const own = request(c, 'ap-3', {
      status: 'rejected',
      requestedBy: t.staff,
      decidedBy: t.owner,
      decidedAt: '2026-10-01T09:00:00.000Z',
    });
    await push(t.owner, c, [ask(own)]);
    expect(await stored(c, 'approvals', 'ap-3')).toMatchObject({
      requestedBy: t.staff,
      decidedBy: t.owner,
      decidedAt: '2026-10-01T09:00:00.000Z',
    });
  });

  it('lets nobody but an approver add to a request, and an approver only what the decision makes', async () => {
    const t = await team();
    const c = t.company;
    await rulesOn(t);
    await push(t.accountant, c, [ask(request(c, 'ap-5'))]);
    const first = await stored(c, 'approvals', 'ap-5');
    // Staff mark someone else's waiting request expired and point it at another payment.
    await push(t.staff, c, [
      ask(request(c, 'ap-5', { expired: true, resultId: 'pay-evil', extra: 'x' })),
    ]);
    expect(await stored(c, 'approvals', 'ap-5')).toEqual(first);
    // The accountant takes it back: nothing else of their copy is kept.
    await push(t.accountant, c, [
      ask(request(c, 'ap-5', { status: 'cancelled', resultId: 'pay-evil', note: 'x' })),
    ]);
    const cancelled = await stored(c, 'approvals', 'ap-5');
    expect(cancelled).toMatchObject({ status: 'cancelled', decidedBy: t.accountant });
    expect(cancelled).not.toHaveProperty('resultId');
    expect(cancelled).not.toHaveProperty('note');
    // An approver's copy says what was made only when it is carried out,
    // and expired only when a waiting request is cancelled.
    await push(t.staff, c, [ask(request(c, 'ap-6'))]);
    await push(t.owner, c, [ask(request(c, 'ap-6', { status: 'approved', resultId: 'pay-x' }))]);
    expect(await stored(c, 'approvals', 'ap-6')).not.toHaveProperty('resultId');
    await push(t.owner, c, [
      ask(request(c, 'ap-6', { status: 'applied', resultId: 'pay-1', expired: true })),
    ]);
    const applied = await stored(c, 'approvals', 'ap-6');
    expect(applied).toMatchObject({ status: 'applied', resultId: 'pay-1' });
    expect(applied).not.toHaveProperty('expired');
    await push(t.owner, c, [ask(request(c, 'ap-6', { status: 'applied', resultId: 'pay-2' }))]);
    expect(await stored(c, 'approvals', 'ap-6')).toMatchObject({ resultId: 'pay-1' });
    await push(t.staff, c, [ask(request(c, 'ap-7'))]);
    await push(t.owner, c, [ask(request(c, 'ap-7', { status: 'cancelled', expired: true }))]);
    expect(await stored(c, 'approvals', 'ap-7')).toMatchObject({
      status: 'cancelled',
      expired: true,
    });
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

describe('invoices numbered when they are issued', () => {
  const numbering = (c: string, numberOnIssue: boolean) =>
    companyRecord(c, { defaults: { numberOnIssue } });

  it('refuses issuing a draft without its number (an older app), whoever sends it', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: numbering(c, true) }]);
    for (const [n, user] of [t.owner, t.admin, t.accountant, t.staff].entries()) {
      for (const type of ['invoice', 'credit']) {
        const id = `draft-${type}-${n}`;
        const draft = invoice(c, id, { type, status: 'draft', number: '' });
        await push(user, c, [doc(draft)]);
        await push(user, c, [doc({ ...draft, notes: 'Changed' })]);
        await expect(push(user, c, [doc({ ...draft, status: 'sent' })])).rejects.toMatchObject({
          code: '42501',
          message: expect.stringMatching(/almail:invalid/),
        });
        // A new one issued at once without a number is refused the same way.
        await expect(
          push(user, c, [doc(invoice(c, `${id}-new`, { type, number: ' ' }))]),
        ).rejects.toMatchObject({ code: '42501' });
        await push(user, c, [doc({ ...draft, status: 'sent', number: `N-${n}` })]);
        expect(await stored(c, 'documents', id)).toMatchObject({ status: 'sent' });
      }
    }
    // Quotes and other documents, voids and drafts staying drafts are not looked at.
    await push(t.staff, c, [doc(invoice(c, 'q-1', { type: 'quote', number: '' }))]);
    await push(t.staff, c, [doc(invoice(c, 'v-1', { status: 'void', number: '' }))]);
  });

  it('changes nothing with the switch off, as today', async () => {
    const t = await team();
    const c = t.company;
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: numbering(c, false) }]);
    const draft = invoice(c, 'd-1', { status: 'draft', number: '' });
    await push(t.staff, c, [doc(draft)]);
    await push(t.staff, c, [doc({ ...draft, status: 'sent' })]);
    expect(await stored(c, 'documents', 'd-1')).toMatchObject({ status: 'sent', number: '' });
  });

  it('leaves an invoice issued without a number before alone when payments change it', async () => {
    const t = await team();
    const c = t.company;
    await push(t.staff, c, [doc(invoice(c, 'old-1', { number: '' }))]);
    await push(t.owner, c, [{ tbl: 'companies', id: c, data: numbering(c, true) }]);
    await push(t.staff, c, [doc(invoice(c, 'old-1', { number: '', status: 'paid' }))]);
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

describe('the app’s copy of the rules for requests (guardApprovalWrite)', () => {
  it('stores what the server stores, and refuses what it refuses, rules on or off', async () => {
    const t = await team();
    const c = t.company;
    await h.rpc(t.owner, 'set_member_permissions', {
      p_company: c,
      p_user: t.admin,
      p_permissions: json({}),
      p_can_approve: true,
    });
    const users: [string, string, boolean][] = [
      ['owner', t.owner, true],
      ['deputy', t.admin, true],
      ['accountant', t.accountant, false],
      ['requester', t.staff, false],
    ];
    const asked = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      companyId: c,
      kind: 'invoice_void',
      subjectTbl: 'documents',
      subjectId: 'inv-1',
      subjectNumber: 'INV-1',
      before: { status: 'sent' },
      after: { status: 'void' },
      reason: 'Entered twice.',
      status: 'pending',
      requestedBy: t.staff,
      requestedByName: 'Made-up Staff',
      requestedAt: '2026-10-02T08:00:00.000Z',
      decidedBy: null,
      decidedAt: null,
      decisionNote: '',
      createdAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-02T08:00:00.000Z',
      ...extra,
    });
    const afters: [string, Record<string, unknown>][] = [
      ['sent again', { expired: true, resultId: 'pay-x', extra: 'x' }],
      ['taken back', { status: 'cancelled', resultId: 'pay-x', note: 'x' }],
      ['expired', { status: 'cancelled', expired: true }],
      ['approved', { status: 'approved', decisionNote: 'Fine.', resultId: 'pay-x' }],
      ['applied', { status: 'applied', resultId: 'pay-1', expired: true }],
      ['rejected', { status: 'rejected', decisionNote: 'No.' }],
      ['waiting again', { status: 'pending', decidedBy: t.staff }],
      ['unknown', { status: 'maybe' }],
      ['forged', { requestedBy: t.owner, after: { status: 'draft' }, decidedBy: t.owner }],
    ];
    // Timestamps the server takes from its clock, the same on both sides.
    const recent = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'string' &&
          /At$/.test(key) &&
          Math.abs(Date.now() - Date.parse(value)) < 120_000
            ? 'now'
            : value,
        ]),
      );
    const answer = async (user: string, data: Record<string, unknown>) =>
      push(user, c, [{ tbl: 'approvals', id: String(data.id), data }]).then(
        async () => recent((await stored(c, 'approvals', String(data.id)))!),
        (e: Error) => (/almail:invalid/.test(e.message) ? 'invalid' : 'permission'),
      );
    const expected = (
      before: Record<string, unknown> | undefined,
      data: Record<string, unknown>,
      user: string,
      approver: boolean,
    ) => {
      const write = guardApprovalWrite(before, data, {
        userId: user,
        approver,
        owner: user === t.owner,
        now: new Date().toISOString(),
      });
      return 'refused' in write ? write.refused : recent(JSON.parse(json(write.data)));
    };
    let n = 0;
    for (const rules of [null, RULES]) {
      if (rules) await rulesOn(t, rules);
      for (const [who, user, approver] of users) {
        for (const start of ['pending', 'approved', 'applied']) {
          for (const [label, change] of afters) {
            n += 1;
            const id = `g-${n}`;
            await push(t.staff, c, [{ tbl: 'approvals', id, data: asked(id) }]);
            if (start !== 'pending') {
              await push(t.owner, c, [
                { tbl: 'approvals', id, data: asked(id, { status: start }) },
              ]);
            }
            const before = await stored(c, 'approvals', id);
            const data = asked(id, { status: before?.status, ...change });
            const want = expected(before, data, user, approver);
            const got = await answer(user, data);
            expect({ case: `${rules ? 'on' : 'off'} ${who} ${start} ${label}`, got }).toEqual({
              case: `${rules ? 'on' : 'off'} ${who} ${start} ${label}`,
              got: want,
            });
          }
        }
        // Sent up new: waiting, or decided already.
        for (const status of ['pending', 'approved', 'applied']) {
          n += 1;
          const data = asked(`g-${n}`, {
            status,
            decidedBy: t.owner,
            decidedAt: '2026-10-02T09:00:00.000Z',
            resultId: 'pay-x',
          });
          const want = expected(undefined, data, user, approver);
          const got = await answer(user, data);
          expect({ case: `${rules ? 'on' : 'off'} ${who} new ${status}`, got }).toEqual({
            case: `${rules ? 'on' : 'off'} ${who} new ${status}`,
            got: want,
          });
        }
      }
    }
  }, 120_000);
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
    for (const rules of [null, RULES, { ...RULES, voidInsteadOfDelete: false }]) {
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
          const when = rules ? `on ${rules.voidInsteadOfDelete ? 'void' : 'delete'}` : 'off';
          expect(`${role} ${when} ${label}: ${fakeAnswer}`).toBe(
            `${role} ${when} ${label}: ${sqlAnswer}`,
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
  }, 120_000);
});
