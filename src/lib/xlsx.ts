import { t } from '@/i18n';

/**
 * Reads the first sheet of an Excel workbook (.xlsx) into rows of text, in
 * the browser and without a library: the ZIP archive is opened with
 * DecompressionStream and its XML read with DOMParser.
 *
 * Cells come out as the import screens read CSV files: dates as ISO dates
 * (yyyy-MM-dd), numbers as plain numbers ("1250.75", no thousands
 * separators), TRUE/FALSE, and text trimmed. Rows with nothing in them are
 * left out, so the first row is the header row.
 */

export class XlsxError extends Error {}

/** Parts bigger than this are refused (a 5 MB file never needs more). */
const MAX_PART_BYTES = 200 * 1024 * 1024;

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/** Whether the bytes are a ZIP archive (an .xlsx file is one). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

/** Whether the bytes are an old binary Office file (.xls), which this reader can't open. */
export function isOldExcel(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11;
}

function u64(view: DataView, at: number): number {
  return Number(view.getBigUint64(at, true));
}

/** The entries listed in the archive's central directory. */
function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  // The end record is 22 bytes plus a comment of up to 64 KB.
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (view.getUint32(at, true) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new XlsxError(t('This file is not a valid Excel workbook.'));
  let count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (
    (count === 0xffff || offset === 0xffffffff) &&
    end >= 20 &&
    view.getUint32(end - 20, true) === ZIP64_LOCATOR
  ) {
    const record = u64(view, end - 12);
    if (view.getUint32(record, true) === ZIP64_END) {
      count = u64(view, record + 32);
      offset = u64(view, record + 48);
    }
  }
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = offset;
  for (let i = 0; i < count && at + 46 <= bytes.length; i++) {
    if (view.getUint32(at, true) !== ZIP_CENTRAL) break;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const entry: ZipEntry = {
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    };
    // ZIP64: sizes and offsets that don't fit 32 bits are in an extra field.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (entry.size === 0xffffffff) {
          entry.size = u64(view, field);
          field += 8;
        }
        if (entry.compressedSize === 0xffffffff) {
          entry.compressedSize = u64(view, field);
          field += 8;
        }
        if (entry.offset === 0xffffffff) entry.offset = u64(view, field);
      }
      extra += 4 + length;
    }
    entries.set(entry.name.replace(/\\/g, '/').replace(/^\//, ''), entry);
    at = extraEnd + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new XlsxError(
      t('This browser can’t open Excel files. Save the file as CSV, or use a newer browser.'),
    );
  }
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      // A copy: the stream may take ownership of the bytes it is given.
      controller.enqueue(new Uint8Array(data));
      controller.close();
    },
  });
  const reader = input.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new XlsxError(t('This workbook is too large to import.'));
    }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

class Archive {
  private entries: Map<string, ZipEntry>;
  private lowerCase: Map<string, string>;

  constructor(private bytes: Uint8Array) {
    this.entries = zipEntries(bytes);
    this.lowerCase = new Map([...this.entries.keys()].map((name) => [name.toLowerCase(), name]));
  }

  has(path: string): boolean {
    return this.entries.has(path) || this.lowerCase.has(path.toLowerCase());
  }

  async text(path: string): Promise<string | null> {
    const entry =
      this.entries.get(path) ?? this.entries.get(this.lowerCase.get(path.toLowerCase()) ?? '');
    if (!entry) return null;
    if (entry.flags & 1) {
      throw new XlsxError(
        t('This workbook is protected with a password. Remove the password and try again.'),
      );
    }
    if (entry.size > MAX_PART_BYTES) {
      throw new XlsxError(t('This workbook is too large to import.'));
    }
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    if (view.getUint32(entry.offset, true) !== ZIP_LOCAL) {
      throw new XlsxError(t('This file is not a valid Excel workbook.'));
    }
    const start =
      entry.offset +
      30 +
      view.getUint16(entry.offset + 26, true) +
      view.getUint16(entry.offset + 28, true);
    const raw = this.bytes.subarray(start, start + entry.compressedSize);
    let data: Uint8Array;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8) data = await inflate(raw);
    else throw new XlsxError(t('This file is not a valid Excel workbook.'));
    return new TextDecoder().decode(data);
  }
}

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new XlsxError(t('This file is not a valid Excel workbook.'));
  }
  return doc;
}

