import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';
import { readXlsx } from '@/lib/xlsx';
import { buildWorkbook } from '@/test/workbook';
import { countSheetRows, parseCountSheet, readCountRows, type CountItem } from './count';

const ITEMS: CountItem[] = [
  { id: 'paper', sku: 'PAP-A4', name: 'Printer paper A4', nameAr: 'ورق طابعة A4', unit: 'box' },
  { id: 'toner', sku: '', name: 'Toner cartridge', nameAr: 'خرطوشة حبر', unit: 'pcs' },
];

describe('stock count sheets', () => {
  it('round-trips the counted quantities through CSV', () => {
    const rows = countSheetRows(
      ITEMS,
      (id) => (id === 'paper' ? 20 : 3),
      (id) => (id === 'paper' ? 18 : null),
    );
    expect(rows).toEqual([
      ['PAP-A4', 'Printer paper A4', 'box', 20, 18],
      ['', 'Toner cartridge', 'pcs', 3, ''],
    ]);
    const text = toCsv(['SKU', 'Item', 'Unit', 'On record', 'Counted'], rows);
    const result = parseCountSheet(text, ITEMS);
    expect([...result.counted]).toEqual([['paper', 18]]);
    expect(result.unmatched).toEqual([]);
  });

  it('matches by SKU, English or Arabic name and reads Arabic digits', () => {
    const text = [
      'رمز الصنف,الصنف,الوحدة,الكمية المسجلة,الكمية المعدودة',
      'pap-a4,,box,20,١٧',
      ',خرطوشة حبر,pcs,3,2.5',
      'X-1,Stapler,pcs,0,4',
      ',Toner cartridge,pcs,3,many',
    ].join('\n');
    const result = parseCountSheet(text, ITEMS);
    expect(result.counted.get('paper')).toBe(17);
    expect(result.counted.get('toner')).toBe(2.5);
    expect(result.unmatched).toEqual(['Stapler']);
    expect(result.invalid).toEqual(['Toner cartridge']);
  });

  it('reads an Excel count sheet like the CSV one', async () => {
    const header = ['SKU', 'Item', 'Unit', 'On record', 'Counted'];
    const workbook = buildWorkbook([
      header,
      ['PAP-A4', 'Printer paper A4', 'box', 20, 18],
      [null, 'Toner cartridge', 'pcs', 3, 2.5],
    ]);
    const fromExcel = readCountRows(await readXlsx(workbook), ITEMS);
    const fromCsv = parseCountSheet(
      toCsv(header, [
        ['PAP-A4', 'Printer paper A4', 'box', 20, 18],
        ['', 'Toner cartridge', 'pcs', 3, 2.5],
      ]),
      ITEMS,
    );
    expect([...fromExcel.counted]).toEqual([
      ['paper', 18],
      ['toner', 2.5],
    ]);
    expect(fromExcel).toEqual(fromCsv);
  });
});
