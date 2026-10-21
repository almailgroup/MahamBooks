import type { Page, Route, WebSocketRoute } from '@playwright/test';

/**
 * A stand-in for the app's Supabase project in browser tests: accounts
 * (sign up with email confirmation, password sign-in, sign-out), the
 * database functions the app calls, profiles and the Realtime socket. It
 * keeps state, so a company uploaded by one person can be downloaded by
 * another, as on the real service. The sandbox can't reach Supabase.
 */

export const SUPABASE_URL = 'https://gagdyhintrxdkiqhahzh.supabase.co';
export const PUBLISHABLE_KEY = 'sb_publishable_KyVAkWtemw_XDnNK8ZKRpA_-5x4pk8d';

type Role = 'owner' | 'admin' | 'accountant' | 'staff' | 'viewer';

export interface FakeUser {
  id: string;
  email: string;
  password: string;
  fullName: string;
  language: 'en' | 'ar';
  confirmed: boolean;
}

interface Row {
  company: string;
  tbl: string;
  id: string;
  data: Record<string, unknown> | null;
  rev: number;
  deleted: boolean;
}

interface Invite {
  id: string;
  token: string;
  company: string;
  email: string;
  role: Role;
  invitedBy: string;
  accepted: boolean;
  revoked?: boolean;
}

export interface SeenRequest {
  method: string;
  path: string;
  apikey: string | null;
  body: unknown;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
};

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A database function refusing the call, as PostgREST answers it. */
class Refusal {
  constructor(
    readonly status: number,
    readonly body: { code: string; message: string },
  ) {}
}

const refuse = (message: string) => new Refusal(403, { code: '42501', message });

type Access = 'none' | 'view' | 'edit' | 'manage';

/**
 * The app a record belongs to, for the owner's limits on a member: the same
 * as almailbooks.record_app (and recordApp in src/cloud/roles.ts).
 */
function recordApp(tbl: string, data: Record<string, unknown> | null): string | null {
  const people = [
    'employees',
    'payRuns',
    'payrollSettings',
    'peopleSettings',
    'leaveRecords',
    'staffLoans',
    'finalSettlements',
    'letterTemplates',
    'employeeLetters',
  ];
  const shared = ['companies', 'activities', 'attachments', 'approvals'];
  if (people.includes(tbl)) return 'people';
  if (tbl === 'journals' && data?.kind === 'payroll') return 'people';
  const employee = typeof data?.employeeId === 'string' && data.employeeId !== '';
  if ((tbl === 'complianceDocuments' || tbl === 'renewals') && employee) return 'people';
  if (['complianceDocuments', 'renewals', 'complianceMarks', 'vehicles'].includes(tbl)) {
    return 'compliance';
  }
  return shared.includes(tbl) ? null : 'books';
}

const SENIOR: Role[] = ['admin', 'accountant'];

/**
 * What a document says, as almailbooks.invoice_content (and invoiceContent
 * in src/cloud/roles.ts), as canonical JSON: keys sorted, nulls left out.
 */
const CONTENT = [
  'type',
  'number',
  'clientId',
  'issueDate',
  'dueDate',
  'poNumber',
  'vendorReference',
  'currency',
  'exchangeRate',
  'items',
  'discount',
  'discountType',
  'taxes',
  'charges',
  'pricesIncludeTax',
  'deposit',
  'depositDueDate',
  'notes',
  'terms',
  'footer',
  'intro',
  'templateId',
  'accentColor',
  'deliveryDate',
  'deliveryPlace',
  'retentionPercent',
  'retentionKind',
  'replacesNumber',
];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const content = (doc: Record<string, unknown>) =>
  canonical(Object.fromEntries(CONTENT.map((key) => [key, doc[key]])));

const stage = (status: unknown) => (status === 'draft' || status === 'void' ? status : 'issued');

type Data = Record<string, unknown>;

/**
 * What an approver confirms on a cheque, as almailbooks.cheque_content (and
 * chequeContent in src/cloud/roles.ts), as canonical JSON.
 */
function chequeContent(p: Data): Data {
  const cheque = (p.cheque && typeof p.cheque === 'object' ? p.cheque : {}) as Data;
  return {
    method: p.method,
    direction: p.direction ?? 'in',
    clientId: p.clientId,
    date: p.date,
    amount: p.amount,
    currency: p.currency,
    exchangeRate: p.exchangeRate ?? 1,
    accountId: p.accountId,
    number: cheque.number,
    bank: cheque.bank,
    chequeDate: cheque.date,
    drawer: cheque.drawer,
    drawerCivilId: cheque.drawerCivilId === '' ? null : cheque.drawerCivilId,
  };
}

const securityContent = (p: Data): Data => ({
  direction: p.direction ?? 'in',
  number: p.number,
  bank: p.bank,
  date: p.date,
  amount: p.amount,
  currency: p.currency,
  drawer: p.drawer,
  drawerCivilId: p.drawerCivilId === '' ? null : p.drawerCivilId,
});

/**
 * Whether a change of a payment or security cheque waits for an approver,
 * as almailbooks.cheque_change_needs_approver.
 */
