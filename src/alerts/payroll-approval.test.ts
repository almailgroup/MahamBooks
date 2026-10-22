// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLanguage } from '@/i18n';
import { startDatabase, type Harness } from '@/cloud/sql-harness';
import type { PayLine, PayRules } from '@/db/types';
import { calculatePayLine } from '@/lib/hr/payroll';
import { handleAlertsRequest, type AlertsDeps, type Sql } from './server';

/**
 * The payroll approval emails of the email-alerts function (#10), against
 * the real database scripts (in an in-process Postgres), with Resend faked:
 * the approvers get the totals by department and position of a pay run sent
 * for approval, and nobody's own pay. Made-up people and amounts.
 */

const PROJECT = 'https://project.supabase.co';
const FUNCTION_URL = `${PROJECT}/functions/v1/email-alerts`;

let h: Harness;
let sql: Sql;
let seq = 0;

interface Sent {
  headers: Record<string, string>;
  body: { from: string; to: string[]; subject: string; html: string; text: string };
}
let sent: Sent[];
let resendAnswer: () => Response;
let env: AlertsDeps['env'];
let logs: string[];

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://api.resend.com/emails') {
    sent.push({
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return resendAnswer();
  }
  throw new Error(`Unexpected request to ${url}`);
};

const deps = (): AlertsDeps => ({
  sql,
  env,
  fetch: fakeFetch,
  now: () => new Date('2026-10-22T06:00:00Z'),
  log: (m) => logs.push(m),
  sleep: async () => {},
});

beforeAll(async () => {
  h = await startDatabase();
  sql = async (query, params = []) => (await h.db.query(query, params)).rows as never[];
  // The function has run once: the trigger knows where it is.
  await h.admin(`update almailbooks.email_alerts_config set function_url = $1 where id`, [
    FUNCTION_URL,
  ]);
}, 60_000);

beforeEach(() => {
  sent = [];
  logs = [];
  resendAnswer = () => Response.json({ id: 'email-1' });
  env = {
    supabaseUrl: PROJECT,
    resendKey: 're_test_key',
    from: 'Maham One <alerts@example.com>',
    apiKey: 'sb_publishable_test',
    appUrl: 'https://app.example.com/',
  };
});

afterEach(async () => {
  await loadLanguage('en');
});

const RULES: PayRules = {
  dailyDivisor: 26,
  rateBase: 'basic',
  pifss: { from: '2026-01-01', employer: 11.5, employee: 10.5, cap: 2750 },
  gcc: [],
  minimumWage: 75,
};

function line(n: number, extra: Partial<PayLine>): PayLine {
  return calculatePayLine(
    {
      id: `line-${n}`,
      employeeId: `emp-${n}`,
      number: `EMP-${n}`,
      name: `Made-up Person ${n}`,
      nameAr: `شخص تجريبي ${n}`,
      jobTitle: 'Guard',
      jobTitleAr: 'حارس',
      department: 'Operations',
      category: 'expat',
      nationality: 'IN',
      civilId: `29001010000${n}`,
      iban: `KW81CBKU000000000000123456010${n}`,
      hireDate: '2024-01-01',
      leavingDate: null,
      permitSalary: 0,
      monthlyBasic: 300 + n * 7,
      allowances: [],
      daysWorked: 30,
      daysInMonth: 30,
      overtime: { normal: 0, restDay: 0, holiday: 0 },
      absentDays: 0,
      unpaidLeaveDays: 0,
      reducedPay: [],
      adjustments: [],
      loans: [],
      basic: 0,
      allowanceTotal: 0,
      overtimePay: 0,
      absenceDeduction: 0,
      additions: 0,
      gross: 0,
      pifssBase: 0,
      pifssEmployee: 0,
      pifssEmployer: 0,
      loanDeduction: 0,
      otherDeductions: 0,
      net: 0,
      ...extra,
    },
    RULES,
    3,
  );
}

const STAMP = '2026-10-20T08:00:00.000Z';

/** Three guards in Operations, two clerks and one driver in Head Office, one with no department. */
const LINES = [
  line(1, {}),
  line(2, {}),
  line(3, {}),
  line(4, { department: 'Head Office', jobTitle: 'Clerk', jobTitleAr: 'كاتب' }),
  line(5, { department: 'Head Office', jobTitle: 'Clerk', jobTitleAr: 'كاتب' }),
  line(6, { department: 'Head Office', jobTitle: 'Driver', jobTitleAr: 'سائق' }),
  line(7, { department: '', jobTitle: 'Cleaner', jobTitleAr: 'عامل نظافة' }),
];