/** Elements by local name, whatever the namespace prefix (strict or transitional OOXML). */
function byName(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', name));
}

function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === name);
}

/** The relationship id of a <sheet> (r:id in whichever namespace it is written). */
function relationId(element: Element): string | null {
  for (const attr of Array.from(element.attributes)) {
    if (attr.localName === 'id' && attr.namespaceURI) return attr.value;
  }
  return element.getAttribute('r:id');
}

/** Excel escapes some characters as _xHHHH_ (e.g. _x000D_ for a carriage return). */
function unescapeText(text: string): string {
  return text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** The text of a string item: plain <t>, or rich text runs, without phonetic guides. */
function stringItem(element: Element): string {
  let text = '';
  for (const child of Array.from(element.children)) {
    if (child.localName === 't') text += child.textContent ?? '';
    else if (child.localName === 'r') {
      for (const run of children(child, 't')) text += run.textContent ?? '';
    }
  }
  return unescapeText(text);
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

async function relationships(archive: Archive, partPath: string): Promise<Relationship[]> {
  const slash = partPath.lastIndexOf('/');
  const relsPath = `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
  const text = await archive.text(relsPath);
  if (!text) return [];
  return byName(parseXml(text), 'Relationship').map((r) => ({
    id: r.getAttribute('Id') ?? '',
    type: r.getAttribute('Type') ?? '',
    target: resolvePath(partPath, r.getAttribute('Target') ?? ''),
  }));
}

/* -------------------------------------------------------------------------- */
/* Numbers and dates                                                          */
/* -------------------------------------------------------------------------- */

/** Built-in number formats that show a date (time-only ones stay numbers). */
const BUILT_IN_DATES = new Set([
  14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58,
]);

/** Whether a number format shows a date: it has a day or year once quoted text is removed. */
export function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILT_IN_DATES.has(id)) return true;
  if (!code) return false;
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '');
  // Only the first section (positive numbers) decides.
  return /[dy]/i.test(bare.split(';')[0]);
}

const DAY_MS = 86_400_000;

/**
 * An Excel date serial as yyyy-MM-dd. Serial 1 is 1 January 1900 (Excel
 * counts a 29 February 1900 that never was), 0 and below fall before it
 * ("1899-12-30", "1899-12-29": how some exports write an empty date).
 */
export function serialToISODate(serial: number, date1904 = false): string {
  // To the nearest second: times are stored as fractions of a day.
  const days = Math.floor(Math.round(serial * 86_400) / 86_400);
  let ms: number;
  if (date1904) ms = Date.UTC(1904, 0, 1) + days * DAY_MS;
  else if (days >= 61 || days <= 0) ms = Date.UTC(1899, 11, 30) + days * DAY_MS;
  else ms = Date.UTC(1899, 11, 31) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A number as Excel shows it at most: 15 significant digits, no exponent for normal sizes. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value);
  return String(Number(value.toPrecision(15)));
}

/* -------------------------------------------------------------------------- */
/* Workbook                                                                   */
/* -------------------------------------------------------------------------- */

const OFFICE_DOCUMENT = /\/officeDocument$/;

function columnIndex(ref: string | null): number | null {
  const letters = /^([A-Z]+)\d*$/i.exec(ref ?? '')?.[1];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/** Reads the first sheet of a workbook: its name and its rows of text. */
export async function readXlsxSheet(data: ArrayBuffer | Uint8Array): Promise<XlsxSheet> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isZip(bytes)) throw new XlsxError(t('This file is not a valid Excel workbook.'));
  const archive = new Archive(bytes);

  const root = await relationships(archive, '');
  const workbookPath =
    root.find((r) => OFFICE_DOCUMENT.test(r.type))?.target ??
    (archive.has('xl/workbook.xml') ? 'xl/workbook.xml' : null);
  const workbookText = workbookPath ? await archive.text(workbookPath) : null;
  if (!workbookPath || !workbookText) {
    throw new XlsxError(t('This file is not a valid Excel workbook.'));
  }
  const workbook = parseXml(workbookText);
  const props = byName(workbook, 'workbookPr')[0];
  const date1904 = ['1', 'true'].includes(props?.getAttribute('date1904') ?? '');
  const sheets = byName(workbook, 'sheet');
  const sheet =
    sheets.find((s) => !/hidden/i.test(s.getAttribute('state') ?? '')) ?? sheets[0] ?? null;
  if (!sheet) throw new XlsxError(t('This workbook has no sheets.'));

  const rels = await relationships(archive, workbookPath);
  const sheetId = relationId(sheet);
  const sheetPath =
    rels.find((r) => r.id === sheetId)?.target ??
    resolvePath(workbookPath, `worksheets/sheet${sheets.indexOf(sheet) + 1}.xml`);
  const partOf = (type: string, fallback: string) =>
    rels.find((r) => r.type.endsWith(`/${type}`))?.target ?? resolvePath(workbookPath, fallback);

  // Shared strings.
  const strings: string[] = [];
  const sharedText = await archive.text(partOf('sharedStrings', 'sharedStrings.xml'));
  if (sharedText) {
    for (const si of byName(parseXml(sharedText), 'si')) strings.push(stringItem(si));
  }

  // Which cell styles show dates.
  const dateStyles = new Set<number>();
  const stylesText = await archive.text(partOf('styles', 'styles.xml'));
  if (stylesText) {
    const styles = parseXml(stylesText);
    const formats = new Map<number, string>();
    for (const f of byName(styles, 'numFmt')) {
      formats.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '');
    }
    const cellXfs = byName(styles, 'cellXfs')[0];
    if (cellXfs) {
      children(cellXfs, 'xf').forEach((xf, index) => {
        const id = Number(xf.getAttribute('numFmtId') ?? 0);
        if (isDateFormat(id, formats.get(id))) dateStyles.add(index);
      });
    }
  }

  const sheetText = await archive.text(sheetPath);
  if (sheetText === null) throw new XlsxError(t('This workbook has no sheets.'));
  const rows: string[][] = [];
  for (const row of byName(parseXml(sheetText), 'row')) {
    const values: string[] = [];
    let next = 0;
    for (const cell of children(row, 'c')) {
      const column = columnIndex(cell.getAttribute('r')) ?? next;
      next = column + 1;
      const type = cell.getAttribute('t') ?? 'n';
      const v = children(cell, 'v')[0]?.textContent ?? '';
      let value = '';
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') {
        const is = children(cell, 'is')[0];
        value = is ? stringItem(is) : '';
      } else if (type === 'str') value = unescapeText(v);
      else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else if (type === 'e') value = '';
      else if (type === 'd') value = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
      else if (v !== '') {
        const number = Number(v);
        if (!Number.isFinite(number)) value = v;
        else if (dateStyles.has(Number(cell.getAttribute('s') ?? 0))) {
          value = serialToISODate(number, date1904);
        } else value = formatNumber(number);
      }
      while (values.length < column) values.push('');
      values[column] = value.trim();
    }
    if (values.some((v) => v !== '')) rows.push(values);
  }
  return { name: sheet.getAttribute('name') ?? '', rows };
}

/** The rows of the first sheet of a workbook (see `readXlsxSheet`). */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  return (await readXlsxSheet(data)).rows;
}
