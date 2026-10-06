-- =============================================================================
-- Maham Books cloud: email alerts
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261004000000_almailbooks_cloud.sql and
-- 20261006000000_sync_fixes.sql. It is safe to run again.
--
-- What it adds
--   * public.email_alerts: who gets the morning email of a company and what
--     it covers. Owners and admins turn their own on or off in the app
--     (Settings → Email alerts); the email goes to their account's address.
--     Nobody else can be added, and a person who stops being the owner or an
--     admin stops getting it.
--   * almailbooks.email_alerts_config: the address of the email-alerts
--     function (it writes it there itself the first time it runs) and a
--     random secret the schedule shows it, so nobody else can set it off.
--   * A schedule (Supabase Cron, with pg_net) that calls the function every
--     hour. The function emails each person at most once a day, from 8:00
--     Kuwait time, through Resend. See docs/email-alerts.md.
--
-- The schedule needs the pg_cron and pg_net extensions; this file turns them
-- on. It also schedules the daily clean-up of deletion markers that the
-- first file sets up only when pg_cron is already on.
-- =============================================================================

-- Tables ------------------------------------------------------------------------

create table if not exists public.email_alerts (
  company_id text not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  -- documents, deadlines, cheques, bills, invoices
  topics text[] not null default array['documents', 'deadlines', 'cheques', 'bills', 'invoices'],
  -- Where the app was opened when this was saved: the button in the email.
  app_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Kept by the email-alerts function.
  -- The last day (Kuwait time) the alerts were looked at, with or without an email.
  checked_on date,
  -- The alerts emailed so far; null until the first email, which lists everything.
  sent_keys jsonb,
  last_sent_at timestamptz,
  -- The last email asked for from the app ("Send it now"), at most one a minute.
  last_test_at timestamptz,
  last_error text not null default '',
  last_error_at timestamptz,
  -- A run is working on this one until then.
  claimed_until timestamptz,
  -- Resend's idempotency key of an email whose answer was lost (a timeout),
  -- kept so trying again can't send it twice.
  send_key text,
  primary key (company_id, user_id)
);
alter table public.email_alerts drop constraint if exists email_alerts_topics_check;
alter table public.email_alerts
  add constraint email_alerts_topics_check
  check (topics <@ array['documents', 'deadlines', 'cheques', 'bills', 'invoices']::text[]);
alter table public.email_alerts drop constraint if exists email_alerts_app_url_check;
alter table public.email_alerts
  add constraint email_alerts_app_url_check
  check (app_url = '' or (app_url ~ '^https?://[^[:space:]"''<>]+$' and char_length(app_url) <= 300));
alter table public.email_alerts drop constraint if exists email_alerts_last_error_length;
alter table public.email_alerts
  add constraint email_alerts_last_error_length check (char_length(last_error) <= 1000);
create index if not exists email_alerts_user on public.email_alerts (user_id);

-- Only the functions below read and write it.
alter table public.email_alerts enable row level security;
revoke all on public.email_alerts from public, anon, authenticated;

-- One row: where the function is, and the secret the schedule sends it.
create table if not exists almailbooks.email_alerts_config (
  id boolean primary key default true,
  function_url text not null default '',
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now(),
  constraint email_alerts_config_one_row check (id)
);
insert into almailbooks.email_alerts_config (id) values (true) on conflict (id) do nothing;
revoke all on almailbooks.email_alerts_config from public, anon, authenticated;

-- Helpers (not callable through the API) ---------------------------------------

-- Who stops being the owner or an admin (or leaves) stops getting the emails.
create or replace function almailbooks.email_alerts_member_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.email_alerts a where a.company_id = old.company_id and a.user_id = old.user_id;
    return old;
  end if;
  if new.role not in ('owner', 'admin') then
    delete from public.email_alerts a where a.company_id = new.company_id and a.user_id = new.user_id;
  end if;
  return new;
end
$$;

drop trigger if exists email_alerts_member_changed on public.company_members;
create trigger email_alerts_member_changed
  after update of role or delete on public.company_members
  for each row execute function almailbooks.email_alerts_member_changed();

-- Called every hour by the schedule: asks the function to send what is due.
-- Returns pg_net's request id (its answer is kept for a while in
-- net._http_response), or null when there is nothing to do yet.
create or replace function almailbooks.run_email_alerts()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select c.function_url, c.secret into v_url, v_secret
  from almailbooks.email_alerts_config c
  where c.id;
  -- The function hasn't run yet, so its address isn't known.
  if coalesce(v_url, '') = '' then
    return null;
  end if;
  if not exists (select 1 from public.email_alerts a where a.enabled) then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := jsonb_build_object('action', 'run'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alerts-secret', v_secret),
    timeout_milliseconds := 120000
  );
