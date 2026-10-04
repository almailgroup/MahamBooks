import type {
  Address,
  Client,
  ComplianceDocumentType,
  DocumentOwnerType,
  Employee,
  EmployeeAllowance,
  Product,
} from '../types';

/**
 * Who the demo company is and who it works with. Everything is fictional:
 * names, numbers, IBANs and Civil IDs only follow the Kuwaiti formats (the
 * IBANs and Civil IDs have valid check digits). E-mail addresses use the
 * reserved .example domain.
 */

/* -------------------------------------------------------------------------- */
/* The company                                                                */
/* -------------------------------------------------------------------------- */

export const COMPANY = {
  name: 'Rawdat Al Khaleej General Trading & Contracting',
  legalName: 'Rawdat Al Khaleej General Trading & Contracting Co. W.L.L.',
  nameAr: 'شركة روضة الخليج للتجارة العامة والمقاولات ذ.م.م',
  email: 'accounts@rawdat-alkhaleej.example',
  phone: '+965 2481 7350',
  website: 'https://www.rawdat-alkhaleej.example',
  crNumber: '387154',
  licenceNumber: '2014/26731',
  pamFileNumber: '235847',
  pifssEmployerNumber: '68021457',
  mofTaxCardNumber: '1012846',
  kcciNumber: '88214',
  wamdPhone: '+965 9871 2046',
  capital: 50_000,
  /** Accent of the documents: the teal of the logo. */
  accent: '#0f766e',
};

export function kwAddress(parts: Partial<Address>): Address {
  return { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'KW', ...parts };
}

export const COMPANY_ADDRESS = kwAddress({
  city: 'Shuwaikh Industrial',
  state: 'Capital',
  block: '2',
  street: '24',
  building: '117',
  floor: '1',
  unit: '4',
  paci: '18734521',
});

export const WORDING = {
  invoiceNotes: 'شكراً لتعاملكم معنا.\nThank you for your business.',
  invoiceTerms:
    'تُحرَّر الشيكات باسم شركة روضة الخليج للتجارة العامة والمقاولات ذ.م.م.\n' +
    'Cheques payable to Rawdat Al Khaleej General Trading & Contracting Co. W.L.L.',
  quoteNotes:
    'الأسعار بالدينار الكويتي وتشمل التوصيل والتركيب داخل الكويت.\n' +
    'Prices are in Kuwaiti dinars and include delivery and installation in Kuwait.',
  quoteTerms:
    'العرض ساري لمدة 15 يوماً. ضمان سنة على المواد والتركيب.\n' +
    'Valid for 15 days. One-year warranty on materials and workmanship.',
  // One line: the templates print the CR, licence and tax card numbers above it.
  footer: 'ص.ب 24813 الصفاة 13109 · P.O. Box 24813, Safat 13109, Kuwait',
  paymentInstructions:
    'يرجى ذكر رقم الفاتورة عند التحويل.\nPlease quote the invoice number with your payment.',
};

/** The company's bank accounts (KW IBANs with valid check digits). */
export const BANKS = {
  nbk: {
    code: '1000',
    name: 'NBK – current account',
    nameAr: 'بنك الكويت الوطني – الحساب الجاري',
    institution: 'National Bank of Kuwait',
    accountNumber: '2019847361',
    iban: 'KW54NBOK0000000000002019847361',
    bic: 'NBOKKWKW',
  },
  kfh: {
    code: '1005',
    name: 'KFH – current account',
    nameAr: 'بيت التمويل الكويتي – الحساب الجاري',
    institution: 'Kuwait Finance House',
    accountNumber: '0731005248',
    iban: 'KW49KFHO0000000000000731005248',
    bic: 'KFHOKWKW',
  },
};

/* -------------------------------------------------------------------------- */
/* Contacts                                                                   */
/* -------------------------------------------------------------------------- */

/** Text the demo writes itself (references, descriptions, titles), in both languages. */
export function both(english: string, arabic: string): string {
  return `${english} – ${arabic}`;
}

const MONTHS = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  ar: [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ],
};

/** A month (yyyy-MM) as it is written in each language: "March 2026", "مارس 2026". */
export function monthNames(period: string): { en: string; ar: string } {
  const [year, month] = period.split('-').map(Number);
  return { en: `${MONTHS.en[month - 1]} ${year}`, ar: `${MONTHS.ar[month - 1]} ${year}` };
}

export interface ContactSeed extends Partial<Client> {
  name: string;
  nameAr: string;
  person?: { name: string; email: string; phone: string };
}

