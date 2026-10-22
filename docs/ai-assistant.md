# AI assistant (first version)

Maham One has an AI assistant (المساعد الذكي) that answers questions about
using the app: where something is, how to record it, what a Kuwaiti rule
generally says. It answers in Arabic or English, in the language of the
question. This first version is deliberately small: it sees only what the
person types and which page they are on, never the company's records.

## Turning it on

1. The company must be kept in the cloud (Settings → Team → Keep in the
   cloud). A company kept on this device only can't use the assistant: the AI
   service knows people by their sign-in.
2. The owner or an admin opens **Settings → AI assistant** and turns on
   **Use the AI assistant**. It is off for every company until then (D1), and
   everyone else sees the switch without being able to change it. Once the
   ninth database script has run
   ([`20261214000000_ai_assistant.sql`](../supabase/migrations/20261214000000_ai_assistant.sql),
   step 13 of [`docs/supabase-setup.md`](supabase-setup.md)), the cloud
   keeps it so too: anyone else's change to the switch is ignored, even from
   a modified app. Until then only the app keeps it for them.
3. **Test the connection** on the same page checks that this device reaches
   the AI service (it asks the AI nothing).

Each device picks the switch up once it syncs. Everyone signed in to the
company then sees **Ask AI** at the bottom corner of every page (on the left
in Arabic), above the phone's tab bar. **Ctrl J** (**⌘J** on a Mac) opens and
closes it. The search (Ctrl K) offers **Ask AI…** below its results: chosen
(clicked, or reached with the arrow keys), it opens the panel with what was
typed in the question box, for you to read and send. Pressing Enter in the
search never asks the AI by itself, even when nothing is found: the search
box is where Civil IDs and IBANs are looked up. Print views and PDFs never
show it. Turning the switch off removes the button for everyone.

## Using it

- Type a question and press **Enter** (**Shift+Enter** for a new line), or
  pick one of the suggested questions for the app you are in.
- The answer appears while it is written. **Stop** ends it, keeping what was
  written; **Try again** asks again after an error or a stop; **Copy** copies
  an answer. A question that failed isn't sent again with the next one.
- A question typed but not sent stays in the box when the panel is closed or
  the app's language is switched, until New chat or a reload.
- On a wide screen (1360 pixels or more) the page moves over to make room
  for the panel, so the buttons an answer names stay in sight beside it.
- **New chat** starts again. The conversation is kept only in that browser
  tab: it is gone on reload, never stored and never synced. Each question
  carries at most the last 20 messages of the conversation.
- Without internet the panel says so and nothing is sent.
- The note under the box says it plainly: _AI can make mistakes. Check
  important answers._

## What is sent

With each question the app sends, through Maham One's own AI service:

- the question and the earlier messages of the conversation (at most 20);
- a short instruction (under 3 KB) saying who the assistant is and how to
  answer, where the person is, and a guide to the apps they can open, built
  from the app's own menus.

"Where the person is" is the app's name, the page's name, the page's address
with record ids replaced by `:id` and without what follows `?`, the app's
language and the person's role. **No records, document contents, form values
or company name are sent**, and the guide lists only the apps the person's
role opens (staff and viewers never see People in it). A test renders an
employee's page and an invoice's page over a database holding a Civil ID, an
IBAN, a salary and a customer's name, and checks none of them is in what is
sent; the browser test does the same on a real employee page.

People are asked, in Settings and in the panel, not to paste Civil IDs, IBANs
or salaries into the chat.

The instruction for People → Leave, for the owner, in English (the guide
follows the company's switches: VAT returns appear only with taxes on, and so
on):

