import { crc32 } from '../apps/books/features/reports/zip';

/**
 * Builds small Excel workbooks (.xlsx) for tests: the same parts Excel and
 * Zoho People write (inline or shared strings, dates as serial numbers with
 * a date format). Only made-up data goes in. Imports are relative so the
 * end-to-end tests can use it too.
 */

export type Cell = string | number | boolean | { date: string } | null | undefined;

export interface WorkbookOptions {
  sheetName?: string;
  /** Strings in sharedStrings.xml, as Excel writes them (default: inline, as Zoho does). */
  sharedStrings?: boolean;
  /** Compresses the parts (deflate-raw), e.g. with Node's zlib.deflateRawSync. */
  deflate?: (data: Uint8Array) => Uint8Array;
  /** A hidden sheet first, which readers must pass over. */
  hiddenFirstSheet?: boolean;
  date1904?: boolean;
}

const DAY = 86_400_000;

/** The Excel serial of a date (1900 system; 1899-12-29 gives -1, as Zoho writes empty dates). */
export function excelSerial(iso: string, date1904 = false): number {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (date1904) return Math.round((ms - Date.UTC(1904, 0, 1)) / DAY);
  const days = Math.round((ms - Date.UTC(1899, 11, 30)) / DAY);
  // Excel counts 29 February 1900, so dates before March 1900 are one less.
  return days < 61 && days > 0 ? days - 1 : days;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

interface Part {
  name: string;
  data: Uint8Array;
}

/** A ZIP archive, stored or deflated. */
function zip(parts: Part[], deflate?: (data: Uint8Array) => Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.name);
    const body = deflate ? deflate(part.data) : part.data;
    const method = deflate ? 8 : 0;
    const crc = crc32(part.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, part.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, part.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    chunks.push(local, body);
    central.push(entry);
    offset += local.length + body.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + end.length);
  let at = 0;
  for (const chunk of [...chunks, ...central, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** An .xlsx file whose first visible sheet holds the rows (the first row: column names). */
export function buildWorkbook(rows: Cell[][], options: WorkbookOptions = {}): Uint8Array {
  const encoder = new TextEncoder();
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const cell = (value: Cell, ref: string): string => {
    if (value === null || value === undefined || value === '') return `<c r="${ref}"/>`;
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
    if (typeof value === 'object') {
      return `<c r="${ref}" s="2" t="n"><v>${excelSerial(value.date, options.date1904)}.0</v></c>`;
    }
    if (options.sharedStrings) {
      let index = sharedIndex.get(value);
      if (index === undefined) {
        index = shared.length;
        shared.push(value);
        sharedIndex.set(value, index);
      }
      return `<c r="${ref}" t="s"><v>${index}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  };
  const sheetRows = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row.map((v, c) => cell(v, `${columnName(c)}${r + 1}`)).join('')}</row>`,
    )
    .join('\n');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${sheetRows}
</sheetData></worksheet>`;
  const hidden = options.hiddenFirstSheet;
  const sheets = [
    ...(hidden ? ['<sheet name="Notes" sheetId="2" state="hidden" r:id="rId9"/>'] : []),
    `<sheet name="${escapeXml(options.sheetName ?? 'Sheet - 1')}" sheetId="1" r:id="rId3"/>`,
  ];
  const parts: Part[] = [
    {
      name: '[Content_Types].xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${options.date1904 ? 'true' : 'false'}"/><sheets>${sheets.join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="sharedStrings.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"/><Relationship Id="rId2" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/><Relationship Id="rId3" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>${hidden ? '<Relationship Id="rId9" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>' : ''}</Relationships>`,
      ),
    },
    {
      name: 'xl/sharedStrings.xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('')}</sst>`,
      ),
    },
    {
      name: 'xl/styles.xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd-MMM-yyyy hh:mm:ss AM/PM"/><numFmt numFmtId="165" formatCode="dd-MMM-yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="true"/><xf numFmtId="165" applyNumberFormat="true"/></cellXfs></styleSheet>',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet) },
  ];
  if (hidden) {
    parts.push({
      name: 'xl/worksheets/sheet2.xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hidden</t></is></c></row></sheetData></worksheet>',
      ),
    });
  }
  return zip(parts, options.deflate);
}

/* -------------------------------------------------------------------------- */
/* A made-up Zoho People export                                               */
/* -------------------------------------------------------------------------- */

/** The columns of Zoho People's "Employee View" export. */
export const ZOHO_HEADERS = [
  'ZOHO_LINK_ID',
  'Employee ID',
  'First Name',
  'Photo',
  'Department',
  'Designation',
  'Date of Joining',
  'Current Experience',
  'Date of Birth',
  'Age',
  'Gender',
  'Citizenship',
  'Blood Group',
  'Passport',
  'Passport Expiry',
  'Bank Account Number',
  'Personal Mobile Number',
  'Civil ID',
  'Civil ID Expiry',
  'Driving License Expiry',
  'Document Expiry',
  'Docs',
  'Location 2',
];

const CIVIL_ID_WEIGHTS = [2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];

/** A made-up Civil ID with a correct check digit, for someone born on `birth`. */
export function fakeCivilId(birth: string, serial: number): string {
  const [y, m, d] = birth.split('-');
  for (let s = serial; ; s++) {
    const body = `${y.startsWith('19') ? 2 : 3}${y.slice(2)}${m}${d}${String(s % 10_000).padStart(4, '0')}`;
    const sum = CIVIL_ID_WEIGHTS.reduce((acc, w, i) => acc + w * Number(body[i]), 0);
    const check = 11 - (sum % 11);
    if (check < 10) return `${body}${check}`;
  }
}

