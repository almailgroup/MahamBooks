import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Building2, CloudDownload, CloudUpload, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { setCurrentCompanyId } from '@/db/records';
import type { Company } from '@/db/types';
import { t } from '@/i18n';
import { tr } from '@/i18n/provider';
import { localName } from '@/i18n/names';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Spinner } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/overlay';
import { cloudErrorMessage, type CloudCompany } from '@/cloud/api';
import { useCloud } from '@/cloud/store';
import { useCloudStatus } from '@/cloud/hooks';
import { ROLE_LABELS } from '@/cloud/roles';
import { isDemoCompany, startDownload, startUpload } from '@/cloud/sync';
import type { CloudLink } from '@/cloud/types';
import { AuthShell, FormError } from '@/features/cloud/auth-shell';
import { SyncStatusLine } from '@/features/cloud/sync-status';

/**
 * After signing in: the companies on this device can go to the cloud, and
 * the account's companies can come to this device.
 */
export default function CloudCompaniesPage() {
  const { ready, user, api } = useCloud();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const local = useLiveQuery(() => db.companies.toArray(), []);
  const links = useLiveQuery(() => db.syncState.toArray(), []);
  const [cloud, setCloud] = useState<CloudCompany[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !user) return;
    let cancelled = false;
    api
      .myCompanies()
      .then((list) => !cancelled && setCloud(list))
      .catch((err) => {
        if (cancelled) return;
        setCloud([]);
        setError(cloudErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, user]);

  if (!ready) return <Spinner className="min-h-dvh" label={t('Loading…')} />;
  if (!user) return <Navigate to="/signin?next=/cloud/companies" replace />;
  if (!local || !links) return <Spinner className="min-h-dvh" label={t('Loading…')} />;

  const linkOf = new Map(links.map((l) => [l.companyId, l]));
  const here = new Set(local.map((c) => c.id));
  const toDownload = (cloud ?? []).filter(
    (c) => !here.has(c.id) && linkOf.get(c.id)?.status !== 'downloading',
  );
  const downloading = links.filter((l) => l.status === 'downloading' && l.userId === user.id);
  const ctx = api ? { api, userId: user.id } : null;

  const upload = async (company: Company) => {
    if (!ctx) return;
    setBusy(company.id);
    setError('');
    try {
      await startUpload(company.id, ctx);
      toast.success(t('{name} is going to the cloud.', { name: localName(company) }));
    } catch (err) {
      setError(cloudErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const download = async (company: CloudCompany) => {
    if (!ctx) return;
    if (here.has(company.id)) {
      const ok = await confirm({
        title: t('Replace the copy on this device?'),
        description: t(
          'This device has its own copy of {name}. It is replaced by the one in the cloud.',
          { name: company.name },
        ),
        confirmLabel: t('Replace'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(company.id);
    setError('');
    try {
      await startDownload(company, ctx);
    } catch (err) {
      setError(cloudErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const open = async (id: string) => {
    await setCurrentCompanyId(id);
    navigate('/');
  };

  const nothing =
    local.length === 0 && cloud !== null && cloud.length === 0 && downloading.length === 0;

  return (
    <AuthShell
      wide
      title={t('Your companies')}
      description={tr('Signed in as {email}.', {
        email: (
          <strong dir="ltr" className="font-medium text-slate-900">
            {user.email}
          </strong>
        ),
      })}
      footer={
        local.length > 0 ? (
          <Button size="lg" onClick={() => navigate('/')} className="w-full sm:w-auto">
            {t('Continue to the app')}
          </Button>
        ) : null
      }
    >
      <div className="space-y-6">
        <FormError>{error}</FormError>
        {nothing ? (
          <EmptyState
            className="py-6"
            icon={<Building2 />}
            title={t('No companies yet')}
            description={t('Set up your company. It is kept in the cloud, ready for your team.')}
            action={
              <Button onClick={() => navigate('/')}>
                <Plus /> {t('Set up a company')}
              </Button>
            }
          />
        ) : null}

        {cloud === null ? <Spinner className="py-4" label={t('Loading your companies…')} /> : null}

        {toDownload.length > 0 || downloading.length > 0 ? (
          <section aria-labelledby="in-account">
            <h2 id="in-account" className="text-sm font-semibold text-slate-900">
              {t('In your account')}
            </h2>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {downloading.map((link) => (
                <Row key={link.companyId} name={link.name} link={link} />
              ))}
              {toDownload.map((company) => (
                <li key={company.id} className="flex flex-wrap items-center gap-3 p-3">
                  <CloudDownload className="size-5 shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate font-medium text-slate-900">
                      {company.name}
                    </p>
                    <p className="text-xs text-slate-500">{t(ROLE_LABELS[company.role])}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void download(company)}
                    loading={busy === company.id}
                    disabled={busy !== null}
                  >
                    {t('Download to this device')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {local.length > 0 ? (
          <section aria-labelledby="on-device">
            <h2 id="on-device" className="text-sm font-semibold text-slate-900">
              {t('On this device')}
            </h2>
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {local.map((company) => {
                const link = linkOf.get(company.id);
                const demo = isDemoCompany(company);
                const other = link && link.userId !== user.id;
                return (
                  <Row
                    key={company.id}
                    name={localName(company)}
                    link={link && !other ? link : undefined}
                    onOpen={() => void open(company.id)}
                    action={
                      demo ? (
                        <Badge>{t('Demo: stays on this device')}</Badge>
                      ) : other ? (
                        <Badge tone="amber">{t('Linked to another account')}</Badge>
                      ) : !link || link.status === 'removed' ? (
                        <Button
                          size="sm"
                          onClick={() => void upload(company)}
                          loading={busy === company.id}
                          disabled={busy !== null}
                        >
                          <CloudUpload /> {t('Keep in the cloud')}
                        </Button>
                      ) : null
                    }
                  />
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </AuthShell>
  );
}

function Row({
  name,
  link,
  action,
  onOpen,
}: {
  name: string;
  link?: CloudLink;
  action?: ReactNode;
  onOpen?: () => void;
}) {
  const status = useCloudStatus(link?.companyId);
  const progress = status.progress;
  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <Building2 className="size-5 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0 flex-1">
        {onOpen && link?.status !== 'downloading' ? (
          <button
            type="button"
            onClick={onOpen}
            dir="auto"
            className="block max-w-full truncate text-start font-medium text-slate-900 hover:underline"
          >
            {name}
          </button>
        ) : (
          <p dir="auto" className="truncate font-medium text-slate-900">
            {name}
          </p>
        )}
        {link ? (
          <SyncStatusLine status={status} className="text-xs text-slate-600" />
        ) : (
          <p className="text-xs text-slate-500">{t('On this device only')}</p>
        )}
        {percent !== null ? (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('Progress')}
          >
            <div
              className="bg-primary-solid h-full rounded-full transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
      </div>
      {action}
    </li>
  );
}
