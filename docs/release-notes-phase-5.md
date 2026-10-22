# Maham One: release notes for Phase 5

This release is requirement #3, in two parts. A company can split Maham Books into three apps: Maham Sales, Maham Books (finance) and Maham Inventory. And Maham People can price posts of guards, cleaners and other staff from what they cost, then make a quote for the customer with sell prices only.

Every new feature is **off until you switch it on**. Until then, everyone works exactly as before. Each part below says who can change its switch. The others can look but not change.

"The Super Admin" is the owner of a company. The app names nobody: whoever owns the company is its Super Admin.

"The script" means the database script `supabase/migrations/20261207000000_staffing_costings.sql`. It comes after the Phase 4 script, `20261130000000_people_alerts.sql`. Only cloud companies need it, and only for the manpower costing. The app layout doesn't need it. Until it runs, the app keeps the manpower costing hidden in cloud companies.

**Nothing moves.** Every page keeps its address. Bookmarks, links in emails and payment links work as before. No invoice, bill, item or other record changes, and nobody's access changes.

**Private.** Staff and viewers never see manpower costings, the rate card, the cost sheet, salaries, costs or margins. The cloud never sends them any of it, as with payroll. The quote made from a costing carries the sell prices only: no salary, PIFSS, indemnity, cost, overhead or margin in its lines, notes, terms or history. Staff and viewers see that quote like any other quote.

---

## What changed for everyone, with no switch

Nothing works differently until a switch is on. A few small things look different:

- Settings → Team (الإعدادات ← الفريق) has a new section, **App layout (تخطيط التطبيقات)**, above **What each role can open (ما يفتحه كل دور)**. Its switch is off. Everyone can see it. Only the owner or an admin can change it. In a company kept on one device it is on the same page, below **Keep in the cloud (الحفظ في السحابة)**.
- Maham People's sidebar has a new entry, **Manpower costing (تسعير العمالة)**. In a company kept on one device it is there now. In a cloud company it appears once the script has run. Until the costing is switched on, the page has only its switch.
- Settings → Team → **Permissions (الصلاحيات)** and Settings → **Links (الروابط)** look the same until the app layout is switched on.

---

## #3 (part a) Maham Sales, Maham Books and Maham Inventory

Maham Books can become three apps. Maham Sales has the selling. Maham Books keeps the finance. Maham Inventory has the items and stock.

- Go to Settings → Team → **App layout** (الإعدادات ← الفريق ← تخطيط التطبيقات). Turn on **Maham Sales and Maham Inventory as their own apps (مهام سيلز ومهام إنفنتوري تطبيقان مستقلان)**. The app asks first. Click **Switch on (تفعيل)**. It is saved at once, for everyone in the company. Each device follows once it syncs.
- **Maham Sales (مهام سيلز)** has customers, quotes, proforma invoices, sales orders, invoices, delivery notes, payments received, credit notes and recurring invoices. It opens at Invoices.
- **Maham Books (مهام بوكس)** keeps its name. It is the finance app: the dashboard, purchases, payments made, cheques, banking, accounting, VAT returns and reports. It still lists customers, invoices, payments received and credit notes under **Receivables (الذمم المدينة)**, and items and stock under **Inventory (المخزون)**. It opens at its dashboard.
- **Maham Inventory (مهام إنفنتوري)** has items, stock and warehouses, stock counts and landed costs. It also lists purchase orders, bills, vendors and delivery notes, the documents that move stock. Purchases stay with Maham Books. It opens at Stock and warehouses.
- Maham People, Maham CRM and Maham Compliance stay as they are.
- Only what is around the pages changes: the sidebars, the app switcher (six apps), the phone's tabs, the **New (جديد)** menu, the home page and search. The home shows overdue invoices under Sales, bills and cheques under Books, and the number of items under Inventory. Search says which app each page is in.
- A page that two apps list keeps the sidebar of the app it was opened from. Invoices opened from Books keep Books' sidebar. Opened from Sales, they keep Sales'.
- With approval rules on, **Approvals (الاعتمادات)** is in Maham Sales' sidebar as well as Maham Books'.
- **Who opens them.** Whoever opens Maham Books opens Maham Sales and Maham Inventory, with the same access. There are no Sales-only or HR-only roles in this release.
- **The owner's limits stay as they are** (Settings → Team → **Permissions**). The limit on Maham Books is also the limit on Maham Sales and Maham Inventory. In this layout that row is called "Maham Sales · Maham Books · Maham Inventory". A member with Maham Books view only has all three view only. Nothing saved is changed.
- **Sidebar links stay as they are** (Settings → **Links**, الإعدادات ← الروابط). A link shown in Maham Books also shows in Maham Sales and Maham Inventory. Deema, Taly and Tahseel, shown in Maham Books and Maham CRM, show in all four. Nothing saved is changed.
- To go back, turn the same switch off. It is saved at once. Everyone sees the four apps again, as before. Someone who was last in Sales or Inventory finds Maham Books' sidebar.
- Who: the owner or an admin. In a company kept on one device, whoever uses it. Everyone else sees the switch but can't change it. Script: **no**. It works in companies kept on one device too.

