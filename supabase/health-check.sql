-- =============================================================================
-- Maham One cloud: health check (read-only)
-- =============================================================================
--
-- Paste this whole file into the Supabase SQL editor and press Run, as often
-- as you like: after running a script, or any time to see that all is well.
-- It changes nothing in the database.
--
-- It reads the database's own description (tables, columns, functions,
-- triggers, row-level security rules, grants, Storage rules, schedules) and
-- counts rows. It never shows names, email addresses, phone numbers, Civil
-- IDs, salaries, IBANs, keys, secrets or what any record says: only counts,
-- yes or no, versions, names of database objects and statuses.
--
-- How it stays read-only: it makes five helper functions that live only for
-- this connection (in pg_temp; they are gone when the connection closes), and
-- the check first turns the transaction read-only, so nothing it does can
-- write, even by mistake.
--
-- The answer is one table, one row per check, in the order of the scripts:
--   step    the script (1 to 8, as below) or the part that is checked
--   check   what is checked
--   status  OK       as it should be
--           MISSING  the script has not run yet: run it (the detail says which, in which order)
--           WARN     works, but something optional is off or worth a look
--           FAIL     broken, or an older version is in place: the detail says what to do
--   detail  what was found, and what to do
-- The last row sums it up: "All good", or how many FAIL, MISSING and WARN,
-- with the scripts to run, in order. If the SQL editor shows only the first
-- 100 rows, it still fits: there are fewer.
--
-- The scripts, in the order they run (supabase/migrations/):
--   1  20261004000000_almailbooks_cloud.sql       first setup: never run it again
--   2  20261006000000_sync_fixes.sql              set-up
--   3  20261007000000_email_alerts.sql            set-up (email alerts, optional)
--   4  20261102000000_tables_v16.sql              Phases 0-2
--   5  20261116000000_super_admin_approvals.sql   Phase 3
--   6  20261123000000_change_feed.sql             Phase 3
--   7  20261130000000_people_alerts.sql           Phase 4
--   8  20261207000000_staffing_costings.sql       Phase 5
--
-- For developers: a new script needs its objects added to the lists below;
-- src/cloud/health-check-sql.test.ts compares the lists with the scripts.
-- =============================================================================

-- Script p_script, run again, puts back its own version of what later scripts
-- replace: these are the scripts to run so that everything is current again
-- (itself, then each later one that replaces something of it, in turn).
create or replace function pg_temp.maham_closure(p_script integer)
returns integer[]
language sql
immutable
as $$
  select case p_script
    when 1 then array[1]
    when 2 then array[2]
    when 3 then array[3, 7, 8]
    when 4 then array[4, 8]
    when 5 then array[5, 7, 8]
    when 6 then array[6, 7, 8]
    when 7 then array[7, 8]
    when 8 then array[8]
    else array[]::integer[]
  end
$$;

-- "Run X again, then Y (in this order)." for some scripts; again for the
-- ones that have run before.
create or replace function pg_temp.maham_advice(p_scripts integer[], p_ran boolean[])
returns text
language sql
immutable
as $$
  select case
    when count(*) = 0 then ''
    else 'Run ' || string_agg(
        (array[
          '20261004000000_almailbooks_cloud.sql', '20261006000000_sync_fixes.sql',
          '20261007000000_email_alerts.sql', '20261102000000_tables_v16.sql',
          '20261116000000_super_admin_approvals.sql', '20261123000000_change_feed.sql',
          '20261130000000_people_alerts.sql', '20261207000000_staffing_costings.sql'
        ])[d.s] || case when coalesce(p_ran[d.s], false) then ' again' else '' end,
        ', then ' order by d.s
      ) || case when count(*) > 1 then ' (in this order).' else '.' end
  end
  from (select distinct s from unnest(p_scripts) as u(s) where s between 1 and 8) as d
$$;

-- One more row of the answer.
create or replace function pg_temp.maham_row(
  p_rows jsonb,
  p_n integer,
  p_step text,
  p_check text,
  p_status text,
  p_detail text,
  p_fix integer[] default null,
  p_manual boolean default null
)
returns jsonb
language sql
immutable
as $$
  -- fix: the scripts to run; manual: a FAIL that needs more than a script.
  select p_rows || jsonb_build_array(jsonb_build_object(
    'n', p_n,
    'step', p_step,
    'check', p_check,
    'status', p_status,
    'detail', p_detail,
    'fix', to_jsonb(coalesce(p_fix, array[]::integer[])),
    'manual', coalesce(p_manual, p_status = 'FAIL' and coalesce(cardinality(p_fix), 0) = 0)
  ))
$$;

-- The last row: "All good", or how many FAIL, MISSING and WARN, with the
-- scripts to run, in order.
create or replace function pg_temp.maham_summary(p_rows jsonb, p_ran boolean[])
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_fail integer;
  v_missing integer;
  v_warn integer;
  v_manual integer;
  v_fix integer[];
  v_text text := '';
begin
  select
    count(*) filter (where x ->> 'status' = 'FAIL'),
    count(*) filter (where x ->> 'status' = 'MISSING'),
    count(*) filter (where x ->> 'status' = 'WARN'),
    count(*) filter (where x ->> 'status' = 'FAIL' and (x ->> 'manual')::boolean)
  into v_fail, v_missing, v_warn, v_manual
  from jsonb_array_elements(p_rows) as x;
  v_fix := array(
    select distinct f.s::integer
    from jsonb_array_elements(p_rows) as x, jsonb_array_elements_text(x -> 'fix') as f(s)
    where x ->> 'status' in ('FAIL', 'MISSING')
    order by 1
  );
  if v_fail + v_missing + v_warn = 0 then
    return pg_temp.maham_row(p_rows, 1200, '12. Summary', 'All good', 'OK',
      'Every script has run, each as its latest version, and everything checked works.');
  end if;
  if cardinality(v_fix) > 0 then
    v_text := pg_temp.maham_advice(v_fix, p_ran) || ' Then run this check again.';
  end if;
  if v_manual > 0 then
    v_text := v_text || case when v_text = '' then '' else ' ' end
      || format('%s FAIL %s more than a script: read %s.', v_manual,
        case when v_manual = 1 then 'row needs' else 'rows need' end,
        case when v_manual = 1 then 'it' else 'them' end);
  end if;
  if v_warn > 0 then
    v_text := v_text || case when v_text = '' then '' else ' ' end
      || case
        when v_fail + v_missing > 0 then ''
        when coalesce(p_ran[3], false) then 'Every script has run. '
        else 'Every script but the optional email alerts has run. '
      end
      || 'The WARN rows say what is off and what to do; nothing in them stops the app.';
  end if;
  return pg_temp.maham_row(p_rows, 1200, '12. Summary',
    array_to_string(array_remove(array[
      case when v_fail > 0 then v_fail || ' FAIL' end,
      case when v_missing > 0 then v_missing || ' MISSING' end,
      case when v_warn > 0 then v_warn || ' WARN' end
    ], null), ', '),
    case when v_fail > 0 then 'FAIL' when v_missing > 0 then 'MISSING' else 'WARN' end,
    v_text);
end
$$;

create or replace function pg_temp.maham_health_check()
returns table (o_n integer, o_step text, o_check text, o_status text, o_detail text)
language plpgsql
set search_path = pg_catalog
as $hc$
#variable_conflict use_column
declare
  v_steps constant text[] := array[
    '1. First setup: almailbooks_cloud', '2. Set-up: sync_fixes', '3. Set-up: email_alerts',
    '4. Phase 0-2: tables_v16', '5. Phase 3: super_admin_approvals', '6. Phase 3: change_feed',
    '7. Phase 4: people_alerts', '8. Phase 5: staffing_costings', '9. Schedules (pg_cron)',
    '10. Email alerts set-up', '11. Data and privacy', '12. Summary'
  ];
  -- What public.server_features() answers once every script has run: the
  -- names the app knows (ServerFeature in src/cloud/features.ts).
  v_app_features constant text[] := array[
    'tables_v16', 'super_admin', 'approvals', 'cheque_approvals', 'change_feed',
    'payroll_approvals', 'document_alerts', 'employee_letters', 'staffing_costings'
  ];
  -- Every kind of record the app syncs (DATA_TABLES in src/db/db.ts).
  v_kinds constant text[] := array[
    'companies', 'clients', 'products', 'taxRates', 'documents', 'payments', 'recurring',
    'activities', 'accounts', 'journals', 'expenses', 'attachments', 'vatReturns',
    'bankTransactions', 'employees', 'complianceDocuments', 'renewals', 'complianceMarks',
    'peopleSettings', 'securityCheques', 'assets', 'depreciationRuns', 'yearEnds', 'payRuns',
    'payrollSettings', 'leaveRecords', 'staffLoans', 'finalSettlements', 'warehouses',
    'stockMovements', 'stockEntries', 'landedCosts', 'chequeLayouts', 'vehicles', 'approvals',
    'letterTemplates', 'employeeLetters', 'staffingCostings'
  ];
  -- The kinds 20261102000000_tables_v16.sql adds.
  v_v16_kinds constant text[] := array[
    'chequeLayouts', 'vehicles', 'approvals', 'letterTemplates', 'employeeLetters'
  ];
  -- Payroll and people data, which staff and viewers never read
  -- (PEOPLE_TABLES in src/cloud/roles.ts).
  v_private_kinds constant text[] := array[
    'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
    'finalSettlements', 'letterTemplates', 'employeeLetters', 'staffingCostings'
  ];
  v_ran boolean[];
  v_rows jsonb := '[]'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_anon boolean;
  v_auth boolean;
  v_s integer;
  v_n integer;
  v_fix integer[];
  v_text text;
  v_label text;
  v_status text;
  g record;
  v_job record;
  -- Kinds of record, server_features(), record_is_private.
  v_condef text;
  v_convalid boolean;
  v_allowed text[];
  v_features text[];
  v_features_ok boolean;
  v_kind text;
  v_bool boolean;
  v_problem text;
  v_private_bad text[] := '{}';
  -- Schedules.
  v_cron boolean;
  v_net boolean;
  v_cron_version text;
  v_net_version text;
  v_jobid bigint;
  v_sched text;
  v_cmd text;
  v_active boolean;
  v_run_status text;
  v_run_at timestamptz;
  -- Counts.
  v_a bigint;
  v_b bigint;
  v_c bigint;
  v_d bigint;
  v_list text;
  v_problems text[];
  v_list_arr text[];
