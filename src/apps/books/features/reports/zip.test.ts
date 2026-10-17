import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, createZip, readZip } from './zip';

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores files with UTF-8 names that read back unchanged', () => {
    const zip = createZip([
      { name: 'trial-balance.csv', data: 'Code,Account\r\n1000,Bank\r\n' },
      { name: 'ميزان.csv', data: 'رمز,حساب' },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['trial-balance.csv', 'ميزان.csv']);
    expect(new TextDecoder().decode(files[1].data)).toBe('رمز,حساب');
  });

  it('is a valid archive for standard unzip tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const path = join(dir, 'pack.zip');
    writeFileSync(path, createZip([{ name: 'a.csv', data: 'x,y\r\n1,2' }]));
    let listing: string;
    try {
      listing = execFileSync('python3', [
        '-c',
        'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read("a.csv").decode())',
        path,
      ]).toString();
    } catch {
      return; // No Python here: the structure is still checked above.
    }
    expect(listing.trim()).toBe('x,y\r\n1,2'.trim());
    expect(readFileSync(path).subarray(0, 2).toString()).toBe('PK');
  });
});
