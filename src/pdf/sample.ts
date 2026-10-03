import type {
  Client,
  Company,
  DocumentLanguage,
  InvoiceDocument,
  LineItem,
  SalesDocumentType,
} from '@/db/types';
import { createClient, createCompany, createDocument } from '@/db/defaults';
import { addDaysISO, today } from '@/lib/dates';
import { shortId } from '@/lib/ids';

/**
 * Sample data for template previews and tests: a fictional printing and
 * mailing W.L.L. in Salmiya billing a trading company in Shuwaikh, in
 * Kuwaiti dinars with fils.
 */

function item(partial: Partial<LineItem>): LineItem {
  return {
    id: shortId(),
    kind: 'item',
    productId: null,
    name: '',
    description: '',
    quantity: 1,
    unit: '',
    unitPrice: 0,
    discount: 0,
    discountType: 'percent',
    taxes: [],
    ...partial,
  };
}

/** Picks the sample text for a document language (bilingual uses both). */
function text(language: DocumentLanguage, english: string, arabic: string): string {
  if (language === 'ar') return arabic;
  if (language === 'ar-en') return `${arabic}\n${english}`;
  return english;
}

/** Fictional company used when the user has not filled in their own details yet. */
export function sampleCompany(): Company {
  return createCompany({
    id: 'sample-company',
    name: 'Al Waha Print & Mail',
    legalName: 'Al Waha Print & Mail Co. W.L.L.',
    nameAr: 'شركة الواحة للطباعة والبريد ذ.م.م',
    email: 'accounts@alwaha-print.example',
    phone: '+965 2575 0142',
    website: 'https://www.alwaha-print.example',
    taxIdLabel: 'Tax card no.',
    taxId: '',
    registrationLabel: 'CR No.',
    registrationNumber: '412785',
    address: {
      line1: '',
      line2: '',
      city: 'Salmiya',
      state: 'Hawalli',
      postalCode: '22001',
      country: 'KW',
      block: '10',
      street: '7',
      building: '27',
      floor: '4',
      unit: '12',
    },
    currency: 'KWD',
    locale: 'en-KW',
    dateFormat: 'dd/MM/yyyy',
    language: 'ar-en',
    kuwait: {
      legalForm: 'wll',
      licenceNumber: '2019/18452',
      activity: 'general',
      foreignOwnershipPercent: 0,
      capital: 50000,
      pamFileNumber: '',
      pifssEmployerNumber: '',
      mofTaxCardNumber: '',
      kcciNumber: '',
      digitalCommerceNumber: '',
      wamdPhone: '+965 9876 5432',
    },
    payment: {
      bankDetails: 'Al Waha Print & Mail Co. W.L.L.\nKW86NBOK0000000000002012345678',
      instructions: '',
      paymentLink: 'https://pay.example.com/alwaha',
      showQrCode: true,
    },
  });
}

export function sampleClient(companyId: string): Client {
  return createClient(companyId, {
    id: 'sample-client',
    number: 'C-0007',
    name: 'Al Rawda Trading Co.',
    nameAr: 'شركة الروضة التجارية',
    contacts: [
      {
        id: 'sample-contact',
        name: 'Fahad Al-Mutairi',
        email: 'accounts@alrawda.example',
        phone: '+965 2245 0199',
        primary: true,
      },
    ],
    email: 'accounts@alrawda.example',
    address: {
      line1: '',
      line2: '',
      city: 'Shuwaikh Industrial',
      state: 'Capital',
      postalCode: '',
      country: 'KW',
      block: '2',
      street: '24',
      building: '118',
    },
  });
}

export function sampleItems(language: DocumentLanguage = 'en'): LineItem[] {
  const arabic = language === 'ar';
  const unit = (english: string, ar: string) => (arabic ? ar : english);
  // Bilingual documents print the English name under the Arabic one, so the
  // descriptions stay in English there.
  const describe = (english: string, ar: string) => (arabic ? ar : english);
  return [
    item({
      name: 'Campaign design & artwork',
      nameAr: 'تصميم الحملة والأعمال الفنية',
      description: describe(
        'Layout, copy review and two rounds of proofs',
        'التصميم ومراجعة النصوص وجولتان من البروفات',
      ),
      quantity: 1,
      unit: unit('job', 'عمل'),
      unitPrice: 185,
    }),
    item({
      name: 'Full-colour letter printing',
      nameAr: 'طباعة رسائل ملونة',
      description: describe('A4, double-sided, 100gsm silk', 'مقاس A4، على الوجهين، ورق 100 غرام'),
      quantity: 12500,
      unit: unit('pcs', 'قطعة'),
      unitPrice: 0.028,
    }),
    item({
      name: 'Envelope inserting & sealing',
      nameAr: 'تعبئة الأظرف وإغلاقها',
      description: describe('C5 window envelopes, machine inserted', 'أظرف C5 بنافذة، تعبئة آلية'),
      quantity: 12500,
      unit: unit('pcs', 'قطعة'),
      unitPrice: 0.012,
    }),
    item({
      name: 'Local delivery — Kuwait City & Hawalli',
      nameAr: 'التوصيل المحلي — مدينة الكويت وحولي',
      description: describe('Sorted by area and block', 'مرتبة حسب المنطقة والقطعة'),
      quantity: 12500,
      unit: unit('pcs', 'قطعة'),
      unitPrice: 0.045,
    }),
    item({
      name: 'Project management',
      nameAr: 'إدارة المشروع',
      quantity: 6,
      unit: unit('hrs', 'ساعة'),
      unitPrice: 20,
      discount: 10,
    }),
  ];
}

