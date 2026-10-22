# Maham One

Maham One (مهام ون) is AL Mail Group's suite of office apps over one company's
data, in the spirit of Zoho One. Maham Books, the accounting app this
repository started as, is now one of its apps. Everything still runs in the
browser, offline first, with the same database on the device and the same
cloud sync.

| App              | Arabic        | For                                                        | Opens at      |
| ---------------- | ------------- | ---------------------------------------------------------- | ------------- |
| Maham Books      | مهام بوكس     | Invoices, purchases, cheques, banking, accounting, reports | `/books`      |
| Maham People     | مهام بيبول    | Employees, directory, payroll, leave, staff loans          | `/people`     |
| Maham CRM        | مهام CRM      | Quotes pipeline, follow-ups, prospects (first version)     | `/crm`        |
| Maham Compliance | مهام الامتثال | Licences, staff papers, statutory deadlines                | `/compliance` |

The suite's home (`/`) is a launcher: every app someone may open, the things
most often created ("New invoice", "Record expense"…), each app's main tools
and the company's own links and integrations (Settings → Links), each a round
tile one click away, with a box to find one by typing its name (Enter opens
the first). A link shows in every app's sidebar or only in the apps chosen
for it; Deema, Taly and Tahseel are added with their names filled in and
show under _Integrations_ (التكاملات) in Maham Books and Maham CRM until
the owner chooses otherwise. They are web pages that open in a new tab: no
key or payment goes through them.
Below them: what needs attention today (the same items as the morning email)
and money at a glance. The grid button in the header switches apps; on phones
the apps are at the top of the menu.

## What changed, and what deliberately didn't

**Changed**

- Pages and features that are only Books' moved to `src/apps/books/`; People's
  and Compliance's pages to `src/apps/people/` and `src/apps/compliance/`.
- Each app describes itself in a manifest (`src/apps/<app>/manifest.ts`): its
  sidebar, the pinned links at the bottom, what its New menu creates, its
  three phone tabs, its main tools for the home and who may open it. The
  sidebar, header, phone tab bar,
  New menus, command palette and the suite's home are built from the
  manifests (`src/suite/`).
- Each app brings its routes (`src/apps/<app>/routes.tsx`);
  `src/app/routes.tsx` puts them together with the suite's own pages.
- `/` is the suite's home. The Books dashboard moved to `/books`; a new
  company starts there, with its setup steps.
- The product name in the browser tab, the installed app, the welcome page,
  sign-in and the alerts email is Maham One.

**Not changed, on purpose**

- **Every address.** `/invoices/…`, `/payroll/…`, `/employees/…`,
  `/compliance/…` and all the others open the same pages as before, so
  bookmarks, shared links and the button in the alerts email keep working.
  `src/app/routes.test.ts` keeps the list of the old addresses.
- **The data.** No table, field or migration was added. The database on the
  device keeps its name (`AlmailBooks`), storage keys keep the `almailbooks.`
  prefix, backups keep `app: 'Maham Books'` and their file names, and the
  cloud tables and their rules are the same. Existing devices, backups and
  synced companies need nothing.
- **Documents.** Invoices and the other PDFs still say Maham Books where they
  name the app.
- **Roles.** The five roles (owner, admin, accountant, staff, viewer) and what
  the server allows each of them are unchanged; the apps follow them.

## Who opens which app

What each role may do in each app (`src/apps/<app>/manifest.ts`, shown to
owners and admins in Settings → Team):

| Role                        | Books       | People    | CRM         | Compliance |
| --------------------------- | ----------- | --------- | ----------- | ---------- |
| Owner, admin                | Full access | Full      | Full        | Full       |
| Accountant                  | Full access | Full      | Works in it | Full       |
| Staff                       | Works in it | No access | Works in it | View only  |
| Viewer                      | View only   | No access | View only   | View only  |
| Company on this device only | Full        | Full      | Full        | Full       |

- **People is private.** Staff and viewers never see Maham People: not in the
  switcher, the home, the sidebar, the New menus or search, and its pages show
  a lock card whatever the address. The cloud doesn't send them employees,
  payroll or employees' papers in the first place.
- Until the role of a cloud company is known, nothing of People shows and the
  other apps are only looked at.
- **View only** in an app turns its saving off, with a note at the top of its
  pages: the server refuses those changes anyway (Compliance's records are not
  among the tables staff may change).
- CRM's first version only reads quotes and customers, which staff may already
  change in Books.

## Sales, Books and Inventory as their own apps

