import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { saveCompany, saveClient, setupCompany } from '@/db/records';
import { createClient, createDocument } from '@/db/defaults';
import { saveDocument } from '@/db/documents';
import { createEmployee, saveEmployee } from '@/db/people';
import type { Company } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import type { CloudLink } from '@/cloud/types';
import type { MemberRole } from '@/cloud/roles';
import { loadLanguage } from '@/i18n';
import { LanguageProvider } from '@/i18n/provider';
import { resetLastApp } from '@/suite/current-app';
import { APPS, SPLIT_APPS } from '@/suite/apps';
import { PEOPLE } from '@/apps/people/manifest';
import { BOOKS } from '@/apps/books/manifest';
import { SETTINGS_GROUPS } from '@/features/shell/settings-sections';
import { createAiClient } from './client';
import {
  guideLines,
  pageLabel,
  placePath,
  systemInstruction,
  type AiPlace,
  type GuideApp,
} from './context';
import { useAiContext } from './use-ai-context';

/**
 * What the AI assistant is told: who it is, where the person is and a guide
 * to the apps, and never anything of a record, whatever page is open.
 * Made-up company, people and numbers only.
 */

const CIVIL_ID = '290010112345';
const IBAN = 'KW81CBKU0000000000001234560101';
const SALARY = 1234.567;
const EMPLOYEE = 'Made-up Guard Person';
const CUSTOMER = 'Imaginary Customer Trading';
const COMPANY = 'Made-up Test Company';

const SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.items);
const same = (key: string) => key;
const bytes = (text: string) => new TextEncoder().encode(text).length;

const place = (patch: Partial<AiPlace> = {}): AiPlace => ({
  app: 'Maham People',
  page: 'Leave',
  path: '/payroll/leave',
  language: 'en',
  role: 'owner',
  ...patch,
});

const everything = (apps: readonly (typeof APPS)[number][]): GuideApp[] =>
  apps.map((app) => ({ app, nav: app.nav }));

describe('the system instruction', () => {
  it('says who the assistant is, how it answers and what it can’t do', () => {
    const text = systemInstruction({
      place: place(),
      guide: guideLines(everything(APPS), same, 'en'),
      settings: SECTIONS.map((s) => s.label),
    });
    for (const words of [
      'Maham One assistant',
      'concise',
      'language of the question',
      'KWD',
      "can't see the person's records",
      'not to paste Civil IDs, IBANs or salaries',
      'confirm with their lawyer or auditor',
      'never say you did',
      'App: Maham People',
      'Page: Leave',
      'Path: /payroll/leave',
      'App language: English',
      'Role: owner',
      '- Maham People: HR',
      'Leave reasons',
      '- Maham Books: accounting',
      'Sales (Clients, Quotes',
      '- Settings (bottom of each sidebar): Company profile',
      'AI assistant',
      // The app's language is the button at the top, not the documents' page.
      "the العربية / English button at the top switches the app's language",
      '(Settings › Language & wording only sets words printed on documents)',
    ]) {
      expect(text).toContain(words);
    }
  });

  it('stays under 3 KB with every app and page, in both layouts and languages', () => {
    const arabic = (key: string) => `${key.replace(/[a-z]/gi, 'ب')}`;
    for (const apps of [APPS, SPLIT_APPS]) {
      const english = systemInstruction({
        place: place(),
        guide: guideLines(everything(apps), same, 'en'),
        settings: SECTIONS.map((s) => s.label),
      });
      expect(bytes(english)).toBeLessThan(3 * 1024);
      // Arabic letters take two bytes each: measured in characters.
      const inArabic = systemInstruction({
        place: place({ language: 'ar' }),
        guide: guideLines(everything(apps), arabic, 'ar'),
        settings: SECTIONS.map((s) => arabic(s.label)),
      });
      expect(inArabic.length).toBeLessThan(3 * 1024);
    }
  });

  it('names the split layout’s Books as the finance app', () => {
    const lines = guideLines(everything(SPLIT_APPS), same, 'en');
    expect(lines.find((l) => l.startsWith('- Maham Books'))).toContain('finance');
    expect(lines.find((l) => l.startsWith('- Maham Sales'))).toContain('quotes');
  });

  it('gives Arabic names of the apps in Arabic', () => {
    const lines = guideLines(everything([PEOPLE]), same, 'ar');
    expect(lines[0]).toMatch(/^- مهام بيبول \(Maham People\):/);
  });
});

