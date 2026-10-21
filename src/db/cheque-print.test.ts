import { beforeEach, describe, expect, it } from 'vitest';
import { db, setMeta } from './db';
import { createClient } from './defaults';
import { saveClient, saveCompany, setupCompany } from './records';
import { cancelCheque } from './cheques';
import { createPayment, newCheque, PaymentError, savePayment } from './payments';
import {
  archiveChequeLayout,
  ChequePrintError,
  deviceChequeOffset,
  recordChequePrinted,
  recordSpoiledLeaf,
  saveChequeLayout,
  setDeviceChequeOffset,
} from './cheque-print';
import type { ChequePrintedText, Company, Payment } from './types';
import { layoutFor, presetLayout } from '@/lib/cheque-layouts';
import { printRefusal } from '@/lib/cheque-print';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const TEXT: ChequePrintedText = {
  date: '15/11/2026',
  payee: 'Example Supplies Co.',
  words: ['فقط ألف ومائتان وخمسون دينارًا كويتيًا', 'وسبعمائة وخمسون فلسًا لا غير'],
  figures: '**1,250.750**',
  layoutVersion: 1,
};

async function company(printing = true): Promise<Company> {
  const created = await setupCompany({
    name: 'Example Trading',
    currency: 'KWD',
    locale: 'en-KW',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'KW' },
  });
  return printing ? saveCompany({ ...created, chequePrinting: true }) : created;
}

async function issued(c: Company, number = '100045'): Promise<Payment> {
  const vendor = await saveClient(
    createClient(c.id, { name: 'Example Supplies Co.', isVendor: true }),
  );
  return savePayment(
    createPayment(c.id, {
      direction: 'out',
      clientId: vendor.id,
      date: '2026-10-20',
      amount: 1250.75,
      currency: 'KWD',
      method: 'cheque',
      reference: number,
      cheque: newCheque({ number, bank: 'BRGN', date: '2026-11-15', drawer: '' }),
    }),
  );
}

const print = (payment: Payment, crossed = false) =>
  recordChequePrinted(payment.id, { layout: { id: 'preset-BRGN' }, text: TEXT, crossed });

/** The cloud link of a company, with or without the v16 tables on its server. */
async function inCloud(c: Company, features: string[]) {
  await db.syncState.put({
    companyId: c.id,
    userId: 'user-1',
    role: 'owner',
    status: 'ready',
    cursor: 0,
    name: c.name,
    linkedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    features: features as never,
  });
}

describe('printing a cheque issued', () => {
  it('records the print with what was printed, and counts it', async () => {
    const c = await company();
    const payment = await issued(c);
    const printed = await print(payment, true);
    expect(printed.cheque).toMatchObject({
      number: '100045',
      printCount: 1,
      printedLayoutId: 'preset-BRGN',
      printedText: TEXT,
      crossed: true,
    });
    expect(printed.cheque?.printedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await db.payments.get(payment.id)).toEqual(printed);
    const log = await db.activities.where('entityId').equals(payment.id).toArray();
    expect(log.map((a) => a.message)).toContain(
      `Cheque 100045 on payment ${payment.number} printed`,
    );
    // Nothing is posted: the payment's entries are as they were.
    expect(printed.accountId).toBe(payment.accountId);
  });

  it('prints once: printing again needs the leaf spoiled first', async () => {
    const c = await company();
    const payment = await print(await issued(c));
    await expect(print(payment)).rejects.toThrow(/mark its leaf spoiled first/);
  });

  it('refuses when printing is off, and cheques that are void or received', async () => {
    const off = await company(false);
    await expect(print(await issued(off))).rejects.toThrow(/Cheque printing is off/);

    const c = await company();
    const cancelled = await issued(c, '100050');
    await cancelCheque(cancelled.id, { date: '2026-10-21', reason: 'Not needed' });
    await expect(print(cancelled)).rejects.toThrow(ChequePrintError);

    const received = await savePayment(
      createPayment(c.id, {
        clientId: (await saveClient(createClient(c.id, { name: 'A customer' }))).id,
        date: '2026-10-20',
        amount: 5,
        method: 'cheque',
        cheque: newCheque({ number: '7', bank: 'NBOK', drawer: 'A customer' }),
      }),
    );
    await expect(print(received)).rejects.toThrow(/Only cheques the company issues/);
  });
});

