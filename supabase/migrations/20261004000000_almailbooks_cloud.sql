-- =============================================================================
-- AlmailBooks cloud: accounts, teams and sync
-- =============================================================================
--
-- Paste this whole file into the Supabase SQL editor and press Run. It is safe
-- to run again: every statement creates what is missing or replaces it with
-- the same definition.
--
-- What it sets up
--   * public.profiles         one row per account (name, language, email)
--   * public.companies        the companies kept in the cloud
--   * public.company_members  who belongs to which company, with a role
--   * public.company_invites  invitation links (single use, 7 days)
--   * public.records          every record of every company, as JSON
--   * public.deleted_records  short-lived markers of deleted records (no data)
--   * public.sync_signals     one row per company, bumped on every change
--                             (the only table published to Realtime)
--   * storage bucket company-files: receipts and scans, {companyId}/{fileId}
--
-- Security model
--   * Row-level security is on for every table. The app only ever uses the
--     publishable key; every request runs as the signed-in user.
--   * Helper functions that policies call live in the "almailbooks" schema,
--     which the Data API does not expose, so they cannot be called directly.
--   * Roles: owner, admin, accountant, staff, viewer (see supabase/README.md).
--   * Payroll and people data (employees, pay runs, leave, loans, settlements,
--     their documents and files, payroll journals and activity about them) are
--     invisible to staff and viewers, enforced here and not in the app.
--   * Deletes are real deletes. Other devices learn about them from a marker
--     in public.deleted_records that holds no data and is purged after 30
--     days; devices that were away longer do a full resync.
-- =============================================================================

create schema if not exists almailbooks;
revoke all on schema almailbooks from public;
grant usage on schema almailbooks to authenticated;

-- Member roles ----------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'member_role'
  ) then
    create type public.member_role as enum ('owner', 'admin', 'accountant', 'staff', 'viewer');
  end if;
end
$$;

-- Tables ----------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  language text not null default 'ar',
  email text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles drop constraint if exists profiles_full_name_length;
alter table public.profiles
  add constraint profiles_full_name_length check (char_length(full_name) <= 200);
alter table public.profiles drop constraint if exists profiles_language_check;
alter table public.profiles add constraint profiles_language_check check (language in ('ar', 'en'));

create table if not exists public.companies (
  id text primary key,
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Highest rev of the deletion markers purged so far (see pull_records).
  purged_until_rev bigint not null default 0
);
alter table public.companies drop constraint if exists companies_id_format;
alter table public.companies
  add constraint companies_id_format check (id ~ '^[A-Za-z0-9_-]{8,64}$');
alter table public.companies drop constraint if exists companies_name_length;
alter table public.companies
  add constraint companies_name_length check (char_length(name) between 1 and 200);

