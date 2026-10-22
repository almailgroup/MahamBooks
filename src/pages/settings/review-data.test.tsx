import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast, Toaster } from 'sonner';
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
  downloadForBackup: vi.fn(async (file: { storagePath?: string }): Promise<string> => {
    throw new Error(`Not expected: ${file.storagePath}`);
  }),
  /** The longest backup in one file, lowered by a test. */
  maxBackupSize: 400_000_000,
}));

vi.mock('@/cloud/store', async (original) => ({
  ...(await original<typeof import('@/cloud/store')>()),
  useCloud: () => ({ user: cloud.user, api: null, manager: null, configured: true, ready: true }),
  signOutCloud: cloud.signOutCloud,
}));
vi.mock('@/cloud/attachments', () => ({ downloadForBackup: cloud.downloadForBackup }));
vi.mock('@/db/backup', async (original) => {
  const actual = await original<typeof import('@/db/backup')>();
  return {
    ...actual,
    get MAX_BACKUP_SIZE() {
      return cloud.maxBackupSize;
    },
  };
});

const { default: DataSettings } = await import('./data');
const { default: CompaniesSettings } = await import('./companies');

const downloads: Blob[] = [];

beforeEach(async () => {
  await db.delete();
  await db.open();
  downloads.length = 0;
  cloud.user = null;
  cloud.maxBackupSize = 400_000_000;
  cloud.signOutCloud.mockClear();
  cloud.downloadForBackup.mockReset();
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
  // Sonner shows the next test's page every toast still open: close them.
  toast.dismiss();
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
  /** Opens "Back up Review Trading" and returns the question about the cloud files. */
  async function askedAboutCloudFiles(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /^Back up Review Trading/ }));
    return screen.findByRole('dialog', { name: '1 file is kept only in the cloud' });
  }

  it('asks first, then downloads the cloud files into the backup without keeping them here', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    await scanInTheCloud(company);
    cloud.downloadForBackup.mockResolvedValue('data:application/pdf;base64,QUJD');
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    const dialog = await askedAboutCloudFiles(user);
    expect(dialog).toHaveTextContent(
      'It is 1.9 MB. Included, it is downloaded into this backup only',
    );
    expect(cloud.downloadForBackup).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Include them in the backup' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(cloud.downloadForBackup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'scan-1', storagePath: `${company.id}/scan-1` }),
    );
    const backup = await backedUp();
    expect(backup.data.attachments[0].dataUrl).toBe('data:application/pdf;base64,QUJD');
    expect(backup.missingFiles).toBeUndefined();
    // Not kept on this device: it stays a file kept in the cloud.
    expect(await db.attachments.get('scan-1')).toMatchObject({ dataUrl: '', contentMissing: 1 });
  });

  it('backs up without them when asked, and they stay in the cloud', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    await scanInTheCloud(company);
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    const dialog = await askedAboutCloudFiles(user);
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Back up without them (they stay in the cloud)',
      }),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(cloud.downloadForBackup).not.toHaveBeenCalled();
    expect((await backedUp()).missingFiles).toEqual([
      expect.objectContaining({ id: 'scan-1', name: 'contract.pdf' }),
    ]);
    expect(await screen.findByText('1 file is not in this backup.')).toBeVisible();
  });

  it('only offers the backup without them when they would make it too large', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    await scanInTheCloud(company);
    cloud.maxBackupSize = 2_000_000;
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    const dialog = await askedAboutCloudFiles(user);
    expect(dialog).toHaveTextContent('With it the backup would be about');
    expect(dialog).toHaveTextContent('too large for one file.');
    expect(within(dialog).queryByRole('button', { name: 'Include them in the backup' })).toBeNull();
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Back up without them (they stay in the cloud)',
      }),
    );
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(cloud.downloadForBackup).not.toHaveBeenCalled();
  });

  it('says so when even the records are too large for one file', async () => {
    await setupCompany({ name: 'Review Trading' });
    cloud.maxBackupSize = 1_000;
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await user.click(await screen.findByRole('button', { name: /^Back up Review Trading/ }));
    expect(
      await screen.findByText(/^The backup would be about .*, too large for one file\.$/),
    ).toBeVisible();
    expect(downloads).toHaveLength(0);
  });

  it('asks before leaving out files it could not download, and lists them', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    await inTheCloud(company);
    await scanInTheCloud(company);
    cloud.downloadForBackup.mockRejectedValue(new Error('Offline'));
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await user.click(
      within(await askedAboutCloudFiles(user)).getByRole('button', {
        name: 'Include them in the backup',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Back up without 1 file?' });

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(downloads).toHaveLength(0);

    await user.click(
      within(await askedAboutCloudFiles(user)).getByRole('button', {
        name: 'Include them in the backup',
      }),
    );
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

  it('says that numbers carry on from the highest given, and keeps them', async () => {
    const company = await setupCompany({ name: 'Review Trading' });
    const { exportBackup } = await import('@/db/backup');
    const file = new File([JSON.stringify(await exportBackup(company.id))], 'backup.json', {
      type: 'application/json',
    });
    // Invoices, bills and letters numbered after the backup was made.
    const here = (await db.companies.get(company.id))!;
    const after = (rule: Company['numbering']['invoice']) => ({ ...rule, next: rule.next + 3 });
    await db.companies.put({
      ...here,
      numbering: {
        ...here.numbering,
        invoice: after(here.numbering.invoice),
        bill: after(here.numbering.bill),
        letter: after(here.numbering.letter!),
      },
    });
    const user = userEvent.setup();
    renderPage(<DataSettings />);
    await screen.findByRole('button', { name: 'Choose backup file…' });
    await user.upload(document.querySelector<HTMLInputElement>('input[type=file]')!, file);
    const dialog = await screen.findByRole('dialog', { name: 'Restore backup' });
    await user.click(within(dialog).getByRole('button', { name: 'Replace everything' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace all data?' });
    expect(confirm).toHaveTextContent(
      'Everything stored in this browser is deleted and replaced by the backup.',
    );
    expect(confirm).toHaveTextContent(
      'Numbers are the exception: invoices, bills, letters and everything else numbered carry on from the highest number given, on this device or in the backup, so none is used twice.',
    );
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));
    expect(await screen.findByText('Backup restored')).toBeVisible();
    const restored = (await db.companies.get(company.id))!.numbering;
    expect(restored.invoice.next).toBe(here.numbering.invoice.next + 3);
    expect(restored.bill.next).toBe(here.numbering.bill.next + 3);
    expect(restored.letter!.next).toBe(here.numbering.letter!.next + 3);
  });
});