export const CUSTOMERS = {
  ministry: {
    name: 'Ministry of Education – Hawalli Educational Zone',
    nameAr: 'وزارة التربية – منطقة حولي التعليمية',
    person: {
      name: 'Eng. Fahad Al-Rashidi',
      email: 'maintenance.hawalli@moe.example',
      phone: '+965 2262 4410',
    },
    phone: '+965 2262 4400',
    address: kwAddress({
      city: 'Hawalli',
      state: 'Hawalli',
      block: '1',
      street: '10',
      building: '12',
      paci: '20457813',
    }),
    paymentTermsDays: 60,
    language: 'ar',
    retentionPercent: 5,
    retentionKind: 'tax',
    notes:
      'Electrical maintenance contract for the schools of the zone, invoiced quarterly. ' +
      'Paid by bank transfer through the Ministry of Finance.\n' +
      'عقد صيانة كهربائية لمدارس المنطقة، يُفوتر كل ربع سنة. ' +
      'يُسدَّد بتحويل بنكي عن طريق وزارة المالية.',
  },
  bawaba: {
    name: 'Al Bawaba Construction Co. W.L.L.',
    nameAr: 'شركة البوابة للإنشاءات ذ.م.م',
    person: {
      name: 'Tariq Haddad',
      email: 'accounts@albawaba-construction.example',
      phone: '+965 2240 9182',
    },
    phone: '+965 2240 9100',
    taxId: '1188430',
    address: kwAddress({
      city: 'Sharq',
      state: 'Capital',
      block: '6',
      street: '33',
      building: '15',
      floor: '9',
      paci: '13820476',
    }),
    paymentTermsDays: 45,
    retentionPercent: 10,
    retentionKind: 'contract',
    creditLimit: 30_000,
    notes:
      'Main contractor of Al Bawaba Tower in Sharq. Lighting supply and installation ' +
      'contract; 10% retention until handover. Pays by post-dated cheques.\n' +
      'المقاول الرئيسي لبرج البوابة في شرق. عقد توريد وتركيب الإنارة، ' +
      'مع محتجزات 10% حتى التسليم. يسدد بشيكات آجلة.',
  },
  bayan: {
    name: 'Bayan Medical Center',
    nameAr: 'مركز بيان الطبي',
    person: {
      name: 'Dr. Hanan Al-Saleh',
      email: 'admin@bayan-medical.example',
      phone: '+965 2538 1150',
    },
    phone: '+965 2538 1100',
    address: kwAddress({
      city: 'Bayan',
      state: 'Hawalli',
      block: '7',
      street: '1',
      building: '33',
      paci: '22068541',
    }),
    paymentTermsDays: 30,
  },
  sadu: {
    name: 'Sadu Interiors Co.',
    nameAr: 'شركة السدو للديكور',
    person: {
      name: 'Lulwa Al-Hamad',
      email: 'projects@sadu-interiors.example',
      phone: '+965 9905 2231',
    },
    phone: '+965 2571 4480',
    address: kwAddress({
      city: 'Salmiya',
      state: 'Hawalli',
      block: '10',
      street: '5',
      building: '42',
      floor: '3',
      unit: '12',
      paci: '16620934',
    }),
    paymentTermsDays: 30,
  },
  hotel: {
    name: 'Gulf Pearl Hotel – Salmiya',
    nameAr: 'فندق لؤلؤة الخليج – السالمية',
    person: {
      name: 'Vikram Shetty',
      email: 'engineering@gulfpearl-hotel.example',
      phone: '+965 2575 6600',
    },
    phone: '+965 2575 6000',
    address: kwAddress({
      city: 'Salmiya',
      state: 'Hawalli',
      block: '5',
      street: 'Arabian Gulf Street',
      building: '18',
      paci: '16634208',
    }),
    paymentTermsDays: 30,
    language: 'en',
  },
  naseem: {
    name: 'Al Naseem Real Estate Co. K.S.C.C.',
    nameAr: 'شركة النسيم العقارية ش.م.ك.م',
    person: {
      name: 'Bader Al-Enezi',
      email: 'bader@alnaseem-realestate.example',
      phone: '+965 2297 3340',
    },
    phone: '+965 2297 3300',
    taxId: '1067215',
    address: kwAddress({
      city: 'Kuwait City',
      state: 'Capital',
      block: '13',
      street: '9',
      building: '27',
      floor: '14',
      paci: '10392457',
    }),
    paymentTermsDays: 30,
    creditLimit: 15_000,
    notes:
      'Residential buildings in Mahboula and Salmiya. Pays by post-dated cheques.\n' +
      'عمارات سكنية في المهبولة والسالمية. يسدد بشيكات آجلة.',
  },
  marina: {
    name: 'Marina Breeze Restaurants Co.',
    nameAr: 'شركة نسيم المارينا للمطاعم',
    person: { name: 'Omar Fawzi', email: 'ops@marinabreeze.example', phone: '+965 6650 4421' },
    phone: '+965 2224 6650',
    address: kwAddress({
      city: 'Salmiya',
      state: 'Hawalli',
      block: '3',
      street: 'Arabian Gulf Street',
      building: '7',
      paci: '16612875',
    }),
    paymentTermsDays: 30,
  },
  oasis: {
    name: 'Green Oasis Farms Co.',
    nameAr: 'شركة الواحة الخضراء للمزارع',
    person: {
      name: 'Saad Al-Dossari',
      email: 'saad@greenoasis-farms.example',
      phone: '+965 9944 1870',
    },
    address: kwAddress({
      city: 'Wafra',
      state: 'Ahmadi',
      block: '2',
      street: '20',
      building: '214',
      paci: '41197736',
    }),
    paymentTermsDays: 30,
    creditLimit: 2_000,
    notes: 'On hold until the overdue invoices are settled.\nموقوف حتى تُسدَّد الفواتير المتأخرة.',
  },
  khalid: {
    name: 'Khalid Abdullah Al-Ajmi',
    nameAr: 'خالد عبدالله العجمي',
    civilId: '278060225224',
    phone: '+965 9781 3302',
    email: 'k.alajmi@mail.example',
    address: kwAddress({
      city: 'Jabriya',
      state: 'Hawalli',
      block: '11',
      street: '104',
      avenue: '3',
      building: '19',
      paci: '17452290',
    }),
    paymentTermsDays: 7,
  },
  noura: {
    name: 'Noura Fahad Al-Shammari',
    nameAr: 'نورة فهد الشمري',
    civilId: '292011790113',
    phone: '+965 6011 4472',
    email: 'noura.alshammari@mail.example',
    address: kwAddress({
      city: 'Mishref',
      state: 'Hawalli',
      block: '4',
      street: '6',
      avenue: '1',
      building: '23',
      paci: '18820164',
    }),
    paymentTermsDays: 7,
  },
  walkin: {
    name: 'Cash customer – Al-Rai showroom',
    nameAr: 'عميل نقدي – معرض الري',
    address: kwAddress({}),
    paymentTermsDays: 0,
    notes:
      'Showroom sales paid at the counter by KNET or cash.\n' +
      'مبيعات المعرض المدفوعة عند الكاشير بالكي نت أو نقداً.',
  },
  sanabel: {
    name: 'Al Sanabel Private School',
    nameAr: 'مدرسة السنابل الخاصة',
    person: {
      name: 'Rania Khoury',
      email: 'facilities@sanabel-school.example',
      phone: '+965 2456 7781',
    },
    phone: '+965 2456 7700',
    address: kwAddress({
      city: 'Jahra',
      state: 'Jahra',
      block: '2',
      street: '15',
      building: '8',
      paci: '30547762',
    }),
    paymentTermsDays: 30,
  },
} satisfies Record<string, ContactSeed>;

