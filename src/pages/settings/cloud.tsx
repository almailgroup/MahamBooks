import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Building2,
  Cloud,
  CloudDownload,
  CloudUpload,
  FolderX,
  RefreshCw,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { deleteCompany } from '@/db/records';
import type { Company } from '@/db/types';
import { useCompanyContext } from '@/app/company';
import { msg, t, tp } from '@/i18n';
import { tr } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { Button, buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { ReadOnlyContext } from '@/components/ui/read-only';
import { CLOUD_ERROR_MESSAGES, cloudErrorMessage } from '@/cloud/api';
import { useCloud } from '@/cloud/store';
import { keepOffDevice } from '@/cloud/kept-off';
import { useCloudStatus } from '@/cloud/hooks';
import { PARKED_REASONS, RECORD_LABELS } from '@/cloud/labels';
import { ROLE_LABELS } from '@/cloud/roles';
import {
  cleanupFiles,
  discardParked,
  isDemoCompany,
  keepAsLocal,
  retryParked,
  startUpload,
} from '@/cloud/sync';
import type { OutboxEntry } from '@/cloud/types';
import { LastSynced, SyncStatusLine } from '@/features/cloud/sync-status';
import type { DataTable } from '@/db/db';
import { SettingsSection } from './shared';

const NOT_READ_ONLY = { readOnly: false, reason: '' };

/** Every company on this device and where it stands with the cloud. */
export default function CloudSettings() {
  const { company, companies } = useCompanyContext();
  const { user, configured } = useCloud();
  const others = companies.filter((c) => c.id !== company.id);
  return (
    <ReadOnlyContext.Provider value={NOT_READ_ONLY}>
      <div className="space-y-6">
        <SettingsSection
          title={t('Cloud and sync')}
          description={
            user
              ? tr('Signed in as {email}. Companies in the cloud sync on their own.', {
                  email: (
                    <strong dir="ltr" className="font-medium text-slate-700">
                      {user.email}
                    </strong>
                  ),
                })
              : t('Sign in to keep your companies in the cloud and on all your devices.')
          }
          actions={
            user ? (
              <Link to="/cloud/companies" className={buttonClass('outline', 'sm')}>
                <CloudDownload /> {t('Companies in your account')}
              </Link>
            ) : configured ? (
              <Link to="/signin?next=/settings/cloud" className={buttonClass('primary', 'sm')}>
                {t('Sign in')}
              </Link>
            ) : null
          }
        >
          <CompanyCloud company={company} current />
        </SettingsSection>
        {others.length > 0 ? (
          <SettingsSection title={t('Other companies on this device')}>
            <ul className="-my-3 divide-y divide-slate-100">
              {others.map((c) => (
                <li key={c.id} className="py-4">
                  <CompanyCloud company={c} />
                </li>
              ))}
            </ul>
          </SettingsSection>
        ) : null}
      </div>
    </ReadOnlyContext.Provider>
  );
}

function CompanyCloud({ company, current = false }: { company: Company; current?: boolean }) {
  const { user, api, manager } = useCloud();
  const { switchCompany } = useCompanyContext();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const status = useCloudStatus(company.id);
  const link = status.link;
  const parked = useLiveQuery(
    () => db.outbox.where('[companyId+parked]').equals([company.id, 1]).toArray(),
    [company.id],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const name = localName(company);
  const ctx = api && user ? { api, userId: user.id } : null;
  const mine = Boolean(link && user && link.userId === user.id);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await work();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(cloudErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const removeHere = async () => {
    const ok = await confirm({
      title: t('Remove {name} from this device?', { name }),
      description:
        status.pending > 0
          ? tp(
              status.pending,
              '{count} change has not reached the cloud yet and will be lost. Sync first if you can.',
              '{count} changes have not reached the cloud yet and will be lost. Sync first if you can.',
            )
          : t('It stays in the cloud. You can download it again at any time.'),
      confirmLabel: t('Remove from this device'),
      danger: true,
    });
    if (!ok) return;
    await run(
      'remove',
      async () => {
        // Removed on purpose: it doesn't come back to this device by itself.
        if (user) await keepOffDevice(user.id, company.id);
        await deleteCompany(company.id);
      },
      t('{name} was removed from this device.', { name }),
    );
    if (current) navigate('/');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          {link ? (
            <Cloud className="size-5" aria-hidden />
          ) : (
            <Building2 className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium text-slate-900">
            {current ? (
              <span dir="auto" className="truncate">
                {name}
              </span>
            ) : (
              <button
                type="button"
                dir="auto"
                className="truncate hover:underline"
                onClick={() => void switchCompany(company.id)}
              >
                {name}
              </button>
            )}
            {link ? <Badge>{t(ROLE_LABELS[link.role])}</Badge> : null}
          </p>
          <SyncStatusLine status={status} showPending className="text-sm text-slate-600" />
          {link && link.status !== 'removed' ? (
            <p className="text-xs text-slate-500">
              <LastSynced at={link.lastSyncAt} />
            </p>
          ) : null}
          {status.kind === 'problem' && status.error && !parked?.length ? (
            <p className="mt-1 text-sm text-red-700">{t(CLOUD_ERROR_MESSAGES[status.error])}</p>
          ) : null}
          {status.kind === 'removed' ? (
            <p className="mt-1 text-sm text-slate-600">
              {t(
                'It was deleted by its owner, or you were removed from it. The copy on this device is kept until you decide.',
              )}
            </p>
          ) : null}
          {link && !mine && status.kind !== 'removed' ? (
            <p className="mt-1 text-sm text-slate-600">
              {t('It syncs when the account it belongs to signs in on this device.')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!link && !isDemoCompany(company) && ctx ? (
            <Button
              size="sm"
              loading={busy === 'upload'}
              onClick={() =>
                void run(
                  'upload',
                  () => startUpload(company.id, ctx),
                  t('{name} is going to the cloud.', { name }),
                )
              }
            >
              <CloudUpload /> {t('Keep in the cloud')}
            </Button>
          ) : null}
          {!link && isDemoCompany(company) ? (
            <Badge>{t('Demo: stays on this device')}</Badge>
          ) : null}
          {mine && status.kind !== 'removed' && manager ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'sync'}
              onClick={() => void run('sync', () => manager.syncNow(company.id))}
            >
              <RefreshCw /> {t('Sync now')}
            </Button>
          ) : null}
          {mine && link?.role === 'owner' && ctx ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'files'}
              onClick={() =>
                void run('files', async () => {
                  const removed = await cleanupFiles(company.id, ctx);
                  toast.success(
                    removed
                      ? tp(removed, '{count} unused file removed', '{count} unused files removed')
                      : t('No unused files'),
                  );
                })
              }
            >
              <FolderX /> {t('Clean up files')}
            </Button>
          ) : null}
          {status.kind === 'removed' ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'local'}
              onClick={() =>
                void run(
                  'local',
                  () => keepAsLocal(company.id),
                  t('{name} is now kept on this device only.', { name }),
                )
              }
            >
              {t('Keep on this device')}
            </Button>
          ) : null}
          {link ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'remove'}
              onClick={() => void removeHere()}
            >
              {t('Remove from this device')}
            </Button>
          ) : null}
        </div>
      </div>

      {parked && parked.length > 0 ? <Problems companyId={company.id} entries={parked} /> : null}
    </div>
  );
}