```text
You are the Maham One assistant, built into Maham One (office apps for businesses in Kuwait), helping this company's team. Be helpful and concise: short answers, numbered steps.
Answer in the language of the question (Arabic or English); if unclear, in English, the app's language. Use KWD with 3 decimals (KD 1,250.500) and Kuwaiti practice (PIFSS, Civil ID, Friday-Saturday weekend; no VAT unless the company turned taxes on).
You can't see the person's records, documents or screen yet, only what they type and where they are. If an answer needs their data, ask them to describe it or paste only what is needed, and remind them not to paste Civil IDs, IBANs or salaries.
For legal, labour-law or tax questions give general information and say to confirm with their lawyer or auditor.
You can't act in the app: never say you did, changed, sent or saved anything. Say where to do it, naming the app, sidebar page and button as the guide does; if the guide doesn't have it, say you aren't sure.

Where they are:
App: Maham People
Page: Leave
Path: /payroll/leave
App language: English
Role: owner

Guide (apps they can open; + New creates documents; Ctrl K searches; the grid button switches apps; the العربية / English button at the top switches the app's language (Settings › Language & wording only sets words printed on documents); Home shows what needs attention):
- Maham People: HR: employees and their papers, payroll with PIFSS, leave, staff loans, letters; end-of-service settlement on an employee page. Sidebar: Overview, Directory, Employees, Payroll, Leave, Leave reasons, Staff loans, Letters, Manpower costing, Payroll settings.
- Maham Books: accounting: sales and purchase documents (a quote becomes an invoice in one click), payments, post-dated cheques, banking, ledger, reports; statements of account on a customer page. Sidebar: Dashboard, Sales (Clients, Quotes, Proforma invoices, Sales orders, Invoices, Delivery notes, Payments received, Credit notes, Recurring invoices), Purchases (Vendors, Purchase orders, Bills, Expenses, Payments made, Vendor credits), Cheques, Inventory (Products & services, Stock and warehouses), Banking, Accounting (Chart of accounts, Manual journals, Fixed assets, Year-end close), Reports.
- Maham CRM: follow-up of quotes in a pipeline, prospects. Sidebar: Pipeline, Prospects.
- Maham Compliance: licences, staff papers and statutory deadlines, with reminders before expiry. Sidebar: Calendar, Documents.
- Settings (bottom of each sidebar): Company profile, Companies, Links, Compliance and files, Your account, Email alerts, Team, Approvals, AI assistant, Cloud and sync, Invoice defaults, Numbering, Items and units, Email templates, Language & wording, Payment details, Taxes, Accounting, Import data, Backup & data, Appearance.
```

In Arabic the page names are the Arabic ones the person sees, and the apps
are named in both languages (مهام بيبول (Maham People)).

## What it can and can't do yet

It can:

- explain where things are and how to do them, step by step, naming the app,
  the menu and the button;
- explain Kuwaiti practice in general (PIFSS, leave, end-of-service
  indemnity, post-dated cheques), with a note to confirm legal, labour-law and
  tax questions with your lawyer or auditor;
- work with anything you describe or paste, which you should keep to what is
  needed.

It can't:

- see your records, documents, reports or what is on the screen;
- do anything in the app: it never creates, changes, sends or saves;
- remember a conversation after the tab is reloaded.

## The AI service

The app never holds an AI key. Questions go to Maham One's AI service, a
Cloudflare Worker at
`https://maham-ai-proxy.steep-band-c624.workers.dev` (source:
`workers/ai-proxy` in the AI worker repository), which:

- keeps the Google Gemini key as an encrypted secret and calls Gemini with it;
- accepts only signed-in people: each request carries the person's Supabase
  access token, which the Worker checks with Supabase (the app refreshes the
  token once when the Worker refuses it);
- answers only the web address `https://mahamone.com` (so it works from the
  live app, not from a preview or a copy on another address);
- limits how many questions each person asks a minute, and caps the length of
  answers;
- logs only metadata (route, status, model, token counts), never questions or
  answers.

Google answers under its paid-tier terms for the Gemini API: prompts and
answers are not used to improve Google's products.

The app talks to the Worker at `POST /v1/stream` (the answer while it is
written, as Server-Sent Events), `POST /v1/generate` (a whole answer, not used
by the chat yet) and `GET /health` (Test the connection). A build can point at
another copy of the Worker with `VITE_AI_PROXY_URL`.

When something goes wrong the panel says what, in the person's language:
signed out or sign-in expired, an account the Worker doesn't serve (a Worker
limited to one company's members answers `forbidden`), no internet, too many
questions (with the wait in seconds), the service busy, slow or not set up,
an answer withheld. The Worker's own message (English) is never shown in the
chat.

## What comes next

**Phase 2** gives the assistant what is on the page, through a redaction
layer: the record's fields it needs, with Civil IDs, IBANs, salaries and
other personal data removed or masked before anything leaves the device, and
the company's choice of what it may see. Until then, describe the case in
your own words.