function chequeNeedsApprover(
  cheques: { issued?: boolean; received?: boolean; securityOut?: boolean } | undefined,
  tbl: string,
  old: Data | null,
  data: Data | null,
): boolean {
  if (!cheques || typeof cheques !== 'object') return false;
  if (tbl === 'payments') {
    const covers = (p: Data | null) =>
      Boolean(
        p &&
        p.method === 'cheque' &&
        cheques[p.direction === 'out' ? 'issued' : 'received'] === true,
      );
    if (!covers(old) && !covers(data)) return false;
    if (!old || !data) return true;
    const a = chequeContent(old);
    const b = chequeContent(data);
    const leaves = ((data.cheque as Data | null)?.spoiledLeaves ?? []) as Data[];
    const moved = a.number == null ? null : String(a.number).trim();
    if (
      a.number !== b.number &&
      moved !== null &&
      leaves.some((leaf) => leaf?.number != null && String(leaf.number).trim() === moved)
    ) {
      delete a.number;
      delete b.number;
    }
    // A cheque given its first account keeps its confirmation.
    if (a.accountId == null || a.accountId === '') {
      delete a.accountId;
      delete b.accountId;
    }
    return canonical(a) !== canonical(b);
  }
  if (tbl === 'securityCheques') {
    const covers = (p: Data | null) =>
      Boolean(p && p.direction === 'out' && cheques.securityOut === true);
    if (!covers(old) && !covers(data)) return false;
    if (!old || !data) return true;
    return canonical(securityContent(old)) !== canonical(securityContent(data));
  }
  return false;
}

const chequeConfirmationRequired = () =>
  new Refusal(403, {
    code: '42501',
    message:
      'almail:approval_required This cheque needs confirmation. Send it for confirmation instead.',
  });

/** Refusals of almailbooks.records_guard, as PostgREST answers them. */
const approvalRequired = () =>
  new Refusal(403, {
    code: '42501',
    message:
      'almail:approval_required This change to an issued document needs approval. Send it for approval instead.',
  });

/** A row of public.change_events, as notification_feed answers it. */
interface ChangeRow {
  company: string;
  id: number;
  at: string;
  actor: string;
  op: string;
  tbl: string;
  record_id: string;
  kind: string;
  important: boolean;
  private: boolean;
  count: number;
  fold: string;
  summary: Data;
}

/** The kind of change a record makes, as almailbooks.change_kind. */
function changeKind(tbl: string, data: Data | null): string {
  const people = [
    'employees',
    'payRuns',
    'payrollSettings',
    'peopleSettings',
    'leaveRecords',
    'staffLoans',
    'finalSettlements',
    'letterTemplates',
    'employeeLetters',
  ];
  if (tbl === 'documents') return 'document';
  if (tbl === 'payments') return data?.method === 'cheque' ? 'cheque' : 'payment';
  if (tbl === 'securityCheques') return 'cheque';
  if (tbl === 'approvals') return 'approval';
  if (tbl === 'companies') return 'settings';
  if (people.includes(tbl)) return 'people';
  if (['complianceDocuments', 'renewals', 'complianceMarks', 'vehicles'].includes(tbl)) {
    return 'compliance';
  }
  if (tbl === 'clients') return 'contact';
  if (['products', 'warehouses', 'stockMovements', 'stockEntries', 'landedCosts'].includes(tbl)) {
    return 'item';
  }
  if (tbl === 'expenses') return 'expense';
  if (tbl === 'attachments') return 'file';
  return 'accounting';
}

/**
 * What a change did, as almailbooks.change_details, for what these tests
 * look at: documents, cheques and approval requests; everything else is an
 * ordinary change. Payroll and people records say only what happened.
 */
function changeDetails(
  tbl: string,
  old: Data | null,
  data: Data | null,
  isPrivate: boolean,
  client: Data | null,
): { important: boolean; summary: Data } | null {
  const row = (data ?? old)!;
  let what = !old ? 'added' : !data ? 'deleted' : 'updated';
  if (isPrivate) return { important: false, summary: { what } };
  if (tbl === 'documents') {
    if (old && data) {
      const was = stage(old.status);
      const now = stage(data.status);
      what =
        now === 'void' && was !== 'void'
          ? 'voided'
          : was === 'void' && now !== 'void'
            ? 'restored'
            : was === 'draft' && now === 'issued'
              ? 'issued'
              : was === 'issued' && now === 'issued' && content(old) !== content(data)
                ? 'edited'
                : 'updated';
    }
    const covered = row.type === 'invoice' || row.type === 'credit';
    const totals = (row.totals ?? {}) as Data;
    return {
      important:
        covered &&
        (['voided', 'restored', 'edited'].includes(what) ||
          (what === 'deleted' && stage(old?.status) !== 'draft')),
      summary: Object.fromEntries(
        Object.entries({
          what,
          type: row.type,
          number: row.number,
          status: row.status,
          total: typeof totals.total === 'number' ? totals.total : null,
          currency: row.currency,
          client: client?.name ?? null,
          clientAr: client?.nameAr ?? null,
        }).filter(([, v]) => v !== null && v !== undefined),
      ),
    };
  }
  if (tbl === 'approvals') {
    if (!old) what = 'requested';
    else if (data && data.status !== old.status) what = String(data.status);
    return {
      important: ['requested', 'approved', 'rejected'].includes(what),
      summary: { what, request: row.kind, number: row.subjectNumber, status: row.status },
    };
  }
  if (tbl === 'companies' && old && data) {
    const strip = (r: Data) => {
      const copy = { ...r };
      for (const key of ['numbering', 'updatedAt']) delete copy[key];
      return canonical(copy);
    };
    if (strip(old) === strip(data)) return null;
  }
  return { important: false, summary: { what } };
}

