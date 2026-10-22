import { useRef, useState } from 'react';
import { Paperclip, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { FileThumb, openAttachment, type AttachedFile } from '@/features/purchases/attachments';
import { receiptFromFile } from '@/lib/image';
import { newId } from '@/lib/ids';
import { Button } from '@/components/ui/button';
import { useReadOnly } from '@/components/ui/read-only';
import { t } from '@/i18n';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Scans and photos kept with a record (the personnel file, a licence…):
 * the same storage as receipts, with the wording in the interface language.
 * View only (a viewer, or an app the owner made view only), the files only
 * open: nothing is added or removed.
 */
export function FileList({
  files,
  onAdd,
  onRemove,
  emptyText,
  addLabel,
  describe,
  onTag,
}: {
  files: AttachedFile[];
  onAdd: (file: AttachedFile) => void | Promise<unknown>;
  onRemove: (file: AttachedFile) => void | Promise<unknown>;
  emptyText?: string;
  addLabel?: string;
  /** What a file is (#18: the paper it is a copy of); empty for nothing. */
  describe?: (file: AttachedFile) => string;
  /** "This file is the…": marks what the file is a copy of (#18). */
  onTag?: (file: AttachedFile) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { readOnly } = useReadOnly();

  const pick = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t('Choose a file smaller than 10 MB.'));
      return;
    }
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      toast.error(t('Choose a photo or a PDF.'));
      return;
    }
    setBusy(true);
    try {
      const { dataUrl, type } = await receiptFromFile(file);
      await onAdd({ id: newId(), name: file.name, type, dataUrl });
    } catch {
      toast.error(t('Could not read the file.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {files.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                  <span className="block truncate text-sm font-medium text-slate-800" dir="auto">
                    {f.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {f.type === 'application/pdf' ? t('PDF') : t('Photo')}
                  </span>
                  {describe?.(f) ? (
                    <span className="text-primary-700 block truncate text-xs">{describe(f)}</span>
                  ) : null}
                </span>
              </button>
              {readOnly || !onTag ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('This file is the… ({name})', { name: f.name })}
                  title={t('This file is the…')}
                  onClick={() => onTag(f)}
                >
                  <Tag />
                </Button>
              )}
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Remove {name}', { name: f.name })}
                  onClick={() => void onRemove(f)}
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
          <input
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('Attach a file')}
            onChange={(e) => void pick(e.target.files)}
          />
          <Button variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()}>
            <Paperclip /> {addLabel ?? t('Attach file')}
          </Button>
        </>
      )}
    </div>
  );
}
