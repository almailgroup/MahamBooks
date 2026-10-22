import { Suspense, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router';
import { db } from '@/db/db';
import { saveClient, saveCompany, setupCompany } from '@/db/records';
import { createClient } from '@/db/defaults';
import { createPayment, newCheque } from '@/db/payments';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import { useReadOnly } from '@/components/ui/read-only';
import type { CloudLink } from '@/cloud/types';
import type { MemberPermissions, MemberRole } from '@/cloud/roles';
import { booksRoutes } from '@/apps/books/routes';
import { AppGate } from './app-gate';
import { resetLastApp } from './current-app';
import type { AppId } from './types';

/**
 * What someone sees while an app's page opens from a page outside the apps
 * (the home page, Settings, Updates): the page mounted once, and no lock
 * card or "view only" said on a guess of their role before it is known.
 * Made-up data only.
 */

let mounts = 0;
const readOnlySeen: boolean[] = [];

function Page({ name }: { name: string }) {
  const { readOnly } = useReadOnly();
  useEffect(() => {
    mounts += 1;
  }, []);
  readOnlySeen.push(readOnly);
  return <p>{name} page</p>;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  mounts = 0;
  readOnlySeen.length = 0;
});
afterEach(cleanup);

async function company(role: MemberRole | null, permissions?: MemberPermissions) {
  const made = await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
  if (role) {
    const link: CloudLink = {
      companyId: made.id,
      userId: 'user-1',
      role,
      status: 'ready',
      cursor: 0,
      name: made.name,
      linkedAt: new Date().toISOString(),
      lastSyncAt: null,
      lastError: null,
      lastErrorAt: null,
      permissions,
    };
    await db.syncState.put(link);
  }
  return made;
}

/** Opens `path` from the home page, noting every text the page went through. */
async function openFromHome(page: RouteObject, path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <Suspense fallback={<p>Loading page</p>}>
              <Outlet />
            </Suspense>
          </CompanyProvider>
        ),
        children: [{ index: true, element: <p>home</p> }, page],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>,
  );
  expect(await screen.findByText('home')).toBeInTheDocument();
  const texts: string[] = [];
  const observer = new MutationObserver(() => {
    const text = document.body.textContent ?? '';
    if (texts[texts.length - 1] !== text) texts.push(text);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  await act(async () => {
    await router.navigate(path);
  });
  return {
    router,
    async settle() {
      // The link has been read by now.
      await new Promise((resolve) => setTimeout(resolve, 150));
      observer.disconnect();
      return texts;
    },
  };
}

const gated = (app: AppId): RouteObject => ({
  path: 'page',
  element: (
    <AppGate app={app}>
      <Page name={app} />
    </AppGate>
  ),
});

const LOCK = /turned .* off for you|not part of your role|are private/;
const VIEW_ONLY = /view only for you|but not change it/;

describe('an app opened from a page outside the apps', () => {
  const apps: AppId[] = ['books', 'people', 'crm', 'compliance'];
  for (const role of [null, 'owner', 'admin'] as const) {
    it.each(apps)(
      `shows the page once, with nothing said (%s, ${role ?? 'this device'})`,
      async (app) => {
        await company(role);
        const open = await openFromHome(gated(app), '/page');
        await screen.findByText(`${app} page`);
        const texts = await open.settle();
        expect(texts.some((text) => LOCK.test(text))).toBe(false);
        expect(texts.some((text) => VIEW_ONLY.test(text))).toBe(false);
        expect(mounts).toBe(1);
        expect(readOnlySeen).not.toContain(true);
      },
    );
  }

  it('shows Books once to staff, with saving on', async () => {
    await company('staff');
    const open = await openFromHome(gated('books'), '/page');
    await screen.findByText('books page');
    const texts = await open.settle();
    expect(texts.some((text) => VIEW_ONLY.test(text))).toBe(false);
    expect(mounts).toBe(1);
    expect(readOnlySeen).not.toContain(true);
  });

  it('makes Books view only, once known, for someone the owner limited, without mounting it again', async () => {
    await company('accountant', { apps: { books: 'view' } });
    const open = await openFromHome(gated('books'), '/page');
    expect(
      await screen.findByText(
        'The owner has made Maham Books view only for you. Ask the owner if you need to change something.',
      ),
    ).toBeInTheDocument();
    await open.settle();
    expect(screen.getByText('books page')).toBeInTheDocument();
    expect(mounts).toBe(1);
    expect(readOnlySeen[readOnlySeen.length - 1]).toBe(true);
  });

  it('names the app around the page in the split layout, whose limit is Books’', async () => {
    const made = await company('accountant', { apps: { books: 'view' } });
    await saveCompany({ ...made, appLayout: 'split' });
    resetLastApp();
    const at = (path: string): RouteObject => ({
      path,
      element: (
        <AppGate app="books">
          <Page name={path} />
        </AppGate>
      ),
    });
    for (const [path, app] of [
      ['invoices', 'Maham Sales'],
      ['products', 'Maham Inventory'],
      ['bills', 'Maham Books'],
    ] as const) {
      const open = await openFromHome(at(path), `/${path}`);
      expect(
        await screen.findByText(
          `The owner has made ${app} view only for you. Ask the owner if you need to change something.`,
        ),
      ).toBeInTheDocument();
      await open.settle();
      expect(readOnlySeen[readOnlySeen.length - 1]).toBe(true);
      cleanup();
    }
  });

  it('says the owner turned People off, and never shows the page, when they did', async () => {
    await company('accountant', { apps: { people: 'none' } });
    const open = await openFromHome(gated('people'), '/page');
    expect(
      await screen.findByText('The owner has turned Maham People off for you'),
    ).toBeInTheDocument();
    const texts = await open.settle();
    expect(texts.some((text) => text.includes('people page'))).toBe(false);
    expect(mounts).toBe(0);
  });

  it('keeps People private for staff, with no page shown first', async () => {
    await company('staff');
    const open = await openFromHome(gated('people'), '/page');
    expect(await screen.findByText('Payroll and people are private')).toBeInTheDocument();
    const texts = await open.settle();
    expect(texts.some((text) => text.includes('people page'))).toBe(false);
    expect(texts.some((text) => /turned .* off for you/.test(text))).toBe(false);
    expect(mounts).toBe(0);
  });
});

describe('the cheque register opened from Ctrl K on the home page', () => {
  it('keeps the cheque number it was opened with in its search box', async () => {
    const made = await company(null);
    const client = await saveClient(createClient(made.id, { name: 'Made-up Customer' }));
    for (const number of ['100234', '100999']) {
      await db.payments.put(
        createPayment(made.id, {
          clientId: client.id,
          number: `PAY-${number}`,
          amount: 50,
          method: 'cheque',
          direction: 'in',
          cheque: newCheque({ number, bank: 'NBK', drawer: 'Made-up Customer' }),
        }),
      );
    }
    const cheques = booksRoutes.find((route) => route.path === 'cheques')!;
    const open = await openFromHome(cheques, '/cheques?q=100234');
    // The page's code loads first (slowly on a busy machine).
    await screen.findByLabelText('Search cheques', undefined, { timeout: 20_000 });
    await open.settle();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((screen.getByLabelText('Search cheques') as HTMLInputElement).value).toBe('100234');
    // Only that cheque is listed.
    await waitFor(() => expect(document.body.textContent).toContain('100234'));
    expect(document.body.textContent).not.toContain('100999');
  }, 40_000);
});