create table if not exists public.company_members (
  company_id text not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
-- Exactly one owner per company: at most one here, and no function removes or
-- demotes the owner (ownership moves with transfer_ownership).
create unique index if not exists company_members_one_owner
  on public.company_members (company_id) where role = 'owner';
create index if not exists company_members_user on public.company_members (user_id);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies (id) on delete cascade,
  email text not null,
  role public.member_role not null,
  token text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
alter table public.company_invites drop constraint if exists company_invites_email_check;
alter table public.company_invites
  add constraint company_invites_email_check
  check (email = lower(email) and char_length(email) between 3 and 320 and position('@' in email) > 1);
alter table public.company_invites drop constraint if exists company_invites_role_check;
alter table public.company_invites add constraint company_invites_role_check check (role <> 'owner');
alter table public.company_invites drop constraint if exists company_invites_token_check;
alter table public.company_invites
  add constraint company_invites_token_check check (char_length(token) >= 48);
create index if not exists company_invites_company on public.company_invites (company_id);

-- One sequence for every change of every company: records and deletion markers.
create sequence if not exists public.records_rev_seq;

create table if not exists public.records (
  company_id text not null references public.companies (id) on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb not null,
  rev bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (company_id, tbl, id)
);
-- Deletes are real deletes; an earlier draft had a tombstone column.
alter table public.records drop column if exists deleted;
alter table public.records drop constraint if exists records_tbl_check;
alter table public.records
  add constraint records_tbl_check check (tbl in (
    'companies', 'clients', 'products', 'taxRates', 'documents', 'payments', 'recurring',
    'activities', 'accounts', 'journals', 'expenses', 'attachments', 'vatReturns',
    'bankTransactions', 'employees', 'complianceDocuments', 'renewals', 'complianceMarks',
    'peopleSettings', 'securityCheques', 'assets', 'depreciationRuns', 'yearEnds', 'payRuns',
    'payrollSettings', 'leaveRecords', 'staffLoans', 'finalSettlements', 'warehouses',
    'stockMovements', 'stockEntries', 'landedCosts'
  ));
alter table public.records drop constraint if exists records_id_check;
alter table public.records
  add constraint records_id_check check (char_length(id) between 1 and 128);
alter table public.records drop constraint if exists records_data_check;
alter table public.records
  add constraint records_data_check check (jsonb_typeof(data) = 'object');
create index if not exists records_company_rev on public.records (company_id, rev);

-- A deleted record leaves only this: which record, when, and its place in the
-- change order. Kept 30 days so other devices can delete their copy.
create table if not exists public.deleted_records (
  company_id text not null references public.companies (id) on delete cascade,
  tbl text not null,
  id text not null,
  rev bigint not null,
  deleted_at timestamptz not null default now(),
  -- The record was payroll or people data: hidden from staff and viewers.
  private boolean not null default false,
  primary key (company_id, tbl, id)
);
create index if not exists deleted_records_company_rev on public.deleted_records (company_id, rev);
create index if not exists deleted_records_company_deleted_at
  on public.deleted_records (company_id, deleted_at);

-- Realtime carries this row, not the records: members are told that something
-- changed and pull it with their own permissions.
create table if not exists public.sync_signals (
  company_id text primary key references public.companies (id) on delete cascade,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Helpers (not callable through the API) ---------------------------------------

-- The caller's role in a company, or null when not a member.
create or replace function almailbooks.member_role(p_company text)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.company_members m
  where m.company_id = p_company and m.user_id = auth.uid()
$$;

-- Payroll and people data, seen only by owners, admins and accountants.
create or replace function almailbooks.record_is_private(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tbl in (
    'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
    'finalSettlements'
  ) then
    return true;
  end if;
  if p_data is null then
    return false;
  end if;
  -- The app marks files and activity about employees; the checks below hold
  -- even when it does not.
  if p_data ->> '_private' = 'true' then
    return true;
  end if;
  case p_tbl
    when 'complianceDocuments', 'renewals' then
      return coalesce(p_data ->> 'employeeId', '') <> '';
    when 'journals' then
      -- Payroll entries show salaries.
      return coalesce(p_data ->> 'kind', '') = 'payroll';
    when 'activities' then
      if coalesce(p_data ->> 'entity', '') in ('employee', 'payroll') then
        return true;
      end if;
      if p_data ->> 'entity' = 'compliance' then
        return exists (
          select 1
          from public.records o
          where o.company_id = p_company
            and o.tbl in ('complianceDocuments', 'renewals')
            and o.id = p_data ->> 'entityId'
            and coalesce(o.data ->> 'employeeId', '') <> ''
        );
      end if;
      return false;
    when 'attachments' then
      -- Scans in a personnel file, or of an employee's documents.
      return exists (
        select 1
        from public.records o
        where o.company_id = p_company
          and o.id = p_data ->> 'ownerId'
          and (
            o.tbl = 'employees'
            or (
              o.tbl in ('complianceDocuments', 'renewals')
              and coalesce(o.data ->> 'employeeId', '') <> ''
            )
          )
      );
    else
      return false;
  end case;
end
$$;

-- Tables staff may change: sales, purchases, cheques, inventory, files,
-- activity, the company's document numbers (see records_before_write) and
-- the journals those make.
create or replace function almailbooks.staff_can_write(p_tbl text, p_data jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tbl in (
      'companies', 'clients', 'products', 'documents', 'payments', 'recurring',
      'securityCheques', 'expenses', 'warehouses', 'stockMovements', 'stockEntries',
      'landedCosts', 'attachments', 'activities'
    )
    or (
      p_tbl = 'journals'
      and coalesce(p_data ->> 'kind', '') in (
        'transfer', 'cheque_clearing', 'cheque_return', 'retention_release'
      )
    )
$$;

create or replace function almailbooks.can_read_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.member_role := almailbooks.member_role(p_company);
begin
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin', 'accountant') then
    return true;
  end if;
  return not almailbooks.record_is_private(p_company, p_tbl, p_data);
end
$$;

create or replace function almailbooks.can_write_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.member_role := almailbooks.member_role(p_company);
begin
  if v_role in ('owner', 'admin', 'accountant') then
    return true;
  end if;
  if v_role = 'staff' then
    return almailbooks.staff_can_write(p_tbl, p_data)
      and not almailbooks.record_is_private(p_company, p_tbl, p_data);
  end if;
  return false;
end
$$;

-- The company's own record is never deleted through sync: delete_company does that.
create or replace function almailbooks.can_delete_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tbl <> 'companies' and almailbooks.can_write_record(p_company, p_tbl, p_data)
$$;

create or replace function almailbooks.can_read_marker(p_company text, p_private boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.member_role := almailbooks.member_role(p_company);
begin
  return v_role is not null and (not p_private or v_role in ('owner', 'admin', 'accountant'));
end
$$;

-- Files live at {companyId}/{attachmentId} and follow their attachment record.
-- p_owner is the object's uploader (storage.objects.owner_id, set by Storage
-- from the signed-in account). A file whose record is not there (not synced
-- yet, or deleted) is open to the roles that see every file; staff only reach
-- their own upload on its way (Storage reads the row back when it saves it),
-- or the file of a deleted attachment they could see, to remove it.
create or replace function almailbooks.can_use_file(p_name text, p_owner text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folders text[] := storage.foldername(p_name);
  v_company text;
  v_id text;
  v_role public.member_role;
  v_data jsonb;
  v_private boolean;
begin
  if coalesce(array_length(v_folders, 1), 0) <> 1 then
    return false;
  end if;
  v_company := v_folders[1];
  v_id := storage.filename(p_name);
  v_role := almailbooks.member_role(v_company);
  if v_role is null then
    return false;
  end if;
  select r.data into v_data
  from public.records r
  where r.company_id = v_company and r.tbl = 'attachments' and r.id = v_id;
  if found then
    if p_write then
      return almailbooks.can_write_record(v_company, 'attachments', v_data);
    end if;
    return almailbooks.can_read_record(v_company, 'attachments', v_data);
  end if;
  if v_role in ('owner', 'admin', 'accountant') then
    return true;
  end if;
  if v_role <> 'staff' then
    return false;
  end if;
  select m.private into v_private
  from public.deleted_records m
  where m.company_id = v_company and m.tbl = 'attachments' and m.id = v_id;
  if found then
    return not v_private;
  end if;
  return p_owner is not null and p_owner = (select auth.uid())::text;
end
$$;

-- Document numbers never go back: for each kind of document the counter of the
-- later period wins, and in the same period the higher counter. The pattern,
-- padding and reset are kept as sent (a change of reset takes the rule as sent).
create or replace function almailbooks.merge_numbering_rule(p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_old_period text;
  v_new_period text;
  v_old_next numeric;
  v_new_next numeric;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'object' then
    return p_old;
  end if;
  if p_old is null or jsonb_typeof(p_old) <> 'object' then
    return p_new;
  end if;
  if coalesce(p_old ->> 'reset', '') <> coalesce(p_new ->> 'reset', '') then
    return p_new;
  end if;
  v_old_period := coalesce(p_old ->> 'period', '');
  v_new_period := coalesce(p_new ->> 'period', '');
  v_old_next := case when jsonb_typeof(p_old -> 'next') = 'number' then (p_old ->> 'next')::numeric else 0 end;
  v_new_next := case when jsonb_typeof(p_new -> 'next') = 'number' then (p_new ->> 'next')::numeric else 0 end;
  if v_new_period collate "C" > v_old_period collate "C" then
    return p_new;
  end if;
  if v_old_period collate "C" > v_new_period collate "C" then
    return p_new || jsonb_build_object('period', to_jsonb(v_old_period), 'next', p_old -> 'next');
  end if;
  if v_old_next > v_new_next then
    return p_new || jsonb_build_object('next', p_old -> 'next');
  end if;
  return p_new;
end
$$;

create or replace function almailbooks.merge_numbering(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_new is null or jsonb_typeof(p_new) <> 'object' then p_old
    when p_old is null or jsonb_typeof(p_old) <> 'object' then p_new
    else (
      select coalesce(
        jsonb_object_agg(k.key, almailbooks.merge_numbering_rule(p_old -> k.key, p_new -> k.key)),
        '{}'::jsonb
      )
      from (
        select jsonb_object_keys(p_old) as key
        union
        select jsonb_object_keys(p_new)
      ) as k
    )
  end
$$;

-- Whether two numbering settings differ only in their counters (next and
-- period). Kinds of document missing on one side may be added by the other.
create or replace function almailbooks.counters_only(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_old is null or jsonb_typeof(p_old) <> 'object'
      or p_new is null or jsonb_typeof(p_new) <> 'object' then p_old is not distinct from p_new
    else not exists (
      select 1
      from jsonb_object_keys(p_old) as k(key)
      where p_new ? k.key
        and (p_old -> k.key) - 'next' - 'period' is distinct from (p_new -> k.key) - 'next' - 'period'
    )
  end
$$;

-- Serialises the writes of one company until commit, so revs reach readers in
-- order and a pull never skips a change that commits late.
create or replace function almailbooks.lock_company(p_company text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('almailbooks:' || p_company, 0))
$$;

-- Removes deletion markers older than 30 days and remembers how far it got.
create or replace function almailbooks.purge_deleted_records(p_company text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev bigint;
begin
  with gone as (
    delete from public.deleted_records m
    where m.company_id = p_company and m.deleted_at < now() - interval '30 days'
    returning m.rev
  )
  select max(gone.rev) into v_rev from gone;
  if v_rev is not null then
    update public.companies c
    set purged_until_rev = greatest(c.purged_until_rev, v_rev)
    where c.id = p_company;
  end if;
end
$$;

create or replace function almailbooks.purge_all_deleted_records()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
begin
  for v_company in
    select distinct m.company_id
    from public.deleted_records m
    where m.deleted_at < now() - interval '30 days'
  loop
    perform almailbooks.purge_deleted_records(v_company);
  end loop;
end
$$;

create or replace function almailbooks.touch_sync_signal(p_company text, p_rev bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_signals as s (company_id, rev, updated_at)
  values (p_company, coalesce(p_rev, 0), now())
  on conflict (company_id) do update
    set rev = greatest(s.rev, excluded.rev), updated_at = now()
$$;

-- Triggers ----------------------------------------------------------------------

-- Every write gets the next rev, the time and the author from the server;
-- whatever the app sent for them is ignored.
create or replace function almailbooks.records_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
  v_numbering jsonb;
begin
  if tg_op = 'UPDATE'
    and (new.company_id <> old.company_id or new.tbl <> old.tbl or new.id <> old.id) then
    raise exception 'almail:invalid A record cannot move.' using errcode = '22023';
  end if;
  if jsonb_typeof(new.data) is distinct from 'object' then
    raise exception 'almail:invalid A record must be a JSON object.' using errcode = '22023';
  end if;
  -- About 1 MB per record; the company's own record also carries its logo,
  -- stamp and signature.
  if octet_length(new.data::text) > (case when new.tbl = 'companies' then 3145728 else 1048576 end) then
    raise exception 'almail:too_large This record is too large to sync.' using errcode = '54000';
  end if;
  if new.tbl = 'companies' then
    if new.id <> new.company_id or coalesce(new.data ->> 'id', '') <> new.company_id then
      raise exception 'almail:invalid The company record does not match its company.'
        using errcode = '22023';
    end if;
  elsif coalesce(new.data ->> 'id', '') <> new.id
    or coalesce(new.data ->> 'companyId', '') <> new.company_id then
    raise exception 'almail:invalid The record does not match its company.' using errcode = '22023';
  end if;

  if new.tbl = 'companies' then
    v_role := almailbooks.member_role(new.company_id);
    if v_role = 'staff' then
      -- An upsert runs this as an insert before it turns into an update: only
      -- a company record that does not exist yet is a real insert.
      if tg_op = 'INSERT' and not exists (
        select 1
        from public.records r
        where r.company_id = new.company_id and r.tbl = 'companies' and r.id = new.id
      ) then
        raise exception 'almail:permission Staff cannot create the company record.'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and (
        (old.data - 'numbering' - 'updatedAt') is distinct from (new.data - 'numbering' - 'updatedAt')
        or not almailbooks.counters_only(old.data -> 'numbering', new.data -> 'numbering')
      ) then
        raise exception 'almail:permission Staff can only change document numbers.'
          using errcode = '42501';
      end if;
    end if;
    if tg_op = 'UPDATE' then
      v_numbering := almailbooks.merge_numbering(old.data -> 'numbering', new.data -> 'numbering');
      if v_numbering is not null then
        new.data := jsonb_set(new.data, '{numbering}', v_numbering);
      end if;
    end if;
  end if;

  perform almailbooks.lock_company(new.company_id);
  new.rev := nextval('public.records_rev_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write
  before insert or update on public.records
  for each row execute function almailbooks.records_before_write();

-- A deleted record leaves a marker so other devices delete their copy.
create or replace function almailbooks.records_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The whole company is going: nothing to tell anyone.
  if current_setting('almailbooks.deleting_company', true) = old.company_id then
    return old;
  end if;
  perform almailbooks.lock_company(old.company_id);
  insert into public.deleted_records as m (company_id, tbl, id, rev, deleted_at, private)
  values (
    old.company_id,
    old.tbl,
    old.id,
    nextval('public.records_rev_seq'),
    now(),
    almailbooks.record_is_private(old.company_id, old.tbl, old.data)
  )
  on conflict (company_id, tbl, id) do update
    set rev = excluded.rev, deleted_at = excluded.deleted_at, private = excluded.private;
  return old;
end
$$;

drop trigger if exists records_after_delete on public.records;
create trigger records_after_delete
  after delete on public.records
  for each row execute function almailbooks.records_after_delete();

-- A record that comes back (changed on a device that had not seen the delete)
-- is no longer deleted.
create or replace function almailbooks.records_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.deleted_records m
  where m.company_id = new.company_id and m.tbl = new.tbl and m.id = new.id;
  return new;
end
$$;

drop trigger if exists records_after_insert on public.records;
create trigger records_after_insert
  after insert on public.records
  for each row execute function almailbooks.records_after_insert();

-- New accounts get a profile from what they gave when signing up.
create or replace function almailbooks.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, language, email)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200),
    case when new.raw_user_meta_data ->> 'language' = 'en' then 'en' else 'ar' end,
    lower(coalesce(new.email, ''))
  )
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function almailbooks.handle_new_user();

create or replace function almailbooks.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set email = lower(coalesce(new.email, '')) where p.id = new.id;
  return new;
end
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function almailbooks.handle_user_email_change();

-- Accounts that existed before this script ran.
insert into public.profiles (id, full_name, language, email)
select
  u.id,
  left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 200),
  case when u.raw_user_meta_data ->> 'language' = 'en' then 'en' else 'ar' end,
  lower(coalesce(u.email, ''))
from auth.users u
on conflict (id) do nothing;

-- When an owner's account is deleted, the longest-standing admin (or else
-- accountant) becomes the owner, so the company is never left without one.
create or replace function almailbooks.company_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  if old.role <> 'owner'
    or current_setting('almailbooks.deleting_company', true) = old.company_id
    or not exists (select 1 from public.companies c where c.id = old.company_id) then
    return old;
  end if;
  select m.user_id into v_next
  from public.company_members m
  where m.company_id = old.company_id and m.role in ('admin', 'accountant')
  order by m.role, m.created_at
  limit 1;
  if v_next is not null then
    update public.company_members m
    set role = 'owner'
    where m.company_id = old.company_id and m.user_id = v_next;
  end if;
  return old;
end
$$;

drop trigger if exists company_members_after_delete on public.company_members;
create trigger company_members_after_delete
  after delete on public.company_members
  for each row execute function almailbooks.company_members_after_delete();

-- Row-level security ----------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.records enable row level security;
alter table public.deleted_records enable row level security;
alter table public.sync_signals enable row level security;

drop policy if exists "Own profile: read" on public.profiles;
create policy "Own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Own profile: update" on public.profiles;
create policy "Own profile: update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Members: read company" on public.companies;
create policy "Members: read company" on public.companies
  for select to authenticated using (almailbooks.member_role(id) is not null);

drop policy if exists "Members: read members" on public.company_members;
create policy "Members: read members" on public.company_members
  for select to authenticated using (almailbooks.member_role(company_id) is not null);

drop policy if exists "Owners and admins: read invites" on public.company_invites;
create policy "Owners and admins: read invites" on public.company_invites
  for select to authenticated
  using (almailbooks.member_role(company_id) in ('owner', 'admin'));

drop policy if exists "Members: read records" on public.records;
create policy "Members: read records" on public.records
  for select to authenticated using (almailbooks.can_read_record(company_id, tbl, data));
drop policy if exists "Members: add records" on public.records;
create policy "Members: add records" on public.records
  for insert to authenticated with check (almailbooks.can_write_record(company_id, tbl, data));
drop policy if exists "Members: change records" on public.records;
create policy "Members: change records" on public.records
  for update to authenticated
  using (almailbooks.can_write_record(company_id, tbl, data))
  with check (almailbooks.can_write_record(company_id, tbl, data));
drop policy if exists "Members: delete records" on public.records;
create policy "Members: delete records" on public.records
  for delete to authenticated using (almailbooks.can_delete_record(company_id, tbl, data));

drop policy if exists "Members: read deletions" on public.deleted_records;
create policy "Members: read deletions" on public.deleted_records
  for select to authenticated using (almailbooks.can_read_marker(company_id, private));

drop policy if exists "Members: read signals" on public.sync_signals;
create policy "Members: read signals" on public.sync_signals
  for select to authenticated using (almailbooks.member_role(company_id) is not null);

-- Privileges: nothing for anonymous visitors; members go through the policies
-- above and the functions below.
revoke all on public.profiles, public.companies, public.company_members, public.company_invites,
  public.records, public.deleted_records, public.sync_signals from anon, public;
revoke all on public.profiles, public.companies, public.company_members, public.company_invites,
  public.records, public.deleted_records, public.sync_signals from authenticated;
revoke all on sequence public.records_rev_seq from anon, public, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, language) on public.profiles to authenticated;
grant select on public.companies, public.company_members, public.company_invites,
  public.deleted_records, public.sync_signals to authenticated;
grant select, insert, update, delete on public.records to authenticated;

-- Functions the app calls ------------------------------------------------------------

-- Creates a company in the cloud with the caller as its owner. Running it
-- again for the caller's own company only updates the name.
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
    select m.user_id into v_owner
    from public.company_members m
    where m.company_id = p_id and m.role = 'owner';
    if v_owner is distinct from v_uid then
      raise exception 'almail:company_taken This company belongs to another account.'
        using errcode = '42501';
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

-- Saves a batch of changes at once, as the caller (row-level security
-- applies). Each change: {tbl, id, data} or {tbl, id, deleted: true}, with the
-- rev the device last saw as base_rev. The push always wins; conflict says the
-- server had a newer version that this one replaced (or a newer delete).
create or replace function public.push_records(p_company text, p_changes jsonb)
returns table (tbl text, id text, rev bigint, conflict boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_change jsonb;
  v_tbl text;
  v_id text;
  v_data jsonb;
  v_delete boolean;
  v_base bigint;
  v_old_rev bigint;
  v_old_data jsonb;
  v_marker_rev bigint;
  v_rev bigint;
  v_max bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'almail:auth Sign in first.' using errcode = '42501';
  end if;
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'almail:invalid Changes must be a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 500 then
    raise exception 'almail:invalid Send at most 500 changes at once.' using errcode = '22023';
  end if;
  perform almailbooks.purge_deleted_records(p_company);

  for v_change in select e.value from jsonb_array_elements(p_changes) as e loop
    v_tbl := v_change ->> 'tbl';
    v_id := v_change ->> 'id';
    v_delete := coalesce(v_change ->> 'deleted', 'false') = 'true';
    v_base := case
      when jsonb_typeof(v_change -> 'base_rev') = 'number' then (v_change ->> 'base_rev')::bigint
    end;
    if coalesce(v_tbl, '') = '' or coalesce(v_id, '') = '' then
      raise exception 'almail:invalid Each change needs tbl and id.' using errcode = '22023';
    end if;

    v_old_rev := null;
    v_old_data := null;
    v_marker_rev := null;
    select r.rev, r.data into v_old_rev, v_old_data
    from public.records r
    where r.company_id = p_company and r.tbl = v_tbl and r.id = v_id;
    select m.rev into v_marker_rev
    from public.deleted_records m
    where m.company_id = p_company and m.tbl = v_tbl and m.id = v_id;

    if v_delete then
      delete from public.records r
      where r.company_id = p_company and r.tbl = v_tbl and r.id = v_id;
      if found then
        select m.rev into v_rev
        from public.deleted_records m
        where m.company_id = p_company and m.tbl = v_tbl and m.id = v_id;
        conflict := v_old_rev > coalesce(v_base, 0);
      else
        if v_old_rev is not null then
          raise exception 'almail:permission You cannot delete this record.' using errcode = '42501';
        end if;
        -- Never stored, or already deleted: nothing to do.
        v_rev := v_marker_rev;
        conflict := false;
      end if;
    else
      v_data := v_change -> 'data';
      insert into public.records as r (company_id, tbl, id, data)
      values (p_company, v_tbl, v_id, v_data)
      on conflict (company_id, tbl, id) do update set data = excluded.data
      returning r.rev into v_rev;
      conflict := (
          v_old_rev is not null
          and v_old_rev > coalesce(v_base, 0)
          and v_old_data is distinct from v_data
        )
        or (v_old_rev is null and v_marker_rev is not null and v_marker_rev > coalesce(v_base, 0));
    end if;

    tbl := v_tbl;
    id := v_id;
    rev := v_rev;
    v_max := greatest(v_max, coalesce(v_rev, 0));
    return next;
  end loop;

  if v_max > 0 then
    perform almailbooks.touch_sync_signal(p_company, v_max);
  end if;
end
$$;

-- Changes after a rev, oldest first: records the caller may read and markers
-- of deleted ones. When markers newer than p_since have already been purged
-- the device must resync (almail:resync); a pull from 0 never needs to.
create or replace function public.pull_records(p_company text, p_since bigint, p_limit integer default 500)
returns table (tbl text, id text, data jsonb, rev bigint, deleted boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_purged bigint;
begin
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  perform almailbooks.purge_deleted_records(p_company);
  return query
    select x.tbl, x.id, x.data, x.rev, x.deleted
    from (
      select r.tbl, r.id, r.data, r.rev, false as deleted
      from public.records r
      where r.company_id = p_company and r.rev > v_since
      union all
      select m.tbl, m.id, null::jsonb, m.rev, true
      from public.deleted_records m
      where m.company_id = p_company and m.rev > v_since
    ) as x
    order by x.rev
    limit v_limit;
  -- Checked after reading, so a purge that ran meanwhile is always noticed.
  select c.purged_until_rev into v_purged from public.companies c where c.id = p_company;
  if v_since > 0 and v_since < coalesce(v_purged, 0) then
    raise exception 'almail:resync This device has been away too long; a full sync is needed.'
      using errcode = 'P0001';
  end if;
end
$$;

-- Ids of every record the caller may read, page by page (for a full resync
-- and for the file clean-up).
create or replace function public.company_record_ids(
  p_company text,
  p_tbl text default null,
  p_after_tbl text default '',
  p_after_id text default '',
  p_limit integer default 1000
)
returns table (tbl text, id text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  return query
    select r.tbl, r.id
    from public.records r
    where r.company_id = p_company
      and (p_tbl is null or r.tbl = p_tbl)
      and (r.tbl, r.id) > (coalesce(p_after_tbl, ''), coalesce(p_after_id, ''))
    order by r.tbl, r.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end
$$;

-- How much there is to download, and how far deletion markers were purged.
create or replace function public.company_sync_info(p_company text)
returns table (purged_until_rev bigint, record_count bigint, max_rev bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  return query
    select
      c.purged_until_rev,
      (select count(*) from public.records r where r.company_id = p_company),
      greatest(
        (select coalesce(max(r.rev), 0) from public.records r where r.company_id = p_company),
        (select coalesce(max(m.rev), 0) from public.deleted_records m where m.company_id = p_company)
      )
    from public.companies c
    where c.id = p_company;
end
$$;

-- The caller's companies and role in each.
create or replace function public.my_companies()
returns table (id text, name text, role public.member_role, created_at timestamptz, members bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    m.role,
    c.created_at,
    (select count(*) from public.company_members x where x.company_id = c.id)
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid()
  order by c.name
$$;

-- Members of a company with their names and emails, for its members only.
create or replace function public.company_team(p_company text)
returns table (user_id uuid, full_name text, email text, role public.member_role, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(p.full_name, ''), coalesce(p.email, ''), m.role, m.created_at
    from public.company_members m
    left join public.profiles p on p.id = m.user_id
    where m.company_id = p_company
    order by m.role, m.created_at;
end
$$;

-- An invitation link for an email address. Owners and admins only; nobody is
-- invited as owner. A new invitation replaces a pending one for the same email.
create or replace function public.create_invite(p_company text, p_email text, p_role public.member_role)
returns table (id uuid, token text, email text, role public.member_role, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.member_role := almailbooks.member_role(p_company);
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_me is null or v_me not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can invite people.'
      using errcode = '42501';
  end if;
  if p_role is null or p_role = 'owner' then
    raise exception 'almail:invalid Invite as admin, accountant, staff or viewer.'
      using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 320 then
    raise exception 'almail:invalid Check the email address.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.company_members m
    join auth.users u on u.id = m.user_id
    where m.company_id = p_company and lower(u.email) = v_email
  ) then
    raise exception 'almail:already_member This person is already a member.' using errcode = '23505';
  end if;
  if (
    select count(*)
    from public.company_invites i
    where i.company_id = p_company and i.accepted_at is null and i.revoked_at is null
      and i.expires_at > now()
  ) >= 50 then
    raise exception 'almail:limit Too many pending invitations.' using errcode = '54000';
  end if;
  update public.company_invites i
  set revoked_at = now()
  where i.company_id = p_company and i.email = v_email
    and i.accepted_at is null and i.revoked_at is null;
  return query
    insert into public.company_invites as i (company_id, email, role, token, invited_by)
    values (
      p_company,
      v_email,
      p_role,
      -- 244 random bits from the server's strong random source.
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      auth.uid()
    )
    returning i.id, i.token, i.email, i.role, i.expires_at;
end
$$;

-- Pending invitations, with their links, for owners and admins.
create or replace function public.list_invites(p_company text)
returns table (
  id uuid,
  email text,
  role public.member_role,
  token text,
  created_at timestamptz,
  expires_at timestamptz,
  invited_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if almailbooks.member_role(p_company) is null
    or almailbooks.member_role(p_company) not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can see invitations.'
      using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.role, i.token, i.created_at, i.expires_at, coalesce(p.full_name, '')
    from public.company_invites i
    left join public.profiles p on p.id = i.invited_by
    where i.company_id = p_company and i.accepted_at is null and i.revoked_at is null
    order by i.created_at desc;
end
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
begin
  select i.company_id into v_company from public.company_invites i where i.id = p_invite;
  if v_company is null
    or almailbooks.member_role(v_company) is null
    or almailbooks.member_role(v_company) not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can cancel invitations.'
      using errcode = '42501';
  end if;
  update public.company_invites i
  set revoked_at = now()
  where i.id = p_invite and i.accepted_at is null and i.revoked_at is null;
end
$$;

-- What an invitation link is for, to show before accepting it.
create or replace function public.invite_details(p_token text)
returns table (
  company_id text,
  company_name text,
  invited_by_name text,
  email text,
  role public.member_role,
  expires_at timestamptz,
  status text,
  email_matches boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'almail:auth Sign in first.' using errcode = '42501';
  end if;
  return query
    select
      i.company_id,
      c.name,
      coalesce(p.full_name, ''),
      i.email,
      i.role,
      i.expires_at,
      case
        when i.revoked_at is not null then 'revoked'
        when i.accepted_at is not null then 'accepted'
        when i.expires_at < now() then 'expired'
        else 'pending'
      end,
      i.email = (select lower(u.email) from auth.users u where u.id = auth.uid())
    from public.company_invites i
    join public.companies c on c.id = i.company_id
    left join public.profiles p on p.id = i.invited_by
    where i.token = p_token;
end
$$;

-- Joins the company of an invitation. Only for the invited address, once it is
-- confirmed, and only while the invitation is pending.
create or replace function public.accept_invite(p_token text)
returns table (company_id text, company_name text, role public.member_role)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_invite public.company_invites;
  v_email text;
  v_confirmed timestamptz;
  v_role public.member_role;
begin
  if v_uid is null then
    raise exception 'almail:auth Sign in first.' using errcode = '42501';
  end if;
  select * into v_invite from public.company_invites i where i.token = p_token for update;
  if not found then
    raise exception 'almail:invite_invalid This invitation link is not valid.' using errcode = '22023';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'almail:invite_revoked This invitation was cancelled.' using errcode = '22023';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'almail:invite_used This invitation has already been used.' using errcode = '22023';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'almail:invite_expired This invitation has expired.' using errcode = '22023';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u
  where u.id = v_uid;
  if v_confirmed is null then
    raise exception 'almail:email_unconfirmed Confirm your email address first.'
      using errcode = '42501';
  end if;
  if v_email is distinct from v_invite.email then
    raise exception 'almail:invite_wrong_email This invitation is for another email address.'
      using errcode = '42501';
  end if;
  select m.role into v_role
  from public.company_members m
  where m.company_id = v_invite.company_id and m.user_id = v_uid;
  if v_role is null then
    insert into public.company_members (company_id, user_id, role)
    values (v_invite.company_id, v_uid, v_invite.role);
    v_role := v_invite.role;
  end if;
  update public.company_invites i
  set accepted_at = now(), accepted_by = v_uid
  where i.id = v_invite.id;
  return query
    select c.id, c.name, v_role from public.companies c where c.id = v_invite.company_id;
end
$$;

-- Changes a member's role. Owners and admins; never the owner's role.
create or replace function public.set_member_role(p_company text, p_user uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.member_role := almailbooks.member_role(p_company);
  v_target public.member_role;
begin
  if v_me is null or v_me not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can change roles.'
      using errcode = '42501';
  end if;
  if p_role is null or p_role = 'owner' then
    raise exception 'almail:invalid Use transfer ownership to make someone the owner.'
      using errcode = '22023';
  end if;
  select m.role into v_target
  from public.company_members m
  where m.company_id = p_company and m.user_id = p_user
  for update;
  if v_target is null then
    raise exception 'almail:invalid This person is not a member.' using errcode = '22023';
  end if;
  if v_target = 'owner' then
    raise exception 'almail:permission The owner''s role cannot be changed.' using errcode = '42501';
  end if;
  update public.company_members m
  set role = p_role
  where m.company_id = p_company and m.user_id = p_user;
end
$$;

-- Removes a member (owners and admins), or leaves the company (anyone but the owner).
create or replace function public.remove_member(p_company text, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.member_role := almailbooks.member_role(p_company);
  v_target public.member_role;
begin
  if v_me is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  select m.role into v_target
  from public.company_members m
  where m.company_id = p_company and m.user_id = p_user
  for update;
  if v_target is null then
    return;
  end if;
  if v_target = 'owner' then
    raise exception 'almail:permission The owner cannot be removed. Transfer ownership first.'
      using errcode = '42501';
  end if;
  if p_user <> auth.uid() and v_me not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can remove members.'
      using errcode = '42501';
  end if;
  delete from public.company_members m where m.company_id = p_company and m.user_id = p_user;
end
$$;

-- Makes another member the owner; the previous owner becomes an admin.
create or replace function public.transfer_ownership(p_company text, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if almailbooks.member_role(p_company) is distinct from 'owner' then
    raise exception 'almail:permission Only the owner can transfer ownership.' using errcode = '42501';
  end if;
  if p_user is null or p_user = auth.uid() then
    raise exception 'almail:invalid Choose another member.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.company_members m where m.company_id = p_company and m.user_id = p_user
  ) then
    raise exception 'almail:invalid This person is not a member.' using errcode = '22023';
  end if;
  update public.company_members m
  set role = 'admin'
  where m.company_id = p_company and m.user_id = auth.uid();
  update public.company_members m
  set role = 'owner'
  where m.company_id = p_company and m.user_id = p_user;
end
$$;

-- Deletes a company and everything it has in the cloud: records, markers,
-- members and invitations. The app removes its files from Storage first.
create or replace function public.delete_company(p_company text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if almailbooks.member_role(p_company) is distinct from 'owner' then
    raise exception 'almail:permission Only the owner can delete the company.' using errcode = '42501';
  end if;
  perform set_config('almailbooks.deleting_company', p_company, true);
  delete from public.companies c where c.id = p_company;
  perform set_config('almailbooks.deleting_company', '', true);
end
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on all functions in schema almailbooks from public, anon;
grant execute on function
  almailbooks.member_role(text),
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.staff_can_write(text, jsonb),
  almailbooks.can_read_record(text, text, jsonb),
  almailbooks.can_write_record(text, text, jsonb),
  almailbooks.can_delete_record(text, text, jsonb),
  almailbooks.can_read_marker(text, boolean),
  almailbooks.can_use_file(text, text, boolean),
  almailbooks.merge_numbering_rule(jsonb, jsonb),
  almailbooks.merge_numbering(jsonb, jsonb),
  almailbooks.purge_deleted_records(text),
  almailbooks.touch_sync_signal(text, bigint)
to authenticated;
revoke all on function almailbooks.purge_all_deleted_records() from authenticated;

revoke all on function
  public.create_company(text, text),
  public.push_records(text, jsonb),
  public.pull_records(text, bigint, integer),
  public.company_record_ids(text, text, text, text, integer),
  public.company_sync_info(text),
  public.my_companies(),
  public.company_team(text),
  public.create_invite(text, text, public.member_role),
  public.list_invites(text),
  public.revoke_invite(uuid),
  public.invite_details(text),
  public.accept_invite(text),
  public.set_member_role(text, uuid, public.member_role),
  public.remove_member(text, uuid),
  public.transfer_ownership(text, uuid),
  public.delete_company(text)
from public, anon;
grant execute on function
  public.create_company(text, text),
  public.push_records(text, jsonb),
  public.pull_records(text, bigint, integer),
  public.company_record_ids(text, text, text, text, integer),
  public.company_sync_info(text),
  public.my_companies(),
  public.company_team(text),
  public.create_invite(text, text, public.member_role),
  public.list_invites(text),
  public.revoke_invite(uuid),
  public.invite_details(text),
  public.accept_invite(text),
  public.set_member_role(text, uuid, public.member_role),
  public.remove_member(text, uuid),
  public.transfer_ownership(text, uuid),
  public.delete_company(text)
to authenticated;

-- Storage: receipts and scans ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-files', 'company-files', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "AlmailBooks files: read" on storage.objects;
drop policy if exists "AlmailBooks files: upload" on storage.objects;
drop policy if exists "AlmailBooks files: replace" on storage.objects;
drop policy if exists "AlmailBooks files: delete" on storage.objects;
-- Earlier drafts of the rules above.
drop function if exists almailbooks.can_read_file(text);
drop function if exists almailbooks.can_write_file(text);

-- Storage reads back what it saves (upsert ... returning) and what it removes
-- (delete ... returning), so the read rule applies to uploads and removals too.
create policy "AlmailBooks files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'company-files' and almailbooks.can_use_file(name, owner_id, false));
create policy "AlmailBooks files: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'company-files' and almailbooks.can_use_file(name, owner_id, true));
create policy "AlmailBooks files: replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-files' and almailbooks.can_use_file(name, owner_id, true))
  with check (bucket_id = 'company-files' and almailbooks.can_use_file(name, owner_id, true));
create policy "AlmailBooks files: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-files' and almailbooks.can_use_file(name, owner_id, true));

-- Realtime: members hear that their company changed ------------------------------------

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_signals'
    ) then
    alter publication supabase_realtime add table public.sync_signals;
  end if;
end
$$;

-- Daily clean-up of deletion markers (when pg_cron is enabled) ---------------------------

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'almailbooks-purge-deleted-records',
      '17 3 * * *',
      'select almailbooks.purge_all_deleted_records()'
    );
  end if;
end
$$;