export const VENDORS = {
  brightway: {
    name: 'Shenzhen Brightway Lighting Co., Ltd.',
    nameAr: 'شركة شنتشن برايتواي للإنارة المحدودة',
    person: {
      name: 'Vivian Zhang',
      email: 'export@brightway-lighting.example',
      phone: '+86 755 2981 4470',
    },
    currency: 'USD',
    address: {
      line1: 'Building 6, Tianan Industrial Park',
      line2: 'Longgang District',
      city: 'Shenzhen',
      state: 'Guangdong',
      postalCode: '518116',
      country: 'CN',
    },
    paymentTermsDays: 30,
    // Orders to China are written in English.
    language: 'en',
    notes:
      'LED lighting, shipped by sea to Shuwaikh port. Invoices in US dollars.\n' +
      'إنارة ليد تُشحن بحراً إلى ميناء الشويخ. الفواتير بالدولار الأمريكي.',
  },
  jebelali: {
    name: 'Jebel Ali Security Systems Trading LLC',
    nameAr: 'جبل علي لتجارة أنظمة الأمن ذ.م.م',
    person: {
      name: 'Faisal Mirza',
      email: 'sales@jebelali-security.example',
      phone: '+971 4 881 5520',
    },
    currency: 'AED',
    address: {
      line1: 'Warehouse 14, Street 7',
      line2: 'Jebel Ali Free Zone South',
      city: 'Dubai',
      state: '',
      postalCode: '',
      country: 'AE',
    },
    paymentTermsDays: 30,
    notes:
      'Cameras, recorders and smart locks, trucked from Dubai. Invoices in dirhams.\n' +
      'كاميرات وأجهزة تسجيل وأقفال ذكية تُنقل براً من دبي. الفواتير بالدرهم الإماراتي.',
  },
  clearing: {
    name: 'Gulf Clearing & Freight Co. W.L.L.',
    nameAr: 'شركة الخليج للتخليص والشحن ذ.م.م',
    person: {
      name: 'Yousef Al-Baloushi',
      email: 'ops@gulf-clearing.example',
      phone: '+965 2483 9015',
    },
    address: kwAddress({
      city: 'Shuwaikh',
      state: 'Capital',
      block: '1',
      street: '41',
      building: '5',
      paci: '11840273',
    }),
    paymentTermsDays: 15,
  },
  cables: {
    name: 'Shuwaikh Cables & Electrical Supplies Co.',
    nameAr: 'شركة الشويخ للكابلات والأدوات الكهربائية',
    person: {
      name: 'Ashraf Nabil',
      email: 'sales@shuwaikh-cables.example',
      phone: '+965 2491 6620',
    },
    address: kwAddress({
      city: 'Shuwaikh Industrial',
      state: 'Capital',
      block: '1',
      street: '33',
      building: '210',
      paci: '18721564',
    }),
    paymentTermsDays: 30,
    notes:
      'Paid by post-dated cheques from our NBK account.\n' +
      'نسدد لهم بشيكات آجلة من حسابنا في بنك الكويت الوطني.',
  },
  sharq: {
    name: 'Sharq Computer Systems Co.',
    nameAr: 'شركة الشرق لأنظمة الحاسب الآلي',
    person: {
      name: 'Nikhil Menon',
      email: 'sales@sharq-computers.example',
      phone: '+965 2245 1188',
    },
    address: kwAddress({
      city: 'Sharq',
      state: 'Capital',
      block: '3',
      street: '18',
      building: '44',
      paci: '13807715',
    }),
    paymentTermsDays: 15,
  },
  tilal: {
    name: 'Al Tilal Real Estate Co.',
    nameAr: 'شركة التلال العقارية',
    person: {
      name: 'Leasing department',
      email: 'leasing@altilal-realestate.example',
      phone: '+965 2224 7000',
    },
    address: kwAddress({
      city: 'Kuwait City',
      state: 'Capital',
      block: '8',
      street: '11',
      building: '11',
      paci: '10377842',
    }),
    paymentTermsDays: 0,
    notes:
      'Landlord of the Shuwaikh office and store and of the Al-Rai showroom.\n' +
      'مالك مكتب ومستودع الشويخ ومعرض الري.',
  },
  garage: {
    name: 'Ardiya Auto Services',
    nameAr: 'خدمات العارضية للسيارات',
    phone: '+965 2473 1150',
    address: kwAddress({
      city: 'Ardiya Industrial',
      state: 'Farwaniya',
      block: '1',
      street: '12',
      building: '61',
    }),
    paymentTermsDays: 0,
  },
  stationery: {
    name: 'Bait Al Waraq Stationery',
    nameAr: 'مكتبة بيت الورق',
    phone: '+965 2262 9035',
    address: kwAddress({ city: 'Hawalli', state: 'Hawalli', block: '4', street: '106' }),
    paymentTermsDays: 0,
  },
  sahel: {
    name: 'Al Sahel Technical Services Co.',
    nameAr: 'شركة الساحل للخدمات الفنية',
    person: { name: 'Mahmoud Ezz', email: 'mahmoud@alsahel-tech.example', phone: '+965 6602 3381' },
    address: kwAddress({
      city: 'Farwaniya',
      state: 'Farwaniya',
      block: '5',
      street: '27',
      building: '9',
      paci: '25519087',
    }),
    paymentTermsDays: 30,
    // A subcontractor who also buys cable and fittings from the store.
    isCustomer: true,
    notes:
      'Subcontracted installation crews for the Al Bawaba Tower works. ' +
      'Also buys cable and fittings from our store.\n' +
      'مقاول باطن لطواقم التركيب في أعمال برج البوابة. ' +
      'يشتري أيضاً الكيبلات والتجهيزات من مستودعنا.',
  },
} satisfies Record<string, ContactSeed>;