function Problems({ companyId, entries }: { companyId: string; entries: OutboxEntry[] }) {
  const { user, api, manager } = useCloud();
  const [busy, setBusy] = useState<string | null>(null);
  const unique = [...new Map(entries.map((e) => [`${e.table}/${e.id}`, e])).values()];
  return (
    <div className="rounded-lg bg-red-50/60 p-3 ring-1 ring-red-600/15">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-red-800">
          {tp(
            unique.length,
            '{count} change was not accepted by the cloud',
            '{count} changes were not accepted by the cloud',
          )}
        </p>
        <Button
          size="sm"
          variant="outline"
          loading={busy === 'retry'}
          onClick={async () => {
            setBusy('retry');
            await retryParked(companyId);
            await manager?.syncNow(companyId);
            setBusy(null);
          }}
        >
          <RotateCcw /> {t('Try again')}
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-red-600/10">
        {unique.map((entry) => (
          <li key={entry.seq} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-900">
                {t(RECORD_LABELS[entry.table as DataTable] ?? msg('Record'))}
              </span>{' '}
              <span className="text-slate-600">
                ·{' '}
                {t(
                  PARKED_REASONS[entry.error as keyof typeof PARKED_REASONS] ??
                    msg('The cloud did not accept it.'),
                )}
              </span>
            </span>
            {api && user ? (
              <Button
                size="xs"
                variant="ghost"
                loading={busy === entry.id}
                onClick={async () => {
                  setBusy(entry.id);
                  try {
                    await discardParked(companyId, entry, { api, userId: user.id });
                    toast.success(t('Your change was undone.'));
                  } catch (err) {
                    toast.error(cloudErrorMessage(err));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Undo2 /> {t('Undo my change')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
