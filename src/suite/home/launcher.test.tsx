import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { saveCompany, setupCompany } from '@/db/records';
import type { Company } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import { accessMap, appsFor } from '../apps';
import { rememberApp, resetLastApp, useApps, useCurrentApp, useRememberApp } from '../current-app';
import { Launcher } from './launcher';

/**
 * The home's tool tiles and the sidebar a tool opens with (#3). In the
 * classic layout a tool never changes the app remembered, as before the
 * split layout: CRM's Customers, opened from Books, keeps Books' sidebar.
 * In the split layout Sales' tools open with Sales' sidebar even when Books,
 * which lists their pages, was the last app. Made-up data only.
 */

/** The app the shell shows, as the shell works it out. */
function Shown() {
  const app = useCurrentApp();
  useRememberApp();
  return <p data-testid="app">{app.id}</p>;
}

function Home() {
  const apps = useApps();
  return <Launcher access={accessMap('owner', true, undefined, apps)} stats={{}} />;
}

async function show(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <Shown />
            <Home />
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText('Tools');
  return router;
}

/** A tool tile of one app's group on the home. */
async function tapTool(appTitle: string, tool: string) {
  const heading = await screen.findByRole('heading', { level: 3, name: appTitle });
  const group = heading.parentElement!;
  fireEvent.click(within(group).getByRole('link', { name: tool }));
}

const shownApp = () => screen.getByTestId('app').textContent;

let company: Company;

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetLastApp();
  company = await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
});
afterEach(cleanup);

describe('a tool tile in the classic layout', () => {
  it('keeps Books’ sidebar for CRM’s Customers when Books was the last app', async () => {
    rememberApp('books');
    const router = await show('/');
    await tapTool('Maham CRM', 'Customers');
    expect(router.state.location.pathname).toBe('/clients');
    expect(shownApp()).toBe('books');
    // Home and Settings keep it too.
    await act(() => router.navigate('/settings/team'));
    expect(shownApp()).toBe('books');
  });

  it('keeps CRM’s sidebar for Books’ Quotes when CRM was the last app', async () => {
    rememberApp('crm');
    const router = await show('/');
    await tapTool('Maham Books', 'Quotes');
    expect(router.state.location.pathname).toBe('/quotes');
    expect(shownApp()).toBe('crm');
  });

  it('opens an app’s own page with that app, as before', async () => {
    rememberApp('books');
    const router = await show('/');
    await tapTool('Maham CRM', 'Pipeline');
    expect(router.state.location.pathname).toBe('/crm');
    expect(shownApp()).toBe('crm');
  });
});

describe('a tool tile in the split layout', () => {
  beforeEach(async () => {
    company = await saveCompany({ ...company, appLayout: 'split' });
    expect(appsFor(company).map((app) => app.id)).toContain('sales');
  });

  it('opens Sales’ Invoices with Sales’ sidebar when Books, which lists them, was the last app', async () => {
    rememberApp('books');
    const router = await show('/');
    await tapTool('Maham Sales', 'Invoices');
    expect(router.state.location.pathname).toBe('/invoices');
    expect(shownApp()).toBe('sales');
  });
});
