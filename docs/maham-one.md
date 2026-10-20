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
  as stateless. The bank's salary file uses the card number when there is no
  Civil ID.

## Code layout

```
src/
  suite/                    Maham One itself
    types.ts                what a manifest holds
    apps.ts                 the apps, which app a page belongs to, access per role, New menus
    current-app.ts          the app open now (the last one on the suite's own pages)
    app-gate.tsx            lock card and view-only mode around an app's pages
    switcher.tsx            the app switcher, app marks, the phone's app tiles
    home/                   the suite's home and what needs attention
    access-grid.tsx         the role-by-app grid in Settings → Team
    boundaries.test.ts      who may import whom
  apps/
    books/                  manifest, routes, pages/, features/ (editors, dialogs, reports…)
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
   manifest to `APPS` in `src/suite/apps.ts`.
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
