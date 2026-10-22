# Maham One: release notes for Phase 4

This release is for Maham People and the papers in Maham Compliance. The company sets its own leave reasons. The Super Admin approves pay runs before they are posted. Expiry reminders come at the right time for each kind of paper. Employee letters are made from templates, numbered and printed.

Every new feature is **off until you switch it on**. Until then, everyone works exactly as before. Each feature below says who can change its switch. The others can look but not change.

"The Super Admin" is the owner of a company. The app names nobody: whoever owns the company is its Super Admin.

"The script" means the database script `supabase/migrations/20261130000000_people_alerts.sql`. It comes after the two scripts of Phase 3. Only cloud companies need it. Until it runs, the app keeps the features that need it hidden.

**Pay and balances stay as they are.** Leave of the six types of the Labour Law is paid and counted exactly as before. Pay, leave balances, provisions and settlements change only when leave is recorded with one of your new reasons, or when you turn on the switch for long unpaid leave.

**Private.** Staff and viewers never see leave reasons, pay runs, letters, templates or the requests about them. The pay run email carries totals only: no names, nobody's own pay, no Civil IDs and no IBANs. Letters are never emailed.

**Cloud companies only.** Salary approval works only in companies kept in the cloud, and so do requests to issue a letter. A company kept on one device has leave reasons, expiry reminders and letters, but no salary approval and no requests.

---

## What changed for everyone, with no switch

Nothing works differently until a switch is on. A few small things look different:

- Maham People's sidebar has two new entries, **Leave reasons (أسباب الإجازة)** and **Letters (الخطابات)**. The Leave page has a **Leave reasons** button too. Until the reasons are switched on, recording leave offers the six types only, as before.
- Each employee has a **Letters (الخطابات)** tab, and the **New (جديد)** menu has **Employee letter (خطاب موظف)**. Until letters are on, they say letters are off. In a cloud company, until the script runs, the Letters page says the cloud needs the latest database script.
- Every pay run has **Register by department (الكشف حسب القسم)**. It is a printable register of the pay run by department and position, in English and Arabic, with lines for signatures. It adds up to the pay run's totals. Nothing in the pay changes.
- **Renew (تجديد)** on a paper offers an optional **New copy (النسخة الجديدة)**: a scan of the renewed paper. The personnel file has **This file is the… (هذا الملف هو…)** to mark a scan as the copy of a paper. Add documents can mark a batch the same way (**These files are each employee’s**, هذه الملفات لكل موظف هي). Nothing asks for a new copy until its switch is on.
- Restoring a backup with **Replace everything (استبدال الكل)** in Settings → Backup & data keeps the numbering counters of the companies already on the device when they are higher. A number given after the backup was made is never given again.
- Once the script has run:
  - Settings → Approvals shows a **Pay runs (مسيرات الرواتب)** section. Its switch is off.
  - Settings → Email alerts lets accountants get the morning email too. Each person can choose the kinds of paper they are told about. All are ticked at first.
  - The morning email leaves out what the owner gave the person no access to (Settings → Team → Permissions): employees' papers without Maham People, the other papers and the deadlines without Maham Compliance, and invoices, bills and cheques without Maham Books. It lists the papers by kind.

---

## #15 Custom leave reasons

The company adds its own reasons for leave, besides the six types of the Labour Law. Each reason says how its leave is paid and what it does to the balances.

- Go to Maham People → **Leave reasons** (مهام بيبول ← أسباب الإجازة). The same page opens from the **Leave reasons** button on the Leave page.
- Click **Add the recommended reasons (إضافة الأسباب الموصى بها)**. This adds **Emergency leave (إجازة طارئة)**, taken from annual leave, and **Compensatory days (أيام تعويضية)**, on full pay from days added by hand. Use **Add a reason (إضافة سبب)** for any other. A new reason starts on full pay.
- Each reason is paid one of five ways:
  - **Full pay (بأجر كامل)**: the annual leave balance doesn't change.
  - **Half pay (بنصف أجر)**: each calendar day of it costs half a day's pay.
  - **Without pay (بدون أجر)**: each calendar day of it costs a day's pay, like unpaid leave.
  - **Taken from annual leave (تُخصم من الإجازة السنوية)**: full pay, taken from the annual leave balance, like annual leave.
  - **Full pay, from days added by hand (بأجر كامل، من أيام تُضاف يدويًا)**: add the days on the employee's Leave tab with **Add days (إضافة أيام)**, for example for work on a rest day.
