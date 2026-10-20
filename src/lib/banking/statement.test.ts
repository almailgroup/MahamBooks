import { describe, expect, it } from 'vitest';
import {
  checkBalances,
  csvStatement,
  debitOrCredit,
  detectDateFormats,
  findHeaderRow,
  fingerprints,
  guessMapping,
  isOfx,
  parseAmount,
  parseCsvRows,
  parseOfx,
  parseStatementDate,
  statementDelimiter,
  trimFooter,
} from './statement';
import { STATEMENT_RESULT, statementCsv } from '@/test/bank-statements';

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

describe('statements with account details above the table', () => {
  const read = (rows: string[][]) => {
    const start = findHeaderRow(rows);
    const table = trimFooter(rows.slice(start));
    const mapping = guessMapping(table);
    return { start, table, mapping, ...csvStatement(table, mapping) };
  };

  it('find the column names under 5 rows of account details, in English and Arabic', () => {
    for (const lang of ['en', 'ar'] as const) {
      const rows = parseCsvRows(statementCsv(lang));
      const { start, mapping, lines, skipped } = read(rows);
      expect(start).toBe(5);
      expect(mapping).toMatchObject({
        header: true,
        date: 0,
        valueDate: 1,
        description: 2,
        reference: 3,
        moneyOut: 4,
        moneyIn: 5,
        amount: null,
        balance: 6,
        dateFormat: 'dd/MM/yyyy',
      });
      expect(skipped).toBe(0);
      expect(lines).toEqual(STATEMENT_RESULT);
    }
  });

  it('drop the totals and notes after the last line', () => {
    const rows = parseCsvRows(statementCsv());
    const { table } = read(rows);
    expect(table).toHaveLength(4);
    expect(table.at(-1)?.[2]).toBe('SWIFT CHARGES');
    expect(trimFooter(parseCsvRows(statementCsv('ar')).slice(5))).toHaveLength(4);
    // A last line whose description starts with "Total" stays.
    const kept = [
      ['Date', 'Description', 'Amount'],
      ['01/10/2026', 'TOTAL FUEL STATION', '-5.000'],
      ['Total', '', '-5.000'],
    ];
    expect(trimFooter(kept)).toEqual(kept.slice(0, 2));
    // A closing balance with a date is a total too.
    expect(
      trimFooter([...kept.slice(0, 2), ['31/10/2026', 'Closing balance', '995.000']]),
    ).toHaveLength(2);
  });

  it('read separate debit and credit columns with 3 decimals, and value dates', () => {
    const { lines } = read(parseCsvRows(statementCsv()));
    expect(lines.map((l) => l.amount)).toEqual([-45.6, 1200, -3.5]);
    expect(lines.map((l) => l.balance)).toEqual([1954.4, 3154.4, 3150.9]);
    expect(lines[1]).toMatchObject({ date: '2026-10-02', valueDate: '2026-10-03' });
    // Without a value date column, lines have none.
    const rows = parseCsvRows('Date,Description,Amount\n01/10/2026,Fee,-1.250\n');
    expect(csvStatement(rows, guessMapping(rows)).lines[0]).not.toHaveProperty('valueDate');
  });

  it('keep reading statements that start at the first row as before', () => {
    const uk = parseCsvRows(
      'Date,Description,Paid out,Paid in,Balance\n01/10/2026,Fee,1.00,,9.00\n',
    );
    const german = parseCsvRows(
      'Buchungstag;Verwendungszweck;Betrag;Saldo\n05.10.2026;Miete;-1,00;8,00\n',
    );
    const bare = parseCsvRows('2026-10-01,Coffee,-3.20\n2026-10-02,Coffee,-3.20\n');
    expect([uk, german, bare].map(findHeaderRow)).toEqual([0, 0, 0]);
    expect(guessMapping(uk)).toMatchObject({ valueDate: null, debitCredit: null });
  });

  it('find the table by its first line when the column names are unknown', () => {
    const rows = [
      ['Kontoauszug'],
      ['Konto', 'TEST-0001'],
      ['Buchung', 'Text', 'Umsatz'],
      ['01.10.2026', 'Miete', '-1.250,00'],
      ['02.10.2026', 'Gutschrift', '300,00'],
    ];
    expect(findHeaderRow(rows)).toBe(2);
    expect(findHeaderRow(rows.filter((_, i) => i !== 2))).toBe(2);
  });

  it('use the delimiter of the table when the first line is a title', () => {
    const text =
      'Account statement\r\nDate;Description;Amount\r\n01/10/2026;Fee, monthly;-1,250\r\n';
    expect(statementDelimiter(text)).toBe(';');
    expect(statementDelimiter('Date,Description\n')).toBe(',');
    expect(statementDelimiter('Title only')).toBe(',');
    expect(parseCsvRows(text, statementDelimiter(text))[2]).toEqual([
      '01/10/2026',
      'Fee, monthly',
      '-1,250',
    ]);
    // Without one, as before: the first line decides.
    expect(parseCsvRows(text)[2]).toEqual(['01/10/2026;Fee', 'monthly;-1', '250']);
  });

  it('read an amount column with a debit or credit column beside it', () => {
    expect(['Dr', 'D', 'debit', 'مدين', '-'].map(debitOrCredit)).toEqual(Array(5).fill('debit'));
    expect(['CR', 'c.', 'Credit', 'دائن', '+'].map(debitOrCredit)).toEqual(Array(5).fill('credit'));
    expect(debitOrCredit('Card')).toBeNull();
    const rows = parseCsvRows(
      'Date,Details,Amount,Dr/Cr,Balance\n01/10/2026,Fee,1.250,DR,98.750\n02/10/2026,Deposit,50.000,CR,148.750\n',
    );
    const mapping = { ...guessMapping(rows), debitCredit: 3 };
    expect(csvStatement(rows, mapping).lines.map((l) => l.amount)).toEqual([-1.25, 50]);
  });
});

describe('running balances', () => {
  const lines = (amounts: number[], balances: (number | null)[]) =>
    amounts.map((amount, i) => ({
      date: '2026-10-01',
      description: '',
      reference: '',
      amount,
      balance: balances[i],
    }));

  it('agree in either order, and tell when the signs are the wrong way round', () => {
    expect(checkBalances(STATEMENT_RESULT)).toBe('agrees');
    expect(checkBalances([...STATEMENT_RESULT].reverse())).toBe('agrees');
    // A line without a balance in between still counts.
    expect(checkBalances(lines([-1.5, 2, 3], [98.5, null, 103.5]))).toBe('agrees');
    expect(checkBalances(STATEMENT_RESULT.map((l) => ({ ...l, amount: -l.amount })))).toBe(
      'flipped',
    );
    expect(checkBalances(lines([-1, -1], [99, 97]))).toBe('differs');
    expect(checkBalances(lines([-1, -1], [99, null]))).toBeNull();
  });
});