end
$$;

-- The app's functions ---------------------------------------------------------------

-- The email alerts of the signed-in person for a company: always one row,
-- with what is saved (or the defaults) and whether the function has run.
create or replace function public.email_alert_settings(p_company text)
returns table (
  enabled boolean,
  topics text[],
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
  v_ready boolean;
begin
  if almailbooks.member_role(p_company) is null then
    raise exception 'almail:not_member You are not a member of this company.' using errcode = '42501';
  end if;
  select c.function_url <> '' into v_ready from almailbooks.email_alerts_config c where c.id;
  return query
    select
      coalesce(a.enabled, false),
      coalesce(a.topics, array['documents', 'deadlines', 'cheques', 'bills', 'invoices']),
      a.last_sent_at,
      coalesce(a.last_error, ''),
      a.last_error_at,
      coalesce(v_ready, false)
    from (select 1) one
    left join public.email_alerts a on a.company_id = p_company and a.user_id = auth.uid();
end
$$;

-- Turns the signed-in person's email alerts for a company on or off. Owners
-- and admins only; the email goes to their own account's address.
create or replace function public.set_email_alerts(
  p_company text,
  p_enabled boolean,
  p_topics text[],
  p_app_url text
)
returns table (
  enabled boolean,
  topics text[],
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
  v_me public.member_role := almailbooks.member_role(p_company);
  v_all text[] := array['documents', 'deadlines', 'cheques', 'bills', 'invoices'];
  v_topics text[];
  v_url text := btrim(coalesce(p_app_url, ''));
begin
  if v_me is null or v_me not in ('owner', 'admin') then
    raise exception 'almail:permission Only the owner and admins can get email alerts.'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_topics, '{}'::text[])) t where t is null or not t = any (v_all)
  ) then
    raise exception 'almail:invalid Unknown kind of alert.' using errcode = '22023';
  end if;
  -- In the usual order, without repeats.
  select coalesce(array_agg(t order by array_position(v_all, t)), '{}'::text[]) into v_topics
  from (select distinct t from unnest(coalesce(p_topics, '{}'::text[])) t) chosen;
  if coalesce(p_enabled, false) and cardinality(v_topics) = 0 then
    raise exception 'almail:invalid Choose at least one kind of alert.' using errcode = '22023';
  end if;
  if v_url <> '' and (v_url !~ '^https?://[^[:space:]"''<>]+$' or char_length(v_url) > 300) then
    v_url := '';
  end if;

  insert into public.email_alerts as a (company_id, user_id, enabled, topics, app_url)
  values (p_company, auth.uid(), coalesce(p_enabled, false), v_topics, v_url)
  on conflict (company_id, user_id) do update
    set enabled = excluded.enabled,
        topics = excluded.topics,
        app_url = case when excluded.app_url <> '' then excluded.app_url else a.app_url end,
        updated_at = now(),
        -- Turned on again: the next email lists everything again.
        sent_keys = case when a.enabled then a.sent_keys else null end,
        checked_on = case when a.enabled then a.checked_on else null end,
        last_error = case when excluded.enabled then a.last_error else '' end,
        last_error_at = case when excluded.enabled then a.last_error_at else null end;

  return query select * from public.email_alert_settings(p_company);
end
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.email_alerts_member_changed(),
  almailbooks.run_email_alerts()
from public, anon, authenticated;

revoke all on function
  public.email_alert_settings(text),
  public.set_email_alerts(text, boolean, text[], text)
from public, anon;
grant execute on function
  public.email_alert_settings(text),
  public.set_email_alerts(text, boolean, text[], text)
to authenticated;

-- The schedule ------------------------------------------------------------------------

-- Every hour at :07. The function emails each person at most once a day,
-- from 8:00 Kuwait time (05:00 UTC); a run with nothing due ends at once, and
-- a failed email is tried again the next hour.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron')
    or not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    raise notice 'This database has no pg_cron or pg_net: email alerts are not scheduled.';
    return;
  end if;
  create extension if not exists pg_net;
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule(
    'maham-books-email-alerts',
    '7 * * * *',
    'select almailbooks.run_email_alerts()'
  );
  -- The first file schedules this only when pg_cron was already on.
  perform cron.schedule(
    'almailbooks-purge-deleted-records',
    '17 3 * * *',
    'select almailbooks.purge_all_deleted_records()'
  );
end
$$;

-- The Data API learns about the new functions at once.
notify pgrst, 'reload schema';
