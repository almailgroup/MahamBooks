-- =============================================================================
-- Maham One cloud: the change feed (changes by the team, for the Super Admin)
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261116000000_super_admin_approvals.sql. It is safe
-- to run again. The emails need 20261007000000_email_alerts.sql too (the
-- address of the email-alerts function and its secret).
--
-- Until it runs, the app keeps working as before: it asks the server what it
-- has (server_features) and keeps the bell and the settings hidden. Once it
-- has run, nothing changes either until the owner (or a member the owner
-- allowed to approve) turns on "Changes by your team" in Settings → Email
-- alerts: until someone of the company has, nothing is recorded.
--
-- What it adds
--   * public.change_events: who changed what, recorded by the server as each
--     change reaches it (the author is the signed-in account, never what the
--     device says). Ordinary changes of one sync fold into one row per kind
--     of record and person ("12 changes to customers"); important ones stay
--     a row each: an issued invoice or credit note edited, voided, restored
--     or deleted, cheques, approval requests and decisions, numbering rules,
--     the lock date, the approval rules, pay runs, and team changes (written
--     by the Super Admin file's team audit). Changes to payroll and people
--     data are marked private and carry no names or amounts.
--     Row-level security on, no grants: only the functions below read it.
--   * The trigger that fills it can never stop a sync: any problem is
--     ignored and the change is stored as before.
--   * public.notification_settings: each recipient's own choice (on or off,
--     what is emailed at once, the daily summary), kept with what the
--     email-alerts function has sent. public.notification_reads: how far
--     each person has read in the app.
--   * notification_status, notification_feed, mark_notifications_read,
--     change_notification_settings and set_change_notifications for the app:
--     the owner and approvers only, and nobody sees their own changes.
--   * A schedule (Supabase Cron, with pg_net) that asks the email-alerts
--     function every 5 minutes to email what is due: important changes
--     within about 5 minutes (one email per person at most every 15 minutes
--     and 20 a day), everything else in a summary at 8:00 Kuwait time.
--     Changes are kept 180 days.
--   * public.server_features() also answers 'change_feed'.
-- =============================================================================

do $$
begin
  if to_regprocedure('almailbooks.invoice_content(jsonb)') is null
    or to_regprocedure('almailbooks.is_approver(text)') is null
    or to_regprocedure('almailbooks.cheque_content(jsonb)') is null then
    raise exception 'Run 20261116000000_super_admin_approvals.sql first, then this file.';
  end if;
end
$$;

-- Tables ------------------------------------------------------------------------

create sequence if not exists public.change_events_id_seq;

create table if not exists public.change_events (
  id bigint primary key default nextval('public.change_events_id_seq'),
  company_id text not null references public.companies (id) on delete cascade,
  at timestamptz not null default now(),
  -- The account that made the change; null for the server's own changes.
  actor uuid,
  -- insert, update, delete, or mixed for a fold of several.
  op text not null,
  tbl text not null,
  -- The record (for a fold, the last one).
  record_id text not null,
  -- document, payment, cheque, approval, settings, member, people,
  -- compliance, contact, item, expense, accounting, file.
  kind text not null,
  important boolean not null default false,
  -- About payroll or people data: only the owner, admins and accountants see it.
  private boolean not null default false,
  -- How many changes it stands for.
  count integer not null default 1,
  -- Changes with the same key are one row: one sync's changes of a kind of
  -- record by one person; important changes have a key of their own.
  fold_key text not null,
  -- What changed, in a few fields (no names or amounts when private).
  summary jsonb not null default '{}'::jsonb,
  constraint change_events_fold unique (company_id, fold_key)
);
alter sequence public.change_events_id_seq owned by public.change_events.id;
create index if not exists change_events_company_id on public.change_events (company_id, id);
create index if not exists change_events_at on public.change_events (at);

alter table public.change_events enable row level security;
revoke all on public.change_events from public, anon, authenticated;
revoke all on sequence public.change_events_id_seq from public, anon, authenticated;

