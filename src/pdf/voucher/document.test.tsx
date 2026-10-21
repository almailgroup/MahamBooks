// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/db/defaults';
import { createPayment, newCheque } from '@/db/payments';
import { createExpense } from '@/db/purchases';
import type { Company } from '@/db/types';
import { registerFonts } from '../fonts';
import { sampleCompany } from '../sample';
import { fitVoucher, pdfPageCount, VOUCHER_FONTS, voucherDocument } from './document';
import { buildVoucherModel } from './model';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const plain = sampleCompany();
const signed: Company = {
  ...plain,
  branding: { ...plain.branding, signature: PNG, stamp: PNG, signatureInk: 'blue' },
  vouchers: { images: true },
};
const customer = createClient(plain.id, {
  id: 'customer',
  name: 'Gulf Contracting Co.',
  nameAr: 'شركة الخليج للمقاولات',
});
const cheque = createPayment(plain.id, {
  number: 'PAY-2026-0007',
  date: '2026-10-20',
  clientId: customer.id,
  amount: 1250.75,
  method: 'cheque',
  reference: '004417',
  notes: 'Second stage of the fit-out.\nSee the quote of September.',
  cheque: newCheque({ number: '004417', bank: 'NBOK', date: '2026-11-01', drawer: customer.name }),
});
const expense = createExpense(plain.id, {
  number: 'EXP-2026-0004',
  date: '2026-10-19',
  amount: 36,
  currency: 'KWD',
  description: 'Courier envelopes',
  payee: 'مكتبة الشارع',
});

/** A PDF's own structure (its page boxes and objects), readable as text. */
const ascii = (buffer: Buffer) => buffer.toString('latin1');

beforeAll(() => {
  registerFonts(VOUCHER_FONTS, (file) => join(import.meta.dirname, '..', 'fonts', file));
});

describe('voucher PDF', () => {
  it('renders receipts, payments and expenses, signed or not, void or not', async () => {
    const models = [
      buildVoucherModel({
        kind: 'payment',
        source: cheque,
        company: plain,
        party: customer,
        documents: [{ number: 'INV-2026-0012' }],
      }),
      buildVoucherModel({
        kind: 'payment',
        source: { ...cheque, direction: 'out', number: 'PM-2026-0003' },
        company: signed,
        party: customer,
        documents: [{ number: 'BILL-0042' }],
      }),
      buildVoucherModel({
        kind: 'payment',
        source: { ...cheque, voided: true },
        company: signed,
        party: customer,
        documents: [],
      }),
      buildVoucherModel({
        kind: 'expense',
        source: expense,
        company: { ...signed, vouchers: { images: true, paper: 'A5' } },
        party: null,
        paidFrom: { name: 'Cash in hand', nameAr: 'النقدية' },
        category: null,
      }),
    ];
    const files = await Promise.all(models.map((m) => renderToBuffer(voucherDocument(m))));
    for (const file of files) expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // The signed one embeds the pictures; the plain and the void ones have none.
    expect(ascii(files[0])).not.toContain('/Subtype /Image');
    expect(ascii(files[1])).toContain('/Subtype /Image');
    expect(ascii(files[2])).not.toContain('/Subtype /Image');
    // A4 stands up; A5 lies on its side.
    expect(ascii(files[0])).toMatch(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/);
    expect(ascii(files[3])).toMatch(/\/MediaBox \[0 0 595\.\d+ 419\.\d+\]/);
    // VOUCHER_PDF_DIR=/some/dir keeps the files to look at them.
    const dir = process.env.VOUCHER_PDF_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      for (const [i, file] of files.entries()) {
        writeFileSync(join(dir, `voucher-${i + 1}.pdf`), file);
      }
    }
  }, 60_000);

  it('fits a long cheque voucher, signed and stamped, on one A5 page', async () => {
    const company: Company = {
      ...signed,
      branding: { ...signed.branding, logo: PNG },
      vouchers: { images: true, paper: 'A5' },
    };
    const long = createClient(plain.id, {
      id: 'long',
      name: 'Gulf Contracting and General Trading Co. W.L.L.',
      nameAr: 'شركة الخليج للمقاولات والتجارة العامة ذ.م.م',
    });
    const cases = [
      { notes: cheque.notes, documents: [{ number: 'INV-2026-0012' }] },
      {
        notes: '',
        documents: Array.from({ length: 6 }, (_, i) => ({ number: `INV-2026-00${i + 10}` })),
      },
      {
        notes: cheque.notes,
        documents: Array.from({ length: 6 }, (_, i) => ({ number: `INV-2026-00${i + 10}` })),
      },
    ];
    for (const [i, { notes, documents }] of cases.entries()) {
      for (const direction of ['in', 'out'] as const) {
        const model = buildVoucherModel({
          kind: 'payment',
          source: { ...cheque, notes, direction, cheque: { ...cheque.cheque!, drawer: long.name } },
          company,
          party: long,
          documents,
        });
        expect(model.company.address).not.toBeNull();
        expect(model.signatures.some((line) => line.signature && line.stamp)).toBe(true);
        const file = await fitVoucher(model, renderToBuffer, (buffer) => buffer);
        expect(pdfPageCount(file), `case ${i + 1}, money ${direction}`).toBe(1);
        expect(ascii(file)).toMatch(/\/MediaBox \[0 0 595\.\d+ 419\.\d+\]/);
        // The usual voucher fits as it is drawn; only the longest is drawn tighter.
        if (i === 0) expect(pdfPageCount(await renderToBuffer(voucherDocument(model)))).toBe(1);
      }
    }
    // A full page is never redrawn.
    const a4 = buildVoucherModel({
      kind: 'payment',
      source: cheque,
      company: { ...company, vouchers: { images: true } },
      party: long,
      documents: cases[2].documents,
    });
    let renders = 0;
    await fitVoucher(
      a4,
      (document) => {
        renders += 1;
        return renderToBuffer(document);
      },
      (buffer) => buffer,
    );
    expect(renders).toBe(1);
  }, 60_000);
});
