import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createClient, createTaxRate } from './defaults';
import { saveClient, saveCompany, saveTaxRate, setupCompany } from './records';
import { createEmployee, getPeopleSettings, savePeopleSettings, saveEmployee } from './people';
import { convertDocument, saveDocument } from './documents';
import {
  canEditCostings,
  canMakeCostingQuote,
  canSeeCostings,
  costingBasis,
  costingsAvailable,
  CostingError,
  createQuoteFromCosting,
  deleteCosting,
  getCostingSettings,
  newCosting,
  rateCard,
  rateCardFromSalaries,
  saveCosting,
  saveCostingSettings,
  setCostingsOn,
  setCostingStatus,
} from './costings';
import type { Company, CostingPost, StaffingCosting } from './types';
import { newPost, priceCosting } from '@/lib/hr/costing';
import { CloudPermissionError } from '@/cloud/outbox';
import { isPrivateRecord, type MemberRole } from '@/cloud/roles';
import type { CloudLink } from '@/cloud/types';

/**
 * Manpower costings (#3) on the device: off until switched on, priced from
 * the company's settings, made only by those who see payroll, and turned
 * into a quote that carries sell prices only. Invented names and amounts.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function company(name = 'Made-up Guarding'): Promise<Company> {
  return setupCompany({ name });
}

async function link(c: Company, role: MemberRole, extra: Partial<CloudLink> = {}) {
  await db.syncState.put({
    companyId: c.id,
    userId: 'user-1',
    role,
    status: 'ready',
    cursor: 0,
    name: c.name,
    linkedAt: '2026-12-01T08:00:00.000Z',
    lastSyncAt: null,
    lastError: null,
    lastErrorAt: null,
    features: ['tables_v16', 'staffing_costings'],
    ...extra,
  });
  await db.outbox.clear();
}

/** Distinctive amounts, so a test can tell they never reach the quote. */
const guard = (extra: Partial<CostingPost> = {}): CostingPost => ({
  ...newPost(),
  jobTitle: 'Security Guard',
  jobTitleAr: 'حارس أمن',
  headcount: 6,
  hoursPerDay: 12,
  basic: 137.25,
  allowances: 41.5,
  otherCosts: 9.875,
  ...extra,
});

async function costingFor(
  c: Company,
  extra: Partial<StaffingCosting> = {},
  customer: Partial<Parameters<typeof createClient>[1]> = {},
) {
  const client = await saveClient(createClient(c.id, { name: 'Made-up Towers Co.', ...customer }));
  const draft = newCosting(c.id, await getCostingSettings(c.id), client.id);
  return saveCosting({ ...draft, name: 'Tower A, night shift', posts: [guard()], ...extra });
}

describe('the switch', () => {
  it('is off with 10% overhead and a 15% margin until changed', async () => {
    const c = await company();
    expect(await getCostingSettings(c.id)).toEqual({
      on: false,
      overheadPercent: 10,
      marginPercent: 15,
      rates: undefined,
    });
    expect((await getPeopleSettings(c.id)).costing).toBeUndefined();
    await setCostingsOn(c.id, true);
    expect(await getCostingSettings(c.id)).toMatchObject({ on: true, overheadPercent: 10 });
    await setCostingsOn(c.id, false);
    expect((await getCostingSettings(c.id)).on).toBe(false);
  });

  it('is kept when the People settings are saved from a form opened before', async () => {
    const c = await company();
    const form = await getPeopleSettings(c.id);
    await setCostingsOn(c.id, true);
    await saveCostingSettings(c.id, { overheadPercent: 12, marginPercent: 20 });
    await savePeopleSettings({ ...form, reminderDays: [30] });
    expect(await getCostingSettings(c.id)).toMatchObject({
      on: true,
      overheadPercent: 12,
      marginPercent: 20,
    });
  });

  it('is the owner’s, an admin’s or an accountant’s, and only once the cloud has costings', async () => {
    const c = await company();
    for (const role of ['owner', 'admin', 'accountant'] as const) {
      await link(c, role);
      await setCostingsOn(c.id, role !== 'accountant');
    }
    for (const role of ['staff', 'viewer'] as const) {
      await link(c, role);
      await expect(setCostingsOn(c.id, true)).rejects.toBeInstanceOf(CostingError);
    }
    await link(c, 'owner', { features: ['tables_v16', 'employee_letters'] });
    await expect(setCostingsOn(c.id, true)).rejects.toThrow(/latest database script/);
    expect(costingsAvailable(null)).toBe(true);
    expect(costingsAvailable(undefined)).toBe(false);
  });

  it('is kept from members the owner made Maham People view only for', async () => {
    const c = await company();
    await link(c, 'accountant', { permissions: { apps: { people: 'view' } } });
    const l = (await db.syncState.get(c.id))!;
    expect(canSeeCostings(l)).toBe(true);
    expect(canEditCostings(l)).toBe(false);
    await expect(setCostingsOn(c.id, true)).rejects.toBeInstanceOf(CostingError);
    await link(c, 'accountant', { permissions: { apps: { books: 'view' } } });
    expect(canEditCostings((await db.syncState.get(c.id))!)).toBe(true);
  });
});

