import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, FileUp, ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/app/company';
import { db } from '@/db/db';
import { addAttachment } from '@/db/purchases';
import { logPersonnelFilesAdded } from '@/db/people';
import type { Employee } from '@/db/types';
import { documentKind, matchDocuments, type DocumentMatch } from '@/lib/hr/document-match';
import { receiptFromFile } from '@/lib/image';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

/** A file chosen in the dialog, with where it goes. */
interface Entry {
  key: string;
  match: DocumentMatch<File>;
  /** The employee it goes to: matched by number or chosen by hand; null: not added. */
  employeeId: string | null;
  /** Already in that employee's personnel file (same name): not added again. */
  duplicate: boolean;
}

const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

function FileIcon({ file }: { file: File }) {
  return documentKind(file) === 'image' ? (
    <ImageIcon className="size-4 shrink-0 text-slate-500" aria-hidden />
  ) : (
    <FileText className="size-4 shrink-0 text-red-600" aria-hidden />
  );
}

/**
 * "Add documents" on the employees page: many scans at once, each matched to
 * an employee by the number at the end of its name ("… 424.pdf" goes to
 * employee 000424), then added to their personnel files. Files that don't
 * match can be given an employee by hand; files over 10 MB and anything but
 * photos and PDF files are refused.
 */