/** Goods with their condition and serial numbers (MOCI invoices print both). */
export function sampleGoods(): LineItem[] {
  return [
    item({
      name: 'Thermal label printer',
      nameAr: 'طابعة ملصقات حرارية',
      description: '203 dpi, USB and Ethernet',
      quantity: 1,
      unit: 'pcs',
      unitPrice: 245.75,
      condition: 'new',
      serialNumber: 'ZT4-26-004217',
    }),
    item({
      name: 'Folding and inserting machine',
      nameAr: 'آلة طي وتعبئة الأظرف',
      description: 'Refurbished, 6-month warranty',
      quantity: 1,
      unit: 'pcs',
      unitPrice: 1180,
      condition: 'used',
      serialNumber: 'FP-DS85-88120',
    }),
    item({
      name: 'Label rolls 100 × 150 mm',
      nameAr: 'لفات ملصقات 100 × 150 مم',
      quantity: 24,
      unit: 'rolls',
      unitPrice: 3.125,
      condition: 'new',
    }),
  ];
}

export function sampleDocument(
  company: Company,
  client: Client,
  type: SalesDocumentType = 'invoice',
  overrides: Partial<InvoiceDocument> = {},
  language: DocumentLanguage = client.language ?? company.language,
): InvoiceDocument {
  const issue = today();
  const number = { invoice: 'INV-2026-0042', quote: 'QUO-2026-0018', credit: 'CN-2026-0003' }[type];
  return createDocument(company.id, type, {
    id: `sample-${type}`,
    number,
    status: 'sent',
    clientId: client.id,
    issueDate: issue,
    dueDate: addDaysISO(issue, type === 'quote' ? company.defaults.quoteValidDays : 30),
    poNumber: type === 'invoice' ? 'PO-77812' : '',
    currency: client.currency ?? company.currency,
    items: sampleItems(language),
    notes:
      type === 'quote'
        ? text(
            language,
            'Prices are valid for 30 days. We look forward to working with you.',
            'الأسعار صالحة لمدة 30 يوماً. نتطلع إلى العمل معكم.',
          )
        : text(
            language,
            'Thank you for your business. It was a pleasure working on this campaign.',
            'شكراً لتعاملكم معنا. سعدنا بالعمل على هذه الحملة.',
          ),
    terms:
      type === 'invoice'
        ? text(
            language,
            'Payment is due within 30 days of the invoice date by bank transfer, WAMD or the payment link.',
            'يستحق الدفع خلال 30 يوماً من تاريخ الفاتورة بالتحويل البنكي أو ومض أو رابط الدفع.',
          )
        : '',
    footer: company.defaults.footer,
    ...overrides,
  });
}

/** Many lines with section headings, used to check multi-page layouts. */
export function sampleLongItems(): LineItem[] {
  const sections: [string, string][] = [
    ['Print production', 'الإنتاج الطباعي'],
    ['Mail handling', 'تجهيز البريد'],
    ['Delivery', 'التوصيل'],
  ];
  const rows: LineItem[] = [];
  sections.forEach(([section, sectionAr], s) => {
    rows.push(item({ kind: 'heading', name: section, nameAr: sectionAr }));
    for (let i = 1; i <= 14; i++) {
      rows.push(
        item({
          name: `${section.split(' ')[0]} service ${s + 1}.${i}`,
          nameAr: `خدمة ${sectionAr} ${s + 1}.${i}`,
          description: i % 3 === 0 ? 'Includes quality control and proof approval' : '',
          quantity: 100 * i,
          unit: 'pcs',
          unitPrice: 0.125 + i / 1000,
          discount: i % 5 === 0 ? 5 : 0,
        }),
      );
    }
  });
  return rows;
}