begin
  -- Nothing below can write, even by mistake.
  perform set_config('transaction_read_only', 'on', true);

  -- Which scripts have run: each one's own objects, which no other script
  -- makes or removes.
  v_ran := array[
    to_regclass('public.records') is not null
      and to_regprocedure('public.push_records(text,jsonb)') is not null,
    to_regprocedure('public.patch_company(text,jsonb)') is not null,
    to_regclass('almailbooks.email_alerts_config') is not null,
    to_regprocedure('almailbooks.can_read_v16_file(text)') is not null,
    to_regprocedure('public.set_member_permissions(text,uuid,jsonb,boolean)') is not null,
    to_regclass('public.change_events') is not null,
    to_regprocedure('almailbooks.people_shut(text)') is not null,
    exists (
      select 1
      from pg_policy p
      where p.polrelid = to_regclass('public.records')
        and p.polname = 'Manpower costings: kept from staff and viewers'
    )
  ];
  v_anon := exists (select 1 from pg_roles r where r.rolname = 'anon');
  v_auth := exists (select 1 from pg_roles r where r.rolname = 'authenticated');

  -- Scripts that haven't run: one row each ------------------------------------

  for v_s in 1..8 loop
    if not v_ran[v_s] then
      v_fix := pg_temp.maham_closure(v_s)
        || array(select t from generate_series(v_s + 1, 8) as t where not v_ran[t]);
      if v_s = 3 then
        v_rows := pg_temp.maham_row(v_rows, 300, v_steps[3], 'Email alerts', 'WARN',
          'Email alerts were never set up. They are optional: without them nobody gets the '
          || 'morning email alerts, the emails of team changes or those of pay runs sent for '
          || 'approval. To set them up, follow docs/email-alerts.md. '
          || pg_temp.maham_advice(v_fix, v_ran), v_fix);
      elsif v_s = 1 then
        v_rows := pg_temp.maham_row(v_rows, 100, v_steps[1], 'Script has run', 'MISSING',
          'This database has not been set up (only ever do this in a new, empty project). '
          || pg_temp.maham_advice(v_fix, v_ran), v_fix);
      else
        v_rows := pg_temp.maham_row(v_rows, v_s * 100, v_steps[v_s], 'Script has run', 'MISSING',
          'This script has not run yet. ' || pg_temp.maham_advice(v_fix, v_ran), v_fix);
      end if;
    end if;
  end loop;

  -- Nothing else can be checked before the first script.
  if not v_ran[1] then
    return query
      select (x ->> 'n')::integer, x ->> 'step', x ->> 'check', x ->> 'status', x ->> 'detail'
      from jsonb_array_elements(pg_temp.maham_summary(v_rows, v_ran)) as x;
    return;
  end if;

  -- What can only be asked by calling or parsing --------------------------------

  -- The kinds of record public.records takes (records_tbl_check).
  select pg_get_constraintdef(c.oid), c.convalidated into v_condef, v_convalid
  from pg_constraint c
  where c.conrelid = to_regclass('public.records') and c.conname = 'records_tbl_check';
  v_allowed := array(
    select m.r[1] from regexp_matches(coalesce(v_condef, ''), '''([^'']+)''', 'g') as m(r)
  );
  v_extra := v_extra || jsonb_build_array(jsonb_build_object(
    'step', 1, 'grp', 'tables', 'label', 'records_tbl_check on public.records',
    'problem', case
      when v_condef is null then 'missing'
      when not v_convalid then 'not checked against the records already there'
    end,
    'versions', '{1,4,8}'
  ));
  v_extra := v_extra || coalesce((
    select jsonb_agg(jsonb_build_object(
      'step', k.step, 'grp', 'kinds', 'label', k.kind,
      'problem', case when not (k.kind = any (v_allowed)) then 'not taken' end,
      'versions', '{1,4,8}'
    ))
    from (
      select 4 as step, x.kind from unnest(v_v16_kinds) as x(kind)
      union all
      select 8, x.kind from unnest(v_kinds) as x(kind)
    ) as k
  ), '[]'::jsonb);

  -- What public.server_features() answers: the app shows a feature only once
  -- the server says it has it.
  if v_ran[4] then
    begin
      execute 'select public.server_features()' into v_features;
      v_features_ok := true;
    exception when others then
      v_features_ok := false;
    end;
    v_extra := v_extra || coalesce((
      select jsonb_agg(jsonb_build_object(
        'step', e.step, 'grp', 'features', 'label', e.name,
        'problem', case
          when not v_features_ok then 'server_features() stopped with an error'
          when not (e.name = any (coalesce(v_features, '{}'::text[]))) then 'not answered'
        end,
        'versions', '{4,5,6,7,8}'
      ))
      from (
        values
          (4, 'tables_v16'), (5, 'super_admin'), (5, 'approvals'), (5, 'cheque_approvals'),
          (6, 'change_feed'), (7, 'payroll_approvals'), (7, 'document_alerts'),
          (7, 'employee_letters')
        union all
        select 8, x.name from unnest(v_app_features) as x(name)
      ) as e(step, name)
    ), '[]'::jsonb);
  end if;

  -- Payroll and people data are private: record_is_private says so for each
  -- kind (asked without any record; it reads nothing then).
  if v_ran[8] then
    foreach v_kind in array v_private_kinds loop
      begin
        execute 'select almailbooks.record_is_private($1, $2, null::jsonb)'
          into v_bool using ''::text, v_kind;
        v_problem := case when v_bool then null else 'not private' end;
      exception when others then
        v_problem := 'could not be asked';
      end;
      if v_problem is not null then
        v_private_bad := v_private_bad || v_kind;
      end if;
      v_extra := v_extra || jsonb_build_array(jsonb_build_object(
        'step', 8, 'grp', 'private', 'label', v_kind, 'problem', v_problem, 'versions', '{1,4,8}'
      ));
    end loop;
  end if;

  -- What each script makes, as its latest version -------------------------------
  --
  -- versions: every script that (re)defines it. An item that is wrong after
  -- its script ran is fixed by running again the latest of those that has
  -- run, then the scripts that replace what that one puts back.

  begin
    for g in
      with
      -- Functions: signature, the script that makes it, who may run it, the
      -- scripts that define it. app: the app calls it (signed-in members
      -- may, anonymous visitors may not); rls: the rules call it as the
      -- signed-in member; internal: never the members; plain: not granted.
      fn (sig, step, access, versions) as (
        values
          ('public.create_company(text,text)', 1, 'app', '{1,2}'::integer[]),
          ('public.push_records(text,jsonb)', 1, 'app', '{1}'),
          ('public.pull_records(text,bigint,integer)', 1, 'app', '{1}'),
          ('public.company_record_ids(text,text,text,text,integer)', 1, 'app', '{1}'),
          ('public.company_sync_info(text)', 1, 'app', '{1}'),
          ('public.my_companies()', 1, 'app', '{1}'),
          ('public.company_team(text)', 1, 'app', '{1}'),
          ('public.create_invite(text,text,public.member_role)', 1, 'app', '{1,5}'),
          ('public.list_invites(text)', 1, 'app', '{1}'),
          ('public.revoke_invite(uuid)', 1, 'app', '{1,5}'),
          ('public.invite_details(text)', 1, 'app', '{1}'),
          ('public.accept_invite(text)', 1, 'app', '{1}'),
          ('public.set_member_role(text,uuid,public.member_role)', 1, 'app', '{1,5}'),
          ('public.remove_member(text,uuid)', 1, 'app', '{1,5}'),
          ('public.transfer_ownership(text,uuid)', 1, 'app', '{1}'),
          ('public.delete_company(text)', 1, 'app', '{1}'),
          ('almailbooks.member_role(text)', 1, 'rls', '{1}'),
          ('almailbooks.record_is_private(text,text,jsonb)', 1, 'rls', '{1,4,8}'),
          ('almailbooks.staff_can_write(text,jsonb)', 1, 'rls', '{1,5}'),
          ('almailbooks.can_read_record(text,text,jsonb)', 1, 'rls', '{1}'),
          ('almailbooks.can_write_record(text,text,jsonb)', 1, 'rls', '{1,5}'),
          ('almailbooks.can_delete_record(text,text,jsonb)', 1, 'rls', '{1,5,7}'),
          ('almailbooks.can_read_marker(text,boolean)', 1, 'rls', '{1}'),
          ('almailbooks.can_use_file(text,text,boolean)', 1, 'rls', '{1}'),
          ('almailbooks.merge_numbering_rule(jsonb,jsonb)', 1, 'rls', '{1}'),
          ('almailbooks.merge_numbering(jsonb,jsonb)', 1, 'rls', '{1}'),
          ('almailbooks.counters_only(jsonb,jsonb)', 1, 'plain', '{1}'),
          ('almailbooks.lock_company(text)', 1, 'plain', '{1}'),
          ('almailbooks.purge_deleted_records(text)', 1, 'rls', '{1}'),
          ('almailbooks.purge_all_deleted_records()', 1, 'internal', '{1}'),
          ('almailbooks.touch_sync_signal(text,bigint)', 1, 'rls', '{1}'),
          ('almailbooks.records_before_write()', 1, 'plain', '{1}'),
          ('almailbooks.records_after_delete()', 1, 'plain', '{1}'),
          ('almailbooks.records_after_insert()', 1, 'plain', '{1}'),
          ('almailbooks.handle_new_user()', 1, 'plain', '{1}'),
          ('almailbooks.handle_user_email_change()', 1, 'plain', '{1}'),
          ('almailbooks.company_members_after_delete()', 1, 'plain', '{1}'),
          ('almailbooks.jsonb_set_path(jsonb,text[],jsonb)', 2, 'rls', '{2}'),
          ('almailbooks.company_deleting(text)', 2, 'rls', '{2}'),
          ('public.patch_company(text,jsonb)', 2, 'app', '{2}'),
          ('public.reserve_number(text,text,text,bigint)', 2, 'app', '{2}'),
          ('public.begin_delete_company(text)', 2, 'app', '{2}'),
          ('public.stored_files(text,text[])', 2, 'app', '{2}'),
          ('almailbooks.email_alerts_member_changed()', 3, 'internal', '{3,7}'),
          ('almailbooks.run_email_alerts()', 3, 'internal', '{3,7}'),
          ('public.email_alert_settings(text)', 3, 'app', '{3}'),
          ('public.set_email_alerts(text,boolean,text[],text)', 3, 'app', '{3,7}'),
          ('almailbooks.document_is_private(jsonb)', 4, 'rls', '{4}'),
          ('almailbooks.renewed_document_id(jsonb)', 4, 'rls', '{4}'),
          ('almailbooks.renewal_is_private(text,jsonb)', 4, 'rls', '{4}'),
          ('almailbooks.is_v16_private_owner(text,text)', 4, 'rls', '{4}'),
          ('almailbooks.can_read_v16_record(text,text,jsonb)', 4, 'rls', '{4,8}'),
          ('almailbooks.can_read_v16_file(text)', 4, 'rls', '{4}'),
          ('public.server_features()', 4, 'app', '{4,5,6,7,8}'),
          ('almailbooks.senior_roles_owner_only(text)', 5, 'rls', '{5}'),
          ('almailbooks.is_approver(text)', 5, 'rls', '{5}'),
          ('almailbooks.record_app(text,jsonb)', 5, 'rls', '{5,8}'),
          ('almailbooks.attachment_app(text,text)', 5, 'rls', '{5}'),
          ('almailbooks.json_same(jsonb,jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.company_books_changed(jsonb,jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.books_limited(text)', 5, 'rls', '{5}'),
          ('almailbooks.company_members_before_write()', 5, 'plain', '{5}'),
          ('almailbooks.company_members_audit()', 5, 'plain', '{5}'),
          ('public.set_member_permissions(text,uuid,jsonb,boolean)', 5, 'app', '{5}'),
          ('public.team_permissions(text)', 5, 'app', '{5}'),
          ('public.my_permissions(text)', 5, 'app', '{5}'),
          ('public.set_team_rules(text,boolean)', 5, 'app', '{5}'),
          ('public.owned_companies_overview()', 5, 'app', '{5}'),
          ('almailbooks.approval_rules(text)', 5, 'rls', '{5}'),
          ('almailbooks.rules_cover_document(jsonb,text)', 5, 'rls', '{5}'),
          ('almailbooks.document_stage(text)', 5, 'rls', '{5}'),
          ('almailbooks.invoice_content(jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.payment_link_changed(jsonb,jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.rules_cover_cheque(jsonb,jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.rules_cover_security_cheque(jsonb,jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.cheque_content(jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.security_cheque_content(jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.cheque_change_needs_approver(jsonb,text,jsonb,jsonb)', 5, 'rls', '{5}'),
          ('almailbooks.numbers_on_issue(text)', 5, 'plain', '{5}'),
          ('almailbooks.kept_key(jsonb,jsonb,text)', 5, 'plain', '{5}'),
          ('almailbooks.records_guard()', 5, 'plain', '{5,7}'),
          ('almailbooks.change_kind(text,jsonb)', 6, 'internal', '{6,8}'),
          ('almailbooks.change_details(text,text,jsonb,jsonb,boolean)', 6, 'internal', '{6}'),
          ('almailbooks.records_change_event()', 6, 'internal', '{6}'),
          ('almailbooks.change_events_before_insert()', 6, 'internal', '{6}'),
          ('almailbooks.notification_member_changed()', 6, 'internal', '{6}'),
          ('almailbooks.run_change_notifications()', 6, 'internal', '{6,7}'),
          ('almailbooks.purge_change_events()', 6, 'internal', '{6}'),
          ('public.notification_status(text)', 6, 'app', '{6}'),
          ('public.notification_feed(text,bigint,bigint,integer)', 6, 'app', '{6}'),
          ('public.mark_notifications_read(text,bigint)', 6, 'app', '{6}'),
          ('public.change_notification_settings(text)', 6, 'app', '{6}'),
          ('public.set_change_notifications(text,boolean,text[],text,text)', 6, 'app', '{6}'),
          ('almailbooks.payroll_approval_on(text)', 7, 'internal', '{7}'),
          ('almailbooks.letters_on(text)', 7, 'internal', '{7}'),
          ('almailbooks.issues_letters(text)', 7, 'internal', '{7}'),
          ('almailbooks.letter_content(jsonb)', 7, 'internal', '{7}'),
          ('almailbooks.issued_letter_kept(jsonb,jsonb)', 7, 'internal', '{7}'),
          ('almailbooks.people_shut(text)', 7, 'internal', '{7}'),
          ('almailbooks.payroll_approval_email()', 7, 'internal', '{7}'),
          ('public.email_alert_scope(text)', 7, 'app', '{7}'),
          ('public.set_email_alert_scope(text,text[])', 7, 'app', '{7}')
      ),
      -- Functions a later script replaces: text only its version (and later
      -- ones) has. An older version in place means an earlier script was run
      -- again after this one.
      mk (step, sig, marker) as (
        values
          (2, 'public.create_company(text,text)', 'company_exists'),
          (4, 'almailbooks.record_is_private(text,text,jsonb)', '''letterTemplates'''),
          (5, 'almailbooks.staff_can_write(text,jsonb)', '''approvals'''),
          (5, 'almailbooks.can_write_record(text,text,jsonb)', 'attachment_app'),
          (5, 'almailbooks.can_delete_record(text,text,jsonb)', 'approval_rules'),
          (5, 'public.create_invite(text,text,public.member_role)', 'senior_roles_owner_only'),
          (5, 'public.revoke_invite(uuid)', 'senior_roles_owner_only'),
          (5, 'public.set_member_role(text,uuid,public.member_role)', 'senior_roles_owner_only'),
          (5, 'public.remove_member(text,uuid)', 'senior_roles_owner_only'),
          (7, 'almailbooks.records_guard()', 'payroll_approval_on'),
          (7, 'almailbooks.can_delete_record(text,text,jsonb)', 'letters_on'),
          (7, 'almailbooks.run_change_notifications()', 'approval_emails'),
          (7, 'almailbooks.email_alerts_member_changed()', '''accountant'''),
          (7, 'almailbooks.run_email_alerts()', 'expiryUpdates'),
          (7, 'public.set_email_alerts(text,boolean,text[],text)', '''accountant'''),
          (8, 'almailbooks.record_is_private(text,text,jsonb)', '''staffingCostings'''),
          (8, 'almailbooks.can_read_v16_record(text,text,jsonb)', '''staffingCostings'''),
          (8, 'almailbooks.record_app(text,jsonb)', '''staffingCostings'''),
          (8, 'almailbooks.change_kind(text,jsonb)', '''staffingCostings''')
      ),
      -- Tables, and whether row-level security must be on.
      tb (step, rel, rls) as (
        values
          (1, 'public.profiles', true),
          (1, 'public.companies', true),
          (1, 'public.company_members', true),
          (1, 'public.company_invites', true),
          (1, 'public.records', true),
          (1, 'public.deleted_records', true),
          (1, 'public.sync_signals', true),
          (3, 'public.email_alerts', true),
          (3, 'almailbooks.email_alerts_config', false),
          (6, 'public.change_events', true),
          (6, 'public.notification_settings', true),
          (6, 'public.notification_reads', true),
          (7, 'almailbooks.approval_emails', true)
      ),
      sq (step, rel) as (
        values (1, 'public.records_rev_seq'), (6, 'public.change_events_id_seq')
      ),
      -- What signed-in members may do with each table (nothing when not listed);
      -- anonymous visitors may do nothing with any.
      tp_auth (rel, allowed) as (
        values
          ('public.profiles', '{SELECT}'::text[]),
          ('public.companies', '{SELECT}'),
          ('public.company_members', '{SELECT}'),
          ('public.company_invites', '{SELECT}'),
          ('public.records', '{SELECT,INSERT,UPDATE,DELETE}'),
          ('public.deleted_records', '{SELECT}'),
          ('public.sync_signals', '{SELECT}')
      ),
      -- Columns later scripts add.
      cl (step, rel, col) as (
        values
          (1, 'public.companies', 'purged_until_rev'),
          (1, 'public.deleted_records', 'private'),
          (2, 'public.companies', 'deleting_until'),
          (5, 'public.company_members', 'permissions'),
          (5, 'public.company_members', 'can_approve'),
          (5, 'public.companies', 'senior_roles_owner_only'),
          (7, 'public.email_alerts', 'document_kinds')
      ),
      ck (step, rel, name) as (
        values
          (1, 'public.records', 'records_id_check'),
          (1, 'public.records', 'records_data_check'),
          (1, 'public.companies', 'companies_id_format'),
          (1, 'public.company_invites', 'company_invites_role_check'),
          (1, 'public.company_invites', 'company_invites_token_check'),
          (3, 'public.email_alerts', 'email_alerts_topics_check'),
          (5, 'public.company_members', 'company_members_permissions_check'),
          (6, 'public.change_events', 'change_events_fold'),
          (6, 'public.notification_settings', 'notification_settings_kinds_check'),
          (7, 'public.email_alerts', 'email_alerts_document_kinds_check')
      ),
      tg (step, rel, name, fn, versions) as (
        values
          (1, 'public.records', 'records_before_write', 'almailbooks.records_before_write()', '{1}'::integer[]),
          (1, 'public.records', 'records_after_delete', 'almailbooks.records_after_delete()', '{1}'),
          (1, 'public.records', 'records_after_insert', 'almailbooks.records_after_insert()', '{1}'),
          (1, 'auth.users', 'on_auth_user_created', 'almailbooks.handle_new_user()', '{1}'),
          (1, 'auth.users', 'on_auth_user_email_changed', 'almailbooks.handle_user_email_change()', '{1}'),
          (1, 'public.company_members', 'company_members_after_delete', 'almailbooks.company_members_after_delete()', '{1}'),
          (3, 'public.company_members', 'email_alerts_member_changed', 'almailbooks.email_alerts_member_changed()', '{3}'),
          (5, 'public.company_members', 'company_members_before_write', 'almailbooks.company_members_before_write()', '{5}'),
          (5, 'public.company_members', 'company_members_audit', 'almailbooks.company_members_audit()', '{5}'),
          (5, 'public.records', 'records_guard', 'almailbooks.records_guard()', '{5,7}'),
          (6, 'public.records', 'records_change_event', 'almailbooks.records_change_event()', '{6}'),
          (6, 'public.change_events', 'change_events_before_insert', 'almailbooks.change_events_before_insert()', '{6}'),
          (6, 'public.company_members', 'notification_member_changed', 'almailbooks.notification_member_changed()', '{6}'),
          (7, 'public.records', 'records_payroll_approval_email', 'almailbooks.payroll_approval_email()', '{7}')
      ),
      -- Row-level security rules: cmd r select, a insert, w update, d delete;
      -- permissive or restrictive; text its expression has (this version).
      po (step, grp, rel, name, cmd, permissive, marker, versions) as (
        values
          (1, 'policies', 'public.profiles', 'Own profile: read', 'r', true, null::text, '{1}'::integer[]),
          (1, 'policies', 'public.profiles', 'Own profile: update', 'w', true, null, '{1}'),
          (1, 'policies', 'public.companies', 'Members: read company', 'r', true, 'member_role', '{1}'),
          (1, 'policies', 'public.company_members', 'Members: read members', 'r', true, 'member_role', '{1}'),
          (1, 'policies', 'public.company_invites', 'Owners and admins: read invites', 'r', true, 'member_role', '{1}'),
          (1, 'policies', 'public.records', 'Members: read records', 'r', true, 'can_read_record', '{1}'),
          (1, 'policies', 'public.records', 'Members: add records', 'a', true, 'can_write_record', '{1}'),
          (1, 'policies', 'public.records', 'Members: change records', 'w', true, 'can_write_record', '{1}'),
          (1, 'policies', 'public.records', 'Members: delete records', 'd', true, 'can_delete_record', '{1}'),
          (1, 'policies', 'public.deleted_records', 'Members: read deletions', 'r', true, 'can_read_marker', '{1}'),
          (1, 'policies', 'public.sync_signals', 'Members: read signals', 'r', true, 'member_role', '{1}'),
          (1, 'storage', 'storage.objects', 'AlmailBooks files: read', 'r', true, 'can_use_file', '{1}'),
          (1, 'storage', 'storage.objects', 'AlmailBooks files: upload', 'a', true, 'can_use_file', '{1,2}'),
          (1, 'storage', 'storage.objects', 'AlmailBooks files: replace', 'w', true, 'can_use_file', '{1,2}'),
          (1, 'storage', 'storage.objects', 'AlmailBooks files: delete', 'd', true, 'can_use_file', '{1}'),
          (2, 'storage', 'storage.objects', 'AlmailBooks files: upload', 'a', true, 'company_deleting', '{1,2}'),
          (2, 'storage', 'storage.objects', 'AlmailBooks files: replace', 'w', true, 'company_deleting', '{1,2}'),
          (4, 'policies', 'public.records', 'People data: kept from staff and viewers', 'r', false, 'can_read_v16_record', '{4}'),
          (4, 'policies', 'public.deleted_records', 'People data: kept from staff and viewers', 'r', false, 'letterTemplates', '{4}'),
          (4, 'policies', 'storage.objects', 'People data: kept from staff and viewers', 'r', false, 'can_read_v16_file', '{4}'),
          (8, 'policies', 'public.records', 'Manpower costings: kept from staff and viewers', 'r', false, 'staffingCostings', '{8}'),
          (8, 'policies', 'public.deleted_records', 'Manpower costings: kept from staff and viewers', 'r', false, 'staffingCostings', '{8}')
      ),
      items (step, grp, label, problem, versions) as (
        -- Functions are there, with a fixed search_path.
        select f.step, 'functions', split_part(f.sig, '(', 1),
          case
            when p.oid is null then 'missing'
            when not coalesce(p.proconfig @> array['search_path=""'], false)
              then 'its search_path is not fixed'
          end,
          f.versions
        from fn as f
        left join pg_proc as p on p.oid = to_regprocedure(f.sig)
        union all
        -- Their latest version.
        select m.step, 'updated', split_part(m.sig, '(', 1),
          case
            when p.oid is null then 'missing'
            when position(m.marker in p.prosrc) = 0 then 'an older version'
          end,
          f.versions
        from mk as m
        join fn as f on f.sig = m.sig
        left join pg_proc as p on p.oid = to_regprocedure(m.sig)
        union all
        -- Who may run them.
        select f.step, 'grants', split_part(f.sig, '(', 1),
          case
            when p.oid is null then null
            when v_anon and has_function_privilege('anon', p.oid, 'EXECUTE')
              then 'anonymous visitors can run it'
            when v_auth and f.access in ('app', 'rls')
              and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'signed-in members can''t run it'
            when v_auth and f.access = 'internal'
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'signed-in members can run it'
          end,
          f.versions
        from fn as f
        left join pg_proc as p on p.oid = to_regprocedure(f.sig)
        union all
        -- Tables, with row-level security.
        select t.step, 'tables', t.rel,
          case
            when c.oid is null then 'missing'
            when t.rls and not c.relrowsecurity then 'row-level security is off'
          end,
          array[t.step]
        from tb as t
        left join pg_class as c on c.oid = to_regclass(t.rel)
        union all
        select s.step, 'tables', s.rel, case when to_regclass(s.rel) is null then 'missing' end,
          array[s.step]
        from sq as s
        union all
        select x.step, 'tables', x.rel || '.' || x.col,
          case
            when not exists (
              select 1
              from pg_attribute a
              where a.attrelid = to_regclass(x.rel) and a.attname = x.col
                and a.attnum > 0 and not a.attisdropped
            ) then 'missing'
          end,
          array[x.step]
        from cl as x
        -- The email alerts table is only there once email alerts are set up.
        where x.rel <> 'public.email_alerts' or v_ran[3]
        union all
        select k.step, 'tables', k.name || ' on ' || k.rel,
          case
            when not exists (
              select 1 from pg_constraint c where c.conrelid = to_regclass(k.rel) and c.conname = k.name
            ) then 'missing'
          end,
          array[k.step]
        from ck as k
        where k.rel <> 'public.email_alerts' or v_ran[3]
        union all
        select 1, 'tables', 'company_members_one_owner (one owner per company)',
          case
            when not exists (
              select 1
              from pg_index i
              where i.indexrelid = to_regclass('public.company_members_one_owner') and i.indisunique
            ) then 'missing'
          end,
          array[1]
        union all
        select 1, 'tables', 'public.member_role',
          case
            when to_regtype('public.member_role') is null then 'missing'
            when array(
                select e.enumlabel::text
                from pg_enum e
                where e.enumtypid = to_regtype('public.member_role')
                order by e.enumsortorder
              ) <> array['owner', 'admin', 'accountant', 'staff', 'viewer']
              then 'other roles than owner, admin, accountant, staff and viewer'
          end,
          array[1]
        union all
        -- Triggers, on and calling the right function.
        select t.step, 'triggers', t.name || ' on ' || t.rel,
          case
            when x.oid is null then 'missing'
            when x.tgfoid is distinct from to_regprocedure(t.fn)::oid then 'calls another function'
            when x.tgenabled = 'D' then 'switched off'
          end,
          t.versions
        from tg as t
        left join pg_trigger as x
          on x.tgrelid = to_regclass(t.rel) and x.tgname = t.name and not x.tgisinternal
        union all
        -- Row-level security rules.
        select p.step, p.grp, '"' || p.name || '" on ' || p.rel,
          case
            when x.oid is null then 'missing'
            when x.polcmd::text <> p.cmd then 'for another action'
            when x.polpermissive and not p.permissive then 'not restrictive'
            when not x.polpermissive and p.permissive then 'restrictive'
            when v_auth and x.polroles is distinct from array[
                (select r.oid from pg_roles r where r.rolname = 'authenticated')
              ] then 'for other roles than signed-in members'
            when p.marker is not null and position(p.marker in
                coalesce(pg_get_expr(x.polqual, x.polrelid), '') || ' '
                || coalesce(pg_get_expr(x.polwithcheck, x.polrelid), '')
              ) = 0 then 'an older version'
          end,
          p.versions
        from po as p
        left join pg_policy as x on x.polrelid = to_regclass(p.rel) and x.polname = p.name
        union all
        -- Storage.
        select 1, 'storage', 'bucket company-files',
          case
            when not exists (select 1 from storage.buckets b where b.id = 'company-files') then 'missing'
            when exists (select 1 from storage.buckets b where b.id = 'company-files' and b.public)
              then 'public: anyone with a link could download its files'
          end,
          array[1]
        union all
        select 1, 'storage', 'row-level security on storage.objects',
          case
            when not coalesce(
              (select c.relrowsecurity from pg_class c where c.oid = to_regclass('storage.objects')),
              false
            ) then 'off'
          end,
          array[1]
        union all
        -- What signed-in members and anonymous visitors may do with each table.
        select t.step, 'grants', t.rel || ' for ' || r.role,
          case
            when to_regclass(t.rel) is null or not (case r.role when 'anon' then v_anon else v_auth end)
              then null
            else nullif(concat_ws('; ',
              'may also ' || nullif(array_to_string(array(
                select lower(pr.p)
                from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as pr(p)
                where has_table_privilege(r.role, to_regclass(t.rel), pr.p)
                  and not (pr.p = any (case when r.role = 'authenticated' then coalesce(a.allowed, '{}') else '{}' end))
              ), ', '), ''),
              'may not ' || nullif(array_to_string(array(
                select lower(pr.p)
                from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as pr(p)
                where not has_table_privilege(r.role, to_regclass(t.rel), pr.p)
                  and pr.p = any (case when r.role = 'authenticated' then coalesce(a.allowed, '{}') else '{}' end)
              ), ', '), '')
            ), '')
          end,
          array[t.step]
        from tb as t
        cross join (values ('anon'), ('authenticated')) as r(role)
        left join tp_auth as a on a.rel = t.rel
        union all
        -- Members change only their own name and language, never their email.
        select 1, 'grants', 'public.profiles.' || c.col || ' for authenticated',
          case
            when not v_auth or not exists (
              select 1
              from pg_attribute x
              where x.attrelid = to_regclass('public.profiles') and x.attname = c.col
                and x.attnum > 0 and not x.attisdropped
            ) then null
            when has_column_privilege('authenticated', to_regclass('public.profiles'), c.col, 'UPDATE')
              <> c.allowed then case when c.allowed then 'may not change it' else 'may change it' end
          end,
          array[1]
        from (
          values ('full_name', true), ('language', true), ('email', false), ('id', false)
        ) as c(col, allowed)
        union all
        select s.step, 'grants', s.rel || ' for ' || r.role,
          case
            when to_regclass(s.rel) is null or not (case r.role when 'anon' then v_anon else v_auth end)
              then null
            when has_sequence_privilege(r.role, to_regclass(s.rel), 'USAGE')
              or has_sequence_privilege(r.role, to_regclass(s.rel), 'SELECT')
              or has_sequence_privilege(r.role, to_regclass(s.rel), 'UPDATE')
              then 'may use it'
          end,
          array[s.step]
        from sq as s
        cross join (values ('anon'), ('authenticated')) as r(role)
        union all
        -- The helpers' schema: signed-in members use it (the rules call its
        -- functions), anonymous visitors don't.
        select 1, 'grants', 'schema almailbooks for ' || r.role,
          case
            when to_regnamespace('almailbooks') is null then 'missing'
            when not (case r.role when 'anon' then v_anon else v_auth end) then null
            when r.role = 'anon' and has_schema_privilege('anon', 'almailbooks', 'USAGE') then 'may use it'
            when r.role = 'authenticated' and not has_schema_privilege('authenticated', 'almailbooks', 'USAGE')
              then 'may not use it'
          end,
          array[1]
        from (values ('anon'), ('authenticated')) as r(role)
        union all
        -- Rules nobody's script made, on the app's tables and on Storage.
        select 11, 'extra_tables', '"' || left(x.polname, 60) || '" on ' || x.polrelid::regclass::text,
          case when not exists (
              select 1 from po p where to_regclass(p.rel) = x.polrelid and p.name = x.polname
            ) then case when x.polpermissive then 'adds access' else 'restricts access' end
          end,
          null::integer[]
        from pg_policy as x
        where x.polrelid in (select to_regclass(t.rel)::oid from tb t where to_regclass(t.rel) is not null)
        union all
        select 11, 'extra_storage', '"' || left(x.polname, 60) || '"',
          case when not exists (
              select 1 from po p where p.rel = 'storage.objects' and p.name = x.polname
            ) and x.polpermissive then 'adds access' end,
          null::integer[]
        from pg_policy as x
        where x.polrelid = to_regclass('storage.objects')
        union all
        -- Kinds of record, server_features() and record_is_private, as asked above.
        select x.step, x.grp, x.label, x.problem, x.versions::integer[]
        from jsonb_to_recordset(v_extra) as x(step integer, grp text, label text, problem text, versions text)
      ),
      judged as (
        select i.step, i.grp, i.label, i.problem,
          (
            select max(v.v)
            from unnest(i.versions) as v(v)
            where v_ran[v.v] and v.v >= i.step
          ) as lr
        from items as i
        where (i.step between 1 and 8 and v_ran[i.step]) or i.step > 8
      )
      select j.step, j.grp, count(*)::integer as total,
        array_agg(j.label order by j.label) as labels,
        array_agg(j.label || ' (' || j.problem || ')' order by j.label)
          filter (where j.problem is not null) as bad,
        array_agg(j.lr) filter (where j.problem is not null) as lrs
      from judged as j
      group by j.step, j.grp
    loop
      if g.step = 11 then
        -- Rules added by hand.
        if g.grp = 'extra_tables' then
          if g.bad is null then
            v_rows := pg_temp.maham_row(v_rows, 1109, v_steps[11], 'Rules added by hand to the app''s tables', 'OK',
              'None: the app''s tables have only the rules the scripts make.');
          else
            v_rows := pg_temp.maham_row(v_rows, 1109, v_steps[11], 'Rules added by hand to the app''s tables', 'FAIL',
              'Not made by the scripts: ' || array_to_string(g.bad[1:8], ', ')
              || case when cardinality(g.bad) > 8 then format(' and %s more', cardinality(g.bad) - 8) else '' end
              || '. Rules add up, so one that adds access can let staff, viewers or anyone else read '
              || 'what the scripts keep closed. Unless the developer added them, delete them in '
              || 'Database → Policies.');
          end if;
        elsif g.grp = 'extra_storage' then
          if g.bad is null then
            v_rows := pg_temp.maham_row(v_rows, 1110, v_steps[11], 'Other rules on Storage', 'OK',
              'None: Storage has only the rules the scripts make.');
          else
            v_rows := pg_temp.maham_row(v_rows, 1110, v_steps[11], 'Other rules on Storage', 'WARN',
              'Rules the scripts didn''t make: ' || array_to_string(g.bad[1:8], ', ')
              || case when cardinality(g.bad) > 8 then format(' and %s more', cardinality(g.bad) - 8) else '' end
              || '. Rules add up: make sure none of them reaches the company-files bucket (it '
              || 'should name another bucket). Delete any that doesn''t, in Storage → Policies.');
          end if;
        end if;
        continue;
      end if;

      v_n := g.step * 100 + case g.grp
        when 'tables' then 1 when 'functions' then 2 when 'updated' then 3 when 'kinds' then 4
        when 'triggers' then 5 when 'policies' then 6 when 'private' then 7 when 'storage' then 8
        when 'features' then 9 when 'grants' then 10 else 50 end;
      v_label := case g.grp
        when 'tables' then 'Tables, columns and constraints'
        when 'functions' then 'Functions'
        when 'updated' then 'Functions it replaces are up to date'
        when 'kinds' then 'Kinds of record the cloud takes'
        when 'triggers' then 'Triggers'
        when 'policies' then 'Row-level security rules'
        when 'private' then 'Payroll and people data are private'
        when 'storage' then 'Storage: bucket company-files and its rules'
        when 'features' then 'What server_features() answers'
        when 'grants' then 'Who may use what (grants)'
        else g.grp
      end;
      if g.bad is null then
        v_text := case
          when g.grp = 'kinds' and g.step = 8
            then format('The cloud takes all %s kinds of record the app syncs.', g.total)
          when g.grp = 'kinds' then format('The cloud takes the %s kinds of record this script adds.', g.total)
          when g.grp = 'features' and g.step = 8
            then 'It answers every name the app knows: ' || array_to_string(g.labels, ', ') || '.'
          when g.grp = 'features' then 'It answers ' || array_to_string(g.labels, ', ') || '.'
          when g.grp = 'private'
            then format('record_is_private keeps all %s kinds of payroll and people data from staff and viewers.', g.total)
          when g.grp = 'updated'
            then format('Up to date (%s checked): this script''s version or a later one.', g.total)
          when g.grp = 'grants'
            then format('All as the scripts set them (%s checked); anonymous visitors may use nothing.', g.total)
          else format('All in place (%s checked).', g.total)
        end;
        v_rows := pg_temp.maham_row(v_rows, v_n, v_steps[g.step], v_label, 'OK', v_text);
      else
        v_fix := array(
          select distinct u.s
          from unnest(g.lrs) as l(l), unnest(pg_temp.maham_closure(l.l)) as u(s)
          where l.l > 1
          order by u.s
        );
        v_text := 'Not right: ' || array_to_string(g.bad[1:8], ', ')
          || case when cardinality(g.bad) > 8 then format(' and %s more', cardinality(g.bad) - 8) else '' end
          || '. ';
        if cardinality(v_fix) > 0 then
          v_text := v_text || case
              when g.grp = 'grants' then 'The grants were changed after the script ran. '
              else 'An earlier script was run again after this one, or something was changed by hand. '
            end
            || pg_temp.maham_advice(v_fix, v_ran);
        end if;
        if 1 = any (g.lrs) then
          v_text := v_text || case when cardinality(v_fix) > 0 then ' ' else '' end
            || 'What only the first script makes can''t be fixed by running a script (never run '
            || '20261004000000_almailbooks_cloud.sql again): ask the developer for a fix.';
        end if;
        v_rows := pg_temp.maham_row(v_rows, v_n, v_steps[g.step], v_label, 'FAIL', v_text, v_fix);
      end if;
    end loop;
  exception when others then
    v_rows := pg_temp.maham_row(v_rows, 199, v_steps[1], 'Objects of the scripts', 'FAIL',
      format('This part of the check stopped with error %s, so the scripts'' objects were not checked. '
        || 'Run this check as the postgres user (the SQL editor does), or ask the developer.', sqlstate));
  end;

  -- Realtime: members hear at once that their company changed.
  if not exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime') then
    v_rows := pg_temp.maham_row(v_rows, 111, v_steps[1], 'Realtime', 'WARN',
      'There is no supabase_realtime publication, so devices see each other''s changes only '
      || 'when they sync by themselves, every minute or so. Supabase always has it: check '
      || 'Database → Publications.');
  elsif not exists (
    select 1
    from pg_publication_tables p
    where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'sync_signals'
  ) then
    v_rows := pg_temp.maham_row(v_rows, 111, v_steps[1], 'Realtime', 'WARN',
      'public.sync_signals is not published, so devices see each other''s changes only when they '
      || 'sync by themselves, every minute or so. In Database → Publications → supabase_realtime, '
      || 'turn on sync_signals.');
  else
    v_rows := pg_temp.maham_row(v_rows, 111, v_steps[1], 'Realtime', 'OK',
      'Devices hear at once that their company changed (public.sync_signals is published).');
  end if;

  -- 9. Schedules ------------------------------------------------------------------

  v_cron := exists (select 1 from pg_extension e where e.extname = 'pg_cron')
    or to_regclass('cron.job') is not null;
  v_net := exists (select 1 from pg_extension e where e.extname = 'pg_net')
    or to_regclass('net._http_response') is not null;
  select e.extversion into v_cron_version from pg_extension e where e.extname = 'pg_cron';
  select e.extversion into v_net_version from pg_extension e where e.extname = 'pg_net';

  if not v_cron then
    -- The scripts that schedule the jobs, run again once pg_cron is on (and
    -- those that put back what they replace), of those that have run.
    v_fix := array(
      select s.s
      from unnest(
        case
          when v_ran[3] then pg_temp.maham_closure(3)
          when v_ran[8] then array[8]
          when v_ran[4] then array[4]
          else '{}'::integer[]
        end
        || case when v_ran[6] then pg_temp.maham_closure(6) else '{}'::integer[] end
      ) as s(s)
      where v_ran[s.s]
    );
    v_rows := pg_temp.maham_row(v_rows, 901, v_steps[9], 'pg_cron and pg_net', 'WARN',
      'pg_cron is not on, so nothing runs on a schedule: deletion markers are cleaned up only as '
      || 'each company syncs'
      || case when v_ran[3] then ', nobody gets the morning email alerts' else '' end
      || case when v_ran[6]
        then ', the emails of team changes don''t go out and changes older than 180 days stay'
        else '' end
      || case when v_ran[7]
        then ', and an email about a pay run sent for approval that fails is not tried again'
        else '' end
      || '. To turn it on: Database → Extensions, enable pg_cron and pg_net. Then '
      || coalesce(nullif(lower(left(pg_temp.maham_advice(v_fix, v_ran), 1))
        || substr(pg_temp.maham_advice(v_fix, v_ran), 2), ''), 'run this check again.'));
  elsif not v_net then
    v_rows := pg_temp.maham_row(v_rows, 901, v_steps[9], 'pg_cron and pg_net', 'WARN',
      'pg_cron is on, but pg_net is not: the schedules can''t call the email-alerts function, so '
      || 'no email goes out. Database → Extensions: enable pg_net.');
  else
    v_rows := pg_temp.maham_row(v_rows, 901, v_steps[9], 'pg_cron and pg_net', 'OK',
      'pg_cron' || coalesce(' ' || v_cron_version, '') || ' and pg_net'
      || coalesce(' ' || v_net_version, '') || ' are on.');
  end if;

  if v_cron then
    for v_job in
      select *
      from (
        values
          (902, 'almailbooks-purge-deleted-records', '17 3 * * *',
            'select almailbooks.purge_all_deleted_records()', 'daily clean-up of deletion markers',
            true, coalesce(case when v_ran[8] then 8 when v_ran[4] then 4 when v_ran[3] then 3 end, 4)),
          (903, 'maham-books-email-alerts', '7 * * * *', 'select almailbooks.run_email_alerts()',
            'morning email alerts, every hour', v_ran[3], 3),
          (904, 'maham-change-notifications', '*/5 * * * *',
            'select almailbooks.run_change_notifications()',
            'emails of team changes and of pay runs sent for approval, every 5 minutes', v_ran[6], 6),
          (905, 'maham-change-feed-purge', '47 2 * * *', 'select almailbooks.purge_change_events()',
            'daily clean-up of changes older than 180 days', v_ran[6], 6)
      ) as j(n, name, sched, cmd, what, needed, script)
      where j.needed
    loop
      v_label := 'Job ' || v_job.name || ' (' || v_job.what || ')';
      begin
        v_jobid := null;
        execute 'select j.jobid, j.schedule, j.command, j.active from cron.job j '
          || 'where j.jobname = $1 order by j.jobid desc limit 1'
          into v_jobid, v_sched, v_cmd, v_active
          using v_job.name;
        if v_jobid is null then
          v_fix := pg_temp.maham_closure(v_job.script);
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label, 'FAIL',
            'It is not scheduled (pg_cron was probably turned on after the script ran). '
            || pg_temp.maham_advice(v_fix, v_ran), v_fix);
          continue;
        end if;
        if lower(regexp_replace(btrim(btrim(v_cmd), ';'), '\s+', ' ', 'g')) <> v_job.cmd then
          v_fix := pg_temp.maham_closure(v_job.script);
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label, 'FAIL',
            'It runs something else than the script schedules. ' || pg_temp.maham_advice(v_fix, v_ran),
            v_fix);
          continue;
        end if;
        if not v_active then
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label, 'WARN',
            'It is switched off. Turn it on in Integrations → Cron → Jobs.');
          continue;
        end if;
        begin
          v_run_status := null;
          v_run_at := null;
          execute 'select d.status, d.start_time from cron.job_run_details d where d.jobid = $1 '
            || 'order by d.start_time desc nulls last limit 1'
            into v_run_status, v_run_at
            using v_jobid;
        exception when others then
          v_run_status := 'unknown';
        end;
        v_text := case
          when v_sched is distinct from v_job.sched
            then format(' Its schedule is %s; the script sets %s.', v_sched, v_job.sched)
          else ''
        end;
        if v_run_status is null then
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label, 'WARN',
            'It is on, but no run is recorded yet. If the script ran more than a day ago, look at '
            || 'it in Integrations → Cron → Jobs.' || v_text);
        elsif v_run_status = 'unknown' then
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label,
            case when v_text = '' then 'OK' else 'WARN' end,
            'It is on (its runs could not be read).' || v_text);
        elsif v_run_status = 'succeeded' then
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label,
            case when v_text = '' then 'OK' else 'WARN' end,
            'It is on; its last run, ' || to_char(v_run_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
            || ' UTC, succeeded.' || v_text);
        elsif v_run_status in ('starting', 'running', 'sending', 'connecting') then
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label,
            case when v_text = '' then 'OK' else 'WARN' end,
            'It is on and running now (started ' || to_char(v_run_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
            || ' UTC).' || v_text);
        else
          v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label, 'FAIL',
            'Its last run, ' || coalesce(to_char(v_run_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC', '')
            || ', ended "' || v_run_status || '". Open it in Integrations → Cron → Jobs to see why, '
            || 'or ask the developer.' || v_text);
        end if;
      exception when others then
        v_rows := pg_temp.maham_row(v_rows, v_job.n, v_steps[9], v_label, 'WARN',
          format('The schedules could not be read (error %s). Look in Integrations → Cron → Jobs.', sqlstate));
      end;
    end loop;
  end if;

  -- 10. Email alerts set-up -------------------------------------------------------
  --
  -- The email-alerts function keeps its address and the secret the schedule
  -- shows it in almailbooks.email_alerts_config (no values are shown here).
  -- Its own secrets (the Resend key, the sender) are the function's, in
  -- Edge Functions → Secrets: the database can't see them.

  if v_ran[3] then
    begin
      execute 'select count(*), '
        || 'count(*) filter (where char_length(coalesce(c.secret, '''')) >= 32), '
        || 'count(*) filter (where coalesce(c.function_url, '''') <> ''''), '
        || 'count(*) filter (where c.function_url ~ $1) '
        || 'from almailbooks.email_alerts_config c where c.id'
        into v_a, v_b, v_c, v_d
        using '^https?://[^[:space:]/]+/functions/v1/email-alerts$';
      if v_a = 0 then
        v_fix := pg_temp.maham_closure(3);
        v_rows := pg_temp.maham_row(v_rows, 1001, v_steps[10], 'Settings row and its secret', 'FAIL',
          'The settings row of almailbooks.email_alerts_config is missing. '
          || pg_temp.maham_advice(v_fix, v_ran), v_fix);
      elsif v_b = 0 then
        v_rows := pg_temp.maham_row(v_rows, 1001, v_steps[10], 'Settings row and its secret', 'FAIL',
          'The secret the schedule shows the email-alerts function is missing or too short, so the '
          || 'function refuses every run. Ask the developer.');
      else
        v_rows := pg_temp.maham_row(v_rows, 1001, v_steps[10], 'Settings row and its secret', 'OK',
          'The settings row is there, with its secret (not shown).');
      end if;
      if v_a > 0 then
        if v_c = 0 then
          v_rows := pg_temp.maham_row(v_rows, 1002, v_steps[10], 'The email-alerts function has run', 'WARN',
            'The email-alerts function hasn''t run yet, so the schedule doesn''t know where it is and '
            || 'no email goes out. Publish it (docs/email-alerts.md, steps 4 and 5), then in the app '
            || 'open Settings → Email alerts and press Send it now.');
        elsif v_d = 0 then
          v_rows := pg_temp.maham_row(v_rows, 1002, v_steps[10], 'The email-alerts function has run', 'WARN',
            'The address the function left doesn''t look like a Supabase function. In the app, open '
            || 'Settings → Email alerts and press Send it now to set it again.');
        else
          v_rows := pg_temp.maham_row(v_rows, 1002, v_steps[10], 'The email-alerts function has run', 'OK',
            'It has run and left its address for the schedule (not shown).');
        end if;
      end if;
    exception when others then
      v_rows := pg_temp.maham_row(v_rows, 1001, v_steps[10], 'Settings row and its secret', 'FAIL',
        format('almailbooks.email_alerts_config could not be read (error %s). Ask the developer.', sqlstate));
    end;

    begin
      execute 'select count(*) filter (where a.enabled), '
        || 'count(*) filter (where a.enabled and a.last_error <> '''' '
        || 'and a.last_error_at > now() - interval ''2 days'') '
        || 'from public.email_alerts a'
        into v_a, v_b;
      if v_b > 0 then
        v_rows := pg_temp.maham_row(v_rows, 1003, v_steps[10], 'Morning email alerts', 'WARN',
          format('%s of the %s people who get them had a problem with an email in the last 2 days. '
            || 'They see what went wrong in Settings → Email alerts; see docs/email-alerts.md, '
            || '"If no email arrives".', v_b, v_a));
      elsif v_a = 0 then
        v_rows := pg_temp.maham_row(v_rows, 1003, v_steps[10], 'Morning email alerts', 'OK',
          'Nobody has turned them on yet (Settings → Email alerts).');
      else
        v_rows := pg_temp.maham_row(v_rows, 1003, v_steps[10], 'Morning email alerts', 'OK',
          format('%s %s them, with no problem in the last 2 days.', v_a,
            case when v_a = 1 then 'person gets' else 'people get' end));
      end if;
    exception when others then
      v_rows := pg_temp.maham_row(v_rows, 1003, v_steps[10], 'Morning email alerts', 'FAIL',
        format('public.email_alerts could not be read (error %s). Ask the developer.', sqlstate));
    end;

    if v_ran[6] then
      begin
        execute 'select count(*) filter (where s.enabled), '
          || 'count(*) filter (where s.enabled and s.last_error <> '''' '
          || 'and s.last_error_at > now() - interval ''2 days'') '
          || 'from public.notification_settings s'
          into v_a, v_b;
        if v_b > 0 then
          v_rows := pg_temp.maham_row(v_rows, 1004, v_steps[10], 'Emails of team changes', 'WARN',
            format('%s of the %s people who get them had a problem with an email in the last 2 days. '
              || 'They see what went wrong in Settings → Email alerts → Changes by your team.', v_b, v_a));
        else
          v_rows := pg_temp.maham_row(v_rows, 1004, v_steps[10], 'Emails of team changes', 'OK',
            case when v_a = 0 then 'Nobody has turned them on yet (Settings → Email alerts → Changes by your team).'
              else format('%s %s them, with no problem in the last 2 days.', v_a,
                case when v_a = 1 then 'person gets' else 'people get' end) end);
        end if;
      exception when others then
        v_rows := pg_temp.maham_row(v_rows, 1004, v_steps[10], 'Emails of team changes', 'FAIL',
          format('public.notification_settings could not be read (error %s). Ask the developer.', sqlstate));
      end;
    end if;

    if v_ran[7] then
      begin
        execute 'select count(*) filter (where a.sent_at is not null), '
          || 'count(*) filter (where a.finished_at is null and a.attempts < 5 '
          || 'and a.created_at > now() - interval ''3 days''), '
          || 'count(*) filter (where a.finished_at is null and (a.attempts >= 5 '
          || 'or a.created_at <= now() - interval ''3 days'')) '
          || 'from almailbooks.approval_emails a'
          into v_a, v_b, v_c;
        if v_c > 0 then
          v_rows := pg_temp.maham_row(v_rows, 1005, v_steps[10], 'Emails of pay runs sent for approval', 'WARN',
            format('%s could not be sent (5 tries or 3 days). The approvers still find the requests '
              || 'in the app (Approvals); see docs/email-alerts.md, "If no email arrives".', v_c));
        else
          v_rows := pg_temp.maham_row(v_rows, 1005, v_steps[10], 'Emails of pay runs sent for approval', 'OK',
            format('%s sent, %s waiting to be sent, none given up.', v_a, v_b));
        end if;
      exception when others then
        v_rows := pg_temp.maham_row(v_rows, 1005, v_steps[10], 'Emails of pay runs sent for approval', 'FAIL',
          format('almailbooks.approval_emails could not be read (error %s). Ask the developer.', sqlstate));
      end;
    end if;

    -- pg_net keeps the answers to its calls for a few hours.
    if to_regclass('net._http_response') is not null then
      begin
        execute 'select count(*), count(a.failed), '
          || 'string_agg(distinct a.failed, '', '' order by a.failed) '
          || 'from (select case '
          || 'when coalesce(r.timed_out, false) then ''timed out'' '
          || 'when r.error_msg is not null or r.status_code is null then ''no answer'' '
          || 'when r.status_code not between 200 and 299 then r.status_code::text '
          || 'end as failed from net._http_response r) a'
          into v_a, v_b, v_list;
        if v_b > 0 then
          v_rows := pg_temp.maham_row(v_rows, 1006, v_steps[10], 'Recent calls to the email-alerts function', 'WARN',
            format('%s of the %s calls of the last hours failed (%s). 401: the function and the database '
              || 'disagree on the secret; 404: the function isn''t published; 500: a problem inside it '
              || '(Edge Functions → email-alerts → Logs says what). See docs/email-alerts.md, '
              || '"If no email arrives".', v_b, v_a, v_list));
        else
          v_rows := pg_temp.maham_row(v_rows, 1006, v_steps[10], 'Recent calls to the email-alerts function', 'OK',
            case when v_a = 0 then 'No call in the last hours (nothing was due).'
              else format('%s calls in the last hours, all answered.', v_a) end);
        end if;
      exception when others then
        null;
      end;
    end if;
  end if;

  -- 11. Data and privacy ------------------------------------------------------------

  begin
    select count(*) into v_a from public.companies;
    v_rows := pg_temp.maham_row(v_rows, 1101, v_steps[11], 'Companies in the cloud', 'OK',
      case when v_a = 0 then 'None yet.' when v_a = 1 then '1 company.' else format('%s companies.', v_a) end);

    select count(*) filter (where x.owners = 0), count(*) filter (where x.owners > 1)
    into v_a, v_b
    from (
      select (
        select count(*) from public.company_members m where m.company_id = c.id and m.role = 'owner'
      ) as owners
      from public.companies c
    ) as x;
    if v_a + v_b > 0 then
      v_rows := pg_temp.maham_row(v_rows, 1102, v_steps[11], 'Each company has exactly one owner', 'FAIL',
        format('%s %s no owner and %s more than one. Nobody can change the team or the rules there: '
          || 'ask the developer.', v_a, case when v_a = 1 then 'company has' else 'companies have' end, v_b));
    else
      v_rows := pg_temp.maham_row(v_rows, 1102, v_steps[11], 'Each company has exactly one owner', 'OK',
        'Every company has one owner (the Super Admin).');
    end if;

    select string_agg(r.role || ' ' || coalesce(c.n, 0), ', ' order by r.ord), coalesce(sum(c.n), 0)
    into v_list, v_a
    from unnest(array['owner', 'admin', 'accountant', 'staff', 'viewer']) with ordinality as r(role, ord)
    left join (
      select m.role::text as role, count(*) as n from public.company_members m group by m.role
    ) as c on c.role = r.role;
    v_status := 'OK';
    v_text := format('%s %s: %s.', v_a, case when v_a = 1 then 'member' else 'members' end, v_list);
    if v_ran[5] then
      execute 'select count(*) from public.company_members m '
        || 'where m.can_approve and m.role in (''admin'', ''accountant'')'
        into v_b;
      execute 'select count(*) from (select m.company_id from public.company_members m '
        || 'where m.can_approve and m.role in (''admin'', ''accountant'') '
        || 'group by m.company_id having count(*) > 2) x'
        into v_c;
      v_text := v_text || format(' %s may approve besides the owners.', v_b);
      if v_c > 0 then
        v_status := 'WARN';
        v_text := v_text || format(' %s %s more than two of them; the app allows two.', v_c,
          case when v_c = 1 then 'company has' else 'companies have' end);
      end if;
    end if;
    v_rows := pg_temp.maham_row(v_rows, 1103, v_steps[11], 'Members by role', v_status, v_text);

    select count(*), count(distinct r.tbl), count(*) filter (where r.tbl = any (v_private_kinds)),
      count(*) filter (where not (r.tbl = any (v_kinds)))
    into v_a, v_b, v_c, v_d
    from public.records r;
    if v_d > 0 then
      select string_agg(distinct r.tbl, ', ') into v_list
      from public.records r
      where not (r.tbl = any (v_kinds)) and r.tbl ~ '^[A-Za-z]{1,40}$';
      v_rows := pg_temp.maham_row(v_rows, 1104, v_steps[11], 'Records by kind', 'FAIL',
        format('%s records are of kinds the app doesn''t sync (%s), so they never reach a device. '
          || 'Ask the developer.', v_d, coalesce(v_list, 'unnamed')));
    else
      v_rows := pg_temp.maham_row(v_rows, 1104, v_steps[11], 'Records by kind', 'OK',
        format('%s records of %s kinds, %s of them payroll and people data. None is of a kind the '
          || 'app doesn''t sync.', v_a, v_b, v_c));
    end if;

    if v_ran[5] then
      select count(*) into v_a
      from public.records r
      where r.tbl = 'approvals' and coalesce(r.data ->> 'status', '') = 'pending';
      v_rows := pg_temp.maham_row(v_rows, 1105, v_steps[11], 'Approval requests waiting', 'OK',
        case when v_a = 0 then 'None waiting.'
          else format('%s waiting for a decision (Approvals, in the app).', v_a) end);
    end if;

    select count(*), count(*) filter (where m.deleted_at < now() - interval '32 days')
    into v_a, v_b
    from public.deleted_records m;
    if v_b > 0 then
      v_rows := pg_temp.maham_row(v_rows, 1106, v_steps[11], 'Deletion markers cleaned up', 'WARN',
        format('%s of the %s deletion markers are older than 30 days: the daily clean-up isn''t '
          || 'running (see the pg_cron rows). Nothing is lost: a device away longer than 30 days '
          || 'downloads everything again.', v_b, v_a));
    else
      v_rows := pg_temp.maham_row(v_rows, 1106, v_steps[11], 'Deletion markers cleaned up', 'OK',
        format('%s deletion markers, none older than 30 days.', v_a));
    end if;

    if v_ran[6] then
      execute 'select count(*), count(*) filter (where e.at < now() - interval ''182 days'') '
        || 'from public.change_events e'
        into v_a, v_b;
      if v_b > 0 then
        v_rows := pg_temp.maham_row(v_rows, 1107, v_steps[11], 'Old changes cleaned up', 'WARN',
          format('%s of the %s changes of the team are older than 180 days: their daily clean-up '
            || 'isn''t running (see the pg_cron rows).', v_b, v_a));
      else
        v_rows := pg_temp.maham_row(v_rows, 1107, v_steps[11], 'Old changes cleaned up', 'OK',
          format('%s changes of the team kept, none older than 180 days.', v_a));
      end if;
    end if;
  exception when others then
    v_rows := pg_temp.maham_row(v_rows, 1101, v_steps[11], 'Data', 'FAIL',
      format('The data could not be counted (error %s). Run this check as the postgres user (the '
        || 'SQL editor does), or ask the developer.', sqlstate));
  end;

  -- Staff and viewers never read payroll and people data. Checked from the
  -- rules themselves: nobody is impersonated. Each problem comes with the
  -- scripts that fix it, or none when only a person can.
  v_problems := '{}';
  v_fix := '{}';
  v_bool := false;
  -- Row-level security on the tables that hold people data.
  select coalesce(array_agg(t.rel || ' has row-level security off'), '{}') into v_list_arr
  from unnest(array[
    'public.records', 'public.deleted_records', 'storage.objects', 'public.company_members',
    'public.companies', 'public.profiles', 'public.company_invites', 'public.sync_signals'
  ]) as t(rel)
  where to_regclass(t.rel) is not null
    and not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(t.rel));
  if cardinality(v_list_arr) > 0 then
    v_problems := v_problems || v_list_arr;
    v_bool := true;
  end if;
  -- The read rules: the one every member goes through, and the restrictive
  -- ones that keep people data and manpower costings from staff and viewers.
  for v_job in
    select p.step, p.rel, p.name
    from (
      values
        (1, 'public.records', 'Members: read records', true),
        (4, 'public.records', 'People data: kept from staff and viewers', false),
        (4, 'public.deleted_records', 'People data: kept from staff and viewers', false),
        (4, 'storage.objects', 'People data: kept from staff and viewers', false),
        (8, 'public.records', 'Manpower costings: kept from staff and viewers', false),
        (8, 'public.deleted_records', 'Manpower costings: kept from staff and viewers', false)
    ) as p(step, rel, name, permissive)
    where v_ran[p.step]
      and not exists (
        select 1
        from pg_policy x
        where x.polrelid = to_regclass(p.rel) and x.polname = p.name
          and x.polpermissive = p.permissive and x.polcmd = 'r'
      )
  loop
    v_problems := v_problems || ('the rule "' || v_job.name || '" on ' || v_job.rel || ' is missing');
    if v_job.step = 1 then
      v_bool := true;
    else
      v_fix := v_fix || pg_temp.maham_closure(v_job.step);
    end if;
  end loop;
  if cardinality(v_private_bad) > 0 then
    v_problems := v_problems
      || ('record_is_private doesn''t keep ' || array_to_string(v_private_bad, ', ') || ' private');
    v_fix := v_fix || pg_temp.maham_closure(8);
  end if;
  -- The roles the app signs in with never get past row-level security.
  select coalesce(array_agg(format('the role %s %s', r.rolname,
      case when r.rolsuper then 'is a superuser' else 'bypasses row-level security' end)), '{}')
  into v_list_arr
  from pg_roles r
  where r.rolname in ('anon', 'authenticated') and (r.rolbypassrls or r.rolsuper);
  if cardinality(v_list_arr) > 0 then
    v_problems := v_problems || v_list_arr;
    v_bool := true;
  end if;
  select coalesce(array_agg(format('%s belongs to the role %s', c.oid::regclass, r.rolname)), '{}')
  into v_list_arr
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where r.rolname in ('anon', 'authenticated')
    and c.oid in (
      select to_regclass(t.rel)::oid
      from unnest(array[
        'public.records', 'public.deleted_records', 'public.company_members', 'public.companies',
        'public.profiles', 'public.company_invites', 'public.sync_signals'
      ]) as t(rel)
      where to_regclass(t.rel) is not null
    );
  if cardinality(v_list_arr) > 0 then
    v_problems := v_problems || v_list_arr;
    v_bool := true;
  end if;
  -- Nobody added a rule that lets more people read records.
  select coalesce(array_agg('the rule "' || left(x.polname, 60) || '" on '
      || x.polrelid::regclass::text || ' was added by hand and adds access'), '{}')
  into v_list_arr
  from pg_policy x
  where x.polpermissive
    and x.polrelid in (
      select to_regclass(t.rel)::oid
      from unnest(array['public.records', 'public.deleted_records']) as t(rel)
      where to_regclass(t.rel) is not null
    )
    and x.polname not in (
      'Members: read records', 'Members: add records', 'Members: change records',
      'Members: delete records', 'Members: read deletions'
    );
  if cardinality(v_list_arr) > 0 then
    v_problems := v_problems || v_list_arr;
    v_bool := true;
  end if;
  v_fix := array(select distinct u.s from unnest(v_fix) as u(s) where u.s > 1 order by u.s);
  if cardinality(v_problems) = 0 then
    v_rows := pg_temp.maham_row(v_rows, 1108, v_steps[11], 'Staff and viewers can''t read payroll and people data', 'OK',
      'Row-level security is on, the rules that keep payroll'
      || case when v_ran[8] then ', people data and manpower costings' else ' and people data' end
      || ' from staff and viewers are there'
      || case when v_ran[8] then ', record_is_private knows every private kind,' else '' end
      || ' and nobody added a rule that opens them.');
  else
    v_rows := pg_temp.maham_row(v_rows, 1108, v_steps[11], 'Staff and viewers can''t read payroll and people data', 'FAIL',
      rtrim('Not right: ' || array_to_string(v_problems[1:8], '; ')
        || case when cardinality(v_problems) > 8 then format(' and %s more', cardinality(v_problems) - 8) else '' end
        || '. '
        || case when cardinality(v_fix) > 0 then pg_temp.maham_advice(v_fix, v_ran) || ' ' else '' end
        || case when v_bool
          then 'For a rule added by hand, delete it in Database → Policies; for anything else, ask the developer.'
          else '' end),
      v_fix, v_bool);
  end if;

  return query
    select (x ->> 'n')::integer, x ->> 'step', x ->> 'check', x ->> 'status', x ->> 'detail'
    from jsonb_array_elements(pg_temp.maham_summary(v_rows, v_ran)) as x;
end
$hc$;

select o_step as step, o_check as "check", o_status as status, o_detail as detail
from pg_temp.maham_health_check()
order by o_n;