create table if not exists public.notification_settings (
  company_id text not null,
  user_id uuid not null,
  enabled boolean not null default false,
  -- Important changes of these kinds are emailed within minutes; the rest wait.
  immediate_kinds text[] not null
    default array['document', 'cheque', 'approval', 'member', 'settings', 'people'],
  -- daily: everything else at 8:00 Kuwait time; off: only what is emailed at once.
  digest text not null default 'daily',
  -- Where the app was opened when this was saved: the button in the email.
  app_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Kept by the email-alerts function.
  -- Changes up to this one were emailed (or let go, with the summary off).
  emailed_upto bigint not null default 0,
  -- The last day (Kuwait time) the daily summary was looked at.
  digest_on date,
  -- Emails sent on sent_on (Kuwait time), for the daily cap.
  sent_on date,
  sent_count integer not null default 0,
  last_sent_at timestamptz,
  last_error text not null default '',
  last_error_at timestamptz,
  -- A run is working on this one until then.
  claimed_until timestamptz,
  -- Resend's idempotency key of an email whose answer was lost, and the last
  -- change it covered, so trying again sends that same email once.
  send_key text,
  send_upto bigint,
  primary key (company_id, user_id),
  foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete cascade
);
alter table public.notification_settings drop constraint if exists notification_settings_kinds_check;
alter table public.notification_settings
  add constraint notification_settings_kinds_check
  check (immediate_kinds <@ array['document', 'cheque', 'approval', 'member', 'settings', 'people']::text[]);
alter table public.notification_settings drop constraint if exists notification_settings_digest_check;
alter table public.notification_settings
  add constraint notification_settings_digest_check check (digest in ('daily', 'off'));
alter table public.notification_settings drop constraint if exists notification_settings_app_url_check;
alter table public.notification_settings
  add constraint notification_settings_app_url_check
  check (app_url = '' or (app_url ~ '^https?://[^[:space:]"''<>]+$' and char_length(app_url) <= 300));
alter table public.notification_settings drop constraint if exists notification_settings_error_length;
alter table public.notification_settings
  add constraint notification_settings_error_length check (char_length(last_error) <= 1000);
create index if not exists notification_settings_user on public.notification_settings (user_id);

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from public, anon, authenticated;

create table if not exists public.notification_reads (
  company_id text not null,
  user_id uuid not null,
  -- Changes up to this one are read.
  read_upto bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete cascade
);
alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from public, anon, authenticated;

-- Helpers (not callable through the API) ---------------------------------------

