# Maham One: release notes for Phases 0–2

Every new feature in this release is **off until you switch it on**, except the few listed under "What changed for everyone". Unless it says otherwise, only an **owner, admin or accountant** can change a setting. Staff and viewers can look but not change.

"Script" means the database script `supabase/migrations/20261102000000_tables_v16.sql`. Only cloud companies need it. Companies kept on one device never do.

---

## Maham Books

**#21 Scans on payments.** You can attach a photo or PDF of the cheque or transfer receipt to a payment.

- On now, no switch. Go to Sales → Payments received (المبيعات ← المقبوضات), or Purchases → Payments made (المشتريات ← المدفوعات), open a payment and use **Attachments (المرفقات)**. It is also on the payment form and in **Record payment (تسجيل دفعة)**. Phones have **Take photo (التقاط صورة)**.
- Who: everyone except viewers, so staff too. Viewers can open the scans. Script: no.

**#25 Bank statements from Excel.** The import now reads Excel (.xlsx), Excel-saved ".xls" and CSV. It finds the table under the bank's header rows, reads value dates and checks the amounts against the balances.

- On now, no switch. Go to Banking → **Import statement** (البنوك ← استيراد كشف حساب). In the same dialog you can tick **Remember this layout for this account (تذكّر هذا التنسيق لهذا الحساب)**. Old binary .xls files and PDFs are not read: save them as .xlsx or CSV.
- Who: owner, admin, accountant (as before). Script: no.

**#22 Signature in blue ink; drafts print as drafts.** You can draw the signature on screen and print it in blue.

- Go to Settings → Company profile → Branding (الإعدادات ← ملف الشركة ← الهوية). Under **Authorised signature (التوقيع المعتمد)**, use **Draw signature (ارسم التوقيع)** or upload one. Set **Ink → Blue ink (لون الحبر ← حبر أزرق)** and save.
- The draft watermark is on for everyone, with no switch.
- Templates now has **The QR code opens (رمز QR يفتح)**, but only "The payment link" can be chosen for now. The QR on/off switch is still Settings → Payment details → **Print a QR code**.
- Who: owner, admin, accountant. Script: no.

**#24 Receipt and payment vouchers as PDFs (سند قبض / سند صرف).** Vouchers can be downloaded or shared as PDFs, and expenses now get a voucher too.

- On now: open a payment → **Print voucher (طباعة السند)** → **Download PDF**. On an expense, Print voucher works once the expense is saved.
- The stamp, blue signature and address on vouchers need a switch: Settings → Invoice defaults → **Receipt and payment vouchers → Print the stamp, signature and address** (الإعدادات ← إعدادات الفواتير ← سندات القبض والصرف ← طباعة الختم والتوقيع والعنوان). The signature lines and the A5 paper option are in the same place.
- Who: the switch is owner, admin, accountant. Anyone who can open a payment can print its voucher. Script: no.

**#27 Quote design.** Quotes and credit notes can have their own template, colour, logo size and position, SKU column and customer acceptance box.

- Go to Templates (القوالب, at the bottom of the Books sidebar) → the **Quotes (عروض الأسعار)** or **Credit notes** tab. Turn off **Same as invoices (مثل الفواتير)**, then set the design. The Quotes list also has a **Quote design** button.
- The opening text for new quotes is in Settings → Invoice defaults → **Quote introduction (مقدمة عرض السعر)**.
- Who: owner, admin, accountant. Staff and viewers only look. Script: no.

**#28 Units, item codes (SKU), QR codes and labels.**

- Go to Settings → **Items and units** (الإعدادات ← الأصناف والوحدات). It has two switches: **Units from a list (الوحدات من قائمة)** and **Give new items a code (إعطاء الأصناف الجديدة رمزًا)**. Then use **Give codes to items without one** for the items you already have. The code pattern is in Settings → Numbering → **Item codes (SKU) (رموز الأصناف)**.
- Labels and printed lists need no switch. Go to Products & services → **Print** → Print labels, Product list or Price list. You can also tick items and choose Print labels.
- Who: owner, admin, accountant. Script: no.

**#29 Item pictures.** Up to five pictures per item.

- Go to Settings → Items and units → **Give items pictures (إضافة صور إلى الأصناف)**. Then add pictures to each item in Products & services.
- To print them on documents, go to Templates → each tab → **Item pictures (صور الأصناف)**.
- Who: the switch is owner, admin, accountant. Staff can add pictures. Script: no.

