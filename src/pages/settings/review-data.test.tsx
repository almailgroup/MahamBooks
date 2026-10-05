import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { db } from '@/db/db';
import { setupCompany } from '@/db/records';
import { draftDocument } from '@/db/documents';
import { CompanyProvider } from '@/app/company';
import { ConfirmProvider } from '@/components/ui/overlay';
import type { Company } from '@/db/types';
import type { CloudLink } from '@/cloud/types';

/**
 * The Data and Companies settings pages: backups that hold every file, and
 * removals that say what is lost. Made-up data only.
 */

const cloud = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; fullName: string; language: 'en' },
  signOutCloud: vi.fn(async () => undefined),
  attachmentContent: vi.fn(async (id: string): Promise<unknown> => id),
}));

vi.mock('@/cloud/store', async (original) => ({
  ...(await original<typeof import('@/cloud/store')>()),
  useCloud: () => ({ user: cloud.user, api: null, manager: null, configured: true, ready: true }),
  signOutCloud: cloud.signOutCloud,
}));
vi.mock('@/cloud/attachments', () => ({ attachmentContent: cloud.attachmentContent }));

const { default: DataSettings } = await import('./data');
const { default: CompaniesSettings } = await import('./companies');

const downloads: Blob[] = [];

beforeEach(async () => {
  await db.delete();
  await db.open();
  downloads.length = 0;
  cloud.user = null;
  cloud.signOutCloud.mockClear();
  cloud.attachmentContent.mockReset();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloads.push(blob);
    return 'blob:made-up';
  });
  URL.revokeObjectURL = vi.fn();
  // The download link's click: the file is read from createObjectURL above.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage(page: ReactNode) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <CompanyProvider fallback={<p>Loading</p>} onboarding={<p>Welcome</p>}>
          {page}
        </CompanyProvider>
      ),
    },
  ]);
  render(
    <ConfirmProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ConfirmProvider>,
  );
}

async function inTheCloud(company: Company, unsent = 0) {
  const link: CloudLink = {
    companyId: company.id,
    userId: 'user-owner',
    role: 'owner',
    status: 'ready',
    cursor: 1,
    name: company.name,
    linkedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
  };
  await db.syncState.put(link);
  for (let i = 0; i < unsent; i++) {
    await db.outbox.add({
      companyId: company.id,
      table: 'clients',
      id: `made-up-${i}`,
      op: 'put',
      at: new Date().toISOString(),
      parked: 0,
    });
  }
}

/** A scan kept in the cloud, not on this device yet. */
async function scanInTheCloud(company: Company) {
  await db.attachments.put({
    id: 'scan-1',
    companyId: company.id,
    ownerId: 'bill-1',
    name: 'contract.pdf',
    type: 'application/pdf',
    size: 2_000_000,
    dataUrl: '',
    storagePath: `${company.id}/scan-1`,
    contentHash: 'f'.repeat(64),
    contentMissing: 1,
    createdAt: new Date().toISOString(),
  });
}

const backedUp = async () =>
  JSON.parse(await downloads[0].text()) as {
    data: { attachments: { id: string; dataUrl: string }[] };
    missingFiles?: { id: string }[];
  };

