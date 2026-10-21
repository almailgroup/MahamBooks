// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import type {
  Client,
  Company,
  DocumentLanguage,
  DocumentLayout,
  InvoiceDocument,
} from '@/db/types';
import { computeDocument } from '@/lib/document-calc';
import { registerFonts, type FontId } from './fonts';
import { buildRenderModel, type BuildModelOptions } from './model';
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
  options?: Partial<BuildModelOptions>;
};

/** The company with a layout for every document. */
const laidOut =
  (layout: DocumentLayout): (() => Company) =>
  () => ({
    ...company,
    branding: { ...company.branding, layout },
  });

/** Lines picked from items, the first with a picture. */
const pictured = (doc: InvoiceDocument): InvoiceDocument => ({
  ...doc,
  items: doc.items.map((item, i) => ({ ...item, productId: `item-${i}` })),
});

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
    name: 'draft with signature and stamp',
    languages: ['en', 'ar-en'],
    company: () => ({
      ...company,
      branding: { ...company.branding, signature: IMAGE, stamp: IMAGE },
    }),
    doc: (l) => sampleDocument(company, client, 'invoice', { status: 'draft' }, l),
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
    name: 'quote with every layout option',
    company: laidOut({
      logoPosition: 'center',
      logoSize: 'large',
      showSku: true,
      showItemImages: true,
      showAcceptance: true,
    }),
    options: { itemImages: { 'item-0': IMAGE, 'item-2': IMAGE } },
    doc: (l) =>
      pictured(
        sampleDocument(
          company,
          client,
          'quote',
          { intro: 'Further to your request, we are pleased to quote as follows.' },
          l,
        ),
      ),
  },
  {
    name: 'paid proforma with a small logo on top and the acceptance box',
    company: laidOut({ logoPosition: 'start', logoSize: 'small', showAcceptance: true }),
    doc: (l) =>
      sampleDocument(company, client, 'invoice', { type: 'proforma', status: 'accepted' }, l),
  },
  {
    name: 'invoice with the logo on top at the end, SKUs and many lines',
    company: laidOut({ logoPosition: 'end', showSku: true }),
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        { items: sampleLongItems().map((item, i) => ({ ...item, sku: `SKU-${i}` })) },
        l,
      ),
  },
  {
    name: 'large logo where the template puts it, with a delivery note',
    company: laidOut({ logoSize: 'large', showSku: true }),
    doc: (l) =>
      sampleDocument(
        company,
        client,
        'invoice',
        {
          type: 'delivery_note',
          status: 'draft',
          items: sampleGoods().map((item) => ({ ...item, sku: 'LBL-100' })),
          dueDate: null,
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
        { qrCode: qr, language, ...variant.options },
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

/** The words of a PDF, without spaces (letter-spaced words come out spaced). */
async function pdfText(pdf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const words: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const item of content.items) if ('str' in item) words.push(item.str);
  }
  await task.destroy();
  return words.join('').replace(/\s+/g, '');
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  const render = async (status: 'draft' | 'sent') => {
    const doc = sampleDocument(company, client, 'invoice', { status }, 'ar-en');
    const model = buildRenderModel(doc, company, client, { language: 'ar-en' });
    return pdfText(await renderToBuffer(createPdfElement(model, template.id).element));
  };

  it('draws the Draft watermark on drafts only', async () => {
    const draft = await render('draft');
    expect(draft).toContain('مسودة');
    expect(draft).toContain('DRAFT');
    const sent = await render('sent');
    expect(sent).not.toContain('مسودة');
    expect(sent).not.toContain('DRAFT');
  }, 30000);
});

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  it('prints the introduction, the SKUs and the acceptance box of a quote', async () => {
    const own: Company = {
      ...company,
      branding: {
        ...company.branding,
        byType: { quote: { layout: { showSku: true, showAcceptance: true, logoPosition: 'end' } } },
      },
    };
    const doc = sampleDocument(own, client, 'quote', { intro: 'Further to your request' }, 'ar-en');
    const model = buildRenderModel(doc, own, client, { language: 'ar-en' });
    const text = (
      await pdfText(await renderToBuffer(createPdfElement(model, template.id).element))
    ).toLowerCase();
    expect(text).toContain('furthertoyourrequest');
    expect(text).toContain('dsg-101');
    expect(text).toContain('customeracceptance');
    expect(text).toContain('weacceptthisofferanditsterms.');
    // Invoices keep the company's layout: none of it.
    const invoice = sampleDocument(own, client, 'invoice', {}, 'ar-en');
    const plain = await pdfText(
      await renderToBuffer(
        createPdfElement(buildRenderModel(invoice, own, client, { language: 'ar-en' }), template.id)
          .element,
      ),
    );
    expect(plain).not.toContain('DSG-101');
    expect(plain.toLowerCase()).not.toContain('customeracceptance');
  }, 30000);
});

