-- =============================================================================
-- Maham Books cloud: sync fixes
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261004000000_almailbooks_cloud.sql. It is safe to
-- run again. If that first file is ever run again, run this one again after
-- it: both define create_company and the Storage upload rules.
--
-- Until it runs, the app keeps working as before: it notices that these
-- functions are missing and falls back to what the first file offers.
--
-- What it adds
--   * patch_company: a change to the company record travels as the fields
--     that changed, merged into the cloud's current copy, so a device with an
--     older copy never puts back what others changed. Counters (numbering
--     next and period) never go back. Fields both sides changed are reported.
--   * reserve_number: the next document number of a kind, taken atomically
--     from the company's counter while the device is online.
--   * begin_delete_company: checks that the caller is the owner before the
--     app removes any file, and refuses new uploads for an hour meanwhile.
--   * stored_files: which of some files are still in Storage, so a removal
--     that removed nothing is noticed.
--   * create_company no longer takes over a company that is already in the
--     cloud with records (only an empty one, from an upload that stopped
--     before its first record, can be taken up again by its owner).
-- =============================================================================

-- Tables ------------------------------------------------------------------------

-- Set by begin_delete_company: new uploads are refused until then.
alter table public.companies add column if not exists deleting_until timestamptz;

-- Helpers (not callable through the API) ---------------------------------------

