import { describe, expect, it } from 'vitest';
import type { ChequeDetails, Payment } from '@/db/types';
import {
  chequeDate,
  chequeFace,
  chequeFigures,
  chequePayee,
  fitFace,
  fitLine,
  fitWords,
  lostChequeLeaves,
  nextLeafNumber,
  printableAfterLeaf,
  printedFaceChanged,
  printedLeafChanged,
  printedLeafNumber,
  printRefusal,
  spoilPrintedLeaf,
  splitWords,
} from './cheque-print';
import {
  isPresetLayoutId,
  layoutBanks,
  layoutFor,
  layoutProblem,
  PRESET_BANKS,
  presetLayout,
  sameMeasurements,
} from './cheque-layouts';

const burgan = presetLayout('BRGN', 'co-1')!;
const kfh = presetLayout('KFHO', 'co-1')!;
const english = { ...kfh, wordsLanguage: 'en' as const };

/** Every character 1 mm wide at a 1 mm font. */
const measure = (text: string, size = 1) => text.length * size;

function issued(cheque: Partial<ChequeDetails> = {}, payment: Partial<Payment> = {}) {
  const details: ChequeDetails = {
    number: '100045',
    bank: 'BRGN',
    date: '2026-11-15',
    drawer: 'Example Supplies Co.',
    status: 'held',
    ...cheque,
  };
  return {
    method: 'cheque' as const,
    direction: 'out' as const,
    voided: false,
    currency: 'KWD',
    amount: 1250.75,
    clientId: 'v-1',
    cheque: details as ChequeDetails | null,
    ...payment,
  };
}

describe('the face of a cheque', () => {
  const face = (amount: number, layout = kfh) =>
    chequeFace({ amount, date: '2026-10-12', payee: ' Example Supplies Co. ' }, layout);

  it('writes the amount in Arabic words and in figures, to the fils', () => {
    expect(face(0.5)).toMatchObject({
      words: 'فقط خمسمائة فلس لا غير',
      figures: '**0.500**',
      amount: 0.5,
    });
    expect(face(1)).toMatchObject({
      words: 'فقط دينار كويتي واحد لا غير',
      figures: '**1.000**',
    });
    expect(face(1250.75)).toMatchObject({
      words: 'فقط ألف ومائتان وخمسون دينارًا كويتيًا وسبعمائة وخمسون فلسًا لا غير',
      figures: '**1,250.750**',
    });
    expect(face(100000)).toMatchObject({
      words: 'فقط مائة ألف دينار كويتي لا غير',
      figures: '**100,000.000**',
    });
  });

  it('or in English when the layout says so', () => {
    expect(face(0.5, english).words).toBe('Five Hundred Fils Only');
    expect(face(1, english).words).toBe('One Kuwaiti Dinar Only');
    expect(face(1250.75, english).words).toBe(
      'One Thousand Two Hundred Fifty Kuwaiti Dinars and Seven Hundred Fifty Fils Only',
    );
    expect(face(100000, english).words).toBe('One Hundred Thousand Kuwaiti Dinars Only');
  });

  it('rounds once, so the words and the figures say the same', () => {
    const f = face(12.3456, english);
    expect(f.amount).toBe(12.346);
    expect(f.figures).toBe('**12.346**');
    expect(f.words).toBe('Twelve Kuwaiti Dinars and Three Hundred Forty-Six Fils Only');
  });

  it('puts the prefix and the guards around the figures', () => {
    expect(chequeFigures(1250.75, { prefix: 'KD', guard: '**' })).toBe('KD **1,250.750**');
    expect(chequeFigures(1250.75, { prefix: ' ', guard: '#' })).toBe('#1,250.750#');
    expect(chequeFigures(7, { prefix: '', guard: '' })).toBe('7.000');
  });

  it('writes the date day first, or one digit per box', () => {
    expect(chequeDate('2026-10-12')).toBe('12/10/2026');
    expect(face(1).dateDigits).toBeNull();
    expect(face(1, burgan).dateDigits).toEqual(['1', '2', '1', '0', '2', '0', '2', '6']);
  });

  it('trims the payee and crosses only when asked', () => {
    expect(face(1).payee).toBe('Example Supplies Co.');
    expect(face(1).crossing).toBeNull();
    const crossed = chequeFace({ amount: 1, date: '2026-10-12', payee: 'X' }, kfh, {
      crossed: true,
    });
    expect(crossed.crossing).toEqual(['يصرف للمستفيد الأول', 'A/C Payee Only']);
  });

  it('is payable to the name typed on the cheque, else the vendor', () => {
    const vendor = { name: 'Example Supplies Co.', nameAr: 'شركة المثال' };
    expect(chequePayee({ drawer: ' Someone Else ' }, vendor, 'ar')).toBe('Someone Else');
    expect(chequePayee({ drawer: '' }, vendor, 'ar')).toBe('شركة المثال');
    expect(chequePayee({ drawer: '' }, vendor, 'en')).toBe('Example Supplies Co.');
    expect(chequePayee({ drawer: '' }, null, 'en')).toBe('');
  });
});

