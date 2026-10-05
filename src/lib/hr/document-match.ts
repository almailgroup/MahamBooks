import { normalizeDigits } from '@/lib/money';

/**
 * Many scans or photos at once for the employees: each file goes to the
 * employee whose number is in its name ("… 424.pdf" → employee 000424,
 * numbers compared without leading zeros), or, without a number, whose
 * whole name it is ("Ali Hassan.jpg"). Only photos and PDF files up to the
 * cloud storage limit are taken.
 */

/** The cloud storage limit for one file. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface DocumentFile {
  name: string;
  size: number;
  /** The browser's media type; may be empty, then the extension decides. */
  type: string;
}

export interface EmployeeKey {
  id: string;
  number: string;
  name?: string;
  nameAr?: string;
}

export type DocumentMatch<F extends DocumentFile> =
  | { file: F; status: 'matched'; employeeId: string; number: string | null }
  | {
      file: F;
      status: 'unmatched';
      /**
       * none: no number in the file name and no employee of that name;
       * unknown: nobody has the number; several: more than one employee has
       * the number (or the name, when number is null).
       */
      reason: 'none' | 'unknown' | 'several';
      number: string | null;
    }
  | { file: F; status: 'refused'; reason: 'size' | 'type' };

export interface MatchOptions {
  /** Only photos are taken (an employee's photo), not PDF files. */
  photosOnly?: boolean;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;

/** A photo or a PDF (by media type, or by extension when the browser gives none). */
export function documentKind(file: DocumentFile): 'pdf' | 'image' | null {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type) return null;
  if (/\.pdf$/i.test(file.name)) return 'pdf';
  if (IMAGE_EXTENSIONS.test(file.name)) return 'image';
  return null;
}

/** Digits of a number without the leading zeros ("000424" → "424"); empty without digits. */
export function numberKey(number: string): string {
  const digits = normalizeDigits(number).replace(/\D/g, '');
  return digits ? digits.replace(/^0+(?=\d)/, '') : '';
}

/**
 * The employee number in a file name: the number at its end ("محمد علي
 * 424.pdf", "Ali_0424.pdf", "Ali 424 (2).pdf"), or else its only number
 * ("EMP424 passport.pdf"). Dates and times are not taken for numbers.
 */
export function numberInFileName(name: string): string | null {
  const base = baseName(name);
  const end = /(?:^|[\s_-])(\d+)[\s_-]*$/.exec(base);
  if (end) return end[1];
  const runs = base.match(/\d+/g) ?? [];
  return runs.length === 1 ? runs[0] : null;
}

/** A file name without its extension and the marks of copies ("name (2)", "name - Copy"). */
function baseName(name: string): string {
  return (
    normalizeDigits(name)
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      // Copies the system made: "name (2)", "name - Copy", "name copy".
      .replace(/(\s*\(\d+\)|\s*-?\s*copy)+$/i, '')
      .trim()
  );
}

/** A name compared without case, punctuation, Arabic letter variants or diacritics. */
export function nameKey(name: string): string {
  return normalizeDigits(name)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function addTo(map: Map<string, EmployeeKey[]>, key: string, employee: EmployeeKey) {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.includes(employee)) map.set(key, [...list, employee]);
}

/** Matches each file to an employee, or says why it isn't matched or taken. */
export function matchDocuments<F extends DocumentFile>(
  files: F[],
  employees: EmployeeKey[],
  options: MatchOptions = {},
): DocumentMatch<F>[] {
  const byNumber = new Map<string, EmployeeKey[]>();
  const byName = new Map<string, EmployeeKey[]>();
  for (const e of employees) {
    addTo(byNumber, numberKey(e.number), e);
    addTo(byName, nameKey(e.name ?? ''), e);
    addTo(byName, nameKey(e.nameAr ?? ''), e);
  }
  return files.map((file): DocumentMatch<F> => {
    const kind = documentKind(file);
    if (!kind || (options.photosOnly && kind !== 'image')) {
      return { file, status: 'refused', reason: 'type' };
    }
    if (file.size > MAX_DOCUMENT_BYTES) return { file, status: 'refused', reason: 'size' };
    const number = numberInFileName(file.name);
    if (!number) {
      const named = byName.get(nameKey(baseName(file.name))) ?? [];
      if (named.length === 1) {
        return { file, status: 'matched', employeeId: named[0].id, number: null };
      }
      return { file, status: 'unmatched', reason: named.length ? 'several' : 'none', number: null };
    }
    const found = byNumber.get(numberKey(number)) ?? [];
    if (found.length === 1) {
      return { file, status: 'matched', employeeId: found[0].id, number };
    }
    return { file, status: 'unmatched', reason: found.length ? 'several' : 'unknown', number };
  });
}
