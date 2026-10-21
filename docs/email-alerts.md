# Email alerts

Maham One can email the owner and admins of a company every morning with
what needs attention:

- **Papers and licences**: Civil IDs, residencies, passports, work permits,
  fixed-term contracts and the company's licences, at the company's reminder
  days (60, 30 and 7 days before, by default) and when they expire.
- **Deadlines**: PIFSS payments, MOCI filings and the other dates of the
  compliance calendar that are due within 14 days or late, until they are
  marked as done.
- **Cheques**: received cheques to deposit this week or not deposited yet, and
  cheques the company wrote that fall due this week.
- **Bills to pay**: due this week or late.
- **Overdue invoices**: what customers haven't paid by the due date.

The email goes out at **8:00 in the morning, Kuwait time**, only on days when
something **new** needs attention (a paper reaching a reminder day, an invoice
becoming overdue…), and **every Sunday** with everything still open. Each
email lists everything that needs attention, the new things first and marked
**New**. It is in the person's language (Arabic or English, from their
account).

Each owner or admin turns their own email on in the app, in **Settings →
Email alerts**, and it goes to **the email address of their account**: if you
sign in as `admin@almailgroup.com`, that is where it goes. Nobody can send it
to anyone else, and someone who stops being an owner or admin stops getting
it. Accountants, staff and viewers can't get it.

The email names the paper and the person ("Residency · Ravi Kumar") but never
shows Civil ID, passport or residency numbers, salaries or other payroll data.

## Changes by your team

The same function also emails **what the rest of the team changed**, to the
owner (the Super Admin) and the admins or accountants the owner allowed to
approve, once the change feed script
([`supabase/migrations/20261123000000_change_feed.sql`](../supabase/migrations/20261123000000_change_feed.sql))
has run. Each of them turns it on in **Settings → Email alerts → Changes by
your team** (تغييرات الفريق):

- **Important changes within about 5 minutes**: an issued invoice or credit
  note changed, voided or deleted, cheques, approval requests and decisions,
  team changes, the numbering, lock date or approval rules, pay runs. Each
  kind can be left for the summary instead.
- **Everything else in a summary at 8:00 Kuwait time**, on days the team
  changed something (it can be turned off).
- At most **one email every 15 minutes and 20 a day** per person and
  company; whatever comes meanwhile goes in the next one. Everything is also
  in the app, under the bell (المستجدات).

The emails say who changed what, with the customer and the amount; nobody
gets their own changes. Changes to payroll and people data say only what
happened, without names, Civil IDs or amounts. A schedule every 5 minutes
(**Integrations → Cron → maham-change-notifications**) calls the function
only when someone has something new. These emails count towards Resend's
100 a day too: with the owner and two approvers on, a busy day can take up
to 60, so a paid Resend plan is advisable.

## How it works

```
Supabase Cron, every hour ──► email-alerts function ──► Resend ──► your inbox
                                 │ reads the company's records in the database
                                 └ works out what needs attention
```

- **Resend** (resend.com) sends the emails, from your own domain.
- The **email-alerts function** runs in Supabase (an Edge Function). It is
  built from the app's own code, so the email says exactly what the app's
  dashboard and compliance calendar say. GitHub publishes it to Supabase each
  time a new version of the app is deployed.