export class FakeSupabase {
  users = new Map<string, FakeUser>();
  companies = new Map<
    string,
    { id: string; name: string; members: Map<string, Role>; createdAt: string }
  >();
  records = new Map<string, Row>();
  invites: Invite[] = [];
  requests: SeenRequest[] = [];
  /** The owner's limits and approver mark per member, by "company user". */
  access = new Map<
    string,
    { permissions: { apps?: Record<string, Access> }; canApprove: boolean }
  >();
  /** Companies whose owner makes admins and accountants alone. */
  seniorRolesOwnerOnly = new Set<string>();
  /** Email alerts by "company user", and the emails asked for from the app. */
  emailAlerts = new Map<string, { enabled: boolean; topics: string[]; appUrl: string }>();
  alertEmails: { company: string; to: string }[] = [];
  /** The change feed: the changes, each person's choice and how far they read, by "company user". */
  changes: ChangeRow[] = [];
  changeSettings = new Map<
    string,
    { enabled: boolean; immediateKinds: string[]; digest: string; appUrl: string }
  >();
  changeReads = new Map<string, number>();
  private changeSeq = 0;
  private pushSeq = 0;
  private rev = 0;
  private tokens = new Map<string, string>();
  private counter = 0;

  addUser(email: string, password: string, fullName: string, confirmed = true): FakeUser {
    this.counter += 1;
    const user: FakeUser = {
      id: `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`,
      email: email.toLowerCase(),
      password,
      fullName,
      language: 'en',
      confirmed,
    };
    this.users.set(user.email, user);
    return user;
  }

  /** An invitation link token for `email`, as the owner would create it. */
  invite(company: string, email: string, role: Role, invitedBy: string): Invite {
    const invite: Invite = {
      id: `invite-${this.invites.length + 1}`,
      token: 'ab'.repeat(32),
      company,
      email,
      role,
      invitedBy,
      accepted: false,
    };
    this.invites.push(invite);
    return invite;
  }

  rows(company: string, tbl?: string): Row[] {
    return [...this.records.values()].filter(
      (r) => r.company === company && !r.deleted && (!tbl || r.tbl === tbl),
    );
  }

  calls(fn: string): SeenRequest[] {
    return this.requests.filter((r) => r.path === `/rest/v1/rpc/${fn}`);
  }

