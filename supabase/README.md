# Maham Books cloud (Supabase)

`migrations/20261004000000_almailbooks_cloud.sql` is the server: tables,
row-level security, the functions the app calls, the Storage bucket and its
policies, and the Realtime publication. `migrations/20261006000000_sync_fixes.sql`
comes after it: company settings merged by field, document numbers taken in
the cloud, deleting a company safely, and the file checks below. Both are safe
to run again, in this order (run the second again after the first if the first
is ever run again). Until the second runs, the app notices its functions are
missing and works as before. `migrations/20261007000000_email_alerts.sql`
comes next and adds email alerts (see "Email alerts" below).
`migrations/20261102000000_tables_v16.sql` comes last: the records of the
app's database version 16 and their privacy (see "Records of database
version 16" below). The owner's step-by-step guides are [`docs/supabase-setup.md`](../docs/supabase-setup.md)
and [`docs/email-alerts.md`](../docs/email-alerts.md).

The app stays local-first: every screen reads IndexedDB on the device, and the
cloud keeps a copy of each company that is synced in the background. A company
that is never put in the cloud never leaves the device.

## What is stored

| Table                    | What                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `public.profiles`        | One row per account: name, language, email (copied from `auth.users` by a trigger).             |
| `public.companies`       | Companies kept in the cloud: id, name, creator, `purged_until_rev`.                             |
| `public.company_members` | Who belongs to which company, with a role. One owner per company (unique index).                |
| `public.company_invites` | Invitation links: address, role, random token, 7-day expiry, used/cancelled.                    |
| `public.records`         | Every record of every company as JSON: `(company_id, tbl, id)`, `data`, `rev`, `updated_at/by`. |
| `public.deleted_records` | A marker per deleted record: `(company_id, tbl, id)`, `rev`, `deleted_at`, `private`. No data.  |
| `public.sync_signals`    | One row per company with the latest rev; the only table published to Realtime.                  |
| `storage.objects`        | Receipts and scans in the private bucket `company-files`, at `{companyId}/{attachmentId}`.      |
| `public.email_alerts`    | Who gets the morning email of which company, what it covers, and what was last emailed.         |

`tbl` is one of the app's 37 synced tables (a check constraint lists them).
Every write gets `rev` from one global sequence, the time and the author from
the server (`records_before_write`); what the app sends for them is ignored.
A per-company advisory lock, held until commit, makes revs reach readers in
commit order, so a pull "after rev N" never skips a change that committed late.

## Roles

|                                                          | Owner |        Admin        | Accountant |         Staff          | Viewer |
| -------------------------------------------------------- | :---: | :-----------------: | :--------: | :--------------------: | :----: |
| Read sales, purchases, cheques, stock, accounts, reports |  yes  |         yes         |    yes     |          yes           |  yes   |
| Change sales, purchases, cheques, stock, files, activity |  yes  |         yes         |    yes     |          yes           |   no   |
| Make transfers, cheque clearings/returns, releases       |  yes  |         yes         |    yes     |          yes           |   no   |
| Change accounts, tax rates, journals, assets, year-end   |  yes  |         yes         |    yes     |       read only        |   no   |
| Change company settings                                  |  yes  |         yes         |    yes     | document counters only |   no   |
| See payroll and people data                              |  yes  |         yes         |    yes     |         **no**         | **no** |
| Invite, change roles, remove members                     |  yes  | yes (not the owner) |     no     |           no           |   no   |
| Transfer ownership, delete the company                   |  yes  |         no          |     no     |           no           |   no   |
| Leave the company                                        |  no   |         yes         |    yes     |          yes           |  yes   |

**Payroll and people data** (invisible to staff and viewers, not even
readable): `employees`, `payRuns`, `payrollSettings`, `peopleSettings`,
`leaveRecords`, `staffLoans`, `finalSettlements`; `complianceDocuments` and
`renewals` that belong to an employee; files (`attachments`) of an employee or
of an employee's document or renewal; payroll journals (`kind = 'payroll'`,
which show salaries); activity entries about employees and payroll; letter
templates and employee letters (`letterTemplates`, `employeeLetters`);
approval requests about any of these (`approvals` whose `subjectTbl` is one of
the tables above); register documents marked `confidential` with their
renewals, files and activity. The rule is `almailbooks.record_is_private`. The
app also marks files and activity about employees, letters and confidential
documents with `_private: true`, which can only make a record more private.