/** A made-up 16-digit card number with a correct Luhn check digit. */
export function fakeCardNumber(prefix: string, serial: number): string {
  const body = `${prefix}${String(serial).padStart(15 - prefix.length, '0')}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let digit = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

interface FakeEmployee {
  id: string;
  name: string;
  department?: string;
  job?: string;
  joined?: string | null;
  born?: string;
  gender?: string;
  country?: string;
  blood?: string;
  passport?: string;
  passportExpiry?: string;
  account?: string;
  mobile?: string;
  civilId?: string;
  civilIdExpiry?: string;
  licenceExpiry?: string;
  documentExpiry?: string;
  docs?: string;
}

/** A row of a Zoho People export for a made-up employee. */
export function zohoRow(e: FakeEmployee, index: number): Cell[] {
  const date = (iso: string | null | undefined) => (iso ? { date: iso } : null);
  return [
    `40000000000000${String(index).padStart(4, '0')}`,
    e.id,
    e.name,
    `viewPhoto?filename=${index}`,
    e.department ?? 'Guarding Services',
    e.job ?? 'Security Guard',
    date(e.joined === undefined ? '2022-01-10' : e.joined),
    '2 Year(s) 3 Month(s)',
    date(e.born ?? '1990-05-01'),
    '36 Year(s)',
    e.gender ?? 'Male',
    e.country ?? 'NEPAL',
    e.blood ?? '',
    e.passport ?? '',
    date(e.passportExpiry),
    e.account ?? '',
    e.mobile ?? '',
    e.civilId ?? '',
    date(e.civilIdExpiry),
    date(e.licenceExpiry),
    date(e.documentExpiry),
    e.docs ?? '',
    '',
  ];
}

/**
 * A made-up Zoho export with the cases the real ones have: names in capitals
 * with double spaces, Arabic names in the document file names, salary card
 * numbers, phones with country codes, Excel's empty date (1899-12-29), a
 * Civil ID with a wrong check digit, an unknown nationality, a joining date
 * in the future and expired papers. "Today" is 2026-10-05 in these tests.
 */
export function zohoEmployees(): FakeEmployee[] {
  return [
    {
      id: '000101',
      name: 'TEST  GUARD  ONE',
      born: '1990-05-01',
      country: 'EGYPT',
      blood: 'A +ve',
      passport: 'a1234567x',
      passportExpiry: '2030-01-01',
      account: fakeCardNumber('5407', 101),
      mobile: '965-55123456',
      civilId: fakeCivilId('1990-05-01', 101),
      civilIdExpiry: '2027-01-15',
      licenceExpiry: '2027-06-30',
      documentExpiry: '2027-01-15',
      docs: 'موظف تجريبي  واحد 101.pdf',
    },
    {
      id: '000102',
      name: 'Sample Cleaner Two ',
      department: 'Head Office',
      job: 'Cleaner',
      joined: '2021-07-01',
      born: '1899-12-29',
      gender: 'Female',
      country: 'NEPAL',
      passport: 'PA1234567',
      passportExpiry: '1899-12-29',
      mobile: '977-9812345678',
      civilId: fakeCivilId('1995-02-03', 102),
      civilIdExpiry: '2026-09-01',
      documentExpiry: '2026-10-20',
      docs: 'موظفة تجريبية اثنان   102.pdf',
    },
    {
      id: '000103',
      name: 'TEST DRIVER THREE',
      department: 'Security Systems',
      job: 'Bus Driver',
      joined: '2027-02-01',
      country: 'INDIA',
      mobile: '235-66123456',
      // A wrong check digit.
      civilId: `${fakeCivilId('1988-11-12', 103).slice(0, 11)}${(Number(fakeCivilId('1988-11-12', 103)[11]) + 1) % 10}`,
      civilIdExpiry: '2026-11-15',
      licenceExpiry: '2026-11-01',
      documentExpiry: '2026-11-15',
      // The file name has employee 101's number.
      docs: 'موظف تجريبي ثلاثة 101.pdf',
    },
    {
      id: '000104',
      name: 'Kuwaiti Staff Four',
      department: 'Head Office',
      job: 'Accountant',
      country: 'KUWAIT',
      account: 'KW81CBKU0000000000001234560101',
      mobile: '965-99887766',
      civilId: fakeCivilId('1985-03-14', 104),
      civilIdExpiry: '2029-03-01',
      documentExpiry: '2029-03-01',
    },
    // Nothing to tell who it is: skipped.
    { id: '', name: '', country: '', gender: '', job: '', joined: null, born: '1899-12-29' },
    {
      id: '106',
      name: '',
      job: 'Mandoop',
      country: 'BANGLADESH',
      docs: 'موظف تجريبي ستة 106.pdf',
    },
    {
      id: '000107',
      name: 'Unknown Land Seven',
      job: '',
      joined: null,
      country: 'ATLANTIS',
    },
    { id: '000101', name: 'Duplicate Number Eight', country: 'Filipino' },
  ];
}

/** The made-up Zoho export as an .xlsx file. */
export function zohoWorkbook(
  employees = zohoEmployees(),
  options: WorkbookOptions = {},
): Uint8Array {
  return buildWorkbook([ZOHO_HEADERS, ...employees.map(zohoRow)], options);
}
