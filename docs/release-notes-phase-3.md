# Maham One: release notes for Phase 3

This release puts the company owner in charge of the team, as **Super Admin**. The owner decides who does what, approves changes to issued invoices, confirms cheques and sees what the team changed.

Every new feature is **off until you switch it on**. Until then, everyone works exactly as before. Unless it says otherwise, only the **owner** can change these switches. Admins, accountants, staff and viewers can look but not change.

"The Super Admin" is the owner of a company. The app names nobody: whoever owns the company is its Super Admin.

"Script 1" means the database script `supabase/migrations/20261116000000_super_admin_approvals.sql`. "Script 2" means `supabase/migrations/20261123000000_change_feed.sql`. Only cloud companies need them. Until they run, the app keeps the features that need them hidden.

**Cloud companies only.** Approvals, cheque confirmation and change notifications work only in companies kept in the cloud. A company kept on one device only has no approvals and no notifications, because there is nobody else to ask or tell. Numbering on issue (and Void and reissue with it) works there too.

---

## What changed for everyone, with no switch

Nothing works differently until a switch is on. A few small things look different:

- Settings has a new page, **Approvals (الاعتمادات)**. Until Script 1 runs, it only says the cloud needs the latest database script. In a company kept on one device, it says approvals are for cloud companies.
- Settings → Numbering has a new section, **When invoices get their number (متى تحصل الفواتير على أرقامها)**. In a cloud company its switch appears only once Script 1 has run.
- In cloud companies, each new entry in a record's activity says who made it ("· by …", "· بواسطة …"). Older entries, and entries made on older versions of the app, name nobody.
- Once Script 1 has run, Settings → Team shows the owner as **Owner (Super Admin) (المالك (المشرف العام))**, and Settings → Companies shows the owner **Companies you own**.
- Voiding an invoice works as before until approvals or numbering on issue are switched on.
- Viewers no longer see **Attach file** or the remove button next to files. They could not save such changes before either.

---

## #6 Super Admin

The owner of each company is its Super Admin and decides who does what.

- Go to Settings → Team (الإعدادات ← الفريق). Once Script 1 has run, the owner sees a **Super Admin (المشرف العام)** section with one switch: **Only the owner makes admins and accountants (المالك وحده يعيّن المديرين والمحاسبين)**. It is off by default.
- With it on, only the owner invites, changes or removes admins and accountants. Admins still invite and remove staff and viewers. Turning it on cancels invitations as admin or accountant that someone else sent, so tell the admins first.
- Next to each member there is **Permissions (الصلاحيات)**. There the owner can make an app **View only (اطلاع فقط)** or **No access (لا وصول)** for that person. Maham Books can only be made view only, because the other apps use its customers and items.
- Limits only take away from the person's role. They never add to it. The cloud refuses what the person saves in a limited app. Files go with the app of what they are attached to: with People view only, a scan in an employee's personnel file can't be added or removed either. Settings and activity follow the role, except the books' settings (the lock date, numbering, payment details with the bank account and WAMD number, email templates and document defaults), which follow the limit on Maham Books. What is already on their device stays there.
- In the same dialog, **Can approve (صلاحية الاعتماد)** lets an admin or accountant approve requests besides the owner. Up to two people. It is off for everyone at first. Click **Save (حفظ)**.
- Settings → Companies → **Companies you own** (الإعدادات ← الشركات ← الشركات التي تملكها) lists every cloud company the owner owns, with **Open its team (فتح فريقها)**.
- To make someone the Super Admin, the current owner transfers ownership to them (step 3 below).
- Who: the owner only. Script: **yes, Script 1**.

## #8 Invoice approval and Void invoices

Issued invoices and credit notes can be kept for an approver to change. Invoice numbers are never used twice.