A company can split Maham Books in three (#3, part a). Settings → Team
(الإعدادات ← الفريق) → **App layout (تخطيط التطبيقات)**, above the grid of
what each role can open: **Maham Sales and Maham Inventory as their own apps
(مهام سيلز ومهام إنفنتوري تطبيقان مستقلان)**. It is off at first. The owner
or an admin turns it on, after a confirmation, for everyone in the company;
every device follows once it syncs. Others see the switch but can't change
it. A company kept on this device only has it too.

| App             | Arabic        | Owns                                                                                                                      | Opens at     |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Maham Sales     | مهام سيلز     | Customers, quotes, proformas, sales orders, invoices, delivery notes, payments received, credit notes, recurring invoices | `/invoices`  |
| Maham Books     | مهام بوكس     | The dashboard, purchases, payments made, cheques, banking, accounting, VAT, reports, templates                            | `/books`     |
| Maham Inventory | مهام إنفنتوري | Items, stock, warehouses, stock counts and landed costs                                                                   | `/inventory` |

People, CRM and Compliance stay as they are. The owner's answers to the
questions of the plan:

- **Invoices are Maham Sales'.** Maham Books (finance) still lists customers,
  invoices, payments received and credit notes under **Receivables (الذمم
  المدينة)**, and the items and stock it values. Opened from Books, those
  pages keep Books' sidebar; opened from Sales, Sales'.
- **Inventory is its own app; purchases stay in Books.** Inventory also lists
  purchase orders, bills, vendors and delivery notes, the documents that move
  stock, with its own sidebar around them.
- **Finance keeps the name Maham Books**, with its id (`books`), its
  dashboard at `/books` and its access.
- **No HR-only or Sales-only roles** in this plan: they need per-app rules on
  the server. Who opens Sales and Inventory is who opens Books, as far as
  Books.

What changes and what doesn't:

- **Only the shell changes**: the sidebars, the switcher (six apps in rows of
  three), the phone tabs, the New menus (each action once, the open app's
  first), the home (six apps, with overdue invoices under Sales, bills and
  cheques under Books and the number of items under Inventory) and search
  (a page says which app it is in).
- **No address, record or rule changes.** Every page keeps its URL; the
  manifests only decide which app's sidebar is around it
  (`src/suite/apps.ts`, `appsFor(company)` and `useApps()`). `Company.appLayout`
  is `'split'` or missing; missing (or anything else) is the four apps,
  exactly as before. No migration: the company record already syncs.
  Older versions of the app ignore the field and show the four apps.
- **The owner's limits keep their four apps** (Settings → Team →
  Permissions). The limit on Maham Books is also Maham Sales' and Maham
  Inventory's (`limitAppOf` in `src/cloud/roles.ts`): the permissions dialog
  names it "Maham Sales · Maham Books · Maham Inventory", and the cloud
  applies it to the records as before (`record_app` is unchanged).
- **Company links keep the apps they were saved with** (Settings → Links).
  A link for Maham Books shows in Sales, Books and Inventory; Deema, Taly and
  Tahseel, saved for Books and CRM, show in all four. The box for Books in
  Settings → Links says so. Nothing stored is rewritten.
- **The last app used** on Settings and the home is remembered in the
  browser. When it isn't in the layout any more (Sales, after the switch
  went off), the sidebar is Books'. An app chosen as a whole (the switcher,
  the phone's app tiles, the home's app and tool tiles, the palette's apps)
  is remembered as it opens, so Maham Sales opens at its invoices with its
  own sidebar even when Books, which lists them under Receivables, was the
  last app. When neither the page's app nor the last one can be opened (CRM
  closed by the owner's limits), the page's owner in the layout is shown.
- Sales is violet and Inventory teal; every theme, light and dark, has both.

## Employees across companies

People → All companies (`/people/all`) lists the employees of several
companies on this device at once, and search shows them under _Employees in
other companies_. It reads only what is already on the device; nothing new
is asked of the server.

- **Off until switched on.** Each company is switched on in Settings →
  Companies (_Employee search across companies_) or on the page itself; the
  switch is kept in the company's employee settings (`groupSearch`), so it
  travels with the company and its backups. Until two companies are on,
  Employees shows no link to the page.
- **Each company decides for itself.** A company's employees show when the
  person sees People there, from that company's own link: owner, admin or
  accountant, signed in with the account the company was linked with, or a
  company kept on this device only. Staff and viewer companies, companies no
  longer shared and another account's companies on a shared computer never
  show, whatever the role in the company that is open
  (`src/features/people/all-companies.ts`).
- **Only who works where.** The page and its spreadsheet show names, job,
  department and category (the spreadsheet also phone and email); never pay,
  IBANs or Civil IDs.
  Opening someone switches to their company first (asking before unsaved
  changes are lost), then opens their page there.

## Departments and stateless staff

- **Departments** are the company's own list, with English and Arabic names,
  kept in its employee settings (`peopleSettings.departments`). Employees
  keep the English name in `department` as before, so links, imports and
  older versions keep working; the Arabic name shows in the Arabic
  interface. Without a list, a department is typed freely, as before.
  Employees → Departments adds, renames (the employees in it get the new
  name in the same transaction, after a warning), merges another spelling
  into one, and archives; it can start the list from the names in use.
  Employees chosen on the list are given a department together. Pay runs
  keep each line's department (`PayLine.department`).
