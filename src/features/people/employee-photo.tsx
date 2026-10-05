import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/db/db';
import { removeEmployeePhoto, setEmployeePhoto } from '@/db/people';
import type { Employee } from '@/db/types';
import { photoFromFile } from '@/lib/image';
import { cn } from '@/lib/cn';
import { localName } from '@/i18n/names';
import { t } from '@/i18n';
import {
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  useConfirm,
} from '@/components/ui/overlay';

const SIZES = {
  sm: 'size-9 text-xs',
  /** The employees list: big enough to tell people apart. */
  md: 'size-12 text-sm sm:size-14 sm:text-base',
  /** The employee's page. */
  lg: 'size-24 text-2xl',
} as const;

/** First letters of the first and last words of a name ("Ali Hassan" → "AH"). */
export function nameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((w) => (w ? ([...w][0]?.toUpperCase() ?? '') : ''))
    .filter(Boolean);
  // A non-joiner keeps Arabic letters apart, as initials.
  const joiner = letters.some((l) => /[\u0600-\u06FF]/.test(l)) ? '\u200c' : '';
  return letters.join(joiner) || '?';
}

/** An employee's photo, or their initials when they have none. */
export function EmployeeAvatar({
  employee,
  photo,
  size = 'sm',
  className,
}: {
  employee: Pick<Employee, 'name' | 'nameAr'>;
  /** The photo as a data URL. */
  photo?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          'shrink-0 rounded-full bg-slate-100 object-cover ring-1 ring-slate-900/5',
          SIZES[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'bg-primary-100 text-primary-800 flex shrink-0 items-center justify-center rounded-full font-semibold',
        SIZES[size],
        className,
      )}
    >
      {nameInitials(localName(employee))}
    </span>
  );
}

const NO_PHOTOS = new Map<string, string>();

/**
 * The photos of these employees, by photo id. Only the photos are read, not
 * the rest of the personnel files. Photos still in the cloud come in after
 * the next sync.
 */
export function useEmployeePhotos(employees: Employee[] | undefined): Map<string, string> {
  const ids = useMemo(
    () => (employees ?? []).flatMap((e) => (e.photoId ? [e.photoId] : [])),
    [employees],
  );
  const key = ids.join(',');
  const photos = useLiveQuery(async () => {
    if (!ids.length) return NO_PHOTOS;
    const list = await db.attachments.bulkGet(ids);
    return new Map(list.flatMap((a) => (a?.dataUrl ? [[a.id, a.dataUrl] as const] : [])));
  }, [key]);
  return photos ?? NO_PHOTOS;
}

/** The photo on an employee's page: click to add or change it, or remove it. */
export function EmployeePhotoEditor({ employee }: { employee: Employee }) {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const photos = useEmployeePhotos(useMemo(() => [employee], [employee]));
  const photo = employee.photoId ? photos.get(employee.photoId) : undefined;
  const name = localName(employee);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await setEmployeePhoto(employee.id, { name: file.name, dataUrl: await photoFromFile(file) });
      toast.success(t('Photo saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Could not save the photo.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('Remove the photo of {name}?', { name }),
      confirmLabel: t('Remove'),
      danger: true,
    });
    if (!ok) return;
    await removeEmployeePhoto(employee.id);
    toast.success(t('Photo removed'));
  };

  const avatar = (
    <span className="relative block">
      <EmployeeAvatar
        employee={employee}
        photo={photo}
        size="lg"
        className={busy ? 'opacity-60' : undefined}
      />
      <span className="bg-surface absolute end-0 bottom-0 flex size-7 items-center justify-center rounded-full text-slate-600 shadow ring-1 ring-slate-900/10">
        <Camera className="size-3.5" aria-hidden />
      </span>
    </span>
  );
  const ring =
    'focus-visible:ring-primary-500 block shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait';

  return (
    <>
      {employee.photoId ? (
        <DropdownMenu>
          <DropdownTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className={ring}
              aria-label={t('Photo of {name}', { name })}
            >
              {avatar}
            </button>
          </DropdownTrigger>
          <DropdownContent align="start">
            <DropdownItem icon={<ImagePlus />} onSelect={() => input.current?.click()}>
              {t('Change photo')}
            </DropdownItem>
            <DropdownItem icon={<Trash2 />} danger onSelect={() => void remove()}>
              {t('Remove photo')}
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      ) : (
        <button
          type="button"
          disabled={busy}
          className={ring}
          aria-label={t('Add a photo of {name}', { name })}
          onClick={() => input.current?.click()}
        >
          {avatar}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('Choose a photo')}
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