## Functions

The app calls these (all `revoke`d from `anon` and `public`, granted to
`authenticated`, `set search_path = ''`, every name schema-qualified):

| Function                                                                   | Runs as | Why                                                                                       |
| -------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `push_records(company, changes)`                                           | invoker | Saves a batch in one transaction under the caller's RLS. Returns `{tbl,id,rev,conflict}`. |
| `pull_records(company, since, limit)`                                      | invoker | Records and deletion markers after a rev, under RLS; `almail:resync` when too old.        |
| `company_record_ids`, `company_sync_info`                                  | invoker | For a full resync, progress and the file clean-up; RLS applies.                           |
| `create_company(id, name)`                                                 | definer | Creates the company and the owner's membership (members can't insert themselves).         |
| `my_companies()`                                                           | definer | Only rows where `user_id = auth.uid()`.                                                   |
| `company_team(company)`                                                    | definer | Members' names and emails, for members of that company only (profiles are private).       |
| `create_invite`, `list_invites`, `revoke_invite`                           | definer | Owners and admins only; never as owner.                                                   |
| `invite_details(token)`, `accept_invite(token)`                            | definer | See "Invitations".                                                                        |
| `set_member_role`, `remove_member`, `transfer_ownership`, `delete_company` | definer | Role checks inside; the owner can't be demoted or removed.                                |
| `patch_company(company, ops)`                                              | invoker | The fields a device changed, laid over the cloud's company record; conflicts reported.    |
| `reserve_number(company, kind, date, min)`                                 | invoker | The next number of a kind of document, taken from the company's counter at once.          |
| `begin_delete_company(company)`                                            | definer | Owners only, before the app removes any file; uploads are refused for an hour.            |
| `stored_files(company, names)`                                             | definer | Which of these files are still stored, for members: a removal that removed nothing.       |
| `server_features()`                                                        | invoker | What the server has beyond the first files (`tables_v16`), so the app can hide the rest.  |

`create_company` refuses a company that is already in the cloud with records
(`almail:company_exists`): the app offers to download it instead, so an older
copy (a restored backup) never replaces the team's newer work.

Helpers used by the policies live in the schema `almailbooks`, which the Data
API does not expose, so nobody can call them through the API.

### Why each security definer function is safe