**#30 Stock items from Excel or CSV with opening stock.** The import now takes type, cost, barcode, reorder level, quantity and warehouse.

- On now, no switch. Go to Products & services → **Import (استيراد)**, or Settings → Import data → Products and services.
- Stock is posted only when the file has a quantity column and you confirm **Post the stock in this file? (ترحيل المخزون الوارد في هذا الملف؟)**. **Update existing items** is off by default.
- Stock count sheets can also be imported from Excel: Stock count → **Import counts**.
- Who: anyone who imports items today. Only owners, admins and accountants can bring in quantities. Script: no.

**#23 Cheque printing on Burgan Bank and KFH leaves.**

- Go to Settings → Payment details → Cheque printing → **Print cheques issued** (الإعدادات ← بيانات الدفع ← طباعة الشيكات ← طباعة الشيكات الصادرة).
- Layouts are under Cheques → Cheques issued tab → **Cheque layouts (نماذج الشيكات)** → **Test print (طباعة تجريبية)**.
- To print, open a payment made by cheque on Burgan Bank or KFH and choose **Print cheque (طباعة الشيك)**. The same option is in the row menu of the cheque register.
- Who: the switch and the layouts are owner, admin, accountant. Staff can print.
- Script: needed only to save your own measured layout, including the "Checked against a real leaf" tick. The built-in layouts print without it.

**#20 Overview dashboard.** Receivables next to payables, cash flow, income and expense, top expenses, bank and card accounts, and a watchlist.

- Go to Books → Dashboard → **Classic / Overview (كلاسيكي / نظرة عامة)** at the top right. Or go to Settings → Accounting → **Books dashboard → Overview layout** (الإعدادات ← المحاسبة ← لوحة تحكم مهام بوكس ← تخطيط النظرة العامة).
- Who: **owner or admin only**. Accountants see the switch greyed out. Each person picks their own period and hidden cards on their own device. Staff and viewers never see income, expenses or the watchlist. Script: no.

## Company, People and Compliance

**#2 Company type.** An optional line of business. Taxes and deadlines don't change with it, and it is not printed.

- Go to Settings → Company profile → Business → **Company type (نوع الشركة)**. You can also set it when adding a company.
- Who: owner, admin, accountant. Script: no.

**#1 Employee search across all companies.** Find employees of every company on this device from one place. No pay, IBAN or Civil ID is shown.

- Go to Settings → Companies → **Employee search across companies** (الإعدادات ← الشركات ← البحث عن الموظفين في كل الشركات) and switch on each company.
- This section only appears when you see employees in two or more companies. Once two are on, use Employees → **Search all companies (البحث في كل الشركات)**, or Ctrl K → "Employees in other companies".
- Cloud companies are included only while you are signed in with the account they are kept with.
- Who: owner, admin, accountant of each company. Script: no.

**#5 Deema, Taly and Tahseel links.** They show under **Integrations (التكاملات)** in the Maham Books and Maham CRM sidebars and on the home page. They are plain links; no key or payment goes through them.

- Go to Settings → Links (الإعدادات ← الروابط) → **Add Deema / Add Taly / Add Tahseel**. Paste your portal address and save.
- Every link now also has **Show under** and **Show in** (choose the apps).
- Who: owner, admin, accountant. Script: no.

**#12 Departments in English and Arabic; Stateless (Bedoon).**

- No switch. Go to Maham People → Employees → **Departments (الأقسام)**. For a Bedoon employee, open the employee form → Category → **Stateless (Bedoon) (غير محدد الجنسية (بدون))**.
- Who: owner, admin, accountant. Script: no.

**#13 Driving licences for drivers.** Drivers without a valid licence are flagged.

- Go to Maham Compliance → Calendar → **Settings** → **Check drivers’ licences (التحقق من رخص قيادة السائقين)** → Save. The same dialog opens from Settings → Compliance and files → **Compliance settings**, and from the gear on Employees.
- Who: owner, admin, accountant. Script: no.

**#14 Company leave policy.** Until you set one, leave works as before: the law's 30 working days.

- Go to Maham People → **Payroll settings (إعدادات الرواتب)** → Annual leave → **Set the company’s leave policy (تحديد سياسة الإجازات للشركة)** → Save.
- In a cloud company, update every device first, because older versions ignore the policy.
- Who: owner, admin, accountant. Script: no.