/** A company in the cloud with an owner, a deputy, an admin, an accountant and staff. */
async function company(options: { rules?: Record<string, unknown> | null } = {}) {
  seq += 1;
  const id = `payco-${String(seq).padStart(4, '0')}`;
  const tag = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await h.user(`owner-${tag}@example.com`, { name: 'Made-up Owner' });
  await h.rpc(owner, 'create_company', { p_id: id, p_name: 'Made-up Guarding Co.' });
  const users: Record<string, string> = { owner };
  for (const [key, role] of [
    ['deputy', 'admin'],
    ['admin', 'admin'],
    ['accountant', 'accountant'],
    ['staff', 'staff'],
  ]) {
    const email = `${key}-${tag}@example.com`;
    users[key] = await h.user(email, { name: `Made-up ${key}` });
    const [invite] = await h.rpc<{ token: string }>(owner, 'create_invite', {
      p_company: id,
      p_email: email,
      p_role: role,
    });
    await h.rpc(users[key], 'accept_invite', { p_token: invite.token });
  }
  await h.rpc(owner, 'set_member_permissions', {
    p_company: id,
    p_user: users.deputy,
    p_permissions: '{}',
    p_can_approve: true,
  });
  const rules = options.rules === undefined ? { payroll: true } : options.rules;
  await push(owner, id, [
    {
      tbl: 'companies',
      id,
      data: {
        id,
        name: 'Made-up Guarding Co.',
        nameAr: 'شركة الحراسة التجريبية',
        currency: 'KWD',
        locale: 'en-KW',
        dateFormat: 'dd/MM/yyyy',
        ...(rules ? { approvalRules: rules } : {}),
      },
    },
    {
      tbl: 'peopleSettings',
      id,
      data: {
        id,
        companyId: id,
        departments: [
          { id: 'd1', name: 'Operations', nameAr: 'العمليات' },
          { id: 'd2', name: 'Head Office', nameAr: 'المكتب الرئيسي' },
        ],
      },
    },
  ]);
  const { deputy, admin, accountant, staff } = users;
  return { id, owner, deputy, admin, accountant, staff };
}

type Company = Awaited<ReturnType<typeof company>>;

function push(user: string, companyId: string, changes: unknown[]) {
  return h.rpc(user, 'push_records', { p_company: companyId, p_changes: JSON.stringify(changes) });
}

function payRun(c: string, id: string, lines: PayLine[], extra: Record<string, unknown> = {}) {
  return {
    tbl: 'payRuns',
    id,
    data: {
      id,
      companyId: c,
      period: '2026-09',
      status: 'draft',
      lines,
      updatedAt: STAMP,
      ...extra,
    },
  };
}

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
      after: { runUpdatedAt: STAMP, period: '2026-09', totals: {}, groups: [] },
      reason: 'Two new guards this month.',
      status: 'pending',
      requestedAt: STAMP,
      createdAt: STAMP,
      updatedAt: STAMP,
      ...extra,
    },
  };
}

async function secret() {
  const [row] = await h.admin<{ secret: string }>(
    'select secret from almailbooks.email_alerts_config',
  );
  return row.secret;
}

async function call(body: Record<string, unknown>, secretValue?: string) {
  const response = await handleAlertsRequest(
    new Request(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-alerts-secret': secretValue ?? (await secret()),
      },
      body: JSON.stringify(body),
    }),
    deps(),
  );
  return { status: response.status, body: await response.json() };
}

const approval = (c: Company, approvalId: string, extra: Record<string, unknown> = {}) =>
  call({ action: 'payroll_approval', companyId: c.id, approvalId, ...extra });

async function emailsOf(c: Company, approvalId: string) {
  return h.admin<{
    user_id: string;
    sent_at: string | null;
    finished_at: string | null;
    last_error: string;
    attempts: number;
  }>(
    `select user_id::text as user_id, sent_at, finished_at, last_error, attempts
       from almailbooks.approval_emails where company_id = $1 and approval_id = $2`,
    [c.id, approvalId],
  );
}