- They all start from `auth.uid()` (the JWT's subject), never from a user id
  the caller passes, and check the caller's role in the company first:
  `almailbooks.member_role(company)` reads the caller's own membership row.
- `set search_path = ''` and fully qualified names: no object can be swapped
  in through the search path.
- They never return records' data. `company_team` returns names, emails and
  roles of the caller's own team; `invite_details` returns what the invitation
  link already says; `my_companies` returns the caller's own memberships.
- Policy helpers (`can_read_record`, `can_write_record`, `record_is_private`,
  `can_use_file`…) are definer so that a policy on `records` can look at
  other rows (an attachment's owner) without recursion; they only answer yes
  or no for the calling user.
- Triggers are definer so that clients need no privilege on the rev sequence
  and the deletion markers; they validate what is written (company of the
  record, size, staff limits) and only write bookkeeping columns and markers.

## Files

A file at `{companyId}/{attachmentId}` follows its attachment record: whoever
may read or change the record may read or change the file
(`almailbooks.can_use_file`). Storage reads back every row it saves or
removes, so the read rule also applies to uploads and removals. While a file
has no record (the app uploads the file just before it sends the record, and
removes it just after the record is deleted):

- owners, admins and accountants may use it;
- staff may use only their own upload on its way (`storage.objects.owner_id`,
  which Storage sets from the signed-in account), and the file of a deleted
  attachment that was not private, to remove it;
- viewers may not.

So staff never see a file another member is still uploading (it may be an
employee's passport) nor the file of a deleted private attachment.

## Invitations can't be hijacked

- The token is 64 hex characters from two `gen_random_uuid()` (244 random bits
  from the server's strong random source): it can't be guessed.
- `accept_invite` only works for a signed-in account whose **confirmed**
  email (`auth.users.email_confirmed_at`, read on the server) equals the
  invited address (case-insensitive). Holding the link is not enough.
- Single use (`accepted_at`), expires after 7 days, can be cancelled; a new
  invitation for the same address cancels the pending one.
- Nobody can be invited as owner; only owners and admins invite.
- The description shown before signing in (company, who invited) is taken
  from the link and only shown; joining checks everything in the database.
- This relies on two Supabase settings that are on by default and must stay
  on: **Confirm email** (otherwise anyone could sign up with the invited
  address) and **Secure email change** (otherwise an account could switch to
  the invited address without confirming it).

## Deletes

- Deleting in the app deletes in the cloud: `push_records` deletes the row
  from `public.records` (members need write permission on that kind of
  record; the company record itself is never deleted this way).
- A trigger writes a marker to `public.deleted_records` with the next rev, so
  other devices delete their copy. The marker holds no data, only which record
  and when; markers of payroll data are hidden from staff and viewers.
- Markers are removed after **30 days**: on every push and pull for that
  company, and daily by `pg_cron` when the extension is on. A device that was
  away longer gets `almail:resync`: it fetches the ids that exist, deletes
  what the cloud no longer has (never changes still waiting to be sent) and
  pulls everything again.
- **Files**: deleting an attachment removes its Storage object in the same
  sync step; removals that fail are retried until they succeed. A new version
  of a file replaces the old object (same path). Owners can run **Clean up
  files** (Settings → Cloud and sync), which removes objects no attachment
  uses (older than an hour, so uploads on their way are left alone); it also
  runs after a full resync.
- **Deleting a company** (owner only) first removes every object under
  `{companyId}/` through the Storage API, then `delete_company` deletes the
  company row, which cascades to its records, markers, members, invitations
  and signal.
- **Deleting an employee** without payroll history removes them, their
  documents and renewals, every file kept with them or with those, and the
  activity about them; one entry with their number only records the deletion.
  With payroll history (pay runs, leave, loans, a settlement) they are marked
  as left, because the accounts depend on it.
- Supabase's daily backups (Pro plan) keep deleted data for up to **7 days**;
  after that it is gone.

## Sync rules

- The device sends its outbox with `base_rev` = the version it last had. The
  push always wins (last write wins); `conflict` is true when the server had a
  newer version that this push replaced (or a newer delete), and the app notes
  it in the activity log.
- **Document numbers never go back.** For the `companies` record the trigger
  merges `numbering`: for each kind of document the counter of the later
  `period` wins (same period: the higher `next`); pattern, padding and reset
  are taken as sent (a change of reset takes the rule as sent).
- Each record must belong to the company it is stored under (`data.companyId`
  and `data.id` are checked), and is at most about 1 MB (3 MB for the company
  record, which carries the logo, stamp and signature).

## Realtime

`public.records` is **not** published. With real deletes, Realtime would send
the primary key of every deleted row to anyone subscribed (Postgres can't check
row-level security on a row that no longer exists). Instead `push_records`
bumps one row per company in `public.sync_signals`, which is published and
protected by RLS (members only); the app pulls when it hears about it.

## Keys

The app only ever uses the **publishable key** (`sb_publishable_…`), which is
public by design: it identifies the project, and every request runs as the
signed-in person under RLS. The app refuses to start the cloud with a secret
key (`sb_secret_…`) or a service-role JWT (`src/cloud/config.ts`). The secret
key must never be put in the app, in Vercel's environment variables for the
app, or anywhere public.

## Security review checklist

- [x] RLS is enabled on every table; no table is readable by `anon`;
      `TRUNCATE`, `REFERENCES` and `TRIGGER` are revoked from clients.
- [x] A member of one company can neither read nor write another company's
      records, members, invitations, markers, signals or files (tested).
- [x] Staff and viewers never receive payroll or people data, through pulls,
      plain selects, id listings, markers or Storage, including files on their
      way up and files of deleted records (tested with the statements Storage
      runs).
- [x] Viewers can't write anything; staff can't change accounting setup or
      company settings (only document counters) (tested).
- [x] Records can't be moved between companies or stored under the wrong
      company id (tested).
- [x] Every `security definer` function sets `search_path = ''`, checks the
      caller's role from `auth.uid()`, and is not callable by `anon`.
- [x] Invitations: unguessable, single use, 7 days, confirmed matching email
      only, never as owner (tested).
- [x] The owner can't be removed or demoted; exactly one owner (unique index;
      an admin takes over if the owner's account is deleted) (tested).
- [x] Deletes leave no data behind; markers expire after 30 days (tested).
- [x] Realtime publishes no record data and no keys of deleted rows.
- [x] The app uses the publishable key only.
- [ ] Don't add other policies on `storage.objects` or on these tables in the
      dashboard: policies add up, so a broad one (for example "authenticated
      users can read every bucket") would open what these rules close.

## Testing

`src/cloud/sql.test.ts` runs this exact file in an in-process Postgres
(PGlite) after a small stand-in for Supabase's `auth` and `storage` schemas and
roles (`src/cloud/sql-harness.ts`), then checks the matrix above as real
signed-in users, with row-level security on. Run it with
`npx vitest run src/cloud/sql.test.ts`.

## Known limits

- Two devices editing the same record at the same time: the later save wins
  (with a note in the activity log), except document counters, which merge.
- Numbers are given out on each device; two devices offline at once can give
  out the same invoice number, which the app shows as a duplicate to fix.
- A team member could fill the company's storage (each record up to about
  1 MB); Supabase's plan limits apply.
- A company whose owner deletes their account goes to the longest-standing
  admin (or accountant); without either it has no owner.

## Records of database version 16

`20261102000000_tables_v16.sql` lets `public.records` take five more tables:
`chequeLayouts`, `vehicles`, `approvals`, `letterTemplates` and
`employeeLetters`. None of them can be changed by staff (`staff_can_write` is
unchanged). It replaces `record_is_private` with the rules above, and adds a
second, restrictive read rule on `records` (and on `deleted_records` for
letters) that keeps letters, approval requests about people data, confidential
documents and their renewals from staff and viewers even if the first file is
run again and puts back its older `record_is_private`. Once the new tables
have records, running the first file again stops at the kinds of record (it
changes nothing); run the files again in order.

`server_features()` answers `{tables_v16}`. The app asks it as it syncs and
keeps the answer on the device, so a feature that keeps these records stays
hidden until the owner has run the file. A device whose earlier version
skipped the new tables' records fetches just those tables once
(`company_record_ids` and the records), instead of syncing everything again.
`src/cloud/tables-v16-sql.test.ts` checks the rules, and
`src/cloud/table-parity.test.ts` that the table lists here and in the app agree.

## Email alerts

`20261007000000_email_alerts.sql` and the `email-alerts` Edge Function
(`src/alerts/`, published by the deploy workflow) send owners and admins a
morning email of what needs attention (see
[`docs/email-alerts.md`](../docs/email-alerts.md)).

- `public.email_alerts` has row-level security on, no policies and no grants:
  the app reaches it only through `email_alert_settings(company)` (members;
  the caller's own row) and `set_email_alerts(company, enabled, topics,
app_url)` (owners and admins; the caller's own row). Topics are checked
  against a fixed list; the app address must be `http(s)`.
- A trigger on `company_members` deletes a person's row when they leave or
  stop being an owner or admin; deleting the company deletes the rows.
- `almailbooks.email_alerts_config` keeps the function's address (the
  function writes it from its own `SUPABASE_URL`) and a random secret.
  `almailbooks.run_email_alerts()` (not callable by API roles), scheduled
  hourly with pg_cron, posts `{"action":"run"}` to the function with that
  secret through pg_net, only when someone has alerts on.
- The function is deployed without Supabase's JWT check
  (`supabase/config.toml`) and checks its callers itself: the schedule's
  secret, compared in constant time, or, for "Send it now", the person's
  session (checked with Auth) and their role in the company. It reads the
  database with `SUPABASE_DB_URL`, so it bypasses row-level security: it only
  ever emails an owner or admin of the company, at their account's confirmed
  address. Employee papers appear by type and name only, without numbers, and
  no payroll data is read.
- Its secrets are `RESEND_API_KEY` and `ALERTS_FROM`, set in Supabase under
  Edge Functions → Secrets; GitHub only holds `SUPABASE_ACCESS_TOKEN` to
  publish it.
