import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, FileUp, ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCompany } from '@/app/company';
import { db } from '@/db/db';
import { addAttachment } from '@/db/purchases';
import {
  logDrivingLicencesFiled,
  logEmployeePhotosAdded,
  logPersonnelFilesAdded,
  setEmployeePhoto,
} from '@/db/people';
import { addNewCopy, fileDrivingLicence } from '@/db/renewals';
import type { Employee } from '@/db/types';
import {
  DOCUMENT_TYPES,
  drivingLicenceToFileOn,
  EMPLOYEE_EXPIRY_FIELDS,
  employeeDocumentKey,
  type EmployeeDocumentType,
} from '@/lib/compliance';
import { documentKind, matchDocuments, type DocumentMatch } from '@/lib/hr/document-match';
import { photoFromFile, receiptFromFile } from '@/lib/image';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { t, tp } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';

/** Scans for the personnel files, or the employees' photos. */
export type BulkKind = 'documents' | 'photos';

/** A file chosen in the dialog, with where it goes. */
interface Entry {
  key: string;
  match: DocumentMatch<File>;
  /** The employee it goes to: matched by number or name, or chosen by hand; null: not added. */
  employeeId: string | null;
  /**
   * Why it isn't added although it has an employee: the same file is already
   * in their personnel file (or on their licence), or another photo is
   * chosen for them.
   */
  skip: 'attached' | 'another_photo' | null;
}

const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;
const pairKey = (employeeId: string, name: string) => `${employeeId}|${name}`;

function FileIcon({ file }: { file: File }) {
  return documentKind(file) === 'image' ? (
    <ImageIcon className="size-4 shrink-0 text-slate-500" aria-hidden />
  ) : (
    <FileText className="size-4 shrink-0 text-red-600" aria-hidden />
  );
}

/**
 * "Add documents" and "Add photos" on the employees page: many files at
 * once, each matched to an employee by the number at the end of its name
 * ("… 424.pdf" goes to employee 000424) or by their whole name ("Ali
 * Hassan.jpg"). Files that don't match can be given an employee by hand;
 * files over 10 MB are refused, and so is anything but photos and PDF files
 * (photos only, for photos). Documents go to the personnel files, or,
 * when the company checks drivers' licences, to the employees' driving
 * licences in the register ("File as driving licence"); photos become the
 * employees' photos.
 */
