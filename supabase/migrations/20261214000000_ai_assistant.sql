-- =============================================================================
-- Maham One cloud: the AI assistant's switch is the owner's and the admins'
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261207000000_staffing_costings.sql. It is safe to
-- run again, and nothing else needs running again after it.
--
-- Until it runs, the app keeps working as before: only its Settings → AI
-- assistant page (and the device's own check before it syncs) keeps the
-- switch for the owner and the admins.
--
-- What it adds
--   * The company's AI assistant switch ("ai" on the company record, Settings
--     → AI assistant) is changed by the owner or an admin only. Anyone else's
--     copy of the company record keeps it as it is stored, by a push or
--     patch_company alike: a copy that hasn't heard of the switch never turns
--     it off, and nobody else turns it on. As the letters switch of the People
--     settings (records_guard in 20261130000000_people_alerts.sql). An admin
--     the owner made Maham Books or Maham People view only for still changes
--     it: it is not a setting of the books.
--   * A trigger of its own on public.records, records_guard_ai, run after
--     records_guard (triggers of the same kind run in the order of their
--     names). No function of an earlier file is replaced.
-- =============================================================================

do $$
begin
  if to_regprocedure('almailbooks.kept_key(jsonb,jsonb,text)') is null
    or to_regprocedure('almailbooks.records_guard()') is null then
    raise exception 'Run 20261116000000_super_admin_approvals.sql and the files after it first, then this file.';
  end if;
end
$$;

-- What is stored when someone writes the company record: the AI assistant's
-- switch as it was stored (or left out, as it was) unless they are the owner
-- or an admin. The SQL editor and the server's own jobs are not members.
create or replace function almailbooks.records_guard_ai()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tbl <> 'companies' or auth.uid() is null then
    return new;
  end if;
  -- An upsert runs this as an insert before it turns into an update: a
  -- record that is already there is checked as the update.
  if tg_op = 'INSERT' and exists (
    select 1
    from public.records r
    where r.company_id = new.company_id and r.tbl = new.tbl and r.id = new.id
  ) then
    return new;
  end if;
  if coalesce(almailbooks.member_role(new.company_id)::text, '') not in ('owner', 'admin') then
    new.data := almailbooks.kept_key(
      new.data,
      case when tg_op = 'UPDATE' then old.data end,
      'ai'
    );
  end if;
  return new;
end
$$;

drop trigger if exists records_guard_ai on public.records;
create trigger records_guard_ai
  before insert or update on public.records
  for each row execute function almailbooks.records_guard_ai();

-- Who may run what ------------------------------------------------------------------

revoke all on function almailbooks.records_guard_ai() from public, anon, authenticated;
