import { normalizeDigits } from '@/lib/money';
import { parseCsvRows } from '@/lib/banking/statement';
import { msg, t } from '@/i18n';

/**
 * What a CSV import can bring in, the columns each kind understands and how
 * a file's own column names are matched to them (English or Arabic, any
 * case, with or without spaces and punctuation).
 */

export type ImportKind = 'contacts' | 'products' | 'opening' | 'documents' | 'employees';

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  /** Other names the column goes by in exports and spreadsheets. */
  aliases: string[];
  /** Names too general to look for inside another column's name: they match only as they are. */
  exact?: string[];
}

const col = (
  key: string,
  label: string,
  aliases: string[],
  required = false,
  exact: string[] = [],
): ImportColumn => ({ key, label, aliases, required, ...(exact.length ? { exact } : {}) });

/** Names of a column with the annual leave days an employee has left. */
export const LEAVE_BALANCE_ALIASES = [
  'leave balance',
  'annual leave balance',
  'leave balance days',
  'vacation balance',
  'leave brought forward',
  'رصيد الإجازات',
  'رصيد الإجازة',
  'رصيد الإجازات السنوية',
  'رصيد الإجازة السنوية',
];

/**
 * Leave balance column names that match only as they are: "Balance" could be
 * anything's, and "Leave days taken" is not what is left.
 */
export const LEAVE_BALANCE_EXACT = [
  'balance',
  'الرصيد',
  'leave days',
  'annual leave days',
  'أيام الإجازة',
];