describe('the amount in words over two lines', () => {
  const text = 'One Thousand Two Hundred Fifty Kuwaiti Dinars and Seven Hundred Fifty Fils Only';

  it('keeps every word, in order', () => {
    for (const widths of [
      [10, 200],
      [30, 60],
      [60, 30],
      [5, 5],
      [500, 1],
    ] as const) {
      const { lines } = splitWords(text, widths, (t) => measure(t));
      expect(lines.filter(Boolean).join(' '), widths.join('x')).toBe(text);
    }
  });

  it('fills the first line and says when the second is too long', () => {
    const { lines, fits } = splitWords(text, [40, 60], (t) => measure(t));
    expect(lines[0].length).toBeLessThanOrEqual(40);
    expect(`${lines[0]} ${lines[1].split(' ')[0]}`.length).toBeGreaterThan(40);
    expect(fits).toBe(true);
    expect(splitWords(text, [10, 10], (t) => measure(t)).fits).toBe(false);
  });

  it('keeps Arabic conjunctions with their word', () => {
    const arabic = 'فقط ألف ومائتان وخمسون دينارًا كويتيًا وسبعمائة وخمسون فلسًا لا غير';
    const { lines } = splitWords(arabic, [30, 100], (t) => measure(t));
    expect(lines.join(' ').split(' ')).toEqual(arabic.split(' '));
    expect(lines.every((l) => !l.startsWith('و ') && !l.endsWith(' و'))).toBe(true);
  });

  it('gets smaller to fit, down to 70%', () => {
    const box = { x: 0, y: 0, width: 120, height: 7 };
    const roomy = fitWords(text, [box, box], measure);
    expect(roomy.fits).toBe(true);
    expect(roomy.size).toBeLessThan(3.85);
    const tight = fitWords(
      text,
      [
        { ...box, width: 10 },
        { ...box, width: 10 },
      ],
      measure,
    );
    expect(tight.fits).toBe(false);
    expect(tight.size).toBeCloseTo(3.85 * 0.7, 1);
    expect(tight.lines.filter(Boolean).join(' ')).toBe(text);
  });
});

describe('one-line fields', () => {
  const box = { x: 0, y: 0, width: 33, height: 8 };
  /** Every character half as wide as the font is high. */
  const half = (text: string, size: number) => text.length * size * 0.5;

  it('print at the usual size when they fit, smaller when they don’t', () => {
    expect(fitLine('**1.000**', box, half)).toEqual({ size: 4.2, fits: true });
    const large = fitLine('**100,000.000**', box, half);
    expect(large.fits).toBe(true);
    expect(large.size).toBeLessThan(4.2);
    expect(half('**100,000.000**', large.size)).toBeLessThanOrEqual(33 - 1.6);
    expect(fitLine('x'.repeat(40), box, half).fits).toBe(false);
  });

  it('make the whole face fit, or say what doesn’t', () => {
    const face = chequeFace({ amount: 1250.75, date: '2026-10-12', payee: 'Example Co.' }, kfh);
    const fit = fitFace(face, kfh, half);
    expect(fit.fits).toBe(true);
    expect(fit.words.lines.filter(Boolean).join(' ')).toBe(face.words);
    const long = chequeFace({ amount: 1, date: '2026-10-12', payee: 'x'.repeat(200) }, kfh);
    const tooLong = fitFace(long, kfh, half);
    expect(tooLong.payee.fits).toBe(false);
    expect(tooLong.fits).toBe(false);
    // Bold figures are measured as bold.
    const bold: string[] = [];
    fitFace(face, burgan, (text, _size, isBold) => {
      if (isBold) bold.push(text);
      return 0;
    });
    expect(bold).toEqual(['**1,250.750**']);
  });
});

