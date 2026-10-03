// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/db/defaults';
import { buildStatement } from '@/lib/statements';
import { history } from '@/test/statement-fixtures';
import { registerFonts } from '../fonts';
import { sampleCompany } from '../sample';
import { STATEMENT_FONTS, statementDocument } from './document';
import { buildStatementModel } from './model';

const company = sampleCompany();
company.payment.bankDetails = 'National Bank of Kuwait · KW81 NBOK 0000 0000 0000 1001 2345 67';
const client = createClient(company.id, {
  id: 'client',
  number: 'CL-0007',
  name: 'Gulf Contracting Co.',
  nameAr: 'شركة الخليج للمقاولات',
  phone: '+965 2245 1100',
  address: {
    line1: '',
    line2: '',
    city: 'Shuwaikh Industrial',
    state: 'Capital',
    postalCode: '',
    country: 'KW',
    block: '1',
    street: '12',
    building: '40',
  },
});

const statement = buildStatement({
  side: 'customer',
  ...history(),
  from: '2026-07-01',
  to: '2026-08-31',
  currency: 'KWD',
});

beforeAll(() => {
  registerFonts(STATEMENT_FONTS, (file) => join(import.meta.dirname, '..', 'fonts', file));
});

describe('statement model', () => {
  it('prints Arabic first with English under it', () => {
    const m = buildStatementModel(statement, company, client, {
      language: 'ar-en',
      printedOn: '2026-09-01',
    });
    expect(m.dir).toBe('rtl');
    expect(m.title).toEqual({ text: 'كشف حساب', secondary: 'Statement of account' });
    expect(m.contact).toMatchObject({
      name: 'شركة الخليج للمقاولات',
      nameSecondary: 'Gulf Contracting Co.',
    });
    expect(m.rows[0].title.text).toContain('فاتورة');
    expect(m.rows[0].title.secondary).toBe('Invoice');
    expect(m.rows[1].title.secondary).toContain('Retention held');
    expect(m.rows[1].muted).toBe(true);
    expect(m.opening.balance).toBe('200.000');
    expect(m.closing.balance).toBe('872.839');
    expect(m.summary.at(-1)).toMatchObject({
      label: { text: 'الرصيد المستحق', secondary: 'Balance due' },
      value: 'KD 872.839',
    });
    expect(m.retention?.value).toBe('KD 61.728');
    expect(m.cheques?.rows).toHaveLength(1);
    expect(m.words[0]).toContain('دينار');
    expect(m.words[1]).toContain('Kuwaiti Dinars');
  });

  it('writes amounts the Arabic way in Arabic and keeps English plain', () => {
    const ar = buildStatementModel(statement, company, client, {
      language: 'ar',
      printedOn: '2026-09-01',
    });
    expect(ar.summary.at(-1)?.value).toMatch(/872\.839\sد\.ك/);
    expect(ar.title.secondary).toBe('');
    const en = buildStatementModel(statement, company, client, {
      language: 'en',
      printedOn: '2026-09-01',
    });
    expect(en.dir).toBe('ltr');
    expect(en.contact.name).toBe('Gulf Contracting Co.');
    expect(en.rows.map((r) => r.title.text)).toContain('Cheque returned PAY-2');
  });
});

describe('statement PDF', () => {
  it('renders one statement or a batch', async () => {
    const models = (['ar-en', 'ar', 'en'] as const).map((language) =>
      buildStatementModel(statement, company, client, { language, printedOn: '2026-09-01' }),
    );
    const single = await renderToBuffer(statementDocument([models[0]]));
    expect(single.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const batch = await renderToBuffer(statementDocument(models));
    expect(batch.length).toBeGreaterThan(single.length);
    // STATEMENT_PDF_DIR=/some/dir keeps the files to look at them.
    const dir = process.env.STATEMENT_PDF_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'statement-ar-en.pdf'), single);
      writeFileSync(join(dir, 'statements-batch.pdf'), batch);
    }
  }, 60_000);
});
