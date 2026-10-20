-- =============================================================================
-- Maham One cloud: the records of database version 16
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261004000000_almailbooks_cloud.sql,
-- 20261006000000_sync_fixes.sql and 20261007000000_email_alerts.sql (it
-- doesn't need email alerts: without them, after the first two). It is safe
-- to run again.
--
-- The earlier files are not run again after this one. Once there are records
-- of the new kinds the first file can't be: it stops with an error where it
-- lists the kinds of record, and changes nothing. Run again before there are
-- any, it puts back the record_is_private that doesn't know them; this file,
-- run after it, puts this one back (the read rules below keep the new private
-- records, their files and their activity from staff and viewers meanwhile).
-- Like the first file, it schedules the daily clean-up of deletion markers
-- when pg_cron is on, so turning pg_cron on and running this file is enough.
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
--   * A second read rule on public.records, public.deleted_records and the
--     files in Storage that keeps those from staff and viewers even after the
--     first file is run again (it puts back the record_is_private that
--     doesn't know them).
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

-- A letter, a confidential register document or a renewal of one: what makes
-- a file or an activity about it private, of what the first file doesn't know.
create or replace function almailbooks.is_v16_private_owner(p_company text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.records o
    where o.company_id = p_company
      and o.tbl in ('letterTemplates', 'employeeLetters', 'complianceDocuments', 'renewals')
      and o.id = p_id
      and case
        when o.tbl = 'complianceDocuments' then coalesce(o.data ->> 'confidential', '') = 'true'
        when o.tbl = 'renewals' then exists (
          select 1
          from public.records d
          where d.company_id = p_company
            and d.tbl = 'complianceDocuments'
            and d.id = almailbooks.renewed_document_id(o.data)
            and coalesce(d.data ->> 'confidential', '') = 'true'
        )
        else true
      end
  )
$$;

-- The records of this file that staff and viewers never read, whatever
-- record_is_private says (the first file, run again, puts back one that
-- doesn't know them), with the files and activity about them. Every other
-- record passes at once.
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

-- The file of an attachment record that staff and viewers never read (see
-- above). A file without its record passes: "AlmailBooks files: read" decides.
create or replace function almailbooks.can_read_v16_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folders text[] := storage.foldername(p_name);
  v_data jsonb;
begin
  if coalesce(array_length(v_folders, 1), 0) <> 1 then
    return true;
  end if;
  select r.data into v_data
  from public.records r
  where r.company_id = v_folders[1] and r.tbl = 'attachments' and r.id = storage.filename(p_name);
  if not found then
    return true;
  end if;
  return almailbooks.can_read_v16_record(v_folders[1], 'attachments', v_data);
end
$$;

-- Restrictive: a record is read only when this rule and "Members: read
-- records" both let it through. Other kinds of record, and activity about
-- anything but the register, pass without a call.
drop policy if exists "People data: kept from staff and viewers" on public.records;
create policy "People data: kept from staff and viewers" on public.records
  as restrictive
  for select to authenticated
  using (
    tbl not in (
      'letterTemplates', 'employeeLetters', 'approvals', 'complianceDocuments', 'renewals',
      'attachments', 'activities'
    )
    or (
      tbl = 'activities'
      and coalesce(data ->> 'entity', '') <> 'compliance'
      and coalesce(data ->> 'employeeId', '') = ''
      and coalesce(data ->> 'confidential', '') <> 'true'
    )
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

-- Files of the records above: Storage's read rule goes through record_is_private too.
drop policy if exists "People data: kept from staff and viewers" on storage.objects;
create policy "People data: kept from staff and viewers" on storage.objects
  as restrictive
  for select to authenticated
  using (bucket_id <> 'company-files' or almailbooks.can_read_v16_file(name));

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

-- Daily clean-up of deletion markers (when pg_cron is enabled) ---------------------------

-- As the first file schedules it: turning pg_cron on and running this file is
-- enough (the first file can't run again once there are records of the new kinds).
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
  almailbooks.document_is_private(jsonb),
  almailbooks.renewed_document_id(jsonb),
  almailbooks.renewal_is_private(text, jsonb),
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.is_v16_private_owner(text, text),
  almailbooks.can_read_v16_record(text, text, jsonb),
  almailbooks.can_read_v16_file(text)
from public, anon;
grant execute on function
  almailbooks.document_is_private(jsonb),
  almailbooks.renewed_document_id(jsonb),
  almailbooks.renewal_is_private(text, jsonb),
  almailbooks.record_is_private(text, text, jsonb),
  almailbooks.is_v16_private_owner(text, text),
  almailbooks.can_read_v16_record(text, text, jsonb),
  almailbooks.can_read_v16_file(text)
to authenticated;

revoke all on function public.server_features() from public, anon;
grant execute on function public.server_features() to authenticated;

-- The Data API learns about the new function at once.
notify pgrst, 'reload schema';
