# AlmailBooks

Free accounting and invoicing for businesses in Kuwait, in Arabic and English.
Built by AL Mail Group.

<p dir="rtl" lang="ar">برنامج مجاني للمحاسبة والفواتير، مصمم للشركات في الكويت، باللغتين العربية والإنجليزية.</p>

AlmailBooks runs entirely in the browser and is hosted free on GitHub Pages:
there is no server, no account and no monthly fee. Your records stay on your
own device.

**Open the app:** https://almailgroup.github.io/AlmailBooks/

![Invoice editor with live PDF preview](docs/images/editor.png)

## Made for Kuwait

- **Arabic and English.** The whole app works in both languages and switches
  with one click; Arabic is right to left. Documents print in Arabic, in
  English, or in both side by side.
- **Kuwaiti dinars with fils.** Amounts have three decimals everywhere
  (KD 1,234.500 · 1,234.500 د.ك), and totals are written out in words in
  Arabic and English. Other currencies are kept with their exchange rates.
- **No VAT by default.** Kuwait has no VAT, so taxes are switched off. They can
  be switched on for a company if they are ever needed.
- **Kuwaiti details:** addresses by governorate, area, block, street, avenue,
  building, floor, unit and PACI number; Civil ID and IBAN checks for Kuwaiti
  banks; +965 phone numbers; Hijri dates on documents; Kuwait's public holidays
  and the Friday–Saturday weekend for leave.
- **A Kuwaiti chart of accounts** (IFRS) in Arabic and English, with accounts
  for post-dated cheques, retentions, PIFSS, end-of-service indemnity, the
  statutory reserve, KFAS, Zakat and NLST.

## Features

### Sales

- Quotes, proforma invoices, sales orders, delivery notes, invoices and credit
  notes, each converted into the next in one click. Recurring invoices.
- **Statements of account** for any customer or vendor and period, with a
  running balance, aging and the cheques not yet cleared: as a bilingual PDF,
  CSV, print or WhatsApp message, or for every customer with a balance at once.
- **Credit control:** a credit limit and credit hold per customer, with an
  exposure that counts uncleared cheques. The editors warn before a sale goes
  over the limit.
- **Retentions:** the 5% tax retention held until a tax clearance certificate
  is shown, and contract retentions. They wait in their own accounts until they
  are released.
- Payment links from MyFatoorah, Tap, UPayments, Hesabe, Ottu or your bank on
  invoices; sharing by WhatsApp or email.

### Payments and cheques

- KNET, WAMD, bank transfer, cash, cheque, card and payment links, with KNET
  and card fees.
