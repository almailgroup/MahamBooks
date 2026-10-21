# Setting up the cloud (Supabase)

This guide turns on accounts, teams and sync for Maham Books. It is written
for the owner of the Supabase project; no programming is needed. It takes about
15 minutes.

Project: `https://gagdyhintrxdkiqhahzh.supabase.co`. The app already contains
the project's **publishable key**, which is meant to be public. Nothing else
has to be added to the app or to Vercel.

> **Never share the secret key.** In **Project Settings → API Keys** there is
> also a _secret_ key (`sb_secret_…`). It bypasses every protection. Don't
> paste it into the app, into Vercel, into GitHub, into an email or a chat. If
> it was ever shared, create a new one there and delete the old one. The app
> refuses to work with a secret key.

## 1. Create the database (once)

1. Open the project at <https://supabase.com/dashboard> and choose
   **SQL Editor** in the left menu.
2. Click **New query** (the **+** button).
3. Open the file
   [`supabase/migrations/20261004000000_almailbooks_cloud.sql`](../supabase/migrations/20261004000000_almailbooks_cloud.sql),
   select everything and copy it. Paste it into the editor.
4. Click **Run** (or press Ctrl+Enter / ⌘+Enter). If Supabase warns that the
   query has "destructive operations", choose **Run this query**: the script
   only replaces its own rules and never deletes data.
5. It should finish with "Success. No rows returned".
6. Do the same with
   [`supabase/migrations/20261006000000_sync_fixes.sql`](../supabase/migrations/20261006000000_sync_fixes.sql)
   (a new query, paste, **Run**). It must come after the first file.
7. For email alerts, the third script,
   [`supabase/migrations/20261007000000_email_alerts.sql`](../supabase/migrations/20261007000000_email_alerts.sql),
   comes next. It is part of [`docs/email-alerts.md`](email-alerts.md).
8. Then the fourth script,
   [`supabase/migrations/20261102000000_tables_v16.sql`](../supabase/migrations/20261102000000_tables_v16.sql)
   (a new query, paste, **Run**), after the others. It makes room for cheque
   layouts, vehicles, approval requests and HR letters, and keeps letters and
   confidential documents from staff and viewers. Until it runs, the app keeps
   the features that need it hidden; everything else works as before.
9. Then the fifth script,
   [`supabase/migrations/20261116000000_super_admin_approvals.sql`](../supabase/migrations/20261116000000_super_admin_approvals.sql)
   (a new query, paste, **Run**), after the fourth. It adds the Super Admin's
   controls in **Settings → Team** and the approval rules in **Settings →
   Approvals**, cheque confirmation included (see "The Super Admin",
   "Approvals" and "Cheque confirmation" below). Running it changes nothing by
   itself: every member keeps their role's access, admins keep inviting and
   changing roles until the owner switches that off, and nothing waits for
   approval or confirmation until the owner turns it on. It stops with "Run
   20261102000000_tables_v16.sql first" if the fourth script hasn't run, and
   then changes nothing: run step 8 first. If you ran an earlier copy of this
   script, run it again: it is safe, and the cheque switches appear only once
   it has run.