export function BulkDocumentsDialog({
  employees,
  onClose,
}: {
  employees: Employee[];
  onClose: () => void;
}) {
  const company = useCompany();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  /** Employee chosen by hand for a file, or '' to leave it out. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const ids = useMemo(() => employees.map((e) => e.id), [employees]);
  const attached = useLiveQuery(
    async () =>
      new Set(
        (await db.attachments.where('ownerId').anyOf(ids).toArray()).map(
          (a) => `${a.ownerId}|${a.name}`,
        ),
      ),
    [ids],
  );
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const sorted = useMemo(
    () =>
      [...employees].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    [employees],
  );

  const entries: Entry[] = useMemo(
    () =>
      matchDocuments(files, employees).map((match) => {
        const key = fileKey(match.file);
        const picked = chosen[key];
        const employeeId =
          picked !== undefined
            ? picked || null
            : match.status === 'matched'
              ? match.employeeId
              : null;
        return {
          key,
          match,
          employeeId: match.status === 'refused' ? null : employeeId,
          duplicate: Boolean(employeeId && attached?.has(`${employeeId}|${match.file.name}`)),
        };
      }),
    [files, employees, chosen, attached],
  );
  const ready = entries.filter((e) => e.employeeId && !e.duplicate);
  const matched = entries.filter((e) => e.match.status === 'matched');
  const unmatched = entries.filter((e) => e.match.status === 'unmatched');
  const refused = entries.filter((e) => e.match.status === 'refused');
  const busy = progress !== null;

  const add = (list: FileList | null) => {
    // Copied now: the list empties when the input is reset.
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setFiles((before) => {
      const seen = new Set(before.map(fileKey));
      return [...before, ...picked.filter((f) => !seen.has(fileKey(f)))];
    });
  };

  const remove = (key: string) => {
    setFiles((list) => list.filter((f) => fileKey(f) !== key));
    setChosen((before) => {
      const next = { ...before };
      delete next[key];
      return next;
    });
  };

  const save = async () => {
    const work = ready.map((e) => ({ file: e.match.file, employeeId: e.employeeId! }));
    setProgress({ done: 0, total: work.length });
    let added = 0;
    const failed: string[] = [];
    const people = new Set<string>();
    for (const { file, employeeId } of work) {
      try {
        // Photos are made smaller (JPEG, 1600 px at most); PDF files are kept as they are.
        const { dataUrl, type } = await receiptFromFile(file);
        await addAttachment(company.id, employeeId, { name: file.name, type, dataUrl });
        added += 1;
        people.add(employeeId);
      } catch {
        failed.push(file.name);
      }
      setProgress({ done: added + failed.length, total: work.length });
    }
    await logPersonnelFilesAdded(company.id, added, people.size);
    setProgress(null);
    if (added) {
      toast.success(
        tp(
          added,
          '{count} file added to the personnel files',
          '{count} files added to the personnel files',
        ),
      );
    }
    if (failed.length) {
      toast.error(
        tp(failed.length, '{count} file could not be read', '{count} files could not be read'),
        { description: failed.join(', ') },
      );
      // Keep the ones that failed, to try again or leave.
      const left = new Set(failed);
      setFiles((list) => list.filter((f) => left.has(f.name)));
      return;
    }
    onClose();
  };

  const employeeLabel = (id: string) => {
    const e = byId.get(id);
    return e ? [e.number, localName(e)].filter(Boolean).join(' · ') : '';
  };

  const reason = (entry: Entry): string => {
    const m = entry.match;
    if (m.status === 'refused') {
      return m.reason === 'size'
        ? t('Larger than 10 MB, the most a file can be.')
        : t('Only photos and PDF files can be added.');
    }
    if (m.status !== 'unmatched') return '';
    if (m.reason === 'none') return t('No employee number at the end of the name.');
    if (m.reason === 'several') {
      return t('More than one employee has the number {number}.', { number: m.number ?? '' });
    }
    return t('No employee has the number {number}.', { number: m.number ?? '' });
  };

  const fileName = (file: File) => (
    <span
      className="block truncate text-sm font-medium text-slate-900"
      dir="auto"
      title={file.name}
    >
      {file.name}
    </span>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        title={t('Add documents')}
        description={t(
          'Choose many scans at once. Each goes to the employee whose number ends its name, like “Name 424.pdf” for employee 000424.',
        )}
        size="lg"
      >
        <DialogBody>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(e.dataTransfer.files);
            }}
            className={cn(
              'flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors',
              dragging
                ? 'border-primary-500 bg-primary-50'
                : 'border-slate-300 hover:border-slate-400',
            )}
          >
            <FileUp className="text-primary-600 size-5" aria-hidden />
            <span className="font-medium text-slate-900">
              {files.length ? t('Choose more files') : t('Choose files')}
            </span>
            <span className="text-sm text-slate-500">
              {t('Or drop them here. Photos and PDF files up to 10 MB each.')}
            </span>
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('Choose files')}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }}
          />

          {files.length ? (
            <p className="text-sm font-medium text-slate-900" aria-live="polite">
              {[
                tp(matched.length, '{count} file matched', '{count} files matched'),
                unmatched.length
                  ? tp(unmatched.length, '{count} not matched', '{count} not matched')
                  : '',
                refused.length ? tp(refused.length, '{count} refused', '{count} refused') : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}

          {matched.length ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">{t('Matched')}</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {matched.map((entry) => (
                  <li key={entry.key} className="flex items-center gap-3 px-3 py-2">
                    <FileIcon file={entry.match.file} />
                    <div className="min-w-0 flex-1">
                      {fileName(entry.match.file)}
                      <span
                        className={cn(
                          'block truncate text-xs',
                          entry.duplicate ? 'text-slate-500' : 'text-emerald-700',
                        )}
                      >
                        <bdi>{employeeLabel(entry.employeeId ?? '')}</bdi>
                        {entry.duplicate ? ` · ${t('Already in their personnel file')}` : null}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t('Remove {name}', { name: entry.match.file.name })}
                      onClick={() => remove(entry.key)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {unmatched.length ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">{t('Not matched')}</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {unmatched.map((entry) => (
                  <li
                    key={entry.key}
                    className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <FileIcon file={entry.match.file} />
                      <div className="min-w-0 flex-1">
                        {fileName(entry.match.file)}
                        <span className="block text-xs text-amber-700">{reason(entry)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:w-60">
                      <Select
                        value={entry.employeeId ?? ''}
                        disabled={busy}
                        aria-label={t('Employee for {name}', { name: entry.match.file.name })}
                        onChange={(e) => setChosen((c) => ({ ...c, [entry.key]: e.target.value }))}
                      >
                        <option value="">{t('Choose an employee…')}</option>
                        {sorted.map((e) => (
                          <option key={e.id} value={e.id}>
                            {[e.number, localName(e)].filter(Boolean).join(' · ')}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        aria-label={t('Remove {name}', { name: entry.match.file.name })}
                        onClick={() => remove(entry.key)}
                      >
                        <X />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {refused.length ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">{t('Not added')}</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {refused.map((entry) => (
                  <li key={entry.key} className="flex items-center gap-3 px-3 py-2">
                    <FileIcon file={entry.match.file} />
                    <div className="min-w-0 flex-1">
                      {fileName(entry.match.file)}
                      <span className="block text-xs text-red-700">{reason(entry)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={t('Remove {name}', { name: entry.match.file.name })}
                      onClick={() => remove(entry.key)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {progress ? (
            <div className="flex items-center gap-3" aria-live="polite">
              <div
                role="progressbar"
                aria-label={t('Adding documents')}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100"
              >
                <div
                  className="bg-primary-solid h-full rounded-full transition-[width]"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <span className="tabular shrink-0 text-sm text-slate-600">
                {t('{done} of {total}', { done: progress.done, total: progress.total })}
              </span>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={ready.length === 0}>
            {tp(ready.length, 'Add {count} file', 'Add {count} files')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