type Box = [number, number, number, number];
type Matrix = [number, number, number, number, number, number];

/**
 * What the first page paints, in order: shapes filled and pictures, each with
 * the box it covers on the page (text is left out).
 */
async function paints(pdf: Buffer): Promise<{ kind: 'fill' | 'image'; box: Box }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { OPS } = pdfjs;
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const list = await (await doc.getPage(1)).getOperatorList();
  await task.destroy();
  const fills = new Set<number>([
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const times = (m: Matrix, n: Matrix): Matrix => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
  const onPage = (m: Matrix, [x0, y0, x1, y1]: Box): Box => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [
      [x0, y0],
      [x0, y1],
      [x1, y0],
      [x1, y1],
    ]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const out: { kind: 'fill' | 'image'; box: Box }[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let path: Box | null = null;
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = times(args as Matrix, ctm);
    else if (fn === OPS.constructPath) {
      // The path's own box (none for an empty one).
      const minMax = args[2] as ArrayLike<number> | null;
      path = minMax ? onPage(ctm, Array.from(minMax) as Box) : null;
      if (path && fills.has(args[0] as number)) out.push({ kind: 'fill', box: path });
    } else if (fills.has(fn) && path) out.push({ kind: 'fill', box: path });
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      out.push({ kind: 'image', box: onPage(ctm, [0, 0, 1, 1]) });
    }
  });
  return out;
}

const overlap = (a: Box, b: Box) =>
  Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 &&
  Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1;

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  it.each(['start', 'center', 'end'] as const)(
    'draws the logo on its own line (%s) over anything drawn there',
    async (logoPosition) => {
      for (const language of ['en', 'ar'] as const) {
        const own = laidOut({ logoPosition })();
        const doc = sampleDocument(own, client, 'invoice', {}, language);
        const model = buildRenderModel(doc, own, client, { language });
        const painted = await paints(
          await renderToBuffer(createPdfElement(model, template.id).element),
        );
        // The logo is the only picture: no QR code, signature or stamp here.
        const at = painted.findIndex((p) => p.kind === 'image');
        expect(at, language).toBeGreaterThanOrEqual(0);
        const logo = painted[at].box;
        const over = painted.slice(at + 1).filter((p) => overlap(p.box, logo));
        expect(over, `${language}: shapes drawn over the logo`).toEqual([]);
      }
    },
    30000,
  );
});

/** The words of the first page, with the box each takes. */
async function placedWords(pdf: Buffer): Promise<{ text: string; box: Box }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const content = await (await doc.getPage(1)).getTextContent();
  await task.destroy();
  return content.items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return [];
    const [x, y] = [item.transform[4] as number, item.transform[5] as number];
    return [{ text: item.str, box: [x, y, x + item.width, y + item.height] as Box }];
  });
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  it('keeps the status stamp off the amount due, with the logo on its own line or not', async () => {
    const layouts: (DocumentLayout | undefined)[] = [
      undefined,
      { logoPosition: 'end' },
      { logoPosition: 'end', logoSize: 'large' },
      { logoPosition: 'start', logoSize: 'small' },
    ];
    const plain = (text: string) => text.replace(/\s+/g, '').toUpperCase();
    for (const language of LANGUAGES) {
      for (const layout of layouts) {
        const own = layout ? laidOut(layout)() : company;
        const doc = sampleDocument(own, client, 'invoice', { status: 'paid' }, language);
        const model = buildRenderModel(doc, own, client, { language });
        const words = await placedWords(
          await renderToBuffer(createPdfElement(model, template.id).element),
        );
        const stamp = words.find((w) => plain(w.text).includes(plain(model.stamp!.text)));
        expect(stamp, `${language}: the stamp`).toBeDefined();
        // The stamp's frame, a little turned, takes a little more than its word.
        const [x0, y0, x1, y1] = stamp!.box;
        const frame: Box = [x0 - 8, y0 - 6, x1 + 8, y1 + 6];
        const figure = model.amountDue.value.match(/[\d.,]*\d/)![0];
        const amounts = words.filter((w) => w.text.includes(figure));
        expect(amounts.length, `${language}: the amount due`).toBeGreaterThan(0);
        const covered = amounts.filter((w) => overlap(w.box, frame));
        expect(covered, `${language}, ${JSON.stringify(layout ?? null)}`).toEqual([]);
      }
    }
  }, 60000);
});

it('keeps a company’s longer wording for drafts on the page', async () => {
  const own: Company = { ...company, labels: { draftStamp: 'Draft copy, not for payment' } };
  const doc = sampleDocument(own, client, 'invoice', { status: 'draft' }, 'en');
  const model = buildRenderModel(doc, own, client, { language: 'en' });
  const text = await pdfText(await renderToBuffer(createPdfElement(model, 'modern').element));
  expect(text).toContain('DRAFTCOPY,NOTFORPAYMENT');
}, 30000);

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