10. Then the sixth script,
    [`supabase/migrations/20261123000000_change_feed.sql`](../supabase/migrations/20261123000000_change_feed.sql)
    (a new query, paste, **Run**), after the fifth. It adds **Changes by your
    team** in **Settings → Email alerts** and the bell (see "Changes by your
    team" below). It stops with "Run 20261116000000_super_admin_approvals.sql
    first" if the fifth script hasn't run, and then changes nothing. Running it
    changes nothing by itself either: nothing is recorded until the owner (or
    a member allowed to approve) turns it on. The emails also need the email
    alerts script (step 7) and the email-alerts function
    ([`docs/email-alerts.md`](email-alerts.md)). If the fifth script is ever
    run again, run this one again after it.

Each script is run once. A new version of the app that needs more from the
database comes with a new script: run just that one, after the others. The
later scripts are safe to run again (they create what is missing and replace
their own rules with the same ones), but **don't run the first script again**:
once the app keeps cheque layouts, vehicles, approval requests or HR letters,
it stops with an error about `records_tbl_check` and changes nothing. If it
was run again and finished without an error, run the later scripts again
after it, in order.

**Optional, recommended: the daily clean-up.** Deleted records leave a small
marker (no data) for 30 days. They are also cleaned up as the app syncs, but a
daily job does it for every company. The email alerts script (step 7) turns it
on; without email alerts, open **Database → Extensions**, search for
**pg_cron**, enable it, then run the fourth script once more (step 8).

To check: **Table Editor** now lists `profiles`, `companies`,
`company_members`, `company_invites`, `records`, `deleted_records` and
`sync_signals`, each marked **RLS enabled**; **Storage** has a private bucket
called `company-files`.

Don't add policies of your own to these tables or to Storage (for example a
template like "Give users access to all buckets"): policies add up, so a
broad one would open what the script keeps closed.

## 2. Sign-in settings

1. **Authentication → URL Configuration**
   - **Site URL**: `https://mahamone.com`
   - **Redirect URLs** → **Add URL** for each:
     - `https://mahamone.com/**`
     - `https://www.mahamone.com/**`
     - `http://localhost:5173/**` (for testing on a computer)
   - Save.
2. **Authentication → Sign In / Providers → Email**
   - **Enable email provider**: on.
   - **Confirm email**: **on**. This is essential: it is what stops someone
     from signing up with another person's address and taking their
     invitation.
   - **Secure email change**: on (the default).
   - Save.
3. **Authentication → Policies** (or **Password security**, depending on the
   dashboard version): set the minimum password length to **8**. The app asks
   for 8 as well.

The emails Supabase sends (confirmation, password reset) contain a link back
to the app; no change to the email templates is needed.

## 3. Try it

Supabase's built-in email service only sends to the people who are members of
your Supabase organisation, and only about **2 emails per hour**. Until you set
up your own email service (step 4), test with the email address of your
Supabase account.

1. Open <https://mahamone.com> (with this version deployed).
2. Click **Create an account**, enter your name, the email address of your
   Supabase account and a password of at least 8 characters.
3. The app says **Check your email**. Open the email from Supabase on the
   **same device and browser** and click the link. The app opens, signed in,
   on **Your companies**.
4. Choose **Keep in the cloud** next to your company (or set one up). The
   status goes from **Uploading…** to **Synced**. In Supabase, **Table
   Editor → records** now has its records.
5. On another computer or browser, open the app and choose **Sign in**. Under
   **In your account**, choose **Download to this device**.
6. Change something on one device: the other one shows it within seconds
   (or after its next sync, at most a minute).
