import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { companySettingLabels } from './labels';

/** The fields of the Company interface, read from its source. */
function companyFields(): string[] {
  const source = readFileSync(join(__dirname, '..', 'db', 'types.ts'), 'utf8');
  const body = /^export interface Company \{\n([\s\S]*?)^\}/m.exec(source)?.[1] ?? '';
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

describe('the company settings named in a sync conflict', () => {
  it('name every setting of the company record', () => {
    const fields = companyFields();
    expect(fields).toContain('vouchers');
    // Not settings: kept by the app itself.
    const own = new Set(['id', 'createdAt', 'updatedAt', 'demo']);
    const unnamed = fields.filter(
      (field) => !own.has(field) && companySettingLabels([[field]])[0] === 'Other settings',
    );
    expect(unnamed).toEqual([]);
  });

  it('name the Books settings as Settings does', () => {
    expect(
      companySettingLabels([['vouchers', 'images'], ['chequePrinting'], ['dashboard', 'layout']]),
    ).toEqual(['Receipt and payment vouchers', 'Cheque printing', 'Books dashboard']);
  });
});
