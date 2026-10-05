import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, FileUp, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { db, getMeta } from '@/db/db';
import {
  backupFileName,
  exportBackup,
  importBackup,
  LAST_BACKUP_KEY,
  markBackedUp,
  parseBackup,
  summarizeBackup,
  wipeAllData,
  type Backup,
} from '@/db/backup';
import { useCompany, useFormat } from '@/app/company';
import { localName } from '@/i18n/names';
import { normalizeImage } from '@/lib/image';
import { appName } from '@/lib/brand';
import { downloadName } from '@/lib/file-names';
import { formatBytes, requestPersistentStorage, storageStatus } from '@/lib/storage';
import { daysBetween, today } from '@/lib/dates';
import { msg, t, tp } from '@/i18n';
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
import { SettingsSection } from './shared';

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
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof storageStatus>> | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lastBackup = useLiveQuery(() => getMeta<string | null>(LAST_BACKUP_KEY, null), []);
  const companyCount = useLiveQuery(() => db.companies.count(), []);

  useEffect(() => {
    void storageStatus().then(setStatus);
  }, []);

  const backup = async (all: boolean) => {
    setBusy(all ? 'all' : 'one');
    try {
      const data = await exportBackup(all ? undefined : company.id);
      downloadJson(data, backupFileName(all ? undefined : company));
      await markBackedUp();
      toast.success(t('Backup downloaded. Keep it somewhere safe, such as a cloud drive.'));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPending(parseBackup(await file.text()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not read the file.'));
    }
  };

  const restore = async (mode: 'replace' | 'merge') => {
    if (!pending) return;
    if (mode === 'replace') {
      const ok = await confirm({
        title: t('Replace all data?'),
        description: t('Everything stored in this browser is deleted and replaced by the backup.'),
        confirmLabel: t('Replace everything'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(mode);
    try {
      await importBackup(pending, mode, (logo) => normalizeImage(logo));
      toast.success(t('Backup restored'));
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not restore the backup.'));
    } finally {
      setBusy(null);
    }
  };

  const wipe = async () => {
    const ok = await confirm({
      title: t('Delete all data in this browser?'),
      description: t(
        'All companies, clients, invoices and payments stored here are removed permanently. Download a backup first.',
      ),
      confirmLabel: t('Delete everything'),
      danger: true,
    });
    if (!ok) return;
    await wipeAllData();
    window.location.reload();
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

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        {pending ? (
          <DialogContent
            title={t('Restore backup')}
            description={t('Created {date}', { date: fmt.dateTime(pending.exportedAt) })}
          >
            <DialogBody>
              <ul className="divide-y divide-slate-100 text-sm">
                {Object.entries(summarizeBackup(pending)).map(([table, count]) => (
                  <li key={table} className="flex justify-between py-1.5">
                    <span className="text-slate-600">
                      {TABLE_LABELS[table] ? t(TABLE_LABELS[table]) : table}
                    </span>
                    <span className="tabular font-medium text-slate-900">{count}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-500">
                {tr(
                  '{merge} adds the backup to what is already here (records with the same id are updated). {replace} deletes everything first.',
                  {
                    merge: <strong>{t('Merge')}</strong>,
                    replace: <strong>{t('Replace')}</strong>,
                  },
                )}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPending(null)}>
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