7. **Team**: in **Settings → Team**, invite someone (an address that can
   receive Supabase's emails, see above), copy the link or send it by
   WhatsApp, open it in another browser, create the account with that address,
   confirm it and accept. Try the **Staff** role: Payroll and People are not
   there for them.

If something doesn't work, see "Problems" below.

## 4. Your own email service (before real customers)

The built-in service is only for testing. To send to anyone, connect an email
service in **Authentication → Emails → SMTP Settings** (turn on **Enable
custom SMTP**):

- **Resend** (simple, and the one email alerts use): steps 1 and 2 of
  [`docs/email-alerts.md`](email-alerts.md) set up the domain, the API key and
  these settings: host `smtp.resend.com`, port `465`, username `resend`,
  password = the API key, sender email for example `no-reply@almailgroup.com`,
  sender name `Maham Books`.
- **Google Workspace**: create an app password for a mailbox (or use the SMTP
  relay in the Workspace admin console). Host `smtp.gmail.com`, port `465`,
  username = the mailbox address, password = the app password. Google limits
  how many emails a mailbox may send each day.

Then raise the email limit in **Authentication → Rate Limits**, and send
yourself a test (create an account with another address).

## 5. Before real customers: Pro plan

On the free plan a project is paused after a week without use, and there are
no daily backups. Upgrade the organisation to **Pro** (**Organization →
Billing**) before customers rely on it: Pro keeps daily backups for 7 days and
doesn't pause.

## How deletes work

- **Deletes are immediate.** Deleting something in the app (an invoice, a
  client, a receipt, an employee) deletes it in the cloud at the next sync,
  for everyone.
- Other devices learn about it from a small **marker** that says only which
  record was deleted and when, with no names or amounts. Markers are kept for
  **30 days at most**; a device that was away longer simply downloads the
  company again.
- **Files are removed too**: the receipt or scan is deleted from Storage with
  its record. Owners can also use **Clean up files** in **Settings → Cloud
  and sync** to remove files nothing uses any more.
- **Deleting a company** (owner only, in **Settings → Team**) deletes its
  files, then the company with all its records, members and invitations, at
  once.
- **Deleting an employee** removes them with their documents, renewals, files
  and activity; only their employee number stays in the activity log.
  Employees with payroll history are marked as left instead, because the
  accounts depend on it.
- **Backups**: on the Pro plan, Supabase's daily backups keep deleted data for
  up to **7 days**; after that it is gone for good. Ask each member to keep a
  backup file (**Settings → Backup & data**) if they need a longer history.

## Who can do what

| Role       | Can                                                                             |
| ---------- | ------------------------------------------------------------------------------- |
| Owner      | Everything, including the team and deleting the company.                        |
| Admin      | Everything except deleting the company or changing the owner.                   |
| Accountant | All books and payroll. Not the team.                                            |
| Staff      | Sales, purchases, cheques, stock and receipts. No payroll, no accounting setup. |
| Viewer     | Look at everything except payroll; change nothing.                              |

The database itself enforces this (row-level security), not just the app.
Details and the security checklist: [`supabase/README.md`](../supabase/README.md).

## The Super Admin

The Super Admin of a company is its **owner**. The app names nobody: to make
someone the Super Admin, the current owner opens **Settings → Team → Transfer
ownership** (الإعدادات ← الفريق ← نقل الملكية) and chooses them; the previous
owner becomes an admin. Do this once in every company, after the fifth script
(step 1.9) has run. **Settings → Companies → Companies you own** then lists
every company the account owns.

In **Settings → Team**, the owner (badge **Owner (Super Admin)**, المالك
(المشرف العام)) has:

- **Only the owner makes admins and accountants** (المالك وحده يعيّن المديرين
  والمحاسبين). Off until the owner turns it on. On, only the owner invites,
  makes, changes or removes admins and accountants; admins still invite and
  remove staff and viewers. Turning it on cancels invitations as admin or
  accountant that someone else made. Tell the admins before turning it on.
- **Permissions** (الصلاحيات) next to each member: make an app view only or
  turn it off for them (Maham Books can only be made view only, because the
  other apps use its customers and items). Limits only take away from the
  role, and the cloud refuses what the member saves in that app, the files
  of its records included (a scan in an employee's personnel file is
  People's). Settings and activity follow the role, except the books'
  settings (the lock date, numbering, payment details and document
  defaults), which follow the limit on Maham Books. What is already on their
  device stays there.
- **Can approve** (صلاحية الاعتماد), in the same dialog: up to two admins or
  accountants may approve requests besides the owner. Off for everyone at
  first.

If the owner's account is ever deleted, the longest-standing admin (or else
accountant) becomes the owner, as before; the change is recorded, and shows
under **Changes by your team** once the sixth script has run.

## Approvals

**Settings → Approvals** (الإعدادات ← الاعتمادات) holds the owner's rules. Only
the owner changes them; everyone else sees them. Nothing waits for approval
until the owner turns something on:

- **Issued invoices need an approver to change** (تعديل الفواتير الصادرة يحتاج
  إلى معتمِد) and the same for **credit notes**. With it on, a change to an
  issued invoice (its customer, dates, lines, prices, wording, its number),
  voiding it or bringing it back from void is made only by an approver: the
  owner, or an admin or accountant with **Can approve** (Settings → Team).
  Everyone else gets **Send for approval** (إرسال للاعتماد) instead of Save,
  and **Request void** instead of Void (or Delete), with a reason. Payments,
  credit notes applied to it and retention releases go on as before. A
  payment link can still be added to one that has none; once it has one,
  only an approver changes or removes it (it is where the customer pays).
  Drafts and new invoices are anyone's.
- **Void instead of delete** (الإبطال بدلاً من الحذف), on by default: issued
  invoices and credit notes are voided, never deleted, so their numbers stay
  used. With it off only approvers may delete them. They are under **Invoices → Void** (الفواتير الملغاة). Drafts can
  still be deleted. A voided invoice that was paid leaves the money on the
  payment as the customer's unapplied credit.
- **Cancel requests still waiting after (days)**: 14 by default; 0 keeps them
  waiting.

Requests are in **Approvals** (الاعتمادات) in the Books sidebar (طلبات
الاعتماد), and a count is on the home page for approvers. An approver opens a
request, sees what would change and approves or rejects it; approving makes
the change on their device once the cloud has the decision (offline, when the
device is back online), and it syncs to everyone. A request taken back or
decided on another device meanwhile stays as the cloud has it. Whoever asked
can take a request back while it waits. The cloud stamps who asked, who
decided and when, and a decision once made can't be undone by an older copy.
An approval that can't be carried out (the period was locked meanwhile, say)
stays approved, to be carried out again or rejected. Carrying it out again
asks the cloud first, so a device that is offline, or whose copy is behind
(another approver rejected it meanwhile), carries nothing out.

**Void and reissue** (إبطال وإعادة إصدار), on any issued invoice or credit
note once approvals or the numbering below are on, voids it and opens a new
draft in its place, which prints "Replaces INV-…" and gets a new number when
issued. Money paid on the void one becomes the customer's unapplied credit,
to apply to the new one. Numbers are never reused. To avoid using up numbers
on drafts, **Settings → Numbering → Number invoices and credit notes when they
are issued** gives drafts their number only when they are sent; the cloud then
refuses an invoice issued without its number (an older version issuing such a
draft), which waits in **Settings → Cloud and sync**. In a company kept in the
cloud the switch appears only once the fifth script (step 1.9) has run, since
until then nothing in the cloud refuses such an invoice; switched on before the
company moved to the cloud, it can still be turned off there, and should be
until the script has run.

Before turning approvals or that numbering on, update every device and let
each one sync. A change an older version makes to an issued invoice is refused
by the cloud and waits in **Settings → Cloud and sync**, with **Send for
approval instead**; what it changed with it (the payments a delete freed, say)
waits with it on a device with this version. On a device still on an older
version, undo such a change there (**Undo my change**): its payments were
already sent.
Companies kept on one device only have nobody to ask: the rules apply to cloud
companies.

## Cheque confirmation

**Settings → Approvals → Cheques** (الإعدادات ← الاعتمادات ← الشيكات), the
owner's switch **Cheques need confirmation** (الشيكات تحتاج إلى تأكيد). Turned
on, it covers what is recommended: **Cheques issued** (الشيكات الصادرة) and
**Security cheques given** (شيكات الضمان المسلَّمة) on, **Cheques received**
(الشيكات المستلمة) off. Each can be changed on its own.

- A cheque of a covered kind recorded by anyone but an approver is not a
  payment: the button says **Send for confirmation** (إرسال للتأكيد), and the
  cheque waits as a request. It is not in the books, not on the bill or
  invoice (which shows "waiting for confirmation" so nobody records it twice),
  not in the cheque register's totals or the morning alerts, and it can't be
  printed.
- The approver (the owner, or an admin or accountant with **Can approve**)
  finds it in **Approvals** and in **Cheques → Waiting for confirmation**
  (بانتظار التأكيد), and presses **Confirm** (تأكيد) or **Reject**. Confirming
  records the payment on the approver's device as it was asked, dated the day
  the cheque was written or received, numbered and posted then. Whoever asked
  can take a request back while it waits.
- Changing a confirmed cheque's amount, payee, number, bank or dates, deleting
  it, replacing it and cashing a security cheque given out wait the same way.
  Depositing, clearing, returning, cancelling, printing, notes and the
  documents it pays go on as before. A printed cheque moved to its next leaf
  (the spoiled leaf on record) needs nothing more.
- While cashing a security cheque waits, that security cheque can't be
  changed or deleted. Changed anyway (on an older version), the request
  can't be confirmed, since the payment would not be what was asked: it says
  so, and is rejected and asked again.
- If a bill was paid meanwhile, or the period was locked, confirming says why
  and the request stays confirmed but not recorded: carry it out again, or
  reject it.

Received cheques are off by default: while one waits, its invoice stays unpaid
and the customer may still get a reminder. Before turning cheque confirmation
on, update every device and let each one sync: a cheque an older version
records is refused by the cloud and waits in **Settings → Cloud and sync**,
with **Send for confirmation instead**. On a device still on an older version,
undo it there instead (**Undo my change**): until then that device counts the
cheque on its bill, and devices with this version leave the bill as the cloud
has it after a few tries. The paper cheque should not leave the office before
it is confirmed: the app can't see paper.

## Changes by your team

**Settings → Email alerts → Changes by your team** (الإعدادات ← تنبيهات البريد
← تغييرات الفريق), after the sixth script (step 1.10). It is there for the
owner (the Super Admin) and the admins or accountants with **Can approve**
(Settings → Team); nobody else sees it. Each of them turns their own on:

- **Tell me about changes by my team** (أبلغني بتغييرات فريقي). Off at first.
  Until someone of the company turns it on, the cloud records nothing.
- **Email at once** (بالبريد فوراً): important changes, within about 5
  minutes: an issued invoice or credit note changed, voided, restored or
  deleted; cheques recorded, changed, returned, cancelled or deleted, and
  security cheques; approval requests and each decision; someone joining or
  leaving, a role or permissions changing; the numbering, the lock date or
  the approval rules changing; pay runs added, approved, paid or deleted.
  Each kind can be turned off.
- **Everything else in a morning summary** (كل ما عدا ذلك في ملخص صباحي), at
  8:00 Kuwait time, on days the team changed something. Off, only the
  changes above are emailed.
- At most **one email every 15 minutes and 20 a day** per person and
  company; what comes meanwhile goes in the next email. The emails share
  Resend's daily allowance (100 a day on the free plan) with the morning
  alerts: with three recipients that is up to 60, so a paid plan is
  advisable once the team is busy.

The **bell** (المستجدات, Updates) at the top, next to the app grid, counts
the unread changes and lists the latest; **See all updates** opens the
Updates page (by day, filters, **Mark all as read**, a link to each record).
A change shows there as soon as the device that made it has synced. Nobody
sees their own changes. Changes to payroll and people data say only what
happened ("Approved the pay run for 2026-10"), never a name, a Civil ID or
an amount, and only owners, admins and accountants ever see them. Changes
are kept 180 days.

Each entry of a record's activity now also says who made it ("· by …"), in
companies kept in the cloud; entries from before, and from older versions of
the app, name nobody.

## Problems

- **"Check your email" but no email arrives**: the built-in service only sends
  to members of your Supabase organisation and about 2 per hour. Check spam,
  wait, or set up your own email service (step 4).
- **The link in the email says it has expired**: links work once, for a
  short time. Sign in, or ask for a new one from the sign-in screen.
- **The link opens on another device**: the address is confirmed anyway; sign
  in on the device you want to use.
- **"Redirect URL not allowed"** or the link opens the wrong site: check
  step 2.1.
- **Sync problem** in the app: open **Settings → Cloud and sync**. It shows
  what was not accepted (usually a change the person's role doesn't allow),
  with **Try again** and **Undo my change**.
- The app keeps working offline; changes sync when the connection is back.