export type CustomerKey = keyof typeof CUSTOMERS;
export type VendorKey = keyof typeof VENDORS;

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

export interface ItemSeed extends Partial<Product> {
  sku: string;
  name: string;
  nameAr: string;
  unitPrice: number;
  unit: string;
  /** Chart code of the income account (services and contract work). */
  income?: string;
  vendor?: VendorKey;
}

export const ITEMS = {
  panel: {
    sku: 'LED-P6060',
    name: 'LED panel light 60×60 cm, 40 W',
    nameAr: 'كشاف ليد بانل 60×60 سم، 40 واط',
    unit: 'pcs',
    unitPrice: 6.75,
    kind: 'stock',
    costPrice: 3.15,
    reorderLevel: 60,
    vendor: 'brightway',
    hsCode: '9405.11',
  },
  downlight: {
    sku: 'LED-DL12',
    name: 'LED downlight 12 W, warm white',
    nameAr: 'سبوت ليد 12 واط، إضاءة دافئة',
    unit: 'pcs',
    unitPrice: 2.25,
    kind: 'stock',
    costPrice: 0.98,
    reorderLevel: 120,
    vendor: 'brightway',
    hsCode: '9405.11',
  },
  flood: {
    sku: 'LED-FL100',
    name: 'LED flood light 100 W, outdoor',
    nameAr: 'كشاف ليد خارجي 100 واط',
    unit: 'pcs',
    unitPrice: 14.5,
    kind: 'stock',
    costPrice: 6.9,
    reorderLevel: 20,
    vendor: 'brightway',
    hsCode: '9405.41',
  },
  cable: {
    sku: 'CBL-25-100',
    name: 'Electrical cable 2.5 mm², 100 m roll',
    nameAr: 'كيبل كهرباء 2.5 مم²، لفة 100 متر',
    unit: 'roll',
    unitPrice: 18.75,
    kind: 'stock',
    costPrice: 12.4,
    reorderLevel: 25,
    vendor: 'cables',
    hsCode: '8544.49',
  },
  switches: {
    sku: 'SW-SET-W',
    name: 'Switch and socket set, white',
    nameAr: 'طقم مفاتيح وأفياش، أبيض',
    unit: 'set',
    unitPrice: 4.5,
    kind: 'stock',
    costPrice: 2.15,
    reorderLevel: 40,
    vendor: 'cables',
    hsCode: '8536.50',
  },
  camera: {
    sku: 'CAM-4MP-D',
    name: 'IP dome camera 4 MP',
    nameAr: 'كاميرا مراقبة قبة 4 ميجابكسل',
    unit: 'pcs',
    unitPrice: 32,
    kind: 'stock',
    costPrice: 17.85,
    reorderLevel: 16,
    vendor: 'jebelali',
    hsCode: '8525.89',
  },
  nvr: {
    sku: 'NVR-16CH',
    name: 'Network video recorder, 16 channels',
    nameAr: 'جهاز تسجيل شبكي 16 قناة',
    unit: 'pcs',
    unitPrice: 95,
    kind: 'stock',
    costPrice: 58.2,
    reorderLevel: 4,
    vendor: 'jebelali',
    hsCode: '8521.90',
  },
  lock: {
    sku: 'LOCK-FP',
    name: 'Smart door lock with fingerprint',
    nameAr: 'قفل باب ذكي بالبصمة',
    unit: 'pcs',
    unitPrice: 68,
    kind: 'stock',
    costPrice: 39.5,
    reorderLevel: 6,
    vendor: 'jebelali',
    hsCode: '8301.40',
  },
  labour: {
    sku: 'SRV-INST',
    name: 'Installation labour',
    nameAr: 'أجور التركيب',
    unit: 'hr',
    unitPrice: 8,
    kind: 'service',
    income: '4100',
  },
  survey: {
    sku: 'SRV-SURVEY',
    name: 'Site survey and lighting design',
    nameAr: 'معاينة الموقع وتصميم الإنارة',
    unit: '',
    unitPrice: 75,
    kind: 'service',
    income: '4100',
  },
  cctvInstall: {
    sku: 'SRV-CCTV',
    name: 'CCTV installation and programming, per camera',
    nameAr: 'تركيب وبرمجة كاميرات المراقبة، للكاميرا',
    unit: 'pcs',
    unitPrice: 12.5,
    kind: 'service',
    income: '4100',
  },
  schoolMaintenance: {
    sku: 'AMC-SCH',
    name: 'Electrical maintenance of schools, quarterly',
    nameAr: 'صيانة الأنظمة الكهربائية للمدارس، ربع سنوية',
    unit: '',
    unitPrice: 9850,
    kind: 'service',
    income: '4150',
  },
  hotelMaintenance: {
    sku: 'AMC-HTL',
    name: 'Monthly maintenance of lighting and electrical systems',
    nameAr: 'صيانة شهرية لأنظمة الإنارة والكهرباء',
    unit: '',
    unitPrice: 1250,
    kind: 'service',
    income: '4150',
  },
  restaurantMaintenance: {
    sku: 'AMC-RST',
    name: 'Quarterly electrical maintenance, three restaurants',
    nameAr: 'صيانة كهربائية ربع سنوية لثلاثة مطاعم',
    unit: '',
    unitPrice: 1750,
    kind: 'service',
    income: '4150',
  },
  buildingMaintenance: {
    sku: 'AMC-BLD',
    name: 'Electrical and CCTV maintenance, six buildings, quarterly',
    nameAr: 'صيانة الأنظمة الكهربائية والكاميرات لست عمارات، ربع سنوية',
    unit: '',
    unitPrice: 2850,
    kind: 'service',
    income: '4150',
  },
  installWorks: {
    sku: 'CNT-INST',
    name: 'Installation works – lighting and wiring (lump sum)',
    nameAr: 'أعمال تركيب الإنارة والتمديدات (مبلغ مقطوع)',
    unit: 'LS',
    unitPrice: 31_400,
    kind: 'service',
    income: '4150',
  },
} satisfies Record<string, ItemSeed>;