-- The kind of change a record makes, for the filters and the emails. Kept the
-- same as changeKind in src/cloud/change-feed.ts.
create or replace function almailbooks.change_kind(p_tbl text, p_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tbl = 'documents' then 'document'
    when p_tbl = 'payments' then
      case when coalesce(p_data ->> 'method', '') = 'cheque' then 'cheque' else 'payment' end
    when p_tbl = 'securityCheques' then 'cheque'
    when p_tbl = 'approvals' then 'approval'
    when p_tbl = 'companies' then 'settings'
    when p_tbl in (
      'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
      'finalSettlements', 'letterTemplates', 'employeeLetters'
    ) then 'people'
    when p_tbl in ('complianceDocuments', 'renewals', 'complianceMarks', 'vehicles') then 'compliance'
    when p_tbl = 'clients' then 'contact'
    when p_tbl in ('products', 'warehouses', 'stockMovements', 'stockEntries', 'landedCosts')
      then 'item'
    when p_tbl = 'expenses' then 'expense'
    when p_tbl = 'attachments' then 'file'
    else 'accounting'
  end
$$;

-- What a change did and whether it is important, with a short summary:
-- {"important": true, "summary": {"what": "voided", ...}}, or null for a
-- change nobody needs to hear about (a document counter moving on). Private
-- changes carry no names, numbers or amounts. Kept the same as changeDetails
-- in src/cloud/change-feed.ts.
create or replace function almailbooks.change_details(
  p_company text,
  p_tbl text,
  p_old jsonb,
  p_new jsonb,
  p_private boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_data jsonb := coalesce(p_new, p_old);
  v_what text;
  v_important boolean := false;
  v_summary jsonb;
  v_was text;
  v_now text;
  v_client text;
  v_client_ar text;
  v_changes text[] := '{}';
  v_cheque boolean;
  v_old_rest jsonb;
  v_new_rest jsonb;
begin
  v_what := case when p_old is null then 'added' when p_new is null then 'deleted' else 'updated' end;

  -- Payroll and people data: only what happened, and to a pay run its stage.
  if p_private then
    if p_tbl = 'approvals' then
      v_was := coalesce(p_old ->> 'status', 'pending');
      v_now := coalesce(p_new ->> 'status', 'pending');
      if p_old is null then
        v_what := 'requested';
      elsif p_new is not null and v_now <> v_was then
        v_what := v_now;
      end if;
      return jsonb_build_object(
        'important', v_what in ('requested', 'approved', 'rejected'),
        'summary', jsonb_strip_nulls(jsonb_build_object(
          'what', v_what, 'request', v_data ->> 'kind', 'status', v_now
        ))
      );
    end if;
    if p_tbl = 'payRuns' then
      v_was := p_old ->> 'status';
      v_now := p_new ->> 'status';
      if p_old is not null and p_new is not null and v_now is distinct from v_was then
        v_what := coalesce(v_now, 'updated');
      end if;
      return jsonb_build_object(
        'important', v_what <> 'updated' and v_what <> 'draft',
        'summary', jsonb_strip_nulls(jsonb_build_object(
          'what', v_what,
          'status', v_data ->> 'status',
          'was', case when v_what not in ('added', 'deleted') then v_was end,
          'period', case when v_data ->> 'period' ~ '^\d{4}-\d{2}$' then v_data ->> 'period' end
        ))
      );
    end if;
    return jsonb_build_object('important', false, 'summary', jsonb_build_object('what', v_what));
  end if;

  -- The customer or vendor a document, payment or cheque is for.
  if p_tbl in ('documents', 'payments', 'securityCheques')
    and coalesce(v_data ->> 'clientId', '') <> '' then
    select c.data ->> 'name', c.data ->> 'nameAr' into v_client, v_client_ar
    from public.records c
    where c.company_id = p_company and c.tbl = 'clients' and c.id = v_data ->> 'clientId';
  end if;

  if p_tbl = 'documents' then
    v_was := case when p_old is not null then almailbooks.document_stage(p_old ->> 'status') end;
    v_now := case when p_new is not null then almailbooks.document_stage(p_new ->> 'status') end;
    if p_old is not null and p_new is not null then
      v_what := case
        when v_now = 'void' and v_was <> 'void' then 'voided'
        when v_was = 'void' and v_now <> 'void' then 'restored'
        when v_was = 'draft' and v_now = 'issued' then 'issued'
        when v_was = 'issued' and v_now = 'issued'
          and almailbooks.invoice_content(p_old) is distinct from almailbooks.invoice_content(p_new)
          then 'edited'
        else 'updated'
      end;
    end if;
    v_important := coalesce(v_data ->> 'type', '') in ('invoice', 'credit') and (
      v_what in ('voided', 'restored', 'edited')
      or (v_what = 'deleted' and v_was <> 'draft')
    );
    v_summary := jsonb_build_object(
      'what', v_what,
      'type', v_data ->> 'type',
      'number', v_data ->> 'number',
      'status', v_data ->> 'status',
      'was', case
        when p_old is not null and p_new is not null
          and (p_old ->> 'status') is distinct from (p_new ->> 'status') then p_old ->> 'status'
      end,
      'total', case when jsonb_typeof(v_data -> 'totals' -> 'total') = 'number'
        then v_data -> 'totals' -> 'total' end,
      'currency', v_data ->> 'currency',
      'client', v_client,
      'clientAr', v_client_ar
    );
  elsif p_tbl = 'payments' then
    v_cheque := coalesce(p_new ->> 'method', '') = 'cheque' or coalesce(p_old ->> 'method', '') = 'cheque';
    v_was := p_old -> 'cheque' ->> 'status';
    v_now := p_new -> 'cheque' ->> 'status';
    if p_old is not null and p_new is not null then
      v_what := case
        when v_cheque
          and almailbooks.cheque_content(p_old) is distinct from almailbooks.cheque_content(p_new)
          then 'edited'
        when v_cheque and v_now is not null and v_now is distinct from v_was then v_now
        when coalesce(p_new ->> 'voided', '') = 'true' and coalesce(p_old ->> 'voided', '') <> 'true'
          then 'voided'
        when (p_old -> 'amount') is distinct from (p_new -> 'amount')
          or (p_old -> 'currency') is distinct from (p_new -> 'currency')
          or (p_old -> 'date') is distinct from (p_new -> 'date')
          or (p_old -> 'clientId') is distinct from (p_new -> 'clientId')
          then 'edited'
        else 'updated'
      end;
    end if;
    v_important := v_cheque
      and v_what in ('added', 'deleted', 'edited', 'voided', 'returned', 'cancelled');
    v_summary := jsonb_build_object(
      'what', v_what,
      'direction', coalesce(v_data ->> 'direction', 'in'),
      'method', v_data ->> 'method',
      'number', v_data ->> 'number',
      'amount', case when jsonb_typeof(v_data -> 'amount') = 'number' then v_data -> 'amount' end,
      'currency', v_data ->> 'currency',
      'cheque', v_data -> 'cheque' ->> 'number',
      'bank', v_data -> 'cheque' ->> 'bank',
      'status', v_data -> 'cheque' ->> 'status',
      'was', case when v_what = v_now then v_was end,
      'client', v_client,
      'clientAr', v_client_ar
    );
  elsif p_tbl = 'securityCheques' then
    v_was := p_old ->> 'status';
    v_now := p_new ->> 'status';
    if p_old is not null and p_new is not null then
      v_what := case
        when almailbooks.security_cheque_content(p_old)
          is distinct from almailbooks.security_cheque_content(p_new) then 'edited'
        when v_now is not null and v_now is distinct from v_was then v_now
        else 'updated'
      end;
    end if;
    v_important := v_what in ('added', 'deleted', 'edited', 'cashed');
    v_summary := jsonb_build_object(
      'what', v_what,
      'direction', coalesce(v_data ->> 'direction', 'in'),
      'cheque', v_data ->> 'number',
      'bank', v_data ->> 'bank',
      'amount', case when jsonb_typeof(v_data -> 'amount') = 'number' then v_data -> 'amount' end,
      'currency', v_data ->> 'currency',
      'status', v_data ->> 'status',
      'was', case when v_what = v_now then v_was end,
      'client', v_client,
      'clientAr', v_client_ar
    );
  elsif p_tbl = 'approvals' then
    v_was := coalesce(p_old ->> 'status', 'pending');
    v_now := coalesce(p_new ->> 'status', 'pending');
    if p_old is null then
      v_what := 'requested';
    elsif p_new is not null and v_now <> v_was then
      v_what := v_now;
    end if;
    v_important := v_what in ('requested', 'approved', 'rejected');
    v_summary := jsonb_build_object(
      'what', v_what,
      'request', v_data ->> 'kind',
      'subject', v_data ->> 'subjectTbl',
      'number', v_data ->> 'subjectNumber',
      'status', v_now
    );
  elsif p_tbl = 'companies' then
    if p_old is not null and p_new is not null then
      if not almailbooks.counters_only(p_old -> 'numbering', p_new -> 'numbering') then
        v_changes := v_changes || 'numbering'::text;
      end if;
      if nullif(p_old -> 'accounting' -> 'lockDate', 'null'::jsonb)
        is distinct from nullif(p_new -> 'accounting' -> 'lockDate', 'null'::jsonb) then
        v_changes := v_changes || 'lockDate'::text;
      end if;
      if nullif(p_old -> 'approvalRules', 'null'::jsonb)
        is distinct from nullif(p_new -> 'approvalRules', 'null'::jsonb) then
        v_changes := v_changes || 'approvalRules'::text;
      end if;
      v_old_rest := p_old - 'numbering' - 'updatedAt' - 'approvalRules' - 'accounting';
      v_new_rest := p_new - 'numbering' - 'updatedAt' - 'approvalRules' - 'accounting';
      if cardinality(v_changes) = 0
        and v_old_rest is not distinct from v_new_rest
        and (
          case when jsonb_typeof(p_old -> 'accounting') = 'object'
            then (p_old -> 'accounting') - 'lockDate' else p_old -> 'accounting' end
        ) is not distinct from (
          case when jsonb_typeof(p_new -> 'accounting') = 'object'
            then (p_new -> 'accounting') - 'lockDate' else p_new -> 'accounting' end
        ) then
        -- Only a document counter moved on (every new invoice does that).
        return null;
      end if;
    end if;
    v_important := cardinality(v_changes) > 0;
    v_summary := jsonb_build_object(
      'what', 'settings',
      'changes', to_jsonb(v_changes),
      'lockDate', case when 'lockDate' = any (v_changes) then p_new -> 'accounting' ->> 'lockDate' end,
      'was', case when 'lockDate' = any (v_changes) then p_old -> 'accounting' ->> 'lockDate' end
    );
  elsif p_tbl = 'clients' then
    v_summary := jsonb_build_object(
      'what', v_what,
      'name', v_data ->> 'name',
      'nameAr', v_data ->> 'nameAr',
      'vendor', case when v_data ->> 'isVendor' = 'true' then true end
    );
  elsif p_tbl = 'products' then
    v_summary := jsonb_build_object(
      'what', v_what, 'name', v_data ->> 'name', 'nameAr', v_data ->> 'nameAr', 'sku', v_data ->> 'sku'
    );
  elsif p_tbl in ('expenses', 'journals') then
    v_summary := jsonb_build_object(
      'what', v_what,
      'number', v_data ->> 'number',
      'amount', case when p_tbl = 'expenses' and jsonb_typeof(v_data -> 'amount') = 'number'
        then v_data -> 'amount' end,
      'currency', case when p_tbl = 'expenses' then v_data ->> 'currency' end
    );
  elsif p_tbl = 'vehicles' then
    v_summary := jsonb_build_object('what', v_what, 'name', v_data ->> 'plate');
  elsif p_tbl = 'complianceDocuments' then
    v_summary := jsonb_build_object('what', v_what, 'name', v_data ->> 'title', 'type', v_data ->> 'type');
  elsif p_tbl = 'attachments' then
    v_summary := jsonb_build_object('what', v_what, 'name', v_data ->> 'name');
  else
    v_summary := jsonb_build_object('what', v_what);
  end if;
  return jsonb_build_object('important', v_important, 'summary', jsonb_strip_nulls(v_summary));
end
$$;

-- Each change of a record goes to the feed, once someone of the company has
-- asked for it (Settings → Email alerts → Changes by your team). The author
-- is the signed-in account. Unchanged copies sent again, the activity log
-- (the app's own record of the same changes), the server's own jobs and a
-- company being deleted are left out. Anything that goes wrong here is
-- ignored: it never stops a sync.
create or replace function almailbooks.records_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_company text;
  v_tbl text;
  v_id text;
  v_old jsonb;
  v_new jsonb;
  v_data jsonb;
  v_private boolean;
  v_kind text;
  v_details jsonb;
  v_important boolean;
  v_fold text;
begin
  begin
    v_actor := auth.uid();
    if v_actor is null then
      return null;
    end if;
    if tg_op = 'DELETE' then
      v_company := old.company_id;
      v_tbl := old.tbl;
      v_id := old.id;
      v_old := old.data;
    else
      v_company := new.company_id;
      v_tbl := new.tbl;
      v_id := new.id;
      v_new := new.data;
      if tg_op = 'UPDATE' then
        v_old := old.data;
      end if;
    end if;
    if v_tbl = 'activities'
      or (tg_op = 'UPDATE' and v_old = v_new)
      or current_setting('almailbooks.deleting_company', true) = v_company then
      return null;
    end if;
    if not exists (
      select 1 from public.notification_settings s where s.company_id = v_company and s.enabled
    ) then
      return null;
    end if;

    v_data := coalesce(v_new, v_old);
    v_private := almailbooks.record_is_private(v_company, v_tbl, v_data)
      or (tg_op = 'UPDATE' and almailbooks.record_is_private(v_company, v_tbl, v_old));
    v_kind := almailbooks.change_kind(v_tbl, v_data);
    if v_tbl = 'payments' and v_kind = 'payment' and coalesce(v_old ->> 'method', '') = 'cheque' then
      v_kind := 'cheque';
    end if;
    v_details := almailbooks.change_details(v_company, v_tbl, v_old, v_new, v_private);
    if v_details is null then
      return null;
    end if;
    v_important := coalesce((v_details ->> 'important')::boolean, false);
    v_fold := case
      when v_important then 'one:' || gen_random_uuid()::text
      else concat_ws(
        ':', 'tx', txid_current()::text, v_actor::text, v_tbl,
        case when v_tbl = 'documents' then coalesce(v_data ->> 'type', '') else '' end,
        v_kind, v_private::text
      )
    end;
    insert into public.change_events as e
      (company_id, actor, op, tbl, record_id, kind, important, private, count, fold_key, summary)
    values (
      v_company, v_actor, lower(tg_op), v_tbl, v_id, v_kind, v_important, v_private, 1, v_fold,
      coalesce(v_details -> 'summary', '{}'::jsonb)
    )
    on conflict (company_id, fold_key) do update
      set count = e.count + 1,
          op = case when e.op = excluded.op then e.op else 'mixed' end,
          record_id = excluded.record_id,
          summary = excluded.summary;
  exception when others then
    -- The feed is a convenience: the change itself is stored as before.
    null;
  end;
  return null;
end
$$;

drop trigger if exists records_change_event on public.records;
create trigger records_change_event
  after insert or update or delete on public.records
  for each row execute function almailbooks.records_change_event();

-- A company's changes are numbered in the order they are stored: the number
-- is taken once the company's write lock is held (as records take their
-- rev), so the email-alerts function and "read up to" never pass over a
-- change that is stored a moment later with a lower number.
create or replace function almailbooks.change_events_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform almailbooks.lock_company(new.company_id);
  new.id := nextval('public.change_events_id_seq');
  new.at := now();
  return new;
end
$$;

drop trigger if exists change_events_before_insert on public.change_events;
create trigger change_events_before_insert
  before insert on public.change_events
  for each row execute function almailbooks.change_events_before_insert();

-- Whoever stops being the owner or an approver stops getting the changes;
-- whoever leaves loses their settings (foreign key). Never stops a team change.
create or replace function almailbooks.notification_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if not (
      new.role = 'owner' or (new.can_approve and new.role in ('admin', 'accountant'))
    ) then
      update public.notification_settings s
      set enabled = false, updated_at = now()
      where s.company_id = new.company_id and s.user_id = new.user_id and s.enabled;
    end if;
  exception when others then
    null;
  end;
  return null;
end
$$;

drop trigger if exists notification_member_changed on public.company_members;
create trigger notification_member_changed
  after update of role, can_approve on public.company_members
  for each row execute function almailbooks.notification_member_changed();

-- Called every 5 minutes by the schedule: asks the email-alerts function to
-- email what is due, only when someone who wants the changes has new ones.
-- Returns pg_net's request id, or null when there is nothing to do.
create or replace function almailbooks.run_change_notifications()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- The email alerts script keeps where the function is.
  if to_regclass('almailbooks.email_alerts_config') is null then
    return null;
  end if;
  execute 'select c.function_url, c.secret from almailbooks.email_alerts_config c where c.id'
    into v_url, v_secret;
  if coalesce(v_url, '') = '' then
    return null;
  end if;
  if not exists (
    select 1
    from public.notification_settings s
    where s.enabled
      and (s.claimed_until is null or s.claimed_until < now())
      and exists (
        select 1
        from public.change_events e
        where e.company_id = s.company_id
          and e.id > s.emailed_upto
          and e.actor is distinct from s.user_id
      )
  ) then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'notify'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alerts-secret', v_secret),
    timeout_milliseconds := 120000
  );
end
$$;

-- Changes are kept 180 days.
create or replace function almailbooks.purge_change_events()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.change_events e where e.at < now() - interval '180 days'
$$;

-- The app's functions ---------------------------------------------------------------

-- Whether the signed-in person gets the changes of the team, how many they
-- haven't read and the newest one they may see. Everyone but the owner and
-- approvers gets "off".
create or replace function public.notification_status(p_company text)
returns table (enabled boolean, unread bigint, latest bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_role public.member_role := almailbooks.member_role(p_company);
  v_enabled boolean;
  v_read bigint;
begin
  if v_role is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  if not almailbooks.is_approver(p_company) then
    return query select false, 0::bigint, 0::bigint;
    return;
  end if;
  select s.enabled into v_enabled
  from public.notification_settings s
  where s.company_id = p_company and s.user_id = auth.uid();
  select r.read_upto into v_read
  from public.notification_reads r
  where r.company_id = p_company and r.user_id = auth.uid();
  return query
    select
      coalesce(v_enabled, false),
      (
        select count(*)
        from (
          select 1
          from public.change_events e
          where e.company_id = p_company
            and e.id > coalesce(v_read, 0)
            and e.actor is distinct from auth.uid()
            and (not e.private or v_role in ('owner', 'admin', 'accountant'))
          limit 100
        ) unread
      ),
      coalesce((
        select max(e.id)
        from public.change_events e
        where e.company_id = p_company
          and e.actor is distinct from auth.uid()
          and (not e.private or v_role in ('owner', 'admin', 'accountant'))
      ), 0);
end
$$;

-- The changes of the team, newest first, for the owner and approvers: after
-- p_after, before p_before (both optional), at most p_limit (up to 200).
-- Their own changes are left out; private ones only reach owners, admins
-- and accountants (as every approver is).
create or replace function public.notification_feed(
  p_company text,
  p_after bigint default 0,
  p_before bigint default null,
  p_limit integer default 50
)
returns table (
  id bigint,
  at timestamptz,
  actor uuid,
  actor_name text,
  subject_name text,
  kind text,
  op text,
  tbl text,
  record_id text,
  count integer,
  important boolean,
  private boolean,
  summary jsonb,
  unread boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_role public.member_role := almailbooks.member_role(p_company);
  v_read bigint;
begin
  if v_role is null or not almailbooks.is_approver(p_company) then
    raise exception 'almail:permission Only the owner and the members allowed to approve see the changes of the team.'
      using errcode = '42501';
  end if;
  select r.read_upto into v_read
  from public.notification_reads r
  where r.company_id = p_company and r.user_id = auth.uid();
  return query
    select
      e.id,
      e.at,
      e.actor,
      coalesce(nullif(btrim(p.full_name), ''), p.email, ''),
      case when e.kind = 'member'
        then coalesce(nullif(btrim(sp.full_name), ''), sp.email, '') else '' end,
      e.kind,
      e.op,
      e.tbl,
      e.record_id,
      e.count,
      e.important,
      e.private,
      e.summary,
      e.id > coalesce(v_read, 0)
    from public.change_events e
    left join public.profiles p on p.id = e.actor
    left join public.profiles sp on e.kind = 'member' and sp.id::text = e.summary ->> 'user'
    where e.company_id = p_company
      and e.id > greatest(coalesce(p_after, 0), 0)
      and (p_before is null or e.id < p_before)
      and e.actor is distinct from auth.uid()
      and (not e.private or v_role in ('owner', 'admin', 'accountant'))
    order by e.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Marks the changes up to p_upto as read (never back).
create or replace function public.mark_notifications_read(p_company text, p_upto bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max bigint;
begin
  if not almailbooks.is_approver(p_company) then
    raise exception 'almail:permission Only the owner and the members allowed to approve see the changes of the team.'
      using errcode = '42501';
  end if;
  select coalesce(max(e.id), 0) into v_max from public.change_events e where e.company_id = p_company;
  insert into public.notification_reads as r (company_id, user_id, read_upto)
  values (p_company, auth.uid(), greatest(0, least(coalesce(p_upto, 0), v_max)))
  on conflict (company_id, user_id) do update
    set read_upto = greatest(r.read_upto, excluded.read_upto), updated_at = now();
end
$$;

-- The signed-in person's choice for the changes of the team, always one row
-- (the defaults until saved), and whether the email-alerts function has run.
create or replace function public.change_notification_settings(p_company text)
returns table (
  enabled boolean,
  immediate_kinds text[],
  digest text,
  last_sent_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  function_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ready boolean := false;
begin
  if not almailbooks.is_approver(p_company) then
    raise exception 'almail:permission Only the owner and the members allowed to approve get the changes of the team.'
      using errcode = '42501';
  end if;
  if to_regclass('almailbooks.email_alerts_config') is not null then
    execute 'select c.function_url <> '''' from almailbooks.email_alerts_config c where c.id'
      into v_ready;
  end if;
  return query
    select
      coalesce(s.enabled, false),
      coalesce(s.immediate_kinds, array['document', 'cheque', 'approval', 'member', 'settings', 'people']),
      coalesce(s.digest, 'daily'),
      s.last_sent_at,
      coalesce(s.last_error, ''),
      s.last_error_at,
      coalesce(v_ready, false)
    from (select 1) one
    left join public.notification_settings s
      on s.company_id = p_company and s.user_id = auth.uid();
end
$$;

-- Turns the changes of the team on or off for the signed-in person (the
-- owner or an approver), with what is emailed at once and the daily summary.
-- Turned on, it starts from now: nothing earlier is emailed.
create or replace function public.set_change_notifications(
  p_company text,
  p_enabled boolean,
  p_immediate_kinds text[],
  p_digest text,
  p_app_url text
)
returns table (
  enabled boolean,
  immediate_kinds text[],
  digest text,
  last_sent_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  function_ready boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_all text[] := array['document', 'cheque', 'approval', 'member', 'settings', 'people'];
  v_kinds text[];
  v_digest text := coalesce(p_digest, 'daily');
  v_url text := btrim(coalesce(p_app_url, ''));
  v_latest bigint;
  v_was boolean;
begin
  if not almailbooks.is_approver(p_company) then
    raise exception 'almail:permission Only the owner and the members allowed to approve get the changes of the team.'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_immediate_kinds, '{}'::text[])) k where k is null or not k = any (v_all)
  ) then
    raise exception 'almail:invalid Unknown kind of change.' using errcode = '22023';
  end if;
  if v_digest not in ('daily', 'off') then
    raise exception 'almail:invalid Unknown summary.' using errcode = '22023';
  end if;
  -- In the usual order, without repeats.
  select coalesce(array_agg(k order by array_position(v_all, k)), '{}'::text[]) into v_kinds
  from (select distinct k from unnest(coalesce(p_immediate_kinds, '{}'::text[])) k) chosen;
  if v_url <> '' and (v_url !~ '^https?://[^[:space:]"''<>]+$' or char_length(v_url) > 300) then
    v_url := '';
  end if;
  select coalesce(max(e.id), 0) into v_latest from public.change_events e where e.company_id = p_company;
  select s.enabled into v_was
  from public.notification_settings s
  where s.company_id = p_company and s.user_id = auth.uid();

  insert into public.notification_settings as s
    (company_id, user_id, enabled, immediate_kinds, digest, app_url, emailed_upto)
  values (p_company, auth.uid(), coalesce(p_enabled, false), v_kinds, v_digest, v_url, v_latest)
  on conflict (company_id, user_id) do update
    set enabled = excluded.enabled,
        immediate_kinds = excluded.immediate_kinds,
        digest = excluded.digest,
        app_url = case when excluded.app_url <> '' then excluded.app_url else s.app_url end,
        updated_at = now(),
        -- Turned on again: from now on.
        emailed_upto = case when s.enabled then s.emailed_upto else excluded.emailed_upto end,
        digest_on = case when s.enabled then s.digest_on else null end,
        send_key = case when s.enabled then s.send_key else null end,
        send_upto = case when s.enabled then s.send_upto else null end,
        last_error = case when excluded.enabled then s.last_error else '' end,
        last_error_at = case when excluded.enabled then s.last_error_at else null end;
  -- Turned on: what happened before (the team's own record of who joined,
  -- say) is there to read, but not new.
  if coalesce(p_enabled, false) and not coalesce(v_was, false) then
    insert into public.notification_reads as r (company_id, user_id, read_upto)
    values (p_company, auth.uid(), v_latest)
    on conflict (company_id, user_id) do update
      set read_upto = greatest(r.read_upto, excluded.read_upto), updated_at = now();
  end if;

  return query select * from public.change_notification_settings(p_company);
end
$$;

-- What this server has beyond the first files: as the Super Admin file
-- says, and change_feed this one.
create or replace function public.server_features()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array['tables_v16', 'super_admin', 'approvals', 'cheque_approvals', 'change_feed']::text[]
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.change_kind(text, jsonb),
  almailbooks.change_details(text, text, jsonb, jsonb, boolean),
  almailbooks.records_change_event(),
  almailbooks.change_events_before_insert(),
  almailbooks.notification_member_changed(),
  almailbooks.run_change_notifications(),
  almailbooks.purge_change_events()
from public, anon, authenticated;

revoke all on function
  public.notification_status(text),
  public.notification_feed(text, bigint, bigint, integer),
  public.mark_notifications_read(text, bigint),
  public.change_notification_settings(text),
  public.set_change_notifications(text, boolean, text[], text, text),
  public.server_features()
from public, anon;
grant execute on function
  public.notification_status(text),
  public.notification_feed(text, bigint, bigint, integer),
  public.mark_notifications_read(text, bigint),
  public.change_notification_settings(text),
  public.set_change_notifications(text, boolean, text[], text, text),
  public.server_features()
to authenticated;

-- The schedule ------------------------------------------------------------------------

-- Every 5 minutes; a run with nothing new ends at once. And the daily
-- clean-up of changes older than 180 days.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron')
    or not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    raise notice 'This database has no pg_cron or pg_net: change notifications are not emailed.';
    return;
  end if;
  create extension if not exists pg_net;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule(
    'maham-change-notifications',
    '*/5 * * * *',
    'select almailbooks.run_change_notifications()'
  );
  perform cron.schedule(
    'maham-change-feed-purge',
    '47 2 * * *',
    'select almailbooks.purge_change_events()'
  );
end
$$;

-- The Data API learns about the new functions at once.
notify pgrst, 'reload schema';