- Go to Settings → Approvals (الإعدادات ← الاعتمادات). Turn on **Issued invoices need an approver to change (تعديل الفواتير الصادرة يحتاج إلى معتمِد)** and, if you want, **Issued credit notes need an approver to change (تعديل الإشعارات الدائنة الصادرة يحتاج إلى معتمِد)**. Click **Save changes (حفظ التغييرات)**.
- With it on, only an approver changes, voids or restores an issued invoice. An approver is the owner, or an admin or accountant with Can approve.
- Everyone else, staff included, gets **Send for approval (إرسال للاعتماد)** instead of Save, and **Request void (طلب الإبطال)** instead of **Void document (إبطال المستند)**, with a reason. Anyone can still work on drafts and new invoices. Payments and retention releases go on as before.
- **Payment links:** anyone who could before can still add one to an issued invoice that has none. Once it has one, only an approver changes or removes it, because it is where the customer pays. A device that hasn't received the link yet keeps it when it sends the invoice, for example with a payment, and the payment goes through.
- **Void instead of delete (الإبطال بدلاً من الحذف)** turns on with the first rule you switch on. Issued invoices and credit notes are then voided, never deleted, so their numbers stay used. Drafts can still be deleted.
- Voided invoices are under Sales → Invoices → **Void** (المبيعات ← الفواتير ← ملغاة). The list is called **Void invoices (الفواتير الملغاة)**.
- **Cancel requests still waiting after (days) (إلغاء الطلبات التي لا تزال بالانتظار بعد (أيام))** is 14 at first. 0 keeps them waiting.
- Requests are in **Approvals (الاعتمادات)** in the Books sidebar, which appears once a rule is on. Approvers also see a count on the home page. The Invoices list gets a **Waiting for approval (بانتظار الاعتماد)** filter.
- An approver opens a request, sees what would change, and clicks **Approve (اعتماد)** or **Reject (رفض)**. Whoever asked can **Take back (سحب الطلب)** while it waits.
- **Void and reissue (إبطال وإعادة إصدار)** is on an issued invoice or credit note, in the **⋯** menu (More actions, إجراءات أخرى). It voids the invoice and opens a new draft in its place. The new one gets a new number when issued, and its PDF prints "Replaces INV-…" ("بدلاً من"). Money paid on the void one becomes the customer's unused credit, to apply to the new one.
- On a void invoice, **Issue again in its place (إصدار مستند بدلاً منه)** does the same. Both appear only once approvals or numbering on issue are on.
- **Numbering on issue:** Settings → Numbering → **Number invoices and credit notes when they are issued** (الإعدادات ← الترقيم ← ترقيم الفواتير والإشعارات الدائنة عند إصدارها), then Save changes. Drafts get their number only when they are sent, so a deleted draft never uses up a number. In a cloud company the switch appears only once Script 1 has run. In a company kept on one device it is there now.
- Who: only the owner changes the approval rules; everyone else sees them. Numbering on issue: owner, admin or accountant. Script: **yes, Script 1** (numbering on issue needs it only in cloud companies).

## #9 Cheque confirmation

A cheque recorded by someone who is not an approver waits as a request. It reaches the books only when an approver confirms it.

- Go to Settings → Approvals → **Cheques** (الإعدادات ← الاعتمادات ← الشيكات) and turn on **Cheques need confirmation (الشيكات تحتاج إلى تأكيد)**. Click **Save changes**.
- It turns on what we recommend: **Cheques issued (الشيكات الصادرة)** and **Security cheques given (شيكات الضمان المسلَّمة)** on, **Cheques received (الشيكات المستلمة)** off. Each can be changed on its own.
- A covered cheque recorded by anyone else is not a payment yet. The button says **Send for confirmation (إرسال للتأكيد)**. While it waits, the cheque is not in the books, the cheque register's totals or the morning alerts, and it can't be printed. Its bill or invoice says a cheque is waiting, so nobody records it twice.
- The approver finds it in **Approvals** and in Cheques → **Waiting for confirmation** (الشيكات ← بانتظار التأكيد), and clicks **Confirm (تأكيد)** or **Reject (رفض)**. Confirming records the payment as it was asked, dated the day the cheque was written or received.
- Changing a confirmed cheque's amount, payee, number, bank or dates waits the same way. So do deleting it, replacing it, and cashing a security cheque given out. Depositing, clearing, returning, cancelling, printing and notes go on as before.
- While cashing a security cheque waits, that security cheque can't be changed or deleted. If it changes anyway (on a device still on an older version), it can't be confirmed: the request says so. Reject it and ask again.
- If a bill was paid or the period was locked meanwhile, confirming says why. The request stays confirmed but not recorded. Use **Carry it out again (تنفيذه مرة أخرى)**, or Reject it.
- Leave cheques received off unless you need them. While one waits, its invoice stays unpaid, and the customer may still get a reminder.
- Keep the paper cheque in the office until it is confirmed. The app can't see paper.
- Who: the switch is the owner's. Anyone who records cheques today can send one for confirmation. Script: **yes, Script 1**. The Cheques section appears only once it has run.