describe('the rate card', () => {
  it('comes from the current salaries until one is saved', async () => {
    const c = await company();
    for (const [name, basic] of [
      ['Made-up Guard One', 110],
      ['Made-up Guard Two', 130],
    ] as const) {
      await saveEmployee(
        createEmployee(c.id, {
          name,
          jobTitle: 'Security Guard',
          category: 'expat',
          nationality: 'IN',
          basicSalary: basic,
          allowances: [{ id: 'a', name: 'Transport', amount: 20, countsForEos: true }],
        }),
      );
    }
    expect(await rateCard(c.id)).toEqual({
      fromSalaries: true,
      rates: [
        expect.objectContaining({
          jobTitle: 'Security Guard',
          category: 'expat',
          basic: 120,
          allowances: 20,
          count: 2,
        }),
      ],
    });
    await saveCostingSettings(c.id, {
      overheadPercent: 10,
      marginPercent: 15,
      rates: [{ id: 'r1', jobTitle: 'Cleaner', category: 'expat', basic: 95, allowances: 15 }],
    });
    expect(await rateCard(c.id)).toEqual({
      fromSalaries: false,
      rates: [{ id: 'r1', jobTitle: 'Cleaner', category: 'expat', basic: 95, allowances: 15 }],
    });
  });

  it('leaves out employees with no pay yet, and averages the allowances that count for the indemnity', async () => {
    const c = await company();
    for (const [name, basic, allowances] of [
      ['Made-up Guard One', 120, [{ id: 'a', name: 'Transport', amount: 30, countsForEos: false }]],
      [
        'Made-up Guard Two',
        120,
        [
          { id: 'a', name: 'Transport', amount: 20, countsForEos: false },
          { id: 'b', name: 'Housing', amount: 10, countsForEos: true },
        ],
      ],
      // Imported without a salary column.
      ['Made-up Guard Three', 0, []],
    ] as const) {
      await saveEmployee(
        createEmployee(c.id, {
          name,
          jobTitle: 'Security Guard',
          category: 'expat',
          nationality: 'IN',
          basicSalary: basic,
          allowances: allowances.map((a) => ({ ...a })),
        }),
      );
    }
    expect(await rateCardFromSalaries(c.id)).toEqual([
      expect.objectContaining({
        jobTitle: 'Security Guard',
        basic: 120,
        allowances: 30,
        eosAllowances: 5,
        count: 2,
      }),
    ]);
  });

  it('is worked out from salaries only for someone who sees payroll', async () => {
    const c = await company();
    await saveEmployee(
      createEmployee(c.id, { name: 'Made-up Person', jobTitle: 'Cleaner', basicSalary: 99 }),
    );
    await link(c, 'staff');
    expect(await rateCardFromSalaries(c.id)).toEqual([]);
    await link(c, 'viewer');
    expect(await rateCardFromSalaries(c.id)).toEqual([]);
    await link(c, 'accountant');
    expect(await rateCardFromSalaries(c.id)).toHaveLength(1);
  });
});