export function BulkDocumentsDialog({
  kind = 'documents',
  employees,
  drivingLicences = false,
  onClose,
}: {
  kind?: BulkKind;
  employees: Employee[];
  /** The company checks drivers' licences (PeopleSettings.drivingLicences): scans may be filed as licences. */
  drivingLicences?: boolean;
  onClose: () => void;
}) {
  const company = useCompany();
  const photos = kind === 'photos';
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  /** Employee chosen by hand for a file, or '' to leave it out. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  /** Scans go to the employees' driving licences instead of their personnel files. */
  const [asLicence, setAsLicence] = useState(false);
  const licences = !photos && drivingLicences && asLicence;
  /** Each scan is the copy of this paper of its employee (#18); '' for none in particular. */
  const [asCopy, setAsCopy] = useState<EmployeeDocumentType | ''>('');
  const copyOf = !photos && !licences ? asCopy : '';
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const sorted = useMemo(
    () =>
      [...employees].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
    [employees],
  );

  /** Each file with the employee it goes to, before checking what's there already. */
  const targets = useMemo(
    () =>
      matchDocuments(files, employees, { photosOnly: photos }).map((match) => {
        const key = fileKey(match.file);
        const picked = chosen[key];
        const employeeId =
          match.status === 'refused'
            ? null
            : picked !== undefined
              ? picked || null
              : match.status === 'matched'
                ? match.employeeId
                : null;
        return { key, match, employeeId };
      }),
    [files, employees, chosen, photos],
  );

  // Files already in a personnel file (or on the licence they would be filed
  // on) under the same name: found through an index, without reading any
  // file's content.
  const pairs = useMemo(
    () =>
      photos
        ? []
        : targets.flatMap((x) => (x.employeeId ? [[x.employeeId, x.match.file.name]] : [])),
    [targets, photos],
  );
  const pairsKey = JSON.stringify(pairs);
  const attached = useLiveQuery(
    async () => {
      if (!pairs.length) return new Set<string>();
      // Filed as licences, a scan goes on the employee's current licence
      // (none yet: a new one, where nothing is attached).
      let ownerOf = (employeeId: string): string | undefined => employeeId;
      if (licences) {
        const ids = [...new Set(pairs.map(([id]) => id))];
        const docs = await db.complianceDocuments.where('employeeId').anyOf(ids).toArray();
        const licenceOf = new Map(ids.map((id) => [id, drivingLicenceToFileOn(docs, id)?.id]));
        ownerOf = (employeeId) => licenceOf.get(employeeId);
      }
      const lookups = pairs.flatMap(([id, name]) => {
        const owner = ownerOf(id);
        return owner ? [[owner, name]] : [];
      });
      if (!lookups.length) return new Set<string>();
      const keys = await db.attachments.where('[ownerId+name]').anyOf(lookups).keys();
      const found = new Set(keys.map((k) => pairKey(...(k as unknown as [string, string]))));
      return new Set(
        pairs
          .filter(([id, name]) => found.has(pairKey(ownerOf(id) ?? '', name)))
          .map(([id, name]) => pairKey(id, name)),
      );
    },
    [pairsKey, licences],
    null,
  );

  const entries: Entry[] = useMemo(() => {
    const photoFor = new Set<string>();
    return targets.map(({ key, match, employeeId }) => {
      let skip: Entry['skip'] = null;
      if (employeeId && photos) {
        if (photoFor.has(employeeId)) skip = 'another_photo';
        photoFor.add(employeeId);
      } else if (employeeId && attached?.has(pairKey(employeeId, match.file.name))) {
        skip = 'attached';
      }
      return { key, match, employeeId, skip };
    });
  }, [targets, attached, photos]);
  const ready = entries.filter((e) => e.employeeId && !e.skip);
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
        if (photos) {
          // A square of at most 512 px, as JPEG.
          await setEmployeePhoto(employeeId, {
            name: file.name,
            dataUrl: await photoFromFile(file),
          });
        } else {
          // Photos are made smaller (JPEG, 1600 px at most); PDF files are kept as they are.
          const { dataUrl, type } = await receiptFromFile(file);
          if (licences) await fileDrivingLicence(employeeId, { name: file.name, type, dataUrl });
          else if (copyOf) {
            // Valid until the paper's expiry on the employee's record.
            const employee = byId.get(employeeId);
            await addNewCopy(
              company.id,
              employeeId,
              { name: file.name, type, dataUrl },
              {
                docKey: employeeDocumentKey(employeeId, copyOf),
                validUntil: employee?.[EMPLOYEE_EXPIRY_FIELDS[copyOf]] ?? null,
              },
            );
          } else await addAttachment(company.id, employeeId, { name: file.name, type, dataUrl });
        }
        added += 1;
        people.add(employeeId);
      } catch {
        failed.push(file.name);
      }
      setProgress({ done: added + failed.length, total: work.length });
    }
    if (photos) await logEmployeePhotosAdded(company.id, added);
    else if (licences) await logDrivingLicencesFiled(company.id, added, people.size);
    else await logPersonnelFilesAdded(company.id, added, people.size);
    setProgress(null);
    if (added) {
      toast.success(
        photos
          ? tp(added, '{count} photo added', '{count} photos added')
          : licences
            ? tp(
                added,
                '{count} scan filed as a driving licence',
                '{count} scans filed as driving licences',
              )
            : tp(
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
      if (m.reason === 'size') return t('Larger than 10 MB, the most a file can be.');
      return photos ? t('Only photos can be added.') : t('Only photos and PDF files can be added.');
    }
    if (m.status !== 'unmatched') return '';
    if (m.reason === 'none') return t('No employee number or name in the file name.');
    if (m.reason === 'several') {
      return m.number
        ? t('More than one employee has the number {number}.', { number: m.number })
        : t('More than one employee has this name.');
    }
    return t('No employee has the number {number}.', { number: m.number ?? '' });
  };

  const note = (entry: Entry): string => {
    if (entry.skip === 'attached') {
      return licences
        ? t('Already on their driving licence')
        : t('Already in their personnel file');
    }
    if (entry.skip === 'another_photo') return t('Another photo is chosen for this employee');
    const employee = entry.employeeId ? byId.get(entry.employeeId) : undefined;
    return photos && employee?.photoId ? t('Replaces their current photo') : '';
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
        title={photos ? t('Add photos') : t('Add documents')}
        description={
          photos
            ? t(
                'Choose many photos at once. Each goes to the employee whose number ends its name, like “424.jpg” for employee 000424, or whose name it is.',
              )
            : t(
                'Choose many scans at once. Each goes to the employee whose number ends its name, like “Name 424.pdf” for employee 000424.',
              )
        }
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
              {photos
                ? t('Or drop them here. Photos up to 10 MB each.')
                : t('Or drop them here. Photos and PDF files up to 10 MB each.')}
            </span>
          </button>
          {photos || !drivingLicences ? null : (
            <Checkbox
              checked={asLicence}
              disabled={busy}
              onChange={(e) => setAsLicence(e.target.checked)}
              label={t('File as driving licence')}
              description={t(
                'Each scan goes to the employee’s driving licence in the register instead of their personnel file. Enter the expiry date on the licence afterwards.',
              )}
            />
          )}
          {photos || licences ? null : (
            <Field
              label={t('These files are each employee’s')}
              optional
              hint={t(
                'Marks each scan as the copy of that paper, valid until its expiry date on the employee’s record.',
              )}
            >
              {(id) => (
                <Select
                  id={id}
                  value={asCopy}
                  disabled={busy}
                  onChange={(e) => setAsCopy(e.target.value as EmployeeDocumentType | '')}
                >
                  <option value="">{t('Nothing in particular')}</option>
                  {(Object.keys(EMPLOYEE_EXPIRY_FIELDS) as EmployeeDocumentType[]).map((type) => (
                    <option key={type} value={type}>
                      {t(DOCUMENT_TYPES[type].label)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <input
            ref={input}
            type="file"
            multiple
            accept={photos ? 'image/*' : 'image/*,application/pdf'}
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
                          entry.skip ? 'text-slate-500' : 'text-emerald-700',
                        )}
                      >
                        <bdi>{employeeLabel(entry.employeeId ?? '')}</bdi>
                        {note(entry) ? ` · ${note(entry)}` : null}
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
                        <span className="block text-xs text-amber-700">
                          {entry.employeeId && note(entry) ? note(entry) : reason(entry)}
                        </span>
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
                aria-label={photos ? t('Adding photos') : t('Adding documents')}
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
            {photos
              ? tp(ready.length, 'Add {count} photo', 'Add {count} photos')
              : tp(ready.length, 'Add {count} file', 'Add {count} files')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