-- Sets a value at a path, making the objects on the way when they are missing.
create or replace function almailbooks.jsonb_set_path(p_target jsonb, p_path text[], p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_target jsonb := case when jsonb_typeof(p_target) = 'object' then p_target else '{}'::jsonb end;
begin
  if p_path is null or coalesce(array_length(p_path, 1), 0) = 0 then
    return coalesce(p_value, 'null'::jsonb);
  end if;
  if array_length(p_path, 1) = 1 then
    return v_target || jsonb_build_object(p_path[1], coalesce(p_value, 'null'::jsonb));
  end if;
  return v_target || jsonb_build_object(
    p_path[1],
    almailbooks.jsonb_set_path(v_target -> p_path[1], p_path[2:], p_value)
  );
end
$$;

-- Whether the company of a file in Storage is being deleted by its owner.
create or replace function almailbooks.company_deleting(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = (storage.foldername(p_name))[1]
      and c.deleting_until is not null
      and c.deleting_until > now()
  )
$$;

-- Functions the app calls ------------------------------------------------------------

-- Changes the company record by the fields a device changed. Each change is
-- {path, value} or {path, remove: true}, with base: the value the device had
-- before (left out when it had none). The changes are applied to the cloud's
-- current copy; numbering counters are merged as on every save. Returns the
-- new rev and the paths both sides changed (this device's value is kept), or
-- no row when the company record is not in the cloud yet.
create or replace function public.patch_company(p_company text, p_ops jsonb)
returns table (rev bigint, conflicts jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old jsonb;
  v_new jsonb;
  v_op jsonb;
  v_path text[];
  v_now jsonb;
  v_base jsonb;
  v_value jsonb;
  v_remove boolean;
  v_conflicts jsonb := '[]'::jsonb;
  v_numbering jsonb;
  v_rev bigint;
begin
  if auth.uid() is null then
    raise exception 'almail:auth Sign in first.' using errcode = '42501';
  end if;
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 500 then
    raise exception 'almail:invalid Changes must be a list of at most 500.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.records r
    where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company
  ) then
    return;
  end if;
  select r.data into v_old
  from public.records r
  where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company
  for update;
  if not found then
    raise exception 'almail:permission You cannot change this company.' using errcode = '42501';
  end if;

  v_new := v_old;
  for v_op in select e.value from jsonb_array_elements(p_ops) as e loop
    if jsonb_typeof(v_op) <> 'object'
      or jsonb_typeof(v_op -> 'path') <> 'array'
      or jsonb_array_length(v_op -> 'path') not between 1 and 8
      or exists (
        select 1 from jsonb_array_elements(v_op -> 'path') as p
        where jsonb_typeof(p.value) <> 'string' or char_length(p.value #>> '{}') not between 1 and 100
      ) then
      raise exception 'almail:invalid Each change needs a path.' using errcode = '22023';
    end if;
    select array_agg(p.value order by p.n) into v_path
    from jsonb_array_elements_text(v_op -> 'path') with ordinality as p(value, n);
    if v_path[1] = 'id' then
      raise exception 'almail:invalid The company id cannot change.' using errcode = '22023';
    end if;
    v_remove := coalesce(v_op ->> 'remove', 'false') = 'true';
    v_value := case when v_remove then null else nullif(v_op -> 'value', 'null'::jsonb) end;
    v_base := nullif(v_op -> 'base', 'null'::jsonb);
    v_now := nullif(v_old #> v_path, 'null'::jsonb);
    -- Changed in the cloud since the device's copy, and to something else
    -- than this change: both sides changed it. Counters merge on their own.
    if v_path[1] not in ('numbering', 'updatedAt')
      and v_now is distinct from v_base
      and v_now is distinct from v_value then
      v_conflicts := v_conflicts || jsonb_build_array(v_op -> 'path');
    end if;
    if v_remove then
      v_new := v_new #- v_path;
    else
      v_new := almailbooks.jsonb_set_path(v_new, v_path, coalesce(v_op -> 'value', 'null'::jsonb));
    end if;
  end loop;

  -- Document numbers never go back.
  v_numbering := almailbooks.merge_numbering(v_old -> 'numbering', v_new -> 'numbering');
  if v_numbering is not null then
    v_new := jsonb_set(v_new, '{numbering}', v_numbering);
  end if;

  if v_new = v_old then
    select r.rev into v_rev
    from public.records r
    where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company;
    return query select v_rev, v_conflicts;
    return;
  end if;
  update public.records r
  set data = v_new
  where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company
  returning r.rev into v_rev;
  if not found then
    raise exception 'almail:permission You cannot change this company.' using errcode = '42501';
  end if;
  perform almailbooks.touch_sync_signal(p_company, v_rev);
  return query select v_rev, v_conflicts;
end
$$;

-- Takes the next number of a kind of document (invoice, quote…) from the
-- company's counter, for a document dated p_date. p_min is the counter the
-- device would use itself (it skips numbers already used there); the counter
-- given is never below it. The counter moves on in the company record, merged
-- like any other numbering change. No row: the device numbers the document
-- itself (no rule for this kind yet, or a date in a period before the one the
-- counter is in).
create or replace function public.reserve_number(
  p_company text,
  p_kind text,
  p_date text,
  p_min bigint default 1
)
returns table (counter bigint, period text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_data jsonb;
  v_rule jsonb;
  v_reset text;
  v_period text;
  v_rule_period text;
  v_next bigint;
  v_counter bigint;
  v_rev bigint;
begin
  if auth.uid() is null then
    raise exception 'almail:auth Sign in first.' using errcode = '42501';
  end if;
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind !~ '^[a-z_]{1,40}$'
    or p_date is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'almail:invalid Give a kind of document and a date.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.records r
    where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company
  ) then
    return;
  end if;
  select r.data into v_data
  from public.records r
  where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company
  for update;
  if not found then
    raise exception 'almail:permission You cannot number documents here.' using errcode = '42501';
  end if;
  v_rule := v_data -> 'numbering' -> p_kind;
  if v_rule is null or jsonb_typeof(v_rule) <> 'object' then
    return;
  end if;
  v_reset := coalesce(v_rule ->> 'reset', 'never');
  v_period := case v_reset
    when 'yearly' then left(p_date, 4)
    when 'monthly' then left(p_date, 7)
    else ''
  end;
  v_rule_period := coalesce(v_rule ->> 'period', '');
  v_next := case
    when jsonb_typeof(v_rule -> 'next') = 'number' then greatest(1, trunc((v_rule ->> 'next')::numeric))::bigint
    else 1
  end;
  if v_reset <> 'never' and v_rule_period <> '' and v_period <> v_rule_period then
    if v_period collate "C" < v_rule_period collate "C" then
      -- An earlier period: the counter only follows the latest one.
      return;
    end if;
    v_counter := 1;
  else
    v_counter := v_next;
  end if;
  v_counter := greatest(v_counter, coalesce(p_min, 1), 1);
  v_rule := v_rule || jsonb_build_object('next', v_counter + 1, 'period', v_period);
  update public.records r
  set data = jsonb_set(r.data, array['numbering', p_kind], v_rule)
  where r.company_id = p_company and r.tbl = 'companies' and r.id = p_company
  returning r.rev into v_rev;
  if not found then
    raise exception 'almail:permission You cannot number documents here.' using errcode = '42501';
  end if;
  perform almailbooks.touch_sync_signal(p_company, v_rev);
  return query select v_counter, v_period;
end
$$;

-- The owner starts deleting a company: refused for anyone else, before any
-- file is removed. New uploads are refused for an hour (the app removes the
-- files, then calls delete_company).
create or replace function public.begin_delete_company(p_company text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if almailbooks.member_role(p_company) is distinct from 'owner' then
    raise exception 'almail:permission Only the owner can delete the company.' using errcode = '42501';
  end if;
  update public.companies c
  set deleting_until = now() + interval '1 hour'
  where c.id = p_company;
  return true;
end
$$;

-- Which of these files of a company are still in Storage, whoever may see
-- them (members only). A removal that removed nothing is noticed this way.
create or replace function public.stored_files(p_company text, p_names text[])
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  return query
    select o.name
    from storage.objects o
    where o.bucket_id = 'company-files'
      and o.name = any (coalesce(p_names, '{}'::text[]))
      and left(o.name, char_length(p_company) + 1) = p_company || '/';
end
$$;

-- Creates a company in the cloud with the caller as its owner. A company that
-- is already in the cloud is refused: its members download it instead, so an
-- older copy can't replace the team's data. Only an empty one (an upload that
-- stopped before its first record) is taken up again by its owner.
create or replace function public.create_company(p_id text, p_name text)
returns table (id text, name text, role public.member_role)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_owner uuid;
begin
  if v_uid is null then
    raise exception 'almail:auth Sign in first.' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'almail:invalid The company id is not valid.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'almail:invalid Enter the company name.' using errcode = '22023';
  end if;
  perform 1 from public.companies c where c.id = p_id for update;
  if found then
    if not exists (
      select 1 from public.company_members m where m.company_id = p_id and m.user_id = v_uid
    ) then
      raise exception 'almail:company_taken This company belongs to another account.'
        using errcode = '42501';
    end if;
    select m.user_id into v_owner
    from public.company_members m
    where m.company_id = p_id and m.role = 'owner';
    if v_owner is distinct from v_uid
      or exists (select 1 from public.records r where r.company_id = p_id) then
      raise exception 'almail:company_exists This company is already in your cloud account. Download it instead.'
        using errcode = '23505';
    end if;
    update public.companies c set name = v_name where c.id = p_id;
  else
    if (
      select count(*) from public.company_members m where m.user_id = v_uid and m.role = 'owner'
    ) >= 50 then
      raise exception 'almail:limit An account can own up to 50 companies.' using errcode = '54000';
    end if;
    insert into public.companies (id, name, created_by) values (p_id, v_name, v_uid);
    insert into public.company_members (company_id, user_id, role) values (p_id, v_uid, 'owner');
    insert into public.sync_signals (company_id, rev) values (p_id, 0) on conflict do nothing;
  end if;
  return query select p_id, v_name, 'owner'::public.member_role;
end
$$;

-- Storage: no new uploads while the owner deletes the company -------------------------

drop policy if exists "AlmailBooks files: upload" on storage.objects;
create policy "AlmailBooks files: upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-files'
    and almailbooks.can_use_file(name, owner_id, true)
    and not almailbooks.company_deleting(name)
  );
drop policy if exists "AlmailBooks files: replace" on storage.objects;
create policy "AlmailBooks files: replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-files' and almailbooks.can_use_file(name, owner_id, true))
  with check (
    bucket_id = 'company-files'
    and almailbooks.can_use_file(name, owner_id, true)
    and not almailbooks.company_deleting(name)
  );

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.jsonb_set_path(jsonb, text[], jsonb),
  almailbooks.company_deleting(text)
from public, anon;
grant execute on function
  almailbooks.jsonb_set_path(jsonb, text[], jsonb),
  almailbooks.company_deleting(text)
to authenticated;

revoke all on function
  public.patch_company(text, jsonb),
  public.reserve_number(text, text, text, bigint),
  public.begin_delete_company(text),
  public.stored_files(text, text[]),
  public.create_company(text, text)
from public, anon;
grant execute on function
  public.patch_company(text, jsonb),
  public.reserve_number(text, text, text, bigint),
  public.begin_delete_company(text),
  public.stored_files(text, text[]),
  public.create_company(text, text)
to authenticated;

-- The Data API learns about the new functions at once.
notify pgrst, 'reload schema';
