import { CloudOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t, tp } from '@/i18n';
import { STATUS_LABELS, type CloudStatusKind, type CloudStatusView } from '@/cloud/hooks';
import { useFormat } from '@/app/company';

const DOT: Record<CloudStatusKind, string> = {
  local: 'bg-slate-400',
  synced: 'bg-emerald-500',
  syncing: 'bg-sky-500',
  offline: 'bg-amber-500',
  problem: 'bg-red-500',
  'signed-out': 'bg-amber-500',
  removed: 'bg-red-500',
};

/** A coloured dot for a sync status; it pulses while syncing. */
export function SyncDot({ kind, className }: { kind: CloudStatusKind; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden>
      {kind === 'syncing' ? (
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOT[kind])} />
      ) : null}
      <span className={cn('relative inline-flex size-2 rounded-full', DOT[kind])} />
    </span>
  );
}

/** "Synced", "Syncing… 40 of 120", "Offline – changes will sync"… */
export function syncLabel(status: CloudStatusView): string {
  if (status.kind === 'syncing' && status.progress && status.progress.total > 0) {
    return status.progress.kind === 'upload'
      ? t('Uploading {done} of {total}', {
          done: status.progress.done,
          total: status.progress.total,
        })
      : t('Downloading {done} of {total}', {
          done: status.progress.done,
          total: status.progress.total,
        });
  }
  return t(STATUS_LABELS[status.kind]);
}

/** The status in a line: dot and words, with what is waiting. */
export function SyncStatusLine({
  status,
  className,
  showPending = false,
}: {
  status: CloudStatusView;
  className?: string;
  showPending?: boolean;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {status.kind === 'offline' ? (
        <CloudOff className="size-3.5 shrink-0 text-amber-600" aria-hidden />
      ) : status.kind === 'syncing' && status.progress ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600" aria-hidden />
      ) : (
        <SyncDot kind={status.kind} />
      )}
      <span className="truncate">{syncLabel(status)}</span>
      {showPending && status.pending > 0 && status.kind !== 'syncing' ? (
        <span className="text-slate-500">
          · {tp(status.pending, '{count} change waiting', '{count} changes waiting')}
        </span>
      ) : null}
    </span>
  );
}

/** "Last synced 10:42" in the interface language. */
export function LastSynced({ at }: { at: string | null | undefined }) {
  const fmt = useFormat();
  if (!at) return <>{t('Not synced yet')}</>;
  return <>{t('Last synced {time}', { time: fmt.dateTime(at) })}</>;
}
