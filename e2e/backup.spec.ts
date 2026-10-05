import { writeFile } from 'node:fs/promises';
import { downloadFrom, expect, startWithDemoData, test } from './fixtures';

interface BackupFile {
  app: string;
  format: number;
  data: Record<string, { id: string }[]>;
}

const ids = (backup: BackupFile, table: string) => backup.data[table].map((row) => row.id).sort();

test('a backup restores everything on a fresh device', async ({ page }, testInfo) => {
  await startWithDemoData(page);
  await page.goto('#/settings/data');
  const first = await downloadFrom(page, () =>
    page.getByRole('button', { name: /^Back up Rawdat Al Khaleej/ }).click(),
  );
  expect(first.file.suggestedFilename()).toMatch(/^MahamBooks-backup-.*\.json$/);
  const backup = JSON.parse(first.content.toString('utf8')) as BackupFile;
  expect(backup).toMatchObject({ app: 'Maham Books', format: 1 });
  expect(backup.data.companies).toHaveLength(1);
  expect(backup.data.documents.length).toBeGreaterThan(10);
  expect(backup.data.payRuns.length).toBeGreaterThan(10);
  const backupPath = testInfo.outputPath('backup.json');
  await writeFile(backupPath, first.content);

  // Wipe this browser, as if opening the app on another computer.
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Maham Books' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore a backup' }).click();
  await (await chooser).setFiles(backupPath);
  await expect(page.getByText('Backup restored. Welcome back.')).toBeVisible({ timeout: 30_000 });

  // Nothing is lost: a new backup holds the same records.
  await page.goto('#/settings/data');
  await expect(page.getByText(/^Last backup:/)).toBeVisible();
  const second = await downloadFrom(page, () =>
    page.getByRole('button', { name: /^Back up Rawdat Al Khaleej/ }).click(),
  );
  const restored = JSON.parse(second.content.toString('utf8')) as BackupFile;
  for (const table of [
    'companies',
    'clients',
    'products',
    'documents',
    'payments',
    'recurring',
    'journals',
    'expenses',
    'bankTransactions',
    'employees',
    'payRuns',
    'complianceDocuments',
    'stockMovements',
    'assets',
    'yearEnds',
  ]) {
    expect(ids(restored, table), table).toEqual(ids(backup, table));
  }
});