- **Stateless (Bedoon)** staff are expatriates with `stateless: true`, never
  a new category, so older versions show "Expatriate" and pay the same (no
  PIFSS). They need no residency, a work permit is optional, and their
  Central Agency review card (`centralCardNumber`, `centralCardExpiry`) is
  tracked and renewed in Compliance like the other papers on file
  (`central_agency_card`). An import reads Bedoon, بدون and غير محدد الجنسية
  (never a bare غير محدد, "not specified") as stateless for new employees;
  a residency number or expiry on such a row (or a single "Document Expiry")
  is kept as the review card, with a note. An employee already here is never
  made stateless by an import: the row says to choose it on their page. A
  country chosen by an older version wins over the flag. The bank's salary
  file uses the card number when there is no Civil ID
  (`PayLine.centralCardNumber`); the payslip shows it as the review card,
  never as a Civil ID.

## Drivers' licences

- **Off until switched on.** Compliance → Settings (also the settings button
  on Employees) has _Check drivers’ licences_, kept in the company's
  employee settings (`peopleSettings.drivingLicences`). Until it is on,
  nothing is flagged or asked, as before.
- **Who drives.** An employee needs a licence when their page says so
  (_Drives for work_: Automatic, Yes or No, kept as
  `drivingLicenceRequired`, null for Automatic), else when a company vehicle
  has them as its driver (Compliance → Vehicles, below), else by the job
  title in English,
  Arabic or on the work permit: the word "driver" (Valet Driver too) or
  سائق, never a valet who only parks cars (`isDriverTitle`).