**#17 Contracts, customers' papers, vehicles and confidential documents.**

- In the same Compliance settings dialog, switch on **Contracts, customers and vehicles (العقود والعملاء والمركبات)** and save.
- This adds new document types, a Purpose and a Customer on documents, **Vehicles (المركبات)** in the Compliance sidebar, and a "Contracts and papers" card on customer pages.
- Who: owner, admin, accountant. Only these three roles can mark a document **Confidential (سري)**.
- Script: **yes** for vehicles, confidential documents and customer cost sheets. Contracts and purposes work without it.

**#4 part A: Document finder.** A Files page that lists every file the company keeps. Ctrl K also finds files, papers, expenses, fixed assets and security cheques.

- In the same Compliance settings dialog, switch on **Find files and papers (البحث في الملفات والوثائق)**. The Files page offers the same switch. Once on, **Files (الملفات)** appears in the Compliance sidebar.
- Who: owner, admin, accountant. Staff and viewers never see employees' files. Script: no.

---

## What changed for everyone, with no switch

- **Drafts no longer print the signature or stamp.** Every template prints a DRAFT / مسودة watermark instead. Delivery notes still print signed. To send a signed copy, mark the document as sent.
- A logo, stamp or signature that would make the company's data too large (over 2.5 MB) is refused.
- Payments can carry scans and show a paperclip in the lists. **Deleting a payment also deletes its files**, and the confirmation says so.
- Voucher pages can download and share PDFs. Expenses have vouchers and an optional "Paid to" name.
- The bank statement import reads Excel.
- The document editor has a colour for each document. Quotes have an Introduction box. Lines picked from an item keep its SKU.
- Templates has Invoices, Quotes and Credit notes tabs. Documents print exactly as before until something is changed there.
- Items show their QR code and a Print label button. Products & services has a Print menu. The line picker and Ctrl K find items by barcode, so a scanner works.
- The items import takes Excel and the new columns. Products & services has an Import button.
- Settings has two new pages, **Items and units** and **Compliance and files**. Numbering has a new **Item codes (SKU)** row.
- Company profile has an optional Company type, and "Describe the legal form" when the legal form is Other.
- Each link has "Show under" and "Show in". The app warns when a link address contains a password or key.
- People has a Departments button and a Stateless category. Pay runs keep and show each person's department. Imports read Bedoon, بدون and غير محدد الجنسية as stateless.
- The Compliance register search treats أحمد and احمد as the same and reads Arabic digits.
- A backup made by a newer version is refused instead of being half restored.

## One-time steps for the owner

1. **Run the database script** (cloud companies only).
   - Open Supabase → **SQL Editor** → **New query**.
   - Paste the whole of `supabase/migrations/20261102000000_tables_v16.sql` and click **Run**. If Supabase warns about "destructive operations", choose **Run this query**. It should end with "Success. No rows returned".
   - Run it once, after the three earlier scripts. **Never run the first script (`20261004000000_almailbooks_cloud.sql`) again.**
   - The app notices the script by itself the next time it syncs. Until then, only vehicles, confidential documents, customer cost sheets and your own saved cheque layouts stay hidden.
2. **Update every device before switching features on.** When "A new version of Maham One is available" (يتوفر إصدار جديد من مهام ون) appears, save your work and click **Reload (إعادة التحميل)**. This matters most before setting the leave policy, and before using cheque printing or payment scans.
3. **Measure the cheque layouts.** The built-in Burgan Bank and KFH layouts have not been measured against real leaves. Do a **Test print** on plain paper for each bank, hold it against a real leaf, adjust, and tick **Checked against a real leaf** before printing real cheques.
4. **Add the integration links.** Paste the Deema, Taly and Tahseel portal addresses in Settings → Links.
5. **Check the sign-in addresses, if not done yet.** In Supabase → Authentication → URL Configuration:
   - Set **Site URL** to `https://mahamone.com`.
   - Add `https://mahamone.com/**` and `https://www.mahamone.com/**` to the redirect URLs.
6. **Confirm the defaults we used.**
   - Bedoon staff: no PIFSS, an optional work permit, and the Central Agency review card in place of a residency.
   - Annual leave is counted in working days. You can change this in the leave policy.
   - Tahseel is only a link for now. It will be connected as a payment option once you confirm which service it is.
