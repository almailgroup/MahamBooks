import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient } from './defaults';
import {
  backupFileName,
  exportBackup,
  importBackup,
  parseBackup,
  BackupError,
  summarizeBackup,
} from './backup';
import { saveClient, setupCompany, getCurrentCompanyId } from './records';
import { seedDemoCompany } from './demo';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('backup', () => {
  it('round-trips everything through JSON', async () => {
    const demo = await seedDemoCompany();
    const backup = await exportBackup();
    const counts = summarizeBackup(backup);
    expect(counts.companies).toBe(1);
    expect(counts.documents).toBeGreaterThan(10);
    expect(counts.payments).toBeGreaterThan(3);

    const text = JSON.stringify(backup);
    await db.delete();
    await db.open();
    await importBackup(parseBackup(text), 'replace');

    expect(await db.documents.count()).toBe(counts.documents);
    expect(await db.payments.count()).toBe(counts.payments);
    expect(await getCurrentCompanyId()).toBe(demo.id);
    const restored = await db.documents.where('companyId').equals(demo.id).first();
    expect(restored?.totals.total).toBeGreaterThan(0);
  }, 120_000);

  it('exports a single company', async () => {
    const a = await setupCompany({ name: 'A' });
    const b = await setupCompany({ name: 'B' });
    await saveClient(createClient(a.id, { name: 'Client A' }));
    await saveClient(createClient(b.id, { name: 'Client B' }));
    const backup = await exportBackup(a.id);
    expect(backup.data.companies.map((c) => c.id)).toEqual([a.id]);
    expect(backup.data.clients).toHaveLength(1);
  });

  it('merges without deleting existing data', async () => {
    const a = await setupCompany({ name: 'A' });
    const backup = await exportBackup(a.id);
    await setupCompany({ name: 'B' });
    await importBackup(backup, 'merge');
    expect(await db.companies.count()).toBe(2);
  });

  it('labels backups with the app name and accepts any label with the right structure', async () => {
    const a = await setupCompany({ name: 'A' });
    const backup = await exportBackup(a.id);
    expect(backup.app).toBe('Maham Books');
    expect(backupFileName({ name: 'A Co' })).toMatch(
      /^MahamBooks-backup-a-co-\d{4}-\d{2}-\d{2}\.json$/,
    );
    // A name in Arabic letters only is left out, without a double dash.
    expect(backupFileName({ name: 'شركة الميل' })).toMatch(
      /^MahamBooks-backup-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const earlierBuild = JSON.stringify({ ...backup, app: 'earlier-build' });
    await db.delete();
    await db.open();
    await importBackup(parseBackup(earlierBuild), 'replace');
    expect((await db.companies.get(a.id))?.name).toBe('A');
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ app: 'other' }))).toThrow(BackupError);
    expect(() =>
      parseBackup(
        JSON.stringify({
          // Made before the product was renamed: still read.
          app: 'AlmailBooks',
          format: 99,
          exportedAt: '',
          data: { companies: [] },
        }),
      ),
    ).toThrow(/newer version/);
  });

  it('sanitizes logos on import', async () => {
    const a = await setupCompany({ name: 'A' });
    await db.companies.update(a.id, {
      branding: { ...a.branding, logo: 'data:image/png;base64,broken' },
    });
    const backup = await exportBackup();
    await importBackup(backup, 'replace', async () => null);
    expect((await db.companies.get(a.id))?.branding.logo).toBeNull();
  });
});
