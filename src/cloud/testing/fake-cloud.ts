import {
  CloudError,
  type CloudApi,
  type CloudCompany,
  type CompanyOp,
  type Invite,
  type PulledRow,
  type PushChange,
  type PushResult,
  type RecordKey,
  type StoredFile,
  type TeamMember,
} from '../api';
import {
  canWriteRecord,
  isPrivateRecord,
  sameData,
  staffCompanyChangeOk,
  type MemberRole,
} from '../roles';
import { mergeNumbering } from '../numbering';
import { rebaseCompany } from '../company-patch';
import { periodKey } from '@/lib/numbering';
import type { CounterReset } from '@/db/types';

/**
 * An in-memory cloud with the database's rules (see the migration): revs,
 * hard deletes with markers, conflicts, the numbering merge, roles and
 * private data. Each `client(userId)` is one person's view of it. For tests
 * of the sync engine only.
 */

interface Row {
  company: string;
  tbl: string;
  id: string;
  data: Record<string, unknown>;
  rev: number;
}

interface Marker {
  company: string;
  tbl: string;
  id: string;
  rev: number;
  deletedAt: number;
  private: boolean;
}

const fail = (code: CloudError['code'], detail: string = code) =>
  new CloudError(code, detail, `almail:${code}`);

export class FakeCloud {
  companies = new Map<
    string,
    {
      id: string;
      name: string;
      purgedUntilRev: number;
      createdAt: string;
      /** Set by beginDeleteCompany: uploads are refused until then (ms). */
      deletingUntil?: number;
    }
  >();
  /**
   * A server without the second migration (20261006000000_sync_fixes.sql):
   * patchCompany, reserveNumber, storedFiles and beginDeleteCompany are
   * missing, and createCompany takes up the owner's existing company.
   */
  legacy = false;
  members = new Map<string, Map<string, MemberRole>>();
  records = new Map<string, Row>();
  markers = new Map<string, Marker>();
  files = new Map<string, { blob: Blob; createdAt: string; owner: string }>();
  rev = 0;
  /** Every call, as "user method". */
  calls: string[] = [];
  /** While true every call fails as if offline. */
  offline = false;
  /** Errors to throw on the next calls of a method. */
  private failures = new Map<string, CloudError[]>();
  private watchers = new Map<string, Set<() => void>>();
  /** File removals fail while true. */
  storageDown = false;

  private key(company: string, tbl: string, id: string) {
    return `${company}/${tbl}/${id}`;
  }

  /** Makes the next `count` calls of `method` fail with `code`. */
  failNext(method: keyof CloudApi, code: CloudError['code'], count = 1) {
    const list = this.failures.get(method) ?? [];
    for (let i = 0; i < count; i++) list.push(fail(code));
    this.failures.set(method, list);
  }

  addMember(company: string, user: string, role: MemberRole) {
    let members = this.members.get(company);
    if (!members) this.members.set(company, (members = new Map()));
    members.set(user, role);
  }

  /** Server-side view of a record. */
  record(company: string, tbl: string, id: string): Record<string, unknown> | undefined {
    return this.records.get(this.key(company, tbl, id))?.data;
  }

  rows(company: string, tbl?: string): Row[] {
    return [...this.records.values()].filter(
      (r) => r.company === company && (!tbl || r.tbl === tbl),
    );
  }

  /** Forgets deletion markers older than `days` (default: all), as the daily job would. */
  purgeMarkers(company: string) {
    const info = this.companies.get(company)!;
    for (const [key, marker] of this.markers) {
      if (marker.company !== company) continue;
      info.purgedUntilRev = Math.max(info.purgedUntilRev, marker.rev);
      this.markers.delete(key);
    }
  }

  private lookup(company: string) {
    return (tbl: string, id: string) => this.records.get(this.key(company, tbl, id))?.data ?? null;
  }

  private role(company: string, user: string): MemberRole | null {
    return this.members.get(company)?.get(user) ?? null;
  }

  private canRead(company: string, user: string, tbl: string, data: Record<string, unknown>) {
    const role = this.role(company, user);
    if (!role) return false;
    if (role === 'owner' || role === 'admin' || role === 'accountant') return true;
    return !isPrivateRecord(tbl, data, this.lookup(company));
  }

  private canWrite(company: string, user: string, tbl: string, data: Record<string, unknown>) {
    const role = this.role(company, user);
    if (!role) return false;
    return canWriteRecord(role, tbl, data, this.lookup(company));
  }

