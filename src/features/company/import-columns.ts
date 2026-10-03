import { normalizeDigits } from '@/lib/money';
import { msg, t } from '@/i18n';

/**
 * What a CSV import can bring in, the columns each kind understands and how
 * a file's own column names are matched to them (English or Arabic, any
 * case, with or without spaces and punctuation).
 */

export type ImportKind = 'contacts' | 'products' | 'opening' | 'documents';

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  /** Other names the column goes by in exports and spreadsheets. */
  aliases: string[];
}

const col = (key: string, label: string, aliases: string[], required = false): ImportColumn => ({
  key,
  label,
  aliases,
  required,
});

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
};

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
 * Best guess of which file column holds each field. Exact names win over
 * partial ones, longer names over shorter ones; a column is used once.
 */
export function guessColumns(kind: ImportKind, headers: string[]): ColumnMapping {
  const fields = IMPORT_COLUMNS[kind];
  const names = headers.map(normalizeHeader);
  const candidates: { field: string; column: number; score: number }[] = [];
  fields.forEach((field, order) => {
    const aliases = [field.label, t(field.label), field.key, ...field.aliases]
      .map(normalizeHeader)
      .filter(Boolean);
    names.forEach((name, column) => {
      if (!name) return;
      let score = 0;
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
    },
    {
      name: 'A4 paper box',
      nameAr: 'كرتون ورق A4',
      sku: 'PAP-A4',
      unit: 'box',
      price: '4.750',
      description: '5 reams of 500 sheets',
      descriptionAr: '5 رزم في كل رزمة 500 ورقة',
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
