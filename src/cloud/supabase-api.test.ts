import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseApi } from './supabase-api';

type Answer = { data: unknown; error: unknown; status: number };

/** Just enough of a Supabase client: database functions and Storage removals. */
function fakeSupabase(
  answer: (name: string) => Answer,
  removed: (paths: string[]) => string[] = (p) => p,
) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      return answer(name);
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => ({
          data: removed(paths).map((name) => ({ name })),
          error: null,
        }),
      }),
    },
  };
  return { api: supabaseApi(client as unknown as SupabaseClient), calls };
}

const MISSING: Answer = {
  data: null,
  error: {
    code: 'PGRST202',
    message: 'Could not find the function public.patch_company in the schema cache',
  },
  status: 404,
};

afterEach(() => vi.restoreAllMocks());

describe('a server without the second migration', () => {
  it('is noticed, the app falls back, and asks again only after a while', async () => {
    const { api, calls } = fakeSupabase(() => MISSING);
    expect(await api.patchCompany('co-00001', [])).toBeNull();
    expect(await api.reserveNumber('co-00001', 'invoice', '2026-10-05', 1)).toBeNull();
    expect(await api.beginDeleteCompany('co-00001')).toBe(false);
    expect(await api.storedFiles('co-00001', ['co-00001/a'])).toBeNull();
    expect(await api.patchCompany('co-00001', [])).toBeNull();
    expect(calls.filter((name) => name === 'patch_company')).toHaveLength(1);
    // Ten minutes later the owner may have run it: asked again.
    const later = Date.now() + 11 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await api.patchCompany('co-00001', []);
    expect(calls.filter((name) => name === 'patch_company')).toHaveLength(2);
  });

  it('is noticed from a stand-in that answers functions it does not know with nothing', async () => {
    const { api } = fakeSupabase(() => ({ data: null, error: null, status: 204 }));
    expect(await api.patchCompany('co-00001', [])).toBeNull();
    expect(await api.beginDeleteCompany('co-00001')).toBe(false);
  });

  it('keeps other errors as they are', async () => {
    const { api } = fakeSupabase(() => ({
      data: null,
      error: { code: '42501', message: 'almail:permission Only the owner can delete the company.' },
      status: 403,
    }));
    await expect(api.beginDeleteCompany('co-00001')).rejects.toMatchObject({ code: 'permission' });
  });

  it('reads what the newer server answers', async () => {
    const { api } = fakeSupabase((name) => {
      if (name === 'patch_company') {
        return { data: [{ rev: '41', conflicts: [['phone']] }], error: null, status: 200 };
      }
      if (name === 'reserve_number') {
        return { data: [{ counter: '7', period: '2026' }], error: null, status: 200 };
      }
      if (name === 'stored_files') return { data: ['co-00001/a'], error: null, status: 200 };
      return { data: true, error: null, status: 200 };
    });
    expect(await api.patchCompany('co-00001', [])).toEqual({ rev: 41, conflicts: [['phone']] });
    expect(await api.reserveNumber('co-00001', 'invoice', '2026-10-05', 1)).toEqual({
      counter: 7,
      period: '2026',
    });
    expect(await api.storedFiles('co-00001', ['co-00001/a', 'co-00001/b'])).toEqual(['co-00001/a']);
    expect(await api.beginDeleteCompany('co-00001')).toBe(true);
  });
});

describe('what the server has (server_features)', () => {
  it('is nothing on a server without the function, or that answers nothing', async () => {
    expect(await fakeSupabase(() => MISSING).api.serverFeatures('co-00001')).toEqual([]);
    const blank = fakeSupabase(() => ({ data: null, error: null, status: 204 }));
    expect(await blank.api.serverFeatures('co-00001')).toEqual([]);
  });

  it('is the list the server answers', async () => {
    const { api } = fakeSupabase(() => ({
      data: ['tables_v16', 7, 'later_feature'],
      error: null,
      status: 200,
    }));
    expect(await api.serverFeatures('co-00001')).toEqual(['tables_v16', 'later_feature']);
  });

  it('fails like any request when the server can’t be reached', async () => {
    const { api } = fakeSupabase(() => ({
      data: null,
      error: { message: 'TypeError: Failed to fetch' },
      status: 0,
    }));
    await expect(api.serverFeatures('co-00001')).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('the kinds of paper of the email alerts (#18)', () => {
  it('are left alone on a server without them', async () => {
    const { api } = fakeSupabase(() => MISSING);
    expect(await api.emailAlertScope('co-00001')).toBeUndefined();
    expect(await api.setEmailAlertScope('co-00001', ['staff'])).toBe(false);
  });

  it('are what the server keeps: null for every kind, unknown ones left out', async () => {
    const every = fakeSupabase(() => ({
      data: [{ document_kinds: null }],
      error: null,
      status: 200,
    }));
    expect(await every.api.emailAlertScope('co-00001')).toBeNull();
    const some = fakeSupabase(() => ({
      data: [{ document_kinds: ['staff', 'later_kind', 'vehicle'] }],
      error: null,
      status: 200,
    }));
    expect(await some.api.emailAlertScope('co-00001')).toEqual(['staff', 'vehicle']);
    const saved = fakeSupabase(() => ({ data: null, error: null, status: 204 }));
    expect(await saved.api.setEmailAlertScope('co-00001', null)).toBe(true);
    expect(saved.calls).toEqual(['set_email_alert_scope']);
  });

  it('are refused as the server refuses them', async () => {
    const { api } = fakeSupabase(() => ({
      data: null,
      error: {
        code: '42501',
        message: 'almail:permission Only the owner, admins and accountants can get email alerts.',
      },
      status: 403,
    }));
    await expect(api.setEmailAlertScope('co-00001', ['company'])).rejects.toMatchObject({
      code: 'permission',
    });
  });
});

describe('removing files', () => {
  it('answers with the paths Storage removed', async () => {
    const { api } = fakeSupabase(
      () => MISSING,
      (paths) => paths.filter((path) => path.endsWith('a')),
    );
    expect(await api.removeFiles(['co-00001/a', 'co-00001/b'])).toEqual(['co-00001/a']);
  });
});