describe('spoiled leaves', () => {
  it('record a misprint and move the cheque to the next leaf', async () => {
    const c = await company();
    const payment = await issued(c);
    const next = await recordSpoiledLeaf(payment.id, {
      reason: 'Paper jam',
      nextNumber: '100046',
      text: TEXT,
    });
    expect(next.cheque).toMatchObject({ number: '100046', printCount: 1 });
    expect(next.cheque?.printedAt).toBeUndefined();
    expect(next.cheque?.spoiledLeaves).toEqual([
      { number: '100045', at: expect.any(String), reason: 'Paper jam', printedText: TEXT },
    ]);
    // The reference was the cheque number: it follows it.
    expect(next.reference).toBe('100046');
    // It can be printed on the new leaf.
    const printed = await print(next);
    expect(printed.cheque).toMatchObject({ number: '100046', printCount: 2 });
  });

  it('take the print off a printed cheque so it can print again', async () => {
    const c = await company();
    const printed = await print(await issued(c), true);
    const next = await recordSpoiledLeaf(printed.id, {
      reason: 'Printed again',
      nextNumber: '100046',
    });
    expect(next.cheque).toMatchObject({ number: '100046', printCount: 1 });
    expect(next.cheque).not.toHaveProperty('printedAt');
    expect(next.cheque).not.toHaveProperty('crossed');
    expect(next.cheque?.spoiledLeaves?.[0]).toMatchObject({
      number: '100045',
      reason: 'Printed again',
      printedText: TEXT,
    });
    expect((await print(next)).cheque?.printCount).toBe(2);
  });

  it('need a new leaf number that no other cheque on the bank has', async () => {
    const c = await company();
    const payment = await issued(c, '100045');
    const other = await issued(c, '100046');
    await expect(recordSpoiledLeaf(payment.id, { reason: 'x', nextNumber: ' ' })).rejects.toThrow(
      /next leaf/,
    );
    await expect(
      recordSpoiledLeaf(payment.id, { reason: 'x', nextNumber: '100045' }),
    ).rejects.toThrow(/spoiled/);
    await expect(
      recordSpoiledLeaf(payment.id, { reason: 'x', nextNumber: '100046' }),
    ).rejects.toThrow(`already recorded on payment ${other.number}`);
    const moved = await recordSpoiledLeaf(payment.id, { reason: 'x', nextNumber: '100047' });
    await expect(
      recordSpoiledLeaf(moved.id, { reason: 'x', nextNumber: '100045' }),
    ).rejects.toThrow(/spoiled/);
  });
});

describe('a printed cheque changed in the form', () => {
  it('keeps its print record when other things change', async () => {
    const c = await company();
    const printed = await print(await issued(c));
    // The form sends what it loaded before the print, without its record.
    const fromForm = { ...printed, notes: 'Handed over', cheque: { ...printed.cheque! } };
    delete fromForm.cheque.printedAt;
    delete fromForm.cheque.printedText;
    const saved = await savePayment(fromForm);
    expect(saved.cheque).toMatchObject({ printCount: 1, printedText: TEXT });
    expect(saved.cheque?.printedAt).toBe(printed.cheque?.printedAt);
    expect(saved.cheque?.spoiledLeaves).toBeUndefined();
  });

  it('marks the printed leaf spoiled when its amount, payee or number changes', async () => {
    const c = await company();
    const printed = await print(await issued(c));
    const saved = await savePayment({
      ...printed,
      amount: 1300,
      cheque: { ...printed.cheque!, number: '100046' },
    });
    expect(saved.cheque).toMatchObject({ number: '100046', printCount: 1 });
    expect(saved.cheque?.printedAt).toBeUndefined();
    expect(saved.cheque?.spoiledLeaves).toEqual([
      {
        number: '100045',
        at: expect.any(String),
        reason: 'Changed after printing',
        printedText: TEXT,
      },
    ]);
    const log = await db.activities.where('entityId').equals(printed.id).toArray();
    expect(log.map((a) => a.action)).toContain('cheque_leaf_spoiled');
  });

  it('left on its spoiled leaf, moves to the next one before it prints', async () => {
    const c = await company();
    const printed = await print(await issued(c));
    // Only the amount changed: the number is still that of the spoiled leaf.
    const changed = await savePayment({ ...printed, amount: 1300 });
    expect(changed.cheque?.spoiledLeaves).toHaveLength(1);
    expect(printRefusal(changed)).toBe('leaf_spoiled');
    await expect(print(changed)).rejects.toThrow(/The leaf with this number is spoiled/);
    // Its notes can still change.
    await savePayment({ ...changed, notes: 'Signed by the owner' });

    const moved = await recordSpoiledLeaf(changed.id, { reason: '', nextNumber: '100046' });
    expect(moved.cheque?.number).toBe('100046');
    expect(moved.cheque?.spoiledLeaves).toHaveLength(1);
    const log = await db.activities.where('entityId').equals(changed.id).toArray();
    expect(log.map((a) => a.action)).toContain('cheque_leaf_changed');
    expect(printRefusal(moved)).toBeNull();
    expect((await print(moved)).cheque?.printCount).toBe(2);
  });

  it('never takes the number of a spoiled leaf again', async () => {
    const c = await company();
    const spoiled = await recordSpoiledLeaf((await issued(c, '100045')).id, {
      reason: 'Torn',
      nextNumber: '100046',
      text: TEXT,
    });
    expect(spoiled.cheque?.number).toBe('100046');
    const other = await issued(c, '100050');
    await expect(
      savePayment({ ...other, cheque: { ...other.cheque!, number: '100045' } }),
    ).rejects.toThrow('Leaf 100045 is spoiled: enter the next one.');
    await expect(
      recordSpoiledLeaf(other.id, { reason: 'x', nextNumber: '100045' }),
    ).rejects.toThrow('Leaf 100045 is spoiled: enter the next one.');
    // On another bank, the same number is another leaf.
    const kfh = await savePayment({
      ...other,
      cheque: { ...other.cheque!, bank: 'KFHO', number: '100045' },
    });
    expect(kfh.cheque?.number).toBe('100045');
  });

  it('can’t become another kind of payment', async () => {
    const c = await company();
    const printed = await print(await issued(c));
    await expect(
      savePayment({ ...printed, method: 'bank_transfer', cheque: null }),
    ).rejects.toThrow(PaymentError);
    await expect(
      savePayment({ ...printed, method: 'bank_transfer', cheque: null }),
    ).rejects.toThrow(/Cancel the cheque instead/);
  });

  it('a new cheque copied from a printed one is not printed', async () => {
    const c = await company();
    const printed = await print(await issued(c));
    const copy = await savePayment(
      createPayment(c.id, {
        ...printed,
        id: 'copy-1',
        number: '',
        cheque: { ...printed.cheque!, number: '100099' },
      }),
    );
    expect(copy.cheque?.printedAt).toBeUndefined();
    expect(copy.cheque?.printCount).toBeUndefined();
  });
});

