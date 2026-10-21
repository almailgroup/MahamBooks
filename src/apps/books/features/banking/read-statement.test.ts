import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readStatementFile, StatementFileError, type StatementFile } from './read-statement';
import { statementLayout, statementTable } from '@/lib/banking/layout';
import { csvStatement, fingerprints } from '@/lib/banking/statement';
import {
  STATEMENT_RESULT,
  statementCsv,
  statementHtml,
  statementSpreadsheetMl,
  statementWorkbook,
} from '@/test/bank-statements';

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));
const bytes = (text: string) => new TextEncoder().encode(text);

/** The lines a file gives with the guessed layout. */
function lines(file: StatementFile) {
  if (file.kind === 'ofx') return file.lines;
  const layout = statementLayout(file.rows, undefined);
  return csvStatement(statementTable(file.rows, layout.start), layout.mapping).lines;
}

describe('statement files', () => {
  it('give the same lines and fingerprints from Excel as from CSV', async () => {
    const csv = await readStatementFile(bytes(statementCsv()));
    const xlsx = await readStatementFile(statementWorkbook('en', { deflate, sharedStrings: true }));
    expect(csv.kind).toBe('csv');
    expect(xlsx.kind).toBe('xlsx');
    expect(lines(csv)).toEqual(STATEMENT_RESULT);
    expect(lines(xlsx)).toEqual(STATEMENT_RESULT);
    expect(fingerprints('bank', lines(xlsx))).toEqual(fingerprints('bank', lines(csv)));
    const arabic = await readStatementFile(statementWorkbook('ar'));
    expect(lines(arabic)).toEqual(STATEMENT_RESULT);
  });

  it('read HTML and Excel 2003 XML saved as .xls, whatever the name says', async () => {
    const html = await readStatementFile(bytes(statementHtml()));
    expect(html.kind).toBe('html');
    expect(lines(html)).toEqual(STATEMENT_RESULT);
    const xml = await readStatementFile(bytes(statementSpreadsheetMl('ar')));
    expect(xml.kind).toBe('html');
    expect(lines(xml)).toEqual(STATEMENT_RESULT);
  });

  it('decode Arabic text in UTF-8, UTF-16 and Windows-1256', async () => {
    const text = 'التاريخ,البيان,المبلغ\r\n01/10/2026,رسوم,-1.250\r\n';
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...new Uint8Array(new Uint16Array([...text].map((c) => c.charCodeAt(0))).buffer),
    ]);
    // "التاريخ,البيان,المبلغ" in Windows-1256.
    const cp1256 = new Uint8Array([
      0xc7,
      0xe1,
      0xca,
      0xc7,
      0xd1,
      0xed,
      0xce,
      0x2c,
      0xc7,
      0xe1,
      0xc8,
      0xed,
      0xc7,
      0xe4,
      0x2c,
      0xc7,
      0xe1,
      0xe3,
      0xc8,
      0xe1,
      0xdb,
      0x0d,
      0x0a,
      ...bytes('01/10/2026,X,-1.250\r\n'),
    ]);
    for (const data of [bytes(text), utf16, cp1256]) {
      const file = await readStatementFile(data);
      expect(file.kind === 'csv' && file.rows[0]).toEqual(['التاريخ', 'البيان', 'المبلغ']);
      expect(lines(file)[0]).toMatchObject({ date: '2026-10-01', amount: -1.25 });
    }
  });

  it('read OFX as before', async () => {
    const file = await readStatementFile(
      bytes(
        'OFXHEADER:100\n<OFX><STMTTRN><DTPOSTED>20261003<TRNAMT>-64.80<FITID>A1<NAME>LUNCH\n</BANKTRANLIST></OFX>',
      ),
    );
    expect(file).toMatchObject({ kind: 'ofx', lines: [{ date: '2026-10-03', amount: -64.8 }] });
  });

  it('explain what it can’t read', async () => {
    const oldExcel = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(readStatementFile(oldExcel)).rejects.toThrow(
      'Older Excel files (.xls) can’t be read. In Excel, save the file as .xlsx or CSV.',
    );
    await expect(readStatementFile(bytes('%PDF-1.4\n%%EOF\n'))).rejects.toThrow(StatementFileError);
  });
});
