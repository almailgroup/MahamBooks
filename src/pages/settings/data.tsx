import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, FileUp, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { db, getMeta } from '@/db/db';
import {
  backupFileName,
  exportBackup,
  fetchMissingFiles,
  importBackup,
  LAST_BACKUP_KEY,
  markBackedUp,
  parseBackup,
  restoreImpact,
  summarizeBackup,
  wipeAllData,
  type Backup,
  type RestoreImpact,
} from '@/db/backup';
import { assertNothingUnsent, unsentChanges } from '@/db/records';
import { useCompany, useFormat } from '@/app/company';
import { localName } from '@/i18n/names';
import { normalizeImage } from '@/lib/image';
import { appName } from '@/lib/brand';
import { downloadName } from '@/lib/file-names';
import { formatBytes, requestPersistentStorage, storageStatus } from '@/lib/storage';
import { daysBetween, today } from '@/lib/dates';
import { currentLanguage, msg, t, tp } from '@/i18n';
import { signOutCloud, useCloud } from '@/cloud/store';
import { unsentWarning } from '@/features/cloud/unsent';
import { tr } from '@/i18n/provider';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  useConfirm,
} from '@/components/ui/overlay';
import { withAllSyncLocks } from '@/cloud/lock';
import { SettingsSection } from './shared';

/** Why a backup could not be made, for a person. */
function backupProblem(error: unknown): string {
  // JSON.stringify can't build a text this long (hundreds of MB of scans).
  if (error instanceof RangeError) return t('The backup is too large to save as one file.');
  return error instanceof Error && error.message ? error.message : t('Could not make the backup.');
}

/** Company names in a sentence. */
function namesOf(companies: Parameters<typeof localName>[0][]): string {
  return companies.map((c) => localName(c)).join(currentLanguage() === 'ar' ? '، ' : ', ');
}

