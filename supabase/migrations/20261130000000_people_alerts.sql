-- =============================================================================
-- Maham One cloud: People alerts (salary approval by the Super Admin,
-- expiry alerts with lead times and re-upload reminders, and employee
-- letters)
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261123000000_change_feed.sql. It is safe to run
-- again. If 20261116000000_super_admin_approvals.sql or
-- 20261123000000_change_feed.sql is ever run again, run this file again
-- after them. The emails need 20261007000000_email_alerts.sql too (the
-- address of the email-alerts function and its secret, and the email
-- alerts themselves); if that one is run again (or for the first time)
-- after this file, run this file again after it.
--
-- Until it runs, the app keeps working as before: it asks the server what it
-- has (server_features) and keeps Settings → Approvals → Pay runs, the
-- kinds of paper of Settings → Email alerts, and employee letters, hidden.
-- Once it has run, nothing changes either until the owner (the Super Admin)
-- turns on "Pay runs need the Super Admin's approval" there: until then a
-- pay run is approved (posted) as before, and nothing here looks at it.
--
-- What it adds
--   * Salary approval (#10): with the owner's switch on (approvalRules
--     "payroll": true on the company record), a draft pay run is sent for
--     approval as a request (an approvals row of kind "payroll", private as
--     the pay run is, with its totals by department and position and never
--     anyone's own pay). records_guard keeps it honest: a request is
--     approved only for the pay run as it is stored (it is refused with
--     "almail:invalid" when the run changed since it was sent), never by a
--     member allowed to approve who sent it themselves (the owner may), and
--     whoever may post the pay run marks its approved request done once it
--     is posted. Every rule records_guard had stays as it was. Refusals have
--     the SQL state 42501, which older versions of the app keep aside.
--     The app posts a pay run only once it is approved; the server doesn't
--     refuse the posting itself, since its journal entries are separate
--     records an older version would still send: update every device before
--     turning the switch on.
--   * An email to the owner and the members allowed to approve (not to
--     whoever sent it) when a pay run is sent for approval, through the
--     email-alerts function: the totals by department and position, in each
--     person's language, with a link that opens the signed-in app. Never
--     names, Civil IDs, IBANs or anyone's own pay. A trigger asks the
--     function at once (with pg_net); the 5-minute schedule of the change
--     feed asks again for any not sent yet, for three days.
--     almailbooks.approval_emails keeps what was sent to whom. A problem
--     there never stops a sync.
--   * Expiry alerts (#18): accountants may get the morning email alerts too
--     (set_email_alerts, same four arguments, now takes them; someone who
--     stops being the owner, an admin or an accountant stops getting them),
--     and each person chooses the kinds of paper they are told about
--     (email_alerts.document_kinds: company, vehicle, staff, client; null is
--     all of them, as before) with email_alert_scope and
--     set_email_alert_scope. The email-alerts function leaves out, for each
--     person, the papers of the apps the owner gave them no access to. No
--     new kind of alert: older versions of the app keep the ones they know.
--     The lead times by document type, the reminders after expiry and the
--     new copy asked for after a renewal are the company's (its People
--     settings record); nothing here changes while they are not set.
--   * With "Show the reminders in Updates" on (the company's People
--     settings), the function also writes each new reminder to the change
--     feed (kind document_expiry, by nobody), for the bell of the owner and
--     the approvers; the 5-minute emails of the changes leave them out. The
--     hourly schedule of the email alerts asks the function for them too.
--     Reminders about employees' papers are private, without names.
--   * Employee letters (#19): with the company's letters on (People →
--     Letters → Use employee letters, "letters": true on its People
--     settings record; off, nothing here looks at a letter), records_guard
--     lets only the owner, an admin or an approver issue a letter, or change
--     or void one that is issued (an accountant drafts it and asks through
--     an approval request of kind "letter"; marking it printed is anyone's),
--     never takes a letter that is issued or void back to a draft, and
--     can_delete_record never deletes one, so its number stays used. Only
--     the owner or an admin turns letters on or off: anyone else's copy of
--     the People settings keeps the switch as it is stored. Every other rule
--     of records_guard and can_delete_record stays as it was. Letters are
--     never emailed.
--   * public.server_features() also answers 'payroll_approvals',
--     'document_alerts' and 'employee_letters'.
-- =============================================================================

do $$
begin
  if to_regprocedure('almailbooks.records_guard()') is null
    or to_regprocedure('almailbooks.is_approver(text)') is null
    or to_regprocedure('almailbooks.run_change_notifications()') is null then
    raise exception 'Run 20261123000000_change_feed.sql first, then this file.';
  end if;
end
$$;

-- Tables ------------------------------------------------------------------------

-- The emails of a pay run's request for approval: one row per approver.
-- Only the email-alerts function (with the database's own connection) reads
-- and writes it.
create table if not exists almailbooks.approval_emails (
  company_id text not null references public.companies (id) on delete cascade,
  approval_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Emailed; or, with finished_at only, nothing more to do (decided, not an
  -- approver any more, no confirmed address).
  sent_at timestamptz,
  finished_at timestamptz,
  attempts integer not null default 0,
  -- A run of the function is working on it until then.
  claimed_until timestamptz,
  last_error text not null default '',
  last_error_at timestamptz,
  primary key (company_id, approval_id, user_id)
);
alter table almailbooks.approval_emails drop constraint if exists approval_emails_last_error_length;
alter table almailbooks.approval_emails
  add constraint approval_emails_last_error_length check (char_length(last_error) <= 1000);
create index if not exists approval_emails_waiting
  on almailbooks.approval_emails (created_at)
  where finished_at is null;
alter table almailbooks.approval_emails enable row level security;
revoke all on almailbooks.approval_emails from public, anon, authenticated;

-- Helpers (not callable through the API) ---------------------------------------

-- The owner's switch: pay runs need the Super Admin's approval.
create or replace function almailbooks.payroll_approval_on(p_company text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(almailbooks.approval_rules(p_company) ->> 'payroll' = 'true', false)
$$;

-- Whether the company's employee letters are on (#19): its People settings
-- record says "letters": true. Missing, as every company has it before, is off.
create or replace function almailbooks.letters_on(p_company text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select r.data ->> 'letters' = 'true'
      from public.records r
      where r.company_id = p_company and r.tbl = 'peopleSettings' and r.id = p_company
    ),
    false
  )
$$;

-- The caller issues letters, and changes or voids issued ones: the owner, an
-- admin, or an accountant the owner allowed to approve. Kept the same as
-- issuesLetters in src/cloud/roles.ts.
create or replace function almailbooks.issues_letters(p_company text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(almailbooks.member_role(p_company)::text, '') in ('owner', 'admin')
    or almailbooks.is_approver(p_company)
$$;

-- What a letter says and is: all of it but when it was last printed and
-- saved. Kept the same as letterContent in src/cloud/roles.ts.
create or replace function almailbooks.letter_content(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(coalesce(p, '{}'::jsonb) - 'printedAt' - 'updatedAt')
$$;

-- What the server checks before a record is stored, after
-- records_before_write (triggers of the same kind run in the order of their
-- names). Only the company record, documents, approval requests, cheque
-- payments, security cheques given, the People settings and employee
-- letters are looked at; every other record passes at once. Approval requests are kept honest whether or not the
-- company's rules are on (nothing wrote them before this file). With "Number
-- invoices and credit notes when they are issued" on, neither is issued
-- without its number (older versions of the app don't give one when they
-- issue a draft). Everything else waits for the company's rules (the
-- approval rules themselves are the owner's either way). Refusals have the
-- SQL state 42501.
--
-- As in 20261116000000_super_admin_approvals.sql, with every rule it has,
-- and salary approval (#10): with the owner's switch on (approvalRules
-- "payroll": true; off, a pay run's request is kept as any other), a pay
-- run's request is approved only for the pay run as it is stored (its
-- updatedAt is the one the request was made for), never by an approver who
-- sent it unless they are the owner, and one sent up already approved by
-- anyone but the owner waits like a new one. Whoever may post the pay run
-- marks its approved request done (applied) once it is posted; the owner,
-- who may post a pay run at once, does so with a waiting one as it is.
--
-- And employee letters (#19): only the owner or an admin changes the
-- letters switch of the People settings (anyone else's copy keeps it); with
-- the letters on, only the owner, an admin or an approver issues a letter or
-- changes or voids an issued one, and a letter issued or void never goes back
-- to a draft. With them off, letters pass as before.
create or replace function almailbooks.records_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rules jsonb;
  v_approver boolean;
  v_me text := auth.uid()::text;
  v_now jsonb;
  v_status text;
  v_was text;
  v_key text;
  v_payroll boolean := false;
  v_role public.member_role;
  v_run text;
begin
  -- The SQL editor and the server's own jobs are not members.
  if new.tbl not in (
      'companies', 'documents', 'approvals', 'payments', 'securityCheques',
      'peopleSettings', 'employeeLetters'
    )
    or auth.uid() is null then
    return new;
  end if;
  -- Payments other than cheques, and security cheques received, at once.
  if new.tbl = 'payments'
    and coalesce(new.data ->> 'method', '') <> 'cheque'
    and (tg_op = 'INSERT' or coalesce(old.data ->> 'method', '') <> 'cheque') then
    return new;
  end if;
  if new.tbl = 'securityCheques'
    and coalesce(new.data ->> 'direction', '') <> 'out'
    and (tg_op = 'INSERT' or coalesce(old.data ->> 'direction', '') <> 'out') then
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

  -- The letters switch (#19) is the owner's and the admins': anyone else's
  -- copy keeps it as it is stored (a copy that hasn't heard of it yet never
  -- turns it off).
  if new.tbl = 'peopleSettings' then
    if coalesce(almailbooks.member_role(new.company_id)::text, '') not in ('owner', 'admin') then
      new.data := almailbooks.kept_key(
        new.data,
        case when tg_op = 'UPDATE' then old.data end,
        'letters'
      );
    end if;
    return new;
  end if;

  -- Employee letters (#19), with the company's letters on: a letter issued
  -- or void stays so, and only the owner, an admin or an approver issues
  -- one, or changes or voids one that is issued. Drafts are anyone's who
  -- may write them, and marking a letter printed changes nothing of it.
  if new.tbl = 'employeeLetters' then
    if not almailbooks.letters_on(new.company_id) then
      return new;
    end if;
    v_was := case when tg_op = 'UPDATE' then coalesce(old.data ->> 'status', 'draft') end;
    v_status := coalesce(new.data ->> 'status', 'draft');
    if v_was in ('issued', 'void') and v_status = 'draft' then
      raise exception 'almail:invalid This letter is already issued, so it stays issued.'
        using errcode = '42501';
    end if;
    if (v_status <> 'draft' or coalesce(v_was, 'draft') <> 'draft')
      and (
        tg_op = 'INSERT'
        or almailbooks.letter_content(old.data) is distinct from almailbooks.letter_content(new.data)
      )
      and not almailbooks.issues_letters(new.company_id) then
      raise exception 'almail:permission Only the owner, an admin or an approver issues letters. Ask for approval instead.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.tbl = 'companies' then
    -- Only the owner changes the approval rules (by a push or patch_company).
    if nullif(case when tg_op = 'UPDATE' then old.data -> 'approvalRules' end, 'null'::jsonb)
        is distinct from nullif(new.data -> 'approvalRules', 'null'::jsonb)
      and almailbooks.member_role(new.company_id) is distinct from 'owner' then
      raise exception 'almail:permission Only the owner changes the approval rules.'
        using errcode = '42501';
    end if;
    -- The books' settings are Maham Books': not changed by a member the owner
    -- made it view only for (the lock date, numbering, payment details…).
    if tg_op = 'UPDATE'
      and almailbooks.company_books_changed(old.data, new.data)
      and almailbooks.books_limited(new.company_id) then
      raise exception 'almail:permission The owner has made Maham Books view only for you.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- An invoice or credit note leaving draft (or new) and issued without a
  -- number, while the company numbers them when they are issued: an older
  -- version of the app issuing a draft that waits for its number.
  if new.tbl = 'documents'
    and coalesce(new.data ->> 'type', '') in ('invoice', 'credit')
    and almailbooks.document_stage(new.data ->> 'status') = 'issued'
    and btrim(coalesce(new.data ->> 'number', '')) = ''
    and (tg_op = 'INSERT' or coalesce(old.data ->> 'status', '') = 'draft')
    and almailbooks.numbers_on_issue(new.company_id) then
    raise exception 'almail:invalid This invoice has no number yet. Update the app on this device, then issue it again.'
      using errcode = '42501';
  end if;

  if new.tbl <> 'approvals' then
    v_rules := almailbooks.approval_rules(new.company_id);
    if v_rules is null then
      return new;
    end if;
  end if;
  v_approver := almailbooks.is_approver(new.company_id);

  if new.tbl in ('payments', 'securityCheques') then
    -- A cheque the rules cover is recorded, changed in what is confirmed on
    -- it, by approvers only; anyone else sends it for confirmation.
    -- Whoever may not write it at all is refused by the row's policies, as before.
    if not v_approver and almailbooks.cheque_change_needs_approver(
      v_rules,
      new.tbl,
      case when tg_op = 'UPDATE' then old.data end,
      new.data
    ) and almailbooks.can_write_record(new.company_id, new.tbl, new.data) then
      raise exception 'almail:approval_required This cheque needs confirmation. Send it for confirmation instead.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.tbl = 'documents' then
    -- New documents and drafts are anyone's to write, and approvers write anything.
    if tg_op = 'INSERT' or v_approver or coalesce(old.data ->> 'status', '') = 'draft'
      or not (
        almailbooks.rules_cover_document(v_rules, old.data ->> 'type')
        or almailbooks.rules_cover_document(v_rules, new.data ->> 'type')
      ) then
      return new;
    end if;
    if almailbooks.invoice_content(old.data) is distinct from almailbooks.invoice_content(new.data)
      or almailbooks.document_stage(old.data ->> 'status')
        <> almailbooks.document_stage(new.data ->> 'status') then
      raise exception 'almail:approval_required This change to an issued document needs approval. Send it for approval instead.'
        using errcode = '42501';
    end if;
    -- Its payment link, once it has one, is changed or removed by approvers
    -- only. Documents travel whole, so anyone else's copy keeps the stored
    -- link instead of being refused: a device that had not yet received the
    -- link (or its change) and records a payment on the invoice must neither
    -- undo it nor lose the payment. The app refuses a change made on purpose
    -- before it is sent (paymentLinkNeedsApprover).
    if almailbooks.payment_link_changed(old.data, new.data) then
      new.data := almailbooks.kept_key(new.data, old.data, 'paymentLink');
    end if;
    return new;
  end if;

  -- Approval requests, whether or not the rules are on.
  v_now := to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  -- A pay run's, with salary approval on (#10).
  if coalesce(case when tg_op = 'UPDATE' then old.data else new.data end ->> 'kind', '') = 'payroll'
    and coalesce(
      case when tg_op = 'UPDATE' then old.data else new.data end ->> 'subjectTbl', ''
    ) = 'payRuns' then
    v_payroll := almailbooks.payroll_approval_on(new.company_id);
  end if;
  if tg_op = 'INSERT' then
    if v_approver and coalesce(new.data ->> 'status', 'pending') <> 'pending'
      -- A pay run's sent up already approved by anyone but the owner waits.
      and not (
        v_payroll
        and new.data ->> 'status' in ('approved', 'applied')
        and almailbooks.member_role(new.company_id) is distinct from 'owner'
      ) then
      -- The owner's own copy of a decided request (the company sent up again) is kept.
      if almailbooks.member_role(new.company_id) = 'owner' then
        return new;
      end if;
      -- Anyone else's is asked and decided by them, now, whatever the copy says.
      if new.data ->> 'requestedBy' is distinct from v_me then
        new.data := (new.data - 'requestedByName')
          || jsonb_build_object('requestedBy', v_me, 'requestedAt', v_now);
      end if;
      if new.data ->> 'decidedBy' is distinct from v_me then
        new.data := new.data || jsonb_build_object('decidedBy', v_me, 'decidedAt', v_now);
      end if;
      return new;
    end if;
    -- A new request waits for a decision, asked by whoever sends it, now.
    new.data := (new.data - 'expired' - 'resultId') || jsonb_build_object(
      'status', 'pending',
      'requestedBy', v_me,
      'requestedAt', v_now,
      'decidedBy', null,
      'decidedAt', null,
      'decisionNote', ''
    );
    return new;
  end if;

  v_was := coalesce(old.data ->> 'status', 'pending');
  v_status := coalesce(new.data ->> 'status', v_was);
  if not v_approver then
    -- Whoever isn't an approver changes nothing of a request but taking it back.
    new.data := old.data
      || jsonb_build_object('status', v_status)
      || case
        when new.data ? 'updatedAt' then jsonb_build_object('updatedAt', new.data -> 'updatedAt')
        else '{}'::jsonb
      end;
  end if;
  -- What was asked, by whom and when, never changes.
  foreach v_key in array array[
    'kind', 'subjectTbl', 'subjectId', 'subjectNumber', 'before', 'after', 'reason',
    'requestedBy', 'requestedByName', 'requestedAt', 'createdAt'
  ] loop
    new.data := almailbooks.kept_key(new.data, old.data, v_key);
  end loop;
  if v_status = v_was or v_status = 'pending' or v_was in ('rejected', 'cancelled', 'applied') then
    -- No decision now (an older copy that still waits, sent again), or one
    -- made before: an older copy can't undo it.
    new.data := new.data || jsonb_build_object(
      'status', v_was,
      'decidedBy', old.data -> 'decidedBy',
      'decidedAt', old.data -> 'decidedAt',
      'decisionNote', coalesce(nullif(old.data -> 'decisionNote', 'null'::jsonb), to_jsonb(''::text))
    );
    new.data := almailbooks.kept_key(new.data, old.data, 'expired');
    new.data := almailbooks.kept_key(new.data, old.data, 'resultId');
    return new;
  end if;
  if v_status not in ('approved', 'rejected', 'cancelled', 'applied') then
    raise exception 'almail:invalid A decided request can''t wait again.' using errcode = '42501';
  end if;
  if not v_approver
    and not (
      v_was = 'pending'
      and v_status = 'cancelled'
      and old.data ->> 'requestedBy' = v_me
    )
    -- The approved pay run posted: done, by whoever may post it.
    and not (
      v_payroll
      and v_was = 'approved'
      and v_status = 'applied'
      and almailbooks.can_write_record(new.company_id, 'payRuns', '{}'::jsonb)
    ) then
    -- Whoever asked may only take the request back while it waits.
    raise exception 'almail:permission Only an approver decides approval requests.'
      using errcode = '42501';
  end if;
  -- A pay run is approved by someone other than whoever sent it (the owner
  -- may approve their own), and only as it was sent. The owner who posts it
  -- carries out a waiting request as it is.
  if v_payroll and v_was = 'pending' and v_status in ('approved', 'applied') then
    v_role := almailbooks.member_role(new.company_id);
    if old.data ->> 'requestedBy' = v_me and v_role is distinct from 'owner' then
      raise exception 'almail:permission Only the owner approves a pay run they sent for approval themselves.'
        using errcode = '42501';
    end if;
    if not (v_status = 'applied' and v_role = 'owner') then
      select r.data ->> 'updatedAt' into v_run
      from public.records r
      where r.company_id = new.company_id and r.tbl = 'payRuns' and r.id = old.data ->> 'subjectId';
      if v_run is distinct from (old.data -> 'after' ->> 'runUpdatedAt') then
        raise exception 'almail:invalid This pay run changed after it was sent for approval. Send it for approval again.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  -- Expired only when an approver cancels a waiting request, and what it
  -- made only when it is carried out.
  if not (v_approver and v_was = 'pending' and v_status = 'cancelled') then
    new.data := almailbooks.kept_key(new.data, old.data, 'expired');
  end if;
  if not (v_approver and v_status = 'applied') then
    new.data := almailbooks.kept_key(new.data, old.data, 'resultId');
  end if;
  if v_was = 'approved' and v_status = 'applied' then
    -- Carried out as approved: the decision stays the approver's.
    new.data := new.data || jsonb_build_object(
      'decidedBy', old.data -> 'decidedBy',
      'decidedAt', old.data -> 'decidedAt',
      'decisionNote', coalesce(nullif(old.data -> 'decisionNote', 'null'::jsonb), to_jsonb(''::text))
    );
  else
    new.data := new.data || jsonb_build_object(
      'decidedBy', v_me,
      'decidedAt', v_now
    );
  end if;
  return new;
end
$$;

drop trigger if exists records_guard on public.records;
create trigger records_guard
  before insert or update on public.records
  for each row execute function almailbooks.records_guard();

-- A pay run sent for approval: its approvers (the owner and the members
-- allowed to approve, not whoever sent it, nor a member the owner gave no
-- access to People) are noted, and the email-alerts function is asked to
-- email them. Only with the owner's switch on. Anything that goes wrong here
-- is ignored: it never stops a sync, and the schedule asks again.
create or replace function almailbooks.payroll_approval_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_url text;
  v_secret text;
begin
  begin
    if coalesce(new.data ->> 'status', 'pending') <> 'pending'
      or coalesce(new.data ->> 'subjectTbl', '') <> 'payRuns'
      or not almailbooks.payroll_approval_on(new.company_id) then
      return null;
    end if;
    insert into almailbooks.approval_emails (company_id, approval_id, user_id)
    select m.company_id, new.id, m.user_id
    from public.company_members m
    where m.company_id = new.company_id
      and (m.role = 'owner' or (m.can_approve and m.role in ('admin', 'accountant')))
      and m.user_id::text is distinct from new.data ->> 'requestedBy'
      and coalesce(m.permissions -> 'apps' ->> 'people', '') <> 'none'
    on conflict do nothing;
    get diagnostics v_count = row_count;
  exception when others then
    return null;
  end;
  if v_count = 0 then
    return null;
  end if;
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
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'action', 'payroll_approval', 'companyId', new.company_id, 'approvalId', new.id
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-alerts-secret', v_secret),
      timeout_milliseconds := 60000
    );
  exception when others then
    -- No pg_net: the schedule asks again.
    null;
  end;
  return null;
end
$$;

drop trigger if exists records_payroll_approval_email on public.records;
create trigger records_payroll_approval_email
  after insert on public.records
  for each row
  when (new.tbl = 'approvals' and new.data ->> 'kind' = 'payroll')
  execute function almailbooks.payroll_approval_email();

-- Called every 5 minutes by the change feed's schedule: as in
-- 20261123000000_change_feed.sql (expiry reminders in the feed left out, as
-- they are emailed by the morning alerts), and also when a pay run's
-- approval email hasn't gone yet (for three days, at most five tries each).
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
          -- Expiry reminders are in the bell only: the morning alerts email them.
          and e.kind <> 'document_expiry'
      )
  ) and not exists (
    select 1
    from almailbooks.approval_emails a
    where a.finished_at is null
      and a.attempts < 5
      and a.created_at > now() - interval '3 days'
      and (a.claimed_until is null or a.claimed_until < now())
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

-- Expiry alerts (#18) ---------------------------------------------------------------

-- The kinds of paper each person is told about: null is every kind (and
-- what older versions of the app, which never set it, leave it as).
do $$
begin
  if to_regclass('public.email_alerts') is null then
    raise notice 'This database has no email alerts (20261007000000_email_alerts.sql): run it, then this file again.';
    return;
  end if;
  alter table public.email_alerts add column if not exists document_kinds text[];
  alter table public.email_alerts drop constraint if exists email_alerts_document_kinds_check;
  alter table public.email_alerts
    add constraint email_alerts_document_kinds_check
    check (
      document_kinds is null
      or document_kinds <@ array['company', 'vehicle', 'staff', 'client']::text[]
    );
end
$$;

-- Who stops being the owner, an admin or an accountant (or leaves) stops
-- getting the emails. As in 20261007000000_email_alerts.sql, with
-- accountants (#18).
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
  if new.role not in ('owner', 'admin', 'accountant') then
    delete from public.email_alerts a where a.company_id = new.company_id and a.user_id = new.user_id;
  end if;
  return new;
end
$$;

-- Called every hour by the schedule: asks the function to send what is due.
-- As in 20261007000000_email_alerts.sql, and also when a company wants its
-- expiry reminders in Updates (the bell) and someone there gets the changes
-- of the team. Returns pg_net's request id (its answer is kept for a while
-- in net._http_response), or null when there is nothing to do yet.
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
  if not exists (select 1 from public.email_alerts a where a.enabled)
    and not exists (
      select 1
      from public.notification_settings s
      join public.records r
        on r.company_id = s.company_id and r.tbl = 'peopleSettings' and r.id = s.company_id
      where s.enabled and r.data ->> 'expiryUpdates' = 'true'
    ) then
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

-- Turns the signed-in person's email alerts for a company on or off. As in
-- 20261007000000_email_alerts.sql (the same four arguments, so older
-- versions of the app keep working), and accountants may now too (#18). The
-- email goes to their own account's address. The kinds of paper are set
-- apart (set_email_alert_scope): saving here leaves them as they are.
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
  if v_me is null or v_me not in ('owner', 'admin', 'accountant') then
    raise exception 'almail:permission Only the owner, admins and accountants can get email alerts.'
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

-- The kinds of paper the signed-in person is told about in a company: null
-- for every kind (what everyone has until they choose). Members only.
create or replace function public.email_alert_scope(p_company text)
returns table (document_kinds text[])
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
    select a.document_kinds
    from (select 1) one
    left join public.email_alerts a on a.company_id = p_company and a.user_id = auth.uid();
end
$$;

-- Chooses the kinds of paper the signed-in person is told about (the owner,
-- an admin or an accountant, for their own email alerts only): company,
-- vehicle, staff (employees' papers) or client (customers' papers). Null,
-- or all four, is every kind. Anything else is refused.
create or replace function public.set_email_alert_scope(p_company text, p_kinds text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.member_role := almailbooks.member_role(p_company);
  v_all text[] := array['company', 'vehicle', 'staff', 'client'];
  v_kinds text[];
begin
  if v_me is null or v_me not in ('owner', 'admin', 'accountant') then
    raise exception 'almail:permission Only the owner, admins and accountants can get email alerts.'
      using errcode = '42501';
  end if;
  if p_kinds is not null and exists (
    select 1 from unnest(p_kinds) k where k is null or not k = any (v_all)
  ) then
    raise exception 'almail:invalid Unknown kind of paper.' using errcode = '42501';
  end if;
  if p_kinds is not null and cardinality(p_kinds) = 0 then
    raise exception 'almail:invalid Choose at least one kind of paper.' using errcode = '22023';
  end if;
  -- In the usual order, without repeats; every kind is kept as null.
  select array_agg(k order by array_position(v_all, k)) into v_kinds
  from (select distinct k from unnest(p_kinds) k) chosen;
  if cardinality(v_kinds) = cardinality(v_all) then
    v_kinds := null;
  end if;
  insert into public.email_alerts as a (company_id, user_id, document_kinds)
  values (p_company, auth.uid(), v_kinds)
  on conflict (company_id, user_id) do update
    set document_kinds = excluded.document_kinds,
        updated_at = now();
end
$$;

-- Employee letters (#19) ----------------------------------------------------------

-- As in 20261116000000_super_admin_approvals.sql, with every rule it has,
-- and with the company's letters on, a letter issued or void is never
-- deleted (it is voided instead, so its number stays used); drafts may go.
-- The company's own record is never deleted through sync: delete_company
-- does that. Approval requests stay (they are the record of who asked and
-- who decided). With the company's rules on, issued documents of the types
-- the rules cover are deleted by approvers only, and with "Void instead of
-- delete" by nobody: they are voided, so their numbers stay used (drafts may
-- still go); only an approver deletes a cheque the rules cover.
create or replace function almailbooks.can_delete_record(p_company text, p_tbl text, p_data jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rules jsonb;
begin
  if p_tbl in ('companies', 'approvals')
    or not almailbooks.can_write_record(p_company, p_tbl, p_data) then
    return false;
  end if;
  if p_tbl = 'employeeLetters' then
    return coalesce(p_data ->> 'status', 'draft') = 'draft'
      or not almailbooks.letters_on(p_company);
  end if;
  if p_tbl not in ('documents', 'payments', 'securityCheques') then
    return true;
  end if;
  v_rules := almailbooks.approval_rules(p_company);
  if v_rules is null then
    return true;
  end if;
  if p_tbl in ('payments', 'securityCheques') then
    return not (
      almailbooks.cheque_change_needs_approver(v_rules, p_tbl, p_data, null)
      and not almailbooks.is_approver(p_company)
    );
  end if;
  return not (
    almailbooks.rules_cover_document(v_rules, p_data ->> 'type')
    and coalesce(p_data ->> 'status', '') <> 'draft'
    and (
      coalesce(v_rules ->> 'voidInsteadOfDelete', '') = 'true'
      or not almailbooks.is_approver(p_company)
    )
  );
end
$$;

-- What this server has beyond the first files: as the change feed file
-- says, and payroll_approvals, document_alerts and employee_letters this one.
create or replace function public.server_features()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array[
    'tables_v16', 'super_admin', 'approvals', 'cheque_approvals', 'change_feed',
    'payroll_approvals', 'document_alerts', 'employee_letters'
  ]::text[]
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on function
  almailbooks.payroll_approval_on(text),
  almailbooks.payroll_approval_email(),
  almailbooks.run_change_notifications(),
  almailbooks.email_alerts_member_changed(),
  almailbooks.run_email_alerts(),
  almailbooks.letters_on(text),
  almailbooks.issues_letters(text),
  almailbooks.letter_content(jsonb)
from public, anon, authenticated;
revoke all on function almailbooks.records_guard() from public, anon;
-- The policies of public.records call it as the signed-in person, as before.
revoke all on function almailbooks.can_delete_record(text, text, jsonb) from public, anon;
grant execute on function almailbooks.can_delete_record(text, text, jsonb) to authenticated;
revoke all on function
  public.server_features(),
  public.set_email_alerts(text, boolean, text[], text),
  public.email_alert_scope(text),
  public.set_email_alert_scope(text, text[])
from public, anon;
grant execute on function
  public.server_features(),
  public.set_email_alerts(text, boolean, text[], text),
  public.email_alert_scope(text),
  public.set_email_alert_scope(text, text[])
to authenticated;

-- The Data API learns about the changes at once.
notify pgrst, 'reload schema';
