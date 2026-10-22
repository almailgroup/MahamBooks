-- =============================================================================
-- Maham One cloud: the AI assistant's switch is the owner's and the admins'
-- =============================================================================
--
-- The owner runs this once in the Supabase SQL editor (paste the whole file
-- and press Run), after 20261207000000_staffing_costings.sql. It is safe to
-- run again. If 20261007000000_email_alerts.sql,
-- 20261102000000_tables_v16.sql, 20261116000000_super_admin_approvals.sql,
-- 20261123000000_change_feed.sql, 20261130000000_people_alerts.sql or
-- 20261207000000_staffing_costings.sql is ever run again, run this file
-- again after them.
--
-- Until it runs, the app keeps working as before: only its Settings → AI
-- assistant page (and the device's own check before it syncs) keeps the
-- switch for the owner and the admins. The app works the same either way.
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
--   * public.server_features() also answers 'ai_assistant'.
--
-- Every function this file replaces is as the latest earlier file left it,
-- with only what is said above added: records_guard as
-- 20261130000000_people_alerts.sql has it, with every rule it has, and
-- server_features as 20261207000000_staffing_costings.sql has it, with every
-- name it answers.
-- =============================================================================

do $$
begin
  if to_regprocedure('almailbooks.people_shut(text)') is null
    or to_regprocedure('almailbooks.letters_on(text)') is null
    or to_regprocedure('almailbooks.kept_key(jsonb,jsonb,text)') is null
    or not exists (
      select 1
      from pg_catalog.pg_policy p
      where p.polrelid = to_regclass('public.records')
        and p.polname = 'Manpower costings: kept from staff and viewers'
    ) then
    raise exception 'Run 20261207000000_staffing_costings.sql first, then this file.';
  end if;
end
$$;

-- Helpers (not callable through the API) ---------------------------------------

-- The caller turns the company's AI assistant on or off: the owner or an
-- admin, whatever apps the owner limited them to. Kept the same as
-- switchesAi in src/cloud/roles.ts.
create or replace function almailbooks.switches_ai(p_company text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(almailbooks.member_role(p_company)::text, '') in ('owner', 'admin')
$$;

-- What the server checks before a record is stored, after
-- records_before_write (triggers of the same kind run in the order of their
-- names). Only the company record, documents, approval requests, cheque
-- payments, security cheques given, the People settings and employee
-- letters are looked at; every other record passes at once. Refusals have
-- the SQL state 42501.
--
-- As in 20261130000000_people_alerts.sql, with every rule it has (those of
-- 20261116000000_super_admin_approvals.sql, salary approval and employee
-- letters), and the AI assistant's switch: on the company record, only the
-- owner or an admin changes "ai"; anyone else's copy keeps it as it is
-- stored (or left out, as it was).
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
  -- one, or voids one that is issued. Drafts are anyone's who may write
  -- them, and marking a letter printed changes nothing of it.
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
    -- An issued or void letter stays as it was issued (a void one void):
    -- a copy sent again, older or not, only adds when it was printed, and
    -- an issued one may be voided.
    if v_was in ('issued', 'void') then
      new.data := almailbooks.issued_letter_kept(old.data, new.data);
      v_status := coalesce(new.data ->> 'status', 'draft');
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
    -- The AI assistant's switch (Settings → AI assistant) is the owner's and
    -- the admins', whatever apps the owner limited an admin to: anyone
    -- else's copy keeps it as it is stored (a copy that hasn't heard of it
    -- never turns it off, and nobody else turns it on).
    if not almailbooks.switches_ai(new.company_id) then
      new.data := almailbooks.kept_key(
        new.data,
        case when tg_op = 'UPDATE' then old.data end,
        'ai'
      );
    end if;
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
  -- A pay run's request is decided by approvers who see payroll: not by a
  -- member the owner gave no access to People (they get no email of it
  -- either). Whoever asked may still take it back.
  if v_payroll
    and almailbooks.people_shut(new.company_id)
    and not (v_was = 'pending' and v_status = 'cancelled' and old.data ->> 'requestedBy' = v_me) then
    raise exception 'almail:permission The owner has given you no access to Maham People, so you don''t decide pay runs.'
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

-- What this server has beyond the first files: as the staffing costings file
-- says, and ai_assistant this one.
create or replace function public.server_features()
returns text[]
language sql
stable
set search_path = ''
as $$
  select array[
    'tables_v16', 'super_admin', 'approvals', 'cheque_approvals', 'change_feed',
    'payroll_approvals', 'document_alerts', 'employee_letters', 'staffing_costings',
    'ai_assistant'
  ]::text[]
$$;

-- Who may run what ------------------------------------------------------------------

revoke all on function almailbooks.switches_ai(text) from public, anon, authenticated;
revoke all on function almailbooks.records_guard() from public, anon;
revoke all on function public.server_features() from public, anon;
grant execute on function public.server_features() to authenticated;

-- The Data API learns about the changes at once.
notify pgrst, 'reload schema';