- A reason can also have **Most days a year (أقصى عدد من الأيام في السنة)**. Leave over it is still recorded, with a warning. It can be only for some categories of staff, for example domestic workers under Law 68/2015. It can need a note.
- Turn on **Offer these reasons when leave is recorded (عرض هذه الأسباب عند تسجيل الإجازات)** and click **Save changes (حفظ التغييرات)**.
- **Record leave (تسجيل إجازة)** then offers the reasons under **The company’s leave reasons (أسباب الإجازة الخاصة بالشركة)**.
- Each leave keeps the pay it was recorded with. Turning the reasons off never changes leave already recorded. Once leave is recorded with a reason, how that reason is paid can't change and the reason can't be removed. **Archive (أرشفة)** it and add a new one instead.
- A pay line whose month has such leave lists it under **Leave by reason (الإجازات حسب السبب)**, in the line and on the payslip. Payslips of an approved or paid pay run show the leave as it was recorded when the run was approved.
- **Long unpaid leave (الإجازات الطويلة بدون أجر)** is on the same page, with its own switch: **A month of service with more than 15 days of unpaid leave earns no annual leave (شهر الخدمة الذي تزيد فيه الإجازة بدون أجر على 15 يومًا لا تُستحق عنه إجازة سنوية)**. It is off. It counts unpaid leave in calendar days; leave on half pay doesn't count. Its **From (من)** date is the first day of next month at first. Months of service that start before it earn leave as before. With it on, annual leave balances, the leave salary provision and final settlements follow. Ask the auditor first (step 5).
- Sick leave tiers stay per calendar year, as before.
- Who: the owner, admins and accountants. Staff and viewers never see it. Script: **no**. It works in companies kept on one device too.

## #10 Salary approval

A pay run is posted only once the Super Admin, or a deputy they chose, has approved it.

- Go to Settings → Approvals → **Pay runs** (الإعدادات ← الاعتمادات ← مسيرات الرواتب). Turn on **Pay runs need the Super Admin’s approval (مسيرات الرواتب تحتاج إلى موافقة المشرف العام)** and click **Save changes (حفظ التغييرات)**. This section appears only in cloud companies, once the script has run.
- Turning this on alone leaves invoices and Maham Books as they are.
- With it on, an admin or accountant prepares the pay run as before. On the draft, they click **Ask for approval (إرسال للموافقة)**, with a note if needed.
- **Approve (اعتماد)**, which posts the pay run to the books, stays greyed out until the pay run is approved. A strip on the pay run says where it stands.
- The owner, or an admin or accountant with **Can approve (صلاحية الاعتماد)** who didn't send it, decides. They click **Give approval (موافقة)** or **Reject (رفض)** on the pay run, or in **Approvals (الاعتمادات)**. Approvals now appears in the Maham People sidebar too, and approvers see a count on the home page. Whoever sent it can **Take back (سحب الطلب)** while it waits.
- Then whoever prepared it clicks **Approve** to post it, and pays it as before.
- The owner may approve a pay run they sent themselves, and may post any pay run at once.
- Any change after it was sent asks for a new approval: a line, the pay date, or **Update from records (تحديث من السجلات)** that changes something. A pay run reopened after posting needs a new approval too.
- Only a pay run that could be posted as it is can be sent. Put right first net pay below zero, a loan recovered beyond what is left, a final settlement for the month, leave by reason not worked out, or a pay date in the locked period.
- The approver sees the totals by department and position. **Show each employee’s pay (عرض راتب كل موظف)** shows each person's pay, in the app only.
- **The email.** The owner and the approvers, but not the sender, get an email in their language. It has the number of employees, gross pay, deductions, net pay, the employer's PIFSS share, the cost to the company, the change in net pay since last month, and the totals by department and position. It has a link that opens the pay run in the signed-in app. Opening the link decides nothing.
  - A department or position of one person is merged into "Other departments" or "Other positions".
  - The change since last month is left out when exactly one person joined or left.
  - A pay run of one person has no amounts at all.
  - Never names, nobody's own pay, no Civil IDs, no IBANs and not the note.