describe('which cheques print', () => {
  it('prints a cheque issued in dinars that is still in hand', () => {
    expect(printRefusal(issued())).toBeNull();
  });

  it('refuses received, void, cancelled, cleared, returned and presented cheques', () => {
    expect(printRefusal(issued({}, { direction: 'in' }))).toBe('received');
    expect(printRefusal(issued({}, { direction: undefined }))).toBe('received');
    expect(printRefusal(issued({}, { voided: true }))).toBe('void');
    expect(printRefusal(issued({ status: 'cancelled' }, { voided: true }))).toBe('cancelled');
    expect(printRefusal(issued({ status: 'returned' }, { voided: true }))).toBe('returned');
    expect(printRefusal(issued({ status: 'cleared' }))).toBe('cleared');
    expect(printRefusal(issued({ status: 'deposited' }))).toBe('presented');
  });

  it('refuses other currencies, no amount, other methods and a second print', () => {
    expect(printRefusal(issued({}, { currency: 'USD' }))).toBe('currency');
    expect(printRefusal(issued({}, { amount: 0.0004 }))).toBe('amount');
    expect(printRefusal(issued({}, { method: 'bank_transfer' }))).toBe('not_cheque');
    expect(printRefusal({ ...issued(), cheque: null })).toBe('not_cheque');
    expect(printRefusal(issued({ printedAt: '2026-10-21T08:00:00.000Z' }))).toBe('printed');
  });

  it('asks for the next leaf when the cheque is on a spoiled one', () => {
    const leaf = { number: '100045', at: '2026-10-21T08:00:00.000Z', reason: 'Torn' };
    expect(printRefusal(issued({ spoiledLeaves: [leaf] }))).toBe('leaf_spoiled');
    expect(printRefusal(issued({ number: '100046', spoiledLeaves: [leaf] }))).toBeNull();
    expect(printableAfterLeaf('leaf_spoiled')).toBe(true);
    expect(printableAfterLeaf('printed')).toBe(true);
    expect(printableAfterLeaf(null)).toBe(true);
    expect(printableAfterLeaf('cleared')).toBe(false);
  });
});

