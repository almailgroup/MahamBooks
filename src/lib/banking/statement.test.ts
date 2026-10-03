import { describe, expect, it } from 'vitest';
import {
  csvStatement,
  detectDateFormats,
  fingerprints,
  guessMapping,
  isOfx,
  parseAmount,
  parseCsvRows,
  parseOfx,
  parseStatementDate,
} from './statement';

describe('amounts', () => {
  it('read the ways banks write them', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('-12.50')).toBe(-12.5);
    expect(parseAmount('£-12.50')).toBe(-12.5);
    expect(parseAmount('(45.00)')).toBe(-45);
    expect(parseAmount('45.00-')).toBe(-45);
    expect(parseAmount('12,34')).toBe(12.34);
    expect(parseAmount('1,234')).toBe(1234);
    expect(parseAmount('AED 1 500.00')).toBe(1500);
    expect(parseAmount('100.00 DR')).toBe(-100);
    expect(parseAmount('100.00CR')).toBe(100);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('Card payment')).toBeNull();
    expect(parseAmount('2026-10-01')).toBeNull();
  });
});

describe('dates', () => {
  it('read each format and nothing else', () => {
    expect(parseStatementDate('31/12/2026', 'dd/MM/yyyy')).toBe('2026-12-31');
    expect(parseStatementDate('12/31/2026', 'MM/dd/yyyy')).toBe('2026-12-31');
    expect(parseStatementDate('31/12/2026', 'MM/dd/yyyy')).toBeNull();
    expect(parseStatementDate('05 Oct 2026', 'd MMM yyyy')).toBe('2026-10-05');
    expect(parseStatementDate('5-Sept-26', 'd MMM yyyy')).toBe('2026-09-05');
    expect(parseStatementDate('2026-10-05T00:00:00', 'yyyy-MM-dd')).toBe('2026-10-05');
    expect(parseStatementDate('31.12.26', 'dd.MM.yyyy')).toBe('2026-12-31');
  });

  it('are detected from a column, day first unless told otherwise', () => {
    expect(detectDateFormats(['01/02/2026', '15/02/2026'])).toEqual(['dd/MM/yyyy']);
    expect(detectDateFormats(['01/02/2026', '03/02/2026'])[0]).toBe('dd/MM/yyyy');
    expect(detectDateFormats(['01/02/2026', '03/02/2026'], false)[0]).toBe('MM/dd/yyyy');
  });
});

describe('CSV statements', () => {
  it('map a typical UK export with money in and money out', () => {
    const rows = parseCsvRows(
      [
        '\uFEFFDate,Description,Paid out,Paid in,Balance',
        '01/10/2026,"CARD PAYMENT TO OFFICE SUPPLIES, LEEDS",45.60,,"1,954.40"',
        '02/10/2026,BRIGHTSIDE RETAIL INV-2026-0005,,"1,200.00","3,154.40"',
      ].join('\r\n'),
    );
    const mapping = guessMapping(rows);
    expect(mapping).toMatchObject({
      header: true,
      date: 0,
      description: 1,
      moneyOut: 2,
      moneyIn: 3,
      amount: null,
      balance: 4,
      dateFormat: 'dd/MM/yyyy',
    });
    const { lines, skipped } = csvStatement(rows, mapping);
    expect(skipped).toBe(0);
    expect(lines).toEqual([
      {
        date: '2026-10-01',
        description: 'CARD PAYMENT TO OFFICE SUPPLIES, LEEDS',
        reference: '',
        amount: -45.6,
        balance: 1954.4,
      },
      {
        date: '2026-10-02',
        description: 'BRIGHTSIDE RETAIL INV-2026-0005',
        reference: '',
        amount: 1200,
        balance: 3154.4,
      },
    ]);
  });

  it('map a signed amount with semicolons and decimal commas', () => {
    const rows = parseCsvRows(
      'Buchungstag;Verwendungszweck;Betrag;Saldo\n05.10.2026;Miete Oktober;-1.250,00;8.750,00\n',
    );
    const mapping = guessMapping(rows);
    expect(mapping).toMatchObject({ amount: 2, balance: 3, dateFormat: 'dd.MM.yyyy' });
    expect(csvStatement(rows, mapping).lines[0]).toMatchObject({
      date: '2026-10-05',
      amount: -1250,
      balance: 8750,
    });
  });

  it('works without a header row, and can flip signs', () => {
    const rows = parseCsvRows('2026-10-01,Coffee,-3.20\n2026-10-01,Coffee,-3.20\n');
    const mapping = guessMapping(rows);
    expect(mapping).toMatchObject({ header: false, date: 0, description: 1, amount: 2 });
    const { lines } = csvStatement(rows, { ...mapping, invert: true });
    expect(lines.map((l) => l.amount)).toEqual([3.2, 3.2]);
  });
});