- A member the owner gave no access to Maham People doesn't see pay run requests, gets no email of them and can't decide them.
- Requests still waiting after the days set in **Cancel requests still waiting after (days)** on the same page (14 at first) are cancelled.
- Nothing in the pay is worked out differently. Approval only decides when a pay run can be posted.
- Who: only the owner changes the switch. Admins and accountants send. Script: **yes**.

## #18 Expiry alerts

Reminders come at the right time for each kind of paper. They come again after a paper has expired. After a renewal, the app asks for the new copy.

- Go to Maham Compliance → Calendar → **Settings** (مهام الامتثال ← التقويم ← الإعدادات). The section is **Expiry reminders (تذكيرات الانتهاء)**. The same dialog opens from Settings → Compliance and files → **Compliance settings** (الإعدادات ← الامتثال والملفات ← إعدادات الامتثال), and from the gear on Maham People → Employees. Click **Save (حفظ)**.
- Each part has its own switch. Each is off at first:
  - **Reminders by document type (التذكير حسب نوع المستند)**: it offers the lead times you chose. Residency 90, 60, 30 and 7 days before; passport 180, 90 and 30; vehicle registration and insurance 30, 14 and 7. Days can be changed, and types added (**Add type**, إضافة نوع) or removed. Up to five reminders a type. Other types keep the company's days, and a document's own days come first.
  - **Remind again after expiry (التذكير مجدداً بعد الانتهاء)**: an expired paper is in the email again every 7 days until it is renewed, instead of only in Sunday's summary. The days can be changed.
  - **Ask for the new copy after a renewal (طلب النسخة الجديدة بعد التجديد)**: a paper renewed with **Renew** from that day on is marked **New copy missing (لم تُرفع النسخة الجديدة)** after 14 days, unless its new scan was added. The days can be changed. Add it with Renew's **New copy**, or mark it with **This file is the…** in the personnel file. Maham Compliance → Documents has a **New copy missing** filter. The home page and the morning email show it too.
  - **Show the reminders in Updates (إظهار التذكيرات في المستجدات)**: in cloud companies, once the script has run. The owner and the approvers who get the changes of the team find each new reminder under the bell (**Updates**, المستجدات) each morning. Employees' papers show there without names. They are not emailed again as changes.
- Once the script has run, Settings → Email alerts (الإعدادات ← تنبيهات البريد) lets accountants turn the morning email on. Under **Papers and licences (الوثائق والتراخيص)**, each person ticks the kinds of paper they want: **Company papers and licences (وثائق الشركة وتراخيصها)**, **Vehicles’ papers (وثائق المركبات)**, **Employees’ papers (وثائق الموظفين)** and **Customers’ papers (وثائق العملاء)**. Click **Save changes**.
- WhatsApp and SMS are not part of this.
- Who: the owner, admins and accountants change the reminders. Staff and viewers don't see them. Script: **only for Show the reminders in Updates, and for accountants and the kinds of paper in Settings → Email alerts**. The other three switches work without it, on the device and in the morning email.

## #19 Employee letters

Salary, experience and employment certificates, warning letters and no objection certificates. They are filled from each employee's record, numbered when they are issued and printed on A4 with the company's letterhead.