describe('a printed cheque changed by an older version of the app', () => {
  // As this build records a print: with the leaf's number, bank and vendor.
  const printed = (cheque: Partial<ChequeDetails> = {}, payment: Partial<Payment> = {}) =>
    issued(
      {
        printedAt: '2026-10-21T08:00:00.000Z',
        printedLayoutId: 'preset-BRGN',
        printedText: {
          date: '15/11/2026',
          payee: 'Example Supplies Co.',
          words: ['a', 'b'],
          figures: 'KD **1,250.750**',
          layoutVersion: 1,
          number: '100045',
          bank: 'BRGN',
          vendorId: 'v-1',
        },
        ...cheque,
      },
      payment,
    );

  it('is printed while it says what the leaf says', () => {
    expect(printedLeafChanged(printed())).toBe(false);
    expect(printRefusal(printed())).toBe('printed');
    // The amount as printed, to the fils.
    expect(printedLeafChanged(printed({}, { amount: 1250.7504 }))).toBe(false);
  });

  it('is changed once its amount, currency, date, payee, number or bank differ from the print', () => {
    for (const changed of [
      printed({}, { amount: 1520 }),
      printed({}, { currency: 'USD' }),
      printed({ date: '2026-11-16' }),
      printed({ drawer: 'Another Co.' }),
      printed({ number: '100046' }),
      printed({ bank: 'KFHO' }),
    ]) {
      expect(printedLeafChanged(changed)).toBe(true);
      expect(printRefusal(changed)).toBe('changed');
    }
    expect(printableAfterLeaf('changed')).toBe(true);
    // The leaf's number is the one printed, not the cheque's now.
    expect(printedLeafNumber(printed({ number: '100046' }).cheque!)).toBe('100045');
    expect(printedLeafNumber(issued().cheque!)).toBe('100045');
  });

  it('printed with the vendor’s name, changes with another vendor', () => {
    const byVendor = printed({ drawer: '' });
    expect(printedLeafChanged(byVendor)).toBe(false);
    expect(printedLeafChanged({ ...byVendor, clientId: 'v-2' })).toBe(true);
    // With Pay to typed, the vendor isn't what was printed.
    expect(printedLeafChanged({ ...printed(), clientId: 'v-2' })).toBe(false);
  });

  it('can’t be compared with a print recorded without its text', () => {
    expect(printedLeafChanged(issued({ printedAt: '2026-10-21T08:00:00.000Z' }))).toBe(false);
    expect(printedLeafChanged(issued())).toBe(false);
  });

  it('loses its leaves when it stops being a cheque or is deleted', () => {
    const leaf = { number: '100044', at: '2026-10-20T08:00:00.000Z', reason: 'Torn' };
    const before = printed({ spoiledLeaves: [leaf] });
    expect(lostChequeLeaves(before, { cheque: null })).toEqual(['100045', '100044']);
    expect(lostChequeLeaves(before, null)).toEqual(['100045', '100044']);
    // Kept as they were (the amount changed): nothing lost.
    expect(lostChequeLeaves(before, printed({ spoiledLeaves: [leaf] }, { amount: 1520 }))).toEqual(
      [],
    );
    // This build spoils the printed leaf when it prints again: still recorded.
    const reprinted = issued({
      number: '100046',
      spoiledLeaves: [leaf, { ...leaf, number: '100045', reason: 'Printed again' }],
    });
    expect(lostChequeLeaves(before, reprinted)).toEqual([]);
    expect(lostChequeLeaves(issued(), { cheque: null })).toEqual([]);
    expect(lostChequeLeaves(null, before)).toEqual([]);
  });
});

describe('spoiled leaves', () => {
  it('move the cheque to the next leaf of the book', () => {
    expect(nextLeafNumber('000123')).toBe('000124');
    expect(nextLeafNumber('100099')).toBe('100100');
    expect(nextLeafNumber('999')).toBe('1000');
    expect(nextLeafNumber('CHQ-0099')).toBe('CHQ-0100');
    expect(nextLeafNumber(' 12 ')).toBe('13');
    expect(nextLeafNumber('A')).toBe('');
  });

  it('keep what was printed and take the print off the cheque', () => {
    const printed: ChequeDetails = {
      ...issued().cheque!,
      printedAt: '2026-10-21T08:00:00.000Z',
      printCount: 1,
      printedLayoutId: 'preset-BRGN',
      printedText: {
        date: '15/11/2026',
        payee: 'Example Supplies Co.',
        words: ['a', 'b'],
        figures: '**1,250.750**',
        layoutVersion: 1,
      },
      crossed: true,
    };
    const next = spoilPrintedLeaf(
      printed,
      { ...printed, number: '100046' },
      ' Paper jam ',
      '2026-10-21T09:00:00.000Z',
    );
    expect(next).not.toHaveProperty('printedAt');
    expect(next).not.toHaveProperty('printedText');
    expect(next).not.toHaveProperty('crossed');
    expect(next).toMatchObject({ number: '100046', printCount: 1 });
    expect(next.spoiledLeaves).toEqual([
      {
        number: '100045',
        at: '2026-10-21T09:00:00.000Z',
        reason: 'Paper jam',
        printedText: printed.printedText,
      },
    ]);
  });

  it('are needed when a printed cheque changes what its leaf says', () => {
    const printed = issued({ printedAt: '2026-10-21T08:00:00.000Z' });
    expect(printedFaceChanged(issued(), { ...issued(), amount: 2 })).toBe(false);
    expect(printedFaceChanged(printed, printed)).toBe(false);
    expect(printedFaceChanged(printed, { ...printed, amount: 1250.7504 })).toBe(false);
    expect(printedFaceChanged(printed, { ...printed, amount: 1250.76 })).toBe(true);
    expect(printedFaceChanged(printed, issued({ number: '100046' }))).toBe(true);
    expect(printedFaceChanged(printed, issued({ date: '2026-11-16' }))).toBe(true);
    expect(printedFaceChanged(printed, issued({ drawer: 'Another Co.' }))).toBe(true);
    expect(printedFaceChanged(printed, issued({ bank: 'KFHO' }))).toBe(true);
    expect(printedFaceChanged(printed, { ...printed, cheque: null })).toBe(true);
    // Printed with the vendor's name: another vendor is another payee.
    const byVendor = issued({ drawer: '', printedAt: '2026-10-21T08:00:00.000Z' });
    expect(printedFaceChanged(byVendor, { ...byVendor, clientId: 'v-2' })).toBe(true);
    expect(printedFaceChanged(printed, { ...printed, clientId: 'v-2' })).toBe(false);
  });
});

