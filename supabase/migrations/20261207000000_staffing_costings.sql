-- =============================================================================
-- Maham One cloud: manpower costings of Maham People
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261130000000_people_alerts.sql. It is safe to run
-- again. If 20261102000000_tables_v16.sql,
-- 20261116000000_super_admin_approvals.sql,
-- 20261123000000_change_feed.sql or 20261130000000_people_alerts.sql is
-- ever run again, run this file again after them.
--
-- Until it runs, the app keeps working as before: it asks the server what it
-- has (server_features) and keeps Maham People → Manpower costing off in
-- companies kept in the cloud. Once it has run, nothing changes either until
-- someone turns the costing on there.
--
-- What it adds
--   * public.records takes one more kind of record: manpower costings
--     (staffingCostings, #3). A costing prices posts of guards, cleaners and
--     other staff from their salaries, with overhead and a margin, and makes
--     a quote with sell prices only (the quote is an ordinary document, with
--     the costing's id as costingId and nothing else of it).
--   * Manpower costings are payroll and people data: staff and viewers never
--     read them, nor their activity (entity "costing"), nor their deletion
--     markers, and never write them. record_is_private says so, and a second
--     read rule keeps them from staff and viewers even if an earlier file is
--     run again after this one and puts back a record_is_private that doesn't
--     know them. staff_can_write stays as it was (it never named them).
--   * For the owner's limits on a member (company_members.permissions),
--     costings are Maham People's (record_app): a member given view only or
--     no access to Maham People doesn't store them. The four apps of the
--     limits stay as they are.
--   * In the changes of the team (the bell), a costing changed is a change
--     to payroll and people data (change_kind), private: it says only what
--     happened.
--   * public.server_features() also answers 'staffing_costings'.
--   * The daily clean-up of deletion markers is scheduled when pg_cron is on,
--     as the first and fourth files do: once there are costings neither of
--     them can run again, so turning pg_cron on and running this file is
--     enough.
--
-- Every function this file replaces is as the latest earlier file left it,
-- with only what is said above added.
-- =============================================================================

do $$
begin
  if to_regprocedure('almailbooks.people_shut(text)') is null
    or to_regprocedure('almailbooks.letters_on(text)') is null
    or to_regprocedure('almailbooks.payroll_approval_on(text)') is null then
    raise exception 'Run 20261130000000_people_alerts.sql first, then this file.';
  end if;
end
$$;

-- Tables ------------------------------------------------------------------------

alter table public.records drop constraint if exists records_tbl_check;
alter table public.records
  add constraint records_tbl_check check (tbl in (
    'companies', 'clients', 'products', 'taxRates', 'documents', 'payments', 'recurring',
    'activities', 'accounts', 'journals', 'expenses', 'attachments', 'vatReturns',
    'bankTransactions', 'employees', 'complianceDocuments', 'renewals', 'complianceMarks',
    'peopleSettings', 'securityCheques', 'assets', 'depreciationRuns', 'yearEnds', 'payRuns',
    'payrollSettings', 'leaveRecords', 'staffLoans', 'finalSettlements', 'warehouses',
    'stockMovements', 'stockEntries', 'landedCosts', 'chequeLayouts', 'vehicles', 'approvals',
    'letterTemplates', 'employeeLetters', 'staffingCostings'
  ));

-- Helpers (not callable through the API) ---------------------------------------

-- Payroll and people data, seen only by owners, admins and accountants. As
-- in 20261102000000_tables_v16.sql, with manpower costings and their
-- activity.
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
    'finalSettlements', 'letterTemplates', 'employeeLetters', 'staffingCostings'
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
    when 'complianceDocuments' then
      return almailbooks.document_is_private(p_data);
    when 'renewals' then
      return almailbooks.renewal_is_private(p_company, p_data);
    when 'journals' then
      -- Payroll entries show salaries.
      return coalesce(p_data ->> 'kind', '') = 'payroll';
    when 'approvals' then
      -- A request about a record of the tables above (a pay run, a letter).
      return almailbooks.record_is_private(p_company, p_data ->> 'subjectTbl', null);
    when 'activities' then
      -- About an employee, payroll or a manpower costing (even once it is gone).
      if coalesce(p_data ->> 'entity', '') in ('employee', 'payroll', 'costing') then
        return true;
      end if;
      -- About an employee's papers or a confidential document: private even
      -- once the document is gone.
      if coalesce(p_data ->> 'employeeId', '') <> ''
        or coalesce(p_data ->> 'confidential', '') = 'true' then
        return true;
      end if;
      if p_data ->> 'entity' = 'compliance' then
        return exists (
          select 1
          from public.records o
          where o.company_id = p_company
            and o.tbl in ('complianceDocuments', 'renewals')
            and o.id = p_data ->> 'entityId'
            and case
              when o.tbl = 'complianceDocuments' then almailbooks.document_is_private(o.data)
              else almailbooks.renewal_is_private(p_company, o.data)
            end
        );
      end if;
      return false;
    when 'attachments' then
      -- Scans in a personnel file, of a letter, or of a private document.
      return exists (
        select 1
        from public.records o
        where o.company_id = p_company
          and o.tbl in (
            'employees', 'letterTemplates', 'employeeLetters', 'complianceDocuments', 'renewals'
          )
          and o.id = p_data ->> 'ownerId'
          and case
            when o.tbl = 'complianceDocuments' then almailbooks.document_is_private(o.data)
            when o.tbl = 'renewals' then almailbooks.renewal_is_private(p_company, o.data)
            else true
          end
      );
    else
      return false;
  end case;
end
$$;

-- The records of 20261102000000_tables_v16.sql that staff and viewers never
-- read, whatever record_is_private says. As in that file, with manpower
-- costings among the payroll and people data approval requests may be about.
create or replace function almailbooks.can_read_v16_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tbl not in (
    'letterTemplates', 'employeeLetters', 'approvals', 'complianceDocuments', 'renewals',
    'attachments', 'activities'
  ) then
    return true;
  end if;
  -- Activity about anything but the register: the first file's rule knows it.
  if p_tbl = 'activities'
    and coalesce(p_data ->> 'entity', '') <> 'compliance'
    and coalesce(p_data ->> 'employeeId', '') = ''
    and coalesce(p_data ->> 'confidential', '') <> 'true' then
    return true;
  end if;
  if almailbooks.member_role(p_company) in ('owner', 'admin', 'accountant') then
    return true;
  end if;
  if p_tbl = 'attachments' then
    return not almailbooks.is_v16_private_owner(p_company, p_data ->> 'ownerId');
  end if;
  if p_tbl = 'activities' then
    -- Marked as about an employee's papers or a confidential document, which
    -- may be gone.
    return coalesce(p_data ->> 'employeeId', '') = ''
      and coalesce(p_data ->> 'confidential', '') <> 'true'
      and not almailbooks.is_v16_private_owner(p_company, p_data ->> 'entityId');
  end if;
  if p_tbl in ('letterTemplates', 'employeeLetters') then
    return false;
  end if;
  if p_tbl = 'approvals' then
    return coalesce(p_data ->> 'subjectTbl', '') not in (
      'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
      'finalSettlements', 'letterTemplates', 'employeeLetters', 'staffingCostings'
    );
  end if;
  if p_tbl = 'complianceDocuments' then
    return coalesce(p_data ->> 'confidential', '') <> 'true';
  end if;
  -- A renewal of a confidential document.
  return not exists (
    select 1
    from public.records d
    where d.company_id = p_company
      and d.tbl = 'complianceDocuments'
      and d.id = almailbooks.renewed_document_id(p_data)
      and coalesce(d.data ->> 'confidential', '') = 'true'
  );
end
$$;

-- The app a record belongs to, for the owner's limits on a member. As in
-- 20261116000000_super_admin_approvals.sql, with manpower costings in Maham
-- People. Kept the same as recordApp in src/cloud/roles.ts.
create or replace function almailbooks.record_app(p_tbl text, p_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tbl in (
      'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
      'finalSettlements', 'letterTemplates', 'employeeLetters', 'staffingCostings'
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

-- The kind of change a record makes, for the changes of the team. As in
-- 20261123000000_change_feed.sql, with manpower costings among payroll and
-- people data. Kept the same as changeKind in src/cloud/change-feed.ts.
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
      'finalSettlements', 'letterTemplates', 'employeeLetters', 'staffingCostings'
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

-- Row-level security ----------------------------------------------------------------

-- Restrictive: manpower costings and their activity are read only by owners,
-- admins and accountants, whatever record_is_private says (an earlier file
-- run again puts back one that doesn't know them). Every other record
-- passes without a call.
drop policy if exists "Manpower costings: kept from staff and viewers" on public.records;
create policy "Manpower costings: kept from staff and viewers" on public.records
  as restrictive
  for select to authenticated
  using (
    (
      tbl <> 'staffingCostings'
      and not (tbl = 'activities' and coalesce(data ->> 'entity', '') = 'costing')
    )
    or almailbooks.member_role(company_id) in ('owner', 'admin', 'accountant')
  );

-- Their deletion markers too.
drop policy if exists "Manpower costings: kept from staff and viewers" on public.deleted_records;
create policy "Manpower costings: kept from staff and viewers" on public.deleted_records
  as restrictive
  for select to authenticated
  using (
    tbl <> 'staffingCostings'
    or almailbooks.member_role(company_id) in ('owner', 'admin', 'accountant')
  );

-- Functions the app calls ------------------------------------------------------------

-- What this server has beyond the first files: as the people alerts file
-- says, and staffing_costings this one.
create or replace function public.server_features()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array[
    'tables_v16', 'super_admin', 'approvals', 'cheque_approvals', 'change_feed',
    'payroll_approvals', 'document_alerts', 'employee_letters', 'staffing_costings'
  ]::text[]
$$;

-- Daily clean-up of deletion markers (when pg_cron is enabled) ---------------------------

-- As 20261102000000_tables_v16.sql schedules it: turning pg_cron on and
-- running this file is enough (the first and fourth files can't run again
-- once there are costings).
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

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.can_read_v16_record(text, text, jsonb),
  almailbooks.record_app(text, jsonb)
from public, anon;
grant execute on function
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.can_read_v16_record(text, text, jsonb),
  almailbooks.record_app(text, jsonb)
to authenticated;
revoke all on function almailbooks.change_kind(text, jsonb) from public, anon, authenticated;
revoke all on function public.server_features() from public, anon;
grant execute on function public.server_features() to authenticated;

-- The Data API learns about the changes at once.
notify pgrst, 'reload schema';