export type ItemKey = keyof typeof ITEMS;

/** Stock on hand in the Shuwaikh store when the books were opened. */
export const OPENING_STOCK: Partial<Record<ItemKey, number>> = {
  panel: 420,
  downlight: 1000,
  flood: 46,
  cable: 70,
  switches: 160,
  camera: 64,
  nvr: 8,
  lock: 18,
};

export const WAREHOUSES = {
  store: {
    name: 'Shuwaikh store',
    nameAr: 'مستودع الشويخ',
    address: both(
      'Shuwaikh Industrial, Block 2, Street 24, Building 117',
      'الشويخ الصناعية، قطعة 2، شارع 24، مبنى 117',
    ),
  },
  showroom: {
    name: 'Al-Rai showroom',
    nameAr: 'معرض الري',
    address: both('Al-Rai, Block 1, Street 28, Building 360', 'الري، قطعة 1، شارع 28، مبنى 360'),
  },
};

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

export interface EmployeeSeed extends Partial<Employee> {
  name: string;
  nameAr: string;
  allowanceList?: Partial<EmployeeAllowance>[];
  /** Annual leave days not yet taken when the books were opened. */
  openingLeave: number;
}

/** Regular allowances are part of the wage the end-of-service indemnity is worked out on. */
const housing = (amount: number) => ({
  name: 'Housing allowance',
  nameAr: 'بدل سكن',
  amount,
  countsForEos: true,
});
const transport = (amount: number) => ({
  name: 'Transport allowance',
  nameAr: 'بدل مواصلات',
  amount,
  countsForEos: true,
});
const food = (amount: number) => ({
  name: 'Food allowance',
  nameAr: 'بدل طعام',
  amount,
  countsForEos: true,
});