describe('where the person is', () => {
  it('is the address without query, with ids as :id', () => {
    expect(placePath('/employees/8c1c7f70-6f1d-4d0e-a3a5-6f0c1c0b9a11/edit')).toBe(
      '/employees/:id/edit',
    );
    expect(placePath('/invoices?status=void&q=Customer')).toBe('/invoices');
    expect(placePath('/reports/profit-and-loss')).toBe('/reports/profit-and-loss');
    expect(placePath('/vat/2026-01-01')).toBe('/vat/:id');
    expect(placePath('/people/letters/templates/default%3Aco%3Asalary_certificate')).toBe(
      '/people/letters/templates/:id',
    );
    expect(placePath('/')).toBe('/');
  });

  it('is the page as the sidebar names it', () => {
    const people = { app: PEOPLE, nav: PEOPLE.nav };
    const label = (path: string) => pageLabel(path, people, APPS, SECTIONS, same);
    expect(label('/payroll/leave')).toBe('Leave');
    expect(label('/payroll/runs/r1')).toBe('Payroll');
    expect(label('/employees/e1/settlement')).toBe('Employees');
    expect(label('/people')).toBe('Overview');
    expect(label('/')).toBe('Home');
    // Another app's page, and the suite's.
    expect(label('/invoices/x')).toBe('Invoices');
    expect(label('/notifications')).toBe('Updates');
    expect(label('/settings/team')).toBe('Settings › Team');
    expect(label('/settings/ai')).toBe('Settings › AI assistant');
    expect(label('/nowhere')).toBe('Page');
    expect(pageLabel('/invoices', { app: BOOKS, nav: BOOKS.nav }, APPS, SECTIONS, same)).toBe(
      'Invoices',
    );
  });
});

describe('the request on a page of records', () => {
  let company: Company;
  let employeeId: string;
  let invoiceId: string;

  async function linkAs(role: MemberRole) {
    const link: CloudLink = {
      companyId: company.id,
      userId: 'user-1',
      role,
      status: 'ready',
      cursor: 0,
      name: company.name,
      linkedAt: new Date().toISOString(),
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    await db.syncState.put(link);
  }

  beforeEach(async () => {
    await db.delete();
    await db.open();
    resetLastApp();
    company = await setupCompany({ name: COMPANY, currency: 'KWD' });
    company = await saveCompany({ ...company, ai: { on: true } });
    await linkAs('owner');
    const employee = await saveEmployee(
      createEmployee(company.id, {
        name: EMPLOYEE,
        civilId: CIVIL_ID,
        iban: IBAN,
        basicSalary: SALARY,
        permitSalary: SALARY,
      }),
    );
    employeeId = employee.id;
    const client = await saveClient(createClient(company.id, { name: CUSTOMER }));
    const invoice = await saveDocument(
      createDocument(company.id, 'invoice', {
        clientId: client.id,
        notes: `For ${CUSTOMER}, Civil ID ${CIVIL_ID}`,
      }),
    );
    invoiceId = invoice.id;
  });
  afterEach(async () => {
    cleanup();
    await loadLanguage('en');
  });

  /** Asks a question from `path` and returns the body sent to the Worker. */
  async function bodySentFrom(path: string): Promise<string> {
    const sent: string[] = [];
    const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"OK"}]}}]}\n\n', {
        status: 200,
      });
    }) as typeof globalThis.fetch;
    const ai = createAiClient({ fetch, getToken: async () => 'a.b.c', baseUrl: 'https://x.test' });

    function Probe() {
      const { system, place } = useAiContext();
      return (
        <>
          <p>{`${place.app} / ${place.page} / ${place.path} / ${place.role ?? 'unknown'}`}</p>
          <button
            type="button"
            onClick={() =>
              void ai.streamChat({
                messages: [{ role: 'user', text: 'How do I record annual leave?' }],
                system,
                onText: () => undefined,
              })
            }
          >
            Ask
          </button>
        </>
      );
    }
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <LanguageProvider>
              <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
                <Probe />
              </CompanyProvider>
            </LanguageProvider>
          ),
        },
      ],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
    // Once the person's role is known, as before the button shows.
    await screen.findByText(/ \/ (owner|admin|accountant|staff|viewer)$/);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await expect.poll(() => sent.length).toBe(1);
    return sent[0];
  }

  const SECRETS = [CIVIL_ID, IBAN, '1234.567', '1,234.567', '1234567', EMPLOYEE, CUSTOMER, COMPANY];

  it('holds nothing of the employee open', async () => {
    const body = await bodySentFrom(`/employees/${employeeId}`);
    expect(
      screen.getByText('Maham People / Employees / /employees/:id / owner'),
    ).toBeInTheDocument();
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).not.toContain(employeeId);
    expect(body).toContain('How do I record annual leave?');
    expect(body).toContain('Page: Employees');
  });

  it('holds nothing of the invoice open, its editor or its customer', async () => {
    for (const path of [`/invoices/${invoiceId}`, `/invoices/${invoiceId}/edit?copy=1`]) {
      const body = await bodySentFrom(path);
      for (const secret of SECRETS) expect(body).not.toContain(secret);
      expect(body).not.toContain(invoiceId);
      expect(body).toContain('Page: Invoices');
      cleanup();
    }
  });

  it('holds nothing of a record in Arabic either', async () => {
    await loadLanguage('ar');
    const body = await bodySentFrom(`/employees/${employeeId}/edit`);
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).toContain('App language: Arabic');
    expect(body).toContain('مهام بيبول (Maham People)');
    // The page of the printed words as the person sees it, the language button named.
    expect(body).toContain('the العربية / English button at the top switches');
    expect(body).toContain('(الإعدادات › اللغة والصياغة only sets words printed on documents)');
  });

  it('leaves out the apps the person can’t open', async () => {
    await linkAs('staff');
    const body = await bodySentFrom('/invoices');
    expect(body).toContain('Role: staff');
    expect(body).not.toContain('Maham People');
    expect(body).not.toContain('Payroll');
  });
});