  /** Mirrors almailbooks.can_use_file: files follow their attachment record. */
  private canUseFile(user: string, path: string, write: boolean): boolean {
    const parts = path.split('/');
    if (parts.length !== 2) return false;
    const [company, id] = parts;
    const role = this.role(company, user);
    if (!role) return false;
    const row = this.records.get(this.key(company, 'attachments', id));
    if (row) {
      return write
        ? this.canWrite(company, user, 'attachments', row.data)
        : this.canRead(company, user, 'attachments', row.data);
    }
    if (role === 'owner' || role === 'admin' || role === 'accountant') return true;
    if (role !== 'staff') return false;
    const marker = this.markers.get(this.key(company, 'attachments', id));
    if (marker) return !marker.private;
    // Their own upload on its way (a new upload is theirs).
    const existing = this.files.get(path);
    return existing ? existing.owner === user : write;
  }

  private notify(company: string) {
    for (const watcher of this.watchers.get(company) ?? []) watcher();
  }

  client(user: string): CloudApi {
    const guard = (method: string) => {
      this.calls.push(`${user} ${method}`);
      if (this.offline) throw fail('offline');
      const queued = this.failures.get(method);
      if (queued?.length) throw queued.shift()!;
    };
    const member = (company: string) => {
      const role = this.role(company, user);
      if (!role) throw fail('not_member');
      return role;
    };

    return {
      createCompany: async (id, name) => {
        guard('createCompany');
        const existing = this.companies.get(id);
        if (existing) {
          const role = this.role(id, user);
          if (this.legacy) {
            if (role !== 'owner') throw fail('company_taken');
          } else {
            if (!role) throw fail('company_taken');
            // Only an empty one of the person's own is taken up again.
            if (role !== 'owner' || this.rows(id).length > 0) throw fail('company_exists');
          }
          existing.name = name;
          return;
        }
        this.companies.set(id, {
          id,
          name,
          purgedUntilRev: 0,
          createdAt: new Date().toISOString(),
        });
        this.addMember(id, user, 'owner');
      },

      myCompanies: async (): Promise<CloudCompany[]> => {
        guard('myCompanies');
        return [...this.companies.values()]
          .filter((c) => this.role(c.id, user))
          .map((c) => ({
            id: c.id,
            name: c.name,
            role: this.role(c.id, user)!,
            createdAt: c.createdAt,
            members: this.members.get(c.id)?.size ?? 0,
          }));
      },

      pushRecords: async (company, changes: PushChange[]): Promise<PushResult[]> => {
        guard('pushRecords');
        const role = member(company);
        // All or nothing, like one database transaction.
        const records = new Map(this.records);
        const markers = new Map(this.markers);
        const rev = this.rev;
        try {
          const results = changes.map((change) => this.applyChange(company, user, role, change));
          if (results.length) this.notify(company);
          return results;
        } catch (error) {
          this.records = records;
          this.markers = markers;
          this.rev = rev;
          throw error;
        }
      },

      pullRecords: async (company, since, limit): Promise<PulledRow[]> => {
        guard('pullRecords');
        member(company);
        const rows: PulledRow[] = [];
        for (const row of this.records.values()) {
          if (
            row.company === company &&
            row.rev > since &&
            this.canRead(company, user, row.tbl, row.data)
          ) {
            rows.push({
              tbl: row.tbl,
              id: row.id,
              data: structuredClone(row.data),
              rev: row.rev,
              deleted: false,
            });
          }
        }
        const role = this.role(company, user)!;
        for (const marker of this.markers.values()) {
          if (marker.company !== company || marker.rev <= since) continue;
          if (marker.private && !(role === 'owner' || role === 'admin' || role === 'accountant'))
            continue;
          rows.push({ tbl: marker.tbl, id: marker.id, data: null, rev: marker.rev, deleted: true });
        }
        rows.sort((a, b) => a.rev - b.rev);
        const purged = this.companies.get(company)?.purgedUntilRev ?? 0;
        if (since > 0 && since < purged) throw fail('resync');
        return rows.slice(0, limit);
      },

      recordIds: async (company, after: RecordKey | null, limit, tbl): Promise<RecordKey[]> => {
        guard('recordIds');
        member(company);
        const keys = [...this.records.values()]
          .filter((r) => r.company === company && (!tbl || r.tbl === tbl))
          .filter((r) => this.canRead(company, user, r.tbl, r.data))
          .map((r) => ({ tbl: r.tbl, id: r.id }))
          .sort((a, b) => (a.tbl === b.tbl ? (a.id < b.id ? -1 : 1) : a.tbl < b.tbl ? -1 : 1));
        const start = after
          ? keys.findIndex((k) => k.tbl > after.tbl || (k.tbl === after.tbl && k.id > after.id))
          : 0;
        return start < 0 ? [] : keys.slice(start, start + limit);
      },

      syncInfo: async (company) => {
        guard('syncInfo');
        member(company);
        const visible = [...this.records.values()].filter(
          (r) => r.company === company && this.canRead(company, user, r.tbl, r.data),
        );
        return {
          purgedUntilRev: this.companies.get(company)?.purgedUntilRev ?? 0,
          recordCount: visible.length,
          maxRev: Math.max(0, ...visible.map((r) => r.rev)),
        };
      },

      getRecord: async (company, tbl, id) => {
        guard('getRecord');
        member(company);
        const row = this.records.get(this.key(company, tbl, id));
        if (!row || !this.canRead(company, user, row.tbl, row.data)) return null;
        return { data: structuredClone(row.data), rev: row.rev };
      },

      uploadFile: async (path, data) => {
        guard('uploadFile');
        const [company] = path.split('/');
        member(company);
        if (!this.canUseFile(user, path, true)) throw fail('permission');
        // The owner is deleting the company: no new uploads.
        if ((this.companies.get(company)?.deletingUntil ?? 0) > Date.now()) {
          throw fail('permission');
        }
        this.files.set(path, { blob: data, createdAt: new Date().toISOString(), owner: user });
      },

      downloadFile: async (path) => {
        guard('downloadFile');
        const file = this.files.get(path);
        if (!file || !this.canUseFile(user, path, false)) throw fail('invalid', 'Object not found');
        return file.blob;
      },

      // Like Storage: what the rules hide is skipped without an error; the
      // answer lists what was removed.
      removeFiles: async (paths) => {
        guard('removeFiles');
        if (this.storageDown) throw fail('server');
        const removed: string[] = [];
        for (const path of paths) {
          if (
            this.files.has(path) &&
            this.canUseFile(user, path, false) &&
            this.canUseFile(user, path, true)
          ) {
            this.files.delete(path);
            removed.push(path);
          }
        }
        return removed;
      },

      listFiles: async (company): Promise<StoredFile[]> => {
        guard('listFiles');
        member(company);
        return [...this.files.entries()]
          .filter(([path]) => path.startsWith(`${company}/`) && this.canUseFile(user, path, false))
          .map(([path, file]) => ({ path, createdAt: file.createdAt }));
      },

      storedFiles: async (company, paths) => {
        guard('storedFiles');
        if (this.legacy) return null;
        member(company);
        return paths.filter((path) => path.startsWith(`${company}/`) && this.files.has(path));
      },

      // Mirrors public.patch_company.
      patchCompany: async (company, ops: CompanyOp[]) => {
        guard('patchCompany');
        if (this.legacy) return null;
        const role = member(company);
        const key = this.key(company, 'companies', company);
        const old = this.records.get(key);
        if (!old) return null;
        if (ops.some((change) => change.path[0] === 'id')) throw fail('invalid');
        if (!this.canWrite(company, user, 'companies', old.data)) throw fail('permission');
        const { data, conflicts } = rebaseCompany(old.data, ops);
        if (role === 'staff' && !staffCompanyChangeOk(old.data, data)) throw fail('permission');
        if (sameData(data, old.data)) return { rev: old.rev, conflicts };
        const rev = ++this.rev;
        this.records.set(key, { ...old, data, rev });
        this.notify(company);
        return { rev, conflicts };
      },

      // Mirrors public.reserve_number.
      reserveNumber: async (company, kind, date, min) => {
        guard('reserveNumber');
        if (this.legacy) return null;
        member(company);
        const key = this.key(company, 'companies', company);
        const row = this.records.get(key);
        if (!row) return null;
        if (!this.canWrite(company, user, 'companies', row.data)) throw fail('permission');
        const numbering = (row.data.numbering ?? {}) as Record<string, Record<string, unknown>>;
        const rule = numbering[kind];
        if (!rule) return null;
        const reset = (rule.reset ?? 'never') as CounterReset;
        const period = periodKey(reset, date);
        const rulePeriod = String(rule.period ?? '');
        let counter = typeof rule.next === 'number' ? Math.max(1, Math.trunc(rule.next)) : 1;
        if (reset !== 'never' && rulePeriod !== '' && period !== rulePeriod) {
          if (period < rulePeriod) return null;
          counter = 1;
        }
        counter = Math.max(counter, min, 1);
        const data = {
          ...row.data,
          numbering: { ...numbering, [kind]: { ...rule, next: counter + 1, period } },
        };
        const rev = ++this.rev;
        this.records.set(key, { ...row, data, rev });
        this.notify(company);
        return { counter, period };
      },

      beginDeleteCompany: async (company) => {
        guard('beginDeleteCompany');
        if (this.legacy) return false;
        if (member(company) !== 'owner') throw fail('permission');
        this.companies.get(company)!.deletingUntil = Date.now() + 60 * 60 * 1000;
        return true;
      },

      companyTeam: async (company): Promise<TeamMember[]> => {
        guard('companyTeam');
        member(company);
        return [...(this.members.get(company) ?? new Map<string, MemberRole>()).entries()].map(
          ([userId, role]) => ({
            userId,
            fullName: userId,
            email: `${userId}@example.com`,
            role,
            joinedAt: '',
          }),
        );
      },

      createInvite: async (company, email, role): Promise<Invite> => {
        guard('createInvite');
        const mine = member(company);
        if (mine !== 'owner' && mine !== 'admin') throw fail('permission');
        return {
          id: `invite-${email}`,
          email,
          role,
          token: 'f'.repeat(64),
          createdAt: '',
          expiresAt: '',
          invitedByName: user,
        };
      },
      listInvites: async () => {
        guard('listInvites');
        return [];
      },
      revokeInvite: async () => {
        guard('revokeInvite');
      },
      inviteDetails: async () => {
        guard('inviteDetails');
        return null;
      },
      acceptInvite: async () => {
        guard('acceptInvite');
        throw fail('invite_invalid');
      },
      setMemberRole: async (company, target, role) => {
        guard('setMemberRole');
        member(company);
        this.addMember(company, target, role);
      },
      removeMember: async (company, target) => {
        guard('removeMember');
        member(company);
        this.members.get(company)?.delete(target);
      },
      transferOwnership: async () => {
        guard('transferOwnership');
      },
      deleteCompany: async (company) => {
        guard('deleteCompany');
        if (member(company) !== 'owner') throw fail('permission');
        this.companies.delete(company);
        this.members.delete(company);
        for (const [key, row] of this.records)
          if (row.company === company) this.records.delete(key);
        for (const [key, marker] of this.markers)
          if (marker.company === company) this.markers.delete(key);
      },
      watch: (company, onChange) => {
        let set = this.watchers.get(company);
        if (!set) this.watchers.set(company, (set = new Set()));
        set.add(onChange);
        return () => set.delete(onChange);
      },
    };
  }

