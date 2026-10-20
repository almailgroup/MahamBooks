-- =============================================================================
-- Maham One cloud: the records of database version 16
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261004000000_almailbooks_cloud.sql,
-- 20261006000000_sync_fixes.sql and 20261007000000_email_alerts.sql (it
-- doesn't need email alerts: without them, after the first two). It is safe
-- to run again. If the first file is ever run again, run this one again
-- after it: both define the kinds of record and record_is_private (the read
-- rule below keeps the new private records from staff and viewers meanwhile).
-- Once there are records of the new kinds, the first file stops with an error
-- where it lists the kinds of record; this file, run next, puts them back.
--
-- Until it runs, the app keeps working as before: it asks the server what it
-- has (server_features) and keeps the features that use these records hidden.
--
-- What it adds
--   * public.records takes five more kinds of record: cheque layouts,
--     vehicles, approval requests, letter templates and employee letters.
--     None of them can be changed by staff.
--   * Payroll and people data, which staff and viewers never see, now also
--     covers letter templates and employee letters, approval requests about
--     payroll or people data, and register documents marked confidential
--     with their renewals, files and activity.
--   * A second read rule on public.records and public.deleted_records that
--     keeps those from staff and viewers even after the first file is run
--     again (it puts back the record_is_private that doesn't know them).
--   * public.server_features(): what this server has beyond the first files.
-- =============================================================================

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
    'letterTemplates', 'employeeLetters'
  ));

-- Helpers (not callable through the API) ---------------------------------------

-- A register document of an employee, or one marked confidential.
create or replace function almailbooks.document_is_private(p_data jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_data ->> 'employeeId', '') <> ''
    or coalesce(p_data ->> 'confidential', '') = 'true'
$$;

-- The register document a renewal is of ("doc:<id>"); null for an employee's own papers.
create or replace function almailbooks.renewed_document_id(p_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(p_data ->> 'documentId', ''),
    case when p_data ->> 'documentKey' like 'doc:_%' then substr(p_data ->> 'documentKey', 5) end
  )
$$;

-- A renewal of an employee's paper, or of a private register document.
create or replace function almailbooks.renewal_is_private(p_company text, p_data jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_data ->> 'employeeId', '') <> ''
    or exists (
      select 1
      from public.records d
      where d.company_id = p_company
        and d.tbl = 'complianceDocuments'
        and d.id = almailbooks.renewed_document_id(p_data)
        and almailbooks.document_is_private(d.data)
    )
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
    'finalSettlements', 'letterTemplates', 'employeeLetters'
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

-- The records of this file that staff and viewers never read, whatever
-- record_is_private says (the first file, run again, puts back one that
-- doesn't know them). Every other record passes at once.
create or replace function almailbooks.can_read_v16_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tbl not in (
    'letterTemplates', 'employeeLetters', 'approvals', 'complianceDocuments', 'renewals'
  ) then
    return true;
  end if;
  if almailbooks.member_role(p_company) in ('owner', 'admin', 'accountant') then
    return true;
  end if;
  if p_tbl in ('letterTemplates', 'employeeLetters') then
    return false;
  end if;
  if p_tbl = 'approvals' then
    return coalesce(p_data ->> 'subjectTbl', '') not in (
      'employees', 'payRuns', 'payrollSettings', 'peopleSettings', 'leaveRecords', 'staffLoans',
      'finalSettlements', 'letterTemplates', 'employeeLetters'
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

-- Row-level security ----------------------------------------------------------------

-- Restrictive: a record is read only when this rule and "Members: read
-- records" both let it through. Other kinds of record pass without a call.
drop policy if exists "People data: kept from staff and viewers" on public.records;
create policy "People data: kept from staff and viewers" on public.records
  as restrictive
  for select to authenticated
  using (
    tbl not in ('letterTemplates', 'employeeLetters', 'approvals', 'complianceDocuments', 'renewals')
    or almailbooks.can_read_v16_record(company_id, tbl, data)
  );

-- Deletion markers of letters, even when they were not marked private.
drop policy if exists "People data: kept from staff and viewers" on public.deleted_records;
create policy "People data: kept from staff and viewers" on public.deleted_records
  as restrictive
  for select to authenticated
  using (
    tbl not in ('letterTemplates', 'employeeLetters')
    or almailbooks.member_role(company_id) in ('owner', 'admin', 'accountant')
  );

-- Functions the app calls ------------------------------------------------------------

-- What this server has beyond the first files, so the app shows a feature
-- only once the server has what it needs: tables_v16 is this file.
create or replace function public.server_features()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array['tables_v16']::text[]
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.document_is_private(jsonb),
  almailbooks.renewed_document_id(jsonb),
  almailbooks.renewal_is_private(text, jsonb),
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.can_read_v16_record(text, text, jsonb)
from public, anon;
grant execute on function
  almailbooks.document_is_private(jsonb),
  almailbooks.renewed_document_id(jsonb),
  almailbooks.renewal_is_private(text, jsonb),
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.can_read_v16_record(text, text, jsonb)
to authenticated;

revoke all on function public.server_features() from public, anon;
grant execute on function public.server_features() to authenticated;

-- The Data API learns about the new function at once.
notify pgrst, 'reload schema';