function downloadJson(data: unknown, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const TABLE_LABELS: Record<string, string> = {
  companies: msg('Companies'),
  clients: msg('Clients and vendors'),
  products: msg('Products & services'),
  taxRates: msg('Tax rates'),
  documents: msg('Invoices, quotes, bills and credit notes'),
  payments: msg('Payments'),
  recurring: msg('Recurring invoices'),
  activities: msg('Activity entries'),
  accounts: msg('Chart of accounts'),
  journals: msg('Manual journals'),
  expenses: msg('Expenses'),
  attachments: msg('Receipts and files'),
  vatReturns: msg('Tax returns'),
  bankTransactions: msg('Bank statement lines'),
};

export default function DataSettings() {
  const company = useCompany();
  const fmt = useFormat();
  const confirm = useConfirm();
  const { user } = useCloud();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);
  const [chosen, setChosen] = useState<{ backup: Backup; impact: RestoreImpact } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [files, setFiles] = useState<{ done: number; total: number } | null>(null);
  const lastBackup = useLiveQuery(() => getMeta<string | null>(LAST_BACKUP_KEY, null), []);
  const companyCount = useLiveQuery(() => db.companies.count(), []);

  useEffect(() => {
    void storageStatus().then(setStatus);
  }, []);

  const backup = async (all: boolean) => {
    setBusy(all ? 'all' : 'one');
    try {
      const companyId = all ? undefined : company.id;
      // Files kept in the cloud and not on this device yet come here first,
      // so that the backup holds them. One that can't come is asked about below.
      const { failed } = await fetchMissingFiles(
        companyId,
        async (file) => (await import('@/cloud/attachments')).attachmentContent(file.id),
        (done, total) => setFiles(total ? { done, total } : null),
      );
      setFiles(null);
      if (failed.length) {
        const ok = await confirm({
          title: tp(
            failed.length,
            'Back up without {count} file?',
            'Back up without {count} files?',
          ),
          description: t(
            'They are kept in the cloud and could not be downloaded now, for example because this device is offline or signed out. The backup lists them, without their content.',
          ),
          confirmLabel: t('Back up without them'),
        });
        if (!ok) return;
      }
      const data = await exportBackup(companyId);
      downloadJson(data, backupFileName(all ? undefined : company));
      await markBackedUp();
      const left = data.missingFiles?.length ?? 0;
      toast.success(t('Backup downloaded. Keep it somewhere safe, such as a cloud drive.'), {
        description: left
          ? tp(left, '{count} file is not in this backup.', '{count} files are not in this backup.')
          : undefined,
      });
    } catch (error) {
      toast.error(backupProblem(error));
    } finally {
      setFiles(null);
      setBusy(null);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      setChosen({ backup, impact: await restoreImpact(backup) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not read the file.'));
    }
  };

  const restore = async (mode: 'replace' | 'merge') => {
    if (!chosen) return;
    // Changes not sent yet that the person agreed to lose (Replace only).
    let agreed = false;
    if (mode === 'replace') {
      // Counted again: changes may have been made since the file was chosen.
      const impact = await restoreImpact(chosen.backup);
      const ok = await confirm({
        title: t('Replace all data?'),
        description: (
          <div className="space-y-2">
            <p>{t('Everything stored in this browser is deleted and replaced by the backup.')}</p>
            {impact.inCloud.length ? (
              <p>
                {tp(
                  impact.inCloud.length,
                  'Afterwards {names} is a copy on this device only and no longer syncs with your team. The cloud copy is not changed.',
                  'Afterwards {names} are copies on this device only and no longer sync with your team. The cloud copies are not changed.',
                  { names: namesOf(impact.inCloud) },
                )}
              </p>
            ) : null}
            {impact.unsent ? (
              <p className="font-medium text-red-700">{unsentWarning(impact.unsent)}</p>
            ) : null}
          </div>
        ),
        confirmLabel: t('Replace everything'),
        danger: true,
      });
      if (!ok) return;
      agreed = impact.unsent > 0;
    }
    setBusy(mode);
    try {
      // Changes queued after the count are not lost unseen: the restore is
      // refused and says so. Not in the middle of a sync of a company it replaces.
      const result = await withAllSyncLocks(() =>
        importBackup(chosen.backup, mode, (logo) => normalizeImage(logo), { force: agreed }),
      );
      if (mode === 'merge') {
        toast.success(t('Backup merged'), {
          description: tp(
            result.added,
            '{count} record added. Records already here were kept as they are.',
            '{count} records added. Records already here were kept as they are.',
          ),
        });
      } else toast.success(t('Backup restored'));
      setChosen(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not restore the backup.'));
    } finally {
      setBusy(null);
    }
  };

  const wipe = async () => {
    const unsent = await unsentChanges();
    const ok = await confirm({
      title: t('Delete all data in this browser?'),
      description: (
        <div className="space-y-2">
          <p>
            {t(
              'All companies, clients, invoices and payments stored here are removed permanently. Download a backup first.',
            )}
          </p>
          {user ? (
            <p>
              {t(
                'You are also signed out on this device, so your companies kept in the cloud don’t download again until you sign in.',
              )}
            </p>
          ) : null}
          {unsent ? <p className="font-medium text-red-700">{unsentWarning(unsent)}</p> : null}
        </div>
      ),
      confirmLabel: t('Delete everything'),
      danger: true,
    });
    if (!ok) return;
    // Only the changes counted above may be lost; any queued since stop it.
    const agreed = unsent > 0;
    try {
      if (!agreed) await assertNothingUnsent();
      // Signed out first, so the account's companies don't come straight back.
      if (user) await signOutCloud({ removeCompanies: false });
      // Not in the middle of a sync: it would see its records disappear.
      await withAllSyncLocks(() => wipeAllData({ force: agreed }));
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not delete the data.'));
    }
  };

  const age = lastBackup ? daysBetween(lastBackup.slice(0, 10), today()) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">{t('Your data lives only in this browser.')}</p>
        <p className="mt-1">
          {t(
            'Nothing is uploaded to a server. That keeps it private, but clearing browser data or switching computers loses it. Download a backup regularly and restore it on another device when needed.',
          )}
        </p>
      </div>

      <SettingsSection
        title={t('Back up')}
        description={
          lastBackup ? (
            <>
              {t('Last backup: {date}', { date: fmt.dateTime(lastBackup) })}{' '}
              {age !== null && age > 14 ? (
                <Badge tone="amber">{tp(age, '{count} day ago', '{count} days ago')}</Badge>
              ) : null}
            </>
          ) : (
            t('No backup made yet from this browser.')
          )
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => backup(false)} loading={busy === 'one'} className="max-w-full">
            <Download />
            {/* A long company name is cut short rather than pushing past a phone screen. */}
            <span className="truncate">{t('Back up {name}', { name: localName(company) })}</span>
          </Button>
          {(companyCount ?? 0) > 1 ? (
            <Button variant="outline" onClick={() => backup(true)} loading={busy === 'all'}>
              <Download /> {t('Back up all companies')}
            </Button>
          ) : null}
        </div>
        {files ? (
          <p role="status" className="text-sm text-slate-600">
            {t('Downloading files from the cloud: {done} of {total}', files)}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t('Restore')}
        description={t('Load a backup file made with {app} (.json).', { app: appName() })}
      >
        <Button variant="outline" onClick={() => input.current?.click()}>
          <Upload /> {t('Choose backup file…')}
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void chooseFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </SettingsSection>

      <SettingsSection
        title={t('Import from a spreadsheet')}
        description={t(
          'Bring in customers, products, opening balances and open invoices from CSV files.',
        )}
      >
        <ButtonLink to="/settings/import" variant="outline">
          <FileUp /> {t('Import data')}
        </ButtonLink>
      </SettingsSection>

      <SettingsSection title={t('Storage')}>
        {status ? (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2 text-slate-600">
              <HardDrive className="size-4 text-slate-400" />
              {status.usage !== null
                ? t('{size} used', { size: formatBytes(status.usage) })
                : t('Usage unknown')}
            </span>
            {status.persisted ? (
              <Badge tone="green">
                <ShieldCheck className="size-3" /> {t('Protected from automatic clean-up')}
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const ok = await requestPersistentStorage();
                  setStatus(await storageStatus());
                  toast[ok ? 'success' : 'message'](
                    ok
                      ? t('Storage is now protected.')
                      : t(
                          'Your browser decides this itself. Bookmarking or installing the app helps.',
                        ),
                  );
                }}
              >
                <ShieldCheck /> {t('Protect my data')}
              </Button>
            )}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t('Danger zone')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {t('Remove every company and record from this browser.')}
          </p>
          <Button variant="danger" onClick={() => void wipe()}>
            <AlertTriangle /> {t('Delete all data')}
          </Button>
        </div>
      </SettingsSection>

      <Dialog open={chosen !== null} onOpenChange={(open) => !open && setChosen(null)}>
        {chosen ? (
          <DialogContent
            title={t('Restore backup')}
            description={t('Created {date}', { date: fmt.dateTime(chosen.backup.exportedAt) })}
          >
            <DialogBody>
              <ul className="divide-y divide-slate-100 text-sm">
                {Object.entries(summarizeBackup(chosen.backup)).map(([table, count]) => (
                  <li key={table} className="flex justify-between py-1.5">
                    <span className="text-slate-600">
                      {TABLE_LABELS[table] ? t(TABLE_LABELS[table]) : table}
                    </span>
                    <span className="tabular font-medium text-slate-900">{count}</span>
                  </li>
                ))}
              </ul>
              {chosen.backup.missingFiles?.length ? (
                <p className="text-sm text-amber-800">
                  {tp(
                    chosen.backup.missingFiles.length,
                    '{count} file could not be included when this backup was made.',
                    '{count} files could not be included when this backup was made.',
                  )}
                </p>
              ) : null}
              <p className="text-sm text-slate-500">
                {tr(
                  '{merge} adds what this device doesn’t have and keeps every record already here as it is. {replace} deletes everything first.',
                  {
                    merge: <strong>{t('Merge')}</strong>,
                    replace: <strong>{t('Replace')}</strong>,
                  },
                )}
              </p>
              {chosen.impact.inCloud.length ? (
                <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
                  <p>
                    {tp(
                      chosen.impact.inCloud.length,
                      '{names} is kept in the cloud: Merge sends the records the backup adds to your team.',
                      '{names} are kept in the cloud: Merge sends the records the backup adds to your team.',
                      { names: namesOf(chosen.impact.inCloud) },
                    )}
                  </p>
                  <p>
                    {tp(
                      chosen.impact.inCloud.length,
                      'After Replace it is a copy on this device only and no longer syncs.',
                      'After Replace they are copies on this device only and no longer sync.',
                    )}
                  </p>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setChosen(null)}>
                {t('Cancel')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void restore('merge')}
                loading={busy === 'merge'}
              >
                {t('Merge')}
              </Button>
              <Button
                variant="danger"
                onClick={() => void restore('replace')}
                loading={busy === 'replace'}
              >
                {t('Replace everything')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