  private applyChange(
    company: string,
    user: string,
    role: MemberRole,
    change: PushChange,
  ): PushResult {
    const key = this.key(company, change.tbl, change.id);
    const old = this.records.get(key);
    const visibleOld = old && this.canRead(company, user, old.tbl, old.data) ? old : undefined;
    const marker = this.markers.get(key);
    const base = change.base_rev ?? 0;
    if (change.deleted) {
      // Never stored, or hidden from this person: nothing to do.
      if (!visibleOld)
        return { tbl: change.tbl, id: change.id, rev: marker?.rev ?? null, conflict: false };
      if (
        change.tbl === 'companies' ||
        !this.canWrite(company, user, change.tbl, visibleOld.data)
      ) {
        throw fail('permission');
      }
      this.records.delete(key);
      const rev = ++this.rev;
      this.markers.set(key, {
        company,
        tbl: change.tbl,
        id: change.id,
        rev,
        deletedAt: Date.now(),
        private: isPrivateRecord(change.tbl, visibleOld.data, this.lookup(company)),
      });
      return { tbl: change.tbl, id: change.id, rev, conflict: visibleOld.rev > base };
    }
    let data = structuredClone(change.data ?? {});
    if (JSON.stringify(data).length > 1_048_576) throw fail('too_large');
    if (
      data.id !== change.id ||
      (change.tbl === 'companies' ? change.id !== company : data.companyId !== company)
    ) {
      throw fail('invalid');
    }
    if (old && !visibleOld) throw fail('permission');
    if (old && !this.canWrite(company, user, change.tbl, old.data)) throw fail('permission');
    if (!this.canWrite(company, user, change.tbl, data)) throw fail('permission');
    if (change.tbl === 'companies' && role === 'staff') {
      if (!old || !staffCompanyChangeOk(old.data, data)) throw fail('permission');
    }
    if (change.tbl === 'companies' && old) {
      const numbering = mergeNumbering(
        old.data.numbering as Record<string, never>,
        data.numbering as Record<string, never>,
      );
      if (numbering) data = { ...data, numbering };
    }
    const rev = ++this.rev;
    this.records.set(key, { company, tbl: change.tbl, id: change.id, data, rev });
    this.markers.delete(key);
    const conflict =
      (old !== undefined && old.rev > base && !sameData(old.data, change.data)) ||
      (old === undefined && marker !== undefined && marker.rev > base);
    return { tbl: change.tbl, id: change.id, rev, conflict };
  }
}