## #3 (part b) Manpower costing and its quote

Maham People prices posts of guards, cleaners and other staff from what they cost the company. It then makes a quote for the customer with the sell prices only.

- Go to Maham People → **Manpower costing** (مهام بيبول ← تسعير العمالة). Turn on **Use manpower costing (استخدام تسعير العمالة)**. It is saved at once. In a cloud company the page appears only once the script has run. Once it is on, the switch is at the bottom of the same page.
- **Overhead and margin (المصاريف غير المباشرة وهامش الربح)** are 10% and 15% at first, as you chose. Change them and click **Save changes (حفظ التغييرات)**. New costings use them, and each costing can change its own. The overhead is at most 200% and the margin at most 90%.
- **Margin, not markup.** The margin is a share of the sell price. A markup is added to the cost. A 15% margin is a 17.647% markup: a cost of 100.000 KWD sells at 117.647 KWD. A 15% markup would sell at 115.000 KWD, which is a margin of only 13.043%. The page says this next to the margin.
- **Rate card (جدول الأجور).** The pay of each job title, per person a month: basic salary, allowances, the allowances that count for the indemnity, other costs (for example uniform, residency, medical cover and transport) and the category (Kuwaiti, GCC national or expatriate).
  - Until it is saved, it shows the average current salaries of each job title. This is worked out on the device of the person looking, and only for people who see payroll.
  - Leavers, domestic workers, staff not paid monthly and employees with no pay yet are left out.
  - An average of one person is that person's salary. The page says so.
  - Check it, change it, then click **Save rate card (حفظ جدول الأجور)**. It is kept with the People settings, private like payroll. **Fill from salaries (تعبئة من الرواتب)** works out the averages again.
- **A costing.** Click **New costing (تسعير جديد)** on the page, or **New (جديد)** → **Manpower costing (تسعير العمالة)**.
  - Give it a name (for the company only, never on the quote) and a customer.
  - Add its posts with **Add from the rate card… (إضافة من جدول الأجور…)** or **Add post (إضافة وظيفة)**. Each post has a job title (and its Arabic), a category, the headcount, the hours a day and the days a month. Its pay comes from the rate card and can be changed.
  - Click **Save (حفظ)**.
- **How a post is priced**, per person a month, in KWD to 3 decimals:
  - the wage: basic salary and allowances;
  - hours past 8 a day are overtime, at 1.25 times the hourly rate;
  - days past the **Working days in a month (أيام العمل في الشهر)** of Payroll settings (26 at first) are rest days worked, at 1.5;
  - the employer's PIFSS share, only for Kuwaiti and GCC posts, with the rates and the cap of Payroll settings;
  - the end-of-service indemnity a month of service earns: 15 days' wage a year, on the basic salary and the allowances that count for it, as payroll works it out. Staff insured with PIFSS get none, unless Payroll settings include them in the end-of-service provision;
  - a month's share of the annual leave pay, to cover the post while the person is away;
  - other costs.
  - Overhead is added on that cost. The sell price is the cost with overhead divided by (1 − margin).
- **Warnings.** A post is flagged when it needs more than 2 overtime hours a day, or overtime on more than 3 days a week or for more than 180 hours a year. Article 66 of Labour Law 6/2010 sets these limits unless an exemption applies. A 12-hour post is priced as 8 normal hours plus 4 overtime hours, and flagged. Confirm with counsel before quoting such a post, or add people to it (step 4). Posts are also flagged for rest days worked (article 67 also gives a day off in lieu for each), a basic salary below the minimum wage of Payroll settings, and missing PIFSS or GCC rates.
- **Totals a month (الإجماليات في الشهر)** shows the cost, the overhead, the sell price, the margin, the margin of the sell price and the markup on cost.
- **Make quote (إعداد عرض سعر)** makes a draft quote for the costing's customer, numbered like any other quote.
  - It has one line a post: the job title (with its Arabic), the hours a day and the days a month, the headcount, and the sell price per person a month. Nothing else from the costing goes on the quote.
  - The quote is in the company's currency, with prices before tax. Tax, if the company charges it, is added on top. If the customer's documents are usually in another currency, the costing says so.
  - Check the quote, then send it as usual.
  - The costing is marked **Quote made (أُعدّ عرض السعر)**. The costing and the quote link to each other. The quote shows its link to the costing only to those who see costings.
  - Making another quote from the same costing asks first. The new quote is at today's prices. The first quote stays as it is.
  - The button needs Maham Books (and Maham Sales, in the split layout) not to be view only for the person. Otherwise it is hidden, and the costing says why.
- **Cost sheet (كشف التكلفة)** downloads the internal sheet of a costing as a PDF: each post's cost, overhead and sell price, and the margin. It says "Internal: never sent to the customer" (داخلي: لا يُرسل إلى العميل أبداً). It is never attached to the quote or emailed.
- Mark a costing **Won (رابحة)** or **Lost (خاسرة)** in its **Status (الحالة)**, then **Save**. **Delete costing (حذف التسعير)** leaves its quote as it is.
- Who: the owner, admins and accountants turn it on and make costings. A member the owner made Maham People view only for can look but not change. Staff and viewers never see it. Script: **yes**, in cloud companies. A company kept on one device doesn't need it.

