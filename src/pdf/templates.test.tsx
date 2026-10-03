// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import type { Client, Company, DocumentLanguage, InvoiceDocument } from '@/db/types';
import { computeDocument } from '@/lib/document-calc';
import { registerFonts, type FontId } from './fonts';
import { buildRenderModel } from './model';
import { createPdfElement } from './element';
import { TEMPLATES } from './templates';
import {
  sampleClient,
  sampleCompany,
  sampleDocument,
  sampleGoods,
  sampleLongItems,
} from './sample';

// Valid 4x2 PNG, enough to exercise the logo, signature and stamp code paths.
// (A corrupt image makes react-pdf hang, which is why the app re-encodes uploads.)
const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEUlEQVR4nGPgL8v7j4wZ0AUA/ZIPkShBFuMAAAAASUVORK5CYII=';

const fontDir = join(import.meta.dirname, 'fonts');
const allFonts: FontId[] = [
  'inter',
  'manrope',
  'plexsans',
  'jetbrainsmono',
  'playfair',
  'lora',
  'spacegrotesk',
  'dmserif',
  'plexarabic',
];

let qr = '';
const company: Company = sampleCompany();
company.branding.logo = IMAGE;
const client: Client = sampleClient(company.id);

type Variant = {
  name: string;
  /** Languages to render in; all three Kuwaiti ones when missing. */
  languages?: DocumentLanguage[];
  doc: (language: DocumentLanguage) => InvoiceDocument;
  company?: () => Company;
  client?: () => Client | null;
};

const LANGUAGES: DocumentLanguage[] = ['en', 'ar', 'ar-en'];

const variants: Variant[] = [
  { name: 'invoice', doc: (l) => sampleDocument(company, client, 'invoice', {}, l) },
  { name: 'quote', doc: (l) => sampleDocument(company, client, 'quote', {}, l) },
  { name: 'credit', doc: (l) => sampleDocument(company, client, 'credit', {}, l) },
  {
    name: 'proforma',
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        { type: 'proforma', number: 'PF-2026-0004', deposit: 500, depositDueDate: '2026-10-15' },
        l,
      ),
  },
  {
    name: 'sales order',
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        {
          type: 'sales_order',
          number: 'SO-2026-0011',
          status: 'confirmed',
          dueDate: null,
          deliveryDate: '2026-10-20',
        },
        l,
      ),
  },
  {
    name: 'purchase order',
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        {
          type: 'purchase_order',
          number: 'PO-2026-0007',
          status: 'issued',
          dueDate: null,
          deliveryPlace: 'Warehouse 4, Shuwaikh Industrial',
        },
        l,
      ),
  },
  {
    name: 'delivery note',
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        {
          type: 'delivery_note',
          number: 'DN-2026-0009',
          status: 'delivered',
          items: sampleGoods(),
          dueDate: null,
          notes: '',
          terms: '',
          deliveryDate: '2026-10-03',
          deliveryPlace: 'Warehouse 4, Shuwaikh Industrial',
          receiverName: 'Ahmad Al-Mutairi',
          receiverCivilId: '287010112349',
        },
        l,
      ),
  },
  {
    name: 'multi-page',
    doc: (l) => sampleDocument(company, client, 'invoice', { items: sampleLongItems() }, l),
  },
  {
    name: 'bare',
    company: () => ({
      ...company,
      nameAr: undefined,
      branding: { ...company.branding, logo: null },
      payment: { bankDetails: '', instructions: '', paymentLink: '', showQrCode: false },
      kuwait: undefined,
    }),
    client: () => null,
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        { number: '', items: [], notes: '', terms: '', poNumber: '', dueDate: null },
        l,
      ),
  },
  {
    name: 'paid with signature and stamp',
    languages: ['en', 'ar-en'],
    company: () => ({
      ...company,
      branding: { ...company.branding, signature: IMAGE, stamp: IMAGE },
      defaults: { ...company.defaults, showHijriDate: true },
    }),
    doc: (l) => {
      const doc = sampleDocument(company, client, 'invoice', {}, l);
      const total = computeDocument(doc).total;
      return {
        ...doc,
        status: 'paid',
        totals: { subtotal: 0, discount: 0, taxTotal: 0, total: 0, paid: total, balance: 0 },
      };
    },
  },
  {
    name: 'goods with delivery',
    languages: ['ar-en'],
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        {
          items: sampleGoods(),
          deliveryDate: '2026-10-05',
          deliveryPlace: 'Shuwaikh Industrial, Block 2',
          paymentLink: {
            provider: 'myfatoorah',
            url: 'https://pay.example.com/x',
            expiresAt: null,
          },
        },
        l,
      ),
  },
  {
    name: 'inclusive-fr-letter',
    languages: ['fr'],
    company: () => ({
      ...company,
      language: 'fr',
      locale: 'fr-FR',
      currency: 'EUR',
      defaults: { ...company.defaults, pageSize: 'LETTER' },
    }),
    client: () => ({
      ...client,
      shippingAddress: { ...client.address, line1: 'Entrepôt 2', city: 'Lyon', country: 'FR' },
    }),
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        {
          currency: 'EUR',
          pricesIncludeTax: true,
          discount: 5,
          discountType: 'percent',
          charges: [
            { id: 'c1', label: 'Livraison', amount: 25, taxes: [{ name: 'TVA', rate: 20 }] },
          ],
          deposit: 1000,
          depositDueDate: '2026-10-15',
        },
        l,
      ),
  },
];

const cases = variants.flatMap((v) =>
  (v.languages ?? LANGUAGES).map((language) => [`${v.name} (${language})`, v, language] as const),
);

beforeAll(async () => {
  registerFonts(allFonts, (file) => join(fontDir, file));
  qr = await QRCode.toDataURL('https://pay.example.com/test', { margin: 0, width: 120 });
});

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  it.each(cases)(
    'renders %s',
    async (_name, variant, language) => {
      const model = buildRenderModel(
        variant.doc(language),
        variant.company?.() ?? company,
        variant.client ? variant.client() : client,
        { qrCode: qr, language },
      );
      expect(model.dir).toBe(language.startsWith('ar') ? 'rtl' : 'ltr');
      const { element } = createPdfElement(model, template.id);
      const pdf = await renderToBuffer(element);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(2000);
    },
    30000,
  );
});

describe('template registry', () => {
  it('has unique ids and complete metadata', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.defaultAccent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