- **What is flagged.** A current driver whose licence in the register is
  missing (archived ones don't count) or expired (`missingDocuments`): a
  _Driving licence missing_ row on their page, whose _Add document_ then
  starts with the licence, and a _Drivers without a valid licence_ filter on
  Employees and in the documents register (searched by name, number or job
  title there). A licence without an expiry date doesn't count as valid for
  a driver: it shows _No expiry date_ until its dates are entered, and a
  dated licence always comes before an undated one, so an expired licence is
  never hidden by one. The morning email follows with #18.
- **The licence** has an optional class (`licenceClass`, فئة الرخصة), asked
  while the check is on (or shown once stored). With the check on,
  Employees → Add documents can file the scans as the employees' driving
  licences: each goes on their licence still waiting for its dates, else
  the one that expires last, or a new one without dates, instead of the
  personnel file. Licences, their scans and the setting are people data,
  private as before.

## Annual leave policy

- **The law's until set.** Payroll → Settings has an _Annual leave_
  (الإجازة السنوية) card. Until _Set the company’s leave policy_ is used and
  saved, there is no `payrollSettings.leavePolicy` and every balance,
  provision and settlement is worked out as before: 30 working days a year,
  2.5 a month, usable after nine months, every unused day carried forward
  (`DEFAULT_LEAVE_POLICY` in `src/lib/hr/leave.ts`).
- **Dated days a year.** The policy lists days a year from dates (at least
  30, art. 70). Before its first date the law's 30 apply, so balances before
  it never change; each month of service earns a twelfth of the days in
  force, and a month in which they change earns a share of each by its
  days. A date already past is flagged: the next approved pay run's leave
  provision takes in the difference ("target less held", as before).
- **Also:** the months before the first leave (nine, or fewer), a cap on
  the unused days carried into a new calendar year (none by default; it
  applies from the first new year on or after the policy's first date, and
  the days lost show as _Over the carry-forward cap_ on the employee's leave
  tab). The days held the day before the policy's first date were earned
  under the law and are never lost: leave taken uses them first, and the cap
  applies to what is held above them. Removing or moving a saved date that
  has passed is flagged like adding one. Also whether annual leave counts
  working or calendar days. The
  counting can't change once annual leave has been recorded, since each
  record keeps the days it was saved with; the card disables it and saving
  refuses it.
- **Employees' own days.** Once the company has a policy, the employee's
  form asks _Annual leave days_ (`Employee.annualLeaveDays`, at least 30,
  the company's days as the placeholder) and the date they apply from
  (`Employee.annualLeaveDaysFrom`; empty: from the hire date or opening
  balance). Before that date the company's days count. A change that
  reaches a date already past is flagged on the form, as on the policy.
- The Leave page, the employee's leave tab and the leave dialog take their
  texts from the policy. The fields are payroll and employee data, private
  as before; older versions ignore them and keep the law's figures and
  working days, so in a company kept in the cloud the card asks for every
  device that records leave or approves pay runs to be updated first.

## Leave reasons of the company's own

- **Off until switched on.** Payroll → _Leave reasons_ (أسباب الإجازة; also
  in the People sidebar after _Leave_, and a button on the Leave page) keeps
  the company's own reasons in `payrollSettings.leaveReasons` (D11: names in
  English and Arabic, `base`, `pay` and limits; no new table). Until _Offer
  these reasons when leave is recorded_ (`leaveReasonsOn`) is on and saved,
  the leave dialog offers the six types only and nothing is paid or counted
  differently.
- **How each is paid** (`pay`), and the type its leave keeps in
  `LeaveRecord.type` (`base`) so older versions read it: on full pay
  (`bereavement`); on half pay (`unpaid`, with `LeaveRecord.payPercent` 50
  fixed when recorded: each calendar day costs half a day's pay, and
  `reducedPay` carries it for older readers); without pay (`unpaid`);
  taken from annual leave (`annual`: full pay, and the annual balance counts
  it as annual leave); or on full pay from a balance of its own, added by
  hand (`bereavement`; the days added are `adjustment` records with the
  reason, shown on the employee's leave tab with _Add days_). A reason can
  have the most days a year (a warning, counted in the year leave starts),
  be only for some categories (domestic workers under Law 68/2015), and
  need a note. _Add the recommended reasons_ adds emergency leave taken from
  annual leave and compensatory days added by hand; other reasons start on
  full pay.
- **Rules lock once used.** Once leave is recorded with a reason, how it is
  paid can't change and it can't be removed (archive it and add another);
  its names, days a year and categories still can. Each record keeps the
  pay it was saved with, so switching the reasons off never changes leave
  already recorded. Sick leave tiers stay per calendar year, as before.
- **Pay lines and payslips.** A line whose month has leave of a reason
  carries `PayLine.leaveDetail` (display only: days and share of pay by
  reason); the line dialog and the bilingual payslip list it. Approving
  refuses a line without it when the month has such leave (worked out
  before that leave, or by an older version, which pays half-pay leave as
  unpaid): _Update from records_ first.
- **Long unpaid leave** (its own switch, off): from the date chosen, a month
  of service (counted from the hire date or the opening balance, as accrual
  is) with more than 15 calendar days of unpaid leave earns no annual leave
  (`leaveAccrualPause`, `accrualOptions` in `src/lib/hr/leave.ts`). Leave on
  half pay doesn't count. It lowers balances, the leave provision and final
  settlements, so the page asks for the auditor's confirmation first; the
  employee's leave tab says how many months earned nothing.
- **Older versions** show a full-pay reason as bereavement leave (and warn
  above 3 days), a half-pay or unpaid one as unpaid leave (a half-pay one is
  paid as unpaid if an older tab updates a draft), leave from annual leave
  as annual leave, and days added by hand as a balance adjustment that
  changes nothing. In a cloud company the page asks for every device to be
  updated first. No database script: the reasons and switches are in the
  private payroll settings row.

## Salary approval by the Super Admin

- **Off until switched on.** Settings → Approvals → _Pay runs_ (مسيرات
  الرواتب), once the server has `20261130000000_people_alerts.sql`
  (`payroll_approvals` in `server_features`): only the owner (the Super
  Admin) turns on _Pay runs need the Super Admin's approval_
  (`Company.approvalRules.payroll`). Off, or in a company kept on this device,
  pay runs are approved as before. Rules set for pay runs only leave Books as
  it was (`approvalsOn` stays false: invoices are voided as before and the
  Books sidebar has no Approvals).
- **Ask, approve, post.** On a draft pay run an admin or accountant clicks
  _Ask for approval_ (إرسال للموافقة), with a note: an approvals row of kind
  `payroll` about the pay run (D6), private like it, carrying
  `after = {runUpdatedAt, period, currency, totals, groups}` (totals by
  department and position from `payrollBreakdown`, no names). _Approve_
  (اعتماد, posting) stays greyed out until the owner, or a member with _Can
  approve_ who didn't send it, clicks _Give approval_ (موافقة) on the pay run
  or in Approvals (also in the People sidebar). Then whoever posts it marks the
  request done (`applied`). The owner may approve their own request, and may
  post any pay run at once (a request waiting for it as it is is done with
  it). Rejected, taken back or expired, it is sent again.
- **As it was sent.** Any change to the draft after sending (a line, the pay
  date, _Update from records_) gives the run a later `updatedAt`, so the
  request no longer matches: the pay run says so and asks for it to be sent
  again; the cloud refuses to approve it (records_guard), and so does this
  device first. Reopened after posting, it needs a new approval.
- **Emails, totals only (D14).** The approvers get the totals by department
  and position, the change since last month and a link that opens the pay run
  in the signed-in app; groups of one person are merged and a pay run of one
  person shows no amounts. Nobody's own pay, Civil ID, IBAN or name is
  emailed: each employee's pay is in the app (the pay run, and _Show each
  employee's pay_ on the request). See `docs/email-alerts.md`.
- **The register.** _Register by department_ (الكشف حسب القسم) on the pay run
  prints the bilingual register by department and position (كشف الرواتب حسب
  القسم والوظيفة), with lines to sign for who prepared it and the Super
  Admin's approval. It works with or without salary approval.
- **Older versions** don't know the switch and can still post a pay run
  without approval; the server doesn't refuse the posting (its journal
  entries are separate records an older version would still send). Update
  every device before turning it on; Updates report every pay run posted.

## Expiry alerts with lead times and re-upload reminders

- **Off until switched on.** Compliance → _Settings_ → _Expiry reminders_
  (تذكيرات الانتهاء), for owners, admins and accountants (People's settings,
  which staff and viewers never get). Each part has its own switch, and
  while it is off the register, the home page and the morning email work
  exactly as before (the alert keys stay the same, so nothing is emailed
  again):
  - _Reminders by document type_ (التذكير حسب نوع المستند,
    `PeopleSettings.reminderDaysByType`): turned on, it offers the owner's
    lead times, residency (الإقامة) 90, 60, 30 and 7 days before, passport
    180, 90 and 30, vehicle registration and insurance 30, 14 and 7. Types
    can be added or removed; the others use _Remind me_, and a document's
    own days still come first (`reminderDaysFor` in `src/lib/compliance.ts`).
  - _Remind again after expiry_ (`expiredRepeatDays`, 7 days at first): an
    expired paper is new again every 7 days (`…:expired`, then
    `…:expired+7`, `…:expired+14`…) until it is renewed, instead of only in
    Sunday's summary.
  - _Ask for the new copy after a renewal_ (`newCopyGraceDays`, 14 days at
    first; `newCopySince` is the day it was turned on): a paper renewed with
    _Renew_ from then on is _New copy missing_ (لم تُرفع النسخة الجديدة) once
    the days have passed with no file marked as its copy valid until the new
    expiry. The register has a badge and a filter for it, the home page and
    the morning email list it (`…:noscan`, repeated like expired papers), and
    it stops as soon as the copy is there. Renewals recorded before, and
    expiry dates changed by hand on the employee's form, are not asked for.
  - _Show the reminders in Updates_ (`expiryUpdates`, cloud companies whose
    server has `20261130000000_people_alerts.sql`): the morning run writes
    each new reminder to the change feed, for the bell (المستجدات) of the
    owner and the approvers. They are never emailed as changes. Employees'
    papers there say "An employee's residency…" without a name, and open the
    employee. An older version of the app shows them as an unnamed change:
    update the owner's and approvers' devices before turning it on.
- **The new copy.** _Renew_ takes an optional _New copy_: kept with the
  document (an employee's own papers in their personnel file), marked as the
  paper's copy (`Attachment.docKey`, `validUntil`), and the renewal points at
  it (`DocumentRenewal.newCopyId`). In the personnel file, the tag button
  (_This file is the…_, هذا الملف هو…) marks any scan as the copy of one of
  the employee's papers; _Add documents_ can mark a whole batch as each
  employee's residency, passport… Making a document confidential carries the
  marks and the link along.
- **Who gets the email (Settings → Email alerts).** Once the server has
  `20261130000000_people_alerts.sql` (`document_alerts`), accountants can turn
  the morning email on too, and each person chooses the kinds of paper under
  _Papers and licences_: the company's, vehicles', employees' or customers'
  (`email_alerts.document_kinds`; all of them until chosen). The function
  leaves out, per person, employees' papers for whoever the owner gave no
  access to People, and the rest of the register and the deadlines for whoever
  has no access to Compliance. Papers are listed by kind in the email. An
  older server keeps the page and the email as they were (owners and admins,
  no kinds, nobody's email cut).
- **No WhatsApp or SMS** for now: phone push comes with the Maham App (D10).

## Employee letters

- **Off until switched on.** People → _Letters_ (الخطابات): the owner or an
  admin turns on _Use employee letters_ (استخدام خطابات الموظفين,
  `PeopleSettings.letters`). In a company kept in the cloud the page offers
  it only once the server has `20261130000000_people_alerts.sql`
  (`employee_letters` in `server_features`); until then it says the cloud
  needs the latest database script. Off, nothing else changes: the Letters
  tab of an employee and the templates say they are off.
- **Templates** (قوالب الخطابات, `letterTemplates`, private): the five first
  letters, salary, experience and employment certificates (شهادة راتب، شهادة
  خبرة، شهادة عمل), a warning letter (خطاب إنذار) and a no objection
  certificate (شهادة عدم ممانعة), are there with the app's wording
  (`src/lib/hr/letter-templates.ts`) under the id
  `default:<companyId>:<kind>`, and stored only once changed. Each is
  printed in Arabic unless set to English or both. The editor has both
  languages, field chips (`{employee.name}`, `{salary.total}`,
  `{salary.totalWords}`, `{service.length}`, `{letter.number}`… in
  `src/lib/hr/letters.ts`), a preview with an invented employee, _Restore
  default_, who signs and whether the stamp and signature print. Template
  text is the company's data, never translated. A lawyer should check the
  warning letter and the no objection certificate before use.
- **Private details.** `{employee.civilId}`, `{employee.passportNumber}`,
  `{employee.iban}` and the account number are filled only when the
  template allows them (_This letter may show…_, set by the owner, an admin
  or an approver) and the person issuing it is one of those; otherwise they
  print masked. The default wording asks for none.
- **Drafts, issuing, approval.** A letter (`employeeLetters`, private) is a
  draft until issued: its text keeps the fields and is filled with the
  employee's record as it is when shown. Owners, admins and members with
  _Can approve_ click _Issue letter_; accountants click _Send for approval_
  (an approvals row of kind `letter`, D6), and the approver's _Approve and
  issue_ issues it on their device as it was sent (a draft changed since
  can't be approved). Issuing gives the next `HR-{year}-{counter}` number
  (from 1 again each year; `reserve_number` in the cloud, D12) and freezes
  the filled text, who signs and whether the stamp and signature print. An
  issued letter is voided with a reason, never deleted, and keeps its
  number; a draft deleted uses none. The cloud refuses an issue by anyone
  else, and taking an issued letter back to a draft (records_guard). An
  employee with issued letters can only be marked as left.
- **Automatic drafts.** A template can make a draft when an employee joins,
  leaves or has their total salary changed (`autoOn`), with an id the same on
  every device. Never issued, printed or sent without a person; imports make
  none, and a save makes at most five.
- **Printing.** _Letters to print_ lists issued letters not printed yet;
  _Print all_ or _Print selected_ prints them one an A4 page with the
  letterhead, the number and the date (`people/letters/print?ids=`). The
  stamp and signature print only on issued letters; drafts carry a مسودة ·
  DRAFT watermark and void letters say so (D15). Letters are never emailed
  (D14). The signed copy goes in the employee's personnel file
  (`Attachment.docKey = letter:<id>`).
- **Where.** People → Letters, the _Letters_ tab of each employee, _New
  employee letter_ in the New menu, _Experience certificate_ in a final
  settlement's ⋯ menu, a Letters card on the People overview and letter
  requests on the Approvals page. Staff and viewers never see any of it.

## Manpower costing

"HR with Quotation" (#3, part b) is a manpower costing (تسعير العمالة) in
Maham People that prices posts of guards, cleaners and other staff from what
they cost, and makes a quote with sell prices only. The owner's answer:
priced from staff cost, with 10% overhead and a 15% margin, from a rate card
pre-filled with the current averages per job title.

- **Off until switched on.** People → _Manpower costing_ (`/people/costing`):
  the owner, an admin or an accountant turns on _Use manpower costing_
  (`PeopleSettings.costing`: `{ on, overheadPercent, marginPercent, rates? }`,
  missing is off with 10% and 15%). In a company kept in the cloud the page
  offers it only once the server has `20261207000000_staffing_costings.sql`
  (`staffing_costings` in `server_features`); until then it says the cloud
  needs the latest database script.
- **The rate card** (جدول الأجور): the pay of each job title, per person a
  month (basic, allowances, other costs) and its category (expatriate,
  Kuwaiti, GCC). Until one is saved it is the average of the current
  salaries per job title and category, worked out on the device of someone
  who sees payroll (`averageRates` in `src/lib/hr/costing.ts`; leavers,
  domestic workers, staff not paid monthly and employees with no pay on
  their record yet left out). An average of one person is their salary, and
  the page says so. The allowances that count for the indemnity are averaged
  too (_Allowances for indemnity_, `eosAllowances`, missing when all count).
- **A costing** (`staffingCostings`, Dexie 17, private like payroll): a name,
  a customer, posts (job title, category, headcount, hours a day, days a
  month, pay), overhead, margin, status (draft, quote made, won, lost) and
  internal notes. Each post is worked out per person a month
  (`pricePost`): the wage; overtime past 8 hours a day at 1.25 and rest days
  past the payroll's working days at 1.5; the employer's PIFSS share for
  Kuwaiti and GCC posts only (the payroll's rates and cap); the indemnity a
  month of service earns (15 days' wage a year on the basic salary and the
  allowances that count for it, as `eosWage` in `src/lib/hr/eosi.ts`; none
  for insured staff when the payroll leaves them out of the provision); a
  month's share of the annual leave's pay; other costs. Overhead is added on
  that cost, and the sell price is cost ÷ (1 − margin): the margin is a
  share of the sell price, so 15% is a markup of 17.65%. KWD to 3 decimals,
  each amount rounded once. Art. 66 of Labour Law 6/2010 limits overtime to
  2 hours a day, 3 days a week and 180 hours a year unless an exemption
  applies: a post past any of these is flagged (the owner confirms with
  counsel), and so are rest days worked, pay below the minimum wage and
  missing PIFSS or GCC rates. The overhead and margin are at most 200% and
  90%; the page and the cost sheet show what was used.
- **Make quote** makes a draft quote for the customer through the
  documents' own save (numbered like any quote): one line a post with the
  job title (and its Arabic), hours and days (in the quote's language), the
  headcount and the sell price per person a month. The quote is in the
  company's currency, whatever the customer's documents usually are (the
  page says so), and its prices are before tax, tax added on top, so its
  total before tax is the costing's sell total. It needs Maham Books (or
  Sales) not to be view only for the person. Nothing else: no salary, PIFSS, indemnity, cost,
  overhead or margin in its lines, notes, terms or activity. The quote keeps
  the costing's id (`InvoiceDocument.costingId`) and the costing the quote's
  (`quoteId`); an older build that drops `costingId` leaves the costing's
  link. The quote shows a link to its costing only to those who see
  costings. An invoice made from the quote has no `costingId`.
- **The cost sheet** (كشف التكلفة, `src/pdf/costing.tsx`): A4 landscape, in
  the interface language, with each post's cost, overhead, sell price and
  the margin. Downloaded from the costing only; never attached to the quote
  or emailed.
- **Where.** People → Manpower costing (nav, once the company can use it:
  in the cloud, once the server has the file), _New manpower costing_ in the
  New menus and the palette once it is on, and the link on the quote. Staff
  and viewers never see any of it: the People gate keeps the pages from
  them, the cloud never sends them costings or their activity, and refuses
  theirs. Costing activity is also marked `confidential`, which every build
  since Phase 0 keeps from staff and viewers; a device whose member became
  staff on an older build drops what it kept once this build catches up.

## Contracts, customers and vehicles

- **Off until switched on.** Compliance → Settings has _Contracts, customers
  and vehicles_ (العقود والعملاء والمركبات), kept on the company
  (`Company.registerExtras`). Until it is on the documents register is as
  before: no new types, fields, columns, filters, Vehicles page or search
  results.
- **What it adds to a document.** Three types (company contract, customer
  contract, customer cost sheet: عقد الشركة، عقد العميل، كشف تكاليف العميل),
  which need a title; a _Purpose_ (الغرض) from the company's list
  (`Company.documentPurposes`, English and Arabic names, archived but never
  removed, added from the document's form or in the settings); a _Customer_
  (العميل) for papers under Other, which a customer's contract or cost sheet
  must have; and a vehicle from the company's list. The paper keeps the
  customer's name or the vehicle's plate in `ownerName`, so older versions
  still show who it belongs to, and the owner stays `other` or `vehicle`.
- **The register** gets a purpose column, a paperclip with the number of
  files, a _No file_ tab and a customer filter. A link to one document
  (`/compliance/documents?doc=<id>`, from search or the customer's page)
  opens it. The command palette finds the register's papers by title,
  number, type, owner, issuer and purpose; an employee's opens on their page.
- **Customers' pages** in Books have a _Contracts and papers_ card with the
  customer's documents, added and edited there by those who work in
  Compliance.
- **Vehicles** (المركبات, `/compliance/vehicles`, the `vehicles` table of
  version 16): plate (once per company), make, model, year, chassis number,
  the fixed asset it is and, for those who see employees, its usual driver,
  who then needs a valid driving licence. Each vehicle lists its papers with
  _Add paper_ and _Renew_; renaming the plate renames its papers. _Link
  vehicles_ groups the papers that only name a plate (spaces, separators,
  case and Arabic digits aside), shows what it will do and, once confirmed,
  links them, adding a vehicle for each new plate. A vehicle with papers is
  archived, not deleted. In a company kept in the cloud, vehicles are added
  and changed only once its server has the version 16 script
  (`20261102000000_tables_v16.sql`); until then the page says so.
- **Confidential** (سري), offered to owners, admins and accountants only, and
  ticked for a new cost sheet: the document, its files, renewals and
  activity are then people data, which staff and viewers never receive, and
  its renewal fees are recorded without its name, number or note (fees
  recorded before it was marked lose them too, wherever it is kept). A
  document never in the cloud is simply marked. One that staff may already
  hold is saved again under new ids with its renewals, files and activity
  (`makeDocumentConfidential`), and the old ones are deleted, so the
  deletion is what reaches their devices. Its files must be on the device
  first (the form fetches them); files taken off its form go only once it is
  saved. It can't be undone, and in the cloud it waits for the version 16
  script too, as does a new customer cost sheet (the type isn't offered
  until then). A company kept on this device and then uploaded, or a backup
  merged, to a server without that script sends no confidential document,
  renewal of one or vehicle: they wait in Settings → Cloud ("The cloud needs
  the latest database script first") and go by themselves once it is run.
  The home page's alerts for staff leave confidential documents out.
- Staff and viewers still only look at the register; files stay PDFs and
  images up to 10 MB. The demo company has the extras on, with its pickup as
  a vehicle, a contract with the Ministry and a confidential cost sheet.

## Files and papers

- **Off until switched on.** Compliance → Settings has _Find files and
  papers_ (البحث في الملفات والوثائق), kept on the company
  (`Company.fileFinder`); the Files page offers the same switch to owners,
  admins and accountants. Until it is on, nothing in the sidebar or search
  changes.
- **Files** (الملفات, `/files`, in Compliance's sidebar) lists every file
  kept with the company's records: scanned bills and other documents,
  receipts of expenses, payments, fixed assets, register papers and their
  renewals, personnel files, clearance certificates and (later) employee
  letters, each with what it is kept with and a link to its page; newest
  record first. Employees' photos are shown as photos, not here. It is
  built from the attachments' indexes (`[ownerId+name]`,
  `[companyId+contentMissing]`), never from their content
  (`src/features/files/file-index.ts`): the records files are kept with are
  read by id. Search folds Arabic like the command palette (أحمد, احمد),
  reads Arabic digits and finds numbers without their separators; a filter
  picks what files are kept with. A file opens in a new tab; one kept only
  in the cloud says _In the cloud_ and is downloaded when opened. It works
  offline.
- **Search** (Ctrl K) also finds, once it is on: files, under _Files_, which
  open in a new tab; the register's papers under _Papers_ (الوثائق), with the
  papers on current employees' own records (Civil ID, passport, residency,
  work permit, review card, contract end), which open on the employee's
  page; expenses (`/expenses?open=<id>`), fixed assets and security cheques
  (the register searched for the cheque, `/cheques?tab=security&q=<number>`).
- **Privacy.** Staff and viewers never see employees' files or papers, nor a
  confidential paper's: the page leaves out every file `isPrivateRecord`
  calls private and every file whose record isn't on the device, and says
  so; search builds no file entries of people data for them, and an
  employee's paper or file leads to the employee's page, which search and
  its recent items hide from them. A confidential paper's files are found on
  the Files page only, as the paper is in the register.
- **The register's search** folds Arabic the same way and finds owners by
  their name in either language.
- `?doc=<id>` (the register, from #17) and `?open=<id>` (expenses, as
  before) are the links search and the Files page use. The AI assistant
  (part B) is a later phase.

## Code layout

```
src/
  suite/                    Maham One itself
    types.ts                what a manifest holds, the app ids and layouts
    apps.ts                 the apps of each layout, which app a page belongs to, access per role, New menus
    current-app.ts          the company's apps (useApps), the app open now (the last one on the suite's own pages)
    app-gate.tsx            lock card and view-only mode around an app's pages
    switcher.tsx            the app switcher, app marks, the phone's app tiles
    home/                   the suite's home and what needs attention
    access-grid.tsx         the role-by-app grid in Settings → Team
    boundaries.test.ts      who may import whom
  apps/
    books/                  manifest (and its finance variant), routes, pages/, features/ (editors, dialogs, reports…)
    sales/ inventory/       manifests only: the split layout's apps over Books' pages
    people/                 manifest, routes, pages/ (overview, directory, employees, payroll), lib/
    crm/                    manifest, routes, pages/ (pipeline, prospects), lib/pipeline.ts
    compliance/             manifest, routes, pages/
  app/                      the shell: layout, routes.tsx (all routes), router, company context
  features/                 what several apps use: shell, search, cloud, clients, people, payroll, renewals…
  pages/                    the suite's own pages: settings, account, setup, not found
  db/ lib/ cloud/ alerts/ i18n/ pdf/ components/   shared, as before
```

Rules, checked by `src/suite/boundaries.test.ts`:

- An app doesn't import another app: it links to the other app's pages.
- Shared code doesn't import an app. Six places still do (listed in the test,
  mostly Books' account and tax pickers used by shared dialogs); the list may
  only get shorter.
- The suite reads an app only through its manifest, its routes and its
  `lib/`.

### Adding an app

1. `src/apps/<app>/manifest.ts`: name in English and Arabic, icon, colour, home,
   the first path segments it owns, sidebar, footer, New groups, the tools the
   home shows, three phone tabs, access per role. Add the id to `AppId` in `src/suite/types.ts` and the
   manifest to `APPS` in `src/suite/apps.ts` (and to `SPLIT_APPS`, the split
   layout). A new colour needs its palette in `STATUS_PALETTES`
   (`src/lib/themes.ts`) so every theme has it.
2. `src/apps/<app>/routes.tsx`, wrapping its pages in `<AppGate app="<app>">`,
   and add them to `src/app/routes.tsx`.
3. Arabic for its texts in `src/i18n/ar/`. `npm test` checks every link of the
   manifest opens a real page.

## Next steps

These need a database migration (new tables or rules), so they wait for a
release of their own:

1. **CRM leads and deals.** Tables for leads, deals with a stage and an owner,
   and activities (calls, meetings, follow-up dates), added to
   `records_tbl_check` and to what staff may change; then a board where deals
   are moved between stages.
2. **A directory for everyone.** Staff can't see employees at all today. A
   server-side projection with only the directory's fields (name, job,
   department, work phone and email, photo) would let every member find a
   colleague without exposing salaries or papers.
3. **An HR role.** Someone who manages People without seeing the books, and a
   per-app choice of access when inviting.
4. Move the remaining shared code that only Books uses (account pickers, tax
   select, report language) into a layer the boundaries test allows, and
   group Settings by app.
5. More apps on the same data: tasks and approvals (leave and expense
   requests), assets and vehicles, a document library.
