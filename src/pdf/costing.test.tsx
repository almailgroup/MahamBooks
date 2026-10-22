// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import type { StaffingCosting } from '@/db/types';
import { DEFAULT_COSTING_BASIS, newPost, priceCosting } from '@/lib/hr/costing';
import { loadLanguage } from '@/i18n';
import { registerFonts } from './fonts';
import { buildCostingSheet } from './costing-model';
import { COSTING_FONTS, costingDocument } from './costing';

/**
 * The internal cost sheet of a manpower costing (كشف التكلفة, #3): what it
 * shows, in both languages, and that only the costing page prints it (never
 * the quote, its email or its attachments). Invented names and amounts.
 */

const costing: StaffingCosting = {
  id: 'cost-1',
  companyId: 'co-1',
  name: 'Tower A, night shift',
  clientId: 'cl-1',
  quoteId: null,
  status: 'draft',
  overheadPercent: 10,
  marginPercent: 15,
  notes: '',
  createdAt: '2026-12-01T08:00:00.000Z',
  updatedAt: '2026-12-01T08:00:00.000Z',
  posts: [
    {
      ...newPost(),
      id: 'p1',
      jobTitle: 'Security Guard',
      jobTitleAr: 'حارس أمن',
      headcount: 6,
      hoursPerDay: 12,
      basic: 120,
      allowances: 30,
    },
    {
      ...newPost(),
      id: 'p2',
      jobTitle: 'Cleaner',
      jobTitleAr: 'عامل نظافة',
      headcount: 2,
      basic: 95,
      allowances: 15,
    },
  ],
};

const input = () => ({
  costing,
  priced: priceCosting(costing, DEFAULT_COSTING_BASIS),
  company: { name: 'Made-up Guarding Co.', nameAr: 'شركة الحراسة', currency: 'KWD', logo: null },
  customer: 'Made-up Towers Co.',
  printedOn: '01/12/2026',
});

beforeAll(() => {
  registerFonts(COSTING_FONTS, (file) => join(import.meta.dirname, 'fonts', file));
});

describe('the cost sheet', () => {
  it('shows each post’s cost and sell price, the margin and the overtime warning', async () => {
    await loadLanguage('en');
    const model = buildCostingSheet(input());
    expect(model.dir).toBe('ltr');
    expect(model.title).toBe('Cost sheet');
    expect(model.notice).toContain('never sent to the customer');
    expect(model.rows.map((r) => r.title)).toEqual(['Security Guard', 'Cleaner']);
    // People, wage, overtime, PIFSS, indemnity, leave, other, cost, overhead, sell, a month.
    expect(model.rows[0].cells.slice(0, 3)).toEqual(['6', '150.000', '93.750']);
    expect(model.rows[0].cells).toHaveLength(model.columns.length - 1);
    expect(model.summary.find((s) => s.label === 'Markup on cost')?.value).toBe('17.65%');
    expect(model.meta.find((m) => m.label === 'Margin')?.value).toBe(
      '15% of the sell price (17.65% markup on cost)',
    );
    expect(model.warnings).toHaveLength(1);
    expect(model.warnings[0]).toContain('Article 66');
  });

  it('is in Arabic, right to left, for Arabic readers', async () => {
    await loadLanguage('ar');
    try {
      const model = buildCostingSheet(input());
      expect(model.dir).toBe('rtl');
      expect(model.title).toBe('كشف التكلفة');
      expect(model.rows.map((r) => r.title)).toEqual(['حارس أمن', 'عامل نظافة']);
      expect(model.company.name).toBe('شركة الحراسة');
      const pdf = await renderToBuffer(costingDocument(model));
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await loadLanguage('en');
    }
  }, 60_000);

  it('renders to a PDF', async () => {
    const pdf = await renderToBuffer(costingDocument(buildCostingSheet(input())));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 60_000);

  it('is printed from the costing page only, never with the quote or its email', () => {
    const src = join(import.meta.dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const users = files(src)
      .filter((file) =>
        /@\/pdf\/costing(-model)?['"]|\.\/costing(-model)?['"]/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(src, file).replaceAll('\\', '/'))
      .sort();
    // The demo imports the costing's data functions, not the sheet.
    expect(users.filter((file) => !file.startsWith('db/'))).toEqual([
      'apps/people/pages/costing/editor.tsx',
      'pdf/costing.tsx',
    ]);
  });
});
