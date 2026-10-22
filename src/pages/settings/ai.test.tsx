import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import type { Company } from '@/db/types';
import { CompanyProvider } from '@/app/company';
import type { CloudLink } from '@/cloud/types';
import type { CloudUser } from '@/cloud/auth';
import type { MemberRole } from '@/cloud/roles';
import { withAiSwitch } from '@/features/ai/availability';
import { AiError } from '@/features/ai/errors';
import AiSettings from './ai';

/**
 * Settings → AI assistant: off at first, turned on by the owner or an
 * admin only, not for a company kept on this device, what is sent, and the
 * connection test. Made-up company and person; no real service.
 */

const cloud = vi.hoisted(() => ({ user: null as CloudUser | null }));
vi.mock('@/cloud/store', async (original) => ({
  ...(await original<typeof import('@/cloud/store')>()),
  useCloud: () => ({
    user: cloud.user,
    api: null,
    manager: null,
    configured: true,
    ready: true,
    redirectError: null,
  }),
}));

const health = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/features/ai/client', async (original) => ({
  ...(await original<typeof import('@/features/ai/client')>()),
  checkHealth: health.check,
}));

let company: Company;

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

function show() {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
            <AiSettings />
          </CompanyProvider>
        ),
      },
    ],
    { initialEntries: ['/settings/ai'] },
  );
  render(<RouterProvider router={router} />);
}

const toggle = () => screen.findByRole('switch', { name: /Use the AI assistant/ });

beforeEach(async () => {
  await db.delete();
  await db.open();
  cloud.user = { id: 'user-1', email: 'owner@example.com', fullName: 'Made-up Owner' } as CloudUser;
  health.check.mockReset();
  company = await setupCompany({ name: 'Made-up Trading', currency: 'KWD' });
});
afterEach(cleanup);

describe('the AI assistant’s switch', () => {
  it('is written only when on, and left out when off again (D1)', () => {
    expect(company).not.toHaveProperty('ai');
    const on = withAiSwitch(company, true);
    expect(on.ai).toEqual({ on: true });
    expect(withAiSwitch(on, false)).toEqual(company);
    // A later version's own settings stay.
    const later = { ...company, ai: { on: true, extra: 1 } } as unknown as Company;
    expect(withAiSwitch(later, false)).toEqual({ ...company, ai: { extra: 1 } });
  });

  it('is off at first, and the owner turns it on and off', async () => {
    await linkAs('owner');
    show();
    const control = await toggle();
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toBeEnabled();
    fireEvent.click(control);
    await waitFor(async () =>
      expect((await db.companies.get(company.id))?.ai).toEqual({ on: true }),
    );
    await waitFor(() => expect(control).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(control);
    await waitFor(async () => expect(await db.companies.get(company.id)).not.toHaveProperty('ai'));
  });

  it('is changed by an admin, and only looked at by others', async () => {
    await linkAs('admin');
    show();
    expect(await toggle()).toBeEnabled();
    cleanup();
    for (const role of ['accountant', 'staff', 'viewer'] as const) {
      await linkAs(role);
      show();
      expect(await toggle()).toBeDisabled();
      expect(
        screen.getByText('Only the owner or an admin turns the AI assistant on or off.'),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it('asks to sign in when nobody is signed in to the company', async () => {
    await linkAs('owner');
    cloud.user = null;
    show();
    expect(await toggle()).toBeDisabled();
    expect(screen.getByText('Sign in to use the AI assistant.')).toBeInTheDocument();
  });

  it('isn’t offered for a company kept on this device only', async () => {
    show();
    expect(
      await screen.findByText(/The AI assistant needs a company kept in the cloud/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('What the AI assistant sees')).toBeInTheDocument();
  });

  it('says plainly what is sent', async () => {
    await linkAs('owner');
    show();
    await toggle();
    expect(screen.getByText(/Only what you type in the chat/)).toBeInTheDocument();
    expect(screen.getByText(/Google’s paid-tier terms/)).toBeInTheDocument();
    expect(screen.getByText(/Don’t paste Civil IDs, IBANs, salaries/)).toBeInTheDocument();
  });
});

describe('the connection test', () => {
  it('shows OK with the model', async () => {
    health.check.mockResolvedValue({ ok: true, model: 'gemini-test' });
    await linkAs('viewer');
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(
      await screen.findByText('Connected. The AI service answers with gemini-test.'),
    ).toBeInTheDocument();
  });

  it('shows the error', async () => {
    health.check.mockRejectedValue(new AiError('forbidden_origin', { status: 403 }));
    await linkAs('owner');
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI assistant works only in the app at mahamone.com.',
    );
  });
});