describe('cheque layouts', () => {
  it('save a built-in layout as the company’s own, which then prints', async () => {
    const c = await company();
    const preset = presetLayout('KFHO', c.id)!;
    await setDeviceChequeOffset(preset.id, { x: 0.5, y: -1 });
    const saved = await saveChequeLayout({
      ...preset,
      fields: { ...preset.fields, figures: { ...preset.fields.figures, x: 135 } },
    });
    expect(saved.id).not.toBe(preset.id);
    expect(saved).toMatchObject({ companyId: c.id, bank: 'KFHO', version: 2, archived: false });
    const all = await db.chequeLayouts.toArray();
    expect(layoutFor('KFHO', all)?.id).toBe(saved.id);
    // This printer's offset came along.
    expect(await deviceChequeOffset(saved)).toEqual({ x: 0.5, y: -1 });

    const renamed = await saveChequeLayout({ ...saved, name: 'KFH, measured', calibrated: true });
    expect(renamed.version).toBe(2);
    const moved = await saveChequeLayout({ ...renamed, offset: { x: 1, y: 0 } });
    expect(moved.version).toBe(3);

    await archiveChequeLayout(moved.id);
    expect(layoutFor('KFHO', await db.chequeLayouts.toArray(), c.id)?.id).toBe('preset-KFHO');
    const log = (await db.activities.toArray()).filter((a) => a.entity === 'cheque');
    expect(log.map((a) => a.action).sort()).toEqual(['archived', 'created', 'updated', 'updated']);
  });

  it('refuse fields outside the leaf', async () => {
    const c = await company();
    const preset = presetLayout('BRGN', c.id)!;
    await expect(saveChequeLayout({ ...preset, size: { width: 120, height: 82 } })).rejects.toThrow(
      /inside the leaf/,
    );
  });

  it('wait for the latest database script in a cloud company', async () => {
    const c = await company();
    const preset = presetLayout('BRGN', c.id)!;
    await inCloud(c, []);
    await expect(saveChequeLayout(preset)).rejects.toThrow(/latest database script/);
    await inCloud(c, ['tables_v16']);
    expect((await saveChequeLayout(preset)).bank).toBe('BRGN');
  });
});

describe('this printer’s offset', () => {
  it('is kept per layout on the device, from the built-in one’s', async () => {
    expect(await deviceChequeOffset({ id: 'lay-1', bank: 'BRGN' })).toEqual({ x: 0, y: 0 });
    await setDeviceChequeOffset('preset-BRGN', { x: 1.04, y: 30 });
    expect(await deviceChequeOffset({ id: 'lay-1', bank: 'BRGN' })).toEqual({ x: 1, y: 15 });
    await setDeviceChequeOffset('lay-1', { x: -0.5, y: 0 });
    expect(await deviceChequeOffset({ id: 'lay-1', bank: 'BRGN' })).toEqual({ x: -0.5, y: 0 });
    await setMeta('cheque-offset:lay-2', 'nonsense');
    expect(await deviceChequeOffset({ id: 'lay-2', bank: 'KFHO' })).toEqual({ x: 0, y: 0 });
  });
});