export const IMPORT_COLUMNS: Record<ImportKind, ImportColumn[]> = {
  contacts: [
    col('type', msg('Type'), ['type', 'contact type', 'customer or vendor', 'النوع']),
    col(
      'name',
      msg('Name'),
      [
        'name',
        'customer name',
        'client name',
        'vendor name',
        'supplier name',
        'company name',
        'display name',
        'business name',
        'english name',
        'name english',
        'name en',
        'الاسم',
        'اسم العميل',
        'اسم المورد',
        'اسم الشركة',
        'الاسم بالانجليزيه',
      ],
      true,
    ),
    col('nameAr', msg('Arabic name'), [
      'arabic name',
      'name arabic',
      'name ar',
      'namear',
      'الاسم بالعربيه',
      'الاسم العربي',
    ]),
    col('contactPerson', msg('Contact person'), [
      'contact person',
      'contact name',
      'contact',
      'attention',
      'الشخص المسؤول',
      'اسم المسؤول',
    ]),
    col('email', msg('Email'), [
      'email',
      'e mail',
      'email address',
      'البريد الالكتروني',
      'البريد',
      'الايميل',
    ]),
    col('phone', msg('Phone'), [
      'phone',
      'telephone',
      'tel',
      'mobile',
      'phone number',
      'mobile number',
      'الهاتف',
      'رقم الهاتف',
      'النقال',
      'الجوال',
      'الموبايل',
    ]),
    col('civilId', msg('Civil ID'), [
      'civil id',
      'civil id number',
      'civilid',
      'الرقم المدني',
      'البطاقه المدنيه',
    ]),
    col('crNumber', msg('CR No.'), [
      'cr',
      'cr no',
      'cr number',
      'commercial registration',
      'commercial registration number',
      'السجل التجاري',
      'رقم السجل التجاري',
    ]),
    col('taxId', msg('Tax number'), ['tax number', 'tax id', 'vat number', 'trn', 'الرقم الضريبي']),
    col('governorate', msg('Governorate'), [
      'governorate',
      'state',
      'region',
      'province',
      'المحافظه',
    ]),
    col('area', msg('Area'), ['area', 'city', 'town', 'district', 'المنطقه', 'المدينه']),
    col('block', msg('Block'), ['block', 'قطعه', 'القطعه']),
    col('street', msg('Street'), ['street', 'شارع', 'الشارع']),
    col('avenue', msg('Avenue'), ['avenue', 'jadda', 'jaddah', 'جاده', 'الجاده']),
    col('building', msg('Building'), [
      'building',
      'house',
      'building number',
      'مبني',
      'المبني',
      'المنزل',
    ]),
    col('floor', msg('Floor'), ['floor', 'الدور', 'الطابق']),
    col('unit', msg('Office / flat'), [
      'office',
      'flat',
      'unit',
      'apartment',
      'office flat',
      'المكتب',
      'الشقه',
      'المكتب الشقه',
    ]),
    col('paci', msg('PACI number'), [
      'paci',
      'paci number',
      'paci no',
      'الرقم الالي',
      'الرقم الالي للعنوان',
    ]),
    col('line1', msg('Address'), ['address', 'address line 1', 'street address', 'العنوان']),
    col('postalCode', msg('Postal code'), [
      'postal code',
      'post code',
      'postcode',
      'zip',
      'zip code',
      'الرمز البريدي',
    ]),
    col('country', msg('Country'), ['country', 'country code', 'الدوله', 'البلد']),
    col('paymentTerms', msg('Payment terms (days)'), [
      'payment terms',
      'terms',
      'credit days',
      'شروط الدفع',
      'مده السداد',
    ]),
    col('openingBalance', msg('Opening balance'), [
      'opening balance',
      'balance',
      'balance due',
      'outstanding',
      'الرصيد الافتتاحي',
      'الرصيد',
    ]),
    col('notes', msg('Notes'), ['notes', 'note', 'remarks', 'comments', 'ملاحظات']),
  ],
  products: [
    col(
      'name',
      msg('Name'),
      [
        'name',
        'item name',
        'product name',
        'service name',
        'item',
        'product',
        'الاسم',
        'اسم الصنف',
        'اسم المنتج',
        'الصنف',
        'المنتج',
      ],
      true,
    ),
    col('nameAr', msg('Arabic name'), [
      'arabic name',
      'name arabic',
      'name ar',
      'الاسم بالعربيه',
      'الاسم العربي',
    ]),
    col('sku', msg('SKU'), [
      'sku',
      'code',
      'item code',
      'product code',
      'رمز الصنف',
      'الكود',
      'الرمز',
      'رقم الصنف',
    ]),
    col('unit', msg('Unit'), ['unit', 'uom', 'unit of measure', 'الوحده']),
    col('price', msg('Unit price'), [
      'price',
      'rate',
      'unit price',
      'selling price',
      'sales price',
      'سعر الوحده',
      'السعر',
      'سعر البيع',
    ]),
    col('description', msg('Description'), ['description', 'details', 'الوصف']),
    col('descriptionAr', msg('Arabic description'), [
      'arabic description',
      'description arabic',
      'الوصف بالعربيه',
    ]),
    // Stock: nothing posts unless the quantity column is matched (see STOCK_COLUMNS).
    col('type', msg('Item type'), ['item type', 'product type', 'نوع الصنف', 'نوع المنتج'], false, [
      'type',
      'kind',
      'النوع',
    ]),
    col('cost', msg('Cost price'), [
      'cost price',
      'unit cost',
      'cost',
      'purchase price',
      'purchase cost',
      'buying price',
      'average cost',
      'سعر التكلفه',
      'التكلفه',
      'سعر الشراء',
    ]),
    col(
      'quantity',
      msg('Quantity'),
      [
        'quantity',
        'opening stock',
        'opening quantity',
        'stock on hand',
        'quantity on hand',
        'qty on hand',
        'الكميه',
        'الكميه المتوفره',
        'المخزون الافتتاحي',
        'الكميه الافتتاحيه',
      ],
      false,
      // "Stock value" and "قيمة المخزون" are not quantities.
      ['qty', 'stock', 'المخزون'],
    ),
    col('warehouse', msg('Warehouse'), [
      'warehouse',
      'warehouse name',
      'store',
      'location',
      'المستودع',
      'المخزن',
      'اسم المستودع',
    ]),
    col('reorderLevel', msg('Reorder level'), [
      'reorder level',
      'reorder point',
      'minimum stock',
      'min stock',
      'حد اعاده الطلب',
      'الحد الادني',
    ]),
    col('barcode', msg('Barcode'), [
      'barcode',
      'bar code',
      'ean',
      'upc',
      'gtin',
      'الباركود',
      'باركود',
      'الرمز الشريطي',
    ]),
  ],
  opening: [
    col('code', msg('Account code'), [
      'account code',
      'code',
      'account number',
      'account no',
      'رمز الحساب',
      'رقم الحساب',
    ]),
    col('account', msg('Account name'), [
      'account name',
      'account',
      'name',
      'اسم الحساب',
      'الحساب',
    ]),
    col('debit', msg('Debit'), ['debit', 'dr', 'مدين']),
    col('credit', msg('Credit'), ['credit', 'cr', 'دائن']),
    col('balance', msg('Balance'), ['balance', 'amount', 'net', 'الرصيد', 'المبلغ']),
  ],
  documents: [
    col(
      'number',
      msg('Number'),
      [
        'number',
        'invoice number',
        'bill number',
        'invoice no',
        'bill no',
        'no',
        'رقم الفاتوره',
        'الرقم',
      ],
      true,
    ),
    col(
      'contact',
      msg('Customer or vendor'),
      [
        'customer',
        'vendor',
        'supplier',
        'client',
        'customer name',
        'vendor name',
        'supplier name',
        'client name',
        'name',
        'العميل',
        'المورد',
        'اسم العميل',
        'اسم المورد',
      ],
      true,
    ),
    col(
      'date',
      msg('Date'),
      ['date', 'invoice date', 'bill date', 'issue date', 'التاريخ', 'تاريخ الفاتوره'],
      true,
    ),
    col('dueDate', msg('Due date'), ['due date', 'due', 'تاريخ الاستحقاق']),
    col(
      'amount',
      msg('Amount due'),
      [
        'amount due',
        'balance due',
        'balance',
        'amount',
        'outstanding',
        'total',
        'المبلغ المستحق',
        'الرصيد المستحق',
        'المبلغ',
        'الاجمالي',
      ],
      true,
    ),
    col('reference', msg('Reference'), [
      'reference',
      'po number',
      'order number',
      'vendor reference',
      'المرجع',
      'رقم امر الشراء',
    ]),
    col('notes', msg('Notes'), ['notes', 'note', 'remarks', 'ملاحظات']),
  ],
  // Zoho People, Excel sheets and other HR systems, in English and Arabic.
  employees: [
    col('number', msg('Employee number'), [
      'employee number',
      'employee no',
      'employee id',
      'employee code',
      'emp no',
      'emp id',
      'emp number',
      'emp code',
      'staff number',
      'staff no',
      'staff id',
      'الرقم الوظيفي',
      'رقم الموظف',
      'كود الموظف',
    ]),
    col('name', msg('Name'), [
      'name',
      'full name',
      'employee name',
      'english name',
      'name english',
      'name en',
      'full name english',
      'الاسم',
      'اسم الموظف',
      'الاسم الكامل',
      'الاسم بالانجليزي',
      'الاسم بالانجليزيه',
      'الاسم الانجليزي',
    ]),
    col('firstName', msg('First name'), [
      'first name',
      'firstname',
      'given name',
      'forename',
      'الاسم الاول',
    ]),
    col('middleName', msg('Middle name'), ['middle name', 'middlename', 'الاسم الاوسط']),
    col('lastName', msg('Last name'), [
      'last name',
      'lastname',
      'surname',
      'family name',
      'اسم العائله',
      'اللقب',
    ]),
    col('nameAr', msg('Arabic name'), [
      'arabic name',
      'name arabic',
      'name ar',
      'namear',
      'full name arabic',
      'arabic full name',
      'الاسم بالعربي',
      'الاسم بالعربيه',
      'الاسم العربي',
    ]),
    col('nameArFile', msg('File names with Arabic names'), [
      'docs',
      'documents',
      'document',
      'attachments',
      'attachment',
      'files',
      'file name',
    ]),
    col('nationality', msg('Nationality'), [
      'nationality',
      'citizenship',
      'country',
      'country of citizenship',
      'الجنسيه',
    ]),
    col('gender', msg('Gender'), ['gender', 'sex', 'الجنس', 'النوع']),
    col('birthDate', msg('Date of birth'), [
      'date of birth',
      'birth date',
      'birthdate',
      'dob',
      'تاريخ الميلاد',
    ]),
    col('civilId', msg('Civil ID number'), [
      'civil id',
      'civil id no',
      'civil id number',
      'civilid',
      'cid',
      'الرقم المدني',
      'البطاقه المدنيه',
      'رقم البطاقه المدنيه',
    ]),
    col('civilIdExpiry', msg('Civil ID expiry'), [
      'civil id expiry',
      'civil id expiry date',
      'civil id expiration',
      'civil id expiration date',
      'cid expiry',
      'انتهاء البطاقه المدنيه',
      'تاريخ انتهاء البطاقه المدنيه',
      'انتهاء الرقم المدني',
    ]),
    col('passportNumber', msg('Passport number'), [
      'passport',
      'passport no',
      'passport number',
      'رقم الجواز',
      'جواز السفر',
      'رقم جواز السفر',
    ]),
    col('passportExpiry', msg('Passport expiry'), [
      'passport expiry',
      'passport expiry date',
      'passport expiration',
      'passport expiration date',
      'انتهاء الجواز',
      'تاريخ انتهاء الجواز',
      'تاريخ انتهاء جواز السفر',
    ]),
    col('residencyNumber', msg('Residency number'), [
      'residency number',
      'residency no',
      'residence number',
      'residence no',
      'iqama number',
      'visa number',
      'رقم الاقامه',
    ]),
    col('residencyExpiry', msg('Residency expiry'), [
      'residency expiry',
      'residency expiry date',
      'residence expiry',
      'visa expiry',
      'iqama expiry',
      'document expiry',
      'انتهاء الاقامه',
      'تاريخ انتهاء الاقامه',
    ]),
    col('workPermitNumber', msg('Work permit number'), [
      'work permit',
      'work permit no',
      'work permit number',
      'labour card',
      'labor card',
      'اذن العمل',
      'رقم اذن العمل',
    ]),
    col('workPermitExpiry', msg('Work permit expiry'), [
      'work permit expiry',
      'work permit expiry date',
      'labour card expiry',
      'labor card expiry',
      'انتهاء اذن العمل',
      'تاريخ انتهاء اذن العمل',
    ]),
    col('drivingLicenceNumber', msg('Driving licence number'), [
      'driving license',
      'driving licence',
      'driving license number',
      'driving licence number',
      'driving license no',
      'driving licence no',
      'رخصه القياده',
      'رقم رخصه القياده',
    ]),
    col('drivingLicenceExpiry', msg('Driving licence expiry'), [
      'driving license expiry',
      'driving licence expiry',
      'driving license expiry date',
      'driving licence expiry date',
      'license expiry',
      'licence expiry',
      'انتهاء رخصه القياده',
      'تاريخ انتهاء رخصه القياده',
    ]),
    col('department', msg('Department'), ['department', 'dept', 'division', 'القسم', 'الاداره']),
    col('jobTitle', msg('Job title'), [
      'job title',
      'designation',
      'position',
      'title',
      'job',
      'occupation',
      'profession',
      'المسمي الوظيفي',
      'الوظيفه',
      'المهنه',
    ]),
    col('jobTitleAr', msg('Job title (Arabic)'), [
      'arabic job title',
      'job title arabic',
      'designation arabic',
      'المسمي الوظيفي بالعربي',
      'المسمي الوظيفي بالعربيه',
    ]),
    col('hireDate', msg('Hire date'), [
      'hire date',
      'date of joining',
      'joining date',
      'date joined',
      'start date',
      'employment date',
      'doj',
      'تاريخ التعيين',
      'تاريخ الالتحاق',
      'تاريخ المباشره',
      'تاريخ بدء العمل',
    ]),
    col('leaveBalance', msg('Leave balance'), LEAVE_BALANCE_ALIASES, false, LEAVE_BALANCE_EXACT),
    col('basicSalary', msg('Basic salary'), [
      'basic salary',
      'basic',
      'salary',
      'basic pay',
      'monthly salary',
      'الراتب الاساسي',
      'الراتب',
    ]),
    col('iban', msg('IBAN'), ['iban', 'iban number', 'iban no', 'رقم الايبان', 'الايبان', 'ايبان']),
    col('bank', msg('Bank'), ['bank', 'bank name', 'البنك', 'اسم البنك']),
    col('accountNumber', msg('Account or salary card number'), [
      'bank account number',
      'account number',
      'account no',
      'bank account',
      'salary card',
      'salary card number',
      'card number',
      'رقم الحساب',
      'رقم الحساب البنكي',
      'رقم البطاقه',
      'بطاقه الراتب',
    ]),
    col('phone', msg('Mobile'), [
      'mobile',
      'phone',
      'mobile number',
      'phone number',
      'personal mobile number',
      'personal mobile',
      'mobile no',
      'phone no',
      'contact number',
      'telephone',
      'الهاتف',
      'النقال',
      'رقم الهاتف',
      'الجوال',
      'الموبايل',
      'رقم النقال',
    ]),
    col('email', msg('Email'), [
      'email',
      'e mail',
      'email address',
      'email id',
      'personal email',
      'work email',
      'البريد الالكتروني',
      'البريد',
      'الايميل',
    ]),
    col('pifssNumber', msg('PIFSS number'), [
      'pifss',
      'pifss number',
      'pifss no',
      'social security number',
      'رقم التامينات',
    ]),
    col('bloodGroup', msg('Blood group'), ['blood group', 'blood type', 'فصيله الدم']),
    col('notes', msg('Notes'), ['notes', 'note', 'remarks', 'comments', 'ملاحظات']),
  ],
};

