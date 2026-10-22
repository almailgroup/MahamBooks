import { useState } from 'react';
import { toast } from 'sonner';
import { markNewCopy } from '@/db/renewals';
import type { Attachment, ISODate } from '@/db/types';
import { useFormat } from '@/app/company';
import type { RegisterEntry } from '@/lib/compliance';
import { entryTitle } from '@/features/renewals/display';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, Select } from '@/components/ui/form';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlay';
import { t } from '@/i18n';

/** What a file of the personnel file is a copy of, in words: "Residency, valid until …". */
export function copyTagLabel(
  file: Pick<Attachment, 'docKey' | 'validUntil'>,
  entries: readonly RegisterEntry[],
  date: (value: ISODate) => string,
): string {
  if (!file.docKey) return '';
  const entry = entries.find((e) => e.key === file.docKey);
  if (!entry) return '';
  return file.validUntil
    ? t('{document}, valid until {date}', {
        document: entryTitle(entry),
        date: date(file.validUntil),
      })
    : entryTitle(entry);
}

/**
 * "This file is the…" (#18): marks a file of the personnel file as the copy
 * of one of the employee's papers, valid until a date (the paper's expiry
 * at first), so a renewed paper's new copy is found; or as nothing in
 * particular.
 */
export function CopyTagDialog({
  file,
  entries,
  onClose,
}: {
  file: Attachment;
  /** The employee's papers it may be a copy of. */
  entries: readonly RegisterEntry[];
  onClose: () => void;
}) {
  const fmt = useFormat();
  const [key, setKey] = useState(file.docKey ?? '');
  const entry = entries.find((e) => e.key === key);
  const [validUntil, setValidUntil] = useState<ISODate | null>(
    file.validUntil ?? entry?.expiryDate ?? null,
  );
  const [saving, setSaving] = useState(false);

  const choose = (next: string) => {
    setKey(next);
    const chosen = entries.find((e) => e.key === next);
    if (chosen && next !== file.docKey) setValidUntil(chosen.expiryDate);
  };

  const save = async () => {
    setSaving(true);
    try {
      await markNewCopy(file.id, key ? { docKey: key, validUntil: validUntil || null } : null);
      toast.success(t('File saved'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the file.'));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('This file is the…')}
        description={t(
          'Mark a scan as the copy of one of the employee’s papers. A renewed paper is no longer “New copy missing” once a file valid until its new expiry is marked as it.',
        )}
      >
        <DialogBody>
          <p className="truncate text-sm font-medium text-slate-900" dir="auto">
            {file.name}
          </p>
          <Field label={t('Copy of')}>
            {(id) => (
              <Select id={id} value={key} onChange={(e) => choose(e.target.value)}>
                <option value="">{t('Nothing in particular')}</option>
                {entries.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.expiryDate
                      ? t('{document}, expires {date}', {
                          document: entryTitle(e),
                          date: fmt.date(e.expiryDate),
                        })
                      : entryTitle(e)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {key ? (
            <Field label={t('Valid until')} hint={t('The expiry date printed on the paper.')}>
              {(id) => <DateField id={id} value={validUntil} onChange={setValidUntil} />}
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