## #7 Change notifications

The owner and the approvers can see what the rest of the team changed: in a bell, on an Updates page and by email.

- Go to Settings → Email alerts → **Changes by your team** (الإعدادات ← تنبيهات البريد ← تغييرات الفريق). Turn on **Tell me about changes by my team in … (أبلغني بتغييرات فريقي في …)** and click **Save (حفظ)**. Each person turns their own on, company by company. Until someone in the company turns it on, nothing is recorded.
- **The bell (المستجدات, Updates)** then appears at the top, next to the app switcher. It counts unread changes and lists the latest.
- **See all updates (عرض كل المستجدات)** opens the **Updates (المستجدات)** page. It shows changes by day, with All, Unread and Important, a filter by kind, **Mark all as read (تعليم الكل كمقروء)** and a link to each record. A change shows once the device that made it has synced.
- **Email at once (بالبريد فوراً)** sends important changes within about 5 minutes:
  - an issued invoice or credit note changed, voided, restored or deleted;
  - cheques and security cheques;
  - approval requests and each decision;
  - someone joining or leaving, or a role or permissions changing;
  - the numbering, the lock date or the approval rules changing;
  - pay runs added, approved, paid or deleted.

  Each kind can be turned off and left for the summary.

- **Everything else in a morning summary (كل ما عدا ذلك في ملخص صباحي)** comes at 8:00 Kuwait time, on days the team changed something. Turn it off to get only the important changes.
- Each person gets at most one email every 15 minutes, and 20 a day, per company. Whatever comes meanwhile goes in the next email. The emails go to the address of the person's account.
- Nobody sees their own changes. Changes to payroll and people data say only what happened, never a name, a Civil ID or an amount. Changes are kept for 180 days.
- Who: the owner, and admins or accountants with Can approve. Nobody else sees the section, the bell or the Updates page. Script: **yes, Script 2**, after Script 1. The emails also use the email alerts you already have (see step 2).

---

## Good to know

- **Approvals finish when the device syncs.** In a cloud company, clicking Approve or Confirm first sends the decision to the cloud. The change itself is made only once the cloud has it, when that device syncs, not at the moment of the click. If the device is offline, it waits until it is back online. The card says when it is waiting for the device to sync. A request taken back or decided on another device meanwhile stays as the cloud has it.
- **Companies kept on one device only** have no approvals, no cheque confirmation and no notifications. Numbering on issue still works there.
- **Email limit.** The email service's free plan (Resend) sends 100 emails a day. The change emails share that with the morning alerts. With the owner and two approvers getting them, a busy day can take up to 60 for changes alone. A paid plan is advisable once the team is busy.
- **Older versions of the app.** If a device still on an older version makes a change that now needs approval or confirmation, the cloud refuses it. On an updated device the change waits in Settings → Cloud and sync (الإعدادات ← السحابة والمزامنة), with **Send for approval instead (إرساله للاعتماد بدلاً من ذلك)** or **Send for confirmation instead (إرساله للتأكيد بدلاً من ذلك)**. On the older device, use **Undo my change (التراجع عن تغييري)** there. A payment link changed or removed on an older version by anyone but an approver doesn't take: the invoice keeps the link the cloud has. This is why every device should update first.
- **Sync before working on an issued invoice.** With approvals on, a device that hasn't synced may still have an old copy of an invoice. Click **Sync now** first, especially on phones that were offline:
  - If an approver changed an issued invoice and someone then records a payment on it from a device that hadn't synced, the cloud holds that payment back. It waits in Settings → Cloud and sync. Undo it there, let the device sync, and record it again.
  - A payment link added on a device that hadn't synced is replaced by the link the cloud already has, if it has one.
  - Remove a payment link only once every device has synced. Otherwise a device that still has the old link can put it back.