describe('Back up', () => {
  it('downloads the files that are only in the cloud first', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    await scanInTheCloud(company);
    cloud.attachmentContent.mockImplementation(async (id: string) => {
      await db.attachments.update(id, { dataUrl: 'data:application/pdf;base64,QUJD' });
    });
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await user.click(await screen.findByRole('button', { name: /^Back up Review Trading/ }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(cloud.attachmentContent).toHaveBeenCalledWith('scan-1');
    const backup = await backedUp();
    expect(backup.data.attachments[0].dataUrl).toBe('data:application/pdf;base64,QUJD');
    expect(backup.missingFiles).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before leaving out files it could not download, and lists them', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    await scanInTheCloud(company);
    cloud.attachmentContent.mockRejectedValue(new Error('Offline'));
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await user.click(await screen.findByRole('button', { name: /^Back up Review Trading/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Back up without 1 file?' });

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(downloads).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /^Back up Review Trading/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Back up without 1 file?' })).getByRole(
        'button',
        { name: 'Back up without them' },
      ),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect((await backedUp()).missingFiles).toEqual([
      expect.objectContaining({ id: 'scan-1', name: 'contract.pdf' }),
    ]);
    expect(await screen.findByText('1 file is not in this backup.')).toBeVisible();
  });

  it('says why when the backup can’t be made', async () => {
    await setupCompany({ name: 'Review Trading' });
    URL.createObjectURL = vi.fn(() => {
      throw new RangeError('Invalid string length');
    });
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await user.click(await screen.findByRole('button', { name: /^Back up Review Trading/ }));
    expect(await screen.findByText('The backup is too large to save as one file.')).toBeVisible();
    expect(await screen.findByRole('button', { name: /^Back up Review Trading/ })).toBeEnabled();
  });
});

describe('Delete all data', () => {
  it('says what has not reached the cloud yet and signs out first', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company, 2);
    cloud.user = { id: 'user-owner', email: 'owner@example.com', fullName: '', language: 'en' };
    const order: string[] = [];
    cloud.signOutCloud.mockImplementation(async () => {
      order.push(`signed out, ${await db.companies.count()} companies here`);
    });
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await user.click(await screen.findByRole('button', { name: 'Delete all data' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete all data in this browser?' });
    expect(dialog).toHaveTextContent(
      '2 changes have not reached the cloud yet and will be lost. Sync first if you can.',
    );
    expect(dialog).toHaveTextContent('You are also signed out on this device');
    await user.click(within(dialog).getByRole('button', { name: 'Delete everything' }));
    await waitFor(async () => expect(await db.companies.count()).toBe(0));
    expect(order).toEqual(['signed out, 1 companies here']);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('Settings → Companies → Remove from this device', () => {
  it('warns about the changes not sent yet, then removes the company', async () => {
    const kept = await setupCompany({ name: 'Another Trading' });
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company, 3);
    const user = userEvent.setup();
    renderPage(<CompaniesSettings />);
    await user.click(await screen.findByRole('button', { name: 'Delete Review Trading' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove Review Trading from this device?',
    });
    expect(dialog).toHaveTextContent(
      '3 changes have not reached the cloud yet and will be lost. Sync first if you can.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove from this device' }));
    await waitFor(async () => expect(await db.companies.get(company.id)).toBeUndefined());
    expect(await db.companies.get(kept.id)).toBeDefined();
  });

  it('keeps the company when a change was queued after the dialog opened', async () => {
    await setupCompany({ name: 'Another Trading' });
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    const user = userEvent.setup();
    renderPage(<CompaniesSettings />);
    await user.click(await screen.findByRole('button', { name: 'Delete Review Trading' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove Review Trading from this device?',
    });
    expect(dialog).toHaveTextContent('It stays in the cloud for you and your team');
    // Saved in another tab meanwhile, not sent yet.
    await db.outbox.add({
      companyId: company.id,
      table: 'clients',
      id: 'made-up',
      op: 'put',
      at: new Date().toISOString(),
      parked: 0,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Remove from this device' }));
    expect(
      await screen.findByText(
        '1 change has not reached the cloud yet. Sync first, or confirm that it may be lost.',
      ),
    ).toBeVisible();
    expect(await db.companies.get(company.id)).toBeDefined();
    expect(await db.outbox.count()).toBe(1);
  });
});

describe('Restore', () => {
  it('says what Merge and Replace do to a company kept in the cloud', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await draftDocument(company, 'invoice', null);
    const { exportBackup } = await import('@/db/backup');
    const file = new File([JSON.stringify(await exportBackup(company.id))], 'backup.json', {
      type: 'application/json',
    });
    await inTheCloud(company, 1);
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await screen.findByRole('button', { name: 'Choose backup file…' });
    await user.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, file);
    const dialog = await screen.findByRole('dialog', { name: 'Restore backup' });
    expect(dialog).toHaveTextContent(
      'Review Trading is kept in the cloud: Merge sends the records the backup adds to your team.',
    );
    expect(dialog).toHaveTextContent(
      'After Replace it is a copy on this device only and no longer syncs.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Replace everything' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace all data?' });
    expect(confirm).toHaveTextContent(
      'Afterwards Review Trading is a copy on this device only and no longer syncs with your team. The cloud copy is not changed.',
    );
    expect(confirm).toHaveTextContent(
      '1 change has not reached the cloud yet and will be lost. Sync first if you can.',
    );
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));
    await waitFor(async () => expect(await db.syncState.count()).toBe(0));
    expect(await db.companies.get(company.id)).toBeDefined();
  });
});
