import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, FileText, ImageDown, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { addAttachment, removeAttachment } from '@/db/purchases';
import type { ID } from '@/db/types';
import { receiptFromFile } from '@/lib/image';
import { newId } from '@/lib/ids';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { t } from '@/i18n';

/** A file shown in an attachment list, stored or not yet saved. */
export interface AttachedFile {
  id: ID;
  name: string;
  type: string;
  dataUrl: string;
}

function blobUrl(dataUrl: string, type: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return url;
}

/**
 * Opens a file in a new tab. Browsers refuse to open data: URLs directly. A
 * file kept in the cloud that this device doesn't have yet is downloaded
 * first (the tab opens at once, so it isn't blocked as a pop-up).
 */
export function openAttachment(file: Pick<AttachedFile, 'dataUrl' | 'type'> & { id?: string }) {
  if (file.dataUrl) {
    window.open(blobUrl(file.dataUrl, file.type), '_blank', 'noopener');
    return;
  }
  if (file.id) openInTab(file.id, file.type);
}

/**
 * Opens a stored file by its id, reading its content only now (the
 * document finder lists files without it). The tab opens at once, so it
 * isn't blocked as a pop-up.
 */
export function openStoredAttachment(id: ID) {
  openInTab(id, '');
}

function openInTab(id: ID, fallbackType: string) {
  const tab = window.open('', '_blank');
  void import('@/cloud/attachments')
    .then(({ attachmentContent }) => attachmentContent(id))
    .then(({ dataUrl, type }) => {
      const url = blobUrl(dataUrl, type || fallbackType);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
    })
    .catch((error) => {
      tab?.close();
      toast.error(error instanceof Error ? error.message : t('Could not open the file.'));
    });
}

/** A thumbnail, or an icon for a PDF or a photo still in the cloud. */
export function FileThumb({ file }: { file: Pick<AttachedFile, 'dataUrl' | 'type'> }) {
  if (file.type.startsWith('image/') && file.dataUrl) {
    return (
      <img
        src={file.dataUrl}
        alt=""
        className="size-11 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
      />
    );
  }
  if (file.type.startsWith('image/')) {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
        <ImageDown className="size-5" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
      <FileText className="size-5" aria-hidden />
    </span>
  );
}

/**
 * Attachments edited in a form: changes stay local until `commit` saves them
 * with the record, so cancelling the form leaves nothing behind.
 */
export function useDraftAttachments(ownerId: ID) {
  const stored = useLiveQuery(
    () => db.attachments.where('ownerId').equals(ownerId).toArray(),
    [ownerId],
  );
  const [added, setAdded] = useState<AttachedFile[]>([]);
  const [removed, setRemoved] = useState<ID[]>([]);
  const files: AttachedFile[] = [
    ...(stored ?? []).filter((a) => !removed.includes(a.id)),
    ...added,
  ];
  return {
    files,
    dirty: added.length > 0 || removed.length > 0,
    add: (file: AttachedFile) => setAdded((list) => [...list, file]),
    remove: (id: ID) => {
      if (added.some((f) => f.id === id)) setAdded((list) => list.filter((f) => f.id !== id));
      else setRemoved((list) => [...list, id]);
    },
    /** The stored files taken off the list, not removed yet. */
    removed,
    /** Saves the changes; `owner` when the record was saved under another id. */
    commit: async (companyId: ID, owner: ID = ownerId) => {
      for (const id of removed) await removeAttachment(id);
      for (const file of added) await addAttachment(companyId, owner, file);
      setAdded([]);
      setRemoved([]);
    },
  };
}

/**
 * Thumbnails of receipts and scanned bills, with an "Attach file" button.
 * With `camera`, phones also get a "Take photo" button that opens the camera.
 * With `readOnly`, or view only (a viewer, or an app the owner made view
 * only), the files only open: nothing is added or removed. With
 * `compact` (a dialog whose own button saves, where a file is optional), the
 * buttons stay small and plain, the camera too.
 */
export function AttachmentList({
  files,
  onAdd,
  onRemove,
  emptyText,
  camera = false,
  readOnly: readOnlyHere = false,
  compact = false,
}: {
  files: AttachedFile[];
  onAdd: (file: AttachedFile) => void | Promise<unknown>;
  onRemove: (id: ID) => void | Promise<unknown>;
  emptyText?: string;
  camera?: boolean;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = useReadOnly().readOnly || readOnlyHere;

  const pick = async (target: HTMLInputElement) => {
    const file = target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, type } = await receiptFromFile(file);
      await onAdd({ id: newId(), name: file.name, type, dataUrl });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not read the file.'));
    } finally {
      setBusy(false);
      target.value = '';
    }
  };
  // The camera is the quickest way to add a receipt on a phone.
  const firstPhoto = camera && !compact && files.length === 0;

  return (
    <div className="space-y-3">
      {files.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="bg-surface flex items-center gap-2 rounded-lg border border-slate-200 p-2"
            >
              <button
                type="button"
                onClick={() => openAttachment(f)}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
                title={t('Open {name}', { name: f.name })}
              >
                <FileThumb file={f} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {f.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {f.type === 'application/pdf' ? t('PDF') : t('Photo')}
                  </span>
                </span>
              </button>
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Remove {name}', { name: f.name })}
                  onClick={() => void onRemove(f.id)}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : emptyText ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : null}
      {readOnly ? null : (
        <>
          {camera ? (
            <input
              ref={photo}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-label={t('Take a photo')}
              onChange={(e) => void pick(e.currentTarget)}
            />
          ) : null}
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('Attach a file')}
            onChange={(e) => void pick(e.currentTarget)}
          />
          <div className="flex flex-wrap gap-2">
            {camera ? (
              // Only where there is a camera to open: phones and tablets.
              <Button
                variant={firstPhoto ? 'primary' : 'outline'}
                size={firstPhoto ? 'md' : 'sm'}
                className={cn(
                  'hidden pointer-coarse:inline-flex',
                  !compact && 'flex-1 sm:flex-none',
                )}
                loading={busy}
                onClick={() => photo.current?.click()}
              >
                <Camera /> {t('Take photo')}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size={firstPhoto ? 'md' : 'sm'}
              className={cn(camera && !compact && 'max-sm:flex-1')}
              loading={busy}
              onClick={() => input.current?.click()}
            >
              <Paperclip /> {camera ? t('Choose file') : t('Attach file')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
