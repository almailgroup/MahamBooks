import { describe, expect, it } from 'vitest';
import { neutralizeFormula, toCsv } from './csv';

/** Made-up data only. */

describe('CSV exports', () => {
  it('keep a formula as text, so a spreadsheet does not run it', () => {
    expect(neutralizeFormula('=HYPERLINK("http://example.com","Pay here")')).toBe(
      '\'=HYPERLINK("http://example.com","Pay here")',
    );
    expect(neutralizeFormula('+965 5000 0000')).toBe("'+965 5000 0000");
    expect(neutralizeFormula('-2+3')).toBe("'-2+3");
    expect(neutralizeFormula('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(neutralizeFormula('\tcmd')).toBe("'\tcmd");
    expect(neutralizeFormula('\rcmd')).toBe("'\rcmd");
  });

  it('leave numbers and ordinary text as they are', () => {
    for (const value of ['-12.500', '+1,250.000', '-0.5', 'Al Noor Trading', 'INV-0001', '']) {
      expect(neutralizeFormula(value)).toBe(value);
    }
    expect(toCsv(['Client', 'Amount'], [['=1+1', -12.5]])).toBe("Client,Amount\r\n'=1+1,-12.5");
    // Quoting still applies after the apostrophe.
    expect(toCsv(['Note'], [['=A1,"x"']])).toBe('Note\r\n"\'=A1,""x"""');
  });
});
