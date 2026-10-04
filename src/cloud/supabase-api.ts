import type { SupabaseClient } from '@supabase/supabase-js';
import { isMemberRole, type MemberRole } from './roles';
import { FILES_BUCKET } from './config';
import {
  cloudError,
  type CloudApi,
  type CloudCompany,
  type Invite,
  type InviteDetails,
  type PulledRow,
  type PushResult,
  type RecordKey,
  type StoredFile,
  type TeamMember,
} from './api';

/** The cloud as Supabase: the database's functions, Storage and Realtime. */
export function supabaseApi(supabase: SupabaseClient): CloudApi {
  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error, status } = await supabase.rpc(name, args);
    if (error)
      throw cloudError({
        ...error,
        status: status || undefined,
        name: status === 0 ? 'TypeError' : '',
      });
    return data as T;
  }
  const files = () => supabase.storage.from(FILES_BUCKET);
  const storageError = (error: { message?: string; statusCode?: string; status?: number }) =>
    cloudError({
      message: error.message,
      status: error.status,
      code: error.statusCode === '403' ? '42501' : undefined,
    });
  const role = (value: unknown): MemberRole => (isMemberRole(value) ? value : 'viewer');

  return {
    async createCompany(id, name) {
      await rpc('create_company', { p_id: id, p_name: name });
    },

    async myCompanies() {
      const rows =
        await rpc<
          { id: string; name: string; role: string; created_at: string; members: number }[]
        >('my_companies');
      return rows.map((r): CloudCompany => ({
        id: r.id,
        name: r.name,
        role: role(r.role),
        createdAt: r.created_at,
        members: Number(r.members),
      }));
    },

    async pushRecords(companyId, changes) {
      const rows = await rpc<PushResult[]>('push_records', {
        p_company: companyId,
        p_changes: changes,
      });
      return rows.map((r) => ({ ...r, rev: r.rev === null ? null : Number(r.rev) }));
    },

    async pullRecords(companyId, since, limit) {
      const rows = await rpc<PulledRow[]>('pull_records', {
        p_company: companyId,
        p_since: since,
        p_limit: limit,
      });
      return rows.map((r) => ({ ...r, rev: Number(r.rev) }));
    },

    async recordIds(companyId, after: RecordKey | null, limit, table) {
      return rpc<RecordKey[]>('company_record_ids', {
        p_company: companyId,
        p_tbl: table ?? null,
        p_after_tbl: after?.tbl ?? '',
        p_after_id: after?.id ?? '',
        p_limit: limit,
      });
    },

    async syncInfo(companyId) {
      const [row] = await rpc<
        { purged_until_rev: number; record_count: number; max_rev: number }[]
      >('company_sync_info', { p_company: companyId });
      return {
        purgedUntilRev: Number(row?.purged_until_rev ?? 0),
        recordCount: Number(row?.record_count ?? 0),
        maxRev: Number(row?.max_rev ?? 0),
      };
    },

    async getRecord(companyId, table, id) {
      const { data, error, status } = await supabase
        .from('records')
        .select('data, rev')
        .eq('company_id', companyId)
        .eq('tbl', table)
        .eq('id', id)
        .maybeSingle();
      if (error) throw cloudError({ ...error, status: status || undefined });
      if (!data) return null;
      const row = data as { data: Record<string, unknown>; rev: number };
      return { data: row.data, rev: Number(row.rev) };
    },

    async uploadFile(path, data, contentType) {
      const { error } = await files().upload(path, data, { contentType, upsert: true });
      if (error) throw storageError(error);
    },

    async downloadFile(path) {
      const { data, error } = await files().download(path);
      if (error) throw storageError(error);
      return data;
    },

    async removeFiles(paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await files().remove(paths.slice(i, i + 100));
        if (error) throw storageError(error);
      }
    },

    async listFiles(companyId) {
      const found: StoredFile[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await files().list(companyId, {
          limit: 1000,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });
        if (error) throw storageError(error);
        for (const item of data ?? []) {
          if (item.id)
            found.push({ path: `${companyId}/${item.name}`, createdAt: item.created_at });
        }
        if (!data || data.length < 1000) return found;
      }
    },

    async companyTeam(companyId) {
      const rows = await rpc<
        { user_id: string; full_name: string; email: string; role: string; joined_at: string }[]
      >('company_team', { p_company: companyId });
      return rows.map((r): TeamMember => ({
        userId: r.user_id,
        fullName: r.full_name,
        email: r.email,
        role: role(r.role),
        joinedAt: r.joined_at,
      }));
    },

    async createInvite(companyId, email, inviteRole) {
      const [row] = await rpc<
        { id: string; token: string; email: string; role: string; expires_at: string }[]
      >('create_invite', { p_company: companyId, p_email: email, p_role: inviteRole });
      return {
        id: row.id,
        token: row.token,
        email: row.email,
        role: role(row.role),
        createdAt: new Date().toISOString(),
        expiresAt: row.expires_at,
        invitedByName: '',
      };
    },

    async listInvites(companyId) {
      const rows = await rpc<
        {
          id: string;
          email: string;
          role: string;
          token: string;
          created_at: string;
          expires_at: string;
          invited_by_name: string;
        }[]
      >('list_invites', { p_company: companyId });
      return rows.map((r): Invite => ({
        id: r.id,
        email: r.email,
        role: role(r.role),
        token: r.token,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        invitedByName: r.invited_by_name,
      }));
    },

    async revokeInvite(inviteId) {
      await rpc('revoke_invite', { p_invite: inviteId });
    },

    async inviteDetails(token) {
      const [row] = await rpc<
        {
          company_id: string;
          company_name: string;
          invited_by_name: string;
          email: string;
          role: string;
          expires_at: string;
          status: InviteDetails['status'];
          email_matches: boolean;
        }[]
      >('invite_details', { p_token: token });
      if (!row) return null;
      return {
        companyId: row.company_id,
        companyName: row.company_name,
        invitedByName: row.invited_by_name,
        email: row.email,
        role: role(row.role),
        expiresAt: row.expires_at,
        status: row.status,
        emailMatches: row.email_matches,
      };
    },

    async acceptInvite(token) {
      const [row] = await rpc<{ company_id: string; company_name: string; role: string }[]>(
        'accept_invite',
        { p_token: token },
      );
      return { companyId: row.company_id, companyName: row.company_name, role: role(row.role) };
    },

    async setMemberRole(companyId, userId, newRole) {
      await rpc('set_member_role', { p_company: companyId, p_user: userId, p_role: newRole });
    },

    async removeMember(companyId, userId) {
      await rpc('remove_member', { p_company: companyId, p_user: userId });
    },

    async transferOwnership(companyId, userId) {
      await rpc('transfer_ownership', { p_company: companyId, p_user: userId });
    },

    async deleteCompany(companyId) {
      await rpc('delete_company', { p_company: companyId });
    },

    watch(companyId, onChange) {
      const channel = supabase
        .channel(`company:${companyId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'sync_signals',
            filter: `company_id=eq.${companyId}`,
          },
          () => onChange(),
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