---

## Good to know

- **Older versions of the app.**
  - An older version ignores the app layout and shows the four apps, as before.
  - An older version doesn't show manpower costings. A quote made from one is an ordinary quote there. If an older version changes and saves that quote, the quote may lose its link back to the costing. The costing still links to the quote.
  - A device updated later fetches the costings once, as it syncs.
- **Updates and the bell.** In **Updates (المستجدات)**, a changed costing is a change to payroll and people data. It says only what happened, never a name or an amount.
- **An estimate, not legal advice.** The prices follow Labour Law 6/2010 and the company's Payroll settings. The cost sheet says so. Check Maham People → **Payroll settings** (مهام بيبول ← إعدادات الرواتب) first: the PIFSS rates and cap, the GCC rates, the **Minimum wage (الحد الأدنى للأجور)** and the working days in a month.
- **Long service costs more.** The indemnity is priced at the rate of the first five years of service. Staff who stay longer earn more, so a long contract with the same people costs more than the costing shows.

## One-time steps for the owner

1. **Update every device, and let each one sync, before switching anything on.**
   - When "A new version of Maham One is available" (يتوفر إصدار جديد من مهام ون) appears, save your work and click **Reload (إعادة التحميل)**.
   - Then open Settings → Cloud and sync (الإعدادات ← السحابة والمزامنة) and click **Sync now (المزامنة الآن)**.
   - Ask everyone in the team to do the same on each of their devices, phones included. This matters most on devices that use Maham Books, and on those of the people who will make costings.
2. **Run the database script** (cloud companies only, and only for the manpower costing). This can be done days after the new version is out: until the script runs, the app works as before.
   - The Phase 4 script must have run first (step 2 of the [Phase 4 release notes](release-notes-phase-4.md)).
   - Open Supabase → **SQL Editor** → **New query**.
   - Open [the script on GitHub](https://github.com/almailgroup/MahamOne/blob/main/supabase/migrations/20261207000000_staffing_costings.sql) and click **Copy raw file** (the copy icon above the file). Paste the whole of it and click **Run**. Its last line is `notify pgrst, 'reload schema';`. If Supabase warns about "destructive operations", choose **Run this query**. It should end with "Success. No rows returned".
   - If the Phase 4 script (`20261130000000_people_alerts.sql`) hasn't run, it stops with "Run 20261130000000_people_alerts.sql first, then this file." and changes nothing. Run that one first, then this one.
   - It is safe to run again. If the Phase 4 script, either Phase 3 script or `20261102000000_tables_v16.sql` is ever run again, run this one again after them. **Never run the first script (`20261004000000_almailbooks_cloud.sql`) again.** Once there are costings, the first script and `20261102000000_tables_v16.sql` stop with an error about `records_tbl_check` and change nothing.
   - If pg_cron is on in Supabase, this script also schedules the daily clean-up of deletion markers, as the earlier scripts did.
   - Running it changes nothing by itself. The app notices it by itself within about ten minutes, as it syncs.
   - To check: Maham People's sidebar shows **Manpower costing**, and its page shows **Use manpower costing**.
3. **Switch on what you want (optional).** Do this after steps 1 and 2. Everything stays off until then.
   - Settings → Team → **App layout** → **Maham Sales and Maham Inventory as their own apps** → **Switch on**. The owner or an admin. Tell the team first: their sidebars change. Afterwards, Settings → Team → Permissions and Settings → Links say "Maham Sales · Maham Books · Maham Inventory" where they said Maham Books.
   - Maham People → **Payroll settings**: check the PIFSS rates and cap, the GCC rates, the minimum wage and the working days in a month. The costing uses them.
   - Maham People → **Manpower costing** → **Use manpower costing**. Then check **Overhead and margin**, and the **Rate card** → **Save rate card**. Quote a flagged post only once counsel has confirmed it (step 4).
4. **Ask counsel and the auditor to confirm**, before quoting from a costing:
   - **Counsel: overtime above two hours a day.** Article 66 of Labour Law 6/2010 limits overtime to 2 hours a day, 3 days a week and 180 hours a year, unless an exemption applies. A 12-hour post needs 4 hours a day. Confirm whether an exemption applies to the company's posts, or price them with more people.
   - **Counsel: the rates.** Overtime at 1.25, rest days worked at 1.5, and the day off in lieu of each rest day worked (article 67).
   - **The auditor: the cost of a post.** The employer's PIFSS share only for Kuwaiti and GCC posts. The indemnity at 15 days' wage a year (the rate of the first five years), and none for staff insured with PIFSS unless Payroll settings include them. A month's share of the annual leave. 10% overhead on the cost. A 15% margin of the sell price, which is a 17.647% markup on the cost.
   - **The auditor: the quote.** Prices in KWD before tax, to 3 decimals, with nothing of the cost on the quote. The cost sheet stays with the company's records and is never sent.