describe('cheque layouts', () => {
  it('ship for Burgan Bank and KFH, valid and not yet calibrated', () => {
    expect(PRESET_BANKS).toEqual(['BRGN', 'KFHO']);
    for (const bank of PRESET_BANKS) {
      const layout = presetLayout(bank, 'co-1')!;
      expect(layoutProblem(layout), bank).toBeNull();
      expect(layout).toMatchObject({ companyId: 'co-1', calibrated: false, version: 1 });
      expect(isPresetLayoutId(layout.id)).toBe(true);
    }
    expect(burgan.name).toBe('Burgan Bank');
    expect(kfh.nameAr).toBe('بيت التمويل الكويتي');
    expect(presetLayout('nbok', 'co-1')).toBeNull();
  });

  it('are copies: changing one leaves the built-in layout as it was', () => {
    burgan.fields.date.x = 1;
    expect(presetLayout('BRGN', 'co-1')!.fields.date.x).toBe(128);
  });

  it('use the company’s own layout of a bank over the built-in one', () => {
    const own = { ...kfh, id: 'lay-1', name: 'KFH, measured', updatedAt: '2026-10-22T00:00:00Z' };
    const newer = { ...own, id: 'lay-2', updatedAt: '2026-10-23T00:00:00Z' };
    expect(layoutFor('kfho', [own])?.id).toBe('lay-1');
    expect(layoutFor('KFHO', [own, newer])?.id).toBe('lay-2');
    expect(layoutFor('KFHO', [{ ...own, archived: true }], 'co-1')?.id).toBe('preset-KFHO');
    expect(layoutFor('BRGN', [own])?.id).toBe('preset-BRGN');
    expect(layoutFor('NBOK', [own])).toBeNull();
    const nbk = { ...own, id: 'lay-3', bank: 'NBOK' };
    expect(layoutFor('NBOK', [nbk])?.id).toBe('lay-3');
    expect(layoutBanks([own, nbk])).toEqual(['BRGN', 'KFHO', 'NBOK']);
  });

  it('refuse fields outside the leaf and leaves no bank prints', () => {
    const outside = {
      ...kfh,
      fields: { ...kfh.fields, figures: { ...kfh.fields.figures, x: 150 } },
    };
    expect(layoutProblem(outside)).toBe('Every field must be inside the leaf.');
    expect(layoutProblem({ ...kfh, size: { width: 300, height: 80 } })).toMatch(/between 100/);
    expect(layoutProblem({ ...kfh, offset: { x: 20, y: 0 } })).toMatch(/15 mm/);
    expect(layoutProblem({ ...kfh, name: ' ' })).toBe('Give the layout a name.');
    const noCrossing = { ...kfh, fields: { ...kfh.fields, crossing: undefined } };
    expect(layoutProblem(noCrossing)).toBeNull();
  });

  it('tell a change of measurements from a change of name', () => {
    expect(sameMeasurements(kfh, { ...kfh, name: 'Renamed', calibrated: true })).toBe(true);
    expect(sameMeasurements(kfh, { ...kfh, offset: { x: 0.5, y: 0 } })).toBe(false);
    expect(sameMeasurements(kfh, { ...kfh, wordsLanguage: 'en' })).toBe(false);
  });
});