- **Supabase Cron** calls the function every hour. From 8:00 Kuwait time it
  emails whoever is due, at most once a day. If sending fails (for example,
  the domain isn't verified yet), it tries again the next hour, and the app
  shows the problem in **Settings → Email alerts**.

Costs: none on the free plans for a business of your size. Resend's free plan
sends 3,000 emails a month and 100 a day; this sends at most one email a day
per person and company. The function runs about 720 times a month; Supabase's
free plan includes 500,000.

## Setting it up (about 30 minutes, once)

You need: the Supabase project's owner account, access to the domain's DNS
settings (where `almailgroup.com` is managed: the same place where Google
Workspace was set up), and admin access to the GitHub repository.

> **Keep the keys to yourself.** You'll create two keys below: a Resend API key
> (`re_…`) and a Supabase access token (`sbp_…`). Paste each only where this
> guide says. Never put them in the app, in an email or in a chat, including
> with Claude. If one was ever shared, delete it where it was created and make a
> new one.

### 1. Resend: the sender

1. Go to <https://resend.com> and create an account (with your work email).
2. Open **Domains → Add domain**. Enter `almailgroup.com` and choose the
   region **Ireland (eu-west-1)**, the nearest to Kuwait. Click **Add**.
3. Resend shows a few DNS records (usually an **MX** and a **TXT** record for
   `send`, and a **TXT** record for `resend._domainkey`). Open your domain's
   DNS settings in another tab and add each record exactly as shown (type,
   name, value; for the MX record, priority 10).
   - These records are for a sub-domain (`send.almailgroup.com`) and a key
     name. They don't change your existing Google Workspace email: leave your
     current MX records as they are.
   - Some DNS hosts add the domain to the name by themselves: if the name
     field already ends in `.almailgroup.com`, enter only `send` or
     `resend._domainkey`.
4. Back in Resend, click **Verify DNS records**. It may take from a few minutes
   to a few hours. Wait until the domain shows **Verified**.
5. Open **API Keys → Create API key**. Name: `Maham Books`. Permission:
   **Sending access**. Domain: `almailgroup.com`. Click **Add**, and copy the
   key (it starts with `re_`, and Resend shows it only once). Keep it open for
   steps 2 and 4.

### 2. Sign-in emails through Resend (recommended)

Supabase's own email service, which sends account confirmations, password
resets and invitations, only sends to your Supabase team and about 2 emails
an hour. Send them through Resend instead:

1. In Supabase, open **Authentication → Emails → SMTP Settings** and turn on
   **Enable custom SMTP**.
2. Fill in:
   - **Sender email**: `no-reply@almailgroup.com`
   - **Sender name**: `Maham One`
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: the Resend API key from step 1.5
3. **Save**. Then, in **Authentication → Rate Limits**, raise **Rate limit for
   sending emails** to 30 an hour, and save.

To check: in the app, sign out, choose **Forgot your password?** and enter
your address. The email comes from Maham One within a minute.

### 3. The database script

1. In Supabase, open **SQL Editor → New query**.
2. Open
   [`supabase/migrations/20261007000000_email_alerts.sql`](../supabase/migrations/20261007000000_email_alerts.sql)
   on GitHub, click **Copy raw file** (the copy icon above the file), paste it
   into the editor and click **Run**. Make sure the whole file was pasted: its
   last line is `notify pgrst, 'reload schema';`.
3. It should finish with **Success. No rows returned**. If Supabase warns
   about "destructive operations", choose **Run this query**: the script only
   replaces its own rules and never deletes data.

The script turns on **Supabase Cron** and **pg_net** and schedules the hourly
job (**Integrations → Cron** now lists `maham-books-email-alerts`, and the
daily clean-up `almailbooks-purge-deleted-records`). It is safe to run again.
Run it after the two earlier scripts if those are ever run again.

### 4. The function's secrets

In Supabase, open **Edge Functions → Secrets** and add two secrets (**Add
new secret**, then **Save**):

| Name             | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `RESEND_API_KEY` | the Resend API key from step 1.5 (`re_…`)                          |
| `ALERTS_FROM`    | `Maham One <no-reply@almailgroup.com>` (any address on the domain) |

### 5. Publish the function from GitHub

GitHub publishes the function to Supabase each time the app is deployed. It
needs a Supabase access token:

1. Open <https://supabase.com/dashboard/account/tokens> and click **Generate
   new token**. Name: `GitHub – Maham Books`. Copy the token (it starts with
   `sbp_`; Supabase shows it only once).
2. In the GitHub repository, open **Settings → Secrets and variables →
   Actions → New repository secret**. Name: `SUPABASE_ACCESS_TOKEN`. Secret:
   the token. **Add secret**.
3. Open **Actions → Test and deploy → Run workflow → Run workflow** (on
   `main`). When it finishes (about 10 minutes), open the run: the
   **functions** job's summary shows
   `{"ok":true,"database":true,"sender":true}`. If it says `false` for
   `database`, do step 3; for `sender`, step 4; then run the workflow again.

### 6. Turn it on in the app

1. Sign in, open the company and go to **Settings → Email alerts**.
2. Turn on **Email me alerts for …**, choose what to include, and click **Save
   changes**.
3. The first email, with everything that needs attention now, arrives within a
   minute. From then on, the morning emails follow the rules above.

Each owner and admin who wants the email turns it on for themselves, company
by company. **Send me the email now** sends it again at any time (at most once
a minute).

## If no email arrives

1. **Settings → Email alerts** shows the last problem, if there was one.
   - "The email sender is not set up yet": step 4.
   - "The … domain is not verified": step 1.4.
   - "The email-alerts function is not in Supabase yet": step 5.
   - "The email alerts script has not been run": step 3.
2. Look in the spam folder. In Gmail, open the email and choose **Report not
   spam** once; later emails then arrive in the inbox.
3. In Resend, **Emails** lists every email sent and what happened to it.
4. In Supabase, **Edge Functions → email-alerts → Logs** shows each run, and
   **Integrations → Cron → maham-books-email-alerts** its history.

The morning emails are sent only when something new needs attention (and on
Sundays); a quiet day without an email is expected.

## For developers

- The function's code is in `src/alerts/`: `collect.ts` (what needs attention),
  `email.ts` (the email, in both languages), `server.ts` (the schedule, "send
  it now", the checks) and `edge.ts` (Deno's entry).
  `npm run build:functions` bundles them into
  `supabase/functions/email-alerts/index.js`; `supabase/config.toml` deploys
  it without Supabase's JWT check, because the function checks its callers
  itself: the schedule's secret (from `almailbooks.email_alerts_config`), or
  the person's session and role.
- The database part is in
  `supabase/migrations/20261007000000_email_alerts.sql`; see
  [`supabase/README.md`](../supabase/README.md).
- Tests: `src/alerts/*.test.ts` and `src/cloud/email-alerts-sql.test.ts` run
  the function against the real database scripts with Resend faked.
- The changes of the team: `{"action":"notify"}` with the same secret, from
  `almailbooks.run_change_notifications()` every 5 minutes. `changes.ts` puts
  the changes in words (the app's bell uses the same) and decides when to
  email (`notifyDecision`); `renderChangesEmail` in `email.ts` writes the
  email; `runChangeNotifications` in `server.ts` claims who is due, saves the
  Resend idempotency key and the last change covered before sending, and
  answers `{ok, checked, sent, skipped, failed}`. No new secret is needed.