- **Post-dated cheque register** for cheques received and issued: deposit,
  clear, return (with the bank's charge) and replace. Returned cheques are
  booked on the day they come back, so closed periods never change. Security
  (guarantee) cheques are kept on record.
- Receipt and payment vouchers in Arabic and English.
- A warning when a cash payment goes over the cash limit for the company's
  activity (for example vehicle, gold and real estate sales).

### Purchases and inventory

- Vendors, purchase orders, bills, vendor credits, payments made, and expenses
  with a photo of the receipt.
- Stock items, warehouses and transfers, weighted average cost, landed costs
  (customs duty, freight, clearing), cost of sales, stock count sheets and a
  low-stock report that leads to purchase orders.

### People and payroll

- Employees, Kuwaiti and expatriate, with their documents (Civil ID, passport,
  residency, work permit, contract, health insurance, driving licence) and
  reminders before they expire.
- A **compliance calendar** for the company's licences and filings: commercial
  licence and registration, PAM file, authorised signatories, MOF tax card and
  clearance certificate, KCCI membership, municipality and fire licences,
  PIFSS contributions, Zakat, KFAS, NLST, income tax and audited statements to
  MOCI.
- **Payroll:** allowances, overtime, deductions and staff loans, PIFSS
  contributions, leave and end-of-service indemnity under the Labour Law, and
  the salary transfer file for the bank (Wage Protection System).

### Accounting and banking

- Double-entry books kept automatically from every document, payment, cheque,
  stock movement and payroll run, plus manual journals and a lock date.
- Fixed assets with monthly depreciation and disposals.
- IFRS statements: profit and loss, balance sheet, cash flow and changes in
  equity; trial balance and general ledger with drill-down to every entry.
- Year-end close with the statutory reserve, KFAS, Zakat and NLST, and an
  auditor pack (a ZIP of the statements, ledgers and listings).
- Bank statements imported from online banking (CSV in any layout, including
  Arabic headings, or OFX), matched to the books and reconciled; transfers
  between your own accounts.
- Reports: receivables and payables aging, statements, customer exposure,
  retentions, sales, purchases, payments, stock and more, with CSV export.

### Everything else

- 10 PDF templates with your logo, brand colour, stamp and signature, and a
  live preview while you type.
- Several companies in one app.
- Import contacts, items, opening balances and open invoices from CSV.
- Works offline and installs like an app on phones and computers.
- 20 themes, 10 light and 10 dark, chosen per device in **Settings →
  Appearance** or from the header, or following the device's light and dark
  setting. Documents always print on white paper.
- Backup and restore to a single file.

![Dashboard](docs/images/dashboard.png)

### Templates

Shown in Arabic and English side by side; each one also prints in Arabic or in
English only.

|                                  Modern                                  |                                  Minimal                                   |                                  Corporate                                   |                                  Elegant                                   |                                Bold                                |
| :----------------------------------------------------------------------: | :------------------------------------------------------------------------: | :--------------------------------------------------------------------------: | :------------------------------------------------------------------------: | :----------------------------------------------------------------: |
|  <img src="public/templates/modern-ar-en.jpg" width="150" alt="Modern">  |  <img src="public/templates/minimal-ar-en.jpg" width="150" alt="Minimal">  | <img src="public/templates/corporate-ar-en.jpg" width="150" alt="Corporate"> |  <img src="public/templates/elegant-ar-en.jpg" width="150" alt="Elegant">  | <img src="public/templates/bold-ar-en.jpg" width="150" alt="Bold"> |
|                               **Classic**                                |                                **Creative**                                |                                 **Compact**                                  |                                **Gradient**                                |                              **Mono**                              |
| <img src="public/templates/classic-ar-en.jpg" width="150" alt="Classic"> | <img src="public/templates/creative-ar-en.jpg" width="150" alt="Creative"> |   <img src="public/templates/compact-ar-en.jpg" width="150" alt="Compact">   | <img src="public/templates/gradient-ar-en.jpg" width="150" alt="Gradient"> | <img src="public/templates/mono-ar-en.jpg" width="150" alt="Mono"> |

## Put it online with GitHub Pages (one-time setup)

1. In this repository on GitHub, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab, select **Build and deploy to GitHub Pages**, and
   click **Run workflow**. Pushing any commit to `main` also starts it.
4. When the run finishes (about 5 minutes), the app is live at
   https://almailgroup.github.io/AlmailBooks/.

From then on, every push to `main` runs the checks (lint, formatting, type
check, unit tests, build and browser tests) and publishes the new version if
they pass. Before Pages is switched on, the workflow still runs the checks and
skips the deployment with a notice.

To use your own domain (e.g. `books.almailgroup.com`), enter it under
**Settings → Pages → Custom domain** and follow GitHub's DNS instructions. The
app uses relative paths, so it works on any domain or sub-path. Browsers keep
data per site, so **back up before switching to a new domain** and restore the
backup at the new address.

Renaming the repository changes only the path
(`almailgroup.github.io/<repository>/`), not the site, so saved data is still
there at the new address. If you installed the app, install it again from the
new address.

## Where your data lives

- Everything you enter is stored in your browser (IndexedDB) on the device you
  use. Nothing is sent to a server; GitHub Pages only delivers the app itself.
- The site is public, but other visitors see an empty app with their own
  storage. They cannot see your records.
- **Each browser has its own data.** Back up regularly from **Settings → Data
  → Back up**. To move to another computer, open the app there and choose
  **Restore a backup** on the welcome screen.
- Clearing your browser's site data deletes the records. The app asks the
  browser to protect its storage, and installing the app makes this more
  reliable.

## Offline and installing

After the first visit the app works without an internet connection, including
PDF creation. To install it, use the install icon in the address bar (Chrome,
Edge) or **Share → Add to Home Screen** (Safari on iPhone and iPad). When a new
version is published, the app shows a **Reload** button instead of reloading
on its own, so unsaved work is never lost.

## Development

Requires Node.js 22.12 or newer (see `.nvmrc`).

```bash
npm install
npm run dev         # development server at http://localhost:5173
npm test            # unit tests (Vitest)
npm run test:e2e    # production build + browser tests (Playwright)
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm run format      # Prettier (CI runs `npm run format:check`)
npm run build       # production build in dist/
npm run preview     # serve dist/ locally
```

The first time you run the browser tests, install Chromium with
`npx playwright install chromium`.

### Project layout

```
src/
  app/          app shell, routing, active company, offline support
  pages/        screens: dashboard, sales, purchases, cheques, people, payroll, reports, settings
  features/     editors, dialogs and panels used by the screens
  components/   UI building blocks, PDF preview, charts
  db/           IndexedDB schema (Dexie), the records of every module, demo data
  lib/          money, Kuwait data, ledger and financial statements, payroll, inventory
  i18n/         translation functions and the Arabic dictionaries (ar/*.ts)
  pdf/          PDF templates (react-pdf), fonts, document wording, statements, PDF worker
e2e/            browser tests
docs/           Arabic glossary, screenshots
scripts/        regenerate fonts, template thumbnails and app icons
```

### Arabic translations

- Every text in the interface is written in English in the code
  (`t('Save')`, `tp(count, '{count} cheque', '{count} cheques')`), and its
  Arabic is in `src/i18n/ar/*.ts`.
- `docs/arabic-glossary.md` lists the accounting and business terms, so the
  same word is always translated the same way.
- `npm test` fails when a text has no Arabic, when a `{placeholder}` differs or
  when two files translate the same text differently.

### Changing templates and assets

- Each template is a file in `src/pdf/templates/`, built from the shared
  pieces in `shared.tsx`. Names and descriptions are in
  `src/pdf/template-meta.ts`.
- Render sample PDFs and PNGs:
  `npx tsx --tsconfig tsconfig.scripts.json scripts/render-templates.tsx out/ [template]`.
- Regenerate the gallery thumbnails with `scripts/make-thumbnails.sh` (needs
  poppler and ImageMagick).
- Regenerate the fonts with `scripts/subset-fonts.sh` (needs `pip install fonttools`).
- Regenerate the app icons from `public/favicon.svg` with `node scripts/make-icons.mjs`.

## Credits

The feature set was inspired by [Invoice Ninja](https://github.com/invoiceninja/invoiceninja),
and the accounting design by the documentation of [Odoo](https://www.odoo.com).
No code was copied from either. The fonts, including IBM Plex Sans Arabic, are
under the SIL Open Font License (see `src/pdf/fonts/LICENSE.md`).