- Go to Maham People → **Letters** (مهام بيبول ← الخطابات). Turn on **Use employee letters (استخدام خطابات الموظفين)**. It is saved at once. In a cloud company the switch appears only once the script has run.
- **Letter templates (قوالب الخطابات)**, at the top of the Letters page, has the five first letters: **Salary certificate (شهادة راتب)**, **Experience certificate (شهادة خبرة)**, **Employment certificate (شهادة عمل)**, **Warning letter (خطاب إنذار)** and **No objection certificate (شهادة عدم ممانعة)**. Each has the app's wording in Arabic and English. Letters print in Arabic unless a template says English or both. Edit the wording with the fields filled from the employee's record. **Restore default (استعادة النص الافتراضي)** puts back the app's wording.
- **Ask your lawyer to check the wording** of the warning letter and the no objection certificate before they are issued. They have legal weight under the Labour Law.
- **New letter (خطاب جديد)** makes a draft. So does the employee's Letters tab, and **Experience certificate** in the **⋯** menu of a final settlement.
- Accountants make drafts and click **Send for approval (إرسال للاعتماد)**. The owner, admins and members with Can approve click **Issue letter (إصدار الخطاب)**, or **Approve and issue (اعتماد وإصدار)** on a request. That issues it on their device. The cloud refuses an issue by anyone else.
- A letter gets its number when it is issued: HR-2026-0001, from 1 again each year. Numbers are never used twice. A deleted draft uses no number. An issued letter can't be deleted: **Void letter (إلغاء الخطاب)**, with a reason, keeps its number. Once issued it stays as it was issued, and a void letter stays void.
- A warning letter or no objection certificate is issued only once it says what happened, or what the company has no objection to.
- A template can make a draft by itself when an employee joins, leaves or has their salary changed (**Automatic drafts**, المسودات التلقائية). Imported employees make none. A person always checks and issues each draft.
- The **To print (للطباعة)** tab lists issued letters until they are printed, with **Print all (طباعة الكل)**. The signature and the stamp of Settings → Company print only on issued letters, when the template says so. Drafts print with a watermark (مسودة · DRAFT).
- The Civil ID, passport number and bank account print only where a template allows them and the owner, an admin or an approver issues the letter. Otherwise they print masked.
- Once it is signed, **Attach the signed copy (إرفاق النسخة الموقّعة)** keeps a scan in the employee's personnel file.
- An employee with issued letters can only be marked as left, not deleted.
- Who: only the owner or an admin turns letters on or off. Owners, admins and accountants make drafts and templates. Staff and viewers never see letters. Script: **yes**, in cloud companies. A company kept on one device doesn't need it.

---

## Good to know

- **Approvals finish when the device syncs.** As in Phase 3, **Give approval** and **Approve and issue** first send the decision to the cloud. The letter is issued, and the pay run can be posted, once the device has synced.
- **Older versions of the app.**
  - An older version doesn't know salary approval. It can still post a pay run without approval. Updates (المستجدات) report every pay run posted. This is why every device that prepares pay runs should update first.
  - An older version shows the leave of a reason as one of the six types. The Leave reasons page says which, below each reason. It shows half-pay leave as unpaid, and a pay run it works out pays nothing for those days. The updated app won't post such a pay run: click **Update from records** first, then approve.
  - An issued letter stays as it was issued, whatever an older copy on another device says.
- **Email limit.** The pay run emails count towards the 100 emails a day of Resend's free plan, with the morning alerts and the change emails. Each approver gets one email per request.
- **Letters are printed, never emailed.** Employees don't get them in an app yet.

## One-time steps for the owner

1. **Update every device, and let each one sync, before switching anything on.**
   - When "A new version of Maham One is available" (يتوفر إصدار جديد من مهام ون) appears, save your work and click **Reload (إعادة التحميل)**.
   - Then open Settings → Cloud and sync and click **Sync now (المزامنة الآن)**.
   - Ask everyone in the team to do the same on each of their devices, phones included. This matters most on devices that record leave or prepare pay runs.