/**
 * The staff. Expiry dates that matter for the story (a residency expiring
 * soon) are set relative to today in the people story.
 */
export const EMPLOYEES = {
  abdulaziz: {
    name: 'Abdulaziz Saleh Al-Mutairi',
    nameAr: 'عبدالعزيز صالح المطيري',
    nationality: 'KW',
    category: 'kuwaiti',
    civilId: '286041299957',
    passportNumber: 'P02184471',
    jobTitle: 'Operations manager',
    jobTitleAr: 'مدير العمليات',
    department: both('Management', 'الإدارة'),
    hireDate: '2019-03-03',
    basicSalary: 1150,
    allowanceList: [
      { name: 'Car allowance', nameAr: 'بدل سيارة', amount: 150, countsForEos: false },
    ],
    bank: 'NBOK',
    iban: 'KW90NBOK0000000000001187204533',
    pifssNumber: '1009284733',
    phone: '+965 9900 3381',
    email: 'abdulaziz@rawdat-alkhaleej.example',
    openingLeave: 21,
  },
  maryam: {
    name: 'Maryam Yousef Al-Kandari',
    nameAr: 'مريم يوسف الكندري',
    nationality: 'KW',
    category: 'kuwaiti',
    civilId: '295092713227',
    passportNumber: 'P03371058',
    jobTitle: 'Accountant',
    jobTitleAr: 'محاسبة',
    department: both('Finance', 'المالية'),
    hireDate: '2022-09-18',
    basicSalary: 820,
    allowanceList: [transport(75)],
    bank: 'KFHO',
    iban: 'KW88KFHO0000000000000452117809',
    pifssNumber: '1011570286',
    phone: '+965 6655 1094',
    email: 'maryam@rawdat-alkhaleej.example',
    openingLeave: 12.5,
  },
  rajesh: {
    name: 'Rajesh Kumar Nair',
    nameAr: 'راجيش كومار ناير',
    nationality: 'IN',
    category: 'expat',
    civilId: '283021506118',
    passportNumber: 'Z4419823',
    residencyNumber: '18/2017/104455',
    workPermitNumber: 'WP-2017-0884512',
    pamJobTitle: 'Electrical engineer',
    permitSalary: 620,
    jobTitle: 'Site engineer',
    jobTitleAr: 'مهندس موقع',
    department: both('Projects', 'المشاريع'),
    hireDate: '2017-05-14',
    basicSalary: 620,
    allowanceList: [housing(150), transport(50)],
    bank: 'GULB',
    iban: 'KW15GULB0000000000000020391746',
    phone: '+965 9662 0418',
    email: 'rajesh@rawdat-alkhaleej.example',
    openingLeave: 18,
  },
  mohammed: {
    name: 'Mohammed Abdelrahman Hassan',
    nameAr: 'محمد عبدالرحمن حسن',
    nationality: 'EG',
    category: 'expat',
    civilId: '289073056347',
    passportNumber: 'A21877410',
    residencyNumber: '18/2020/220871',
    workPermitNumber: 'WP-2020-1172093',
    pamJobTitle: 'Sales representative',
    permitSalary: 420,
    jobTitle: 'Sales executive',
    jobTitleAr: 'مندوب مبيعات',
    department: both('Sales', 'المبيعات'),
    hireDate: '2020-02-09',
    basicSalary: 420,
    allowanceList: [
      transport(60),
      { name: 'Phone allowance', nameAr: 'بدل هاتف', amount: 15, countsForEos: false },
    ],
    bank: 'BBYN',
    iban: 'KW60BBYN0000000000000301845527',
    phone: '+965 5098 2276',
    openingLeave: 9,
  },
  ramon: {
    name: 'Ramon Dela Cruz',
    nameAr: 'رامون ديلا كروز',
    nationality: 'PH',
    category: 'expat',
    civilId: '291110407955',
    passportNumber: 'P7741290A',
    residencyNumber: '18/2021/301142',
    workPermitNumber: 'WP-2021-1530877',
    pamJobTitle: 'CCTV technician',
    permitSalary: 330,
    jobTitle: 'CCTV technician',
    jobTitleAr: 'فني كاميرات مراقبة',
    department: both('Projects', 'المشاريع'),
    hireDate: '2021-06-20',
    basicSalary: 330,
    allowanceList: [food(30)],
    bank: 'COMB',
    iban: 'KW85COMB0000000000000007712390',
    phone: '+965 6981 3352',
    openingLeave: 15,
  },
  sanjay: {
    name: 'Sanjay Thapa',
    nameAr: 'سانجاي ثابا',
    nationality: 'NP',
    category: 'expat',
    civilId: '287051969226',
    passportNumber: 'PA0918274',
    residencyNumber: '18/2018/127730',
    workPermitNumber: 'WP-2018-0941266',
    pamJobTitle: 'Storekeeper',
    permitSalary: 260,
    jobTitle: 'Storekeeper',
    jobTitleAr: 'أمين مخزن',
    department: both('Warehouse', 'المستودع'),
    hireDate: '2018-01-21',
    basicSalary: 260,
    allowanceList: [food(30)],
    bank: 'BRGN',
    iban: 'KW35BRGN0000000000000158840216',
    phone: '+965 9470 2215',
    openingLeave: 24,
  },
  asif: {
    name: 'Muhammad Asif Iqbal',
    nameAr: 'محمد آصف إقبال',
    nationality: 'PK',
    category: 'expat',
    civilId: '290010898115',
    passportNumber: 'BX4472019',
    residencyNumber: '18/2019/183305',
    workPermitNumber: 'WP-2019-1025548',
    pamJobTitle: 'Driver',
    permitSalary: 230,
    jobTitle: 'Driver',
    jobTitleAr: 'سائق',
    department: both('Logistics', 'النقل والإمداد'),
    hireDate: '2019-08-11',
    basicSalary: 230,
    allowanceList: [food(30)],
    bank: 'ABKK',
    iban: 'KW60ABKK0000000000000006230418',
    phone: '+965 5523 8840',
    openingLeave: 11,
  },
  sherif: {
    name: 'Sherif Adel Mansour',
    nameAr: 'شريف عادل منصور',
    nationality: 'EG',
    category: 'expat',
    civilId: '293081115951',
    passportNumber: 'A30187655',
    residencyNumber: '18/2026/074419',
    workPermitNumber: 'WP-2026-0215583',
    pamJobTitle: 'Electrician',
    permitSalary: 360,
    jobTitle: 'Electrician',
    jobTitleAr: 'فني كهرباء',
    department: both('Projects', 'المشاريع'),
    basicSalary: 360,
    allowanceList: [transport(40)],
    bank: 'WRBA',
    iban: 'KW92WRBA0000000000000081127745',
    phone: '+965 6094 4127',
    contractType: 'fixed',
    openingLeave: 0,
  },
  ahmed: {
    name: 'Ahmed Fathi Mahmoud',
    nameAr: 'أحمد فتحي محمود',
    nationality: 'EG',
    category: 'expat',
    civilId: '280032100347',
    passportNumber: 'A11920384',
    residencyNumber: '18/2016/091873',
    workPermitNumber: 'WP-2016-0731194',
    pamJobTitle: 'Electrician',
    permitSalary: 350,
    jobTitle: 'Electrician',
    jobTitleAr: 'فني كهرباء',
    department: both('Projects', 'المشاريع'),
    hireDate: '2016-07-17',
    basicSalary: 350,
    allowanceList: [transport(40)],
    bank: 'NBOK',
    iban: 'KW32NBOK0000000000001190038462',
    phone: '+965 9937 6650',
    openingLeave: 16,
  },
} satisfies Record<string, EmployeeSeed>;