async function emailOf(userId: string) {
  const [row] = await h.admin<{ email: string }>('select email from auth.users where id = $1', [
    userId,
  ]);
  return row.email;
}

describe('a pay run sent for approval', () => {
  it('is emailed only when the database asks, with its secret', async () => {
    const c = await company();
    await push(c.accountant, c.id, [payRun(c.id, 'run-1', LINES), request(c.id, 'req-1', 'run-1')]);
    const body = { action: 'payroll_approval', companyId: c.id, approvalId: 'req-1' };
    expect((await call(body, 'wrong')).status).toBe(401);
    expect((await call(body, '')).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await call({ ...body, companyId: 'x' })).status).toBe(400);
    expect((await call({ ...body, approvalId: '' })).status).toBe(400);
  });

  it('emails the owner and the deputy their totals by department and position, nobody else', async () => {
    const c = await company();
    await h.admin(`update public.profiles set language = 'ar' where id = $1`, [c.deputy]);
    await push(c.accountant, c.id, [payRun(c.id, 'run-1', LINES), request(c.id, 'req-1', 'run-1')]);
    const answer = await approval(c, 'req-1');
    expect(answer).toMatchObject({ status: 200, body: { ok: true, sent: 2, failed: 0 } });
    const to = sent.map((s) => s.body.to[0]).sort();
    expect(to).toEqual([await emailOf(c.owner), await emailOf(c.deputy)].sort());

    const english = sent.find((s) => s.body.to[0] === to.find((x) => x.startsWith('owner')))!;
    expect(english.body.subject).toBe(
      'Made-up Guarding Co.: the payroll for September 2026 is waiting for your approval',
    );
    const text = english.body.text;
    expect(text).toContain(
      'Made-up accountant sent the payroll for September 2026 for your approval.',
    );
    expect(text).toContain('Employees: 7 employees');
    // Operations (3 guards) stays; Head Office's driver and the cleaner are alone:
    // "Other positions" and "Other departments".
    expect(text).toMatch(/Operations · 3 ·/);
    expect(text).toMatch(/Guard · 3 ·/);
    expect(text).toMatch(/Clerk · 2 ·/);
    expect(text).toContain('There is a note with it in the app.');
    expect(text).toContain(
      'https://app.example.com/#/payroll/runs/run-1?company=' + encodeURIComponent(c.id),
    );
    // Nobody's own pay, name, Civil ID or IBAN, in either version, nor the note.
    for (const email of sent) {
      for (const part of [email.body.text, email.body.html]) {
        expect(part).not.toMatch(/Made-up Person|شخص تجريبي|2900101|KW81|Two new guards/);
      }
      // No group of one person.
      expect(email.body.text).not.toMatch(/ · 1 · /);
    }
    // The deputy's in Arabic, right to left.
    const arabic = sent.find((s) => s.body.to[0].startsWith('deputy'))!;
    expect(arabic.body.html).toContain('dir="rtl"');
    expect(arabic.body.text).toContain('العمليات');
    // Once each, by request and person.
    expect(sent.map((s) => s.headers['idempotency-key']).sort()).toEqual(
      [`payroll-approval/req-1/${c.owner}`, `payroll-approval/req-1/${c.deputy}`].sort(),
    );
    expect((await emailsOf(c, 'req-1')).every((e) => e.sent_at && e.finished_at)).toBe(true);
    // Asked again: nothing more.
    sent = [];
    expect((await approval(c, 'req-1')).body).toMatchObject({ sent: 0 });
    expect(sent).toEqual([]);
  });

  it('builds links from the function’s address or the person’s saved one, never from the call', async () => {
    const c = await company();
    env = { ...env, appUrl: '' };
    await h.rpc(c.owner, 'set_email_alerts', {
      p_company: c.id,
      p_enabled: true,
      p_topics: ['documents'],
      p_app_url: 'https://saved.example.com/',
    });
    await push(c.accountant, c.id, [payRun(c.id, 'run-1', LINES), request(c.id, 'req-1', 'run-1')]);
    await approval(c, 'req-1', { appUrl: 'https://evil.example.com/' });
    const all = sent.map((s) => s.body.html + s.body.text).join('\n');
    expect(all).not.toContain('evil.example.com');
    const owner = sent.find((s) => s.body.to[0].startsWith('owner'))!;
    expect(owner.body.text).toContain('https://saved.example.com/#/payroll/runs/run-1');
    // The deputy saved none: no link at all.
    const deputy = sent.find((s) => s.body.to[0].startsWith('deputy'))!;
    expect(deputy.body.text).not.toContain('#/payroll/runs/');
  });

  it('shows no amounts for a pay run of one person', async () => {
    const c = await company();
    await push(c.accountant, c.id, [
      payRun(c.id, 'run-1', [LINES[0]]),
      request(c.id, 'req-1', 'run-1', { reason: '' }),
    ]);
    await approval(c, 'req-1');
    expect(sent).toHaveLength(2);
    for (const email of sent) {
      expect(email.body.text).toContain('Employees: 1 employee');
      expect(email.body.text).toContain('Open the pay run in the app to see the amounts.');
      expect(email.body.text).not.toMatch(/KD|KWD|د\.ك/);
    }
  });

  it('isn’t emailed once decided, with the switch off, or for a pay run changed since', async () => {
    const c = await company();
    await push(c.accountant, c.id, [payRun(c.id, 'run-1', LINES), request(c.id, 'req-1', 'run-1')]);
    // Turned down before the email went.
    const [stored] = await h.admin<{ data: Record<string, unknown> }>(
      `select data from public.records where company_id = $1 and tbl = 'approvals' and id = 'req-1'`,
      [c.id],
    );
    await push(c.owner, c.id, [
      { tbl: 'approvals', id: 'req-1', data: { ...stored.data, status: 'rejected' } },
    ]);
    expect((await approval(c, 'req-1')).body).toMatchObject({ sent: 0, finished: 2 });

    // Changed since it was sent.
    await push(c.accountant, c.id, [request(c.id, 'req-2', 'run-1')]);
    await push(c.accountant, c.id, [
      payRun(c.id, 'run-1', LINES, { updatedAt: '2026-10-21T08:00:00.000Z' }),
    ]);
    expect((await approval(c, 'req-2')).body).toMatchObject({ sent: 0, finished: 2 });
    expect(sent).toEqual([]);

    // Off: the trigger notes nobody.
    const off = await company({ rules: { documentTypes: ['invoice'] } });
    await push(off.accountant, off.id, [
      payRun(off.id, 'run-1', LINES),
      request(off.id, 'req-1', 'run-1'),
    ]);
    expect(await emailsOf(off, 'req-1')).toEqual([]);
    expect((await approval(off, 'req-1')).body).toMatchObject({ sent: 0 });
  });

  it('tries again from the 5-minute schedule with the same key', async () => {
    // Only this test's request waits.
    await h.admin('update almailbooks.approval_emails set finished_at = now()');
    const c = await company();
    await push(c.accountant, c.id, [payRun(c.id, 'run-1', LINES), request(c.id, 'req-1', 'run-1')]);
    resendAnswer = () => Response.json({ message: 'Too many requests' }, { status: 429 });
    expect((await approval(c, 'req-1')).body).toMatchObject({ sent: 0, failed: 2 });
    const keys = sent.map((s) => s.headers['idempotency-key']).sort();
    expect((await emailsOf(c, 'req-1')).map((e) => e.last_error)).toEqual([
      'Too many requests',
      'Too many requests',
    ]);
    sent = [];
    resendAnswer = () => Response.json({ id: 'email-2' });
    const notify = await call({ action: 'notify' });
    expect(notify.body).toMatchObject({ ok: true, payroll: { sent: 2, failed: 0 } });
    expect(sent.map((s) => s.headers['idempotency-key']).sort()).toEqual(keys);
    // A request whose emails all went is left alone.
    sent = [];
    expect((await call({ action: 'notify' })).body).toMatchObject({ payroll: { sent: 0 } });
  });

  it('gives up after five tries', async () => {
    const c = await company();
    await push(c.accountant, c.id, [payRun(c.id, 'run-1', LINES), request(c.id, 'req-1', 'run-1')]);
    resendAnswer = () => Response.json({ message: 'Down' }, { status: 500 });
    for (let i = 0; i < 6; i++) await approval(c, 'req-1');
    expect((await emailsOf(c, 'req-1')).map((e) => e.attempts)).toEqual([5, 5]);
    expect(sent).toHaveLength(10);
  });
});