/**
 * Product columns that bring stock into the books: matched only for owners,
 * admins and accountants, who may post opening stock.
 */
export const STOCK_COLUMNS = ['quantity', 'warehouse'];

/** Fields an employee's name can come from: one of them must be in the file. */
const EMPLOYEE_NAME_FIELDS = ['name', 'firstName', 'middleName', 'lastName', 'nameAr'];

/** The fields still to match before rows can be checked. */
export function missingColumns(kind: ImportKind, mapping: ColumnMapping): ImportColumn[] {
  if (kind === 'employees') {
    const named = EMPLOYEE_NAME_FIELDS.some((key) => mapping[key] != null);
    return named || mapping.number != null
      ? []
      : IMPORT_COLUMNS.employees.filter((c) => c.key === 'name');
  }
  return IMPORT_COLUMNS[kind].filter((c) => c.required && mapping[c.key] == null);
}

/** Date fields of a kind, for guessing how the file writes dates. */
export const DATE_COLUMNS: Record<ImportKind, string[]> = {
  contacts: [],
  products: [],
  opening: [],
  documents: ['date', 'dueDate'],
  employees: [
    'hireDate',
    'birthDate',
    'civilIdExpiry',
    'passportExpiry',
    'residencyExpiry',
    'workPermitExpiry',
    'drivingLicenceExpiry',
  ],
};

