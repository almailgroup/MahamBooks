import { describe, expect, it } from 'vitest';
import type { Client, InvoiceDocument } from '@/db/types';
import { baseValue, followUps, pipelineQuotes, prospects, stageOf, summarize } from './pipeline';

type Doc = Parameters<typeof summarize>[0][number] & Pick<InvoiceDocument, 'clientId'>;

let n = 0;
const quote = (over: Partial<Doc>): Doc => ({
  id: `q${++n}`,
  type: 'quote',
  status: 'sent',
  clientId: 'c1',
  number: `QT-${n}`,
  issueDate: '2026-10-01',
  dueDate: null,
  currency: 'KWD',
  exchangeRate: 1,
  totals: { subtotal: 100, discount: 0, taxTotal: 0, total: 100.5, paid: 0, balance: 100.5 },
  sentAt: null,
  archived: false,
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const client = (id: string, over: Partial<Client> = {}) =>
  ({
    id,
    name: id,
    isCustomer: true,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }) as Client;

describe('the CRM pipeline', () => {
  it('puts each quote in a stage', () => {
    expect(stageOf({ status: 'draft' })).toBe('draft');
    expect(stageOf({ status: 'sent' })).toBe('open');
    for (const status of ['accepted', 'invoiced', 'converted'] as const) {
      expect(stageOf({ status })).toBe('won');
    }
    expect(stageOf({ status: 'declined' })).toBe('lost');
  });

  it('leaves out archived quotes and other documents', () => {
    const list = pipelineQuotes([quote({}), quote({ archived: true }), quote({ type: 'invoice' })]);
    expect(list).toHaveLength(1);
  });

  it('adds up each stage in the company currency', () => {
    expect(
      baseValue(
        quote({
          currency: 'USD',
          exchangeRate: 0.305,
          totals: { ...quote({}).totals, total: 1000 },
        }),
        'KWD',
      ),
    ).toBe(305);
    // Without a rate it is not counted in dinars at all.
    expect(baseValue(quote({ currency: 'USD', exchangeRate: undefined }), 'KWD')).toBeNull();
    expect(baseValue(quote({ currency: 'USD', exchangeRate: 0 }), 'KWD')).toBeNull();
    const summary = summarize(
      [
        quote({ totals: { ...quote({}).totals, total: 0.1 } }),
        quote({ totals: { ...quote({}).totals, total: 0.2 } }),
        quote({ status: 'accepted', updatedAt: '2026-09-01T00:00:00Z' }),
        quote({ status: 'declined', updatedAt: '2026-09-01T00:00:00Z' }),
        quote({ status: 'declined', updatedAt: '2025-01-01T00:00:00Z' }),
      ],
      'KWD',
      '2026-10-17',
    );
    expect(summary.stages.find((s) => s.stage === 'open')).toEqual({
      stage: 'open',
      count: 2,
      value: 0.3,
      foreign: 0,
    });
    const usd = summarize(
      [quote({}), quote({ currency: 'USD', exchangeRate: undefined })],
      'KWD',
      '2026-10-17',
    );
    expect(usd.stages.find((s) => s.stage === 'open')).toMatchObject({
      count: 2,
      value: 100.5,
      foreign: 1,
    });
    // The decline of last year is too old to count.
    expect(summary.winRate).toBe(50);
    expect(summarize([quote({})], 'KWD', '2026-10-17').winRate).toBeNull();
  });

  it('lists sent quotes waiting a week or more, and expired ones, oldest first', () => {
    const list = followUps(
      [
        quote({ number: 'A', issueDate: '2026-10-15' }),
        quote({ number: 'B', issueDate: '2026-10-01' }),
        quote({ number: 'C', issueDate: '2026-10-09', sentAt: '2026-10-10T08:00:00' }),
        quote({ number: 'D', issueDate: '2026-10-16', dueDate: '2026-10-16' }),
        quote({ number: 'E', status: 'draft', issueDate: '2026-01-01' }),
      ],
      '2026-10-17',
    );
    expect(list.map((f) => [f.quote.number, f.days, f.expired])).toEqual([
      ['B', 16, false],
      ['C', 7, false],
      ['D', 1, true],
    ]);
  });

  it('finds the customers who have not bought yet', () => {
    const docs = [
      quote({ clientId: 'declined', status: 'declined' }),
      quote({ clientId: 'abroad', currency: 'USD', exchangeRate: undefined }),
      quote({ clientId: 'drafted', status: 'draft' }),
      quote({ clientId: 'quoted' }),
      quote({ clientId: 'quoted', totals: { ...quote({}).totals, total: 50 } }),
      quote({ clientId: 'buyer' }),
      { ...quote({ clientId: 'buyer' }), type: 'invoice' as const, status: 'paid' as const },
      { ...quote({ clientId: 'draft-only' }), type: 'invoice' as const, status: 'draft' as const },
    ];
    const list = prospects(
      [
        client('buyer'),
        client('quoted'),
        client('fresh', { createdAt: '2026-10-01T00:00:00Z' }),
        client('draft-only'),
        client('declined'),
        client('abroad', { createdAt: '2025-06-01T00:00:00Z' }),
        client('drafted'),
        client('vendor', { isCustomer: false, isVendor: true }),
        client('gone', { archived: true }),
      ],
      docs,
      'KWD',
    );
    expect(list.map((p) => [p.client.id, p.kind, p.openQuotes, p.openValue, p.foreign])).toEqual([
      ['quoted', 'quoted', 2, 150.5, 0],
      ['abroad', 'quoted', 1, 0, 1],
      ['declined', 'contacted', 0, 0, 0],
      ['fresh', 'new', 0, 0, 0],
      ['draft-only', 'new', 0, 0, 0],
      ['drafted', 'new', 0, 0, 0],
    ]);
  });
});