describe('a costing', () => {
  it('is priced with the company’s settings when saved, in KWD to three decimals', async () => {
    const c = await company();
    const saved = await costingFor(c);
    const [post] = saved.posts;
    expect(post).toMatchObject({ headcount: 6, hoursPerDay: 12, category: 'expat' });
    // 178.75 wage; overtime 178.75 ÷ 8 × 4 × 1.25; indemnity and leave a month; other costs.
    expect(post.overtimeMonthly).toBe(111.719);
    expect(post.eosiMonthly).toBe(8.594);
    expect(post.leaveMonthly).toBe(17.188);
    expect(post.monthlyCost).toBe(326.126);
    expect(post.sellPrice).toBe(422.046);
    expect(await db.staffingCostings.get(saved.id)).toMatchObject({ name: 'Tower A, night shift' });
  });

  it('needs a name and a job title for each post', async () => {
    const c = await company();
    await expect(costingFor(c, { name: ' ' })).rejects.toThrow(/name/);
    await expect(costingFor(c, { posts: [guard({ jobTitle: '' })] })).rejects.toThrow(/job title/);
  });

  it('logs what happens to it as private activity', async () => {
    const c = await company();
    const saved = await costingFor(c);
    await setCostingStatus(saved.id, 'won');
    await deleteCosting(saved.id);
    const logged = await db.activities.where('entityId').equals(saved.id).toArray();
    expect(logged.map((a) => a.action).sort()).toEqual(['created', 'deleted', 'status']);
    for (const a of logged) expect(isPrivateRecord('activities', { ...a })).toBe(true);
  });

  it('is made only by those who see payroll; the device refuses staff and viewers', async () => {
    const c = await company();
    const saved = await costingFor(c);
    for (const role of ['staff', 'viewer'] as const) {
      await link(c, role);
      await expect(saveCosting({ ...saved, name: 'Other' })).rejects.toBeInstanceOf(CostingError);
      await expect(
        db.staffingCostings.put({ ...saved, id: 'direct', name: 'Direct' }),
      ).rejects.toBeInstanceOf(CloudPermissionError);
    }
    await link(c, 'accountant');
    await expect(saveCosting({ ...saved, name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed',
    });
  });
});

describe('the quote made from a costing', () => {
  it('has one line a post, at its sell price, linked both ways', async () => {
    const c = await company();
    const costing = await costingFor(c, {
      posts: [
        guard(),
        guard({
          jobTitle: 'Cleaner',
          jobTitleAr: 'عامل نظافة',
          headcount: 2,
          hoursPerDay: 8,
          basic: 97.125,
          allowances: 13.5,
          otherCosts: 0,
        }),
      ],
    });
    const quote = await createQuoteFromCosting(costing.id);
    expect(quote).toMatchObject({
      type: 'quote',
      status: 'draft',
      clientId: costing.clientId,
      costingId: costing.id,
    });
    expect(quote.number).not.toBe('');
    expect(quote.items.map((i) => [i.name, i.nameAr, i.quantity, i.unitPrice])).toEqual([
      ['Security Guard', 'حارس أمن', 6, costing.posts[0].sellPrice],
      ['Cleaner', 'عامل نظافة', 2, costing.posts[1].sellPrice],
    ]);
    expect(quote.totals.subtotal).toBe(
      Math.round((6 * costing.posts[0].sellPrice + 2 * costing.posts[1].sellPrice) * 1000) / 1000,
    );
    expect(await db.staffingCostings.get(costing.id)).toMatchObject({
      quoteId: quote.id,
      status: 'quoted',
    });
  });

  it('carries sell prices only: no cost, salary, PIFSS, indemnity or margin anywhere', async () => {
    const c = await company();
    const costing = await costingFor(c, {
      notes: 'Internal: margin is thin, salaries 137.25',
      posts: [guard({ category: 'kuwaiti' })],
    });
    const quote = await createQuoteFromCosting(costing.id);
    const stored = (await db.documents.get(quote.id))!;
    const activity = await db.activities.where('entityId').equals(quote.id).toArray();
    const [post] = (await db.staffingCostings.get(costing.id))!.posts;
    const { costingId, ...rest } = stored;
    expect(costingId).toBe(costing.id);
    const text = JSON.stringify({ quote: rest, activity });
    for (const amount of [
      post.basic,
      post.allowances,
      post.otherCosts,
      post.employerPifss,
      post.eosiMonthly,
      post.leaveMonthly,
      post.overtimeMonthly!,
      post.monthlyCost,
    ].filter((amount) => amount > 0)) {
      expect(text, String(amount)).not.toContain(String(amount));
    }
    // A Kuwaiti post pays the employer's PIFSS share, which stays in the costing.
    expect(post.employerPifss).toBeGreaterThan(0);
    expect(text).not.toMatch(
      /cost|salar|pifss|eosi|indemnit|margin|overhead|allowance|basic|internal/i,
    );
    for (const field of [stored.notes, stored.terms, stored.privateNotes, stored.intro ?? '']) {
      expect(field).not.toContain('137.25');
    }
    // The quote's activity is the ordinary one staff may read; the costing's is private.
    for (const a of activity) expect(isPrivateRecord('activities', { ...a })).toBe(false);
    const own = await db.activities.where('entityId').equals(costing.id).toArray();
    expect(own.map((a) => a.action)).toContain('quoted');
    for (const a of own) expect(isPrivateRecord('activities', { ...a })).toBe(true);
  });

  it('is in the company’s currency, at the costing’s prices, for a customer whose documents are in another', async () => {
    const c = await company();
    const costing = await costingFor(c, {}, { currency: 'USD' });
    const quote = await createQuoteFromCosting(costing.id);
    expect(quote.currency).toBe('KWD');
    expect(quote.exchangeRate).toBeUndefined();
    expect(quote.items[0].unitPrice).toBe(422.046);
    // To the fils: the costing's sell total, 6 × 422.046.
    expect(quote.totals.total).toBe(2532.276);
  });

  it('has prices before tax, with tax on top, when the company’s prices include tax', async () => {
    const c = await company();
    const vat = await saveTaxRate(createTaxRate(c.id, { name: 'VAT', rate: 5 }));
    await saveCompany({
      ...c,
      defaults: {
        ...c.defaults,
        defaultTaxRateIds: [vat.id],
        lineTaxes: true,
        documentTaxes: false,
        pricesIncludeTax: true,
      },
    });
    const costing = await costingFor(c);
    const quote = await createQuoteFromCosting(costing.id);
    const sell = priceCosting(costing, await costingBasis(c.id)).totals.sell;
    expect(sell).toBe(2532.276);
    expect(quote.pricesIncludeTax).toBe(false);
    expect(quote.items[0].taxes.map((tax) => tax.rate)).toEqual([5]);
    // The company keeps the whole sell price; the tax is the customer's to pay on top.
    expect(quote.totals.subtotal).toBe(sell);
    expect(quote.totals.taxTotal).toBe(126.614);
    expect(quote.totals.total).toBe(2658.89);
  });

  it('says the hours and days in the quote’s language, whoever makes it', async () => {
    const c = await company();
    const arabic = await createQuoteFromCosting(
      (await costingFor(c, {}, { name: 'Made-up Arabic Towers', language: 'ar' })).id,
    );
    expect(arabic.items[0].description).toBe(
      'ساعات العمل في اليوم: 12، أيام العمل في الشهر: 26، السعر للفرد في الشهر',
    );
    const english = await createQuoteFromCosting(
      (await costingFor(c, {}, { name: 'Made-up English Towers', language: 'en' })).id,
    );
    expect(english.items[0].description).toBe(
      '12 hours a day, 26 days a month, per person a month',
    );
    const both = await createQuoteFromCosting(
      (await costingFor(c, {}, { name: 'Made-up Bilingual Towers', language: 'ar-en' })).id,
    );
    expect(both.items[0].description.split('\n')).toEqual([
      'ساعات العمل في اليوم: 12، أيام العمل في الشهر: 26، السعر للفرد في الشهر',
      '12 hours a day, 26 days a month, per person a month',
    ]);
  });

  it('is refused, saying why, to a member the owner made Maham Books view only for', async () => {
    const c = await company();
    const costing = await costingFor(c);
    await link(c, 'accountant', { permissions: { apps: { books: 'view' } } });
    const l = (await db.syncState.get(c.id))!;
    expect(canEditCostings(l)).toBe(true);
    expect(canMakeCostingQuote(l)).toBe(false);
    const before = await db.documents.count();
    await expect(createQuoteFromCosting(costing.id)).rejects.toThrow(
      /made quotes view only for you \(in Maham Books/,
    );
    expect(await db.documents.count()).toBe(before);
    await link(c, 'accountant', { permissions: { apps: { people: 'edit' } } });
    expect(canMakeCostingQuote((await db.syncState.get(c.id))!)).toBe(true);
    await expect(createQuoteFromCosting(costing.id)).resolves.toMatchObject({ type: 'quote' });
  });

  it('needs a customer and a post', async () => {
    const c = await company();
    const costing = await costingFor(c);
    await db.staffingCostings.update(costing.id, { clientId: null });
    await expect(createQuoteFromCosting(costing.id)).rejects.toThrow(/customer/);
    await db.staffingCostings.update(costing.id, { clientId: costing.clientId, posts: [] });
    await expect(createQuoteFromCosting(costing.id)).rejects.toThrow(/post/);
  });

  it('keeps the costing’s id when edited, and an invoice made from it has none', async () => {
    const c = await company();
    const quote = await createQuoteFromCosting((await costingFor(c)).id);
    const edited = await saveDocument({ ...quote, poNumber: 'PO-77' });
    expect(edited.costingId).toBe(quote.costingId);
    const invoice = await convertDocument(quote.id, 'invoice');
    expect(invoice.costingId).toBeUndefined();
  });
});