  async install(page: Page): Promise<void> {
    await page.route(`${SUPABASE_URL}/**`, (route) => this.handle(route));
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => this.socket(ws));
  }

  private userJson(user: FakeUser) {
    const now = new Date().toISOString();
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: user.confirmed ? now : null,
      confirmed_at: user.confirmed ? now : null,
      confirmation_sent_at: now,
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: user.fullName, language: user.language },
      identities: [],
      created_at: now,
      updated_at: now,
    };
  }

  private session(user: FakeUser) {
    const now = Math.floor(Date.now() / 1000);
    const token = [
      base64url({ alg: 'HS256', typ: 'JWT' }),
      base64url({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
        aud: 'authenticated',
        iat: now,
        exp: now + 3600,
      }),
      'signature',
    ].join('.');
    this.tokens.set(token, user.id);
    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: `refresh-${user.id}`,
      user: this.userJson(user),
    };
  }

  private byToken(header: string | null): FakeUser | undefined {
    const id = this.tokens.get((header ?? '').replace(/^Bearer /i, ''));
    return [...this.users.values()].find((u) => u.id === id);
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 200, headers: CORS });
      return;
    }
    const raw = request.postData();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    const headers = await request.allHeaders();
    this.requests.push({ method, path: url.pathname, apikey: headers.apikey ?? null, body });
    const me = this.byToken(headers.authorization ?? null);
    const json = (status: number, value: unknown) =>
      route.fulfill({
        status,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    const b = (body ?? {}) as Record<string, unknown>;

    // Accounts
    if (url.pathname === '/auth/v1/signup') {
      const email = String(b.email).toLowerCase();
      const meta = (b.data ?? {}) as { full_name?: string; language?: 'en' | 'ar' };
      const user =
        this.users.get(email) ??
        this.addUser(email, String(b.password), meta.full_name ?? '', false);
      user.fullName = meta.full_name ?? user.fullName;
      user.language = meta.language ?? user.language;
      return json(200, this.userJson(user));
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const user = this.users.get(String(b.email).toLowerCase());
      if (!user || user.password !== b.password || !user.confirmed) {
        return json(400, {
          code: 400,
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        });
      }
      return json(200, this.session(user));
    }
    if (url.pathname === '/auth/v1/logout') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === '/auth/v1/user') {
      if (!me) return json(401, { code: 401, msg: 'Unauthorized' });
      if (method === 'PUT') {
        const data = (b.data ?? {}) as { full_name?: string; language?: 'en' | 'ar' };
        if (data.full_name) me.fullName = data.full_name;
        if (data.language) me.language = data.language;
      }
      return json(200, this.userJson(me));
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(200, {});

    // Profiles
    if (url.pathname === '/rest/v1/profiles') {
      if (!me) return json(200, []);
      if (method === 'PATCH') {
        if (typeof b.full_name === 'string') me.fullName = b.full_name;
        if (b.language === 'en' || b.language === 'ar') me.language = b.language;
        return route.fulfill({ status: 204, headers: CORS });
      }
      const profile = { full_name: me.fullName, language: me.language, email: me.email };
      return (headers.accept ?? '').includes('vnd.pgrst.object')
        ? json(200, profile)
        : json(200, [profile]);
    }
    if (url.pathname === '/rest/v1/records') return json(200, []);
    if (url.pathname.startsWith('/storage/v1/')) return json(200, []);

    // The email-alerts function: "Send it now".
    if (url.pathname === '/functions/v1/email-alerts') {
      if (!me) return json(401, { ok: false, error: 'auth', message: 'Sign in again.' });
      const company = String(b.companyId ?? '');
      const role = this.companies.get(company)?.members.get(me.id);
      if (role !== 'owner' && role !== 'admin') {
        return json(403, { ok: false, error: 'permission', message: '' });
      }
      if (!this.emailAlerts.get(`${company} ${me.id}`)?.enabled) {
        return json(409, { ok: false, error: 'not_enabled', message: '' });
      }
      this.alertEmails.push({ company, to: me.email });
      return json(200, { ok: true, to: me.email, count: 3 });
    }

    // Database functions
    const fn = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)?.[1];
    if (fn && me) {
      const result = this.rpc(fn, b, me);
      if (result === undefined) return route.fulfill({ status: 204, headers: CORS });
      if (result instanceof Refusal) {
        return json(result.status, { ...result.body, details: null, hint: null });
      }
      return json(200, result);
    }
    return json(404, { message: 'Not found' });
  }

  /** Whether the owner's limits keep `user` from storing this record (as can_write_record). */
  private limited(
    company: string,
    user: string,
    tbl: string,
    data: Record<string, unknown> | null,
  ): boolean {
    if (this.companies.get(company)?.members.get(user) === 'owner') return false;
    const app = recordApp(tbl, data);
    const limit = app ? this.access.get(`${company} ${user}`)?.permissions.apps?.[app] : undefined;
    return limit === 'none' || limit === 'view';
  }

  /**
   * almailbooks.records_guard and the approval part of can_delete_record:
   * what is stored for a change, or the refusal.
   */
  private guard(
    company: string,
    user: string,
    role: Role | undefined,
    change: { tbl: string; id: string; data?: Record<string, unknown>; deleted?: boolean },
  ): Record<string, unknown> | null | Refusal {
    const row = this.records.get(`${company}/${change.tbl}/${change.id}`);
    const old = row && !row.deleted ? row.data : null;
    const data = change.deleted ? null : (change.data ?? null);
    const companyRow = this.records.get(`${company}/companies/${company}`);
    const rules = (companyRow?.data?.approvalRules ?? null) as {
      documentTypes?: string[];
      voidInsteadOfDelete?: boolean;
      cheques?: { issued?: boolean; received?: boolean; securityOut?: boolean };
    } | null;
    if (change.tbl === 'companies') {
      const before = canonical(old?.approvalRules ?? null);
      if (data && role !== 'owner' && before !== canonical(data.approvalRules ?? null)) {
        return refuse('almail:permission Only the owner changes the approval rules.');
      }
      return data;
    }
    const approver =
      role === 'owner' ||
      ((role === 'admin' || role === 'accountant') &&
        Boolean(this.access.get(`${company} ${user}`)?.canApprove));
    if (rules && (change.tbl === 'payments' || change.tbl === 'securityCheques')) {
      if (!approver && chequeNeedsApprover(rules.cheques, change.tbl, old, data)) {
        return data
          ? chequeConfirmationRequired()
          : refuse('almail:permission You cannot delete this record.');
      }
      return data;
    }
    if (change.tbl !== 'documents' && change.tbl !== 'approvals') return data;
    const covers = (doc: Record<string, unknown> | null) =>
      Boolean(doc && rules?.documentTypes?.includes(String(doc.type)));
    if (!data) {
      if (!old) return null;
      // Approval requests stay, whether or not the rules are on.
      if (change.tbl === 'approvals')
        return refuse('almail:permission You cannot delete this record.');
      if (
        rules &&
        covers(old) &&
        old.status !== 'draft' &&
        (rules.voidInsteadOfDelete || !approver)
      ) {
        return refuse('almail:permission You cannot delete this record.');
      }
      return null;
    }
    if (change.tbl === 'documents') {
      // With numberOnIssue, an invoice or credit note is never issued without its number.
      const defaults = (companyRow?.data?.defaults ?? null) as { numberOnIssue?: boolean } | null;
      if (
        defaults?.numberOnIssue === true &&
        (data.type === 'invoice' || data.type === 'credit') &&
        stage(data.status) === 'issued' &&
        String(data.number ?? '').trim() === '' &&
        (!old || old.status === 'draft')
      ) {
        return refuse(
          'almail:invalid This invoice has no number yet. Update the app on this device, then issue it again.',
        );
      }
      if (!rules || !old || approver || old.status === 'draft' || !(covers(old) || covers(data)))
        return data;
      return content(old) !== content(data) || stage(old.status) !== stage(data.status)
        ? approvalRequired()
        : data;
    }
    // Approval requests, whether or not the rules are on.
    const now = new Date().toISOString();
    if (!old) {
      if (approver && (data.status ?? 'pending') !== 'pending') {
        if (role === 'owner') return data;
        const own: Record<string, unknown> = { ...data };
        if (own.requestedBy !== user) {
          delete own.requestedByName;
          Object.assign(own, { requestedBy: user, requestedAt: now });
        }
        if (own.decidedBy !== user) Object.assign(own, { decidedBy: user, decidedAt: now });
        return own;
      }
      const asked: Record<string, unknown> = { ...data };
      delete asked.expired;
      delete asked.resultId;
      return {
        ...asked,
        status: 'pending',
        requestedBy: user,
        requestedAt: now,
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
      };
    }
    const kept = (target: Record<string, unknown>, key: string) => {
      if (key in old && old[key] !== undefined) target[key] = old[key];
      else delete target[key];
    };
    const was = String(old.status ?? 'pending');
    const status = String(data.status ?? was);
    // Whoever isn't an approver changes nothing of a request but taking it back.
    const next: Record<string, unknown> = approver
      ? { ...data }
      : { ...old, status, ...('updatedAt' in data ? { updatedAt: data.updatedAt } : {}) };
    for (const key of [
      'kind',
      'subjectTbl',
      'subjectId',
      'subjectNumber',
      'before',
      'after',
    ].concat(['reason', 'requestedBy', 'requestedByName', 'requestedAt', 'createdAt'])) {
      kept(next, key);
    }
    const decision = {
      decidedBy: old.decidedBy ?? null,
      decidedAt: old.decidedAt ?? null,
      decisionNote: old.decisionNote ?? '',
    };
    if (
      status === was ||
      status === 'pending' ||
      ['rejected', 'cancelled', 'applied'].includes(was)
    ) {
      const same: Record<string, unknown> = { ...next, status: was, ...decision };
      kept(same, 'expired');
      kept(same, 'resultId');
      return same;
    }
    const takenBack = was === 'pending' && status === 'cancelled' && old.requestedBy === user;
    if (!approver && !takenBack) {
      return refuse('almail:permission Only an approver decides approval requests.');
    }
    if (!(approver && was === 'pending' && status === 'cancelled')) kept(next, 'expired');
    if (!(approver && status === 'applied')) kept(next, 'resultId');
    if (was === 'approved' && status === 'applied') return { ...next, ...decision };
    return { ...next, decidedBy: user, decidedAt: now };
  }

  private approver(company: string, user: string): boolean {
    const role = this.companies.get(company)?.members.get(user);
    return (
      role === 'owner' ||
      ((role === 'admin' || role === 'accountant') &&
        Boolean(this.access.get(`${company} ${user}`)?.canApprove))
    );
  }

  /** As almailbooks.records_change_event, once someone of the company asked for the feed. */
  private recordChange(
    company: string,
    user: string,
    push: number,
    tbl: string,
    id: string,
    old: Data | null,
    data: Data | null,
  ) {
    const on = [...this.changeSettings].some(
      ([key, settings]) => key.startsWith(`${company} `) && settings.enabled,
    );
    if (!on || tbl === 'activities' || (old && data && canonical(old) === canonical(data))) return;
    const row = (data ?? old)!;
    const people = ['employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords'];
    const isPrivate =
      people.includes(tbl) ||
      row._private === true ||
      (tbl === 'complianceDocuments' &&
        typeof row.employeeId === 'string' &&
        row.employeeId !== '');
    const clientId = typeof row.clientId === 'string' ? row.clientId : '';
    const client = clientId
      ? (this.records.get(`${company}/clients/${clientId}`)?.data ?? null)
      : null;
    const details = changeDetails(tbl, old, data, isPrivate, client);
    if (!details) return;
    const kind = changeKind(tbl, row);
    const op = !old ? 'insert' : !data ? 'delete' : 'update';
    const fold = details.important
      ? `one:${this.changeSeq + 1}`
      : ['tx', push, user, tbl, tbl === 'documents' ? row.type : '', kind, isPrivate].join(':');
    const folded = this.changes.find((c) => c.company === company && c.fold === fold);
    if (folded) {
      folded.count += 1;
      folded.op = folded.op === op ? op : 'mixed';
      folded.record_id = id;
      folded.summary = details.summary;
      return;
    }
    this.changeSeq += 1;
    this.changes.push({
      company,
      id: this.changeSeq,
      at: new Date().toISOString(),
      actor: user,
      op,
      tbl,
      record_id: id,
      kind,
      important: details.important,
      private: isPrivate,
      count: 1,
      fold,
      summary: details.summary,
    });
  }

  private changeSettingsRow(company: string, user: string) {
    const saved = this.changeSettings.get(`${company} ${user}`);
    return [
      {
        enabled: saved?.enabled ?? false,
        immediate_kinds: saved?.immediateKinds ?? [
          'document',
          'cheque',
          'approval',
          'member',
          'settings',
          'people',
        ],
        digest: saved?.digest ?? 'daily',
        last_sent_at: null,
        last_error: '',
        last_error_at: null,
        function_ready: true,
      },
    ];
  }

  private rpc(fn: string, b: Record<string, unknown>, me: FakeUser): unknown {
    const company = String(b.p_company ?? '');
    const entry = this.companies.get(company);
    const mine = entry?.members.get(me.id);
    const ownerOnly = this.seniorRolesOwnerOnly.has(company);
    switch (fn) {
      case 'create_company': {
        const id = String(b.p_id);
        let entry = this.companies.get(id);
        if (!entry) {
          entry = {
            id,
            name: String(b.p_name),
            members: new Map(),
            createdAt: new Date().toISOString(),
          };
          entry.members.set(me.id, 'owner');
          this.companies.set(id, entry);
        }
        return [{ id, name: entry.name, role: 'owner' }];
      }
      case 'my_companies':
        return [...this.companies.values()]
          .filter((c) => c.members.has(me.id))
          .map((c) => ({
            id: c.id,
            name: c.name,
            role: c.members.get(me.id),
            created_at: c.createdAt,
            members: c.members.size,
          }));
      case 'push_records': {
        const changes = b.p_changes as {
          tbl: string;
          id: string;
          data?: Record<string, unknown>;
          deleted?: boolean;
        }[];
        // All or nothing, like the database: the owner's limits on the member.
        const blocked = changes.some((change) => {
          const old = this.records.get(`${company}/${change.tbl}/${change.id}`)?.data ?? null;
          return (
            this.limited(company, me.id, change.tbl, change.data ?? null) ||
            this.limited(company, me.id, change.tbl, old)
          );
        });
        if (blocked) {
          return refuse('new row violates row-level security policy for table "records"');
        }
        // Then the company's approval rules (records_guard, can_delete_record).
        const stored: (Record<string, unknown> | null)[] = [];
        for (const change of changes) {
          const guarded = this.guard(company, me.id, mine, change);
          if (guarded instanceof Refusal) return guarded;
          stored.push(guarded);
        }
        this.pushSeq += 1;
        return changes.map((change, i) => {
          const before = this.records.get(`${company}/${change.tbl}/${change.id}`);
          this.recordChange(
            company,
            me.id,
            this.pushSeq,
            change.tbl,
            change.id,
            before && !before.deleted ? before.data : null,
            change.deleted ? null : stored[i],
          );
          this.rev += 1;
          this.records.set(`${company}/${change.tbl}/${change.id}`, {
            company,
            tbl: change.tbl,
            id: change.id,
            data: change.deleted ? null : stored[i],
            rev: this.rev,
            deleted: Boolean(change.deleted),
          });
          return { tbl: change.tbl, id: change.id, rev: this.rev, conflict: false };
        });
      }
      case 'pull_records': {
        const since = Number(b.p_since ?? 0);
        const limit = Number(b.p_limit ?? 500);
        return [...this.records.values()]
          .filter((r) => r.company === company && r.rev > since)
          .sort((x, y) => x.rev - y.rev)
          .slice(0, limit)
          .map((r) => ({ tbl: r.tbl, id: r.id, data: r.data, rev: r.rev, deleted: r.deleted }));
      }
      case 'company_sync_info': {
        const rows = this.rows(company);
        return [
          {
            purged_until_rev: 0,
            record_count: rows.length,
            max_rev: Math.max(0, ...rows.map((r) => r.rev)),
          },
        ];
      }
      case 'company_record_ids':
        return [];
      case 'server_features':
        return ['tables_v16', 'super_admin', 'approvals', 'cheque_approvals', 'change_feed'];
      // The change feed (20261123000000_change_feed.sql).
      case 'notification_status': {
        if (!this.approver(company, me.id)) return [{ enabled: false, unread: 0, latest: 0 }];
        const key = `${company} ${me.id}`;
        const visible = this.changes.filter((c) => c.company === company && c.actor !== me.id);
        const read = this.changeReads.get(key) ?? 0;
        return [
          {
            enabled: Boolean(this.changeSettings.get(key)?.enabled),
            unread: Math.min(100, visible.filter((c) => c.id > read).length),
            latest: Math.max(0, ...visible.map((c) => c.id)),
          },
        ];
      }
      case 'notification_feed': {
        if (!this.approver(company, me.id)) {
          return refuse('almail:permission Only the owner and approvers see the changes.');
        }
        const read = this.changeReads.get(`${company} ${me.id}`) ?? 0;
        const after = Number(b.p_after ?? 0);
        const before = b.p_before == null ? Infinity : Number(b.p_before);
        const name = (id: string) => {
          const user = [...this.users.values()].find((u) => u.id === id);
          return user ? user.fullName || user.email : '';
        };
        return this.changes
          .filter((c) => c.company === company && c.actor !== me.id)
          .filter((c) => c.id > after && c.id < before)
          .sort((x, y) => y.id - x.id)
          .slice(0, Number(b.p_limit ?? 50))
          .map((c) => ({
            id: c.id,
            at: c.at,
            actor: c.actor,
            actor_name: name(c.actor),
            subject_name: c.kind === 'member' ? name(String(c.summary.user ?? '')) : '',
            kind: c.kind,
            op: c.op,
            tbl: c.tbl,
            record_id: c.record_id,
            count: c.count,
            important: c.important,
            private: c.private,
            summary: c.summary,
            unread: c.id > read,
          }));
      }
      case 'mark_notifications_read': {
        if (!this.approver(company, me.id)) return refuse('almail:permission');
        const key = `${company} ${me.id}`;
        const newest = Math.max(
          0,
          ...this.changes.filter((c) => c.company === company).map((c) => c.id),
        );
        this.changeReads.set(
          key,
          Math.max(this.changeReads.get(key) ?? 0, Math.min(Number(b.p_upto ?? 0), newest)),
        );
        return undefined;
      }
      case 'change_notification_settings':
      case 'set_change_notifications': {
        if (!this.approver(company, me.id)) return refuse('almail:permission');
        const key = `${company} ${me.id}`;
        if (fn === 'set_change_notifications') {
          const was = this.changeSettings.get(key)?.enabled ?? false;
          this.changeSettings.set(key, {
            enabled: Boolean(b.p_enabled),
            immediateKinds: (b.p_immediate_kinds as string[]) ?? [],
            digest: String(b.p_digest ?? 'daily'),
            appUrl: String(b.p_app_url ?? ''),
          });
          if (b.p_enabled && !was) {
            const newest = Math.max(
              0,
              ...this.changes.filter((c) => c.company === company).map((c) => c.id),
            );
            this.changeReads.set(key, Math.max(this.changeReads.get(key) ?? 0, newest));
          }
        }
        return this.changeSettingsRow(company, me.id);
      }
      case 'my_permissions': {
        const access = this.access.get(`${company} ${me.id}`);
        return [
          {
            permissions: mine === 'owner' ? {} : (access?.permissions ?? {}),
            can_approve: mine === 'owner' || Boolean(access?.canApprove),
            is_owner: mine === 'owner',
            senior_roles_owner_only: ownerOnly,
          },
        ];
      }
      case 'team_permissions':
        return [...(entry?.members ?? new Map<string, Role>()).keys()]
          .filter((id) => mine === 'owner' || mine === 'admin' || id === me.id)
          .map((id) => ({
            user_id: id,
            permissions: this.access.get(`${company} ${id}`)?.permissions ?? {},
            can_approve: Boolean(this.access.get(`${company} ${id}`)?.canApprove),
          }));
      case 'set_member_permissions':
        if (mine !== 'owner') return refuse('almail:permission Only the owner can set this.');
        this.access.set(`${company} ${String(b.p_user)}`, {
          permissions: (b.p_permissions ?? {}) as { apps?: Record<string, Access> },
          canApprove: Boolean(b.p_can_approve),
        });
        return undefined;
      case 'set_team_rules':
        if (mine !== 'owner') return refuse('almail:permission Only the owner can set this.');
        if (b.p_senior_roles_owner_only) this.seniorRolesOwnerOnly.add(company);
        else this.seniorRolesOwnerOnly.delete(company);
        return undefined;
      case 'owned_companies_overview':
        return [...this.companies.values()]
          .filter((c) => c.members.get(me.id) === 'owner')
          .map((c) => ({
            company_id: c.id,
            name: c.name,
            members: c.members.size,
            pending_approvals: 0,
          }));
      case 'set_member_role': {
        const target = entry?.members.get(String(b.p_user));
        const role = b.p_role as Role;
        if (mine !== 'owner' && mine !== 'admin') return refuse('almail:permission');
        if (!target || target === 'owner') return refuse('almail:permission');
        if (mine === 'admin' && ownerOnly && (SENIOR.includes(target) || SENIOR.includes(role))) {
          return refuse(
            'almail:permission Only the owner can make or change admins and accountants.',
          );
        }
        entry!.members.set(String(b.p_user), role);
        return undefined;
      }
      case 'remove_member': {
        const target = entry?.members.get(String(b.p_user));
        if (!target) return undefined;
        if (target === 'owner') return refuse('almail:permission');
        if (String(b.p_user) !== me.id) {
          if (mine !== 'owner' && mine !== 'admin') return refuse('almail:permission');
          if (mine === 'admin' && ownerOnly && SENIOR.includes(target)) {
            return refuse('almail:permission Only the owner can remove admins and accountants.');
          }
        }
        entry!.members.delete(String(b.p_user));
        return undefined;
      }
      case 'company_team': {
        const entry = this.companies.get(company);
        return [...(entry?.members ?? new Map<string, Role>()).entries()].map(([id, role]) => {
          const user = [...this.users.values()].find((u) => u.id === id)!;
          return {
            user_id: id,
            full_name: user.fullName,
            email: user.email,
            role,
            joined_at: '2026-10-01T09:00:00Z',
          };
        });
      }
      case 'list_invites':
        return this.invites
          .filter((i) => i.company === company && !i.accepted && !i.revoked)
          .map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            token: i.token,
            created_at: '2026-10-01T09:00:00Z',
            expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
            invited_by_name: me.fullName,
          }));
      case 'create_invite': {
        if (mine === 'admin' && ownerOnly && SENIOR.includes(b.p_role as Role)) {
          return refuse('almail:permission Only the owner can invite admins and accountants.');
        }
        // Like the server: the owner's invitation of an admin or accountant is the owner's to replace.
        const email = String(b.p_email).toLowerCase();
        if (
          mine === 'admin' &&
          ownerOnly &&
          this.invites.some(
            (i) =>
              i.company === company &&
              i.email === email &&
              !i.accepted &&
              !i.revoked &&
              SENIOR.includes(i.role),
          )
        ) {
          return refuse(
            'almail:permission Only the owner can cancel invitations of admins and accountants.',
          );
        }
        // Like the server: a new link for the same address cancels the pending one.
        for (const pending of this.invites) {
          if (pending.company === company && pending.email === String(b.p_email).toLowerCase()) {
            pending.revoked = true;
          }
        }
        const invite = this.invite(
          company,
          String(b.p_email).toLowerCase(),
          b.p_role as Role,
          me.id,
        );
        invite.token = `${'cd'.repeat(31)}${String(this.invites.length).padStart(2, '0')}`;
        return [
          {
            id: invite.id,
            token: invite.token,
            email: invite.email,
            role: invite.role,
            expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
          },
        ];
      }
      case 'revoke_invite': {
        // The invitation says which company it is of.
        const invite = this.invites.find((i) => i.id === b.p_invite);
        const role = invite ? this.companies.get(invite.company)?.members.get(me.id) : undefined;
        if (!invite || (role !== 'owner' && role !== 'admin')) {
          return refuse('almail:permission Only the owner and admins can cancel invitations.');
        }
        if (
          role === 'admin' &&
          this.seniorRolesOwnerOnly.has(invite.company) &&
          SENIOR.includes(invite.role)
        ) {
          return refuse(
            'almail:permission Only the owner can cancel invitations of admins and accountants.',
          );
        }
        if (!invite.accepted) invite.revoked = true;
        return null;
      }
      case 'invite_details': {
        const invite = this.invites.find((i) => i.token === b.p_token);
        if (!invite) return [];
        const entry = this.companies.get(invite.company)!;
        const by = [...this.users.values()].find((u) => u.id === invite.invitedBy);
        return [
          {
            company_id: invite.company,
            company_name: entry.name,
            invited_by_name: by?.fullName ?? '',
            email: invite.email,
            role: invite.role,
            expires_at: new Date(Date.now() + 6 * 864e5).toISOString(),
            status: invite.revoked ? 'revoked' : invite.accepted ? 'accepted' : 'pending',
            email_matches: invite.email === me.email,
          },
        ];
      }
      case 'accept_invite': {
        const invite = this.invites.find((i) => i.token === b.p_token)!;
        invite.accepted = true;
        const entry = this.companies.get(invite.company)!;
        entry.members.set(me.id, invite.role);
        return [{ company_id: entry.id, company_name: entry.name, role: invite.role }];
      }
      case 'email_alert_settings':
      case 'set_email_alerts': {
        const key = `${company} ${me.id}`;
        if (fn === 'set_email_alerts') {
          this.emailAlerts.set(key, {
            enabled: Boolean(b.p_enabled),
            topics: (b.p_topics as string[]) ?? [],
            appUrl: String(b.p_app_url ?? ''),
          });
        }
        const saved = this.emailAlerts.get(key);
        return [
          {
            enabled: saved?.enabled ?? false,
            topics: saved?.topics ?? ['documents', 'deadlines', 'cheques', 'bills', 'invoices'],
            last_sent_at: null,
            last_error: '',
            last_error_at: null,
            function_ready: true,
          },
        ];
      }
      default:
        return undefined;
    }
  }

  /** Realtime: joins and heartbeats are answered; nothing is pushed. */
  private socket(ws: WebSocketRoute) {
    ws.onMessage((message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message));
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event, payload] = frame as [
        string | null,
        string,
        string,
        string,
        Record<string, unknown>,
      ];
      if (event === 'phx_join') {
        const config = (payload?.config ?? {}) as { postgres_changes?: Record<string, unknown>[] };
        const bindings = (config.postgres_changes ?? []).map((b, i) => ({ ...b, id: i + 1 }));
        ws.send(
          JSON.stringify([
            joinRef,
            ref,
            topic,
            'phx_reply',
            { status: 'ok', response: { postgres_changes: bindings } },
          ]),
        );
      } else if (event === 'heartbeat' || event === 'phx_leave' || event === 'access_token') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  }
}