const ARABIC_LETTER = /[\u0600-\u06ff]/;

/**
 * An Arabic name in a document's file name, as HR systems keep scans:
 * "<Arabic name> <employee number>.pdf". The number is optional.
 */
export function arabicNameFromFileName(
  value: string,
): { name: string; number: string | null } | null {
  const m = /^(.+?)[\s_-]*(\d+)?\s*(?:\(\d+\))?\.([a-z0-9]{2,5})$/i.exec(
    normalizeDigits(value).trim(),
  );
  if (!m) return null;
  const name = m[1].replace(/[\s_]+/g, ' ').trim();
  if (!ARABIC_LETTER.test(name) || /[A-Za-z0-9]/.test(name)) return null;
  return { name, number: m[2] ?? null };
}

/** Whether most values of a column are file names made of an Arabic name and a number. */
function holdsArabicFileNames(values: string[]): boolean {
  const filled = values.filter((v) => v.trim() !== '');
  if (filled.length === 0) return false;
  const named = filled.filter((v) => arabicNameFromFileName(v)?.number);
  return named.length >= Math.max(1, filled.length * 0.6);
}

/** Column names compared without case, accents, Arabic letter variants or punctuation. */
export function normalizeHeader(text: string): string {
  return normalizeDigits(text)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type ColumnMapping = Record<string, number | null>;

/**
 * Which file column holds each of the fields. Exact names win over partial
 * ones, longer names over shorter ones; a column is used once.
 */
export function matchColumns(fields: ImportColumn[], headers: string[]): ColumnMapping {
  const names = headers.map(normalizeHeader);
  const candidates: { field: string; column: number; score: number }[] = [];
  fields.forEach((field, order) => {
    const aliases = [field.label, t(field.label), field.key, ...field.aliases]
      .map(normalizeHeader)
      .filter(Boolean);
    const exact = (field.exact ?? []).map(normalizeHeader).filter(Boolean);
    names.forEach((name, column) => {
      if (!name) return;
      let score = 0;
      for (const alias of exact) {
        if (name === alias) score = Math.max(score, 1000 + alias.length);
      }
      for (const alias of aliases) {
        if (name === alias) score = Math.max(score, 1000 + alias.length);
        else if (
          alias.length >= 4 &&
          (` ${name} `.includes(` ${alias} `) || name.startsWith(alias))
        )
          score = Math.max(score, alias.length * 10);
      }
      // Earlier fields win ties (e.g. "Name" over "Contact person").
      if (score) candidates.push({ field: field.key, column, score: score - order / 100 });
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  const mapping: ColumnMapping = Object.fromEntries(fields.map((f) => [f.key, null]));
  const used = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== null || used.has(c.column)) continue;
    mapping[c.field] = c.column;
    used.add(c.column);
  }
  return mapping;
}

/**
 * Best guess of which file column holds each field (see matchColumns).
 * With the rows, employees without an Arabic name column take Arabic names
 * from a column of document file names ("<Arabic name> 424.pdf").
 */
export function guessColumns(
  kind: ImportKind,
  headers: string[],
  rows: string[][] = [],
): ColumnMapping {
  const mapping = matchColumns(IMPORT_COLUMNS[kind], headers);
  const used = new Set(Object.values(mapping).filter((i): i is number => i != null));
  if (kind === 'employees') {
    const body = rows.slice(1);
    const column = (index: number) => body.map((r) => r[index] ?? '');
    if (mapping.nameAr != null) mapping.nameArFile = null;
    else if (
      mapping.nameArFile != null &&
      body.length &&
      !holdsArabicFileNames(column(mapping.nameArFile))
    ) {
      // A "Docs" column that doesn't hold Arabic names.
      mapping.nameArFile = null;
    }
    if (mapping.nameAr == null && mapping.nameArFile == null && body.length) {
      const found = headers.findIndex((_, i) => !used.has(i) && holdsArabicFileNames(column(i)));
      if (found >= 0) mapping.nameArFile = found;
    }
  }
  return mapping;
}

/** Example rows for the downloadable templates (one array per column, in order). */
export const TEMPLATE_ROWS: Record<ImportKind, Record<string, string>[]> = {
  contacts: [
    {
      type: 'customer',
      name: 'Al Noor Trading Co. W.L.L.',
      nameAr: 'شركة النور للتجارة ذ.م.م',
      contactPerson: 'Ahmad Al-Salem',
      email: 'accounts@alnoor.example',
      phone: '22223333',
      crNumber: '123456',
      governorate: 'Hawalli',
      area: 'Salmiya',
      block: '10',
      street: 'Salem Al-Mubarak St',
      building: '12',
      floor: '3',
      unit: '31',
      country: 'KW',
      paymentTerms: '30',
      openingBalance: '1250.750',
    },
    {
      type: 'vendor',
      name: 'Gulf Office Supplies',
      nameAr: 'مستلزمات الخليج المكتبية',
      email: 'sales@gulfoffice.example',
      phone: '+965 6555 1234',
      governorate: 'Capital',
      area: 'Shuwaikh Industrial',
      block: '1',
      street: 'Street 12',
      building: '45',
      country: 'KW',
      openingBalance: '320.500',
    },
  ],
  products: [
    {
      name: 'Office cleaning (monthly)',
      nameAr: 'تنظيف المكتب (شهري)',
      sku: 'SRV-001',
      unit: 'month',
      price: '85.000',
      description: 'Four visits a month',
      descriptionAr: 'أربع زيارات في الشهر',
      type: 'service',
    },
    {
      name: 'A4 paper box',
      nameAr: 'كرتون ورق A4',
      sku: 'PAP-A4',
      unit: 'box',
      price: '4.750',
      description: '5 reams of 500 sheets',
      descriptionAr: '5 رزم في كل رزمة 500 ورقة',
      type: 'stock',
      cost: '3.250',
      quantity: '40',
      warehouse: 'Main store',
      reorderLevel: '10',
      barcode: '2000000000015',
    },
    {
      name: 'Delivery bags',
      nameAr: 'أكياس التوصيل',
      sku: 'BAG-01',
      unit: 'pcs',
      price: '0.100',
      type: 'non-stock',
      cost: '0.040',
    },
  ],
  opening: [
    { code: '1000', account: 'Bank – current account', debit: '15250.500' },
    { code: '1010', account: 'Petty cash', debit: '150.000' },
    { code: '1500', account: 'Furniture and fixtures', debit: '4200.000' },
    { code: '3000', account: 'Capital', credit: '10000.000' },
  ],
  documents: [
    {
      number: 'INV-1001',
      contact: 'Al Noor Trading Co. W.L.L.',
      date: '15/08/2026',
      dueDate: '14/09/2026',
      amount: '1250.750',
      reference: 'PO-77',
    },
    {
      number: 'INV-1002',
      contact: 'Salmiya Dental Clinic',
      date: '02/09/2026',
      dueDate: '02/10/2026',
      amount: '480.000',
    },
  ],
  employees: [
    {
      number: '000101',
      name: 'Fahad Al-Mutairi',
      nameAr: 'فهد المطيري',
      nationality: 'Kuwait',
      gender: 'Male',
      birthDate: '14/03/1990',
      civilId: '290031412348',
      civilIdExpiry: '31/12/2028',
      department: 'Head Office',
      jobTitle: 'Accountant',
      jobTitleAr: 'محاسب',
      hireDate: '01/02/2022',
      leaveBalance: '12.5',
      basicSalary: '1250.000',
      iban: 'KW81CBKU0000000000001234560101',
      phone: '+965 5000 1234',
      email: 'fahad@example.com',
    },
    {
      number: '000102',
      name: 'Ram Bahadur',
      nameAr: 'رام بهادور',
      nationality: 'Nepal',
      gender: 'Male',
      birthDate: '02/07/1994',
      civilIdExpiry: '15/06/2027',
      passportNumber: 'PA1234567',
      passportExpiry: '20/08/2030',
      residencyExpiry: '15/06/2027',
      department: 'Security',
      jobTitle: 'Security Guard',
      jobTitleAr: 'حارس أمن',
      hireDate: '10/09/2023',
      leaveBalance: '30',
      basicSalary: '180.000',
      accountNumber: '5407000000000008',
      phone: '977-9800000000',
    },
  ],
};

/** Sample rows for an open bills file (the same columns as open invoices). */
export const BILL_TEMPLATE_ROWS: Record<string, string>[] = [
  {
    number: 'B-2041',
    contact: 'Gulf Office Supplies',
    date: '20/08/2026',
    dueDate: '19/09/2026',
    amount: '320.500',
    reference: 'GOS-5531',
  },
  {
    number: 'B-2042',
    contact: 'Boubyan Couriers',
    date: '01/09/2026',
    amount: '45.000',
  },
];

/**
 * The text of a CSV file. Excel saves "CSV UTF-8" (with a byte order mark),
 * plain "CSV" in the Windows Arabic code page, and "Unicode text" as UTF-16;
 * all three are read correctly.
 */
export function decodeCsv(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('windows-1256').decode(bytes);
    } catch {
      return new TextDecoder().decode(bytes);
    }
  }
}

/** What a chosen file is: an Excel workbook, an old binary Excel file, or text (CSV). */
export function spreadsheetKind(bytes: Uint8Array, name = ''): 'xlsx' | 'xls' | 'text' {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'xlsx';
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    return 'xls';
  if (/\.xls$/i.test(name)) return 'xls';
  return 'text';
}

/**
 * The rows of a CSV file or of an Excel workbook's first sheet, the column
 * names first. The Excel reader is loaded only when a workbook is chosen.
 */
export async function readImportFile(data: ArrayBuffer, name = ''): Promise<string[][]> {
  const bytes = new Uint8Array(data);
  const kind = spreadsheetKind(bytes, name);
  if (kind === 'xlsx') {
    const { readXlsx } = await import('@/lib/xlsx');
    return readXlsx(bytes);
  }
  if (kind === 'xls') {
    throw new Error(
      t('Older Excel files (.xls) can’t be read. In Excel, save the file as .xlsx or CSV.'),
    );
  }
  return parseCsvRows(decodeCsv(bytes));
}
