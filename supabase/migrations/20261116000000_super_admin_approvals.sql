-- =============================================================================
-- Maham One cloud: the Super Admin (the company's owner) and approvals
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261102000000_tables_v16.sql. It is safe to run
-- again.
--
-- The Super Admin is the owner of each company: whoever should be Super Admin
-- is made the owner with Settings → Team → Transfer ownership. Nothing here
-- names a person.
--
-- Until it runs, the app keeps working as before: it asks the server what it
-- has (server_features) and keeps these settings hidden. Once it has run,
-- nothing changes either until the owner uses them: every member starts with
-- no limits ('{}'), nobody but the owner approves, and admins keep inviting
-- and changing every role until the owner switches on "Only the owner makes
-- admins and accountants".
--
-- What it adds
--   * company_members.permissions: limits the owner sets for a member, app by
--     app ({"apps": {"books": "view", "people": "none"}}). They only ever take
--     away: a member never gets more than their role. The server refuses
--     their changes to the records of an app limited to "view" or "none"
--     (can_write_record); reading is unchanged.
--   * company_members.can_approve: up to two admins or accountants who may
--     approve besides the owner (almailbooks.is_approver), for the approval
--     requests of later releases.
--   * companies.senior_roles_owner_only: the owner's switch. On, only the
--     owner invites, makes, changes or removes admins and accountants; admins
--     still invite and remove staff and viewers.
--   * set_member_permissions, team_permissions, my_permissions,
--     set_team_rules and owned_companies_overview for the app.
--   * A record of every change of the team (joined, role, limits, approver,
--     left, a new owner when the owner's account is deleted) in the change
--     feed of a later release. Until that release creates the feed it does
--     nothing, and it can never stop a team change.
--   * public.server_features() also answers 'super_admin'.
-- =============================================================================

-- Columns ------------------------------------------------------------------------

alter table public.company_members
  add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.company_members
  add column if not exists can_approve boolean not null default false;
alter table public.company_members drop constraint if exists company_members_permissions_check;
alter table public.company_members
  add constraint company_members_permissions_check
  check (jsonb_typeof(permissions) = 'object' and octet_length(permissions::text) <= 4096);

alter table public.companies
  add column if not exists senior_roles_owner_only boolean not null default false;

-- Helpers (not callable through the API) ---------------------------------------

-- The owner's switch: only the owner makes admins and accountants.
create or replace function almailbooks.senior_roles_owner_only(p_company text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.senior_roles_owner_only from public.companies c where c.id = p_company),
    false
  )
$$;

-- The caller may decide approval requests: the owner, or an admin or
-- accountant the owner allowed to approve.
create or replace function almailbooks.is_approver(p_company text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and (m.role = 'owner' or (m.can_approve and m.role in ('admin', 'accountant')))
  )
$$;

-- The app whose records these are, for the owner's limits; null for what
-- every app shares (the company record, activity, files, approval requests).
-- Kept the same as recordApp in src/cloud/roles.ts.
create or replace function almailbooks.record_app(p_tbl text, p_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tbl in (
      'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
      'finalSettlements', 'letterTemplates', 'employeeLetters'
    ) then 'people'
    -- Payroll entries are made by pay runs.
    when p_tbl = 'journals' and coalesce(p_data ->> 'kind', '') = 'payroll' then 'people'
    -- An employee's own papers are kept with them.
    when p_tbl in ('complianceDocuments', 'renewals')
      and coalesce(p_data ->> 'employeeId', '') <> '' then 'people'
    when p_tbl in ('complianceDocuments', 'renewals', 'complianceMarks', 'vehicles')
      then 'compliance'
    when p_tbl in (
      'clients', 'products', 'taxRates', 'documents', 'payments', 'recurring', 'accounts',
      'journals', 'expenses', 'vatReturns', 'bankTransactions', 'securityCheques', 'assets',
      'depreciationRuns', 'yearEnds', 'warehouses', 'stockMovements', 'stockEntries',
      'landedCosts', 'chequeLayouts'
    ) then 'books'
    else null
  end
$$;

-- As in the first file, and then the owner's limits on the member: nothing
-- of an app limited to "view" or "none". No limits ('{}', every member
-- before this file) give the same answer as before.
create or replace function almailbooks.can_write_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
  v_apps jsonb;
begin
  select m.role, m.permissions -> 'apps' into v_role, v_apps
  from public.company_members m
  where m.company_id = p_company and m.user_id = auth.uid();
  if v_role is null or v_role = 'viewer' then
    return false;
  end if;
  if v_role = 'staff' and not (
    almailbooks.staff_can_write(p_tbl, p_data)
    and not almailbooks.record_is_private(p_company, p_tbl, p_data)
  ) then
    return false;
  end if;
  if v_role <> 'owner'
    and jsonb_typeof(v_apps) = 'object'
    and coalesce(v_apps ->> almailbooks.record_app(p_tbl, p_data), '') in ('none', 'view') then
    return false;
  end if;
  return true;
end
$$;

-- Team members' rows stay consistent whatever changes them (an invitation
-- accepted, a role changed, ownership moved): the owner has no limits and
-- needs no approver mark, and only admins and accountants may approve.
create or replace function almailbooks.company_members_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner' then
    new.permissions := '{}'::jsonb;
    new.can_approve := false;
  elsif new.role not in ('admin', 'accountant') then
    new.can_approve := false;
  end if;
  return new;
end
$$;

drop trigger if exists company_members_before_write on public.company_members;
create trigger company_members_before_write
  before insert or update on public.company_members
  for each row execute function almailbooks.company_members_before_write();

-- Every change of the team goes to the change feed (public.change_events,
-- created by 20261123000000_change_feed.sql) as kind 'member', with the
-- person's id and roles only. Without the feed it does nothing, and any
-- problem writing to it is ignored: it never stops a team change.
create or replace function almailbooks.company_members_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_user uuid;
  v_reason text;
  v_summary jsonb;
begin
  if to_regclass('public.change_events') is null then
    return null;
  end if;
  begin
    if tg_op = 'DELETE' then
      v_company := old.company_id;
      v_user := old.user_id;
    else
      v_company := new.company_id;
      v_user := new.user_id;
    end if;
    -- The whole company is going: nothing to tell anyone.
    if current_setting('almailbooks.deleting_company', true) = v_company
      or not exists (select 1 from public.companies c where c.id = v_company) then
      return null;
    end if;
    if tg_op = 'INSERT' then
      v_reason := 'joined';
    elsif tg_op = 'DELETE' then
      v_reason := 'left';
    elsif new.role is distinct from old.role then
      if new.role = 'owner' then
        -- Ownership given by the owner, who is still a member, or taken over
        -- by the longest-standing admin when the owner's account was deleted.
        v_reason := case
          when exists (
            select 1
            from public.company_members m
            where m.company_id = v_company and m.user_id = auth.uid()
          ) then 'ownership'
          else 'succession'
        end;
      else
        v_reason := 'role';
      end if;
    elsif new.permissions is distinct from old.permissions
      or new.can_approve is distinct from old.can_approve then
      v_reason := 'permissions';
    else
      return null;
    end if;
    v_summary := jsonb_strip_nulls(jsonb_build_object(
      'reason', v_reason,
      'user', v_user,
      'role', case when tg_op <> 'DELETE' then new.role::text end,
      'before', case when tg_op <> 'INSERT' then old.role::text end,
      'permissions', case when tg_op <> 'DELETE' then new.permissions end,
      'canApprove', case when tg_op <> 'DELETE' then new.can_approve end
    ));
    execute
      'insert into public.change_events '
      || '(company_id, actor, op, tbl, record_id, kind, important, private, count, fold_key, summary) '
      || 'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)'
      using v_company, auth.uid(), lower(tg_op), 'company_members', v_user::text, 'member', true,
        false, 1, 'member:' || gen_random_uuid()::text, v_summary;
  exception when others then
    null;
  end;
  return null;
end
$$;

drop trigger if exists company_members_audit on public.company_members;
create trigger company_members_audit
  after insert or update or delete on public.company_members
  for each row execute function almailbooks.company_members_audit();

-- Functions the app calls: the team, as in the first file -------------------------

-- An invitation link for an email address. Owners and admins only; nobody is
-- invited as owner. A new invitation replaces a pending one for the same
-- email. With the owner's switch on, only the owner invites admins and
-- accountants.
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
  if v_me <> 'owner' and p_role in ('admin', 'accountant')
    and almailbooks.senior_roles_owner_only(p_company) then
    raise exception 'almail:permission Only the owner can invite admins and accountants.'
      using errcode = '42501';
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

-- Cancels an invitation (owners and admins). With the owner's switch on, an
-- invitation as admin or accountant is the owner's to cancel.
create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_role public.member_role;
  v_me public.member_role;
begin
  select i.company_id, i.role into v_company, v_role
  from public.company_invites i
  where i.id = p_invite;
  v_me := almailbooks.member_role(v_company);
  if v_company is null or v_me is null or v_me not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can cancel invitations.'
      using errcode = '42501';
  end if;
  if v_me <> 'owner' and v_role in ('admin', 'accountant')
    and almailbooks.senior_roles_owner_only(v_company) then
    raise exception 'almail:permission Only the owner can cancel invitations of admins and accountants.'
      using errcode = '42501';
  end if;
  update public.company_invites i
  set revoked_at = now()
  where i.id = p_invite and i.accepted_at is null and i.revoked_at is null;
end
$$;

-- Changes a member's role. Owners and admins; never the owner's role. With
-- the owner's switch on, only the owner makes someone an admin or
-- accountant, or changes the role of one.
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
  if v_me <> 'owner'
    and (v_target in ('admin', 'accountant') or p_role in ('admin', 'accountant'))
    and almailbooks.senior_roles_owner_only(p_company) then
    raise exception 'almail:permission Only the owner can make or change admins and accountants.'
      using errcode = '42501';
  end if;
  update public.company_members m
  set role = p_role
  where m.company_id = p_company and m.user_id = p_user;
end
$$;

-- Removes a member (owners and admins), or leaves the company (anyone but the
-- owner). With the owner's switch on, only the owner removes an admin or
-- accountant; they may still leave by themselves.
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
  if p_user <> auth.uid() and v_me <> 'owner' and v_target in ('admin', 'accountant')
    and almailbooks.senior_roles_owner_only(p_company) then
    raise exception 'almail:permission Only the owner can remove admins and accountants.'
      using errcode = '42501';
  end if;
  delete from public.company_members m where m.company_id = p_company and m.user_id = p_user;
end
$$;

-- Functions the app calls: the Super Admin's controls -------------------------------

-- The owner's limits and approver mark for a member. Owner only, never on the
-- owner's own row. p_permissions: {"apps": {"books" | "people" | "crm" |
-- "compliance": "none" | "view" | "edit" | "manage"}}; the server refuses
-- that member's changes to an app limited to "none" or "view". Approvers:
-- admins and accountants only, two at most besides the owner.
create or replace function public.set_member_permissions(
  p_company text,
  p_user uuid,
  p_permissions jsonb,
  p_can_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.member_role;
  v_permissions jsonb := coalesce(p_permissions, '{}'::jsonb);
  v_apps jsonb;
  v_approve boolean := coalesce(p_can_approve, false);
begin
  if almailbooks.member_role(p_company) is distinct from 'owner' then
    raise exception 'almail:permission Only the owner can set what members may do.'
      using errcode = '42501';
  end if;
  select m.role into v_target
  from public.company_members m
  where m.company_id = p_company and m.user_id = p_user
  for update;
  if v_target is null then
    raise exception 'almail:invalid This person is not a member.' using errcode = '22023';
  end if;
  if v_target = 'owner' then
    raise exception 'almail:permission The owner always has full access.' using errcode = '42501';
  end if;
  -- Checked one step at a time: the key functions fail on anything but an object.
  if jsonb_typeof(v_permissions) <> 'object' then
    raise exception 'almail:invalid Limits are given app by app.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_permissions) as k(key) where k.key <> 'apps') then
    raise exception 'almail:invalid Limits are given app by app.' using errcode = '22023';
  end if;
  v_apps := v_permissions -> 'apps';
  if v_apps is not null and jsonb_typeof(v_apps) <> 'object' then
    raise exception 'almail:invalid Limits are given app by app.' using errcode = '22023';
  end if;
  if v_apps is not null and exists (
    select 1
    from jsonb_each(v_apps) as e(key, value)
    where e.key not in ('books', 'people', 'crm', 'compliance')
      or jsonb_typeof(e.value) <> 'string'
      or (e.value #>> '{}') not in ('none', 'view', 'edit', 'manage')
  ) then
    raise exception 'almail:invalid Limits are given app by app.' using errcode = '22023';
  end if;
  if v_apps is not null and v_apps = '{}'::jsonb then
    v_permissions := '{}'::jsonb;
  end if;
  if v_approve and v_target not in ('admin', 'accountant') then
    raise exception 'almail:invalid Only admins and accountants can approve.' using errcode = '22023';
  end if;
  if v_approve and (
    select count(*)
    from public.company_members m
    where m.company_id = p_company
      and m.user_id <> p_user
      and m.can_approve
      and m.role in ('admin', 'accountant')
  ) >= 2 then
    raise exception 'almail:limit Up to two members besides the owner can approve.'
      using errcode = '54000';
  end if;
  update public.company_members m
  set permissions = v_permissions, can_approve = v_approve
  where m.company_id = p_company and m.user_id = p_user;
end
$$;

-- Every member's limits and approver mark for the owner and admins; the
-- caller's own for the others.
create or replace function public.team_permissions(p_company text)
returns table (user_id uuid, permissions jsonb, can_approve boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.member_role := almailbooks.member_role(p_company);
begin
  if v_me is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  return query
    select m.user_id, m.permissions, m.can_approve and m.role in ('admin', 'accountant')
    from public.company_members m
    where m.company_id = p_company
      and (v_me in ('owner', 'admin') or m.user_id = auth.uid())
    order by m.role, m.created_at;
end
$$;

-- The caller's own limits, whether they approve, whether they are the owner
-- (the Super Admin), and the owner's switch, for the app to apply as it works.
create or replace function public.my_permissions(p_company text)
returns table (
  permissions jsonb,
  can_approve boolean,
  is_owner boolean,
  senior_roles_owner_only boolean
)
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
    select
      m.permissions,
      m.role = 'owner' or (m.can_approve and m.role in ('admin', 'accountant')),
      m.role = 'owner',
      almailbooks.senior_roles_owner_only(p_company)
    from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid();
end
$$;

-- The owner's switch. Switched on, invitations as admin or accountant made by
-- anyone but the owner are cancelled: they would make someone an admin or
-- accountant the owner didn't choose.
create or replace function public.set_team_rules(p_company text, p_senior_roles_owner_only boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if almailbooks.member_role(p_company) is distinct from 'owner' then
    raise exception 'almail:permission Only the owner can change the team rules.'
      using errcode = '42501';
  end if;
  update public.companies c
  set senior_roles_owner_only = coalesce(p_senior_roles_owner_only, false)
  where c.id = p_company;
  if coalesce(p_senior_roles_owner_only, false) then
    update public.company_invites i
    set revoked_at = now()
    where i.company_id = p_company
      and i.role in ('admin', 'accountant')
      and i.accepted_at is null
      and i.revoked_at is null
      and i.invited_by is distinct from auth.uid();
  end if;
end
$$;

-- The companies the caller owns (is Super Admin of), with how many members
-- each has and how many approval requests are waiting.
create or replace function public.owned_companies_overview()
returns table (company_id text, name text, members bigint, pending_approvals bigint)
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
      c.id,
      c.name,
      (select count(*) from public.company_members x where x.company_id = c.id),
      (
        select count(*)
        from public.records r
        where r.company_id = c.id
          and r.tbl = 'approvals'
          and coalesce(r.data ->> 'status', '') = 'pending'
      )
    from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.user_id = auth.uid() and m.role = 'owner'
    order by c.name;
end
$$;

-- What this server has beyond the first files, so the app shows a feature
-- only once the server has what it needs: tables_v16 is the fourth file,
-- super_admin this one.
create or replace function public.server_features()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array['tables_v16', 'super_admin']::text[]
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.senior_roles_owner_only(text),
  almailbooks.is_approver(text),
  almailbooks.record_app(text, jsonb),
  almailbooks.company_members_before_write(),
  almailbooks.company_members_audit()
from public, anon;
grant execute on function
  almailbooks.senior_roles_owner_only(text),
  almailbooks.is_approver(text),
  almailbooks.record_app(text, jsonb)
to authenticated;

revoke all on function
  public.set_member_permissions(text, uuid, jsonb, boolean),
  public.team_permissions(text),
  public.my_permissions(text),
  public.set_team_rules(text, boolean),
  public.owned_companies_overview(),
  public.create_invite(text, text, public.member_role),
  public.revoke_invite(uuid),
  public.set_member_role(text, uuid, public.member_role),
  public.remove_member(text, uuid),
  public.server_features()
from public, anon;
grant execute on function
  public.set_member_permissions(text, uuid, jsonb, boolean),
  public.team_permissions(text),
  public.my_permissions(text),
  public.set_team_rules(text, boolean),
  public.owned_companies_overview(),
  public.create_invite(text, text, public.member_role),
  public.revoke_invite(uuid),
  public.set_member_role(text, uuid, public.member_role),
  public.remove_member(text, uuid),
  public.server_features()
to authenticated;

-- The Data API learns about the new functions at once.
notify pgrst, 'reload schema';
