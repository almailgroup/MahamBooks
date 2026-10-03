import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, FileText, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { addAttachment, removeAttachment } from '@/db/purchases';
import type { ID } from '@/db/types';
import { receiptFromFile } from '@/lib/image';
import { newId } from '@/lib/ids';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** A file shown in an attachment list, stored or not yet saved. */
export interface AttachedFile {
  id: ID;
  name: string;
  type: string;
  dataUrl: string;
}

/** Opens a file in a new tab. Browsers refuse to open data: URLs directly. */
export function openAttachment(file: Pick<AttachedFile, 'dataUrl' | 'type'>) {
  const base64 = file.dataUrl.slice(file.dataUrl.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    commit: async (companyId: ID) => {
      for (const id of removed) await removeAttachment(id);
      for (const file of added) await addAttachment(companyId, ownerId, file);
      setAdded([]);
      setRemoved([]);
    },
  };
}

/**
 * Thumbnails of receipts and scanned bills, with an "Attach file" button.
 * With `camera`, phones also get a "Take photo" button that opens the camera.
 */
export function AttachmentList({
  files,
  onAdd,
  onRemove,
  emptyText,
  camera = false,
}: {
  files: AttachedFile[];
  onAdd: (file: AttachedFile) => void | Promise<unknown>;
  onRemove: (id: ID) => void | Promise<unknown>;
  emptyText?: string;
  camera?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

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
  const firstPhoto = camera && files.length === 0;

  return (
    <div className="space-y-3">
      {files.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
            >
              <button
                type="button"
                onClick={() => openAttachment(f)}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
                title={t('Open {name}', { name: f.name })}
              >
                {f.type.startsWith('image/') ? (
                  <img
                    src={f.dataUrl}
                    alt=""
                    className="size-11 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
                    <FileText className="size-5" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {f.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {f.type === 'application/pdf' ? t('PDF') : t('Photo')}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('Remove {name}', { name: f.name })}
                onClick={() => void onRemove(f.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : emptyText ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : null}
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
            className="hidden flex-1 sm:flex-none pointer-coarse:inline-flex"
            loading={busy}
            onClick={() => photo.current?.click()}
          >
            <Camera /> {t('Take photo')}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size={firstPhoto ? 'md' : 'sm'}
          className={cn(camera && 'max-sm:flex-1')}
          loading={busy}
          onClick={() => input.current?.click()}
        >
          <Paperclip /> {camera ? t('Choose file') : t('Attach file')}
        </Button>
      </div>
    </div>
  );
}
