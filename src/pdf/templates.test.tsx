// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import type { Client, Company, InvoiceDocument } from '@/db/types';
import { registerFonts, type FontId } from './fonts';
import { buildRenderModel } from './model';
import { createPdfElement } from './element';
import { TEMPLATES } from './templates';
import { sampleClient, sampleCompany, sampleDocument, sampleLongItems } from './sample';

// Valid 4x2 PNG, enough to exercise the logo code paths. (A corrupt image
// makes react-pdf hang, which is why the app re-encodes uploaded logos.)
const LOGO =
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
company.branding.logo = LOGO;
const client: Client = sampleClient(company.id);

type Variant = {
  name: string;
  doc: () => InvoiceDocument;
  company?: () => Company;
  client?: () => Client | null;
};

const variants: Variant[] = [
  { name: 'invoice', doc: () => sampleDocument(company, client, 'invoice') },
  {
    name: 'paid',
    doc: () =>
      sampleDocument(company, client, 'invoice', {
        status: 'paid',
        totals: { subtotal: 0, discount: 0, taxTotal: 0, total: 0, paid: 9428.7, balance: 0 },
      }),
  },
  { name: 'quote', doc: () => sampleDocument(company, client, 'quote') },
  { name: 'credit', doc: () => sampleDocument(company, client, 'credit') },
  {
    name: 'multi-page',
    doc: () => sampleDocument(company, client, 'invoice', { items: sampleLongItems() }),
  },
  {
    name: 'bare',
    company: () => ({
      ...company,
      branding: { ...company.branding, logo: null },
      payment: { bankDetails: '', instructions: '', paymentLink: '', showQrCode: false },
    }),
    client: () => null,
    doc: () =>
      sampleDocument(company, client, 'invoice', {
        number: '',
        items: [],
        notes: '',
        terms: '',
        poNumber: '',
        dueDate: null,
      }),
  },
  {
    name: 'inclusive-fr-letter',
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
    doc: () =>
      sampleDocument(company, client, 'invoice', {
        currency: 'EUR',
        pricesIncludeTax: true,
        discount: 5,
        discountType: 'percent',
        charges: [{ id: 'c1', label: 'Livraison', amount: 25, taxes: [{ name: 'TVA', rate: 20 }] }],
        deposit: 1000,
        depositDueDate: '2026-10-15',
      }),
  },
];

beforeAll(async () => {
  registerFonts(allFonts, (file) => join(fontDir, file));
  qr = await QRCode.toDataURL('https://pay.example.com/test', { margin: 0, width: 120 });
});

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  it.each(variants.map((v) => [v.name, v] as const))(
    'renders %s',
    async (_name, variant) => {
      const model = buildRenderModel(
        variant.doc(),
        variant.company?.() ?? company,
        variant.client ? variant.client() : client,
        { qrCode: qr },
      );
      const { element } = createPdfElement(model, template.id);
      const pdf = await renderToBuffer(element);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(2000);
    },
    20000,
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