describe('OFX statements', () => {
  it('read SGML transactions and the closing balance', () => {
    const text = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>GBP
<BANKTRANLIST><DTSTART>20261001
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[0:GMT]<TRNAMT>-64.80<FITID>A1<NAME>HARBOR LUNCH<MEMO>Card 1234
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261004<TRNAMT>500.00<FITID>A2<NAME>ORBIT LOGISTICS
</BANKTRANLIST><LEDGERBAL><BALAMT>2435.20<DTASOF>20261004</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(isOfx(text)).toBe(true);
    const r = parseOfx(text);
    expect(r.currency).toBe('GBP');
    expect(r.lines).toEqual([
      {
        date: '2026-10-03',
        description: 'HARBOR LUNCH · Card 1234',
        reference: 'A1',
        amount: -64.8,
        balance: null,
      },
      {
        date: '2026-10-04',
        description: 'ORBIT LOGISTICS',
        reference: 'A2',
        amount: 500,
        balance: null,
      },
    ]);
    expect(r.balance).toEqual({ amount: 2435.2, date: '2026-10-04' });
  });
});

describe('duplicates', () => {
  it('keep identical lines apart, and match them again on a second import', () => {
    const line = {
      date: '2026-10-01',
      description: 'Coffee',
      reference: '',
      amount: -3.2,
      balance: null,
    };
    const first = fingerprints('bank', [line, line]);
    expect(new Set(first).size).toBe(2);
    expect(fingerprints('bank', [line, line])).toEqual(first);
  });
});

describe('Kuwaiti and Arabic statements', () => {
  it('reads dinar amounts written with Arabic signs and digits', () => {
    expect(parseAmount('125.500 د.ك')).toBe(125.5);
    expect(parseAmount('د.ك. 1,250.750')).toBe(1250.75);
    expect(parseAmount('K.D. 3.250')).toBe(3.25);
    expect(parseAmount('١٢٥٫٥٠٠')).toBe(125.5);
    expect(parseAmount('١٬٢٥٠٫٧٥٠')).toBe(1250.75);
    expect(parseAmount('0,250')).toBe(0.25);
    expect(parseAmount('12,500')).toBe(12500);
    expect(parseAmount('45.600 مدين')).toBe(-45.6);
    expect(parseAmount('45.600 دائن')).toBe(45.6);
  });

  it('reads Arabic dates and headers', () => {
    expect(parseStatementDate('٠٣/١٠/٢٠٢٦', 'dd/MM/yyyy')).toBe('2026-10-03');
    expect(parseStatementDate('3 أكتوبر 2026', 'd MMM yyyy')).toBe('2026-10-03');
    const rows = parseCsvRows(
      'التاريخ,البيان,مدين,دائن,الرصيد\n03/10/2026,سحب نقدي,20.000,,980.000\n04/10/2026,تحويل وارد,,150.250,"1,130.250"\n',
    );
    const mapping = guessMapping(rows);
    expect(mapping).toMatchObject({
      header: true,
      date: 0,
      description: 1,
      moneyOut: 2,
      moneyIn: 3,
      balance: 4,
    });
    expect(csvStatement(rows, mapping).lines.map((l) => l.amount)).toEqual([-20, 150.25]);
  });
});