## One-time steps for the owner

1. **Update every device, and let each one sync, before switching anything on.**
   - When "A new version of Maham One is available" (يتوفر إصدار جديد من مهام ون) appears, save your work and click **Reload (إعادة التحميل)**.
   - Then open Settings → Cloud and sync and click **Sync now (المزامنة الآن)**.
   - Ask everyone in the team to do the same on each of their devices, phones included. Older versions don't know the new rules, so this matters most before approvals, cheque confirmation or numbering on issue are turned on.
2. **Run the two database scripts** (cloud companies only). This can be done days after the new version is out: until the scripts run, the app works as before.
   - Open Supabase → **SQL Editor** → **New query**.
   - Open [Script 1 on GitHub](https://github.com/almailgroup/MahamOne/blob/main/supabase/migrations/20261116000000_super_admin_approvals.sql) and click **Copy raw file** (the copy icon above the file). Paste the whole of it and click **Run**. Its last line is `notify pgrst, 'reload schema';`. If Supabase warns about "destructive operations", choose **Run this query**. It should end with "Success. No rows returned".
   - Then a new query, the same way, with [Script 2](https://github.com/almailgroup/MahamOne/blob/main/supabase/migrations/20261123000000_change_feed.sql). It must come after Script 1. If Script 1 hasn't run, Script 2 stops with "Run 20261116000000_super_admin_approvals.sql first" and changes nothing.
   - Both come after the `20261102000000_tables_v16.sql` script of the last release. If that one hasn't run, Script 1 stops with "Run 20261102000000_tables_v16.sql first" and changes nothing: run that script first (step 8 of `docs/supabase-setup.md`), then Script 1. Both are safe to run again. If Script 1 is ever run again, run Script 2 again after it. **Never run the first script (`20261004000000_almailbooks_cloud.sql`) again.**
   - Running them changes nothing by itself. The app notices them by itself within about ten minutes, as it syncs. Then the new settings appear.
   - **The change emails need nothing more**, as long as the morning email alerts already arrive. Script 2 sets up its own schedule every 5 minutes. It uses what the email alerts already have: their database script, the Resend key and the sender in Supabase. GitHub publishes the new email function by itself when this version is deployed, as it does for the morning alerts. No new key or secret is needed.
   - To check: in Supabase, **Integrations → Cron** lists `maham-change-notifications`. In the app, Settings → Email alerts → Changes by your team does not say "The email sender is not set up in Supabase yet". If the morning alerts were never set up, follow `docs/email-alerts.md` first.
3. **Make the Super Admin the owner of each company.**
   - The current owner opens Settings → Team → **Transfer ownership** (الإعدادات ← الفريق ← نقل الملكية), under "Leave or delete" (المغادرة أو الحذف).
   - They choose the Super Admin's account as **New owner (المالك الجديد)** and click **Transfer ownership**. The previous owner becomes an admin.
   - The Super Admin's account must already be a member of the team. If it isn't, invite it first in Settings → Team and wait until the invitation is accepted.
   - Skip this where the Super Admin is already the owner.
4. **Switch on what you want (optional).** Do this after steps 1 to 3. Everything stays off until then.
   - Settings → Team → **Only the owner makes admins and accountants**. Off by default. Tell the admins first.
   - Settings → Team → **Permissions** next to up to two admins or accountants → **Can approve** → Save. These are the deputies who may approve besides the owner.
   - Settings → **Approvals**: the invoice and credit note switches, Void instead of delete, the days, and under **Cheques**, **Cheques need confirmation**. Then Save changes.
   - Settings → Numbering → **Number invoices and credit notes when they are issued**. Then Save changes. An admin or accountant may do this one too.
   - Settings → Email alerts → **Changes by your team** → Tell me about changes by my team → Save. Each approver who wants the changes turns on their own.
5. **Ask the auditor to confirm the numbering.** Invoice numbers are never reused. A void invoice keeps its number. A corrected invoice gets a new number, and says which one it replaces. With numbering on issue, drafts get their number only when they are issued.