export type EmployeeKey = keyof typeof EMPLOYEES;

/* -------------------------------------------------------------------------- */
/* Documents register                                                         */
/* -------------------------------------------------------------------------- */

export interface RegisterSeed {
  type: ComplianceDocumentType;
  title?: string;
  number?: string;
  issuer?: string;
  /** Days from today to the expiry (negative: already expired). */
  expiresIn: number;
  renewalCost?: number;
  ownerType?: DocumentOwnerType;
  ownerName?: string;
  employee?: EmployeeKey;
  notes?: string;
}

/** Who issues company papers in Kuwait. */
export const MOCI = both('Ministry of Commerce and Industry', 'وزارة التجارة والصناعة');

export const VEHICLE = both(
  'Toyota Hilux double cab, plate 18/62417',
  'تويوتا هايلوكس غمارتين، لوحة 18/62417',
);

export const REGISTER: RegisterSeed[] = [
  {
    type: 'commercial_licence',
    number: COMPANY.licenceNumber,
    issuer: MOCI,
    expiresIn: 38,
    renewalCost: 120,
  },
  {
    type: 'commercial_registration',
    number: COMPANY.crNumber,
    issuer: MOCI,
    expiresIn: 292,
  },
  {
    type: 'pam_company_file',
    number: COMPANY.pamFileNumber,
    issuer: both('Public Authority for Manpower', 'الهيئة العامة للقوى العاملة'),
    expiresIn: 151,
    renewalCost: 25,
  },
  {
    type: 'authorised_signatories',
    issuer: MOCI,
    expiresIn: 243,
  },
  {
    type: 'mof_tax_card',
    number: COMPANY.mofTaxCardNumber,
    issuer: both('Ministry of Finance', 'وزارة المالية'),
    expiresIn: 207,
    renewalCost: 10,
  },
  {
    type: 'municipality_licence',
    title: both('Signage licence, Al-Rai showroom', 'ترخيص اللوحة الإعلانية، معرض الري'),
    issuer: both('Kuwait Municipality', 'بلدية الكويت'),
    expiresIn: 118,
    renewalCost: 45,
  },
  {
    type: 'fire_licence',
    title: both('Fire safety licence, Shuwaikh store', 'ترخيص الإطفاء، مستودع الشويخ'),
    issuer: both('Kuwait Fire Force', 'قوة الإطفاء العام'),
    expiresIn: 24,
    renewalCost: 60,
  },
  {
    type: 'lease_contract',
    title: both('Lease, Shuwaikh office and store', 'عقد إيجار مكتب ومستودع الشويخ'),
    issuer: both('Al Tilal Real Estate Co.', 'شركة التلال العقارية'),
    expiresIn: 301,
  },
  {
    type: 'lease_contract',
    title: both('Lease, Al-Rai showroom', 'عقد إيجار معرض الري'),
    issuer: both('Al Tilal Real Estate Co.', 'شركة التلال العقارية'),
    expiresIn: 76,
    notes:
      'Renewal terms to be agreed two months before expiry.\n' +
      'يُتفق على شروط التجديد قبل الانتهاء بشهرين.',
  },
  {
    type: 'vehicle_insurance',
    ownerType: 'vehicle',
    ownerName: VEHICLE,
    number: 'MTR-2025-558214',
    expiresIn: -4,
    renewalCost: 185,
  },
  {
    type: 'driving_licence',
    ownerType: 'employee',
    employee: 'asif',
    number: '290010898115',
    issuer: both('Ministry of Interior', 'وزارة الداخلية'),
    expiresIn: 412,
  },
  {
    type: 'health_insurance',
    ownerType: 'employee',
    employee: 'rajesh',
    issuer: both('Ministry of Health', 'وزارة الصحة'),
    expiresIn: 20,
    renewalCost: 50,
  },
];
