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

export class FakeSupabase {
  users = new Map<string, FakeUser>();
  companies = new Map<
    string,
    { id: string; name: string; members: Map<string, Role>; createdAt: string }
  >();
  records = new Map<string, Row>();
  invites: Invite[] = [];
  requests: SeenRequest[] = [];
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

    // Database functions
    const fn = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)?.[1];
    if (fn && me) {
      const result = this.rpc(fn, b, me);
      if (result === undefined) return route.fulfill({ status: 204, headers: CORS });
      return json(200, result);
    }
    return json(404, { message: 'Not found' });
  }

  private rpc(fn: string, b: Record<string, unknown>, me: FakeUser): unknown {
    const company = String(b.p_company ?? '');
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
        return changes.map((change) => {
          this.rev += 1;
          this.records.set(`${company}/${change.tbl}/${change.id}`, {
            company,
            tbl: change.tbl,
            id: change.id,
            data: change.deleted ? null : (change.data ?? null),
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