2. **Run the database script** (cloud companies only). This can be done days after the new version is out: until the script runs, the app works as before.
   - The two Phase 3 scripts must have run first, and the Super Admin must be the owner of each company (step 3 of the [Phase 3 release notes](release-notes-phase-3.md)).
   - Open Supabase → **SQL Editor** → **New query**.
   - Open [the script on GitHub](https://github.com/almailgroup/MahamOne/blob/main/supabase/migrations/20261130000000_people_alerts.sql) and click **Copy raw file** (the copy icon above the file). Paste the whole of it and click **Run**. Its last line is `notify pgrst, 'reload schema';`. If Supabase warns about "destructive operations", choose **Run this query**. It should end with "Success. No rows returned".
   - If the second Phase 3 script (`20261123000000_change_feed.sql`) hasn't run, it stops with "Run 20261123000000_change_feed.sql first, then this file." and changes nothing. Run that one first, then this one.
   - If the morning email alerts were never set up, it says "This database has no email alerts (20261007000000_email_alerts.sql): run it, then this file again." and goes on. Set them up with `docs/email-alerts.md`, then run this script again.
   - It is safe to run again. If either Phase 3 script, or the email alerts script, is ever run again, run this one again after them. **Never run the first script (`20261004000000_almailbooks_cloud.sql`) again.**
   - Running it changes nothing by itself. The app notices it by itself within about ten minutes, as it syncs. Then the new settings appear.
   - To check: Settings → Approvals shows **Pay runs**, and Maham People → Letters shows **Use employee letters**.
3. **Links in the pay run emails (optional, recommended).**
   - GitHub publishes the updated email function by itself when this version is deployed, as it does for the morning alerts. No new key is needed.
   - For the link in each pay run email, add a secret in Supabase: **Edge Functions → Secrets → Add new secret**. Name `MAHAM_APP_URL`, value where the app is, for example `https://mahamone.com/`. Save.
   - Without it, the link uses the address each person saved with their email alerts or their changes by the team. Someone who saved neither gets the email without a link.
   - The pay run emails need the email alerts set up. If Settings → Email alerts says "The email sender is not set up in Supabase yet", follow `docs/email-alerts.md` first.
4. **Switch on what you want (optional).** Do this after steps 1 to 3. Everything stays off until then.
   - Maham People → **Leave reasons**: add the reasons, check how each is paid, then **Offer these reasons when leave is recorded** → Save changes. On the same page, the **Long unpaid leave** switch and its From date, only once the auditor has confirmed it (step 5).
   - Settings → **Approvals** → **Pay runs** → **Pay runs need the Super Admin’s approval** → Save changes. The owner only. Deputies who may approve besides the owner are set in Settings → Team → **Permissions** (الصلاحيات) → **Can approve** → Save.
   - Maham Compliance → Calendar → **Settings** → **Expiry reminders**: the switches you want → Save.
   - Settings → **Email alerts**: each person, accountants included, turns on their own email and ticks the kinds of paper → Save changes.
   - Maham People → **Letters** → **Use employee letters**. Ask your lawyer to check the warning letter and the no objection certificate in Letter templates first.
5. **Ask the auditor to confirm**, before the switches that change pay or balances are turned on:
   - **The long unpaid leave pause.** A month of service with more than 15 calendar days of unpaid leave earns no annual leave. It lowers the annual leave balance, the leave salary provision and the final settlement of staff on long unpaid leave. Also confirm its From date. A date that has passed changes balances from that date, and the next approved pay run's leave provision takes in the difference.
   - **How each leave reason is paid.** Leave taken from annual leave lowers the annual leave balance and the leave salary provision. Leave on half pay or without pay lowers the month's pay.
   - **The pay run records.** The approved pay run and its register by department and position (Maham People → Payroll → the pay run → **Register by department**) are kept with the month's records. Nothing in the pay is worked out differently.
   - **Letter numbers.** Letters are numbered HR-{year}-{counter} from 1 each year and never reused. An issued letter is voided, never deleted, and keeps its number.
