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
   comes last. It is part of [`docs/email-alerts.md`](email-alerts.md).

Running the scripts again later is safe: they create what is missing and
replace their own rules with the same ones. Run them again, in this order,
whenever a new version is published.

**Optional, recommended: the daily clean-up.** Deleted records leave a small
marker (no data) for 30 days. They are also cleaned up as the app syncs, but a
daily job does it for every company. The email alerts script (step 7) turns it
on; without email alerts, open **Database → Extensions**, search for
**pg_cron**, enable it, then run the first script once more (steps 2–4).

To check: **Table Editor** now lists `profiles`, `companies`,
`company_members`, `company_invites`, `records`, `deleted_records` and
`sync_signals`, each marked **RLS enabled**; **Storage** has a private bucket
called `company-files`.

Don't add policies of your own to these tables or to Storage (for example a
template like "Give users access to all buckets"): policies add up, so a
broad one would open what the script keeps closed.

## 2. Sign-in settings

1. **Authentication → URL Configuration**
   - **Site URL**: `https://almail-books.vercel.app`
   - **Redirect URLs** → **Add URL** for each:
     - `https://almail-books.vercel.app/**`
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

1. Open <https://almail-books.vercel.app> (with this version deployed).
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
